import * as pdfjsLib from 'pdfjs-dist'

// PDF.jsのワーカー設定
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs`

export interface TabNote {
  string: number // 1-4 (1=G, 2=D, 3=A, 4=E)
  fret: number
  position: number // 小節内の位置
  duration?: number // 音符の長さ（指定がない場合は均等）
}

export interface TabMeasure {
  notes: TabNote[]
  timeSignature?: { beats: number; beatType: number }
}

export interface ParsedTab {
  measures: TabMeasure[]
  tempo?: number
  title?: string
  artist?: string
}

/**
 * テキストベースのPDFからタブ譜を抽出
 */
export async function parseTextPDF(file: File): Promise<ParsedTab> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  
  let allText = ''
  const lines: Array<{ text: string; y: number; x: number }> = []
  
  // 全ページからテキストを抽出
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const textContent = await page.getTextContent()
    
    for (const item of textContent.items) {
      if ('str' in item && item.str.trim()) {
        lines.push({
          text: item.str,
          y: item.transform[5],
          x: item.transform[4],
        })
        allText += item.str + ' '
      }
    }
  }
  
  // タイトルとアーティスト情報を抽出（最初の数行から）
  const titleMatch = allText.match(/title[:\s]+([^\n]+)/i)
  const artistMatch = allText.match(/artist[:\s]+([^\n]+)/i)
  const tempoMatch = allText.match(/tempo[:\s]+(\d+)/i) || allText.match(/bpm[:\s]+(\d+)/i)
  
  // Y座標でソートして行を整理
  lines.sort((a, b) => b.y - a.y)
  
  // タブ譜のパターンを探す（4行のベースタブ）
  const tabLines = extractTabLines(lines)
  const measures = parseTabLines(tabLines)
  
  return {
    measures,
    tempo: tempoMatch ? parseInt(tempoMatch[1]) : 120,
    title: titleMatch ? titleMatch[1].trim() : undefined,
    artist: artistMatch ? artistMatch[1].trim() : undefined,
  }
}

/**
 * テキストからタブ譜の行を抽出
 */
function extractTabLines(lines: Array<{ text: string; y: number; x: number }>): string[][] {
  const tabSections: string[][] = []
  let currentSection: string[] = []
  let lastY = -1
  
  for (const line of lines) {
    // タブ譜のパターン（G|, D|, A|, E| または数字とダッシュの組み合わせ）
    if (isTabLine(line.text)) {
      if (lastY !== -1 && Math.abs(line.y - lastY) > 20) {
        // 新しいセクション
        if (currentSection.length === 4) {
          tabSections.push([...currentSection])
        }
        currentSection = []
      }
      currentSection.push(line.text)
      lastY = line.y
      
      if (currentSection.length === 4) {
        tabSections.push([...currentSection])
        currentSection = []
      }
    }
  }
  
  return tabSections
}

/**
 * 行がタブ譜かどうかを判定
 */
function isTabLine(text: string): boolean {
  // タブ譜の特徴：数字、ダッシュ、縦線が含まれる
  const tabPattern = /[0-9][\-|0-9]+/
  const stringPattern = /^[GDAE]\|/
  return tabPattern.test(text) || stringPattern.test(text)
}

/**
 * タブ譜の行から音符を抽出
 */
function parseTabLines(sections: string[][]): TabMeasure[] {
  const measures: TabMeasure[] = []
  
  for (const section of sections) {
    if (section.length !== 4) continue
    
    // 各行を正規化（弦の名前を削除）
    const normalizedLines = section.map(line => {
      return line.replace(/^[GDAE]\|?/, '').trim()
    })
    
    // 最長の行の長さを取得
    const maxLength = Math.max(...normalizedLines.map(l => l.length))
    
    // 各位置での音符を抽出
    const measureNotes: TabNote[] = []
    let position = 0
    
    for (let i = 0; i < maxLength; i++) {
      for (let stringNum = 0; stringNum < 4; stringNum++) {
        const char = normalizedLines[stringNum]?.[i]
        if (char && /\d/.test(char)) {
          // 2桁の数字をチェック
          let fret = parseInt(char)
          if (i + 1 < maxLength && /\d/.test(normalizedLines[stringNum][i + 1])) {
            fret = parseInt(char + normalizedLines[stringNum][i + 1])
          }
          
          measureNotes.push({
            string: stringNum + 1,
            fret,
            position,
            duration: 1, // デフォルトは4分音符
          })
        }
      }
      
      // ダッシュや空白はスキップ、数字があれば位置を進める
      const hasNote = normalizedLines.some(line => /\d/.test(line[i]))
      if (hasNote) {
        position++
      }
    }
    
    if (measureNotes.length > 0) {
      measures.push({ notes: measureNotes })
    }
  }
  
  return measures
}

/**
 * シンプルなタブ譜フォーマット（ASCII）のパース
 * 例：
 * G|---5---7---|
 * D|-5---7-----|
 * A|-----------|
 * E|-----------|
 */
export function parseSimpleTabText(text: string): ParsedTab {
  const lines = text.split('\n').filter(line => line.trim())
  
  // 4行ずつグループ化
  const measures: TabMeasure[] = []
  
  for (let i = 0; i < lines.length; i += 4) {
    if (i + 3 < lines.length) {
      const section = [
        lines[i],
        lines[i + 1],
        lines[i + 2],
        lines[i + 3],
      ]
      
      const parsed = parseTabLines([section])
      measures.push(...parsed)
    }
  }
  
  return {
    measures,
    tempo: 120,
  }
}
