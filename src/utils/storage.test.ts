import { beforeEach, describe, expect, it } from 'vitest'
import {
  MEDIA_STORAGE_KEY,
  getSongMediaSettings,
  isSongMediaSettings,
  saveSongMediaSettings,
} from './storage'

describe('storage SongMediaSettings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('旧形式（volume/muted なし）の保存データでも既定値で読み込める', () => {
    localStorage.setItem(MEDIA_STORAGE_KEY, JSON.stringify({
      song1: { playthroughOffsetSec: 0, originalOffsetSec: 1, playbackRate: 1 },
    }))
    const settings = getSongMediaSettings('song1')
    expect(settings.originalOffsetSec).toBe(1)
    expect(settings.volume).toBe(100)
    expect(settings.muted).toBe(false)
  })

  it('isSongMediaSettings は旧形式を受け入れる', () => {
    expect(isSongMediaSettings({ playthroughOffsetSec: 0, originalOffsetSec: 1, playbackRate: 1 })).toBe(true)
  })

  it('isSongMediaSettings の volume/muted バリデーション', () => {
    const base = { playthroughOffsetSec: 0, originalOffsetSec: 0, playbackRate: 1 }
    for (const volume of [0, 50, 100]) {
      expect(isSongMediaSettings({ ...base, volume })).toBe(true)
    }
    expect(isSongMediaSettings({ ...base, muted: true })).toBe(true)
    expect(isSongMediaSettings({ ...base, muted: false })).toBe(true)
    expect(isSongMediaSettings({ ...base, volume: -1 })).toBe(false)
    expect(isSongMediaSettings({ ...base, volume: 101 })).toBe(false)
    expect(isSongMediaSettings({ ...base, volume: NaN })).toBe(false)
    expect(isSongMediaSettings({ ...base, volume: '50' })).toBe(false)
    expect(isSongMediaSettings({ ...base, muted: 'yes' })).toBe(false)
  })

  it('saveSongMediaSettings は volume をクランプして保存する', () => {
    expect(saveSongMediaSettings('song1', { volume: 150 }).volume).toBe(100)
    expect(saveSongMediaSettings('song1', { volume: -5 }).volume).toBe(0)
    expect(saveSongMediaSettings('song1', { volume: 33.6 }).volume).toBe(34)
    const saved = saveSongMediaSettings('song2', { volume: 42, muted: true })
    expect(saved.muted).toBe(true)
    const loaded = JSON.parse(localStorage.getItem(MEDIA_STORAGE_KEY) ?? '{}')
    expect(loaded.song2.volume).toBe(42)
    expect(loaded.song2.muted).toBe(true)
    expect(getSongMediaSettings('song2')).toEqual({
      playthroughOffsetSec: 0, originalOffsetSec: 0, playbackRate: 1, volume: 42, muted: true,
    })
  })

  it('saveSongMediaSettings は非有限 volume で例外を投げる', () => {
    expect(() => saveSongMediaSettings('song1', { volume: NaN })).toThrow('Invalid media settings')
    expect(() => saveSongMediaSettings('song1', { volume: Infinity })).toThrow('Invalid media settings')
  })
})
