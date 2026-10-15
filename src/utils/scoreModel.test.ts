import { expect, it } from 'vitest'
import { extractPlainScore, notesInBars, notesInTickRange } from './scoreModel'
// alphaTab model: note.string 1 = lowest string; PlainScore: 1 = highest (alphaTex order)
it('extracts alphaTab timing, tuning, flags and fallback pitch', () => {
  const score = extractPlainScore({ title: 'Bass', tempo: 120, masterBars: [
    { start: 0, timeSignatureNumerator: 4, timeSignatureDenominator: 4, calculateDuration: () => 3840 },
    { start: 3840, timeSignatureNumerator: 3, timeSignatureDenominator: 4 },
  ], tracks: [{ staves: [{ stringTuning: { tunings: [43, 38, 33, 28] }, bars: [
    { voices: [{ beats: [{ absolutePlaybackStart: 960, playbackDuration: 480, notes: [{ string: 4, fret: 2, realValue: 30, isGhost: true, slideInType: 1 }] }] }] },
    { voices: [{ beats: [{ playbackStart: 480, playbackDuration: 960, notes: [{ string: 3, fret: 2, isDead: true, isTieDestination: true }] }] }] },
  ] }] }] })
  expect(score.notes[0]).toMatchObject({ bar: 1, startSec: 0.5, durationSec: 0.25, string: 1, midi: 30, ghost: true, slide: true })
  expect(score.notes[1]).toMatchObject({ startTick: 4320, string: 2, midi: 40, dead: true, tie: true })
  expect(score.bars[1].durationTicks).toBe(2880)
  expect(notesInBars(score, 2, 2)).toEqual([score.notes[1]])
  expect(notesInTickRange(score, 960, 4320)).toEqual([score.notes[0]])
  expect(extractPlainScore({}).notes).toEqual([])
})
