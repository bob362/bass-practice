import { describe, expect, expectTypeOf, it } from 'vitest'
import { findStaves, fretsInMeasure, pairSystems, staffScale, tuningHeaderText, type Staff } from './gpPdfParser'

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
