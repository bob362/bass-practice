import { beforeEach, describe, expect, it } from 'vitest'
import { addSession, streakDays, totalPracticeSec, exportAllJSON, importAllJSON, upsertSection, updateSectionTempo, listSections, songProgress } from './progress'
import { getAllSongs, getSongMediaSettings, saveSong, saveSongMediaSettings } from './storage'

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
