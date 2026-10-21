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
  const input = container.querySelector<HTMLInputElement>('input[aria-label="曲の音量"]')!
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
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="曲をミュート"]')!
  await act(async () => { button.click() })
  await flushPromises()
  expect(player.mute).toHaveBeenCalled()
  expect(getSongMediaSettings('song1').muted).toBe(true)
  const toggled = container.querySelector<HTMLButtonElement>('button[aria-label="曲のミュート解除"]')
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
  const input = container.querySelector<HTMLInputElement>('input[aria-label="曲の音量"]')!
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

it('quick YouTube pause/resume right after app play resumes the score', async () => {
  const { tab, player } = await setupSync()
  await act(async () => { root.render(<YouTubePanel {...props} {...tab} isTabPlaying />) })
  await act(async () => { player.opts.events.onStateChange({ data: 2 }) })
  expect(tab.pauseTab).toHaveBeenCalledTimes(1)
  await act(async () => { root.render(<YouTubePanel {...props} {...tab} isTabPlaying={false} />) })
  await act(async () => { player.opts.events.onStateChange({ data: 1 }) })
  expect(tab.playTab).toHaveBeenCalledTimes(1)
})

it('bass sound toggle is saved per song and reported to the score', async () => {
  saveSongMediaSettings('song1', { playthroughUrl: URL1 })
  const onTabMixChange = vi.fn()
  await renderReady({ onTabMixChange })
  expect(onTabMixChange).toHaveBeenLastCalledWith({ master: 1, bass: 1, other: 1 })
  const btn = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('ベース音'))!
  await act(async () => { btn.click() })
  expect(onTabMixChange).toHaveBeenLastCalledWith({ master: 1, bass: 0, other: 1 })
  expect(getSongMediaSettings('song1').tabMuted).toBe(true)
  expect(btn.getAttribute('aria-pressed')).toBe('true')
  // スライダーは操作できたまま、値の表示はオフになる
  const bass = container.querySelector<HTMLInputElement>('input[aria-label="ベースの音量"]')!
  expect(bass.disabled).toBe(false)
  expect(bass.closest('.slider-container')!.textContent).toContain('オフ')
})

it('old saved settings without tabMuted default to sound on', async () => {
  localStorage.setItem('bass_practice_media', JSON.stringify({ song1: { playthroughUrl: URL1, playthroughOffsetSec: 0, originalOffsetSec: 0, playbackRate: 1 } }))
  const onTabMixChange = vi.fn()
  await renderReady({ onTabMixChange })
  expect(onTabMixChange).toHaveBeenLastCalledWith({ master: 1, bass: 1, other: 1 })
  expect(getSongMediaSettings('song1').playbackRate).toBe(1)
})

async function changeSlider(label: string, value: number) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, String(value))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flushPromises()
  return input
}

it('renders three labeled volume sliders in the mixer group', async () => {
  saveSongMediaSettings('song1', { playthroughUrl: URL1 })
  await renderReady()
  const group = container.querySelector('[role="group"]')!
  expect(group).not.toBeNull()
  expect(group.textContent).toContain('ボリューム')
  const labels = [...group.querySelectorAll<HTMLInputElement>('input[type="range"]')].map(i => i.getAttribute('aria-label'))
  expect(labels).toEqual(['曲の音量', 'ベースの音量', 'マスター音量'])
  for (const label of labels) {
    const input = group.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
    expect(input.value).toBe('100')
    expect(input.disabled).toBe(false)
  }
})

it('mixer is available even without a YouTube URL', async () => {
  const onTabMixChange = vi.fn()
  await act(async () => { root.render(<YouTubePanel {...props} onTabMixChange={onTabMixChange} />) })
  await changeSlider('ベースの音量', 30)
  expect(getSongMediaSettings('song1').bassVolume).toBe(30)
  expect(onTabMixChange).toHaveBeenLastCalledWith({ master: 1, bass: 0.3, other: 1 })
})

it('each slider saves its own field', async () => {
  saveSongMediaSettings('song1', { playthroughUrl: URL1 })
  await renderReady()
  await changeSlider('ベースの音量', 60)
  await changeSlider('マスター音量', 80)
  await changeSlider('曲の音量', 40)
  const saved = getSongMediaSettings('song1')
  expect(saved.bassVolume).toBe(60)
  expect(saved.masterVolume).toBe(80)
  expect(saved.volume).toBe(40)
})

it('YouTube volume is song x master / 100', async () => {
  saveSongMediaSettings('song1', { playthroughUrl: URL1, volume: 80, masterVolume: 50 })
  await renderReady()
  const player = players[0]
  expect(player.setVolume).toHaveBeenCalledWith(40)
  expect(player.setVolume.mock.calls.every(call => call[0] === 40)).toBe(true)
  await changeSlider('マスター音量', 25)
  expect(player.setVolume.mock.calls.at(-1)).toEqual([20])
  await changeSlider('曲の音量', 100)
  expect(player.setVolume.mock.calls.at(-1)).toEqual([25])
  // ベースの音量はYouTubeに影響しない
  const calls = player.setVolume.mock.calls.length
  await changeSlider('ベースの音量', 10)
  expect(player.setVolume.mock.calls.length).toBe(calls)
})

it('onTabMixChange reports master/bass/other with song mute silencing other tracks', async () => {
  saveSongMediaSettings('song1', { playthroughUrl: URL1, volume: 50, bassVolume: 70, masterVolume: 80 })
  const onTabMixChange = vi.fn()
  await renderReady({ onTabMixChange })
  expect(onTabMixChange).toHaveBeenLastCalledWith({ master: 0.8, bass: 0.7, other: 0.5 })
  const mute = container.querySelector<HTMLButtonElement>('button[aria-label="曲をミュート"]')!
  await act(async () => { mute.click() })
  expect(onTabMixChange).toHaveBeenLastCalledWith({ master: 0.8, bass: 0.7, other: 0 })
  expect(players[0].mute).toHaveBeenCalled()
})

it('poll converts YouTube volume back through the master volume', async () => {
  vi.useFakeTimers({ toFake: [...FAKE.toFake] })
  saveSongMediaSettings('song1', { playthroughUrl: URL1, volume: 80, masterVolume: 50 })
  await renderReady()
  const player = players[0]
  await act(async () => { vi.advanceTimersByTime(3000) })
  // 設定どおりの音量なら書き込まない
  expect(getSongMediaSettings('song1').volume).toBe(80)
  player.vol = 30
  await act(async () => { vi.advanceTimersByTime(3000) })
  await flushPromises()
  expect(getSongMediaSettings('song1').volume).toBe(60)
  expect(getSongMediaSettings('song1').masterVolume).toBe(50)
  const calls = player.setVolume.mock.calls.length
  await act(async () => { vi.advanceTimersByTime(5000) })
  expect(getSongMediaSettings('song1').volume).toBe(60)
  expect(player.setVolume.mock.calls.slice(calls).every(call => call[0] === 30)).toBe(true)
})
