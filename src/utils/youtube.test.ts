import { describe, expect, it } from 'vitest'
import { getYouTubeVideoId, parseYouTubeUrl } from './youtube'

describe('YouTube URLs', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90', 90],
    ['https://youtu.be/dQw4w9WgXcQ?t=1m30s', 90],
    ['https://youtube.com/shorts/dQw4w9WgXcQ?t=10s', 10],
    ['https://youtube.com/embed/dQw4w9WgXcQ?start=15', 15],
    ['youtube.com/watch?v=dQw4w9WgXcQ#t=1h2m3s', 3723],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 0],
  ])('parses %s', (url, startSec) => {
    expect(parseYouTubeUrl(url)).toEqual({ videoId: 'dQw4w9WgXcQ', startSec })
    expect(getYouTubeVideoId(url)).toBe('dQw4w9WgXcQ')
  })
  it.each(['', 'hello', 'https://evil.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com/watch?v=short', 'javascript:alert(1)'])('rejects %s', url => {
    expect(parseYouTubeUrl(url)).toBeNull()
  })
})

it('shares one API script and preserves the existing ready callback', async () => {
  const { loadYouTubeAPI } = await import('./youtube')
  let previousCalled = false
  window.onYouTubeIframeAPIReady = () => { previousCalled = true }
  const first = loadYouTubeAPI()
  const second = loadYouTubeAPI()
  expect(first).toBe(second)
  expect(document.querySelectorAll('script[src="https://www.youtube.com/iframe_api"]')).toHaveLength(1)
  const api = { Player: class {} } as unknown as typeof YT
  window.YT = api
  window.onYouTubeIframeAPIReady?.()
  expect(await first).toBe(api)
  expect(previousCalled).toBe(true)
  expect(await loadYouTubeAPI()).toBe(api)
})
