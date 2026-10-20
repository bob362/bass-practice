import { emptyFoldersDoc, type FolderEntry } from '../shared/syncMerge'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ConvertedSong, LocalChange } from './storage'
import { applyFoldersSyncDoc, createFolder, deleteFolder, filterSongs, FOLDERS_STORAGE_KEY, getAllSongs, getAllTags, getFolders, getFoldersSyncDoc, LOCAL_CHANGE_EVENT, normalizeTags, putSongsFromRemote, renameFolder, setSongFolder, setSongTags, SONGS_STORAGE_KEY, songFolderId, UNFILED } from './storage'

const song = (id: string, extra: Partial<ConvertedSong> = {}): ConvertedSong => ({id, title: id, texData: 'tab', createdAt: 1, updatedAt: 1, ...extra})
function capture() {
  const log: LocalChange[] = []
  const handler = (e: Event) => log.push((e as CustomEvent<LocalChange>).detail)
  window.addEventListener(LOCAL_CHANGE_EVENT, handler)
  return {log, stop: () => window.removeEventListener(LOCAL_CHANGE_EVENT, handler)}
}
beforeEach(() => { localStorage.clear() })

describe('folders', () => {
  it('creates, trims and sorts active folders', () => {
    const b = createFolder(' b '), a = createFolder('a')
    expect(getFolders().map(f => f.name)).toEqual(['a', 'b'])
    expect(getFoldersSyncDoc().folders[a.id].name).toBe('a')
    expect(a.updatedAt).toBeGreaterThan(0)
    expect(b.id.startsWith('folder_')).toBe(true)
  })
  it('throws on empty or duplicate names', () => {
    createFolder('x')
    expect(() => createFolder('   ')).toThrow('フォルダ名を入力してください')
    expect(() => createFolder(' x ')).toThrow('同じ名前のフォルダがあります')
  })
  it('renames, bumps affected songs and emits song-saved events', () => {
    const folder = createFolder('旧')
    putSongsFromRemote([song('s1'), song('s2')])
    setSongFolder('s1', folder.id)
    const {log, stop} = capture()
    const renamed = renameFolder(folder.id, '新')
    stop()
    expect(renamed).toEqual({id: folder.id, name: '新', updatedAt: expect.any(Number)})
    expect(getFoldersSyncDoc().folders[folder.id].updatedAt).toBeGreaterThan(folder.updatedAt)
    const updated = getAllSongs().find(s => s.id === 's1')!
    expect(updated.folderId).toBe(folder.id)
    expect(updated.updatedAt).toBeGreaterThan(1)
    expect(getAllSongs().find(s => s.id === 's2')!.updatedAt).toBe(1)
    expect(log).toContainEqual({kind: 'song-saved', id: 's1'})
    expect(log).toContainEqual({kind: 'folders'})
  })
  it('rejects duplicate names excluding itself and handles missing folders', () => {
    const f = createFolder('a')
    createFolder('b')
    expect(() => renameFolder(f.id, 'b')).toThrow('同じ名前のフォルダがあります')
    expect(renameFolder(f.id, 'a')).not.toBeNull()
    expect(() => renameFolder(f.id, '  ')).toThrow('フォルダ名を入力してください')
    expect(renameFolder('missing', 'x')).toBeNull()
    expect(deleteFolder('missing')).toBe(false)
  })
  it('deletes with tombstone, unfiles songs and notifies', () => {
    const folder = createFolder('del')
    putSongsFromRemote([song('s1')])
    setSongFolder('s1', folder.id)
    const {log, stop} = capture()
    expect(deleteFolder(folder.id)).toBe(true)
    stop()
    const stored = JSON.parse(localStorage.getItem(SONGS_STORAGE_KEY)!).find((s: {id: string}) => s.id === 's1')
    expect(stored).not.toHaveProperty('folderId')
    expect(getAllSongs().find(s => s.id === 's1')!.updatedAt).toBeGreaterThan(1)
    expect(log).toContainEqual({kind: 'song-saved', id: 's1'})
    expect(log).toContainEqual({kind: 'folders'})
    expect(getFoldersSyncDoc().folders[folder.id]).toEqual({id: folder.id, name: 'del', updatedAt: expect.any(Number), deleted: true})
    expect(getFolders()).toEqual([])
  })
  it('reads invalid storage as empty and applies sync docs without events', () => {
    localStorage.setItem(FOLDERS_STORAGE_KEY, '{bad')
    expect(getFoldersSyncDoc()).toEqual(emptyFoldersDoc())
    const {log, stop} = capture()
    applyFoldersSyncDoc(emptyFoldersDoc())
    stop()
    expect(log).toEqual([])
  })
  it('maps songs to folders counting deleted folders as unfiled', () => {
    const folders: FolderEntry[] = [{id: 'f1', name: 'a', updatedAt: 1}, {id: 'gone', name: 'g', updatedAt: 2, deleted: true}]
    expect(songFolderId({...song('x'), folderId: 'f1'}, folders)).toBe('f1')
    expect(songFolderId({...song('x'), folderId: 'gone'}, folders)).toBe(UNFILED)
    expect(songFolderId(song('x'), folders)).toBe(UNFILED)
  })
})

describe('tags', () => {
  it('normalizes, truncates, dedupes and limits tags', () => {
    expect(normalizeTags(['  Rock ', 'rock', '  ', 'J A Z Z', 'x'.repeat(40)])).toEqual(['Rock', 'J A Z Z', 'x'.repeat(30)])
    expect(normalizeTags(['Rock', 'ROCK'])).toEqual(['Rock'])
    expect(normalizeTags(Array.from({length: 25}, (_, i) => `t${i}`))).toHaveLength(20)
  })
  it('sets song tags and lists all tags across songs', () => {
    putSongsFromRemote([song('s1'), song('s2', {tags: ['ゾネ', 'ロック']}), song('legacy')])
    setSongTags('s1', [' Rock ', 'rock', 'x'.repeat(35)])
    expect(getAllSongs().find(s => s.id === 's1')!.tags).toEqual(['Rock', 'x'.repeat(30)])
    expect(getAllTags().length).toBe(4)
    expect(getAllTags([song('s2', {tags: ['ロック', 'ゾネ']})])).toEqual(['ゾネ', 'ロック'])
  })
})

describe('filterSongs', () => {
  const folders: FolderEntry[] = [{id: 'f1', name: 'a', updatedAt: 1}, {id: 'gone', name: 'g', updatedAt: 2, deleted: true}]
  const select = (filter: Parameters<typeof filterSongs>[1]) => filterSongs(getAllSongs(), filter, folders).map(s => s.id)
  it('filters by folder including all and unfiled, deleted folders count as unfiled', () => {
    putSongsFromRemote([song('a', {folderId: 'f1'}), song('b', {folderId: 'gone'}), song('c')])
    expect(select({folderId: '__all__', tags: [], query: ''})).toEqual(['a', 'b', 'c'])
    expect(select({folderId: 'f1', tags: [], query: ''})).toEqual(['a'])
    expect(select({folderId: UNFILED, tags: [], query: ''})).toEqual(['b', 'c'])
    expect(select({folderId: 'gone', tags: [], query: ''})).toEqual([])
  })
  it('requires every tag, case-insensitively', () => {
    putSongsFromRemote([song('a', {tags: ['Rock', 'Metal']}), song('b', {tags: ['rock']}), song('legacy')])
    expect(select({folderId: '__all__', tags: ['rock', 'metal'], query: ''})).toEqual(['a'])
    expect(select({folderId: '__all__', tags: ['ROCK'], query: ''})).toEqual(['a', 'b'])
  })
  it('matches all query terms over title, artist and tags', () => {
    putSongsFromRemote([song('a', {title: 'Night Drive', artist: 'City Pop Band', tags: ['ドライブ']}), song('b', {title: 'Day Cruise'}), song('c', {title: 'night'})])
    expect(select({folderId: '__all__', tags: [], query: 'night drive'})).toEqual(['a'])
    expect(select({folderId: '__all__', tags: [], query: 'NIGHT'})).toEqual(['a', 'c'])
    expect(select({folderId: '__all__', tags: [], query: 'city'})).toEqual(['a'])
    expect(select({folderId: '__all__', tags: [], query: '   '})).toEqual(['a', 'b', 'c'])
  })
  it('tolerates legacy songs and malformed tags', () => {
    localStorage.setItem(SONGS_STORAGE_KEY, JSON.stringify([song('bad', {tags: 'rock' as unknown as string[]}), song('plain')]))
    expect(getAllSongs().find(s => s.id === 'bad')!.tags).toBeUndefined()
    expect(select({folderId: UNFILED, tags: ['rock'], query: ''})).toEqual([])
    expect(select({folderId: UNFILED, tags: [], query: ''})).toEqual(['bad', 'plain'])
  })
})

it('allows reuse of deleted folder names and enforces the sync name limit', () => {
  const folder = createFolder('Reusable')
  deleteFolder(folder.id)
  const replacement = createFolder('Reusable')
  expect(replacement.id).not.toBe(folder.id)
  expect(renameFolder(replacement.id, 'Reusable')?.name).toBe('Reusable')
  expect(() => createFolder('x'.repeat(101))).toThrow()
  expect(() => renameFolder(replacement.id, 'x'.repeat(101))).toThrow()
  expect(getFoldersSyncDoc().folders[folder.id].deleted).toBe(true)
})

it('removes the stored folderId when explicitly unfiling a song', () => {
  const folder = createFolder('Folder')
  putSongsFromRemote([song('s')])
  setSongFolder('s', folder.id)
  const before = getAllSongs()[0].updatedAt
  expect(setSongFolder('s', UNFILED)).not.toHaveProperty('folderId')
  expect(getAllSongs()[0].updatedAt).toBeGreaterThan(before)
  expect(JSON.parse(localStorage.getItem(SONGS_STORAGE_KEY)!)[0]).not.toHaveProperty('folderId')
  setSongFolder('s', folder.id)
  expect(setSongFolder('s', null)).not.toHaveProperty('folderId')
})

it('strictly increases folder and affected song timestamps even ahead of the clock', () => {
  const folder = createFolder('Original')
  putSongsFromRemote([song('s', {folderId:folder.id, updatedAt:Date.now() + 10000})])
  const before = getAllSongs()[0].updatedAt
  const renamed = renameFolder(folder.id, 'Renamed')!
  expect(renamed.updatedAt).toBeGreaterThan(folder.updatedAt)
  expect(getAllSongs()[0].updatedAt).toBeGreaterThan(before)
  const afterRename = getAllSongs()[0].updatedAt
  deleteFolder(folder.id)
  expect(getFoldersSyncDoc().folders[folder.id].updatedAt).toBeGreaterThan(renamed.updatedAt)
  expect(getAllSongs()[0].updatedAt).toBeGreaterThan(afterRename)
})
