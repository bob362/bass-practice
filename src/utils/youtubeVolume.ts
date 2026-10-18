export interface VolumePlayer {
  setVolume(v: number): void
  mute(): void
  unMute(): void
  getVolume(): number
  isMuted(): boolean
}

export function clampVolume(v: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 100
  return Math.min(100, Math.max(0, Math.round(v)))
}

export function applyVolume(
  player: Pick<VolumePlayer, 'setVolume' | 'mute' | 'unMute'>,
  volume: number,
  muted: boolean,
): void {
  try {
    player.setVolume(clampVolume(volume))
    if (muted) {
      player.mute()
    } else {
      player.unMute()
    }
  } catch {
    // player may be destroyed
  }
}

export function readPlayerVolume(player: Pick<VolumePlayer, 'getVolume' | 'isMuted'>): { volume: number; muted: boolean } | null {
  try {
    const volume = player.getVolume()
    if (typeof volume !== 'number' || !Number.isFinite(volume)) return null
    return { volume: clampVolume(volume), muted: !!player.isMuted() }
  } catch {
    return null
  }
}
