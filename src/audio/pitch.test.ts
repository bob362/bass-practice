import { expect, it } from 'vitest'
import { detectPitch, hzToMidi, midiToHz, midiToName, rms } from './pitch'
for (const sampleRate of [44100, 48000]) for (const hz of [30.87, 36.71, 41.2, 55, 73.42, 98, 196]) {
  it(`detects ${hz}Hz at ${sampleRate}`, () => {
    const buf = Float32Array.from({ length: 4096 }, (_, i) => 0.3 * Math.sin(2 * Math.PI * hz * i / sampleRate))
    const result = detectPitch(buf, sampleRate)!
    expect(Math.abs(result.hz / hz - 1)).toBeLessThan(0.01)
    expect(hzToMidi(result.hz)).toBe(hzToMidi(hz))
    expect(result.clarity).toBeGreaterThan(0.9)
  })
}
it('detects a noisy harmonic bass waveform', () => {
  let seed = 1234
  const buf = Float32Array.from({ length: 4096 }, (_, i) => {
    seed = (1664525 * seed + 1013904223) >>> 0
    const phase = 2 * Math.PI * 41.2 * i / 48000
    return [1, 2, 3, 4, 5].reduce((v, h) => v + 0.25 * Math.sin(phase * h) / h, 0) + (seed / 2 ** 32 - 0.5) * 0.03
  })
  expect(Math.abs(detectPitch(buf, 48000)!.hz / 41.2 - 1)).toBeLessThan(0.01)
})
it('rejects silence and aperiodic noise and converts pitches', () => {
  expect(detectPitch(new Float32Array(4096), 44100)).toBeNull()
  let seed = 77
  const noise = Float32Array.from({ length: 4096 }, () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32 - 0.5 })
  expect(detectPitch(noise, 44100)).toBeNull()
  expect(rms(new Float32Array([1, -1]))).toBe(1)
  expect(midiToName(28)).toBe('E1')
  expect(midiToHz(69)).toBe(440)
})
