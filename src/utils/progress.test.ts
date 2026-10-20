import { beforeEach, describe, expect, it } from 'vitest'
import { addSession, streakDays, totalPracticeSec, exportAllJSON, importAllJSON, upsertSection, updateSectionTempo, listSections, songProgress } from './progress'
import { createFolder, deleteFolder, getAllSongs, getFolders, getFoldersSyncDoc, getSongMediaSettings, LOCAL_CHANGE_EVENT, saveSong, saveSongMediaSettings, setSongFolder, songFolderId } from './storage'

beforeEach(() => localStorage.clear())
const session = (day: number, id = `session-${day}`) => addSession({ id, songId: 'song', start: new Date(2026, 9, day, 12).toISOString(), durationSec: 60 })
describe('practice streak', () => {
  it('counts distinct local days, including today or ending yesterday', () => {
    expect(streakDays(new Date(2026, 9, 15))).toBe(0)
    session(13); session(14); session(14, 'duplicate-day')
    expect(streakDays(new Date(2026, 9, 15))).toBe(2)
    session(15)
    expect(streakDays(new Date(2026, 9, 15))).toBe(3)
    expect(streakDays(new Date(2026, 9, 17))).toBe(0)
    session(18)
    expect(streakDays(new Date(2026, 9, 15))).toBe(3)
  })
  it('crosses month/year boundaries', () => {
    addSession({ songId: 'song', start: new Date(2025, 11, 31, 23).toISOString(), durationSec: 30 })
    addSession({ songId: 'song', start: new Date(2026, 0, 1, 1).toISOString(), durationSec: 30 })
    expect(streakDays(new Date(2026, 0, 2))).toBe(2)
  })
})
describe('backups and progress', () => {
  it('round-trips all data and merges without duplicating sessions', () => {
    const song = saveSong({ title: 'Bass', texData: 'tab' })
    saveSongMediaSettings(song.id, { originalUrl: 'https://youtu.be/dQw4w9WgXcQ', originalOffsetSec: -2 })
    session(15)
    upsertSection({ id: 'section', songId: song.id, name: 'Intro', startBar: 1, endBar: 4, status: 'mastered', maxTempoPercent: 90 })
    const backup = exportAllJSON()
    localStorage.clear()
    importAllJSON(backup, 'replace')
    importAllJSON(backup, { mode: 'merge' })
    expect(getAllSongs()).toEqual([song])
    expect(getSongMediaSettings(song.id).originalOffsetSec).toBe(-2)
    expect(totalPracticeSec()).toBe(60)
    expect(songProgress(song.id)).toEqual({ mastered: 1, total: 1, percent: 100 })
    updateSectionTempo(song.id, 'section', 70)
    expect(listSections(song.id)[0].maxTempoPercent).toBe(90)
    updateSectionTempo(song.id, 'section', 110)
    importAllJSON(backup)
    expect(listSections(song.id)[0].maxTempoPercent).toBe(110)
    importAllJSON(JSON.stringify({ version: 1, songs: [], media: {}, progress: { version: 1, sessions: [], sections: [] } }), 'replace')
    expect(getAllSongs()).toEqual([])
    expect(totalPracticeSec()).toBe(0)
  })
  it('exports the folders sync document including tombstones', () => {
    createFolder('Practice')
    const deleted = createFolder('Deleted')
    deleteFolder(deleted.id)
    expect(JSON.parse(exportAllJSON()).folders).toEqual(getFoldersSyncDoc())
    expect(JSON.parse(exportAllJSON()).folders.folders[deleted.id].deleted).toBe(true)
  })
  it.each(['merge', 'replace'] as const)('restores folders and song assignments into empty storage in %s mode', mode => {
    const folder = createFolder('Practice')
    const song = saveSong({ title: 'Bass', texData: 'tab' })
    setSongFolder(song.id, folder.id)
    const backup = exportAllJSON()
    localStorage.clear()
    const changes: unknown[] = []
    const listener = (event: Event) => changes.push((event as CustomEvent).detail)
    window.addEventListener(LOCAL_CHANGE_EVENT, listener)
    try {
      importAllJSON(backup, mode)
    } finally {
      window.removeEventListener(LOCAL_CHANGE_EVENT, listener)
    }
    expect(getFolders().map(f => f.name)).toEqual(['Practice'])
    expect(getAllSongs()[0].folderId).toBe(folder.id)
    expect(songFolderId(getAllSongs()[0])).toBe(folder.id)
    expect(changes).toContainEqual({kind: 'folders'})
  })
  it.each(['merge', 'replace'] as const)('merges folders while preserving local and imported tombstones in %s mode', mode => {
    const folder = createFolder('Practice')
    const deleted = createFolder('Deleted')
    deleteFolder(deleted.id)
    const backup = exportAllJSON()
    deleteFolder(folder.id)
    const local = createFolder('Local')
    importAllJSON(backup, mode)
    expect(getFolders().map(f => f.name)).toEqual(['Local'])
    expect(getFoldersSyncDoc().folders[folder.id].deleted).toBe(true)
    expect(getFoldersSyncDoc().folders[deleted.id].deleted).toBe(true)
    expect(getFoldersSyncDoc().folders[local.id]).toEqual(local)
  })
  it.each([null, {}, { version: 2, folders: {} }, { version: 1, folders: { bad: { id: 'other', name: 'Bad', updatedAt: 1 } } }])('rejects invalid folders before any writes: %j', folders => {
    session(15)
    createFolder('Local')
    const before = { ...localStorage }
    const backup = JSON.parse(exportAllJSON())
    backup.songs = [saveSong({ title: 'Imported', texData: 'tab' })]
    localStorage.clear()
    for (const [key, value] of Object.entries(before)) localStorage.setItem(key, value)
    backup.folders = folders
    expect(() => importAllJSON(JSON.stringify(backup), 'replace')).toThrow('Invalid or unsupported practice backup')
    expect({ ...localStorage }).toEqual(before)
  })
  it.each(['merge', 'replace'] as const)('imports legacy backups without folders in %s mode', mode => {
    const song = saveSong({ title: 'Legacy', texData: 'tab' })
    const backup = JSON.parse(exportAllJSON())
    delete backup.folders
    localStorage.clear()
    const folder = createFolder('Local')
    importAllJSON(JSON.stringify(backup), mode)
    expect(getAllSongs()).toEqual([song])
    expect(getFolders()).toEqual([folder])
  })
  it('rejects invalid backups before modifying storage', () => {
    session(15)
    const before = exportAllJSON()
    const bad = JSON.parse(before)
    bad.progress.sessions[0].durationSec = -1
    expect(() => importAllJSON(JSON.stringify(bad), 'replace')).toThrow()
    expect(exportAllJSON()).toBe(before)
    bad.version = 2
    expect(() => importAllJSON(JSON.stringify(bad))).toThrow()
    expect(() => importAllJSON('invalid')).toThrow()
  })
})

import { addAccuracyRecord, listAccuracyRecords, bestAccuracy, PROGRESS_STORAGE_KEY } from './progress'
it('reads legacy progress and round trips and deduplicates accuracy records', () => {
  localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify({ version: 1, sessions: [], sections: [] }))
  expect(listAccuracyRecords('song')).toEqual([])
  const input = { songId: 'song', sectionId: 'intro', startBar: 1, endBar: 2, level: 2 as const, accuracy: 75, hits: 2, misses: 0, early: 1, late: 1, total: 4, tempoPercent: 80, date: '2026-10-15T00:00:00.000Z' }
  addAccuracyRecord({ ...input, id: 'accuracy' })
  session(15)
  const backup = exportAllJSON()
  localStorage.clear()
  importAllJSON(backup, 'replace')
  importAllJSON(backup)
  expect(listAccuracyRecords('song', 'intro')).toHaveLength(1)
  expect(listAccuracyRecords('song', 'elsewhere')).toEqual([])
  expect(bestAccuracy('song', 'intro')).toBe(75)
  expect(totalPracticeSec()).toBe(60)
  expect(() => addAccuracyRecord({ ...input, accuracy: 101 })).toThrow()
  const invalid = JSON.parse(backup)
  invalid.progress.accuracy[0].level = 4
  expect(() => importAllJSON(JSON.stringify(invalid))).toThrow()
})
