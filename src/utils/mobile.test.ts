import { describe, it, expect, vi } from 'vitest'
import { DESKTOP_SCORE_SCALE, scoreScaleForWidth, stepTempo } from './mobile'

describe('scoreScaleForWidth', () => {
  it.each([
    [0, DESKTOP_SCORE_SCALE], [NaN, DESKTOP_SCORE_SCALE],
    [-1, DESKTOP_SCORE_SCALE], [Infinity, DESKTOP_SCORE_SCALE],
    [360, 0.8], [399, 0.8], [400, 0.9], [767, 0.9],
    [768, DESKTOP_SCORE_SCALE], [1440, DESKTOP_SCORE_SCALE],
  ])('%s -> %s', (width, scale) => {
    expect(scoreScaleForWidth(width)).toBe(scale)
  })
})

describe('stepTempo', () => {
  it('clamps, rounds and defaults non-finite values', () => {
    const step = vi.fn(stepTempo)
    expect(step(50, -5)).toBe(50)
    expect(step(120, 5)).toBe(120)
    expect(step(99.4, 5)).toBe(104)
    expect(step(99.5, 5)).toBe(105)
    expect(step(NaN, 5)).toBe(105)
    expect(step(Infinity, -5)).toBe(95)
    expect(step(100, 5, 60, 102)).toBe(102)
  })
})
