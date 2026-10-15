import { rms } from './pitch'
export class OnsetDetector {
  private previous = 0
  private lastOnset = -Infinity
  constructor(private readonly opts: { ratioThreshold?: number; minRms?: number; refractorySec?: number } = {}) {}
  push(buf: Float32Array, timeSec: number): boolean {
    const energy = rms(buf)
    const onset = energy >= (this.opts.minRms ?? 0.01) && energy > this.previous * (this.opts.ratioThreshold ?? 1.8) && timeSec - this.lastOnset >= (this.opts.refractorySec ?? 0.06)
    this.previous = energy
    if (onset) this.lastOnset = timeSec
    return onset
  }
}
