import { ensureUpdatedAt, isFoldersDoc, isMediaDoc, isProgressDoc, mergeFoldersDocs, mergeMediaDocs, mergeProgressDocs, normalizeProgressDoc, planSongSync, type SongSummary } from '../shared/syncMerge'
import { applyFoldersSyncDoc, applyMediaSyncDoc, getAllSongs, getFoldersSyncDoc, getMediaSyncDoc, getSongById, getSongTombstones, LOCAL_CHANGE_EVENT, putSongsFromRemote, removeSongsFromRemote, type ConvertedSong, type LocalChange } from './storage'
import { applyProgressSyncDoc, getProgressSyncDoc } from './progress'

export type SyncState = 'idle' | 'syncing' | 'synced' | 'offline' | 'error'
export interface SyncStatus { state: SyncState; message?: string; lastSyncedAt?: number; pending: number }
export const SONGS_CHANGED_EVENT = 'bass-practice:songs-changed'
type Op = {op:'put'; id:string} | {op:'delete'; id:string; updatedAt:number}
const QUEUE_KEY = 'bass_practice_sync_queue'
const offlineMessage = 'オフライン：この端末のみに保存しています（再接続時に同期します）'
let status: SyncStatus = {state:'idle', pending:0}
const subscribers = new Set<(s: SyncStatus) => void>()
let queue: Op[] = [], fetcher: typeof fetch, baseUrl = ''
let started: Promise<void> | undefined, running: Promise<void> | undefined
let retry: ReturnType<typeof setTimeout> | undefined, mediaTimer: ReturnType<typeof setTimeout> | undefined, progressTimer: ReturnType<typeof setTimeout> | undefined
let delay = 2000, generation = 0, rerun = false, largeError: string | undefined
export const getSyncStatus = (): SyncStatus => ({...status})
export function subscribeSyncStatus(cb: (s: SyncStatus) => void) { subscribers.add(cb); return () => { subscribers.delete(cb) } }
function setStatus(update: Partial<SyncStatus>) { status = {...status, ...update, pending: queue.length}; for (const cb of subscribers) cb({...status}) }
function persist() { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)) } catch { /* Queue remains in memory. */ } setStatus({}) }
class SyncFailure extends Error { constructor(public state: 'offline' | 'error', message: string, public login = false) { super(message) } }
async function request(path: string, method = 'GET', body?: unknown): Promise<{status:number; data:any}> {
  let response: Response
  try { response = await fetcher(baseUrl + path, {method, credentials:'same-origin', headers:{'Content-Type':'application/json'}, ...(body === undefined ? {} : {body:JSON.stringify(body)})}) }
  catch { throw new SyncFailure('offline', offlineMessage) }
  if (response.status === 404 && path === '/api/folders') return {status:404, data:null}
  if (response.status === 401) throw new SyncFailure('offline', 'ログインしていないため、この端末のみに保存しています', true)
  if (!response.headers.get('content-type')?.includes('application/json')) throw new SyncFailure('offline', offlineMessage)
  let data: any
  try { data = await response.json() } catch { throw new SyncFailure('offline', offlineMessage) }
  if (!response.ok && ![409,413,404].includes(response.status)) throw new SyncFailure('error', `エラー: HTTP ${response.status}${data?.error ? ': ' + data.error : ''}`)
  return {status:response.status, data}
}
function changed() { window.dispatchEvent(new Event(SONGS_CHANGED_EVENT)) }
function applySong(song: ConvertedSong & {deleted?:boolean}) {
  const local = getSongById(song.id), tombstone = getSongTombstones()[song.id]
  if ((local && song.updatedAt <= local.updatedAt) || (tombstone !== undefined && song.updatedAt <= tombstone)) return
  const before = JSON.stringify(getAllSongs())
  if (song.deleted) removeSongsFromRemote([song.id]); else putSongsFromRemote([song])
  if (before !== JSON.stringify(getAllSongs())) changed()
}
async function send(op: Op) {
  const path = '/api/songs/' + encodeURIComponent(op.id)
  const song = op.op === 'put' ? getSongById(op.id) : null
  if (op.op === 'put' && !song) return
  const result = op.op === 'put' ? await request(path, 'PUT', ensureUpdatedAt(song!, Date.now())) : await request(path + '?updatedAt=' + op.updatedAt, 'DELETE')
  if (result.status === 413 && song) { largeError = '曲が大きすぎて同期できません: ' + song.title; return }
  if (result.status === 409) {
    if (result.data.current) { applySong(result.data.current); return }
    throw new SyncFailure('error', 'エラー: HTTP 409 ' + (result.data.error ?? 'conflict'))
  }
  if (result.status >= 400) throw new SyncFailure('error', 'エラー: HTTP ' + result.status)
}
async function flush() {
  while (queue.length) {
    const op = queue[0]
    await send(op)
    if (queue[0] === op) { queue.shift(); persist() }
  }
}
async function documents(kind: 'media' | 'progress' | 'folders') {
  if (kind === 'folders') {
    const result = await request('/api/folders', 'PUT', getFoldersSyncDoc())
    if (result.status === 404) return
    if (result.status !== 200 || !isFoldersDoc(result.data)) throw new SyncFailure('error', 'エラー: Invalid folders document')
    const current = getFoldersSyncDoc(), merged = mergeFoldersDocs(current, result.data)
    applyFoldersSyncDoc(merged)
    if (JSON.stringify(current) !== JSON.stringify(merged)) changed()
  } else if (kind === 'media') {
    const before = getMediaSyncDoc(), result = await request('/api/settings', 'PUT', before)
    if (result.status !== 200 || !isMediaDoc(result.data)) throw new SyncFailure('error', 'エラー: Invalid media document')
    const current = getMediaSyncDoc(), merged = mergeMediaDocs(current, result.data)
    applyMediaSyncDoc(merged)
    if (JSON.stringify(current) !== JSON.stringify(merged)) changed()
  } else {
    const result = await request('/api/progress', 'PUT', getProgressSyncDoc())
    if (result.status !== 200 || !isProgressDoc(result.data)) throw new SyncFailure('error', 'エラー: Invalid progress document')
    const current = getProgressSyncDoc(), merged = mergeProgressDocs(current, normalizeProgressDoc(result.data))
    applyProgressSyncDoc(merged)
    if (JSON.stringify(current) !== JSON.stringify(getProgressSyncDoc())) changed()
  }
}
function failed(e: unknown) {
  const failure = e instanceof SyncFailure ? e : new SyncFailure('error', 'エラー: ' + String(e))
  setStatus({state:failure.state, message:failure.message})
  if (failure.login && retry) { clearTimeout(retry); retry = undefined }
  if (!failure.login && !retry) { retry = setTimeout(() => { retry = undefined; void syncNow() }, delay); delay = Math.min(60000, delay * 2) }
}
export function syncNow(): Promise<void> {
  if (!started) return startCloudSync()
  if (running) return running
  const epoch = generation
  running = (async () => {
    setStatus({state:'syncing', message:undefined}); largeError = undefined
    try {
      await flush()
      const result = await request('/api/songs')
      if (result.status !== 200 || !Array.isArray(result.data)) throw new SyncFailure('error', 'エラー: Invalid song summaries')
      const plan = planSongSync(getAllSongs(), getSongTombstones(), result.data as SongSummary[])
      for (const id of plan.pull) {
        const pulled = await request('/api/songs/' + encodeURIComponent(id))
        if (pulled.status === 404) continue
        if (pulled.status !== 200) throw new SyncFailure('error', 'エラー: HTTP ' + pulled.status)
        applySong(pulled.data)
      }
      for (const id of plan.push) await send({op:'put', id})
      const deletions = plan.deleteLocal.filter(id => {
        const local = getSongById(id), remote = (result.data as SongSummary[]).find(s => s.id === id)!
        return local && local.updatedAt <= remote.updatedAt
      })
      if (deletions.length) { removeSongsFromRemote(deletions); changed() }
      for (const id of plan.pushDelete) await send({op:'delete', id, updatedAt:getSongTombstones()[id]})
      await documents('folders'); await documents('media'); await documents('progress')
      await flush()
      delay = 2000
      if (retry) clearTimeout(retry); retry = undefined
      if (epoch === generation) setStatus(largeError ? {state:'error', message:largeError} : {state:'synced', message:undefined, lastSyncedAt:Date.now()})
    } catch (e) { if (epoch === generation) failed(e) }
  })().finally(() => { if (epoch === generation) { running = undefined; if (rerun) { rerun = false; void syncNow() } } })
  return running
}
function localChange(event: Event) {
  const c = (event as CustomEvent<LocalChange>).detail
  if (c.kind === 'song-saved' || c.kind === 'song-deleted') {
    queue = queue.filter(op => op.id !== c.id)
    queue.push(c.kind === 'song-saved' ? {op:'put', id:c.id} : {op:'delete', id:c.id, updatedAt:c.deletedAt})
    persist(); if (running) rerun = true; else void syncNow()
  } else if (c.kind === 'all' || c.kind === 'folders') { if (running) rerun = true; else void syncNow() }
  else if (c.kind === 'media') { clearTimeout(mediaTimer); mediaTimer = setTimeout(() => { if (running) rerun = true; else void syncNow() }, 1500) }
  else { clearTimeout(progressTimer); progressTimer = setTimeout(() => { if (running) rerun = true; else void syncNow() }, 1500) }
}
function online() { void syncNow() }
function visible() { if (document.visibilityState === 'visible') void syncNow() }
export function startCloudSync(opts?: {fetch?: typeof fetch; baseUrl?: string}): Promise<void> {
  if (started) return started
  fetcher = opts?.fetch ?? globalThis.fetch; baseUrl = opts?.baseUrl ?? ''
  try { const saved = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]'); queue = Array.isArray(saved) ? saved.filter(op => op && typeof op.id === 'string' && (op.op === 'put' || (op.op === 'delete' && Number.isFinite(op.updatedAt)))) : [] } catch { queue = [] }
  window.addEventListener(LOCAL_CHANGE_EVENT, localChange); window.addEventListener('online', online); document.addEventListener('visibilitychange', visible)
  started = Promise.resolve().then(() => syncNow())
  return started
}
export function _resetCloudSyncForTests() {
  generation++; clearTimeout(retry); clearTimeout(mediaTimer); clearTimeout(progressTimer)
  window.removeEventListener(LOCAL_CHANGE_EVENT, localChange); window.removeEventListener('online', online); document.removeEventListener('visibilitychange', visible)
  started = undefined; running = undefined; retry = undefined; mediaTimer = undefined; progressTimer = undefined; rerun = false; queue = []; delay = 2000; subscribers.clear(); status = {state:'idle', pending:0}
}
