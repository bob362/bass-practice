import { expect, it } from 'vitest'
import { OnsetDetector } from './onset'
const frame = (v: number) => new Float32Array(128).fill(v)
it('detects energy rises with a minimum and 60ms refractory period', () => {
  const detector = new OnsetDetector()
  expect(detector.push(frame(0.001), 0)).toBe(false)
  expect(detector.push(frame(0.1), 0.01)).toBe(true)
  expect(detector.push(frame(0.1), 0.02)).toBe(false)
  detector.push(frame(0), 0.03)
  expect(detector.push(frame(0.2), 0.04)).toBe(false)
  detector.push(frame(0), 0.07)
  expect(detector.push(frame(0.2), 0.08)).toBe(true)
})
