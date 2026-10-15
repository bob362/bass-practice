import { expect, it } from 'vitest'
import { judgeLive, scoreAttempt } from './scoring'
import type { PlainNote } from './scoreModel'
const note = (id: string, startSec: number, extra = {}): PlainNote => ({ id, startSec, bar: 1, startTick: startSec * 1920, durationTicks: 960, durationSec: 0.5, string: 4, fret: 0, midi: 28, ghost: false, dead: false, tie: false, slide: false, ...extra })
it('scores timing, pitch and ignored targets without reusing detections', () => {
  const expected = [0, 1, 2, 3, 4, 5].map((t, i) => note(String(i), t))
  expected.push(note('dead', 6, { dead: true }), note('tie', 7, { tie: true }))
  const result = scoreAttempt(expected, [{ timeSec: 0.05, midi: 40 }, { timeSec: 0.8, midi: 28 }, { timeSec: 2.25, midi: 28 }, { timeSec: 3, midi: 29 }])
  expect(result.results.map(r => r.verdict)).toEqual(['hit', 'early', 'late', 'wrong_pitch', 'miss', 'miss'])
  expect(result.accuracy).toBeCloseTo(100 / 3)
  expect(result.counts.total).toBe(6)
  expect(scoreAttempt([note('a', 0), note('b', 0)], [{ timeSec: 0, midi: 28 }]).counts.hits).toBe(1)
  expect(scoreAttempt([note('a', 0)], [{ timeSec: 0, midi: 40 }], { octaveTolerant: false }).results[0].verdict).toBe('wrong_pitch')
  expect(judgeLive(expected, { timeSec: 2.1, midi: 28 })?.noteId).toBe('2')
  expect(judgeLive([], { timeSec: 0, midi: 28 })).toBeNull()
  expect(scoreAttempt([], []).accuracy).toBe(0)
})
