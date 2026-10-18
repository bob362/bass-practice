import { OPS } from 'pdfjs-dist'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { extractGeometry, pairBeamEdges, barlineXs, notationBeats, findStaves, fretsInMeasure, pairSystems, staffScale, clusterY, tuningHeaderText, fillMeasureGaps, printedMeasureNumber, type GpMeasure, type Staff } from './gpPdfParser'

// 合成データ。4線タブの譜線（上から高音弦）。pdf.js は y が上向き
const tab: Staff = {
  lines: [42.8, 36.4, 30.0, 23.6],
  kind: 'tab',
  x1: 10,
  x2: 90,
}
const H = 7
// グリフは y = 中心 - h*0.42 に置く（fretsInMeasure の計算に合わせる）
const onLine = (str: string, y0: number, x = 20) => ({ str, x, y: y0 - H * 0.42, w: 3, h: H })

describe('fretsInMeasure', () => {
  it('x / X / × を死に音符として読み、下の線が弦1', () => {
    const items = [
      onLine('X', tab.lines[0]),
      onLine('x', tab.lines[1]),
      onLine('×', tab.lines[3]),
    ]
    const out = fretsInMeasure(items, tab, 10, 90)
    expect(out).toHaveLength(3)
    expect(out[0]).toEqual({ x: 21.5, string: 4, fret: 0, dead: true, w: 3 })
    expect(out[1]).toEqual({ x: 21.5, string: 3, fret: 0, dead: true, w: 3 })
    expect(out[2]).toEqual({ x: 21.5, string: 1, fret: 0, dead: true, w: 3 })
  })

  it('数字は死に音符でなくフレットとして読む', () => {
    const out = fretsInMeasure([onLine('12', tab.lines[2])], tab, 10, 90)
    expect(out).toHaveLength(1)
    expect(out[0].fret).toBe(12)
    expect(out[0].dead).toBe(false)
  })

  it('譜線から離れた項目は無視する', () => {
    const far = { str: 'x', x: 20, y: 0, w: 3, h: H }
    expect(fretsInMeasure([far], tab, 10, 90)).toHaveLength(0)
  })

  it('5線タブでは下の線が弦1、上の線が弦5', () => {
    const tab5: Staff = { lines: [100, 93.6, 87.2, 80.8, 74.4], kind: 'tab', x1: 28, x2: 567 }
    const out = fretsInMeasure([onLine('0', tab5.lines[0], 40), onLine('3', tab5.lines[4], 60)], tab5, 28, 567)
    expect(out).toHaveLength(2)
    expect(out[0].string).toBe(5)
    expect(out[1].string).toBe(1)
  })
})

describe('tuningHeaderText', () => {
  it('SMuFL の弦番号・臨時記号を式の文字に置き換える', () => {
    const out = tuningHeaderText([
      { str: '\uE834' },
      { str: '= F' },
      { str: '\uE260' },
      { str: '\uE835' },
      { str: '= C' },
      { str: '\uE262' },
      { str: '\uE839' },
    ])
    expect(out).toBe(' (1)  = F  b   (2)  = C  #   (6) ')
  })

  it('私用領域の他の音楽グリフは捨て、通常文字は残す', () => {
    expect(tuningHeaderText([{ str: '\uE0A4Drop D\uE834' }])).toBe('Drop D (1) ')
  })
})

it('Staff 型を書き出せる', () => {
  expectTypeOf<Staff['kind']>().toEqualTypeOf<'tab' | 'notation'>()
})

describe('findStaves', () => {
  // 合成データ。pdf y は上向きなので、上の譜線ほど y が大きい（降順＝上→下）
  const hl = (y: number, x1 = 28, x2 = 567) => ({ y, x1, x2 })
  const group = (top: number, count: number, gap: number, x1 = 28, x2 = 567) =>
    Array.from({ length: count }, (_, i) => hl(top - i * gap, x1, x2))
  // standard notation 5線（間隔4.25）＋ 17pt 下にタブ staff
  const staffSystem = (notationTop: number, tabCount: number) => [
    ...group(notationTop, 5, 4.25),
    ...group(notationTop - 4 * 4.25 - 17, tabCount, 6.4),
  ]

  it.each([4, 5])('通常倍率の五線と%d線タブでは倍率1になる', tabCount => {
    expect(staffScale(staffSystem(760.2, tabCount))).toBe(1)
  })

  it('約1.52倍のページでも五線と4線タブを分ける', () => {
    const system = (top: number) => [
      ...group(top, 5, 6.45, 43, 858),
      ...group(top - 4 * 6.45 - 25.7, 4, 9.65, 43, 858),
    ]
    const lines = [...system(1100), ...system(900)]
    expect(staffScale(lines)).toBeCloseTo(1.52, 1)
    const staves = findStaves(lines)
    expect(staves.map(s => s.kind)).toEqual(['notation', 'tab', 'notation', 'tab'])
    expect(staves.map(s => s.lines.length)).toEqual([5, 4, 5, 4])
  })

  it('5線タブだけのページは倍率1で3段読む', () => {
    const lines = [760, 694.4, 628.8].flatMap(top => group(top, 5, 6.4))
    expect(staffScale(lines)).toBe(1)
    const staves = findStaves(lines)
    expect(staves.map(s => s.kind)).toEqual(['tab', 'tab', 'tab'])
    expect(staves.map(s => s.lines.length)).toEqual([5, 5, 5])
  })

  it('五線5本と4線タブを分ける', () => {
    const notation = group(760.2, 5, 4.25)
    const tab = group(726.2, 4, 6.4)
    const staves = findStaves([...notation, ...tab])
    expect(staves).toHaveLength(2)
    expect(staves[0]).toEqual({ lines: notation.map(l => l.y), kind: 'notation', x1: 28, x2: 567 })
    expect(staves[1]).toEqual({ lines: tab.map(l => l.y), kind: 'tab', x1: 28, x2: 567 })
  })

  it('5線タブも読む', () => {
    const notation = group(760.2, 5, 4.25)
    const tab = group(726.2, 5, 6.4)
    const staves = findStaves([...notation, ...tab])
    const tabs = staves.filter(s => s.kind === 'tab')
    expect(staves.filter(s => s.kind === 'notation')).toHaveLength(1)
    expect(tabs).toHaveLength(1)
    expect(tabs[0].lines).toEqual(tab.map(l => l.y))
  })

  it('6線タブも読む', () => {
    const notation = group(760.2, 5, 4.25)
    const tab = group(726.2, 6, 6.4)
    const staves = findStaves([...notation, ...tab])
    const tabs = staves.filter(s => s.kind === 'tab')
    expect(tabs).toHaveLength(1)
    expect(tabs[0].lines).toEqual(tab.map(l => l.y))
  })

  it('1ページに2段積まれても数と種類が合う', () => {
    const staves = findStaves([...staffSystem(760.2, 5), ...staffSystem(650.2, 5)])
    expect(staves.filter(s => s.kind === 'notation')).toHaveLength(2)
    const tabs = staves.filter(s => s.kind === 'tab')
    expect(tabs).toHaveLength(2)
    expect(tabs.every(t => t.lines.length === 5)).toBe(true)
    const systems = pairSystems(staves)
    expect(systems).toHaveLength(2)
    expect(systems[0].tab.lines[0]).toBeGreaterThan(systems[1].tab.lines[0])
    expect(systems[0].notation.lines[0]).toBe(760.2)
  })

  it('タブの真上の迷線はタブに混ぜない', () => {
    const tab = group(391.0, 4, 6.4)
    const strays = [hl(397.9, 55, 514), hl(400.0, 55, 514)]
    const staves = findStaves([...strays, ...tab])
    expect(staves).toHaveLength(1)
    expect(staves[0].kind).toBe('tab')
    expect(staves[0].lines).toEqual(tab.map(l => l.y))
    expect(staves[0].lines).toHaveLength(4)
  })

  it('片端だけで揃う本物の譜線でも4線タブとしてまとめる', () => {
    const lines = [
      hl(391.0, 28, 532),
      hl(384.6, 28, 532),
      hl(378.2, 28, 567),
      hl(371.8, 28, 567),
    ]
    const staves = findStaves(lines)
    expect(staves).toHaveLength(1)
    expect(staves[0].kind).toBe('tab')
    expect(staves[0].lines).toEqual([391.0, 384.6, 378.2, 371.8])
    expect(staves[0].x1).toBe(28)
    expect(staves[0].x2).toBe(567)
  })

  it('最後の間隔が広い5本目はタブに入れない', () => {
    const lines = group(500, 4, 6.4)
    lines.push(hl(500 - 3 * 6.4 - 9.5))
    const staves = findStaves(lines)
    expect(staves).toHaveLength(1)
    expect(staves[0].kind).toBe('tab')
    expect(staves[0].lines).toEqual(lines.slice(0, 4).map(l => l.y))
  })
})

describe('pairSystems', () => {
  it('五線が無くてもタブだけで1段になる', () => {
    const tab: Staff = { lines: [300, 293.6, 287.2, 280.8, 274.4], kind: 'tab', x1: 28, x2: 567 }
    const systems = pairSystems([tab])
    expect(systems).toHaveLength(1)
    expect(systems[0].tab).toBe(tab)
    expect(systems[0].notation.kind).toBe('notation')
    expect(systems[0].notation.lines[0]).toBeCloseTo(334, 5)
  })

  it('五線とタブの対では本物の五線を使う', () => {
    const notation: Staff = { lines: [400, 395.75, 391.5, 387.25, 383], kind: 'notation', x1: 28, x2: 567 }
    const tab: Staff = { lines: [360, 353.6, 347.2, 340.8, 334.4], kind: 'tab', x1: 28, x2: 567 }
    const systems = pairSystems([notation, tab])
    expect(systems).toHaveLength(1)
    expect(systems[0].notation).toBe(notation)
    expect(systems[0].tab).toBe(tab)
  })
})

describe('staff-relative page geometry', () => {
  it.each([0.6, 0.7, 1, 1.4])('classifies paths and rhythm identically at scale %s', scale => {
    const coords = [
      [10, 80, 120, 80], // staff line
      [40, 48, 40, 68], // stem
      [10, 20, 10, 39.2], // barline
      [90, 20, 90, 39.2],
      [40, 67, 65, 67], // beam edges
      [40, 69.13, 65, 69.13],
    ]
    const paths = coords.map(c => [[13, 14], c.map(v => v * scale)])
    paths.push([[19], [45, 47, 2, 2].map(v => v * scale)])
    const geo = extractGeometry({
      fnArray: paths.map(() => OPS.constructPath), argsArray: paths,
    }, scale)
    expect(geo.horiz.some(h => Math.abs(h.y - 80) < 1e-8)).toBe(true)
    expect(geo.dots).toHaveLength(1)
    expect(geo.dots[0].x).toBeCloseTo(46)
    const beams = pairBeamEdges(geo.beamEdges)
    expect(beams).toHaveLength(1)
    const system = {
      notation: { kind: 'notation' as const, lines: [60, 55.75, 51.5, 47.25, 43], x1: 10, x2: 90 },
      tab: { kind: 'tab' as const, lines: [39.2, 32.8, 26.4, 20], x1: 10, x2: 90 },
    }
    expect(barlineXs(geo.vert, system.notation, system.tab).map(x => Math.round(x))).toEqual([10, 90])
    const beats = notationBeats([
      { str: '\uE0A4', x: 37, y: 46.4, w: 5, h: 17 },
    ], beams, geo.vert, geo.dots, system, 10, 90)
    expect(beats).toHaveLength(1)
    expect(beats[0].duration).toBe(0.75)
  })
})


describe('printed outline geometry', () => {
  // Hand-built ovals, unrelated to any input PDF or font outline.
  const oval = (x: number, y: number, w: number, h: number) => ({
    ops: [13, 15, 15, 15, 15, 18],
    coords: [x, y + h / 2,
      x, y + h, x, y + h, x + w / 2, y + h,
      x + w, y + h, x + w, y + h, x + w, y + h / 2,
      x + w, y, x + w, y, x + w / 2, y,
      x, y, x, y, x, y + h / 2],
  })
  const geometry = (paths: ReturnType<typeof oval>[], scale: number) => extractGeometry({
    fnArray: [OPS.transform, ...paths.map(() => OPS.constructPath)],
    argsArray: [[scale, 0, 0, scale, 12 * scale, 9 * scale],
      ...paths.map(p => [p.ops, p.coords])],
  }, scale)

  it.each([0.7, 1, 1.6])('reads filled and hollow ovals without false dots at scale %s', scale => {
    const black = oval(20, 40, 5, 4)
    const half = oval(40, 40, 5, 4)
    const hole = oval(41, 41, 3, 2)
    const whole = oval(60, 40, 7, 4)
    const wholeHole = oval(62, 41, 3, 2)
    const geo = geometry([black,
      { ops: [...half.ops, ...hole.ops], coords: [...half.coords, ...hole.coords] },
      { ops: [...whole.ops, ...wholeHole.ops], coords: [...whole.coords, ...wholeHole.coords] },
      oval(29, 42, 2, 2)], scale)
    expect(geo.glyphs.map(g => g.str)).toEqual(['\uE0A4', '\uE0A3', '\uE0A2'])
    expect(geo.glyphs[0].x).toBeCloseTo(32)
    expect(geo.dots).toHaveLength(1)
    expect(geo.dots[0].x).toBeCloseTo(42)
    const system = {
      notation: { kind: 'notation' as const, lines: [60, 55.75, 51.5, 47.25, 43], x1: 10, x2: 100 },
      tab,
    }
    expect(notationBeats(geo.glyphs, [], [], geo.dots, system, 10, 100).map(b => b.duration)).toEqual([1.5, 2, 4])
  })

  it('uses a small inner contour only as a hollow-notehead candidate', () => {
    const head = oval(20, 40, 5, 4)
    const hole = oval(21.5, 41.5, 2, 1)
    const geo = geometry([{ ops: [...head.ops, ...hole.ops], coords: [...head.coords, ...hole.coords] }, oval(50, 40, 2, 1)], 1)
    expect(geo.glyphs.map(g => g.str)).toEqual(['\uE0A3'])
    const system = { notation: { kind: 'notation' as const, lines: [60, 55.75, 51.5, 47.25, 43], x1: 10, x2: 100 }, tab }
    expect(notationBeats(geo.glyphs, [], [], [], system, 10, 100).map(b => b.duration)).toEqual([2])
  })

  it.each([0.7, 1, 1.6])('distinguishes an outlined rectangular rest from an oval at scale %s', scale => {
    const roundedRest = {
      ops: [13, 14, 15, 14, 15, 14, 15, 14, 15, 18],
      coords: [20.5, 40, 24.5, 40,
        25, 40, 25, 40, 25, 40.5,
        25, 42, 25, 42.5, 25, 42.5, 24.5, 42.5,
        20.5, 42.5, 20, 42.5, 20, 42.5, 20, 42,
        20, 40.5, 20, 40, 20, 40, 20.5, 40],
    }
    const geo = geometry([roundedRest], scale)
    expect(geo.glyphs.map(g => g.str)).toEqual([String.fromCodePoint(0xf0000)])
    for (const [lines, duration] of [
      [[55.75, 51.5, 47.25, 43, 38.75], 4],
      [[57.5, 53.25, 49, 44.75, 40.5], 2],
    ] as const) {
      const system = { notation: { kind: 'notation' as const, lines: [...lines], x1: 10, x2: 100 }, tab }
      expect(notationBeats(geo.glyphs, [], [], geo.dots, system, 10, 100).map(b => b.duration)).toEqual([duration])
    }
    expect(geo.dots).toHaveLength(0)
  })

  it('retains heavily interrupted staff lines but rejects sparse ledger clusters', () => {
    const fragments = (y: number, n: number) => Array.from({ length: n }, (_, i) => ({ y, x1: 10 + i * 10, x2: 12.8 + i * 10 }))
    const lines = clusterY([...fragments(80, 15), ...fragments(60, 4)], 200, true)
    expect(lines).toHaveLength(1)
    expect(lines[0].y).toBeCloseTo(80)
  })

  it('retains connected notation/TAB barlines in strict mode while rejecting rhythm stems', () => {
    const notation: Staff = { kind: 'notation', lines: [70, 65.75, 61.5, 57.25, 53], x1: 10, x2: 90 }
    expect(barlineXs([{ x: 50, y1: 23.6, y2: 70 }, { x: 70, y1: 30, y2: 55 }], notation, tab, true)).toEqual([10, 50, 90])
    const highNotation = { ...notation, lines: notation.lines.map(y => y + 30) }
    expect(barlineXs([{ x: 50, y1: 23.6, y2: 100 }], highNotation, tab, true)).toEqual([10, 50, 90])
  })

  it('rejects TAB rhythm stems that extend above the staff as barlines', () => {
    const notation: Staff = { kind: 'notation', lines: [80, 75.75, 71.5, 67.25, 63], x1: 10, x2: 90 }
    const vert = [
      { x: 10, y1: 23.6, y2: 42.8 },
      { x: 50, y1: 23.6, y2: 42.8 },
      { x: 70, y1: 30, y2: 55 },
      { x: 90, y1: 23.6, y2: 42.8 },
    ]
    expect(barlineXs(vert, notation, tab, true)).toEqual([10, 50, 90])
    expect(barlineXs(vert, notation, tab)).toEqual([10, 50, 70, 90])
  })
})


describe('synthetic rhythm recovery', () => {
  const system = {
    notation: { kind: 'notation' as const, lines: [100, 95.75, 91.5, 87.25, 83], x1: 10, x2: 150 },
    tab: { kind: 'tab' as const, lines: [55, 48.6, 42.2, 35.8], x1: 10, x2: 150 },
  }
  const glyph = (str: string, x: number, y = 89.9) => ({ str, x, y, w: 5, h: 17 })
  const beam = (x1: number, x2: number, y: number) => ({ x1, x2, y1: y, y2: y })

  it.each([1, -1])('retains a short secondary beam for stem direction %s', direction => {
    const y = 91.5 + direction * 19
    const edges = [beam(33, 73, y), beam(68, 73, y - direction * 3.2)]
      .flatMap(b => [b, { ...b, y1: b.y1 + 2.1, y2: b.y2 + 2.1 }])
    const beams = pairBeamEdges(edges)
    const stems = [33, 73].map(x => ({ x, y1: Math.min(91.5, y), y2: Math.max(91.5, y) }))
    const beats = notationBeats([glyph('\uE0A4', 30), glyph('\uE0A4', 70)], beams, stems, [], system, 10, 150)
    expect(beats.map(b => b.duration)).toEqual([0.5, 0.25])
  })

  it('counts single stroked beams and attached beamlets but excludes detached brackets', () => {
    const stems = [33, 73].map(x => ({ x, y1: 91.5, y2: 112 }))
    const beams = pairBeamEdges([beam(33, 73, 112), beam(68, 73, 108.8), beam(90, 110, 120)], stems)
    expect(beams.map(b => b.bracket)).toEqual([false, false, true])
    expect(notationBeats([glyph('\uE0A4', 30), glyph('\uE0A4', 70)], beams, stems, [], system, 10, 150).map(b => b.duration)).toEqual([0.5, 0.25])
  })

  it.each([1, -1])('counts three stacked stroked levels in either input order for stem direction %s', direction => {
    const tip = 91.5 + direction * 20.5
    const stems = [33, 73].map(x => ({ x, y1: Math.min(91.5, tip), y2: Math.max(91.5, tip) }))
    const edges = [0, 3.2, 6.4].map(offset => beam(33, 73, tip - direction * offset))
    for (const ordered of [edges, [...edges].reverse()]) {
      const beams = pairBeamEdges(ordered, stems)
      expect(beams.map(b => b.bracket)).toEqual([false, false, false])
      expect(notationBeats([glyph('\uE0A4', 30), glyph('\uE0A4', 70)], beams, stems, [], system, 10, 150).map(b => b.duration)).toEqual([0.125, 0.125])
    }
  })

  it('does not count ledger lines near the head as beamlets', () => {
    const stems = [33, 73].map(x => ({ x, y1: 91.5, y2: 112 }))
    const beams = pairBeamEdges([beam(33, 73, 112), beam(28, 35, 99)], stems)
    expect(notationBeats([glyph('\uE0A4', 30), glyph('\uE0A4', 70)], beams, stems, [], system, 10, 150).map(b => b.duration)).toEqual([0.5, 0.5])
  })

  it('does not count short staff segments as single stroked beams', () => {
    const stems = [33, 73].map(x => ({ x, y1: 75, y2: 96 }))
    const beams = pairBeamEdges([beam(20, 100, 95.75)], stems)
    const heads = [30, 70].map(x => glyph('\uE0A4', x, 73.4))
    expect(notationBeats(heads, beams, stems, [], system, 10, 150).map(b => b.duration)).toEqual([1, 1])
  })

  it.each(['3', '5', '6'])('does not scale notes for printed measure number %s at the left barline', digit => {
    const heads = [30, 50, 70].map(x => glyph('\uE0A4', x))
    const stems = heads.map(h => ({ x: h.x + 3, y1: 91.5, y2: 112 }))
    expect(notationBeats([...heads, glyph(digit, 19, 115)], [beam(33, 73, 112)], stems, [], system, 10, 150).map(b => b.duration)).toEqual([0.5, 0.5, 0.5])
  })

  it('scales only the three events centered under a digit on a continuous four-note beam', () => {
    const heads = [30, 45, 60, 75].map(x => glyph('\uE0A4', x))
    const stems = heads.map(h => ({ x: h.x + 3, y1: 91.5, y2: 112 }))
    expect(notationBeats([...heads, glyph('3', 45.5, 119)], [beam(33, 78, 112)], stems, [], system, 10, 150).map(b => b.duration)).toEqual([1 / 3, 1 / 3, 1 / 3, 0.5])
  })

  it('does not borrow a rest dot or count vertically displaced staccato marks', () => {
    const items = [glyph('\uE4E6', 30), glyph('\uE0A4', 40), glyph('\uE0A4', 70)]
    const beats = notationBeats(items, [], [], [{ x: 38, y: 91.5 }, { x: 72, y: 99 }], system, 10, 150)
    expect(beats.map(b => b.duration)).toEqual([0.75, 1, 1])
  })

  it('extracts steep beams and beamlets at normalized page scales', () => {
    for (const scale of [0.7, 1, 1.5]) {
      const coords = [[30, 70, 40, 90], [30, 72.1, 40, 92.1], [35, 75, 39, 75], [35, 77.1, 39, 77.1]]
      const geo = extractGeometry({ fnArray: coords.map(() => OPS.constructPath), argsArray: coords.map(c => [[13, 14], c.map(n => n * scale)]) }, scale)
      expect(pairBeamEdges(geo.beamEdges).filter(b => !b.bracket)).toHaveLength(2)
    }
  })

  it('counts two dots while deduplicating text and path representations', () => {
    const head = glyph('\uE0A3', 30)
    const dots = [glyph('\uE1E7', 38, 91.5), glyph('\uE1E7', 42, 91.5)]
    expect(notationBeats([head, ...dots], [], [], [{ x: 38.5, y: 91.5 }, { x: 42.5, y: 91.5 }], system, 10, 150)[0].duration).toBe(3.5)
  })

  it('finds rest dots across the rest extent and does not borrow a later note dot', () => {
    const rest = { ...glyph('\uE4E6', 30, 86), restBounds: { bottom: 85, top: 98 } }
    expect(notationBeats([rest], [], [], [{ x: 39, y: 96 }, { x: 43, y: 96 }], system, 10, 150)[0].duration).toBe(0.875)
    const beats = notationBeats([glyph('\uE0A4', 60), glyph('\uE0A4', 70), glyph('\uE1E7', 76, 91.5)], [], [], [], system, 10, 150)
    expect(beats.map(b => b.duration)).toEqual([1, 1.5])
  })

  it.each([['3', 3, 1 / 3], ['\uE886', 6, 1 / 3], ['5', 5, 0.4]] as const)('scales %s tuplets exactly', (digit, count, duration) => {
    const heads = Array.from({ length: count }, (_, i) => glyph('\uE0A4', 30 + i * 12))
    const end = 33 + (count - 1) * 12
    const stems = heads.map(h => ({ x: h.x + 3, y1: 91.5, y2: 112 }))
    const number = glyph(digit, (33 + end) / 2 - 2.5, 119)
    const beats = notationBeats([...heads, number], [beam(33, end, 112)], stems, [], system, 10, 150)
    expect(beats.map(b => b.duration)).toEqual(Array(count).fill(duration))
  })

  it('uses bracket bounds for a mixed triplet and excludes bracket rules from beam counts', () => {
    const heads = [glyph('\uE0A4', 30), glyph('\uE0A4', 50), glyph('\uE0A3', 70), glyph('\uE0A3', 100)]
    const beams = [
      { ...beam(29, 37, 120), bracket: true },
      { ...beam(44, 77, 120), bracket: true },
    ]
    const beats = notationBeats([...heads, glyph('3', 38, 119), glyph('\uE240', 52, 105)], beams,
      [{ x: 33, y1: 91.5, y2: 112 }, { x: 53, y1: 91.5, y2: 112 }], [], system, 10, 150)
    expect(beats.map(b => b.duration)).toEqual([2 / 3, 1 / 3, 4 / 3, 2])
  })

  it('does not use a centered tuplet digit as a printed bar number', () => {
    const heads = [30, 50, 70].map(x => glyph('\uE0A4', x))
    const items = [glyph('3', 48, 108), glyph('24', 11, 103), ...heads]
    expect(printedMeasureNumber(items, [beam(33, 73, 112)], system, 10, 150)).toBe(24)
    expect(printedMeasureNumber([items[0], ...heads], [beam(33, 73, 112)], system, 10, 150)).toBeUndefined()
  })

  it('ignores fret digits from adjacent systems when finding tuplets', () => {
    const beats = notationBeats([glyph('\uE0A4', 30), { ...glyph('3', 50, 119), tabDigit: true }], [], [], [], system, 10, 150)
    expect(beats[0].duration).toBe(1)
  })

  it('keeps a sparse TAB line supported by dense parallel neighbors', () => {
    const dense = [75, 62.2].map(y => ({ y, x1: 20, x2: 420 }))
    const sparse = Array.from({ length: 10 }, (_, i) => ({ y: 68.6, x1: 20 + i * 44, x2: 24 + i * 44 }))
    expect(clusterY([...dense, ...sparse], 200, true).some(l => Math.abs(l.y - 68.6) < 1e-8)).toBe(true)
  })

  it('retains a sparse bottom TAB line supported from above', () => {
    const dense = [81.4, 75].map(y => ({ y, x1: 20, x2: 420 }))
    const sparse = Array.from({ length: 10 }, (_, i) => ({ y: 68.6, x1: 20 + i * 44, x2: 24 + i * 44 }))
    expect(clusterY([...dense, ...sparse], 200, true).some(l => Math.abs(l.y - 68.6) < 1e-8)).toBe(true)
  })

  it('skips interleaved decorative rules when recovering a staff', () => {
    const lines = [70, 63.6, 57.2, 50.8].map(y => ({ y, x1: 20, x2: 140 }))
    const rules = [67, 61, 55].map(y => ({ y, x1: 0, x2: 160 }))
    expect(findStaves([...lines, ...rules], 1).find(s => s.kind === 'tab')?.lines).toEqual(lines.map(l => l.y))
  })
})

describe('fillMeasureGaps with synthetic numbering', () => {
  const ts = { beats: 3, beatType: 4 }
  const measures = (numbers: Array<number | undefined>): GpMeasure[] => numbers.map(number => ({
    number, timeSignature: ts, beats: [{ duration: 3, notes: [] }],
  }))
  it('inserts bar-length rests only between supported runs, including sparse anchors', () => {
    const input = measures([20, 21, undefined, 25, 26, 27])
    const out = fillMeasureGaps(input, ts)
    expect(out).toHaveLength(8)
    expect(out.slice(3, 5).map(m => m.beats)).toEqual([[{ duration: 3, notes: [] }], [{ duration: 3, notes: [] }]])
    expect(input).toHaveLength(6)
    expect(out[5].number).toBe(25)
  })
  it.each([[20, 21, 40, 41, 42], [20, 21, 25, 27, 28], [20, 21, 3, 23, 24, 25], [20, 21, 19, 20, 21]])('ignores implausible or unsupported jumps: %j', (...numbers) => {
    expect(fillMeasureGaps(measures(numbers), ts)).toHaveLength(numbers.length)
  })
})
