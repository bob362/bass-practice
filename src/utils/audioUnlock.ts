export interface AudioContextLike {
  state: string
  resume?: () => Promise<void>
  createBuffer?: (ch: number, len: number, rate: number) => any
  createBufferSource?: () => any
  destination?: any
}

export function getAlphaTabAudioContext(api: unknown): AudioContextLike | null {
  try {
    const context = (api as any)?.player?.output?.context
    return context && typeof context === 'object' && typeof context.state === 'string'
      ? context
      : null
  } catch {
    return null
  }
}

export function unlockAudio(api: unknown): boolean {
  if (api == null) return false
  let attempted = false
  try {
    const player = (api as any).player
    attempted = !!player
    const output = player?.output
    if (typeof output?.activate === 'function') output.activate()
  } catch {
    // 初期化途中でも後続の解除を試す
  }
  const ctx = getAlphaTabAudioContext(api)
  try {
    if (ctx && (ctx.state === 'suspended' || ctx.state === 'interrupted') && typeof ctx.resume === 'function') {
      ctx.resume().catch(() => {})
    }
  } catch {
    // 同期例外も操作を妨げない
  }
  try {
    if (ctx && ctx.state !== 'closed' && typeof ctx.createBuffer === 'function' && typeof ctx.createBufferSource === 'function') {
      const buffer = ctx.createBuffer(1, 1, 22050)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      source.start(0)
    }
  } catch {
    // iOS の操作内で無音再生を試す
  }
  return attempted
}

export function isAudioRunning(api: unknown): boolean {
  return getAlphaTabAudioContext(api)?.state === 'running'
}

export const UNLOCK_EVENTS = ['touchstart', 'touchend', 'pointerdown', 'click', 'keydown'] as const

export function installAudioUnlock(getApi: () => unknown, target: EventTarget = window): () => void {
  const options = { capture: true, passive: true }
  const handler = () => {
    const api = getApi()
    if (!api || isAudioRunning(api)) return
    unlockAudio(api)
  }
  for (const event of UNLOCK_EVENTS) target.addEventListener(event, handler, options)
  return () => {
    for (const event of UNLOCK_EVENTS) target.removeEventListener(event, handler, options)
  }
}

export function preferPlaybackAudioSession(nav: any = typeof navigator !== 'undefined' ? navigator : undefined): boolean {
  try {
    if (!nav?.audioSession) return false
    nav.audioSession.type = 'playback'
    return true
  } catch {
    return false
  }
}
