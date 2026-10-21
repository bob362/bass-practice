import type { SongMediaSettings } from './storage'
import { clampVolume } from './youtubeVolume'

export interface MixSettings {
  songVolume: number
  bassVolume: number
  masterVolume: number
  songMuted: boolean
  bassMuted: boolean
}

/** 保存設定をミキサー用の音量 0-100 に変換する。 */
export function mixFromMediaSettings(s: Pick<SongMediaSettings, 'volume' | 'bassVolume' | 'masterVolume' | 'muted' | 'tabMuted'>): MixSettings {
  return {
    songVolume: clampVolume(s.volume ?? 100),
    bassVolume: clampVolume(s.bassVolume ?? 100),
    masterVolume: clampVolume(s.masterVolume ?? 100),
    songMuted: s.muted ?? false,
    bassMuted: s.tabMuted ?? false,
  }
}

/** YouTube のミュートには songMuted を別途使う。 */
export function youtubeVolumeFor(mix: MixSettings): number {
  return clampVolume(mix.songVolume * mix.masterVolume / 100)
}

/** マスターが 0 の場合は曲の音量を逆算できない。 */
export function songVolumeFromPlayerVolume(playerVolume: number, masterVolume: number): number | null {
  return masterVolume <= 0 ? null : clampVolume(playerVolume * 100 / masterVolume)
}

export interface AlphaTabMix {
  master: number
  bass: number
  other: number
}

/** alphaTab 用の音量 0-1 に変換する。 */
export function alphaTabMixFor(mix: MixSettings): AlphaTabMix {
  return {
    master: mix.masterVolume / 100,
    bass: mix.bassMuted ? 0 : mix.bassVolume / 100,
    other: mix.songMuted ? 0 : mix.songVolume / 100,
  }
}

function isPercussionTrack(track: any): boolean {
  return Array.isArray(track?.staves) && track.staves.length > 0
    && track.staves.every((staff: any) => staff?.isPercussion)
}

/** GM ベースまたは最高開放弦が G3 未満の譜表を検出する。 */
export function isBassTrack(track: any): boolean {
  if (isPercussionTrack(track)) return false
  const program = track?.playbackInfo?.program
  if (typeof program === 'number' && program >= 32 && program <= 39) return true
  return Array.isArray(track?.staves) && track.staves.some((staff: any) => {
    const tuning = staff?.tuning
    return !staff?.isPercussion && Array.isArray(tuning) && tuning.length > 0
      && tuning.every((pitch: unknown) => typeof pitch === 'number' && Number.isFinite(pitch))
      && Math.max(...tuning) < 55
  })
}

/** ベース未検出時は非打楽器トラックが1つの場合のみ代用する。 */
export function splitTracks(score: any): { bass: any[]; other: any[] } {
  const tracks: any[] = Array.isArray(score?.tracks) ? score.tracks : []
  const bass = tracks.filter(isBassTrack)
  if (!bass.length) {
    const nonPercussion = tracks.filter(track => !isPercussionTrack(track))
    if (nonPercussion.length === 1) bass.push(nonPercussion[0])
  }
  return { bass, other: tracks.filter(track => !bass.includes(track)) }
}

/** 破棄済みの API でも例外を呼び出し元へ伝えない。 */
export function applyAlphaTabMix(api: any, mix: AlphaTabMix): void {
  try {
    api.masterVolume = mix.master
    if (api.score && typeof api.changeTrackVolume === 'function') {
      const { bass, other } = splitTracks(api.score)
      if (bass.length) api.changeTrackVolume(bass, mix.bass)
      if (other.length) api.changeTrackVolume(other, mix.other)
    }
  } catch {
    // API が利用できない場合は適用を省略する。
  }
}
