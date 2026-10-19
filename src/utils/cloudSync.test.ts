import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyMediaDoc, emptyProgressDoc, mergeMediaDocs, mergeProgressDocs, summarizeSong, type SongRecord } from '../shared/syncMerge'
import { _resetCloudSyncForTests, getSyncStatus, SONGS_CHANGED_EVENT, startCloudSync, syncNow } from './cloudSync'
import { deleteSong, getAllSongs, getMediaSyncDoc, getSongById, getSongTombstones, notifyLocalChange, putSongsFromRemote, saveSong, saveSongMediaSettings, SONGS_STORAGE_KEY, updateSong } from './storage'
import { addSession, getProgressSyncDoc } from './progress'

function server() {
  const songs = new Map<string, SongRecord>()
  let media = emptyMediaDoc(), progress = emptyProgressDoc()
  const calls: string[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'https://test.local'), method = init?.method ?? 'GET'
    calls.push(method + ' ' + url.pathname)
    expect(init?.credentials).toBe('same-origin')
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status, headers:{'content-type':'application/json'}})
    const body = () => JSON.parse(String(init?.body))
    if (url.pathname === '/api/songs') return json([...songs.values()].map(summarizeSong))
    if (url.pathname.startsWith('/api/songs/')) {
      const id = decodeURIComponent(url.pathname.slice(11)), current = songs.get(id)
      if (method === 'GET') return current ? json(current) : json({}, 404)
      const incoming = method === 'DELETE' ? {id, updatedAt:Number(url.searchParams.get('updatedAt')), deleted:true} : body()
      if (current && current.updatedAt > incoming.updatedAt) return json({error:'conflict', current}, 409)
      songs.set(id, incoming); return json({ok:true})
    }
    if (url.pathname === '/api/settings') { media = mergeMediaDocs(media, body()); return json(media) }
    if (url.pathname === '/api/progress') { progress = mergeProgressDocs(progress, body()); return json(progress) }
    return json({}, 404)
  }) as unknown as typeof globalThis.fetch
  return {songs, fetch, calls, get media() {return media}, set media(v) {media=v}, get progress() {return progress}, set progress(v) {progress=v}}
}
const song = (id: string, updatedAt = 10) => ({id, title:id, createdAt:1, updatedAt, texData:'tab'})
beforeEach(() => { _resetCloudSyncForTests(); localStorage.clear() })
afterEach(() => { _resetCloudSyncForTests(); vi.restoreAllMocks() })
describe('cloud sync', () => {
  it('backfills legacy songs and pushes them; start is idempotent', async () => {
    const api = server()
    localStorage.setItem(SONGS_STORAGE_KEY, JSON.stringify([{id:'legacy', title:'old', texData:'tab', createdAt:123}]))
    const first = startCloudSync({fetch:api.fetch})
    expect(startCloudSync()).toBe(first)
    await first
    expect(api.songs.get('legacy')?.updatedAt).toBe(123)
    expect(getSyncStatus().state).toBe('synced')
  })
  it('pulls remote newer, pushes local newer, removes remote tombstones and announces changes', async () => {
    const api = server(), changed = vi.fn()
    putSongsFromRemote([song('pull'), song('push',30), song('deleted')])
    api.songs.set('pull', song('pull',20)); api.songs.set('push', song('push',20)); api.songs.set('deleted', {id:'deleted', updatedAt:20, deleted:true})
    window.addEventListener(SONGS_CHANGED_EVENT, changed)
    await startCloudSync({fetch:api.fetch})
    expect(getSongById('pull')?.updatedAt).toBe(20)
    expect(api.songs.get('push')?.updatedAt).toBe(30)
    expect(getSongById('deleted')).toBeNull(); expect(changed).toHaveBeenCalled()
    window.removeEventListener(SONGS_CHANGED_EVENT, changed)
  })
  it('pushes local deletes with their timestamp', async () => {
    const api = server(); putSongsFromRemote([song('gone')]); api.songs.set('gone', song('gone'))
    deleteSong('gone')
    await startCloudSync({fetch:api.fetch})
    expect(api.songs.get('gone')).toEqual({id:'gone', deleted:true, updatedAt:getSongTombstones().gone})
    expect(api.calls).toContain('DELETE /api/songs/gone')
  })
  it('persists failed incremental work and retries after reconnect', async () => {
    const api = server(); await startCloudSync({fetch:api.fetch})
    vi.mocked(api.fetch).mockRejectedValueOnce(new TypeError('offline'))
    const saved = saveSong({title:'queued', texData:'tab'})
    await syncNow()
    expect(getSyncStatus().state).toBe('offline')
    expect(JSON.parse(localStorage.getItem('bass_practice_sync_queue')!)).toEqual([{op:'put', id:saved.id}])
    await syncNow()
    expect(api.songs.has(saved.id)).toBe(true)
    expect(getSyncStatus().pending).toBe(0)
  })
  it('handles 401 and HTML responses as local-only', async () => {
    await startCloudSync({fetch:vi.fn(async () => new Response('', {status:401}))})
    expect(getSyncStatus()).toMatchObject({state:'offline', message:'ログインしていないため、この端末のみに保存しています'})
    _resetCloudSyncForTests()
    await startCloudSync({fetch:vi.fn(async () => new Response('<html>', {headers:{'content-type':'text/html'}}))})
    expect(getSyncStatus().state).toBe('offline')
  })
  it('applies server copy on queued PUT conflict', async () => {
    const api = server(); await startCloudSync({fetch:api.fetch})
    putSongsFromRemote([song('conflict',10)]); api.songs.set('conflict', song('conflict',20))
    notifyLocalChange({kind:'song-saved', id:'conflict'}); await syncNow()
    expect(getSongById('conflict')?.updatedAt).toBe(20)
  })
  it('merges media and progress in both directions', async () => {
    const api = server()
    saveSongMediaSettings('local', {volume:20})
    api.media = {version:1, entries:{remote:{updatedAt:20, settings:{playthroughOffsetSec:0, originalOffsetSec:0, playbackRate:1}}}}
    addSession({id:'local-session', songId:'local', start:'2026-01-01T00:00:00Z', durationSec:30})
    api.progress.sessions.push({id:'remote-session', songId:'remote', start:'2026-01-02T00:00:00Z', durationSec:60})
    await startCloudSync({fetch:api.fetch})
    expect(Object.keys(getMediaSyncDoc().entries).sort()).toEqual(['local','remote'])
    expect(api.media).toEqual(getMediaSyncDoc())
    expect(getProgressSyncDoc().sessions).toHaveLength(2)
    expect(api.progress.sessions).toHaveLength(2)
  })
  it('continues other uploads after a 413 and reports the song title', async () => {
    const api = server(); putSongsFromRemote([song('large'), song('small')])
    const original = api.fetch
    const fetch: typeof globalThis.fetch = async (input, init) => String(input).endsWith('/large') && init?.method === 'PUT' ? new Response('{}', {status:413, headers:{'content-type':'application/json'}}) : original(input, init)
    await startCloudSync({fetch})
    expect(api.songs.has('small')).toBe(true)
    expect(getSyncStatus()).toMatchObject({state:'error', message:'曲が大きすぎて同期できません: large'})
  })
  it('reports server errors', async () => {
    await startCloudSync({fetch:vi.fn(async () => new Response('{"error":"broken"}', {status:500, headers:{'content-type':'application/json'}}))})
    expect(getSyncStatus()).toMatchObject({state:'error', message:'エラー: HTTP 500: broken'})
    expect(getAllSongs()).toEqual([])
  })
})

describe('sync lifecycle', () => {
  it('restores a persisted queue at startup and drops missing puts', async () => {
    const api = server()
    putSongsFromRemote([song('queued')])
    localStorage.setItem('bass_practice_sync_queue', JSON.stringify([{op:'put', id:'missing'}, {op:'put', id:'queued'}]))
    await startCloudSync({fetch:api.fetch})
    expect(api.calls[0]).toBe('PUT /api/songs/queued')
    expect(getSyncStatus().pending).toBe(0)
  })
  it('coalesces simultaneous reconciliations and retries offline operations with backoff', async () => {
    vi.useFakeTimers()
    try {
      const api = server(); await startCloudSync({fetch:api.fetch})
      vi.mocked(api.fetch).mockRejectedValueOnce(new TypeError('offline'))
      const saved = saveSong({title:'retry', texData:'tab'})
      const first = syncNow(); expect(syncNow()).toBe(first); await first
      expect(getSyncStatus().pending).toBe(1)
      await vi.advanceTimersByTimeAsync(2000)
      expect(api.songs.has(saved.id)).toBe(true)
      expect(getSyncStatus().state).toBe('synced')
    } finally { vi.useRealTimers() }
  })
})

it.each(['edit','delete','planned-delete'])('preserves concurrent local %s during a delayed pull', async action => {
  const api = server()
  putSongsFromRemote([song('a'),song('z')])
  api.songs.set('a',song('a',20))
  api.songs.set('z',{id:'z',updatedAt:20,deleted:true})
  let release!: () => void, pending!: () => void
  const waiting = new Promise<void>(resolve => { pending = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const fetch: typeof globalThis.fetch = async (input,init) => {
    if (String(input).endsWith('/songs/a') && init?.method === 'GET') { pending(); await gate }
    return api.fetch(input,init)
  }
  const syncing = startCloudSync({fetch})
  await waiting
  const id = action === 'planned-delete' ? 'z' : 'a'
  if (action === 'delete') deleteSong(id)
  else updateSong(id,{title:'local edit'})
  release(); await syncing
  if (action === 'delete') {
    expect(getSongById(id)).toBeNull()
    expect(api.songs.get(id)?.deleted).toBe(true)
  } else {
    expect(getSongById(id)?.title).toBe('local edit')
    expect(api.songs.get(id)?.title).toBe('local edit')
  }
})
