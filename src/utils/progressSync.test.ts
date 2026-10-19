import { beforeEach, expect, it } from 'vitest'
import { emptyProgressDoc, sectionKey } from '../shared/syncMerge'
import { applyProgressSyncDoc, deleteSection, getProgressSyncDoc, listSections, listSessions, upsertSection, importAllJSON, exportAllJSON } from './progress'
beforeEach(() => localStorage.clear())
it('tracks section tombstones and clears them on recreation', () => {
  const input = {id:'section', songId:'song', name:'Intro', startBar:1, endBar:4, status:'practicing' as const}
  upsertSection(input); deleteSection('song', 'section')
  expect(getProgressSyncDoc().deletedSections[sectionKey('song','section')]).toBeDefined()
  upsertSection(input)
  expect(getProgressSyncDoc().deletedSections[sectionKey('song','section')]).toBeUndefined()
})
it('filters invalid and duplicate remote progress without discarding valid entries', () => {
  const doc = emptyProgressDoc()
  const session = {id:'session', songId:'song', start:'2026-01-01T00:00:00Z', durationSec:20}
  doc.sessions = [session, session, {id:'bad'}]
  doc.sections = [{id:'bad', songId:'song', updatedAt:'invalid'}]
  doc.accuracy = [{id:'bad'}]
  applyProgressSyncDoc(doc)
  expect(listSessions()).toEqual([session])
  expect(listSections('song')).toEqual([])
  expect(getProgressSyncDoc().accuracy).toEqual([])
})

it('updates import media clocks and reconciles song and section tombstones', async () => {
  const s = await import('./storage')
  const section = upsertSection({id:'keep',songId:'imported',name:'Intro',startBar:1,endBar:2,status:'practicing'})
  const importedSong = {id:'imported',title:'imported',texData:'tab',createdAt:1,updatedAt:1}
  const backup = {version:1,songs:[importedSong],media:{imported:{playthroughOffsetSec:0,originalOffsetSec:0,playbackRate:1}},progress:{version:1,sessions:[],sections:[section]}}
  deleteSection('imported','keep')
  s.setSongTombstones({imported:100})
  importAllJSON(JSON.stringify(backup))
  expect(s.getSongTombstones().imported).toBeUndefined()
  expect(getProgressSyncDoc().deletedSections[sectionKey('imported','keep')]).toBeUndefined()
  expect(s.getMediaSyncDoc().entries.imported.updatedAt).toBeGreaterThan(100)
  const removed = s.saveSong({title:'removed',texData:'tab'})
  upsertSection({id:'removed',songId:removed.id,name:'Removed',startBar:1,endBar:2,status:'practicing'})
  importAllJSON(JSON.stringify(backup),'replace')
  expect(s.getSongTombstones()[removed.id]).toBeGreaterThan(0)
  expect(getProgressSyncDoc().deletedSections[sectionKey(removed.id,'removed')]).toBeDefined()
  expect(JSON.parse(exportAllJSON()).songs).toEqual([importedSong])
})
