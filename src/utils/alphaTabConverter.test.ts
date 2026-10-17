import { describe, expect, it } from 'vitest'
import { convertToAlphaTab, texToEditable, editableToTex } from './alphaTabConverter'

describe('convertToAlphaTab', () => {
  it('死に音符を x.弦番号 に出力する', () => {
    const tex = convertToAlphaTab({
      measures: [{ notes: [{ string: 4, fret: 0, position: 0, dead: true }] }],
      tempo: 120,
    })
    expect(tex).toContain('x.4')
  })

  it('通常の音符は フレット.弦番号 のまま', () => {
    const tex = convertToAlphaTab({
      measures: [{ notes: [{ string: 3, fret: 5, position: 0 }] }],
      tempo: 120,
    })
    expect(tex).toContain('5.3')
  })
})

describe('tex <-> editable', () => {
  it('往復できる', () => {
    const tex = convertToAlphaTab({ measures: [{ notes: [] }], tempo: 110 })
    const editable = texToEditable(tex)
    const back = editableToTex(editable)
    expect(texToEditable(back).metadata).toEqual(editable.metadata)
  })
})
