import * as pdfjsLib from 'pdfjs-dist'
import { configurePdfjsWorker, pdfDocumentParams } from './pdfjsConfig'
import { parseTuningText } from './tuningText'

/**
 * Guitar Pro / Songsterr 系のテキストPDF（標準記譜＋4〜6線タブ）を読む。
 * 弦の割り当てはタブの譜線Y座標、小節は小節線、音価は符頭・連桁・旗・休符から取る。
 * alphaTab の弦番号は 1 が一番低い弦（タブの一番下）。
 */

const NOTEHEAD_BLACK = 0xe0a4
const NOTEHEAD_HALF = 0xe0a3
const NOTEHEAD_WHOLE = 0xe0a2
const NOTEHEAD_X = 0xe0a9
const REST_RECT = 0xf0000
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
  /** 前の同じ音からのタイ */
  tie?: boolean
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
  /** PDF上の小節番号。譜面の上に印字されていれば入る */
  number?: number
}

export interface GpScore {
  measures: GpMeasure[]
  tempo: number
  title?: string
  tuning: string
  tuningLabel: string
}

interface TextItem {
  tabDigit?: boolean
  restBounds?: { bottom: number; top: number }
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

/** 連桁の片側の辺。Guitar Pro は少し傾いた細い矩形で描く */
interface BeamEdge {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** 対になった連桁。y1/y2 は左端・右端の中心線 */
interface Beam {
  bracket?: boolean
  singleStroke?: boolean
  x1: number
  y1: number
  x2: number
  y2: number
}

interface VSeg {
  x: number
  y1: number
  y2: number
}

interface Curve {
  x1: number
  x2: number
  y: number
}

interface Dot {
  x: number
  y: number
}

export interface Staff {
  lines: number[] // top → bottom
  kind: 'tab' | 'notation'
  x1: number
  x2: number
}

export interface System {
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

export function extractGeometry(op: { fnArray: number[]; argsArray: unknown[] }, scale = 1): {
  horiz: HSeg[]
  vert: VSeg[]
  curves: Curve[]
  dots: Dot[]
  beamEdges: BeamEdge[]
  glyphs: TextItem[]
} {
  const OPS = pdfjsLib.OPS
  let ctm = [1 / scale, 0, 0, 1 / scale, 0, 0]
  const stack: number[][] = []
  const horiz: HSeg[] = []
  const vert: VSeg[] = []
  const curves: Curve[] = []
  const dots: Dot[] = []
  const beamEdges: BeamEdge[] = []
  const glyphs: TextItem[] = []

  const pushSeg = (x1: number, y1: number, x2: number, y2: number) => {
    const [px1, py1] = applyPt(ctm, x1, y1)
    const [px2, py2] = applyPt(ctm, x2, y2)
    const dx = Math.abs(px2 - px1)
    const dy = Math.abs(py2 - py1)
    if (dy < 1.3 && dx > 4) {
      horiz.push({ y: (py1 + py2) / 2, x1: Math.min(px1, px2), x2: Math.max(px1, px2) })
    }
    if (dx < 1.6 && dy > 8) {
      vert.push({ x: (px1 + px2) / 2, y1: Math.min(py1, py2), y2: Math.max(py1, py2) })
    }
    // 連桁は水平とは限らない。符幹より十分寝ていて、譜線より短いものだけ候補にする
    if (dx >= 3 && dx <= 200 && dy <= dx * 3 && dy < 40) {
      const left = px1 <= px2
      beamEdges.push({
        x1: left ? px1 : px2,
        y1: left ? py1 : py2,
        x2: left ? px2 : px1,
        y2: left ? py2 : py1,
      })
    }
  }

  const considerDot = (pts: Array<[number, number]>) => {
    if (pts.length < 3) return
    const xs = pts.map(p => p[0])
    const ys = pts.map(p => p[1])
    const w = Math.max(...xs) - Math.min(...xs)
    const h = Math.max(...ys) - Math.min(...ys)
    if (w >= 1.2 && w <= 2.8 && h >= 1.0 && h <= 2.8) {
      dots.push({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 })
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
      let sub: Array<[number, number]> = []
      let controls: Array<[number, number]> = []
      let cubics = 0
      let straight = 0
      const pathPoints: Array<[number, number]> = []
      let pathCubics = 0
      let pathStraight = 0
      let subpaths = 0
      const contours: Array<{ x: number; y: number; w: number; h: number }> = []
      const flush = (closed = false) => {
        considerDot(sub)
        pathPoints.push(...controls)
        if ([4, 6, 8, 10].includes(cubics) && straight === 0 && controls.length) {
          const xs = controls.map(p => p[0]), ys = controls.map(p => p[1])
          const x = Math.min(...xs), y = Math.min(...ys)
          const w = Math.max(...xs) - x, h = Math.max(...ys) - y
          // Printed music fonts may be outlines rather than text. An oval
          // notehead has four cubic sides; retain its inner contour as a hole.
          if (w > 0 && w <= 9 && h > 0 && h <= 5.5 && (closed || (w >= 3 && h >= 1.5))) contours.push({ x, y, w, h })
        }
        sub = []
        controls = []
        cubics = 0
        straight = 0
      }
      for (const o of ops) {
        if (o === 13) {
          subpaths++
          flush()
          cx = coords[k++]
          cy = coords[k++]
          sub.push(applyPt(ctm, cx, cy))
          controls.push(applyPt(ctm, cx, cy))
        } else if (o === 14) {
          straight++
          pathStraight++
          const x2 = coords[k++]
          const y2 = coords[k++]
          pushSeg(cx, cy, x2, y2)
          cx = x2
          cy = y2
          sub.push(applyPt(ctm, cx, cy))
          controls.push(applyPt(ctm, cx, cy))
        } else if (o === 15) {
          cubics++
          pathCubics++
          controls.push(applyPt(ctm, coords[k], coords[k + 1]), applyPt(ctm, coords[k + 2], coords[k + 3]))
          k += 4
          const x3 = coords[k++]
          const y3 = coords[k++]
          const [px, py] = applyPt(ctm, cx, cy)
          const [qx, qy] = applyPt(ctm, x3, y3)
          const dx = Math.abs(qx - px)
          const dy = Math.abs(qy - py)
          if (dx > 7 && dy < 7) curves.push({ x1: Math.min(px, qx), x2: Math.max(px, qx), y: (py + qy) / 2 })
          cx = x3
          cy = y3
          sub.push([qx, qy])
          controls.push([qx, qy])
        } else if (o === 16 || o === 17) {
          k += 2
          cx = coords[k++]
          cy = coords[k++]
          sub.push(applyPt(ctm, cx, cy))
        } else if (o === 18) {
          flush(true)
        } else if (o === 19) {
          const x = coords[k++]
          const y = coords[k++]
          const w = coords[k++]
          const h = coords[k++]
          pushSeg(x, y, x + w, y)
          pushSeg(x, y + h, x + w, y + h)
          pushSeg(x, y, x, y + h)
          pushSeg(x + w, y, x + w, y + h)
          const p1 = applyPt(ctm, x, y)
          const p2 = applyPt(ctm, x + w, y + h)
          considerDot([p1, p2, [p1[0], p2[1]], [p2[0], p1[1]]])
        }
      }
      flush()
      if (pathPoints.length) {
        const xs = pathPoints.map(p => p[0]), ys = pathPoints.map(p => p[1])
        const x = Math.min(...xs), y = Math.min(...ys)
        const w = Math.max(...xs) - x, h = Math.max(...ys) - y
        let code = 0
        // Rounded rectangular rests, zigzag quarter rests, hooked rests and
        // flags have distinct contour complexity and staff-relative bounds.
        if (pathStraight === 4 && pathCubics === 4 && w >= 4 && w <= 6 && h >= 1.5 && h < 3) code = REST_RECT
        else if (w >= 3 && w <= 7 && h >= 6 && h <= 18) {
          if (pathCubics >= 25 && pathStraight === 0 && h / w > 2.5) code = REST_QUARTER
          else if (pathCubics >= 15 && pathStraight <= 3) code = pathCubics < 25 ? REST_8 : pathCubics < 40 ? REST_16 : REST_32
          else if (pathCubics >= 8 && pathCubics < 15 && pathStraight <= 2 && h > 11) code = FLAG_8_UP
        }
        if (subpaths !== 1) {
          code = subpaths === 2 && pathCubics >= 24 && pathCubics <= 30 && pathStraight === 4 &&
            w >= 3 && w <= 6 && h >= 11 && h <= 18 ? FLAG_16_UP : 0
        }
        if (code) glyphs.push({ str: String.fromCodePoint(code), x, y: y + h / 2 - 1.6, w, h: 17, ...(code === REST_RECT ? { restBounds: { bottom: y, top: y + h } } : {}) })
      }
      for (const c of contours) {
        if (c.w < 3 || c.h < 1.5) continue
        if (contours.some(o => o !== c && o.x <= c.x && o.y <= c.y && o.w > c.w && o.h > c.h)) continue
        const hollow = contours.some(o => o !== c && o.x > c.x && o.x + o.w < c.x + c.w && o.y >= c.y && o.y + o.h <= c.y + c.h)
        glyphs.push({ str: String.fromCodePoint(hollow ? (c.w > 6 ? NOTEHEAD_WHOLE : NOTEHEAD_HALF) : NOTEHEAD_BLACK), x: c.x, y: c.y + c.h / 2 - 1.6, w: c.w, h: 17 })
      }
    }
  }
  // Oval noteheads must not also act as augmentation dots.
  const dotMarks = dots.filter(d => !glyphs.some(h =>
    Math.abs(d.x - h.x - h.w / 2) < 0.1 && Math.abs(d.y - h.y - 1.6) < 0.1))
  return { horiz, vert, curves, dots: dotMarks, beamEdges, glyphs }
}

/**
 * 連桁は太さ約 2.1pt の塗り矩形。辺を組にして 1 本と数える。
 * 隣の連桁とのすき間は約 1pt なので、太さ 2.1 に一番近い相手を選ぶ。
 */
export function pairBeamEdges(edges: BeamEdge[], stems: VSeg[] = []): Beam[] {
  const slope = (e: BeamEdge) => (e.y2 - e.y1) / (e.x2 - e.x1 || 1)
  const partner = new Array<number>(edges.length).fill(-1)
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i]
    const as = slope(a)
    const alen = a.x2 - a.x1
    let best = -1
    let bestScore = 0.9
    for (let j = 0; j < edges.length; j++) {
      if (i === j) continue
      const b = edges[j]
      const overlap = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)
      if (overlap < alen * 0.75 || overlap < (b.x2 - b.x1) * 0.75) continue
      if (Math.abs(as - slope(b)) > 0.05) continue
      const dy = Math.abs(a.y1 + a.y2 - (b.y1 + b.y2)) / 2
      if (dy < 1.15 || dy > 2.85) continue
      const score = Math.abs(dy - 2.13)
      if (score < bestScore) {
        bestScore = score
        best = j
      }
    }
    partner[i] = best
  }
  const beams: Beam[] = []
  const used = new Set<number>()
  for (let i = 0; i < edges.length; i++) {
    const j = partner[i]
    if (j < 0 || partner[j] !== i || i > j || used.has(i)) continue
    used.add(i)
    used.add(j)
    const a = edges[i]
    const b = edges[j]
    beams.push({
      x1: (a.x1 + b.x1) / 2,
      y1: (a.y1 + b.y1) / 2,
      x2: (a.x2 + b.x2) / 2,
      y2: (a.y2 + b.y2) / 2,
    })
  }
  // A single stroked beam must meet stem tips; detached rules are brackets.
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]
    if (used.has(i) || partner[i] >= 0 || e.x2 - e.x1 < 4 || e.x2 - e.x1 > 100) continue
    // Extra outlines of a filled beam are not an additional beam level.
    if (beams.some(b => !b.bracket && Math.abs(slope(b) - slope(e)) < 0.05 &&
      Math.min(b.x2, e.x2) - Math.max(b.x1, e.x1) >= (e.x2 - e.x1) * 0.75 &&
      Math.abs(beamYAt(b, (e.x1 + e.x2) / 2) - (e.y1 + e.y2) / 2) < 2.85)) continue
    if (Math.abs(slope(e)) > 0.4) { beams.push({ ...e, bracket: true }); continue }
    const attached = stems.filter(v => (e.x2 - e.x1 > 12 || Math.min(Math.abs(v.x - e.x1), Math.abs(v.x - e.x2)) < 0.8) && v.y2 - v.y1 >= 8 && v.x >= e.x1 - 3.5 && v.x <= e.x2 + 3.5 &&
      Math.min(Math.abs(v.y1 - beamYAt(e, v.x)), Math.abs(v.y2 - beamYAt(e, v.x))) < 3.5)
    const tips = new Set(attached.map(v => Math.round(v.x)))
    beams.push({ ...e, singleStroke: true, bracket: !(tips.size >= 2 || (e.x2 - e.x1 <= 12 && tips.size >= 1)) })
  }
  // Stroked inner levels can lie well below the stem tip. Grow each stack
  // from an attached level, checking the stem extents as well as parallelism.
  let promoted = true
  while (promoted) {
    promoted = false
    for (const b of beams) {
      if (!b.singleStroke || !b.bracket || Math.abs(slope(b)) > 0.4) continue
      const supporting = stems.filter(v => v.y2 - v.y1 >= 8 &&
        v.x >= b.x1 - 3.5 && v.x <= b.x2 + 3.5 &&
        (b.x2 - b.x1 > 12 || Math.min(Math.abs(v.x - b.x1), Math.abs(v.x - b.x2)) < 0.8) &&
        beamYAt(b, v.x) >= v.y1 - 3.5 && beamYAt(b, v.x) <= v.y2 + 3.5)
      if (new Set(supporting.map(v => Math.round(v.x))).size < (b.x2 - b.x1 <= 12 ? 1 : 2)) continue
      if (!beams.some(a => !a.bracket && Math.abs(slope(a) - slope(b)) < 0.05 &&
        supporting.every(v => v.x >= a.x1 - 3.5 && v.x <= a.x2 + 3.5 &&
          Math.abs(beamYAt(a, v.x) - beamYAt(b, v.x)) >= 2.85 &&
          Math.abs(beamYAt(a, v.x) - beamYAt(b, v.x)) <= 3.5))) continue
      b.bracket = false
      promoted = true
    }
  }
  return beams
}

export function clusterY(segs: HSeg[], pageH: number, staffOnly = false): Array<{ y: number; x1: number; x2: number }> {
  const sorted = [...segs].sort((a, b) => b.y - a.y)
  const clusters: Array<{ y: number; x1: number; x2: number; n: number; len: number }> = []
  for (const s of sorted) {
    let c = clusters.find(c => Math.abs(c.y - s.y) < 0.8)
    if (!c) {
      c = { y: s.y, x1: s.x1, x2: s.x2, n: 0, len: 0 }
      clusters.push(c)
    }
    c.n++
    c.y = staffOnly
      ? (c.y * c.len + s.y * (s.x2 - s.x1)) / (c.len + s.x2 - s.x1)
      : (c.y * (c.n - 1) + s.y) / c.n
    c.x1 = Math.min(c.x1, s.x1)
    c.x2 = Math.max(c.x2, s.x2)
    c.len += s.x2 - s.x1
  }
  // フレットで途切れた譜線や、曲末の短い段も残す。ページ枠は除く
  return clusters.filter(c => {
    if (c.y < 8 || c.y > pageH - 8) return false
    const span = c.x2 - c.x1
    const supported = [[-1, 1], [-1, -2], [1, 2]].some(offsets => offsets.every(offset => clusters.some(other =>
      Math.abs(other.y - c.y - offset * 6.4) < 0.8 &&
      Math.abs(other.x1 - c.x1) < 6 && Math.abs(other.x2 - c.x2) < 6 &&
      other.len >= (other.x2 - other.x1) * 0.25)))
    return span >= 70 && c.len >= 36 && (!staffOnly || c.len >= span * 0.25 || supported)
  })
}

/** Remove short beam/ledger clusters before estimating a non-native page size. */
export function pageStaffScale(lines: HSeg[]): number {
  const wide = lines.filter(l => {
    const widest = Math.max(...lines.filter(o => Math.abs(o.y - l.y) < 45).map(o => o.x2 - o.x1))
    return l.x2 - l.x1 >= widest * 0.95
  })
  const scale = staffScale(wide)
  if (scale !== 1) return scale
  // A TAB-only print has no five-line staff to use as a reference.
  const gaps: number[] = []
  const sorted = [...wide].sort((a, b) => b.y - a.y)
  for (let i = 0; i + 3 < sorted.length; i++) {
    const run = sorted.slice(i, i + 4)
    const gap = (run[0].y - run[3].y) / 3
    if (gap <= 8.5 || gap > 16) continue
    if (run.some((l, j) => j > 0 && Math.abs(run[j - 1].y - l.y - gap) > gap * 0.1)) continue
    if (run.some(l => Math.abs(l.x1 - run[0].x1) > 6 && Math.abs(l.x2 - run[0].x2) > 6)) continue
    gaps.push(gap / 6.4)
  }
  return gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 1
}

// 五線と直下のタブの間隔比からページ倍率を求める
export function staffScale(lines: Array<{ y: number; x1: number; x2: number }>): number {
  const sorted = [...lines].sort((a, b) => b.y - a.y)
  const recorded: number[] = []
  for (let i = 0; i + 5 <= sorted.length; i++) {
    const group = sorted.slice(i, i + 5)
    const ref = group[0]
    if (group.some(l => Math.abs(l.x1 - ref.x1) > 6 || Math.abs(l.x2 - ref.x2) > 6)) continue
    const gaps = group.slice(1).map((l, j) => group[j].y - l.y)
    const gN = gaps.reduce((sum, gap) => sum + gap, 0) / 4
    if (gN < 3.4 || gN > 8.5 || gaps.some(gap => Math.abs(gap - gN) > gN * 0.1)) continue
    // 両端が異なる連桁などは飛ばす
    const below = sorted.slice(i + 5).filter(l =>
      Math.abs(l.x1 - ref.x1) <= 6 || Math.abs(l.x2 - ref.x2) <= 6)
    if (below.length < 4) continue
    const distance = group[4].y - below[0].y
    if (distance < 2 * gN || distance > 12 * gN) continue
    const gT = below[0].y - below[1].y
    if (gT / gN < 1.3 || gT / gN > 1.8) continue
    let count = 2
    while (count < below.length) {
      const gap = below[count - 1].y - below[count].y
      if (Math.abs(gap - gT) > gT * 0.1) break
      count++
    }
    if (count >= 4) recorded.push(gN)
  }
  if (recorded.length === 0) return 1
  recorded.sort((a, b) => a - b)
  const mid = Math.floor(recorded.length / 2)
  const median = recorded.length % 2 ? recorded[mid] : (recorded[mid - 1] + recorded[mid]) / 2
  const k = median / 4.25
  return Math.abs(k - 1) < 0.15 ? 1 : Math.max(0.5, Math.min(2.5, k))
}

export function findStaves(lines: Array<{ y: number; x1: number; x2: number }>, scale = staffScale(lines)): Staff[] {
  // 同じ高さ帯に段いっぱいの譜線があるとき、1小節分の連桁は捨てる
  const filtered = lines.filter(line => {
    const span = line.x2 - line.x1
    const neighbors = lines.filter(o => Math.abs(o.y - line.y) < 28 * scale)
    const widest = Math.max(...neighbors.map(o => o.x2 - o.x1))
    return span >= widest * 0.72
  })
  const sorted = [...filtered].sort((a, b) => b.y - a.y)
  const staves: Staff[] = []
  const used = new Set<number>()

  const take = (start: number, count: number, minGap: number, maxGap: number, kind: Staff['kind']) => {
    if (used.has(start)) return false
    const indices = [start]
    while (indices.length < count) {
      const last = indices[indices.length - 1]
      const next = sorted.findIndex((line, j) => j > last && !used.has(j) &&
        sorted[last].y - line.y >= minGap && sorted[last].y - line.y <= maxGap &&
        (Math.abs(line.x1 - sorted[start].x1) <= 6 || Math.abs(line.x2 - sorted[start].x2) <= 6))
      if (next < 0) return false
      indices.push(next)
    }
    const group = indices.map(i => sorted[i])
    const gaps: number[] = []
    for (let i = 1; i < group.length; i++) gaps.push(group[i - 1].y - group[i].y)
    if (!gaps.every(g => g >= minGap && g <= maxGap)) return false
    const x1 = Math.max(...group.map(g => g.x1))
    const x2 = Math.min(...group.map(g => g.x2))
    if (x2 - x1 < 60) return false
    // 連桁は1小節分で、段の譜線より短い。譜線同士はほぼ同じ幅
    const spans = group.map(g => g.x2 - g.x1)
    const widest = Math.max(...spans)
    if (spans.some(s => s < widest * 0.55)) return false
    staves.push({
      lines: group.map(g => g.y),
      kind,
      x1: Math.min(...group.map(g => g.x1)),
      x2: Math.max(...group.map(g => g.x2)),
    })
    for (const i of indices) used.add(i)
    return true
  }

  // 端片方/両方 - 実際の譜線は左右端の少なくとも片方を共有する（もう一方は文字や図形に隠れることがある）。
  // 梁や括弧の迷線は両端とも異なるので弾ける
  const tryTabRun = (start: number) => {
    let last = start
    let firstGap = 0
    const ref = sorted[start]
    const idxs = [start]
    while (idxs.length < 6 && last + 1 < sorted.length) {
      const j = sorted.findIndex((line, i) => i > last && !used.has(i) &&
        sorted[last].y - line.y >= 5.4 * scale && sorted[last].y - line.y <= 7.6 * scale &&
        (Math.abs(line.x1 - ref.x1) <= 6 || Math.abs(line.x2 - ref.x2) <= 6))
      if (j < 0) break
      const gap = sorted[last].y - sorted[j].y
      if (gap < 5.4 * scale || gap > 7.6 * scale) break
      if (idxs.length >= 2 && Math.abs(gap - firstGap) > firstGap * 0.15) break
      if (Math.abs(sorted[j].x1 - ref.x1) > 6 && Math.abs(sorted[j].x2 - ref.x2) > 6) break
      if (idxs.length === 1) firstGap = gap
      idxs.push(j)
      last = j
    }
    if (idxs.length < 4) return
    const group = idxs.map(i2 => sorted[i2])
    const x1 = Math.max(...group.map(g => g.x1))
    const x2 = Math.min(...group.map(g => g.x2))
    if (x2 - x1 < 60) return
    const spans = group.map(g => g.x2 - g.x1)
    const widest = Math.max(...spans)
    if (spans.some(s => s < widest * 0.55)) return
    staves.push({
      lines: group.map(g => g.y),
      kind: 'tab',
      x1: Math.min(...group.map(g => g.x1)),
      x2: Math.max(...group.map(g => g.x2)),
    })
    for (const i2 of idxs) used.add(i2)
  }

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue
    // 五線は約4.2pt、タブは約6.4pt。連桁を混ぜないよう間隔を狭く見る
    if (take(i, 5, 3.4 * scale, 5.3 * scale, 'notation')) continue
    tryTabRun(i)
  }
  return staves
}

export function pairSystems(staves: Staff[]): System[] {
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

function verticalsOnStaff(vert: VSeg[], staff: Staff, strict = false): number[] {
  const top = staff.lines[0]
  const bot = staff.lines[staff.lines.length - 1]
  const need = (top - bot) * 0.62
  const xs: number[] = []
  for (const v of vert) {
    if (v.x < staff.x1 - 4 || v.x > staff.x2 + 8) continue
    const height = v.y2 - v.y1
    if (height > 60) continue
    // TAB rhythm stems can span most of the staff but extend above it.
    if (strict && (v.y2 > top + 2 || v.y1 < bot - 2 || height < (top - bot) * 0.9)) continue
    const overlap = Math.min(v.y2, top + 1.5) - Math.max(v.y1, bot - 1.5)
    if (overlap >= need) xs.push(v.x)
  }
  return xs
}

/** タブ譜を貫く縦線を小節線にする。符幹はタブまで届かない。 */
export function barlineXs(vert: VSeg[], _notation: Staff, tab: Staff, strict = false): number[] {
  const xs = verticalsOnStaff(vert, tab, strict)
  // A continuous connector into the paired notation staff is a barline,
  // even though its upper end lies above TAB rhythm stems.
  if (strict && _notation.kind === 'notation') {
    const tabBottom = Math.min(...tab.lines)
    const tabTop = Math.max(...tab.lines)
    const notationBottom = Math.min(..._notation.lines)
    const notationTop = Math.max(..._notation.lines)
    if (notationBottom > tabTop) {
      xs.push(...vert.filter(v => Math.abs(v.y1 - tabBottom) <= 2 &&
        v.y2 >= notationBottom && v.y2 <= notationTop + 2).map(v => v.x))
    }
  }
  xs.sort((a, b) => a - b)
  const clustered: number[] = []
  for (const x of xs) {
    if (clustered.length === 0 || x - clustered[clustered.length - 1] > 3.2) clustered.push(x)
  }
  const left = Math.min(_notation.x1, tab.x1)
  const right = Math.max(_notation.x2, tab.x2)
  if (clustered.length === 0 || clustered[0] > left + 10) clustered.unshift(left)
  if (clustered.length === 0 || clustered[clustered.length - 1] < right - 10) clustered.push(right)
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

/**
 * ヘッダー領域のテキスト項目を ', '= F' の式に組み立てる。
 * Guitar Pro の SMuFL 記号（弦番号円 Digital・臨時記号）を通常文字に置き換える。
 */
export function tuningHeaderText(items: Array<{ str: string }>): string {
  const parts: string[] = []
  for (const it of items) {
    let s = ''
    for (const ch of it.str) {
      const c = ch.codePointAt(0) ?? 0
      if (c >= 0xe834 && c <= 0xe839) s += ` (${c - 0xe833}) `  // 弦番号。U+E834 = 弦1（最高音）
      else if (c === 0xe260) s += ' b '
      else if (c === 0xe262) s += ' # '
      else if (c >= 0xe000 && c <= 0xf8ff) continue  // その他の私用領域の音楽グリフは捨てる
      else s += ch
    }
    parts.push(s)
  }
  return parts.join(' ')
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
  y: number
  duration: number
  rest: boolean
  dead: boolean
  /** high = 符尾・旗・休符グリフ。low = 符幹が見つからない符頭 */
  confidence: 'high' | 'mid' | 'low'
  tied?: boolean
}

function beamYAt(beam: Beam, x: number): number {
  const t = (x - beam.x1) / (beam.x2 - beam.x1 || 1)
  return beam.y1 + (beam.y2 - beam.y1) * t
}

function beamCountAt(
  beams: Beam[],
  staffLines: number[],
  stemX: number,
  stemTipY: number,
  stemBaseY: number,
): number {
  const dir = stemTipY >= stemBaseY ? 1 : -1
  // 符幹は譜線で切れ、連桁の手前で止まることがある
  const far = stemTipY + dir * 8
  const headLimit = stemBaseY + dir * 5
  const ys: number[] = []
  const attachedLevels = beams.filter(b => !b.bracket &&
    stemX >= b.x1 - 3.5 && stemX <= b.x2 + 3.5)
  const reachable = new Set(attachedLevels.filter(b => !b.singleStroke || Math.abs(beamYAt(b, stemX) - stemTipY) <= 4))
  let added = true
  while (added) {
    added = false
    for (const b of attachedLevels) {
      if (reachable.has(b)) continue
      if ([...reachable].some(a =>
        Math.abs((a.y2 - a.y1) / (a.x2 - a.x1 || 1) - (b.y2 - b.y1) / (b.x2 - b.x1 || 1)) < 0.05 &&
        Math.abs(beamYAt(a, stemX) - beamYAt(b, stemX)) <= 3.5)) {
        reachable.add(b)
        added = true
      }
    }
  }
  for (const b of beams) {
    if (b.bracket) continue
    if (stemX < b.x1 - 3.5 || stemX > b.x2 + 3.5) continue
    const y = beamYAt(b, stemX)
    if (b.singleStroke && !reachable.has(b)) continue
    const beyondHead = dir > 0 ? y > headLimit : y < headLimit
    const withinReach = dir > 0 ? y <= far : y >= far
    if (!beyondHead || !withinReach) continue
    // 譜線そのものは連桁にしない。譜線上に乗った短い連桁は残す
    if (staffLines.some(ly => Math.abs(ly - y) < 0.85) && b.x2 - b.x1 > (b.singleStroke ? 12 : 100)) continue
    ys.push(y)
  }
  ys.sort((a, b) => b - a)
  const levels: number[] = []
  for (const y of ys) {
    // 同じ矩形を二重に数えない。隣の連桁は約 3.2pt 離れる
    if (!levels.some(l => Math.abs(l - y) < 1.8)) levels.push(y)
  }
  return levels.length
}

function stemFor(vert: VSeg[], head: TextItem): { x: number; tip: number; base: number } | null {
  // グリフの height はフォントのアセント（約17pt）で、符頭の中心ではない
  const hx = head.x + Math.min(head.w * 0.6, 3)
  const hy = head.y + 1.6
  const cands = vert.filter(v => {
    if (Math.abs(v.x - hx) > 7) return false
    if (v.y2 - v.y1 < 8 || v.y2 - v.y1 > 52) return false
    return v.y1 < hy + 6 && v.y2 > hy - 6
  })
  if (cands.length === 0) return null
  cands.sort((a, b) => {
    const ax = Math.abs(a.x - hx)
    const bx = Math.abs(b.x - hx)
    if (Math.abs(ax - bx) > 1.2) return ax - bx
    return (b.y2 - b.y1) - (a.y2 - a.y1)
  })
  const s = cands[0]
  let tip = Math.abs(s.y2 - hy) >= Math.abs(s.y1 - hy) ? s.y2 : s.y1
  let base = tip === s.y2 ? s.y1 : s.y2
  // 符幹が譜線で分割されていることがある
  let grew = true
  while (grew) {
    grew = false
    for (const v of vert) {
      if (Math.abs(v.x - s.x) > 1.3) continue
      if (v.y2 - v.y1 < 6 || v.y2 - v.y1 > 55) continue
      const far = Math.abs(v.y2 - hy) >= Math.abs(v.y1 - hy) ? v.y2 : v.y1
      const nearEnd = Math.min(Math.abs(v.y1 - tip), Math.abs(v.y2 - tip))
      if (nearEnd < 3.5 && Math.abs(far - hy) > Math.abs(tip - hy) + 2) {
        tip = far
        grew = true
      }
    }
  }
  return { x: s.x, tip, base }
}

function tupletNumber(item: TextItem): number | null {
  const text = item.str.trim()
  const n = /^[356]$/.test(text) ? Number(text) : cp(text) - 0xe880
  return [3, 5, 6].includes(n) && [...text].length === 1 ? n : null
}

export function tupletGroups(items: TextItem[], beams: Beam[], system: System, x1: number, x2: number): Array<{ item: TextItem; count: number; left?: number; right?: number }> {
  const top = system.notation.lines[0]
  const bot = system.notation.lines[system.notation.lines.length - 1]
  const out: ReturnType<typeof tupletGroups> = []
  const eventXs: number[] = []
  for (const it of items) {
    const code = cp(it.str)
    if ([...it.str].length !== 1 || it.y > top + 22 || it.y < bot - 16) continue
    if (![NOTEHEAD_BLACK, NOTEHEAD_HALF, NOTEHEAD_WHOLE, NOTEHEAD_X, REST_RECT].includes(code) &&
      !(code >= REST_WHOLE && code <= REST_32)) continue
    if (!eventXs.some(x => Math.abs(x - it.x) < 4.5)) eventXs.push(it.x)
  }
  const enoughEvents = (left: number, right: number, count: number) =>
    eventXs.filter(x => x >= left && x <= right).length >= count
  eventXs.sort((a, b) => a - b)
  const centeredEvents = (beam: Beam, center: number, count: number) => {
    const xs = eventXs.filter(x => x >= beam.x1 - 6 && x <= beam.x2 + 3)
    return xs.some((x, i) => i + count <= xs.length &&
      Math.abs(center - (x + xs[i + count - 1]) / 2) < Math.max(5, (xs[i + count - 1] - x) * 0.23))
  }
  for (const item of items) {
    const count = tupletNumber(item)
    if (!count || item.tabDigit || item.x < x1 + 8 || item.x >= x2 - 2 || item.y > top + 40 || item.y < Math.max(bot - 40, system.tab.lines[0] + 5)) continue
    const center = item.x + item.w / 2
    const beam = beams.filter(b => !b.bracket &&
      !(b.singleStroke && b.x2 - b.x1 > 12 && system.notation.lines.some(y => Math.abs(y - beamYAt(b, center)) < 0.85)) &&
      enoughEvents(b.x1 - 6, b.x2 + 3, count) && b.x1 >= x1 - 3 && b.x2 <= x2 + 3 &&
      centeredEvents(b, center, count) &&
      Math.abs(item.y - beamYAt(b, center)) < 18)
      .sort((a, b) => (b.x2 - b.x1) - (a.x2 - a.x1))[0]
    const left = beams.filter(b => b.bracket && b.x1 >= x1 && Math.abs(b.x2 - item.x) < 9 &&
      Math.abs(b.y2 - item.y) < 5).sort((a, b) => b.x2 - a.x2)[0]
    const right = beams.filter(b => b.bracket && b.x2 <= x2 && Math.abs(b.x1 - (item.x + item.w)) < 9 &&
      Math.abs(b.y1 - item.y) < 5).sort((a, b) => a.x1 - b.x1)[0]
    if (left && right && Math.abs(left.y2 - right.y1) < 6 && enoughEvents(left.x1 - 3, right.x2, count)) {
      out.push({ item, count, left: left.x1 - 3, right: right.x2 })
      continue
    }
    // Printed bar numbers sit immediately above the staff at its left edge.
    if (!beam) continue
    out.push({ item, count, ...(beam ? { left: beam.x1 - 6, right: beam.x2 + 3 } : {}) })
  }
  return out
}

export function printedMeasureNumber(items: TextItem[], beams: Beam[], system: System, x1: number, x2: number): number | undefined {
  const tuplets = new Set(tupletGroups(items, beams, system, x1, x2).map(g => g.item))
  const top = system.notation.lines[0]
  const printed = items.filter(it => /^\d{1,3}$/.test(it.str.trim()) && !tuplets.has(it) && !it.tabDigit &&
    it.y > top - 1 && it.y < top + 28 && it.x >= x1 - 8 && it.x < x1 + (x2 - x1) * 0.45)
    .sort((a, b) => a.x - b.x)[0]
  return printed ? Number(printed.str) : undefined
}

export function notationBeats(
  items: TextItem[],
  beams: Beam[],
  stems: VSeg[],
  dotMarks: Dot[],
  system: System,
  x1: number,
  x2: number,
): RawBeat[] {
  const top = system.notation.lines[0]
  const bot = system.notation.lines[system.notation.lines.length - 1]
  const inBand = (it: TextItem) => it.y < top + 22 && it.y > bot - 16 && it.x >= x1 - 2 && it.x < x2 - 1
  const heads = items.filter(it => {
    if (!inBand(it) || [...it.str].length !== 1) return false
    const c = cp(it.str)
    return c === NOTEHEAD_BLACK || c === NOTEHEAD_HALF || c === NOTEHEAD_WHOLE || c === NOTEHEAD_X
  })
  const rests = items.filter(it => {
    if (!inBand(it) || [...it.str].length !== 1) return false
    const c = cp(it.str)
    return c === REST_RECT || (c >= REST_WHOLE && c <= REST_32)
  })
  const flags = items.filter(it => {
    if ([...it.str].length !== 1) return false
    const c = cp(it.str)
    return c >= FLAG_8_UP && c <= FLAG_32_DOWN && it.x >= x1 - 4 && it.x < x2 + 4 && it.y < top + 48 && it.y > bot - 36
  })
  const dots = items.filter(it => cp(it.str) === AUG_DOT && it.x >= x1 && it.x < x2 + 6 && it.y < top + 16 && it.y > bot - 12)

  const localBeams = beams.filter(b => {
    const a = Math.max(b.x1, x1 - 4)
    const b2 = Math.min(b.x2, x2 + 4)
    const mid = (b.y1 + b.y2) / 2
    return b2 - a >= 3 && mid < top + 52 && mid > bot - 46
  })

  const flagDur = (head: TextItem): number | null => {
    const flag = flags
      .filter(f => f.x >= head.x - 4 && f.x - head.x < 16 && Math.abs(f.y - head.y) < 26)
      .sort((a, b) => Math.abs(a.x - head.x) - Math.abs(b.x - head.x))[0]
    if (!flag) return null
    const c = cp(flag.str)
    if (c === FLAG_8_UP || c === FLAG_8_DOWN) return 0.5
    if (c === FLAG_16_UP || c === FLAG_16_DOWN) return 0.25
    if (c === FLAG_32_UP || c === FLAG_32_DOWN) return 0.125
    return null
  }

  // 符頭の中心はベースラインのすぐ上。height はフォントのアセントなので使わない
  const headY = (head: TextItem) => head.y + 1.6
  const dotCount = (head: TextItem, rest = false) => {
    const spacing = Math.abs(top - bot) / (system.notation.lines.length - 1)
    const low = rest ? (head.restBounds?.bottom ?? head.y - head.h * 0.25) : headY(head) - 3.2
    const high = rest ? (head.restBounds?.top ?? head.y + head.h * 0.65) : headY(head) + 3.2
    const nextX = Math.min(x2, ...[...heads, ...rests].filter(h => h.x > head.x + 4.5).map(h => h.x))
    const candidates = [
      ...dots.map(d => ({ x: d.x, y: d.y, text: true })),
      ...dotMarks.map(d => ({ ...d, text: false })),
    ].filter(d => d.x > head.x + Math.max(3, head.w * 0.7) && d.x - head.x < 16 && d.x < nextX &&
      d.y >= low && d.y <= high && (rest || Math.abs(d.y - headY(head)) < spacing * 0.8))
    const xs: number[] = []
    for (const d of candidates.sort((a, b) => a.x - b.x)) {
      if (!xs.some(x => Math.abs(x - d.x) < 2) && (xs.length ? d.x - xs[0] < 6 : d.x - head.x < (d.text ? 12 : 11))) xs.push(d.x)
    }
    return Math.min(2, xs.length)
  }
  const dotFactor = (n: number) => n === 2 ? 1.75 : n === 1 ? 1.5 : 1

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
    let confidence: RawBeat['confidence'] = 'high'
    if (c === NOTEHEAD_WHOLE) dur = 4
    else if (c === NOTEHEAD_HALF) dur = 2
    else {
      const stem = stemFor(stems, head)
      const flagged = flagDur(head)
      const beamsN = stem ? beamCountAt(localBeams, system.notation.lines, stem.x, stem.tip, stem.base) : 0
      if (beamsN >= 3) dur = 0.125
      else if (beamsN === 2) dur = 0.25
      else if (beamsN === 1) dur = 0.5
      else if (flagged) dur = flagged
      else if (stem) dur = 1
      else {
        dur = 1
        confidence = 'low'
      }
    }
    dur *= dotFactor(dotCount(head))
    beats.push({
      x: head.x,
      y: head.y,
      duration: dur,
      rest: false,
      dead: g.some(h => cp(h.str) === NOTEHEAD_X),
      confidence,
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
    if (c === REST_RECT && r.restBounds) {
      const spacing = Math.abs(top - bot) / (system.notation.lines.length - 1)
      const edgeDistance = (edge: number) => Math.min(...system.notation.lines.map(y => Math.abs(y - edge)))
      const topDistance = edgeDistance(r.restBounds.top)
      const bottomDistance = edgeDistance(r.restBounds.bottom)
      // PDF coordinates increase upwards: whole rests hang from a line,
      // while half rests sit on one. Allow for stroke width and rounding.
      dur = bottomDistance <= spacing * 0.25 && bottomDistance < topDistance ? 2 : 4
    }
    dur *= dotFactor(dotCount(r, true))
    beats.push({ x: r.x, y: r.y, duration: dur, rest: true, dead: false, confidence: 'high' })
  }

  beats.sort((a, b) => a.x - b.x)
  const assigned = new Set<RawBeat>()
  for (const group of tupletGroups(items, localBeams, system, x1, x2)) {
    let selected = group.left == null ? [] : beats.filter(b => b.x >= group.left! && b.x <= group.right!)
    if (selected.length !== group.count) {
      const center = group.item.x + group.item.w / 2
      let best = 0
      let distance = Infinity
      const candidates = selected
      if (candidates.length < group.count) continue
      for (let i = 0; i + group.count <= candidates.length; i++) {
        const d = Math.abs((candidates[i].x + candidates[i + group.count - 1].x) / 2 - center)
        if (d < distance) { distance = d; best = i }
      }
      selected = candidates.slice(best, best + group.count)
    }
    for (const beat of selected) {
      if (assigned.has(beat)) continue
      beat.duration *= group.count === 5 ? 4 / 5 : 2 / 3
      assigned.add(beat)
    }
  }
  return beats
}

/** タブの1小節からフレット数字と死に音符（x / X / ×）を読む */
export function fretsInMeasure(items: TextItem[], tab: Staff, x1: number, x2: number): Array<{ x: number; string: number; fret: number; dead: boolean; w: number }> {
  const spacing = tab.lines[0] - tab.lines[1]
  const out: Array<{ x: number; string: number; fret: number; dead: boolean; w: number }> = []
  for (const it of items) {
    const raw = it.str.trim()
    if (!/^(\d{1,2}|x|×)$/i.test(raw)) continue
    if (it.x < x1 - 1 || it.x > x2 - 1) continue
    const centerY = it.y + it.h * 0.42
    const { index, dist } = nearestLine(centerY, tab.lines)
    if (dist > spacing * 0.48) continue
    // alphaTab: 1 = 一番下の線
    const string = tab.lines.length - index
    const dead = /^[x×]$/i.test(raw)
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

interface TimedEvent {
  x: number
  duration: number
  confidence: RawBeat['confidence']
  notes: GpNote[]
  rest: boolean
}

/** Integer playback grid, including triplets and quintuplets. */
function toUnits(quarters: number): number {
  return Math.round(quarters * 960)
}

function fromUnits(units: number): number {
  return units / 960
}

/**
 * 読み取った音価の合計を小節の拍数に合わせる。
 * 休符グリフや旗は動かさず、符幹のない符頭だけ別の音価を試す。
 * 安い直しが無ければ、読んだままを残す。
 */
function fitToBar(events: TimedEvent[], expected: number): TimedEvent[] {
  if (events.length === 0) return events
  const target = toUnits(expected)
  const sum = events.reduce((s, e) => s + toUnits(e.duration), 0)
  if (sum === target) return events

  const options = events.map(e => {
    const pref = toUnits(e.duration)
    const opts: Array<{ units: number; cost: number }> = [{ units: pref, cost: 0 }]
    if (e.confidence === 'low') {
      for (const q of [2, 1, 0.5, 0.25, 0.125]) {
        const u = toUnits(q)
        if (u !== pref && u > 0) opts.push({ units: u, cost: 1 })
      }
    }
    return opts
  })

  const dp: Array<Map<number, number>> = Array.from({ length: events.length + 1 }, () => new Map())
  dp[0].set(0, 0)
  for (let i = 0; i < events.length; i++) {
    for (const [used, cost] of dp[i]) {
      for (const opt of options[i]) {
        const next = used + opt.units
        if (next > target) continue
        const nc = cost + opt.cost
        const prev = dp[i + 1].get(next)
        if (prev == null || nc < prev) dp[i + 1].set(next, nc)
      }
    }
  }
  const best = dp[events.length].get(target)
  if (best == null || best > 3) return events

  const chosen: number[] = []
  let used = target
  for (let i = events.length - 1; i >= 0; i--) {
    let found = options[i][0]
    for (const opt of options[i]) {
      const prevUsed = used - opt.units
      if (dp[i].get(prevUsed) == null) continue
      if (dp[i].get(prevUsed)! + opt.cost === dp[i + 1].get(used)) {
        found = opt
        break
      }
    }
    chosen.push(found.units)
    used -= found.units
  }
  chosen.reverse()
  return events.map((e, i) => ({ ...e, duration: fromUnits(chosen[i]) }))
}

function applyTies(events: TimedEvent[], curves: Curve[]) {
  const noted = events.filter(e => !e.rest)
  for (const curve of curves) {
    const left = [...noted].reverse().find(e => e.notes.some(n => n.string > 0) && e.x <= curve.x1 + 6 && curve.x1 - e.x < 22)
    const right = noted.find(e => e !== left && e.x > (left?.x ?? 0) && e.x >= curve.x1 && e.x <= curve.x2 + 12)
    if (!left || !right) continue
    const placeholder = right.notes.length === 1 && right.notes[0].string === 0
    if (placeholder && left.notes.length === 1 && left.notes[0].string > 0) {
      const src = left.notes[0]
      right.notes = [{ string: src.string, fret: src.fret, dead: src.dead, tie: true }]
      continue
    }
    for (const note of right.notes) {
      const src = left.notes.find(n => n.string === note.string && n.string > 0)
      if (src && note.fret === src.fret && !!note.dead === !!src.dead) note.tie = true
    }
  }
}

function buildMeasure(
  items: TextItem[],
  beams: Beam[],
  stems: VSeg[],
  curves: Curve[],
  dotMarks: Dot[],
  system: System,
  x1: number,
  x2: number,
  ts: { beats: number; beatType: number },
): GpMeasure {
  const expected = expectedQuarters(ts)
  const raw = notationBeats(items, beams, stems, dotMarks, system, x1, x2)
  const frets = fretsInMeasure(items, system.tab, x1, x2)
  const marks = techniqueMarks(items, system, x1, x2)

  const fretGroups: Array<{ x: number; notes: GpNote[] }> = []
  for (const f of [...frets].sort((a, b) => a.x - b.x)) {
    const g = fretGroups.find(g => Math.abs(g.x - f.x) < 4.2)
    if (g) g.notes.push({ string: f.string, fret: f.fret, dead: f.dead })
    else fretGroups.push({ x: f.x, notes: [{ string: f.string, fret: f.fret, dead: f.dead }] })
  }

  if (raw.length === 0 && fretGroups.length === 0) {
    return { beats: [{ duration: expected, notes: [] }], timeSignature: ts }
  }

  const used = new Set<number>()
  const events: TimedEvent[] = []
  for (const b of raw) {
    if (b.rest) {
      events.push({ x: b.x, duration: b.duration, confidence: b.confidence, notes: [], rest: true })
      continue
    }
    let best = -1
    let bestD = 8
    fretGroups.forEach((g, i) => {
      if (used.has(i)) return
      const d = Math.abs(g.x - (b.x + Math.min(6, (g.notes[0] ? 2 : 2))))
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    if (best >= 0) {
      used.add(best)
      const notes = fretGroups[best].notes.map(n => ({ ...n, dead: n.dead || b.dead }))
      events.push({ x: b.x, duration: b.duration, confidence: b.confidence, notes, rest: false })
    } else {
      // タイでフレットが省略された符頭。音は後でタイから写す
      events.push({
        x: b.x,
        duration: b.duration,
        confidence: b.confidence,
        notes: [{ string: 0, fret: 0, dead: b.dead }],
        rest: false,
      })
    }
  }
  fretGroups.forEach((g, i) => {
    if (used.has(i)) return
    events.push({ x: g.x, duration: 0.5, confidence: 'low', notes: g.notes, rest: false })
  })
  events.sort((a, b) => a.x - b.x)

  const localCurves = curves.filter(c => c.x2 > x1 - 2 && c.x1 < x2 + 2 && c.y < system.notation.lines[0] + 20 && c.y > system.tab.lines[system.tab.lines.length - 1] - 8)
  applyTies(events, localCurves)
  const kept = events.filter(e => e.rest || e.notes.some(n => n.string > 0))
  for (const e of kept) e.notes = e.notes.filter(n => n.string > 0)

  if (frets.length === 0 && raw.length === 1 && raw[0].rest && raw[0].duration >= 2) {
    return { beats: [{ duration: expected, notes: [] }], timeSignature: ts }
  }

  const fitted = fitToBar(kept, expected)
  const beats: GpBeat[] = fitted
    .filter(e => e.notes.length > 0 || e.duration > 0)
    .map(e => ({ duration: e.duration, notes: e.notes, x: e.x }))

  applyTechniques(beats, marks)

  if (beats.length === 0) return { beats: [{ duration: expected, notes: [] }], timeSignature: ts }
  return { beats, timeSignature: ts }
}

function applyTechniques(beats: GpBeat[], marks: Array<{ x: number; kind: 'h' | 'sl' }>) {
  const sequenced: Array<{ note: GpNote; x: number }> = []
  for (const b of beats) {
    if (b.x == null) continue
    for (const n of b.notes) sequenced.push({ note: n, x: b.x })
  }
  for (const mark of marks) {
    let best: { left: (typeof sequenced)[0]; score: number } | null = null
    for (let i = 0; i < sequenced.length; i++) {
      for (let j = i + 1; j < sequenced.length; j++) {
        if (sequenced[j].note.string !== sequenced[i].note.string) continue
        const between = sequenced.slice(i + 1, j).some(s => s.note.string === sequenced[i].note.string)
        if (between) continue
        const left = sequenced[i]
        const right = sequenced[j]
        const gap = right.x - left.x
        if (gap <= 0 || gap > 70) continue
        if (mark.x < left.x - 4 || mark.x > right.x + 6) continue
        const inside = mark.x >= left.x - 1 && mark.x <= right.x + 1
        const score = (inside ? 0 : 30) + gap + Math.abs(mark.x - (left.x + right.x) / 2) * 0.15
        if (!best || score < best.score) best = { left, score }
      }
    }
    if (!best && mark.kind === 'sl') {
      const left = [...sequenced].reverse().find(n => n.x <= mark.x + 4)
      if (left && mark.x - left.x < 26) best = { left, score: 0 }
    }
    if (!best) continue
    if (mark.kind === 'h') best.left.note.hammer = true
    else best.left.note.slide = true
  }
}

/** Repair only gaps supported by a consistent run on each side. */
export function fillMeasureGaps(measures: GpMeasure[], ts: GpMeasure['timeSignature']): GpMeasure[] {
  const clean = measures.map(m => ({ ...m }))
  let previous = 0
  for (const m of clean) {
    if (m.number != null && m.number <= 6 && previous > 6) m.number = undefined
    if (m.number != null) previous = m.number
  }
  const anchors = clean.flatMap((m, index) => m.number == null ? [] : [{ index, number: m.number }])
  const insertions = new Map<number, number>()
  for (let i = 2; i + 2 < anchors.length; i++) {
    const left = anchors[i - 1], right = anchors[i]
    const consistent = (a: typeof left, b: typeof left) => b.number - a.number === b.index - a.index
    if (!consistent(anchors[i - 2], left) || !consistent(right, anchors[i + 1]) || !consistent(anchors[i + 1], anchors[i + 2])) continue
    const missing = right.number - left.number - (right.index - left.index)
    if (missing > 0 && missing <= 16 && right.number > 6) insertions.set(right.index, missing)
  }
  return clean.flatMap((m, index) => {
    const signature = clean[index - 1]?.timeSignature ?? ts
    const rests: GpMeasure[] = Array.from({ length: insertions.get(index) ?? 0 }, () => ({
      beats: [{ duration: expectedQuarters(signature), notes: [] }], timeSignature: { ...signature },
    }))
    return [...rests, m]
  })
}

export async function parseGuitarProPdf(data: ArrayBuffer, filename?: string): Promise<GpScore | null> {
  configurePdfjsWorker()

  const pdf = await pdfjsLib.getDocument(pdfDocumentParams(data)).promise
  const allItems: TextItem[] = []
  let pageOneItems: TextItem[] = []
  let pageOneNotationTop: number | null = null
  const pageSystems: Array<{
    system: System
    bars: number[]
    items: TextItem[]
    beams: Beam[]
    stems: VSeg[]
    curves: Curve[]
    dots: Dot[]
  }> = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const pageH = page.view[3] - page.view[1]
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
    const op = await page.getOperatorList()
    const pageGeometry = extractGeometry(op)
    const scale = pageStaffScale(clusterY(pageGeometry.horiz, pageH, true))
    // Work in Qt staff units throughout, including path classification. This
    // makes every downstream distance/size threshold relative to staff size.
    // Leave native Qt coordinates untouched to preserve their exact behaviour.
    const geo = scale === 1 ? pageGeometry : extractGeometry(op, scale)
    if (scale !== 1) {
      for (const item of items) {
        item.x /= scale
        item.y /= scale
        item.w /= scale
        item.h /= scale
      }
    }
    // Native exports already expose music glyphs as text.
    if (!items.some(it => cp(it.str) === NOTEHEAD_BLACK || cp(it.str) === NOTEHEAD_HALF)) items.push(...geo.glyphs)
    allItems.push(...items)
    const beams = pairBeamEdges(geo.beamEdges, geo.vert)
    // Page-edge rules are decorations, not staff lines. Remove them before
    // clustering so they cannot shift a nearby staff line or join its ends.
    const pageW = (page.view[2] - page.view[0]) / scale
    const lines = clusterY(geo.horiz.filter(h => h.x1 > 8 && h.x2 < pageW - 8), pageH / scale, true)
    const staffLines = scale === 1 ? lines : lines.filter(l => {
      const widest = Math.max(...lines.filter(o => Math.abs(o.y - l.y) < 28).map(o => o.x2 - o.x1))
      return l.x2 - l.x1 >= widest * 0.95
    })
    const staves = findStaves(staffLines, 1)
    const sys = pairSystems(staves)
    for (const item of items) {
      if (!/^\d{1,2}$/.test(item.str.trim())) continue
      item.tabDigit = sys.some(s => nearestLine(item.y + item.h * 0.42, s.tab.lines).dist <
        (s.tab.lines[0] - s.tab.lines[1]) * 0.48)
    }
    if (p === 1) {
      pageOneItems = items
      if (sys.length > 0) pageOneNotationTop = sys[0].notation.lines[0]
    }
    for (const system of sys) {
      const bars = barlineXs(geo.vert, system.notation, system.tab, true)
      pageSystems.push({
        system,
        bars,
        items,
        beams,
        stems: geo.vert,
        curves: geo.curves,
        dots: geo.dots,
      })
    }
  }

  if (pageSystems.length === 0) return null

  // ヘッダーは 1 ページ目の最初の段の五線より上。段が無ければ 1 ページ目全体
  const headerItems = pageOneNotationTop == null
    ? pageOneItems
    : pageOneItems.filter(it => it.y > pageOneNotationTop + 6)
  const stringCount = pageSystems[0].system.tab.lines.length || 4
  const tuning = parseTuningText(tuningHeaderText(headerItems), stringCount)
  const tempo = detectTempo(allItems)
  const ts = detectTimeSignature(allItems, pageSystems[0].system.notation)
  const measures: GpMeasure[] = []

  for (const ps of pageSystems) {
    for (let i = 0; i < ps.bars.length - 1; i++) {
      const x1 = ps.bars[i]
      const x2 = ps.bars[i + 1]
      if (x2 - x1 < 8) continue
      const measure = buildMeasure(ps.items, ps.beams, ps.stems, ps.curves, ps.dots, ps.system, x1, x2, ts)
      measure.number = printedMeasureNumber(ps.items, ps.beams, ps.system, x1, x2)
      measures.push(measure)
    }
  }

  if (measures.length === 0) return null

  const title = filename?.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim()

  return {
    measures: fillMeasureGaps(measures, ts),
    tempo,
    title: title || undefined,
    tuning: tuning.tuning,
    tuningLabel: tuning.label,
  }
}
