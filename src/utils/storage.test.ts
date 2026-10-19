import { beforeEach, describe, expect, it, vi } from 'vitest'
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

// Cloud storage metadata and large song fallback.
describe('cloud storage', () => {
  beforeEach(() => localStorage.clear())
  it('records deletion tombstones and clears them when remote data restores a song', async () => {
    const s = await import('./storage')
    const song = s.saveSong({title:'test', texData:'tab'})
    expect(s.deleteSong(song.id)).toBe(true)
    expect(s.getSongTombstones()[song.id]).toBeGreaterThan(0)
    s.putSongsFromRemote([song])
    expect(s.getSongTombstones()[song.id]).toBeUndefined()
    s.removeSongsFromRemote([song.id])
    expect(s.getSongTombstones()[song.id]).toBeUndefined()
  })
  it('tracks media timestamps and applies null settings without notifying', async () => {
    const s = await import('./storage')
    s.saveSongMediaSettings('media', {volume:10})
    expect(s.getMediaSyncDoc().entries.media.updatedAt).toBeGreaterThan(0)
    s.applyMediaSyncDoc({version:1, entries:{media:{updatedAt:123, settings:null}}})
    expect(s.getAllMediaSettings().media).toBeUndefined()
    expect(s.getMediaSyncDoc().entries.media).toEqual({updatedAt:123, settings:null})
  })
  it('keeps oversized songs in memory while smaller songs fit on disk', async () => {
    const s = await import('./storage')
    const original = Storage.prototype.setItem
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(this: Storage, key, value) {
      if (key === s.SONGS_STORAGE_KEY && value.length > 500) throw new DOMException('full', 'QuotaExceededError')
      original.call(this, key, value)
    })
    try {
      const big = s.saveSong({title:'big', texData:'x'.repeat(1000)})
      spy.mockImplementation(function(this: Storage,key,value) { original.call(this,key,value) })
      const small = s.saveSong({title:'small', texData:'tab'})
      spy.mockImplementation(function(this: Storage, key, value) {
        if (key === s.SONGS_STORAGE_KEY && value.length > 500) throw new DOMException('full', 'QuotaExceededError')
        original.call(this, key, value)
      })
      s.updateSong(big.id, {title:'big updated'})
      expect(s.getSongById(big.id)?.texData).toHaveLength(1000)
      expect(JSON.parse(localStorage.getItem(s.SONGS_STORAGE_KEY)!)).toEqual([small])
      s.deleteSong(big.id); s.deleteSong(small.id)
    } finally { spy.mockRestore() }
  })
})

it('evicts a newly saved song before a larger persisted song', async () => {
  const s = await import('./storage')
  localStorage.clear()
  const old = s.saveSong({title:'persisted',texData:'x'.repeat(1000)})
  const original = Storage.prototype.setItem
  const spy = vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this: Storage,key,value) {
    if (key === s.SONGS_STORAGE_KEY && value.length > 1400) throw new DOMException('full','QuotaExceededError')
    original.call(this,key,value)
  })
  try {
    const added = s.saveSong({title:'new',texData:'x'.repeat(500)})
    expect(JSON.parse(localStorage.getItem(s.SONGS_STORAGE_KEY)!)).toEqual([old])
    expect(s.getSongById(added.id)).not.toBeNull()
    s.deleteSong(added.id); s.deleteSong(old.id)
  } finally { spy.mockRestore() }
})
it('backfills missing timestamps consistently', async () => {
  const s = await import('./storage')
  localStorage.setItem(s.SONGS_STORAGE_KEY,JSON.stringify([{id:'legacy',createdAt:12},{id:'fallback'}]))
  expect(s.getAllSongs().map(s => s.updatedAt)).toEqual([12,0])
  expect(s.getAllSongs().map(s => s.updatedAt)).toEqual([12,0])
  localStorage.clear()
})
