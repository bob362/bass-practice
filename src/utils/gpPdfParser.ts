import * as pdfjsLib from 'pdfjs-dist'

/**
 * Guitar Pro / Songsterr 系のテキストPDF（標準記譜＋4線タブ）を読む。
 * 弦の割り当てはタブの譜線Y座標、小節は小節線、音価は符頭・連桁・旗・休符から取る。
 * alphaTab の弦番号は 1 が一番低い弦（タブの一番下）。
 */

const NOTEHEAD_BLACK = 0xe0a4
const NOTEHEAD_HALF = 0xe0a3
const NOTEHEAD_WHOLE = 0xe0a2
const NOTEHEAD_X = 0xe0a9
const REST_WHOLE = 0xe4e3
const REST_HALF = 0xe4e4
const REST_QUARTER = 0xe4e5
const REST_8 = 0xe4e6
const REST_16 = 0xe4e7
const REST_32 = 0xe4e8
const FLAG_8_UP = 0xe240
const FLAG_8_DOWN = 0xe241
const FLAG_16_UP = 0xe242
const FLAG_16_DOWN = 0xe243
const FLAG_32_UP = 0xe244
const FLAG_32_DOWN = 0xe245
const AUG_DOT = 0xe1e7
const TIMESIG_0 = 0xe080

export interface GpNote {
  string: number
  fret: number
  dead?: boolean
  hammer?: boolean
  slide?: boolean
}

export interface GpBeat {
  /** 4分音符を 1 とした長さ */
  duration: number
  notes: GpNote[]
  /** 記譜上のX。テクニック記号の対応に使う */
  x?: number
}

export interface GpMeasure {
  beats: GpBeat[]
  timeSignature: { beats: number; beatType: number }
}

export interface GpScore {
  measures: GpMeasure[]
  tempo: number
  title?: string
  tuning: string
  tuningLabel: string
}

interface TextItem {
  str: string
  x: number
  y: number
  w: number
  h: number
}

interface HSeg {
  y: number
  x1: number
  x2: number
}

interface VSeg {
  x: number
  y1: number
  y2: number
}

interface Staff {
  lines: number[] // top → bottom
  kind: 'tab' | 'notation'
  x1: number
  x2: number
}

interface System {
  notation: Staff
  tab: Staff
}

function cp(s: string): number {
  return s.codePointAt(0) ?? 0
}

function mul(m1: number[], m2: number[]): number[] {
  const [a1, b1, c1, d1, e1, f1] = m1
  const [a2, b2, c2, d2, e2, f2] = m2
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ]
}

function applyPt(m: number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

function extractGeometry(op: { fnArray: number[]; argsArray: unknown[] }): { horiz: HSeg[]; vert: VSeg[] } {
  const OPS = pdfjsLib.OPS
  let ctm = [1, 0, 0, 1, 0, 0]
  const stack: number[][] = []
  const horiz: HSeg[] = []
  const vert: VSeg[] = []

  const pushSeg = (x1: number, y1: number, x2: number, y2: number) => {
    const [px1, py1] = applyPt(ctm, x1, y1)
    const [px2, py2] = applyPt(ctm, x2, y2)
    const dx = Math.abs(px2 - px1)
    const dy = Math.abs(py2 - py1)
    if (dy < 1.3 && dx > 6) {
      horiz.push({ y: (py1 + py2) / 2, x1: Math.min(px1, px2), x2: Math.max(px1, px2) })
    }
    if (dx < 1.3 && dy > 12) {
      vert.push({ x: (px1 + px2) / 2, y1: Math.min(py1, py2), y2: Math.max(py1, py2) })
    }
  }

  for (let i = 0; i < op.fnArray.length; i++) {
    const f = op.fnArray[i]
    const a = op.argsArray[i] as number[] | number[][]
    if (f === OPS.save) stack.push(ctm.slice())
    else if (f === OPS.restore) ctm = stack.pop() ?? ctm
    else if (f === OPS.transform) ctm = mul(ctm, a as number[])
    else if (f === OPS.constructPath) {
      const ops = (a as number[][])[0]
      const coords = (a as number[][])[1]
      let k = 0
      let cx = 0
      let cy = 0
      for (const o of ops) {
        if (o === 13) {
          cx = coords[k++]
          cy = coords[k++]
        } else if (o === 14) {
          const x2 = coords[k++]
          const y2 = coords[k++]
          pushSeg(cx, cy, x2, y2)
          cx = x2
          cy = y2
        } else if (o === 15) {
          k += 4
          cx = coords[k++]
          cy = coords[k++]
        } else if (o === 16 || o === 17) {
          k += 2
          cx = coords[k++]
          cy = coords[k++]
        } else if (o === 19) {
          const x = coords[k++]
          const y = coords[k++]
          const w = coords[k++]
          const h = coords[k++]
          pushSeg(x, y, x + w, y)
          pushSeg(x, y + h, x + w, y + h)
          pushSeg(x, y, x, y + h)
          pushSeg(x + w, y, x + w, y + h)
        }
      }
    }
  }
  return { horiz, vert }
}

function clusterY(segs: HSeg[]): Array<{ y: number; x1: number; x2: number }> {
  const sorted = [...segs].sort((a, b) => b.y - a.y)
  const clusters: Array<{ y: number; x1: number; x2: number; n: number; len: number }> = []
  for (const s of sorted) {
    let c = clusters.find(c => Math.abs(c.y - s.y) < 0.7)
    if (!c) {
      c = { y: s.y, x1: s.x1, x2: s.x2, n: 0, len: 0 }
      clusters.push(c)
    }
    c.n++
    c.y = (c.y * (c.n - 1) + s.y) / c.n
    c.x1 = Math.min(c.x1, s.x1)
    c.x2 = Math.max(c.x2, s.x2)
    c.len += s.x2 - s.x1
  }
  // 譜線は段のほぼ全幅。連桁は同じ高さに見えても総延長が短い
  return clusters.filter(c => c.len > 280 && c.x2 - c.x1 > 120)
}

function findStaves(lines: Array<{ y: number; x1: number; x2: number }>): Staff[] {
  const staves: Staff[] = []
  let group: typeof lines = []
  const flush = () => {
    if (group.length === 4 || group.length === 5) {
      const ys = group.map(g => g.y)
      staves.push({
        lines: ys,
        kind: group.length === 4 ? 'tab' : 'notation',
        x1: Math.min(...group.map(g => g.x1)),
        x2: Math.max(...group.map(g => g.x2)),
      })
    }
    group = []
  }
  for (const line of lines) {
    if (group.length === 0) {
      group.push(line)
      continue
    }
    const gap = group[group.length - 1].y - line.y
    if (gap >= 3 && gap <= 9.5) group.push(line)
    else {
      flush()
      group.push(line)
    }
  }
  flush()
  return staves
}

function pairSystems(staves: Staff[]): System[] {
  const systems: System[] = []
  const notations = staves.filter(s => s.kind === 'notation')
  const used = new Set<Staff>()
  for (const tab of staves.filter(s => s.kind === 'tab')) {
    const above = notations
      .filter(n => n.lines[n.lines.length - 1] > tab.lines[0])
      .map(n => ({ n, gap: n.lines[n.lines.length - 1] - tab.lines[0] }))
      .filter(x => x.gap > 6 && x.gap < 45)
      .sort((a, b) => a.gap - b.gap)[0]
    if (above) {
      systems.push({ notation: above.n, tab })
      used.add(tab)
    }
  }
  // 五線が取れなくてもタブ譜線があればフレットは読む
  for (const tab of staves.filter(s => s.kind === 'tab')) {
    if (used.has(tab)) continue
    const top = tab.lines[0] + 34
    systems.push({
      notation: {
        kind: 'notation',
        lines: [top, top - 4.2, top - 8.4, top - 12.6, top - 16.8],
        x1: tab.x1,
        x2: tab.x2,
      },
      tab,
    })
  }
  systems.sort((a, b) => b.tab.lines[0] - a.tab.lines[0])
  return systems
}

function barlineXs(vert: VSeg[], staff: Staff): number[] {
  const top = staff.lines[0]
  const bot = staff.lines[staff.lines.length - 1]
  const xs: number[] = []
  for (const v of vert) {
    if (v.x < staff.x1 - 4 || v.x > staff.x2 + 4) continue
    const overlap = Math.min(v.y2, top + 2) - Math.max(v.y1, bot - 2)
    if (overlap > 10) xs.push(v.x)
  }
  xs.sort((a, b) => a - b)
  const clustered: number[] = []
  for (const x of xs) {
    if (clustered.length === 0 || x - clustered[clustered.length - 1] > 2) clustered.push(x)
  }
  if (clustered.length === 0 || clustered[0] > staff.x1 + 8) clustered.unshift(staff.x1)
  if (clustered[clustered.length - 1] < staff.x2 - 8) clustered.push(staff.x2)
  return clustered
}

function nearestLine(yCenter: number, lines: number[]): { index: number; dist: number } {
  let best = 0
  let dist = Infinity
  lines.forEach((ly, i) => {
    const d = Math.abs(ly - yCenter)
    if (d < dist) {
      dist = d
      best = i
    }
  })
  return { index: best, dist }
}

function detectTuning(items: TextItem[]): { tuning: string; label: string } {
  const text = items.map(i => i.str).join(' ')
  if (/drop(?:ped)?\s*d/i.test(text) || /=\s*D\b/.test(text)) {
    return { tuning: 'D1 A1 D2 G2', label: 'ドロップD' }
  }
  if (/drop\s*c/i.test(text)) return { tuning: 'C1 G1 C2 F2', label: 'ドロップC' }
  if (/standard/i.test(text)) return { tuning: 'E1 A1 D2 G2', label: 'スタンダード' }
  return { tuning: 'E1 A1 D2 G2', label: 'スタンダード' }
}

function detectTempo(items: TextItem[]): number {
  for (const it of items) {
    const m = it.str.match(/=\s*(\d{2,3})/)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n >= 40 && n <= 280) return n
    }
  }
  const joined = items.map(i => i.str).join('')
  const m = joined.match(/=(\d{2,3})/)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n >= 40 && n <= 280) return n
  }
  return 120
}

function detectTimeSignature(items: TextItem[], firstNotation: Staff | undefined): { beats: number; beatType: number } {
  if (!firstNotation) return { beats: 4, beatType: 4 }
  const top = firstNotation.lines[0]
  const bot = firstNotation.lines[firstNotation.lines.length - 1]
  const sigs = items
    .filter(it => {
      const c = cp(it.str)
      return it.str.length === 1 && c >= TIMESIG_0 && c <= TIMESIG_0 + 9 && it.y < top + 8 && it.y > bot - 8
    })
    .sort((a, b) => b.y - a.y)
  if (sigs.length >= 2) {
    return { beats: cp(sigs[0].str) - TIMESIG_0, beatType: cp(sigs[1].str) - TIMESIG_0 }
  }
  return { beats: 4, beatType: 4 }
}

interface RawBeat {
  x: number
  duration: number
  rest: boolean
  dead: boolean
}

function notationBeats(
  items: TextItem[],
  beams: HSeg[],
  system: System,
  x1: number,
  x2: number,
): RawBeat[] {
  const top = system.notation.lines[0]
  const bot = system.notation.lines[system.notation.lines.length - 1]
  const inBand = (it: TextItem) => it.y < top + 22 && it.y > bot - 16 && it.x >= x1 - 2 && it.x < x2 - 1
  const heads = items.filter(it => {
    if (!inBand(it) || it.str.length !== 1) return false
    const c = cp(it.str)
    return c === NOTEHEAD_BLACK || c === NOTEHEAD_HALF || c === NOTEHEAD_WHOLE || c === NOTEHEAD_X
  })
  const rests = items.filter(it => {
    if (!inBand(it) || it.str.length !== 1) return false
    const c = cp(it.str)
    return c >= REST_WHOLE && c <= REST_32
  })
  const flags = items.filter(it => {
    if (it.str.length !== 1) return false
    const c = cp(it.str)
    return c >= FLAG_8_UP && c <= FLAG_32_DOWN && it.x >= x1 - 4 && it.x < x2 + 4 && it.y < top + 28 && it.y > bot - 20
  })
  const dots = items.filter(it => cp(it.str) === AUG_DOT && it.x >= x1 && it.x < x2 + 6 && it.y < top + 16 && it.y > bot - 12)

  const width = x2 - x1
  const localBeams = beams.filter(b => {
    if (b.y > top + 16 || b.y < bot - 10) return false
    // 譜線そのものは連桁に数えない。連桁の端が譜線に重なる場合は、もう一方の端が譜線の外にある
    if (system.notation.lines.some(ly => Math.abs(ly - b.y) < 0.85)) return false
    const a = Math.max(b.x1, x1)
    const b2 = Math.min(b.x2, x2)
    const len = b2 - a
    // 7pt 前後は加線。連桁はもう少し長い
    return len >= 11 && len < width * 0.72
  })

  // 1本の連桁の上下端をまとめる
  const levels: HSeg[][] = []
  const sortedBeams = [...localBeams].sort((a, b) => b.y - a.y)
  for (const b of sortedBeams) {
    const hit = levels.find(level => Math.abs(level[0].y - b.y) < 2.6 && level.some(s => Math.min(s.x2, b.x2) - Math.max(s.x1, b.x1) > -4))
    if (hit) hit.push(b)
    else levels.push([b])
  }

  const beamCountAt = (x: number, y: number): number => {
    let n = 0
    for (const level of levels) {
      const covers = level.some(s => {
        const dy = Math.abs(s.y - y)
        // 加線は符頭と同じ高さ。連桁は符頭から離れている
        return x >= s.x1 - 8 && x <= s.x2 + 6 && dy > 4 && dy < 32
      })
      if (covers) n++
    }
    return n
  }

  const flagDur = (head: TextItem): number | null => {
    const flag = flags
      .filter(f => f.x >= head.x - 3 && f.x - head.x < 14 && Math.abs(f.y - head.y) < 22)
      .sort((a, b) => Math.abs(a.x - head.x) - Math.abs(b.x - head.x))[0]
    if (!flag) return null
    const c = cp(flag.str)
    if (c === FLAG_8_UP || c === FLAG_8_DOWN) return 0.5
    if (c === FLAG_16_UP || c === FLAG_16_DOWN) return 0.25
    if (c === FLAG_32_UP || c === FLAG_32_DOWN) return 0.125
    return null
  }

  const hasDot = (head: TextItem) =>
    dots.some(d => d.x > head.x - 1 && d.x - head.x < 14 && Math.abs(d.y - head.y) < 10)

  // 同じXの符頭は和音
  const groups: TextItem[][] = []
  const sortedHeads = [...heads].sort((a, b) => a.x - b.x)
  for (const h of sortedHeads) {
    const g = groups.find(g => Math.abs(g[0].x - h.x) < 4.5)
    if (g) g.push(h)
    else groups.push([h])
  }

  const beats: RawBeat[] = []
  for (const g of groups) {
    const head = g[0]
    const c = cp(head.str)
    let dur = 1
    if (c === NOTEHEAD_WHOLE) dur = 4
    else if (c === NOTEHEAD_HALF) dur = 2
    else {
      const beamsN = Math.max(...g.map(h => beamCountAt(h.x + h.w * 0.5, h.y)))
      if (beamsN >= 3) dur = 0.125
      else if (beamsN === 2) dur = 0.25
      else if (beamsN === 1) dur = 0.5
      else dur = flagDur(head) ?? 1
    }
    if (hasDot(head)) dur *= 1.5
    beats.push({
      x: head.x,
      duration: dur,
      rest: false,
      dead: g.some(h => cp(h.str) === NOTEHEAD_X),
    })
  }

  for (const r of rests) {
    const c = cp(r.str)
    const map: Record<number, number> = {
      [REST_WHOLE]: 4,
      [REST_HALF]: 2,
      [REST_QUARTER]: 1,
      [REST_8]: 0.5,
      [REST_16]: 0.25,
      [REST_32]: 0.125,
    }
    let dur = map[c] ?? 1
    if (hasDot(r)) dur *= 1.5
    // 全休符は小節の長さに合わせる（呼び出し側で調整）
    beats.push({ x: r.x, duration: dur, rest: true, dead: false })
  }

  beats.sort((a, b) => a.x - b.x)
  return beats
}

function fretsInMeasure(items: TextItem[], tab: Staff, x1: number, x2: number): Array<{ x: number; string: number; fret: number; dead: boolean; w: number }> {
  const spacing = tab.lines[0] - tab.lines[1]
  const out: Array<{ x: number; string: number; fret: number; dead: boolean; w: number }> = []
  for (const it of items) {
    const raw = it.str.trim()
    if (!/^(\d{1,2}|x)$/i.test(raw)) continue
    if (it.x < x1 - 1 || it.x > x2 - 1) continue
    const centerY = it.y + it.h * 0.42
    const { index, dist } = nearestLine(centerY, tab.lines)
    if (dist > spacing * 0.48) continue
    // alphaTab: 1 = 一番下の線
    const string = tab.lines.length - index
    const dead = /^x$/i.test(raw)
    out.push({ x: it.x + it.w / 2, string, fret: dead ? 0 : parseInt(raw, 10), dead, w: it.w })
  }
  return out
}

function techniqueMarks(items: TextItem[], system: System, x1: number, x2: number): Array<{ x: number; kind: 'h' | 'sl' }> {
  const top = system.tab.lines[0]
  const bot = system.notation.lines[system.notation.lines.length - 1]
  const marks: Array<{ x: number; kind: 'h' | 'sl' }> = []
  for (const it of items) {
    if (it.y < top - 4 || it.y > bot + 2) continue
    if (it.x < x1 - 6 || it.x > x2 + 8) continue
    const s = it.str.trim()
    if (/^h$/i.test(s)) marks.push({ x: it.x, kind: 'h' })
    else if (/^sl\.?$/i.test(s) || /^s$/i.test(s)) marks.push({ x: it.x, kind: 'sl' })
  }
  return marks
}

function expectedQuarters(ts: { beats: number; beatType: number }): number {
  return ts.beats * (4 / ts.beatType)
}

function trimToBar(beats: GpBeat[], expected: number): GpBeat[] {
  const out = beats.map(b => ({ ...b, notes: b.notes }))
  let guard = 0
  while (guard++ < 8) {
    const sum = out.reduce((s, b) => s + b.duration, 0)
    const overflow = sum - expected
    if (overflow <= 0.12) break
    const restIdx = out.findIndex(b => b.notes.length === 0 && b.duration <= overflow + 0.05)
    if (restIdx < 0) break
    out.splice(restIdx, 1)
  }
  return out
}

function fillToBar(beats: GpBeat[], expected: number): GpBeat[] {
  const sum = beats.reduce((s, b) => s + b.duration, 0)
  const diff = expected - sum
  if (Math.abs(diff) < 0.05) return beats
  if (diff > 0.2 && diff <= expected) {
    // 足りない分が一般的な休符なら足す
    const rest = snapDuration(diff)
    if (rest && Math.abs(rest - diff) < 0.08) return [...beats, { duration: rest, notes: [] }]
  }
  if (diff < -0.2 && beats.length && beats[beats.length - 1].notes.length === 0) {
    const trimmed = beats.slice(0, -1)
    const s2 = trimmed.reduce((s, b) => s + b.duration, 0)
    if (Math.abs(s2 - expected) < Math.abs(sum - expected)) return fillToBar(trimmed, expected)
  }
  return beats
}

function snapDuration(q: number): number | null {
  const options = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.375, 0.25, 0.125]
  let best: number | null = null
  let err = 0.08
  for (const o of options) {
    const e = Math.abs(o - q)
    if (e < err) {
      err = e
      best = o
    }
  }
  return best
}

function equalFallback(groups: Array<{ notes: GpNote[] }>, expected: number): GpBeat[] {
  const n = Math.max(1, groups.length)
  const options = [4, 2, 1, 0.5, 0.25, 0.125]
  let best = options[0]
  let err = Infinity
  for (const o of options) {
    const e = Math.abs(n * o - expected)
    if (e < err) {
      err = e
      best = o
    }
  }
  const beats: GpBeat[] = groups.map(g => ({ duration: best, notes: g.notes }))
  return fillToBar(beats, expected)
}

function buildMeasure(
  items: TextItem[],
  beams: HSeg[],
  system: System,
  x1: number,
  x2: number,
  ts: { beats: number; beatType: number },
): GpMeasure {
  const expected = expectedQuarters(ts)
  const raw = notationBeats(items, beams, system, x1, x2)
  const frets = fretsInMeasure(items, system.tab, x1, x2)
  const marks = techniqueMarks(items, system, x1, x2)

  // フレットをXでまとめる（和音）
  const fretGroups: Array<{ x: number; notes: GpNote[] }> = []
  for (const f of [...frets].sort((a, b) => a.x - b.x)) {
    const g = fretGroups.find(g => Math.abs(g.x - f.x) < 4.2)
    if (g) g.notes.push({ string: f.string, fret: f.fret, dead: f.dead })
    else fretGroups.push({ x: f.x, notes: [{ string: f.string, fret: f.fret, dead: f.dead }] })
  }

  const used = new Set<number>()
  const beats: GpBeat[] = []

  if (raw.length === 0 && fretGroups.length === 0) {
    return { beats: [{ duration: expected, notes: [] }], timeSignature: ts }
  }

  // 記譜の拍にフレットを対応させる
  const events: Array<{ x: number; duration: number; rest: boolean; notes: GpNote[]; dead: boolean }> = []
  for (const b of raw) {
    if (b.rest) {
      events.push({ x: b.x, duration: b.duration, rest: true, notes: [], dead: false })
      continue
    }
    let best = -1
    let bestD = 9
    fretGroups.forEach((g, i) => {
      if (used.has(i)) return
      const d = Math.abs(g.x - (b.x + 2))
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    if (best >= 0) {
      used.add(best)
      const notes = fretGroups[best].notes.map(n => ({ ...n, dead: n.dead || b.dead }))
      events.push({ x: b.x, duration: b.duration, rest: false, notes, dead: b.dead })
    } else if (!b.rest) {
      // 符頭だけでフレットが無い → 休符扱いにしない（タブ側の取りこぼし）。スキップして後で未使用フレットを足す
    }
  }
  fretGroups.forEach((g, i) => {
    if (used.has(i)) return
    const prev = [...events].reverse().find(e => e.x <= g.x)
    events.push({
      x: g.x,
      duration: prev?.duration ?? 0.5,
      rest: false,
      notes: g.notes,
      dead: false,
    })
  })
  events.sort((a, b) => a.x - b.x)

  // 全休符だけの小節
  if (frets.length === 0 && raw.length === 1 && raw[0].rest && raw[0].duration >= 2) {
    return { beats: [{ duration: expected, notes: [] }], timeSignature: ts }
  }

  for (const e of events) {
    if (e.rest) beats.push({ duration: e.duration, notes: [], x: e.x })
    else if (e.notes.length) beats.push({ duration: e.duration, notes: e.notes, x: e.x })
  }

  applyTechniques(beats, marks)

  const trimmed = trimToBar(beats, expected)
  const sum = trimmed.reduce((s, b) => s + b.duration, 0)
  const noted = trimmed.filter(b => b.notes.length)
  const beamed = noted.filter(b => b.duration <= 0.5).length
  const rhythmKnown = noted.length > 0 && beamed / noted.length >= 0.45
  let finalBeats = trimmed
  if (trimmed.length === 0) {
    finalBeats = [{ duration: expected, notes: [] }]
  } else if (!rhythmKnown && Math.abs(sum - expected) / expected > 0.34) {
    const kept = beats.filter(b => b.notes.length)
    finalBeats = equalFallback(
      kept.map(b => ({ notes: b.notes })),
      expected,
    )
  } else {
    finalBeats = fillToBar(beats, expected)
  }

  return { beats: finalBeats, timeSignature: ts }
}

function applyTechniques(beats: GpBeat[], marks: Array<{ x: number; kind: 'h' | 'sl' }>) {
  const sequenced: Array<{ note: GpNote; x: number }> = []
  for (const b of beats) {
    if (b.x == null) continue
    for (const n of b.notes) sequenced.push({ note: n, x: b.x })
  }
  for (const mark of marks) {
    let best: { left: (typeof sequenced)[0]; gap: number } | null = null
    for (let i = 0; i < sequenced.length; i++) {
      const left = sequenced[i]
      const right = sequenced.slice(i + 1).find(c => c.note.string === left.note.string)
      if (right) {
        if (mark.x >= left.x - 8 && mark.x <= right.x + 10) {
          const gap = right.x - left.x
          if (!best || gap < best.gap) best = { left, gap }
        }
      } else if (mark.kind === 'sl' && mark.x >= left.x - 4) {
        const gap = mark.x - left.x
        if (gap < 28 && (!best || gap < best.gap)) best = { left, gap }
      }
    }
    if (!best) continue
    if (mark.kind === 'h') best.left.note.hammer = true
    else best.left.note.slide = true
  }
}

export async function parseGuitarProPdf(data: ArrayBuffer, filename?: string): Promise<GpScore | null> {
  if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs'
  }
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise
  const allItems: TextItem[] = []
  const pageSystems: Array<{ system: System; bars: number[]; items: TextItem[]; beams: HSeg[] }> = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const textContent = await page.getTextContent()
    const items: TextItem[] = []
    for (const raw of textContent.items) {
      if (!('str' in raw) || !raw.str) continue
      items.push({
        str: raw.str,
        x: raw.transform[4],
        y: raw.transform[5],
        w: raw.width,
        h: raw.height || 7,
      })
    }
    allItems.push(...items)
    const op = await page.getOperatorList()
    const geo = extractGeometry(op)
    const lines = clusterY(geo.horiz)
    const staves = findStaves(lines)
    const sys = pairSystems(staves)
    for (const system of sys) {
      const bars = barlineXs(geo.vert, system.tab)
      pageSystems.push({ system, bars, items, beams: geo.horiz })
    }
  }

  if (pageSystems.length === 0) return null

  const tuning = detectTuning(allItems)
  const tempo = detectTempo(allItems)
  const ts = detectTimeSignature(allItems, pageSystems[0].system.notation)
  const measures: GpMeasure[] = []

  for (const ps of pageSystems) {
    for (let i = 0; i < ps.bars.length - 1; i++) {
      const x1 = ps.bars[i]
      const x2 = ps.bars[i + 1]
      if (x2 - x1 < 12) continue
      measures.push(buildMeasure(ps.items, ps.beams, ps.system, x1, x2, ts))
    }
  }

  if (measures.length === 0) return null

  const title = filename?.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim()

  return {
    measures,
    tempo,
    title: title || undefined,
    tuning: tuning.tuning,
    tuningLabel: tuning.label,
  }
}
