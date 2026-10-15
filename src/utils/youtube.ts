export interface YouTubeVideo {
  videoId: string
  startSec: number
}

declare global {
  interface Window {
    YT: typeof YT
    onYouTubeIframeAPIReady?: () => void
  }
}

/** Accept only YouTube hosts and valid 11-character video IDs. */
export function parseYouTubeUrl(input: string): YouTubeVideo | null {
  try {
    const url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`)
    if (!['https:', 'http:'].includes(url.protocol)) return null
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const parts = url.pathname.split('/').filter(Boolean)
    let id: string | null = null
    if (host === 'youtu.be') id = parts[0] ?? null
    else if (['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'].includes(host)) {
      if (parts[0] === 'watch') id = url.searchParams.get('v')
      else if (['shorts', 'embed', 'live'].includes(parts[0])) id = parts[1] ?? null
    }
    if (!id || !/^[\w-]{11}$/.test(id)) return null
    const time = url.searchParams.get('t') ?? url.searchParams.get('start') ?? new URLSearchParams(url.hash.slice(1)).get('t') ?? '0'
    const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(time)
    const startSec = /^\d+(?:\.\d+)?$/.test(time) ? Number(time) : match ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0) : 0
    return { videoId: id, startSec: Number.isFinite(startSec) ? startSec : 0 }
  } catch { return null }
}

export function getYouTubeVideoId(url: string): string | null {
  return parseYouTubeUrl(url)?.videoId ?? null
}

let apiPromise: Promise<typeof YT> | undefined

/** Shares a single load across callers; failed loads can be retried. */
export function loadYouTubeAPI(): Promise<typeof YT> {
  if (typeof window === 'undefined') return Promise.reject(new Error('YouTube API requires a browser'))
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (apiPromise) return apiPromise
  apiPromise = new Promise<typeof YT>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]')
    const script = existing ?? document.createElement('script')
    const cleanup = () => {
      clearTimeout(timeout)
      script.removeEventListener('error', fail)
      if (window.onYouTubeIframeAPIReady === ready) window.onYouTubeIframeAPIReady = previous
    }
    const fail = () => {
      cleanup()
      script.remove()
      reject(new Error('Failed to load YouTube IFrame API'))
    }
    const ready = () => {
      cleanup()
      resolve(window.YT)
      previous?.()
    }
    const timeout = setTimeout(fail, 30000)
    window.onYouTubeIframeAPIReady = ready
    script.addEventListener('error', fail, { once: true })
    if (!existing) {
      script.src = 'https://www.youtube.com/iframe_api'
      script.async = true
      document.head.appendChild(script)
    }
  }).catch(error => { apiPromise = undefined; throw error })
  return apiPromise
}
