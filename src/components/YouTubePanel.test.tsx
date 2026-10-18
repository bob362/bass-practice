import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import YouTubePanel from './YouTubePanel'
import { loadYouTubeAPI } from '../utils/youtube'
import { getSongMediaSettings, saveSongMediaSettings } from '../utils/storage'

vi.mock('../utils/youtube', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadYouTubeAPI: vi.fn(),
}))

const players: FakePlayer[] = []

class FakePlayer {
  el: HTMLElement
  opts: {
    videoId: string
    playerVars: Record<string, unknown>
    events: {
      onReady: (event: { target: unknown }) => void
      onStateChange: (event: { data: number }) => void
    }
  }
  vol = 100
  m = false
  setPlaybackRate = vi.fn()
  setVolume = vi.fn((v: number) => { this.vol = v })
  mute = vi.fn(() => { this.m = true })
  unMute = vi.fn(() => { this.m = false })
  getVolume = vi.fn(() => this.vol)
  isMuted = vi.fn(() => this.m)
  destroy = vi.fn()
  getPlayerState = vi.fn(() => 2)
  getCurrentTime = vi.fn(() => 0)
  getDuration = vi.fn(() => 100)
  playVideo = vi.fn()
  pauseVideo = vi.fn()
  seekTo = vi.fn()

  constructor(el: HTMLElement, opts: FakePlayer['opts']) {
    this.el = el
    this.opts = opts
    players.push(this)
  }
}

const fakeApi = {
  Player: FakePlayer,
  PlayerState: { PLAYING: 1, PAUSED: 2, BUFFERING: 3, ENDED: 0, CUED: 5, UNSTARTED: -1 },
} as unknown as typeof YT

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

const props = {
  songId: 'song1',
  isTabPlaying: false,
  tempoPercent: 100,
  getTabSec: () => 0,
  subscribePosition: () => () => {},
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.mocked(loadYouTubeAPI).mockResolvedValue(fakeApi)
  ;(globalThis as { YT?: unknown }).YT = fakeApi
  localStorage.clear()
  players.length = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function flushPromises() {
  for (let i = 0; i < 10 && players.length === 0; i++) {
    await act(async () => { await Promise.resolve() })
  }
}

async function renderReady() {
  await act(async () => { root.render(<YouTubePanel {...props} />) })
  await flushPromises()
  expect(players.length).toBe(1)
  await act(async () => { players[0].opts.events.onReady({ target: players[0] }) })
  await flushPromises()
}

it('onReady applies saved volume and mute', async () => {
  saveSongMediaSettings('song1', { playthroughUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', volume: 40, muted: true })
  await renderReady()
  const player = players[0]
  expect(player.opts.videoId).toBe('dQw4w9WgXcQ')
  expect(player.setVolume).toHaveBeenCalledWith(40)
  expect(player.setVolume.mock.calls.every(call => call[0] === 40)).toBe(true)
  expect(player.mute).toHaveBeenCalled()
  expect(player.unMute).not.toHaveBeenCalled()
})

it('slider change calls setVolume and unMutes', async () => {
  saveSongMediaSettings('song1', { playthroughUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', volume: 40, muted: true })
  await renderReady()
  const input = container.querySelector<HTMLInputElement>('input[aria-label="動画の音量"]')!
  expect(input.value).toBe('40')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, '70')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flushPromises()
  const player = players[0]
  expect(player.setVolume).toHaveBeenCalledWith(70)
  expect(player.setVolume.mock.calls.at(-1)).toEqual([70])
  expect(player.unMute).toHaveBeenCalled()
  const saved = getSongMediaSettings('song1')
  expect(saved.volume).toBe(70)
  expect(saved.muted).toBe(false)
})

it('mute button toggles', async () => {
  saveSongMediaSettings('song1', { playthroughUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', volume: 50, muted: false })
  await renderReady()
  const player = players[0]
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="ミュート"]')!
  await act(async () => { button.click() })
  await flushPromises()
  expect(player.mute).toHaveBeenCalled()
  expect(getSongMediaSettings('song1').muted).toBe(true)
  const toggled = container.querySelector<HTMLButtonElement>('button[aria-label="ミュート解除"]')
  expect(toggled).not.toBeNull()
})

it('poll picks up volume changed in YouTube controls', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance', 'Date'] })
  saveSongMediaSettings('song1', { playthroughUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', volume: 40, muted: true })
  await renderReady()
  players[0].vol = 25
  await act(async () => { vi.advanceTimersByTime(3000) })
  await flushPromises()
  expect(getSongMediaSettings('song1').volume).toBe(25)
  const input = container.querySelector<HTMLInputElement>('input[aria-label="動画の音量"]')!
  expect(input.value).toBe('25')
})
