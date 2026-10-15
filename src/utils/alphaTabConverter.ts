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
  } else if (parsed.tuningLabel) {
    lines.push(`\\subtitle "${parsed.tuningLabel}"`)
  }
  lines.push(`\\tempo ${parsed.tempo || 120}`)
  lines.push(formatTuning(parsed.tuning))
  
  // 空行
  lines.push('.')
  
  const measureStrings: string[] = []
  let lastDur = ''

  for (const measure of parsed.measures) {
    const measureStr = measure.gp ? convertGpMeasure(measure.gp, () => lastDur, d => { lastDur = d }) : convertMeasure(measure)
    if (measureStr) measureStrings.push(measureStr)
  }

  let currentLine = ''
  for (let i = 0; i < measureStrings.length; i++) {
    currentLine += measureStrings[i]
    if (i < measureStrings.length - 1) currentLine += ' | '
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
      const chord = `(${notesAtPos.map(n => formatNote(n)).join(' ')})`
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
  const base = note.dead ? `x.${note.string}` : `${note.fret}.${note.string}`
  const fx: string[] = []
  if (note.hammer) fx.push('h')
  if (note.slide) fx.push('sl')
  if (note.tie) fx.push('t')
  return fx.length ? `${base}{${fx.join(' ')}}` : base
}

/** alphaTab 1.8 の付点は `:8.` ではなくビート効果 `{d}` / `{dd}` */
function durationSpec(quarters: number): { token: string; dots: 0 | 1 | 2 } {
  const table: Array<[number, string, 0 | 1 | 2]> = [
    [4, ':1', 0],
    [3, ':2', 1],
    [2, ':2', 0],
    [1.5, ':4', 1],
    [1, ':4', 0],
    [0.75, ':8', 1],
    [0.5, ':8', 0],
    [0.375, ':16', 1],
    [0.25, ':16', 0],
    [0.1875, ':32', 1],
    [0.125, ':32', 0],
    [0.0625, ':64', 0],
  ]
  let best = table[0]
  let err = Infinity
  for (const row of table) {
    const e = Math.abs(row[0] - quarters)
    if (e < err) {
      err = e
      best = row
    }
  }
  return { token: best[1], dots: best[2] }
}

function withDots(content: string, dots: 0 | 1 | 2): string {
  if (dots === 2) return `${content} {dd}`
  if (dots === 1) return `${content} {d}`
  return content
}

function formatTuning(tuning?: string): string {
  const raw = (tuning || 'E1 A1 D2 G2').trim().replace(/^\(+|\)+$/g, '')
  return `\\tuning (${raw})`
}

function convertGpMeasure(
  measure: import('./gpPdfParser').GpMeasure,
  getLast: () => string,
  setLast: (d: string) => void,
): string {
  if (measure.beats.length === 0) return ':1 r'
  const parts: string[] = []
  for (const beat of measure.beats) {
    const spec = durationSpec(beat.duration)
    if (spec.token !== getLast()) {
      parts.push(spec.token)
      setLast(spec.token)
    }
    const content = beat.notes.length === 0
      ? 'r'
      : beat.notes.length === 1
        ? formatNote(beat.notes[0] as TabNote)
        : `(${beat.notes.map(n => formatNote(n as TabNote)).join(' ')})`
    parts.push(withDots(content, spec.dots))
  }
  return parts.join(' ')
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
    } else if (line.startsWith('\\tuning')) {
      metadata.tuning = line.replace(/^\\tuning\s*/, '').trim().replace(/^\(+|\)+$/g, '')
    } else if (line.trim() && line.trim() !== '.') {
      const measureStrings = line.split('|').map(m => m.trim()).filter(Boolean)
      measures.push(...measureStrings)
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
  
  lines.push(formatTuning(editable.metadata.tuning))
  lines.push('.')

  const hasDuration = editable.measures.some(m => m.includes(':'))
  let currentLine = hasDuration ? '' : ':4 '
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
