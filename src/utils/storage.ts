import { ensureUpdatedAt, type MediaDoc } from '../shared/syncMerge'
/**
 * 変換済みタブ譜のlocalStorage管理
 */

export interface ConvertedSong {
  id: string
  title: string
  artist?: string
  texData: string
  pdfData?: string // base64エンコードされたPDFデータ
  /** Guitar Proファイル本体（base64）。あればtexDataより優先して読み込む */
  gpData?: string
  /** gpDataの元形式（gp/gp3/gp4/gp5/gpx） */
  gpFormat?: string
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'bass_practice_songs'

/**
 * 全ての曲を取得
 */
export type LocalChange = {kind:'song-saved'; id:string} | {kind:'song-deleted'; id:string; deletedAt:number} | {kind:'media'; songId:string} | {kind:'progress'} | {kind:'all'}
export const LOCAL_CHANGE_EVENT = 'bass-practice:local-change'
export function notifyLocalChange(c: LocalChange) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LOCAL_CHANGE_EVENT, { detail: c }))
}
const memorySongs = new Map<string, ConvertedSong>()
const TOMBSTONES_KEY = 'bass_practice_song_tombstones'
const MEDIA_META_KEY = 'bass_practice_media_meta'
function readMap<T>(key: string): Record<string, T> {
  try { const v = JSON.parse(localStorage.getItem(key) ?? '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {} } catch { return {} }
}
export const getSongTombstones = (): Record<string, number> => readMap(TOMBSTONES_KEY)
export function setSongTombstones(t: Record<string, number>) { localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(t)) }
function clearTombstones(ids: string[]) {
  const t = getSongTombstones()
  for (const id of ids) delete t[id]
  try { setSongTombstones(t) } catch { console.warn('Unable to persist song tombstones') }
}
function writeSongs(songs: ConvertedSong[], preferEvict: string[] = []) {
  memorySongs.clear()
  const remaining = [...songs]
  for (;;) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining)); return }
    catch {
      console.warn('Song storage full; keeping songs in memory for cloud sync')
      if (!remaining.length) {
        for (const song of songs) memorySongs.set(song.id, song)
        try { localStorage.removeItem(STORAGE_KEY) } catch { /* Storage may be entirely unavailable. */ }
        return
      }
      let largest = remaining.findIndex(s => preferEvict.includes(s.id))
      const preferred = largest >= 0
      if (!preferred) largest = 0
      for (let i = 1; i < remaining.length; i++) if (!preferred && JSON.stringify(remaining[i]).length > JSON.stringify(remaining[largest]).length) largest = i
      const [song] = remaining.splice(largest, 1)
      memorySongs.set(song.id, song)
    }
  }
}
export function getAllSongs(): ConvertedSong[] {
  let stored: ConvertedSong[] = []
  try { const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); if (Array.isArray(data)) stored = data } catch { /* Use memory when storage is unavailable. */ }
  return [...new Map([...stored, ...memorySongs.values()].map(s => [s.id, ensureUpdatedAt(s, 0)])).values()]
}
export function putSongsFromRemote(songs: ConvertedSong[]) {
  writeSongs([...new Map([...getAllSongs(), ...songs].map(s => [s.id, s])).values()], songs.map(s => s.id))
  clearTombstones(songs.map(s => s.id))
}
export function removeSongsFromRemote(ids: string[]) {
  writeSongs(getAllSongs().filter(s => !ids.includes(s.id)))
}

/**
 * 曲を保存
 */
export function saveSong(song: Omit<ConvertedSong, 'id' | 'createdAt' | 'updatedAt'>): ConvertedSong {
  const songs = getAllSongs()
  const now = Date.now()
  
  const newSong: ConvertedSong = {
    ...song,
    id: `song_${now}_${Math.random().toString(36).substr(2, 9)}`,
    createdAt: now,
    updatedAt: now,
  }
  
  songs.push(newSong)
  writeSongs(songs, [newSong.id])
  clearTombstones([newSong.id])
  notifyLocalChange({kind: 'song-saved', id: newSong.id})
  
  return newSong
}

/**
 * 曲を更新
 */
export function updateSong(id: string, updates: Partial<Omit<ConvertedSong, 'id' | 'createdAt'>>): ConvertedSong | null {
  const songs = getAllSongs()
  const index = songs.findIndex(s => s.id === id)
  
  if (index === -1) return null
  
  songs[index] = {
    ...songs[index],
    ...updates,
    updatedAt: Date.now(),
  }
  
  writeSongs(songs, [id])
  clearTombstones([id])
  notifyLocalChange({kind: 'song-saved', id})
  return songs[index]
}

/**
 * 曲を削除
 */
export function deleteSong(id: string): boolean {
  const songs = getAllSongs()
  const filtered = songs.filter(s => s.id !== id)
  
  if (filtered.length === songs.length) return false
  
  writeSongs(filtered)
  const deletedAt = Date.now()
  setSongTombstones({ ...getSongTombstones(), [id]: deletedAt })
  notifyLocalChange({kind: 'song-deleted', id, deletedAt})
  return true
}

/**
 * IDで曲を取得
 */
export function getSongById(id: string): ConvertedSong | null {
  const songs = getAllSongs()
  return songs.find(s => s.id === id) || null
}

/**
 * PDFをbase64に変換
 */
export async function pdfToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * base64からPDF Blobを生成
 */
export function base64ToPdfBlob(base64: string): Blob {
  const parts = base64.split(',')
  const data = parts.length > 1 ? parts[1] : parts[0]
  const binary = atob(data)
  const array = new Uint8Array(binary.length)
  
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i)
  }
  
  return new Blob([array], { type: 'application/pdf' })
}

export interface SongMediaSettings {
  playthroughUrl?: string
  originalUrl?: string
  playthroughOffsetSec: number
  originalOffsetSec: number
  playbackRate: number
  /** 動画の音量 0-100 */
  volume?: number
  /** 動画をミュートするか */
  muted?: boolean
  /** 譜面（ベース）の音を鳴らさない。カーソルと同期は動いたまま */
  tabMuted?: boolean
}

export const MEDIA_STORAGE_KEY = 'bass_practice_media'
export const SONGS_STORAGE_KEY = STORAGE_KEY
export const DEFAULT_VIDEO_VOLUME = 100
export const DEFAULT_MEDIA_SETTINGS: Readonly<SongMediaSettings> = {
  playthroughOffsetSec: 0, originalOffsetSec: 0, playbackRate: 1,
  volume: 100, muted: false,
}

export function isSongMediaSettings(value: unknown): value is SongMediaSettings {
  if (!value || typeof value !== 'object') return false
  const v = value as SongMediaSettings
  return (v.playthroughUrl === undefined || typeof v.playthroughUrl === 'string') &&
    (v.originalUrl === undefined || typeof v.originalUrl === 'string') &&
    Number.isFinite(v.playthroughOffsetSec) && Number.isFinite(v.originalOffsetSec) &&
    Number.isFinite(v.playbackRate) && v.playbackRate > 0 &&
    (v.volume === undefined || (typeof v.volume === 'number' && Number.isFinite(v.volume) &&
      v.volume >= 0 && v.volume <= 100)) &&
    (v.muted === undefined || typeof v.muted === 'boolean') &&
    (v.tabMuted === undefined || typeof v.tabMuted === 'boolean')
}

export function getAllMediaSettings(): Record<string, SongMediaSettings> {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(MEDIA_STORAGE_KEY) ?? '{}')
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
    return Object.fromEntries(Object.entries(data).filter(([, value]) => isSongMediaSettings(value)))
  } catch { return {} }
}

export function getSongMediaSettings(songId: string): SongMediaSettings {
  return { ...DEFAULT_MEDIA_SETTINGS, ...getAllMediaSettings()[songId] }
}

export function saveSongMediaSettings(songId: string, updates: Partial<SongMediaSettings>): SongMediaSettings {
  if (!songId) throw new Error('Song ID is required')
  const normalized: Partial<SongMediaSettings> = { ...updates }
  if (typeof normalized.volume === 'number' && Number.isFinite(normalized.volume)) {
    normalized.volume = Math.round(Math.min(100, Math.max(0, normalized.volume)))
  }
  const settings = { ...getSongMediaSettings(songId), ...normalized }
  if (!isSongMediaSettings(settings)) throw new Error('Invalid media settings')
  localStorage.setItem(MEDIA_STORAGE_KEY, JSON.stringify({ ...getAllMediaSettings(), [songId]: settings }))
  localStorage.setItem(MEDIA_META_KEY, JSON.stringify({ ...readMap<number>(MEDIA_META_KEY), [songId]: Date.now() }))
  notifyLocalChange({kind: 'media', songId})
  return settings
}

export function getMediaSyncDoc(): MediaDoc {
  const meta = readMap<number>(MEDIA_META_KEY)
  const settings = getAllMediaSettings()
  return { version: 1, entries: Object.fromEntries([...new Set([...Object.keys(settings), ...Object.keys(meta)])].map(id => [id, {updatedAt: meta[id] ?? 0, settings: settings[id] ?? null}])) }
}
export function applyMediaSyncDoc(doc: MediaDoc) {
  const settings = getAllMediaSettings(), meta = readMap<number>(MEDIA_META_KEY)
  for (const [id, entry] of Object.entries(doc.entries)) {
    if (entry.settings === null) delete settings[id]
    else if (isSongMediaSettings(entry.settings)) settings[id] = entry.settings
    else continue
    meta[id] = entry.updatedAt
  }
  localStorage.setItem(MEDIA_STORAGE_KEY, JSON.stringify(settings))
  localStorage.setItem(MEDIA_META_KEY, JSON.stringify(meta))
}

export function touchMediaMeta(ids: string[], at: number) {
  const meta = readMap<number>(MEDIA_META_KEY)
  for (const id of ids) meta[id] = at
  localStorage.setItem(MEDIA_META_KEY, JSON.stringify(meta))
}
