import { sectionKey, mergeFoldersDocs, isFoldersDoc, type FoldersDoc, type ProgressDoc } from '../shared/syncMerge'
import { notifyLocalChange, touchMediaMeta, getSongTombstones, setSongTombstones, getFoldersSyncDoc, applyFoldersSyncDoc } from './storage'
import { getAllSongs, getAllMediaSettings, isSongMediaSettings, SONGS_STORAGE_KEY, MEDIA_STORAGE_KEY } from './storage'
import type { ConvertedSong, SongMediaSettings } from './storage'

export interface PracticeSession { id: string; songId: string; start: string; durationSec: number }
export type SectionStatus = 'not_started' | 'practicing' | 'mastered'
export interface PracticeSection {
  id: string; songId: string; name: string; startBar: number; endBar: number
  status: SectionStatus; maxTempoPercent: number; updatedAt: string
}
export interface AccuracyRecord {
  id: string; songId: string; sectionId?: string; startBar: number; endBar: number; level: 0 | 1 | 2 | 3
  accuracy: number; hits: number; misses: number; early: number; late: number; total: number; tempoPercent: number; date: string
}
export interface ProgressData { version: 1; sessions: PracticeSession[]; sections: PracticeSection[]; accuracy?: AccuracyRecord[] }
export const PROGRESS_STORAGE_KEY = 'bass_practice_progress'
const empty = (): ProgressData => ({ version: 1, sessions: [], sections: [], accuracy: [] })
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v))
function sessionValid(v: unknown): v is PracticeSession {
  return record(v) && nonempty(v.id) && nonempty(v.songId) && date(v.start) && finite(v.durationSec) && v.durationSec >= 0
}
function sectionValid(v: unknown): v is PracticeSection {
  return record(v) && nonempty(v.id) && nonempty(v.songId) && nonempty(v.name) &&
    Number.isInteger(v.startBar) && (v.startBar as number) >= 1 && Number.isInteger(v.endBar) && (v.endBar as number) >= (v.startBar as number) &&
    ['not_started', 'practicing', 'mastered'].includes(v.status as string) && finite(v.maxTempoPercent) && v.maxTempoPercent >= 0 && date(v.updatedAt)
}
function accuracyValid(v: unknown): v is AccuracyRecord {
  return record(v) && nonempty(v.id) && nonempty(v.songId) && (v.sectionId === undefined || nonempty(v.sectionId)) &&
    Number.isInteger(v.startBar) && (v.startBar as number) >= 1 && Number.isInteger(v.endBar) && (v.endBar as number) >= (v.startBar as number) &&
    [0, 1, 2, 3].includes(v.level as number) && finite(v.accuracy) && v.accuracy >= 0 && v.accuracy <= 100 &&
    ['hits', 'misses', 'early', 'late', 'total'].every(k => Number.isInteger(v[k]) && (v[k] as number) >= 0) && finite(v.tempoPercent) && v.tempoPercent > 0 && date(v.date)
}
function progressValid(v: unknown): v is ProgressData {
  return record(v) && (v.accuracy === undefined || (Array.isArray(v.accuracy) && v.accuracy.every(accuracyValid) && new Set(v.accuracy.map(a => a.id)).size === v.accuracy.length)) && v.version === 1 && Array.isArray(v.sessions) && v.sessions.every(sessionValid) && Array.isArray(v.sections) && v.sections.every(sectionValid) &&
    new Set(v.sessions.map(s => s.id)).size === v.sessions.length && new Set(v.sections.map(s => `${s.songId}\0${s.id}`)).size === v.sections.length
}
function read(): ProgressData {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY) ?? 'null')
    return progressValid(value) ? { ...value, accuracy: value.accuracy ?? [] } : empty()
  } catch { return empty() }
}
const write = (data: ProgressData) => { localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(data)); notifyLocalChange({kind:'progress'}) }
const SECTION_TOMBSTONES_KEY = 'bass_practice_section_tombstones'
function sectionTombstones(): Record<string, string> {
  try { const v = JSON.parse(localStorage.getItem(SECTION_TOMBSTONES_KEY) ?? '{}'); return record(v) ? v as Record<string, string> : {} } catch { return {} }
}
const newId = () => crypto.randomUUID()
export function addSession(input: Omit<PracticeSession, 'id'> & { id?: string }): PracticeSession {
  const session = { ...input, id: input.id ?? newId() }
  if (!sessionValid(session)) throw new Error('Invalid practice session')
  const data = read()
  if (data.sessions.some(s => s.id === session.id)) throw new Error('Duplicate session ID')
  data.sessions.push(session)
  write(data)
  return session
}
export function listSessions(songId?: string): PracticeSession[] {
  return read().sessions.filter(s => songId === undefined || s.songId === songId).sort((a, b) => Date.parse(b.start) - Date.parse(a.start))
}
export function totalPracticeSec(songId?: string): number {
  return listSessions(songId).reduce((sum, s) => sum + s.durationSec, 0)
}
function localDay(d: Date): string { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }
/** Sessions count on the local calendar date on which they started. */
export function streakDays(today: Date = new Date()): number {
  if (!Number.isFinite(today.getTime())) throw new Error('Invalid date')
  const days = new Set(listSessions().map(s => localDay(new Date(s.start))))
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12)
  if (!days.has(localDay(cursor))) cursor.setDate(cursor.getDate() - 1)
  let count = 0
  while (days.has(localDay(cursor))) { count++; cursor.setDate(cursor.getDate() - 1) }
  return count
}
export function listSections(songId: string): PracticeSection[] { return read().sections.filter(s => s.songId === songId) }
export function upsertSection(input: Omit<PracticeSection, 'id' | 'updatedAt' | 'maxTempoPercent'> & { id?: string; maxTempoPercent?: number }): PracticeSection {
  if (input.maxTempoPercent !== undefined && (!finite(input.maxTempoPercent) || input.maxTempoPercent < 0)) throw new Error('Invalid tempo')
  const data = read()
  const index = data.sections.findIndex(s => s.songId === input.songId && s.id === input.id)
  const section: PracticeSection = { ...input, id: input.id ?? newId(), maxTempoPercent: Math.max(input.maxTempoPercent ?? 0, data.sections[index]?.maxTempoPercent ?? 0), updatedAt: new Date().toISOString() }
  if (!sectionValid(section)) throw new Error('Invalid practice section')
  if (index < 0) data.sections.push(section)
  else data.sections[index] = section
  const tombstones = sectionTombstones()
  delete tombstones[sectionKey(section.songId, section.id)]
  localStorage.setItem(SECTION_TOMBSTONES_KEY, JSON.stringify(tombstones))
  write(data)
  return section
}
export function deleteSection(songId: string, id: string): boolean {
  const data = read()
  const length = data.sections.length
  data.sections = data.sections.filter(s => s.songId !== songId || s.id !== id)
  if (length === data.sections.length) return false
  localStorage.setItem(SECTION_TOMBSTONES_KEY, JSON.stringify({...sectionTombstones(), [sectionKey(songId, id)]: new Date().toISOString()}))
  write(data)
  return true
}
export function updateSectionTempo(songId: string, id: string, tempoPercent: number): PracticeSection | null {
  if (!finite(tempoPercent) || tempoPercent < 0) throw new Error('Invalid tempo')
  const section = listSections(songId).find(s => s.id === id)
  return section ? upsertSection({ ...section, maxTempoPercent: tempoPercent }) : null
}
export function songProgress(songId: string): { mastered: number; total: number; percent: number } {
  const sections = listSections(songId)
  const mastered = sections.filter(s => s.status === 'mastered').length
  return { mastered, total: sections.length, percent: sections.length ? mastered / sections.length * 100 : 0 }
}
export interface PracticeBackup { version: 1; songs: ConvertedSong[]; media: Record<string, SongMediaSettings>; progress: ProgressData; folders?: FoldersDoc }
export function exportAllJSON(): string {
  return JSON.stringify({ version: 1, songs: getAllSongs(), media: getAllMediaSettings(), progress: read(), folders: getFoldersSyncDoc() } satisfies PracticeBackup, null, 2)
}
function songValid(v: unknown): v is ConvertedSong {
  return record(v) && nonempty(v.id) && typeof v.title === 'string' && typeof v.texData === 'string' &&
    (v.artist === undefined || typeof v.artist === 'string') && (v.pdfData === undefined || typeof v.pdfData === 'string') && finite(v.createdAt) && finite(v.updatedAt)
}
/** Merge matches IDs; imported songs/media win, newer sections win, session IDs deduplicate.
 * Validation finishes before any writes. Storage failures roll back all three keys. */
export function importAllJSON(json: string, options: 'merge' | 'replace' | { mode: 'merge' | 'replace' } = 'merge'): void {
  const value: unknown = JSON.parse(json)
  const mode = typeof options === 'string' ? options : options.mode
  if (!['merge', 'replace'].includes(mode) || !record(value) || value.version !== 1 || !Array.isArray(value.songs) || !value.songs.every(songValid) ||
    new Set(value.songs.map(s => s.id)).size !== value.songs.length || !record(value.media) || !Object.values(value.media).every(isSongMediaSettings) || !progressValid(value.progress) ||
    (value.folders !== undefined && !isFoldersDoc(value.folders))) throw new Error('Invalid or unsupported practice backup')
  const imported = value as unknown as PracticeBackup
  const localSongs = getAllSongs(), localSections = read().sections
  let songs = imported.songs, media = imported.media, progress = { ...imported.progress, accuracy: imported.progress.accuracy ?? [] }
  if (mode === 'merge') {
    songs = [...new Map([...getAllSongs(), ...songs].map(s => [s.id, s])).values()]
    media = { ...getAllMediaSettings(), ...media }
    const current = read()
    const sections = new Map(current.sections.map(s => [`${s.songId}\0${s.id}`, s]))
    for (const section of progress.sections) {
      const key = `${section.songId}\0${section.id}`
      const prior = sections.get(key)
      const winner = prior && Date.parse(prior.updatedAt) > Date.parse(section.updatedAt) ? prior : section
      sections.set(key, { ...winner, maxTempoPercent: Math.max(prior?.maxTempoPercent ?? 0, section.maxTempoPercent) })
    }
    progress = { version: 1, sessions: [...new Map([...current.sessions, ...progress.sessions].map(s => [s.id, s])).values()], sections: [...sections.values()], accuracy: [...new Map([...(current.accuracy ?? []), ...(progress.accuracy ?? [])].map(a => [a.id, a])).values()] }
  }
  const entries = [[SONGS_STORAGE_KEY, JSON.stringify(songs)], [MEDIA_STORAGE_KEY, JSON.stringify(media)], [PROGRESS_STORAGE_KEY, JSON.stringify(progress)]]
  const previous = entries.map(([key]) => [key, localStorage.getItem(key)] as const)
  try { for (const [key, data] of entries) localStorage.setItem(key, data) }
  catch (error) {
    for (const [key, data] of previous) { try { if (data === null) localStorage.removeItem(key); else localStorage.setItem(key, data) } catch { /* Best-effort rollback when storage is unavailable. */ } }
    throw error
  }
  const now = Date.now(), songTombstones = getSongTombstones(), deletedSections = sectionTombstones()
  if (mode === 'replace') {
    for (const song of localSongs) if (!imported.songs.some(s => s.id === song.id)) songTombstones[song.id] = now
    for (const section of localSections) if (!imported.progress.sections.some(s => sectionKey(s.songId,s.id) === sectionKey(section.songId,section.id))) deletedSections[sectionKey(section.songId,section.id)] = new Date(now).toISOString()
  }
  for (const song of imported.songs) delete songTombstones[song.id]
  for (const section of imported.progress.sections) delete deletedSections[sectionKey(section.songId,section.id)]
  setSongTombstones(songTombstones)
  localStorage.setItem(SECTION_TOMBSTONES_KEY, JSON.stringify(deletedSections))
  touchMediaMeta(Object.keys(imported.media), now)
  if (imported.folders !== undefined) {
    applyFoldersSyncDoc(mergeFoldersDocs(getFoldersSyncDoc(), imported.folders))
    notifyLocalChange({kind:'folders'})
  }
  notifyLocalChange({kind:'all'})
}

export function addAccuracyRecord(input: Omit<AccuracyRecord, 'id'> & { id?: string }): AccuracyRecord {
  const entry = { ...input, id: input.id ?? newId() }
  if (!accuracyValid(entry)) throw new Error('Invalid accuracy record')
  const data = read()
  if (data.accuracy?.some(a => a.id === entry.id)) throw new Error('Duplicate accuracy ID')
  data.accuracy = [...(data.accuracy ?? []), entry]
  write(data)
  return entry
}
export function listAccuracyRecords(songId: string, sectionId?: string): AccuracyRecord[] {
  return (read().accuracy ?? []).filter(a => a.songId === songId && (sectionId === undefined || a.sectionId === sectionId)).sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
}
export function bestAccuracy(songId: string, sectionId?: string): number {
  return Math.max(0, ...listAccuracyRecords(songId, sectionId).map(a => a.accuracy))
}

export function getProgressSyncDoc(): ProgressDoc {
  const data = read()
  return {version: 1, sessions: data.sessions.map(s => ({...s})), sections: data.sections.map(s => ({...s})), accuracy: (data.accuracy ?? []).map(s => ({...s})), deletedSections: sectionTombstones()}
}
export function applyProgressSyncDoc(doc: ProgressDoc) {
  function clean<T>(items: unknown[], valid: (v: unknown) => v is T, key: (v: T) => string): T[] {
    const seen = new Set<string>()
    return items.filter(valid).filter(v => { const k = key(v); if (seen.has(k)) return false; seen.add(k); return true })
  }
  const data: ProgressData = {version: 1, sessions: clean(doc.sessions, sessionValid, s => s.id), sections: clean(doc.sections, sectionValid, s => sectionKey(s.songId, s.id)), accuracy: clean(doc.accuracy, accuracyValid, s => s.id)}
  localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(data))
  localStorage.setItem(SECTION_TOMBSTONES_KEY, JSON.stringify(doc.deletedSections))
}
