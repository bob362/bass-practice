import { expect, it } from 'vitest'
import { importer } from '@coderline/alphatab'
import { simplifyScore, toAlphaTex } from './simplify'
import { extractPlainScore } from './scoreModel'
import type { PlainNote, PlainScore } from './scoreModel'
const note = (id: string, tick: number, extra: Partial<PlainNote> = {}): PlainNote => ({ id, bar: tick < 3840 ? 1 : 2, startTick: tick, durationTicks: 480, startSec: tick / 1920, durationSec: 0.25, string: 4, fret: 0, midi: 28, ghost: false, dead: false, slide: false, tie: false, ...extra })
const score: PlainScore = { title: 'Bass', tempo: 120, tuning: [43, 38, 33, 28], bars: [1, 2].map((index) => ({ index, startTick: (index - 1) * 3840, durationTicks: 3840, numerator: 4, denominator: 4 })), notes: [note('a', 0, { slide: true }), note('tie', 480, { tie: true }), note('ghost', 960, { ghost: true }), note('dead', 1440, { dead: true }), note('b', 1920), note('c', 2400), note('other', 3840)] }
it('preserves level zero and merges ties and removes ornaments at level one', () => {
  expect(simplifyScore(score, 0)).toEqual(score)
  const result = simplifyScore(score, 1)
  expect(result.notes.map(n => n.id)).toEqual(['a', 'b', 'c', 'other'])
  expect(result.notes[0]).toMatchObject({ durationTicks: 960, durationSec: 0.5, slide: false })
  expect(score.notes[0].durationTicks).toBe(480)
})
it('reduces quarters, half bars, and respects bar ranges', () => {
  const quarters = simplifyScore(score, 2, { startBar: 1, endBar: 1 })
  expect(quarters.notes.filter(n => n.bar === 1).map(n => n.durationTicks)).toEqual([960, 960])
  expect(quarters.notes.find(n => n.id === 'other')).toEqual(score.notes[6])
  expect(simplifyScore(score, 3).notes.filter(n => n.bar === 1).map(n => [n.startTick, n.durationTicks])).toEqual([[0, 1920], [1920, 1920]])
})
it('remaps pitches into a playable fret window', () => {
  const input = { ...score, notes: [note('a', 0, { midi: 43, fret: 15 }), note('b', 960, { midi: 45, fret: 12, string: 3 }), note('c', 1920, { midi: 47, fret: 9, string: 2 })] }
  const notes = simplifyScore(input, 0, { maxSpan: 3 }).notes
  expect(Math.max(...notes.map(n => n.fret)) - Math.min(...notes.map(n => n.fret))).toBeLessThanOrEqual(3)
  notes.forEach(n => { expect(input.tuning[n.string - 1] + n.fret).toBe(n.midi); expect(n.fret).toBeGreaterThanOrEqual(0); expect(n.fret).toBeLessThanOrEqual(24) })
})
it('exports parsable alphaTex with rests, dots, chords, ties and changing meters', () => {
  const input = { ...score, notes: [note('a', 0, { durationTicks: 1440 }), note('chord', 0, { string: 3, midi: 33, durationTicks: 1440 }), note('long', 2880, { durationTicks: 1920 })], bars: [...score.bars, { index: 3, startTick: 7680, durationTicks: 2880, numerator: 3, denominator: 4 }] }
  const tex = toAlphaTex(input)
  expect(tex).toContain('\\tuning G2 D2 A1 E1')
  expect(tex).toContain('{d}')
  expect(tex).toContain('\\ts 3 4')
  const parsed = importer.ScoreLoader.loadAlphaTex(tex)
  const plain = extractPlainScore(parsed)
  expect(plain.bars.map(b => b.durationTicks)).toEqual([3840, 3840, 2880])
  parsed.tracks[0].staves[0].bars.forEach((bar, i) => expect(bar.voices[0].beats.reduce((sum, b) => sum + b.playbackDuration, 0)).toBe(input.bars[i].durationTicks))
})
it('chooses frequent roots with lowest-pitch ties and retains the first attack within a quarter', () => {
  const input = { ...score, notes: [note('high', 240, { midi: 40 }), note('low', 480, { midi: 28 }), note('repeat', 960, { midi: 40 }), note('lower', 1920, { midi: 28 }), note('upper', 2400, { midi: 33 })] }
  expect(simplifyScore(input, 3).notes.map(n => n.midi)).toEqual([40, 28])
  expect(simplifyScore(input, 2).notes[0]).toMatchObject({ startTick: 240, durationTicks: 720 })
})
