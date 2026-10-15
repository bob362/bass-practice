export interface PlainNote {
  id: string; bar: number; startTick: number; durationTicks: number; startSec: number; durationSec: number
  string: number; fret: number; midi: number; ghost: boolean; dead: boolean; slide: boolean; tie: boolean
}
export interface PlainScore {
  title: string; tempo: number; tuning: number[]
  bars: { index: number; startTick: number; durationTicks: number; numerator: number; denominator: number }[]
  notes: PlainNote[]
}
// alphaTab's model has varied between releases; access only its public-shaped data.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractPlainScore(score: any): PlainScore {
  const tempo = score?.tempo > 0 ? Number(score.tempo) : 120
  const staff = score?.tracks?.[0]?.staves?.[0]
  const tuning: number[] = [...(staff?.tunings ?? staff?.stringTuning?.tunings ?? [])]
  const seconds = 60 / (tempo * 960)
  let cursor = 0
  const bars: PlainScore['bars'] = (score?.masterBars ?? []).map((mb: any, i: number) => {
    const numerator = mb.timeSignatureNumerator ?? 4, denominator = mb.timeSignatureDenominator ?? 4
    const startTick = mb.start ?? cursor
    const durationTicks = typeof mb.calculateDuration === 'function' ? mb.calculateDuration() : numerator * 3840 / denominator
    cursor = startTick + durationTicks
    return { index: i + 1, startTick, durationTicks, numerator, denominator }
  })
  const notes: PlainNote[] = []
  bars.forEach(bar => {
    const beats = staff?.bars?.[bar.index - 1]?.voices?.[0]?.beats ?? []
    beats.forEach((beat: any, j: number) => {
      const startTick = beat.absolutePlaybackStart ?? ((beat.playbackStart ?? 0) + bar.startTick)
      const durationTicks = beat.playbackDuration ?? 960
      ;(beat.notes ?? []).forEach((note: any, k: number) => notes.push({
        id: `${bar.index}:${j}:${k}`, bar: bar.index, startTick, durationTicks, startSec: startTick * seconds, durationSec: durationTicks * seconds,
        string: note.string, fret: note.fret, midi: note.realValue ?? tuning[note.string - 1] + note.fret,
        ghost: !!note.isGhost, dead: !!note.isDead, slide: !!(note.slideOutType || note.slideInType), tie: !!note.isTieDestination,
      }))
    })
  })
  return { title: score?.title ?? '', tempo, tuning, bars, notes }
}
export const notesInBars = (score: PlainScore, startBar: number, endBar: number): PlainNote[] => score.notes.filter(n => n.bar >= startBar && n.bar <= endBar)
/** Half-open range of note attacks. */
export const notesInTickRange = (score: PlainScore, startTick: number, endTick: number): PlainNote[] => score.notes.filter(n => n.startTick >= startTick && n.startTick < endTick)
