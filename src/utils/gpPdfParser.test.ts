import { describe, expect, expectTypeOf, it } from 'vitest'
import { fretsInMeasure, tuningHeaderText, type Staff } from './gpPdfParser'

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
