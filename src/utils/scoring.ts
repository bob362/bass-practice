import type { PlainNote } from './scoreModel'
export interface DetectedNote { timeSec: number; midi: number }
export type Verdict = 'hit' | 'early' | 'late' | 'miss' | 'wrong_pitch'
export interface NoteResult { noteId: string; verdict: Verdict; deltaSec?: number; detectedMidi?: number }
export interface ScoringOptions { windowSec?: number; lateMax?: number; octaveTolerant?: boolean }
function judge(note: PlainNote, detected: DetectedNote, opts: ScoringOptions): NoteResult {
  const deltaSec = detected.timeSec - note.startSec
  const difference = Math.abs(detected.midi - note.midi)
  const pitch = difference === 0 || ((opts.octaveTolerant ?? true) && difference === 12)
  const verdict: Verdict = Math.abs(deltaSec) > (opts.lateMax ?? 0.35) ? 'miss' : !pitch ? 'wrong_pitch' : Math.abs(deltaSec) <= (opts.windowSec ?? 0.15) ? 'hit' : deltaSec < 0 ? 'early' : 'late'
  return { noteId: note.id, verdict, deltaSec, detectedMidi: detected.midi }
}
export function scoreAttempt(expected: PlainNote[], detected: DetectedNote[], opts: ScoringOptions = {}) {
  const available = detected.map((d, i) => ({ d, i })).sort((a, b) => a.d.timeSec - b.d.timeSec)
  const results: NoteResult[] = [...expected].filter(n => !n.dead && !n.tie).sort((a, b) => a.startSec - b.startSec).map(note => {
    let best = -1, distance = Infinity
    available.forEach(({ d }, i) => { const gap = Math.abs(d.timeSec - note.startSec); if (gap <= (opts.lateMax ?? 0.35) && gap < distance) { best = i; distance = gap } })
    if (best < 0) return { noteId: note.id, verdict: 'miss' }
    return judge(note, available.splice(best, 1)[0].d, opts)
  })
  const counts = { hits: 0, early: 0, late: 0, misses: 0, wrong_pitch: 0, total: results.length }
  for (const r of results) { if (r.verdict === 'hit') counts.hits++; else if (r.verdict === 'miss') counts.misses++; else counts[r.verdict]++ }
  return { results, accuracy: results.length ? 100 * (counts.hits + 0.5 * (counts.early + counts.late)) / results.length : 0, counts }
}
export function judgeLive(expected: PlainNote[], detectedOne: DetectedNote, opts: ScoringOptions = {}): NoteResult | null {
  const nearest = expected.filter(n => !n.dead && !n.tie).reduce<PlainNote | undefined>((best, n) => !best || Math.abs(n.startSec - detectedOne.timeSec) < Math.abs(best.startSec - detectedOne.timeSec) ? n : best, undefined)
  return nearest ? judge(nearest, detectedOne, opts) : null
}
