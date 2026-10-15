export function rms(buf: Float32Array): number {
  return Math.sqrt(buf.reduce((sum, x) => sum + x * x, 0) / (buf.length || 1))
}
export const hzToMidi = (hz: number): number => Math.round(69 + 12 * Math.log2(hz / 440))
export const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12)
export function midiToName(midi: number): string {
  const n = Math.round(midi)
  return `${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`
}
export function detectPitch(buf: Float32Array, sampleRate: number, opts: { minHz?: number; maxHz?: number; threshold?: number } = {}): { hz: number; clarity: number } | null {
  const { minHz = 30, maxHz = 1000, threshold = 0.15 } = opts
  if (!(sampleRate > 0 && minHz > 0 && maxHz >= minHz) || rms(buf) < 0.01) return null
  const max = Math.min(Math.floor(sampleRate / minHz), Math.floor(buf.length / 2))
  const min = Math.max(2, Math.floor(sampleRate / maxHz))
  if (max <= min) return null
  const d = new Float64Array(max + 2)
  const size = buf.length - max - 1
  let sum = 0
  for (let tau = 1; tau <= max + 1; tau++) {
    let difference = 0
    for (let i = 0; i < size; i++) difference += (buf[i] - buf[i + tau]) ** 2
    sum += difference
    d[tau] = sum ? difference * tau / sum : 1
  }
  for (let tau = min; tau <= max; tau++) {
    if (d[tau] >= threshold) continue
    while (tau < max && d[tau + 1] < d[tau]) tau++
    const denominator = d[tau - 1] - 2 * d[tau] + d[tau + 1]
    const offset = denominator ? 0.5 * (d[tau - 1] - d[tau + 1]) / denominator : 0
    const hz = sampleRate / (tau + Math.max(-1, Math.min(1, offset)))
    return hz >= minHz && hz <= maxHz ? { hz, clarity: Math.max(0, 1 - d[tau]) } : null
  }
  return null
}
