import Tesseract from 'tesseract.js'
import * as pdfjsLib from 'pdfjs-dist'
import { configurePdfjsWorker, pdfDocumentParams } from './pdfjsConfig'
import { TabNote, TabMeasure, ParsedTab } from './pdfParser'

configurePdfjsWorker()

/**
 * スキャンされたPDFからOCRでタブ譜を抽出
 */
export async function parseScannedPDF(
  file: File,
  onProgress?: (progress: number) => void
): Promise<ParsedTab> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument(pdfDocumentParams(arrayBuffer)).promise
  
  const allMeasures: TabMeasure[] = []
  let title: string | undefined
  let tempo: number | undefined
  
  // 各ページを処理
  for (let pageNum = 1; pageNum <= Math.min(pdf.numPages, 5); pageNum++) {
    if (onProgress) {
      onProgress((pageNum - 1) / pdf.numPages)
    }
    
    const page = await pdf.getPage(pageNum)
    const viewport = page.getViewport({ scale: 2.0 })
    
    // ページをCanvasにレンダリング
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')!
    canvas.width = viewport.width
    canvas.height = viewport.height
    
    await page.render({
      canvasContext: context,
      viewport: viewport,
    }).promise
    
    // OCRで文字認識
    const result = await Tesseract.recognize(canvas, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text' && onProgress) {
          const pageProgress = (pageNum - 1) / pdf.numPages
          const ocrProgress = m.progress / pdf.numPages
          onProgress(pageProgress + ocrProgress)
        }
      },
    })
    
    const text = result.data.text
    
    // 最初のページからメタデータを抽出
    if (pageNum === 1) {
      const titleMatch = text.match(/title[:\s]+([^\n]+)/i)
      const tempoMatch = text.match(/tempo[:\s]+(\d+)/i) || text.match(/bpm[:\s]+(\d+)/i)
      title = titleMatch ? titleMatch[1].trim() : undefined
      tempo = tempoMatch ? parseInt(tempoMatch[1]) : 120
    }
    
    // タブ譜を抽出
    const measures = extractTabFromOCR(text, result.data.words)
    allMeasures.push(...measures)
  }
  
  if (onProgress) {
    onProgress(1.0)
  }
  
  return {
    measures: allMeasures,
    tempo: tempo || 120,
    title,
  }
}

/**
 * OCRテキストからタブ譜を抽出
 */
function extractTabFromOCR(
  text: string,
  _words: Tesseract.Word[]
): TabMeasure[] {
  const measures: TabMeasure[] = []
  
  // 行ごとに分割
  const lines = text.split('\n').filter(line => line.trim())
  
  // タブ譜のパターンを探す
  const tabLineGroups: string[][] = []
  let currentGroup: string[] = []
  
  for (const line of lines) {
    // タブ譜の行と判定（数字とダッシュ/縦線が多い）
    if (isLikelyTabLine(line)) {
      currentGroup.push(line)
      
      // 4行揃ったら1グループ
      if (currentGroup.length === 4) {
        tabLineGroups.push([...currentGroup])
        currentGroup = []
      }
    } else if (currentGroup.length > 0 && currentGroup.length < 4) {
      // 不完全なグループはリセット
      currentGroup = []
    }
  }
  
  // 各グループをパース
  for (const group of tabLineGroups) {
    const measure = parseOCRTabGroup(group)
    if (measure.notes.length > 0) {
      measures.push(measure)
    }
  }
  
  // OCRで取れなかった場合は、少なくとも基本的なパターンを生成
  if (measures.length === 0) {
    measures.push(createDefaultMeasure())
  }
  
  return measures
}

/**
 * 行がタブ譜らしいかを判定（OCR用）
 */
function isLikelyTabLine(line: string): boolean {
  // 数字が含まれている
  const hasNumbers = /\d/.test(line)
  // ダッシュや縦線が含まれている
  const hasDashes = /[-|]/.test(line)
  // 文字が少なすぎない（ノイズ除去）
  const hasMinLength = line.length >= 5
  
  return hasNumbers && hasDashes && hasMinLength
}

/**
 * OCRで取得したタブ譜グループをパース
 */
function parseOCRTabGroup(group: string[]): TabMeasure {
  const notes: TabNote[] = []
  let position = 0
  
  // 各行を正規化
  const normalizedLines = group.map(line => {
    // 弦名を削除（G|, D|, A|, E|）
    return line.replace(/^[GDAE]\s*[|]?\s*/i, '').trim()
  })
  
  // 最長の行を基準に
  const maxLength = Math.max(...normalizedLines.map(l => l.length))
  
  for (let i = 0; i < maxLength; i++) {
    let hasNoteAtPosition = false
    
    for (let stringNum = 0; stringNum < Math.min(4, normalizedLines.length); stringNum++) {
      const char = normalizedLines[stringNum]?.[i]
      
      if (char && /\d/.test(char)) {
        let fret = parseInt(char)
        
        // 2桁の数字を考慮
        const nextChar = normalizedLines[stringNum]?.[i + 1]
        if (nextChar && /\d/.test(nextChar)) {
          fret = parseInt(char + nextChar)
        }
        
        // フレットが妥当な範囲か確認（0-24）
        if (fret >= 0 && fret <= 24) {
          notes.push({
            string: stringNum + 1,
            fret,
            position,
            duration: 1,
          })
          hasNoteAtPosition = true
        }
      }
    }
    
    if (hasNoteAtPosition) {
      position++
    }
  }
  
  return { notes }
}

/**
 * デフォルトの小節を生成（パースに失敗した場合）
 */
function createDefaultMeasure(): TabMeasure {
  return {
    notes: [
      { string: 4, fret: 0, position: 0, duration: 1 },
      { string: 4, fret: 0, position: 1, duration: 1 },
      { string: 4, fret: 3, position: 2, duration: 1 },
      { string: 3, fret: 0, position: 3, duration: 1 },
    ],
  }
}

/**
 * PDFがスキャン画像かテキストベースかを判定
 */
export async function isPDFScanned(file: File): Promise<boolean> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument(pdfDocumentParams(arrayBuffer)).promise
  
  // 最初のページをチェック
  const page = await pdf.getPage(1)
  const textContent = await page.getTextContent()
  
  // テキスト量が少なければスキャンと判定
  const totalText = textContent.items
    .map(item => ('str' in item ? item.str : ''))
    .join('')
  
  return totalText.length < 50 // 50文字未満ならスキャン
}
