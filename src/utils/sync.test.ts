import { expect, it } from 'vitest'
import { tabToVideoTime, videoToTabTime } from './sync'
it('applies rates and offset and inverts without clamping', () => {
  const settings = { offsetSec: -3, tempoPercent: 50, playbackRate: 0.75 }
  expect(tabToVideoTime(10, settings)).toBe(12)
  expect(videoToTabTime(12, settings)).toBe(10)
  expect(tabToVideoTime(0, settings)).toBe(-3)
  expect(tabToVideoTime(10, { tempoPercent: 50, playbackRate: 0.5 })).toBe(10)
  expect(() => tabToVideoTime(10, { tempoPercent: 0 })).toThrow()
})
