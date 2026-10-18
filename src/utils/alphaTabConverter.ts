import { midiToName } from '../audio/pitch'
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
  let tuning = tuningTokens(parsed.tuning || '')
  if (!tuning.length) tuning = tuningTokens('E1 A1 D2 G2')
  const maxString = Math.max(0, ...parsed.measures.flatMap(m =>
    m.gp ? m.gp.beats.flatMap(b => b.notes.map(n => n.string)) : m.notes.map(n => n.string)))
  const stringCount = Math.max(tuning.length, maxString)
  if (maxString > tuning.length) {
    const pitches = tuning.map(token => {
      const match = token.match(/^([A-G])([#b]?)(-?\d+)$/)
      if (!match) return NaN
      return (Number(match[3]) + 1) * 12 + ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1]] ?? 0) + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0)
    })
    if (pitches.some(p => !Number.isFinite(p))) tuning = tuningTokens(defaultBassTuning(stringCount))
    else {
      let lowest = pitches[0]
      while (tuning.length < stringCount) tuning.unshift(midiToName(lowest -= 5))
    }
  }
  // ParsedTab is low-first (string 1 = lowest); alphaTex is high-first.
  lines.push(formatInternalTuning(tuning))
  
  // 空行
  lines.push('.')
  
  const measureStrings: string[] = []
  let lastDur = ''

  for (const measure of parsed.measures) {
    const measureStr = measure.gp ? convertGpMeasure(measure.gp, stringCount, () => lastDur, d => { lastDur = d }) : convertMeasure(measure, stringCount)
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
function convertMeasure(measure: TabMeasure, stringCount: number): string {
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
      noteParts.push(formatNote(note, stringCount))
    } else {
      // 和音（複数の弦を同時に弾く）
      const chord = `(${notesAtPos.map(n => formatNote(n, stringCount)).join(' ')})`
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
function formatNote(note: TabNote, stringCount: number): string {
  const string = stringCount - note.string + 1
  const base = note.dead ? `x.${string}` : `${note.fret}.${string}`
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

function tuningTokens(tuning: string): string[] {
  return tuning.trim().replace(/^\(+|\)+$/g, '').split(/\s+/).filter(Boolean)
}

function defaultBassTuning(count: number): string {
  const defaults: Record<number, string> = {
    4: 'E1 A1 D2 G2', 5: 'B0 E1 A1 D2 G2', 6: 'B0 E1 A1 D2 G2 C3',
  }
  if (defaults[count]) return defaults[count]
  const tuning = ['E1', 'A1', 'D2', 'G2']
  let lowest = 28
  while (tuning.length < count) tuning.unshift(midiToName(lowest -= 5))
  return tuning.join(' ')
}

function formatInternalTuning(tokens: string[]): string {
  return formatAlphaTexTuning([...tokens].reverse().join(' '))
}

// Review metadata already follows alphaTex's high-to-low order.
function formatAlphaTexTuning(tuning?: string): string {
  const tokens = tuningTokens(tuning || '')
  return `\\tuning (${tokens.length ? tokens.join(' ') : 'G2 D2 A1 E1'})`
}

function convertGpMeasure(
  measure: import('./gpPdfParser').GpMeasure,
  stringCount: number,
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
        ? formatNote(beat.notes[0] as TabNote, stringCount)
        : `(${beat.notes.map(n => formatNote(n as TabNote, stringCount)).join(' ')})`
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
  
  lines.push(formatAlphaTexTuning(editable.metadata.tuning))
  lines.push('.')

  let currentLine = ''
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
