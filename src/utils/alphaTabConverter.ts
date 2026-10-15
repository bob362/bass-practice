import { ParsedTab, TabMeasure, TabNote } from './pdfParser'

/**
 * パースされたタブ譜をalphaTab .tex形式に変換
 */
export function convertToAlphaTab(parsed: ParsedTab): string {
  const lines: string[] = []
  
  // メタデータ
  if (parsed.title) {
    lines.push(`\\title "${parsed.title}"`)
  }
  if (parsed.artist) {
    lines.push(`\\subtitle "${parsed.artist}"`)
  }
  lines.push(`\\tempo ${parsed.tempo || 120}`)
  
  // ベースのチューニング（4弦ベース標準チューニング）
  lines.push('\\tuning E1 A1 D2 G2')
  
  // 空行
  lines.push('.')
  
  // 小節を変換
  const measureStrings: string[] = []
  
  for (const measure of parsed.measures) {
    const measureStr = convertMeasure(measure)
    if (measureStr) {
      measureStrings.push(measureStr)
    }
  }
  
  // 小節を結合（適度に改行）
  let currentLine = ':4 ' // 4分音符デフォルト
  for (let i = 0; i < measureStrings.length; i++) {
    currentLine += measureStrings[i]
    
    // 小節の区切り
    if (i < measureStrings.length - 1) {
      currentLine += ' | '
    }
    
    // 4小節ごとに改行
    if ((i + 1) % 4 === 0 && i < measureStrings.length - 1) {
      lines.push(currentLine)
      currentLine = ''
    }
  }
  
  if (currentLine) {
    lines.push(currentLine)
  }
  
  return lines.join('\n')
}

/**
 * 1小節を.tex形式に変換
 */
function convertMeasure(measure: TabMeasure): string {
  if (measure.notes.length === 0) {
    return 'r' // 休符
  }
  
  // ポジションでグループ化
  const notesByPosition = new Map<number, TabNote[]>()
  
  for (const note of measure.notes) {
    const pos = note.position
    if (!notesByPosition.has(pos)) {
      notesByPosition.set(pos, [])
    }
    notesByPosition.get(pos)!.push(note)
  }
  
  // ポジション順にソート
  const positions = Array.from(notesByPosition.keys()).sort((a, b) => a - b)
  
  const noteParts: string[] = []
  
  for (const pos of positions) {
    const notesAtPos = notesByPosition.get(pos)!
    
    if (notesAtPos.length === 1) {
      // 単音
      const note = notesAtPos[0]
      noteParts.push(formatNote(note))
    } else {
      // 和音（複数の弦を同時に弾く）
      const chord = notesAtPos.map(n => formatNote(n)).join('.')
      noteParts.push(chord)
    }
  }
  
  return noteParts.join(' ')
}

/**
 * 1つの音符を.tex形式にフォーマット
 * 形式: フレット番号.弦番号
 * 例: 0.4 (4弦の0フレット), 5.3 (3弦の5フレット)
 */
function formatNote(note: TabNote): string {
  return `${note.fret}.${note.string}`
}

/**
 * alphaTab .tex形式を手動編集可能な形式に変換（レビュー画面用）
 */
export function texToEditable(tex: string): EditableScore {
  const lines = tex.split('\n')
  const metadata: { [key: string]: string } = {}
  const measures: string[] = []
  
  for (const line of lines) {
    if (line.startsWith('\\title')) {
      const match = line.match(/\\title\s+"([^"]+)"/)
      if (match) metadata.title = match[1]
    } else if (line.startsWith('\\subtitle')) {
      const match = line.match(/\\subtitle\s+"([^"]+)"/)
      if (match) metadata.subtitle = match[1]
    } else if (line.startsWith('\\tempo')) {
      const match = line.match(/\\tempo\s+(\d+)/)
      if (match) metadata.tempo = match[1]
    } else if (line.startsWith(':') || line.match(/^\d/)) {
      // 小節データ
      const measureStrings = line.replace(/^:4\s*/, '').split('|').map(m => m.trim())
      measures.push(...measureStrings.filter(m => m))
    }
  }
  
  return { metadata, measures }
}

/**
 * 編集可能な形式からalphaTab .texに戻す
 */
export function editableToTex(editable: EditableScore): string {
  const lines: string[] = []
  
  if (editable.metadata.title) {
    lines.push(`\\title "${editable.metadata.title}"`)
  }
  if (editable.metadata.subtitle) {
    lines.push(`\\subtitle "${editable.metadata.subtitle}"`)
  }
  if (editable.metadata.tempo) {
    lines.push(`\\tempo ${editable.metadata.tempo}`)
  }
  
  lines.push('\\tuning E1 A1 D2 G2')
  lines.push('.')
  
  // 小節を結合
  let currentLine = ':4 '
  for (let i = 0; i < editable.measures.length; i++) {
    currentLine += editable.measures[i]
    
    if (i < editable.measures.length - 1) {
      currentLine += ' | '
    }
    
    if ((i + 1) % 4 === 0 && i < editable.measures.length - 1) {
      lines.push(currentLine)
      currentLine = ''
    }
  }
  
  if (currentLine) {
    lines.push(currentLine)
  }
  
  return lines.join('\n')
}

export interface EditableScore {
  metadata: { [key: string]: string }
  measures: string[]
}
