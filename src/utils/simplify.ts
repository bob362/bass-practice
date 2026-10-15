import { midiToName } from '../audio/pitch'
import type { PlainNote, PlainScore } from './scoreModel'
export type SimplifyLevel = 0 | 1 | 2 | 3
export interface SimplifyOptions { startBar?: number; endBar?: number; maxSpan?: number; fretRange?: { maxSpan?: number } }
export function simplifyScore(score: PlainScore, level: SimplifyLevel, opts: SimplifyOptions = {}): PlainScore {
  const inside = (n: PlainNote) => n.bar >= (opts.startBar ?? 1) && n.bar <= (opts.endBar ?? Infinity)
  let selected = score.notes.filter(inside).map(n => ({ ...n }))
  const seconds = 60 / (score.tempo * 960)
  if (level >= 1) {
    selected = selected.filter(n => !n.ghost && !n.dead).sort((a, b) => a.startTick - b.startTick)
    const merged: PlainNote[] = []
    for (const n of selected) {
      const previous = [...merged].reverse().find(p => p.string === n.string && p.midi === n.midi && p.startTick + p.durationTicks === n.startTick)
      if (n.tie && previous) { previous.durationTicks += n.durationTicks; previous.durationSec = previous.durationTicks * seconds }
      else merged.push({ ...n, slide: false, tie: false })
    }
    selected = merged
  }
  if (level >= 2) {
    const reduced: PlainNote[] = []
    for (const bar of score.bars) {
      const step = level === 3 ? bar.durationTicks / 2 : 960
      for (let start = bar.startTick; start < bar.startTick + bar.durationTicks; start += step) {
        const end = Math.min(start + step, bar.startTick + bar.durationTicks)
        const candidates = selected.filter(n => n.bar === bar.index && n.startTick >= start && n.startTick < end)
        if (!candidates.length) continue
        if (level === 3) {
          const counts = new Map<number, number>()
          candidates.forEach(n => counts.set(n.midi, (counts.get(n.midi) ?? 0) + 1))
          candidates.sort((a, b) => (counts.get(b.midi)! - counts.get(a.midi)!) || a.midi - b.midi)
        } else candidates.sort((a, b) => a.startTick - b.startTick)
        const n = candidates[0]
        const attack = level === 3 ? start : n.startTick
        reduced.push({ ...n, startTick: attack, startSec: attack * seconds, durationTicks: end - attack, durationSec: (end - attack) * seconds })
      }
    }
    selected = reduced
  }
  if (opts.maxSpan !== undefined || opts.fretRange !== undefined) {
    const maxSpan = Math.max(0, opts.maxSpan ?? opts.fretRange?.maxSpan ?? 5)
    const frets = selected.map(n => n.fret).sort((a, b) => a - b)
    const median = frets[Math.floor(frets.length / 2)] ?? 0
    const positions = selected.map(n => score.tuning.map((t, i) => ({ string: i + 1, fret: n.midi - t })).filter(p => Number.isInteger(p.fret) && p.fret >= 0 && p.fret <= 24))
    let bestStart = Math.max(0, median - maxSpan / 2), bestCount = -1, bestDistance = Infinity
    for (let start = 0; start <= 24; start++) {
      const count = positions.filter(ps => ps.some(p => p.fret >= start && p.fret <= start + maxSpan)).length
      const distance = Math.abs(start + maxSpan / 2 - median)
      if (count > bestCount || (count === bestCount && distance < bestDistance)) { bestStart = start; bestCount = count; bestDistance = distance }
    }
    selected = selected.map((n, i) => {
      const candidates = positions[i].filter(p => p.fret >= bestStart && p.fret <= bestStart + maxSpan)
      const p = (candidates.length ? candidates : positions[i]).sort((a, b) => Math.abs(a.fret - median) - Math.abs(b.fret - median))[0]
      return p ? { ...n, ...p } : n
    })
  }
  return { ...score, tuning: [...score.tuning], bars: score.bars.map(b => ({ ...b })), notes: [...score.notes.filter(n => !inside(n)), ...selected].sort((a, b) => a.startTick - b.startTick) }
}
const durations = [1, 2, 4, 8, 16, 32].flatMap(d => [{ ticks: 3840 / d * 1.5, d, dotted: true }, { ticks: 3840 / d, d, dotted: false }]).sort((a, b) => b.ticks - a.ticks)
/** Export a single voice; simultaneous notes become chords, sustained notes split with ties. */
export function toAlphaTex(score: PlainScore): string {
  let lastSignature = ''
  const bars = score.bars.map(bar => {
    const signature = `${bar.numerator} ${bar.denominator}`
    const prefix = signature !== lastSignature ? `\\ts ${signature} ` : ''
    lastSignature = signature
    const end = bar.startTick + bar.durationTicks
    const notes = score.notes.filter(n => n.startTick < end && n.startTick + n.durationTicks > bar.startTick)
    const boundaries = [...new Set([bar.startTick, end, ...notes.flatMap(n => [Math.max(bar.startTick, n.startTick), Math.min(end, n.startTick + n.durationTicks)])])].sort((a, b) => a - b)
    const tokens: string[] = []
    for (let i = 0; i < boundaries.length - 1; i++) {
      let tick = boundaries[i], remaining = boundaries[i + 1] - tick
      while (remaining > 0) {
        const duration = durations.find(d => d.ticks <= remaining + 1e-7)
        if (!duration) throw new Error('alphaTex export requires durations representable with 32nd notes and dots')
        const active = notes.filter(n => n.startTick <= tick && n.startTick + n.durationTicks > tick)
        const contents = active.map(n => `${n.dead ? 'x' : n.fret}.${n.string}${n.startTick < tick || n.tie ? '{t}' : ''}`)
        const body = contents.length > 1 ? `(${contents.join(' ')})` : contents[0] ?? 'r'
        tokens.push(`${body}.${duration.d}${duration.dotted ? '{d}' : ''}`)
        tick += duration.ticks; remaining -= duration.ticks
      }
    }
    return prefix + tokens.join(' ')
  })
  return [`\\title "${score.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ')}"`, `\\tempo ${score.tempo}`, `\\tuning ${score.tuning.map(midiToName).join(' ')}`, '.', bars.join(' | ')].join('\n')
}
