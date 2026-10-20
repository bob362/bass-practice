import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ConvertedSong } from '../../utils/storage'

const fake = vi.hoisted(() => {
  type Song = { id: string; title: string; artist?: string; texData: string; createdAt: number; updatedAt: number; folderId?: string; tags?: string[] }
  type Folder = { id: string; name: string; updatedAt: number; deleted?: boolean }
  const state = { songs: [] as Song[], folders: [] as Folder[], seq: 0 }
  const UNFILED = '__unfiled__'
  const ALL_FOLDERS = '__all__'
  const normalizeTags = (tags: string[]) => Array.from(new Set(tags.map(t => t.trim()).filter(Boolean)))
  const active = () => state.folders.filter(f => !f.deleted)
  const checkName = (name: string, id?: string) => {
    const n = name.trim()
    if (!n) throw new Error('フォルダ名を入力してください')
    if (active().some(f => f.name === n && f.id !== id)) throw new Error('同じ名前のフォルダがあります')
    return n
  }
  const songFolderId = (s: Song, folders = active()) =>
    s.folderId && folders.some(f => f.id === s.folderId) ? s.folderId : UNFILED
  return {
    state,
    mod: {
      UNFILED, ALL_FOLDERS, normalizeTags,
      getFolders: () => active().map(f => ({ ...f })),
      createFolder: (name: string) => {
        const f = { id: `f${++state.seq}`, name: checkName(name), updatedAt: Date.now() }
        state.folders.push(f)
        return f
      },
      renameFolder: (id: string, name: string) => {
        const f = state.folders.find(x => x.id === id)
        if (!f) return null
        f.name = checkName(name, id)
        return f
      },
      deleteFolder: (id: string) => {
        const f = state.folders.find(x => x.id === id)
        if (!f) return false
        f.deleted = true
        state.songs.forEach(s => { if (s.folderId === id) delete s.folderId })
        return true
      },
      setSongFolder: (songId: string, folderId: string | null) => {
        const s = state.songs.find(x => x.id === songId)
        if (!s) return null
        if (folderId) s.folderId = folderId
        else delete s.folderId
        return s
      },
      setSongTags: (songId: string, tags: string[]) => {
        const s = state.songs.find(x => x.id === songId)
        if (!s) return null
        s.tags = normalizeTags(tags)
        return s
      },
      getAllTags: (songs: Song[] = state.songs) => Array.from(new Set(songs.flatMap(s => s.tags ?? []))).sort(),
      songFolderId,
      filterSongs: (songs: Song[], filter: { folderId: string; tags: string[]; query: string }, folders = active()) =>
        songs.filter(s => {
          if (filter.folderId !== ALL_FOLDERS && songFolderId(s, folders) !== filter.folderId) return false
          if (!filter.tags.every(t => (s.tags ?? []).includes(t))) return false
          const q = filter.query.trim().toLowerCase()
          if (q && ![s.title, s.artist ?? '', ...(s.tags ?? [])].some(v => v.toLowerCase().includes(q))) return false
          return true
        }),
      getAllSongs: () => state.songs.map(s => ({ ...s, tags: s.tags ? [...s.tags] : undefined })),
    },
  }
})

vi.mock('../../utils/storage', () => fake.mod)
vi.mock('../../utils/cloudSync', () => ({ SONGS_CHANGED_EVENT: 'bass-practice:songs-changed' }))

import SongLibrary from './SongLibrary'

const song = (id: string, title: string, extra: Partial<ConvertedSong> = {}) =>
  ({ id, title, texData: '', createdAt: 1, updatedAt: 1, ...extra })

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
const opened = vi.fn()
const deleted = vi.fn()

function Harness() {
  const [songs, setSongs] = useState<ConvertedSong[]>(() => fake.mod.getAllSongs() as ConvertedSong[])
  return (
    <SongLibrary
      songs={songs}
      onOpenSong={opened}
      onDeleteSong={(id, e) => { e.stopPropagation(); deleted(id) }}
      onSongsUpdated={() => setSongs(fake.mod.getAllSongs() as ConvertedSong[])}
    />
  )
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  fake.state.songs = [
    song('s1', 'Alpha', { artist: 'Band', tags: ['rock', 'easy'] }),
    song('s2', 'Beta', { tags: ['jazz'] }),
    song('s3', 'Gamma'),
  ]
  fake.state.folders = [{ id: 'fa', name: '練習中', updatedAt: 1 }]
  fake.state.songs[1].folderId = 'fa'
  opened.mockClear()
  deleted.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<Harness />))
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks() })

const $ = <T extends Element = HTMLElement>(sel: string) => container.querySelector<T>(sel)!
const $$ = <T extends Element = HTMLElement>(sel: string) => Array.from(container.querySelectorAll<T>(sel))
const titles = () => $$('.song-item .song-title').map(e => e.textContent)
const folderItems = () => $$('[data-testid="folder-item"]')
const folderButton = (label: string) =>
  folderItems().map(li => li.querySelector<HTMLButtonElement>('.folder-select-button')!).find(b => b.textContent?.includes(label))!
const setInput = (el: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const click = (el: Element) => act(() => { (el as HTMLElement).click() })

it('lists folders with counts and filters by folder', () => {
  expect(folderItems().map(li => li.querySelector('.folder-name')?.textContent)).toEqual(['すべての曲', '未分類', '練習中'])
  expect(folderItems().map(li => li.querySelector('.folder-count')?.textContent)).toEqual(['3', '2', '1'])
  expect(folderButton('すべての曲').getAttribute('aria-pressed')).toBe('true')
  click(folderButton('練習中'))
  expect(titles()).toEqual(['Beta'])
  expect(folderButton('練習中').getAttribute('aria-current')).toBe('true')
  click(folderButton('未分類'))
  expect(titles()).toEqual(['Alpha', 'Gamma'])
})

it('creates, renames (with inline error) and deletes folders', () => {
  click([...$$('button')].find(b => b.textContent === '+ フォルダを作成')!)
  const input = $<HTMLInputElement>('input[aria-label="新しいフォルダ名"]')
  setInput(input, '練習中')
  act(() => { input.form!.requestSubmit() })
  expect($('[role="alert"]').textContent).toBe('同じ名前のフォルダがあります')
  setInput(input, 'ライブ')
  act(() => { input.form!.requestSubmit() })
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect(folderButton('ライブ').getAttribute('aria-pressed')).toBe('true')
  expect(container.textContent).toContain('該当する曲がありません')

  click($('button[aria-label="フォルダ「練習中」の名前を変更"]'))
  const rename = $<HTMLInputElement>('input[aria-label="フォルダ「練習中」の新しい名前"]')
  setInput(rename, '本番')
  act(() => { rename.form!.requestSubmit() })
  expect(folderButton('本番')).toBeTruthy()

  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
  click($('button[aria-label="フォルダ「ライブ」を削除"]'))
  expect(confirmSpy).toHaveBeenCalledWith('フォルダ「ライブ」を削除しますか？中の曲は未分類に移動します')
  expect(folderButton('ライブ')).toBeUndefined()
  // 選択中のフォルダが消えたら「すべての曲」へ
  expect(folderButton('すべての曲').getAttribute('aria-pressed')).toBe('true')
  expect(titles()).toEqual(['Alpha', 'Beta', 'Gamma'])
})

it('falls back to all songs when the selected folder disappears via sync', () => {
  click(folderButton('練習中'))
  fake.state.folders[0].deleted = true
  act(() => { window.dispatchEvent(new Event('bass-practice:songs-changed')) })
  expect(folderButton('すべての曲').getAttribute('aria-pressed')).toBe('true')
})

it('searches and filters by tags (AND)', () => {
  expect($$('.tag-filter-chip').map(b => b.textContent)).toEqual(['#easy', '#jazz', '#rock'])
  click($$('.tag-filter-chip')[2])
  click($$('.tag-filter-chip')[0])
  expect(titles()).toEqual(['Alpha'])
  click($$('.tag-filter-chip')[1])
  expect(container.textContent).toContain('該当する曲がありません')
  click([...$$('button')].find(b => b.textContent === 'タグ絞り込みを解除')!)
  expect(titles()).toHaveLength(3)
  setInput($<HTMLInputElement>('input[placeholder="曲名・アーティスト・タグで検索"]'), 'jaz')
  expect(titles()).toEqual(['Beta'])
})

it('changes folder via select and edits tags without opening the song', () => {
  const row = $$('.song-item')[2]
  const select = row.querySelector<HTMLSelectElement>('select[aria-label="フォルダ"]')!
  act(() => { select.value = 'fa'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(fake.state.songs[2].folderId).toBe('fa')
  click(select)

  const gammaRow = () => $$('.song-item').find(r => r.textContent?.includes('Gamma'))!
  click(gammaRow().querySelector('.tag-edit-button')!)
  const input = gammaRow().querySelector<HTMLInputElement>('.tag-editor input')!
  expect(input.getAttribute('list')).toBeTruthy()
  setInput(input, 'funk, slap')
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  expect(fake.state.songs[2].tags).toEqual(['funk', 'slap'])
  expect([...gammaRow().querySelectorAll('.song-tags .tag-chip')].map(c => c.textContent)).toEqual(['#funk', '#slap'])
  click(gammaRow().querySelector('button[aria-label="タグ funk を削除"]')!)
  expect(fake.state.songs[2].tags).toEqual(['slap'])
  expect(opened).not.toHaveBeenCalled()

  click(gammaRow().querySelector('button[title="削除"]')!)
  expect(deleted).toHaveBeenCalledWith('s3')
  expect(opened).not.toHaveBeenCalled()
  click(gammaRow().querySelector('.song-title')!)
  expect(opened).toHaveBeenCalledTimes(1)
})

it('ignores Enter while IME composition is active in the tag editor', () => {
  const gammaRow = () => $$('.song-item').find(r => r.textContent?.includes('Gamma'))!
  click(gammaRow().querySelector('.tag-edit-button')!)
  const input = gammaRow().querySelector<HTMLInputElement>('.tag-editor input')!
  setInput(input, 'ベース')
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })) })
  expect(fake.state.songs[2].tags).toBeUndefined()
  expect(input.value).toBe('ベース')
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })) })
  expect(gammaRow().querySelector('.tag-editor input')).toBe(input)
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  expect(fake.state.songs[2].tags).toEqual(['ベース'])
})

it('drops a dragged song onto a folder', () => {
  const data = new Map<string, string>()
  const dt = {
    get types() { return Array.from(data.keys()) },
    setData: (k: string, v: string) => { data.set(k, v) },
    getData: (k: string) => data.get(k) ?? '',
    dropEffect: 'none', effectAllowed: 'all',
  }
  const fire = (el: Element, type: string) => act(() => {
    const ev = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    el.dispatchEvent(ev)
  })
  fire($$('.song-item')[0], 'dragstart')
  expect(data.get('text/x-song-id')).toBe('s1')
  const target = folderItems()[2]
  fire(target, 'dragover')
  expect(target.className).toContain('drop-target')
  fire(target, 'drop')
  expect(target.className).not.toContain('drop-target')
  expect(fake.state.songs[0].folderId).toBe('fa')
  expect(folderItems()[2].querySelector('.folder-count')?.textContent).toBe('2')
})
