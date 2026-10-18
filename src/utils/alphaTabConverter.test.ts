import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { importer } from '@coderline/alphatab'
import { convertToAlphaTab, texToEditable, editableToTex } from './alphaTabConverter'
import { extractPlainScore } from './scoreModel'

const load = (tex: string) => importer.ScoreLoader.loadAlphaTex(tex)
const staffOf = (tex: string) => load(tex).tracks[0].staves[0]
const pitches = (tex: string) => staffOf(tex).bars.flatMap(b => b.voices[0].beats.flatMap(b => b.notes.map(n => n.realValue)))
const internal = { measures: [{ notes: [
  { string: 1, fret: 0, position: 0 }, { string: 4, fret: 0, position: 1 },
] }], tempo: 120 }

describe('convertToAlphaTab', () => {
  it('reverses internal tuning and strings while preserving pitch', () => {
    const tex = convertToAlphaTab(internal)
    expect(tex).toContain('\\tuning (G2 D2 A1 E1)')
    expect(staffOf(tex).stringTuning.tunings).toEqual([43, 38, 33, 28])
    expect(pitches(tex)).toEqual([28, 43])
    expect(extractPlainScore(load(tex)).notes[0]).toMatchObject({ string: 4, midi: 28 })
  })
  it('maps dead notes from internal lowest string to bottom TAB line', () => {
    // Internal string 1 becomes alphaTex string 4, including dead notes.
    expect(convertToAlphaTab({ measures: [{ notes: [{ string: 1, fret: 0, position: 0, dead: true }] }] })).toContain('x.4')
  })
  it('maps regular notes and chords to alphaTex strings', () => {
    // Internal string 3 is alphaTex string 2 on a four-string bass.
    expect(convertToAlphaTab({ measures: [{ notes: [{ string: 3, fret: 5, position: 0 }, { string: 1, fret: 0, position: 0 }] }] })).toContain('(5.2 0.4)')
  })
  it('maps five-string GP beats from low to high', () => {
    // GP strings share the internal low-first convention.
    const tex = convertToAlphaTab({ tuning: 'B0 E1 A1 D2 G2', measures: [{ notes: [], gp: {
      beats: [1, 2, 3, 4, 5].map(string => ({ duration: 1, notes: [{ string, fret: 0 }] })),
      timeSignature: { beats: 4, beatType: 4 },
    } }] })
    expect(staffOf(tex).stringTuning.tunings).toEqual([43, 38, 33, 28, 23])
    expect(pitches(tex)).toEqual([23, 28, 33, 38, 43])
  })
  it.each([5, 6, 7])('expands missing tuning for internal string %i', string => {
    const tex = convertToAlphaTab({ measures: [{ notes: [{ string, fret: 0, position: 0 }] }] })
    expect(staffOf(tex).stringTuning.tunings).toHaveLength(string)
    expect(tex).toContain('0.1')
  })
  it.each([
    ['D1 A1 D2 G2', 'G2 D2 A1 D1 A0'],
    ['', 'G2 D2 A1 E1 B0'],
    ['invalid', 'G2 D2 A1 E1 B0'],
  ])('extends tuning %s below its lowest string', (tuning, expected) => {
    const tex = convertToAlphaTab({ tuning, measures: [{ notes: [{ string: 5, fret: 0, position: 0 }] }] })
    expect(tex).toContain(`\\tuning (${expected})`)
  })
  it('maps GP chords and dead notes', () => {
    const tex = convertToAlphaTab({ measures: [{ notes: [], gp: {
      beats: [{ duration: 1, notes: [{ string: 1, fret: 0, dead: true }, { string: 4, fret: 2 }] }],
      timeSignature: { beats: 4, beatType: 4 },
    } }] })
    expect(tex).toContain('(x.4 2.1)')
  })
})

describe('tex <-> editable', () => {
  it('preserves tuning and measure tokens through review', () => {
    // Review data already uses alphaTex order; a second reversal would change pitches.
    const tex = convertToAlphaTab(internal)
    const editable = texToEditable(tex)
    expect(editable.metadata.tuning).toBe('G2 D2 A1 E1')
    const back = editableToTex(editable)
    expect(back.match(/^\\tuning.*$/m)?.[0]).toBe(tex.match(/^\\tuning.*$/m)?.[0])
    expect(texToEditable(back)).toEqual(editable)
    expect(editableToTex({ metadata: { tuning: '' }, measures: [] })).toContain('\\tuning (G2 D2 A1 E1)')
  })
})

it('preserves every original sample pitch with high-first tuning', () => {
  const tex = readFileSync('public/sample-bass.tex', 'utf8')
  expect(staffOf(tex).stringTuning.tunings).toEqual([43, 38, 33, 28])
  // The original E-minor-pentatonic riff uses alphaTex string 4 for low E.
  expect(pitches(tex)).toEqual([28, 28, 31, 33, 38, 38, 36, 33, 28, 31, 33, 35, 28])
})
