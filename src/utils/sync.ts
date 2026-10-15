export interface SyncSettings {
  offsetSec?: number
  tempoPercent?: number
  playbackRate?: number
}

function rates({ offsetSec = 0, tempoPercent = 100, playbackRate = 1 }: SyncSettings) {
  if (!Number.isFinite(offsetSec) || !Number.isFinite(tempoPercent) || tempoPercent <= 0 || !Number.isFinite(playbackRate) || playbackRate <= 0) {
    throw new RangeError('Offset must be finite and rates must be positive')
  }
  return { offsetSec, ratio: playbackRate / (tempoPercent / 100) }
}

/** Tab seconds are score time at 100% tempo. Video seconds are media positions.
 * Equal video and tab playback rates cancel, preserving score-to-media alignment.
 * No clamping: negative positions let callers detect pre-roll. */
export function tabToVideoTime(tabSec: number, settings: SyncSettings = {}): number {
  if (!Number.isFinite(tabSec)) throw new RangeError('Time must be finite')
  const { offsetSec, ratio } = rates(settings)
  return offsetSec + tabSec * ratio
}

export function videoToTabTime(videoSec: number, settings: SyncSettings = {}): number {
  if (!Number.isFinite(videoSec)) throw new RangeError('Time must be finite')
  const { offsetSec, ratio } = rates(settings)
  return (videoSec - offsetSec) / ratio
}
