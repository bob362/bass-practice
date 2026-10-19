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
      onPlaybackRateChange?: (event: { data: number }) => void
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
  state = 2
  time = 0
  getPlayerState = vi.fn(() => this.state)
  getCurrentTime = vi.fn(() => this.time)
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

async function renderReady(extra: Partial<React.ComponentProps<typeof YouTubePanel>> = {}) {
  await act(async () => { root.render(<YouTubePanel {...props} {...extra} />) })
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

const URL1 = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const FAKE = { toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance', 'Date'] } as const

async function setupSync(extra: Partial<React.ComponentProps<typeof YouTubePanel>> = {}) {
  vi.useFakeTimers({ toFake: [...FAKE.toFake] })
  saveSongMediaSettings('song1', { playthroughUrl: URL1 })
  const tab = { playTab: vi.fn(), pauseTab: vi.fn(), seekTab: vi.fn() }
  await renderReady({ ...tab, ...extra })
  const toggle = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('譜面と一緒に再生'))!
  await act(async () => { toggle.click() })
  await act(async () => { vi.advanceTimersByTime(1500) })
  return { tab, player: players[0] }
}

it('video play from YouTube controls starts and aligns the score', async () => {
  const { tab, player } = await setupSync()
  player.time = 30
  await act(async () => { player.opts.events.onStateChange({ data: 1 }) })
  expect(tab.seekTab).toHaveBeenCalledWith(30)
  expect(tab.playTab).toHaveBeenCalledTimes(1)
})

it('video pause from YouTube controls pauses the score', async () => {
  const { tab, player } = await setupSync()
  await act(async () => { root.render(<YouTubePanel {...props} {...tab} isTabPlaying />) })
  await act(async () => { vi.advanceTimersByTime(1500) })
  await act(async () => { player.opts.events.onStateChange({ data: 2 }) })
  expect(tab.pauseTab).toHaveBeenCalledTimes(1)
})

it('app-originated play/pause does not loop back into the score', async () => {
  const { tab, player } = await setupSync()
  await act(async () => { root.render(<YouTubePanel {...props} {...tab} isTabPlaying />) })
  expect(player.playVideo).toHaveBeenCalled()
  await act(async () => { player.opts.events.onStateChange({ data: 1 }) })
  expect(tab.playTab).not.toHaveBeenCalled()
  await act(async () => { root.render(<YouTubePanel {...props} {...tab} isTabPlaying={false} />) })
  expect(player.pauseVideo).toHaveBeenCalled()
  await act(async () => { player.opts.events.onStateChange({ data: 2 }) })
  expect(tab.pauseTab).not.toHaveBeenCalled()
})

it('sync off: video events do not drive the score', async () => {
  vi.useFakeTimers({ toFake: [...FAKE.toFake] })
  saveSongMediaSettings('song1', { playthroughUrl: URL1 })
  const tab = { playTab: vi.fn(), pauseTab: vi.fn(), seekTab: vi.fn() }
  await renderReady(tab)
  await act(async () => { vi.advanceTimersByTime(1500) })
  await act(async () => { players[0].opts.events.onStateChange({ data: 1 }) })
  expect(tab.playTab).not.toHaveBeenCalled()
})

it('seeking the video seeks the score', async () => {
  const { tab, player } = await setupSync()
  player.time = 10
  await act(async () => { vi.advanceTimersByTime(2000) })
  tab.seekTab.mockClear()
  player.time = 10.3
  await act(async () => { vi.advanceTimersByTime(250) })
  expect(tab.seekTab).not.toHaveBeenCalled()
  player.time = 50
  await act(async () => { vi.advanceTimersByTime(250) })
  expect(tab.seekTab).toHaveBeenCalledTimes(1)
  expect(tab.seekTab.mock.calls[0][0]).toBeCloseTo(50)
})

it('play button under the video drives the score when sync is on', async () => {
  const { tab } = await setupSync()
  const btn = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('▶ 再生'))!
  await act(async () => { btn.click() })
  expect(tab.playTab).toHaveBeenCalledTimes(1)
})

it('rate change in YouTube is saved', async () => {
  const { player } = await setupSync()
  await act(async () => { player.opts.events.onPlaybackRateChange?.({ data: 0.75 }) })
  expect(getSongMediaSettings('song1').playbackRate).toBe(0.75)
})
