import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import {
  ALL_FOLDERS, UNFILED, ConvertedSong, createFolder, deleteFolder, filterSongs, getAllTags, getFolders,
  renameFolder, setSongFolder, setSongTags, songFolderId,
} from '../../utils/storage'
import type { FolderEntry } from '../../shared/syncMerge'
import { SONGS_CHANGED_EVENT } from '../../utils/cloudSync'

export const SONG_DRAG_TYPE = 'text/x-song-id'
const TAG_DATALIST_ID = 'song-library-tag-options'

interface SongLibraryProps {
  songs: ConvertedSong[]
  onOpenSong: (song: ConvertedSong) => void
  onDeleteSong: (id: string, e: React.MouseEvent) => void
  /** 曲のフォルダ・タグを変更した後に呼ばれる（曲一覧の読み直し用） */
  onSongsUpdated: () => void
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : '不明なエラー')
const splitTagInput = (text: string) => text.split(/[,、，]/).map(t => t.trim()).filter(Boolean)
const stop = (e: React.SyntheticEvent) => e.stopPropagation()
const hasSongDrag = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes(SONG_DRAG_TYPE)

export default function SongLibrary({ songs, onOpenSong, onDeleteSong, onSongsUpdated }: SongLibraryProps) {
  const [folders, setFolders] = useState<FolderEntry[]>(() => getFolders())
  const [selectedFolder, setSelectedFolder] = useState<string>(ALL_FOLDERS)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [editFolderName, setEditFolderName] = useState('')
  const [folderError, setFolderError] = useState<string | null>(null)
  const [songError, setSongError] = useState<string | null>(null)
  const [tagEditorFor, setTagEditorFor] = useState<string | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const reloadFolders = () => setFolders(getFolders())

  useEffect(() => {
    // クラウド同期で曲・フォルダが変わったらフォルダも読み直す（曲は親が読み直す）
    window.addEventListener(SONGS_CHANGED_EVENT, reloadFolders)
    return () => window.removeEventListener(SONGS_CHANGED_EVENT, reloadFolders)
  }, [])

  // 選択中のフォルダが削除されたら「すべての曲」に戻す
  useEffect(() => {
    if (selectedFolder === ALL_FOLDERS || selectedFolder === UNFILED) return
    if (!folders.some(f => f.id === selectedFolder)) setSelectedFolder(ALL_FOLDERS)
  }, [folders, selectedFolder])

  const allTags = useMemo(() => getAllTags(songs), [songs])

  // 存在しなくなったタグは絞り込みから外す
  useEffect(() => {
    setSelectedTags(prev => {
      const next = prev.filter(t => allTags.includes(t))
      return next.length === prev.length ? prev : next
    })
  }, [allTags])

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const song of songs) {
      const id = songFolderId(song, folders)
      map.set(id, (map.get(id) ?? 0) + 1)
    }
    return map
  }, [songs, folders])

  const visibleSongs = useMemo(
    () => filterSongs(songs, { folderId: selectedFolder, tags: selectedTags, query }, folders),
    [songs, selectedFolder, selectedTags, query, folders],
  )

  // ---- フォルダ操作 ----
  const submitNewFolder = (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const folder = createFolder(newFolderName)
      setFolderError(null)
      setNewFolderName('')
      setCreating(false)
      reloadFolders()
      setSelectedFolder(folder.id)
    } catch (err) {
      setFolderError(errorText(err))
    }
  }

  const startRename = (folder: FolderEntry) => {
    setEditingFolderId(folder.id)
    setEditFolderName(folder.name)
    setFolderError(null)
  }

  const submitRename = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingFolderId) return
    try {
      renameFolder(editingFolderId, editFolderName)
      setFolderError(null)
      setEditingFolderId(null)
      reloadFolders()
    } catch (err) {
      setFolderError(errorText(err))
    }
  }

  const handleDeleteFolder = (folder: FolderEntry) => {
    if (!confirm(`フォルダ「${folder.name}」を削除しますか？中の曲は未分類に移動します`)) return
    deleteFolder(folder.id)
    if (editingFolderId === folder.id) setEditingFolderId(null)
    reloadFolders()
    onSongsUpdated()
  }

  // ---- 曲のフォルダ・タグ ----
  const moveSong = (songId: string, folderId: string) => {
    try {
      setSongFolder(songId, folderId === UNFILED ? null : folderId)
      setSongError(null)
      onSongsUpdated()
    } catch (err) {
      setSongError(errorText(err))
    }
  }

  const updateTags = (songId: string, tags: string[]) => {
    try {
      setSongTags(songId, tags)
      setSongError(null)
      onSongsUpdated()
    } catch (err) {
      setSongError(errorText(err))
    }
  }

  const addTags = (song: ConvertedSong) => {
    const added = splitTagInput(tagInput)
    if (added.length === 0) return
    updateTags(song.id, [...(song.tags ?? []), ...added])
    setTagInput('')
  }

  const toggleTagEditor = (songId: string) => {
    setTagEditorFor(prev => (prev === songId ? null : songId))
    setTagInput('')
  }

  const toggleFilterTag = (tag: string) => {
    setSelectedTags(prev => (prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]))
  }

  // ---- ドラッグ&ドロップ ----
  const folderDropProps = (folderId: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!hasSongDrag(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (dropTarget !== folderId) setDropTarget(folderId)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setDropTarget(prev => (prev === folderId ? null : prev))
    },
    onDrop: (e: React.DragEvent) => {
      const songId = e.dataTransfer.getData(SONG_DRAG_TYPE)
      setDropTarget(null)
      if (!songId) return
      e.preventDefault()
      moveSong(songId, folderId)
    },
  })

  const renderFolderButton = (id: string, label: string, icon: string) => {
    const selected = selectedFolder === id
    const count = id === ALL_FOLDERS ? songs.length : counts.get(id) ?? 0
    return (
      <button
        type="button"
        className="folder-select-button"
        onClick={() => setSelectedFolder(id)}
        aria-pressed={selected}
        aria-current={selected ? 'true' : undefined}
        title={`${label}（${count}曲）を表示`}
      >
        <span className="folder-icon" aria-hidden="true">{icon}</span>
        <span className="folder-name">{label}</span>
        <span className="folder-count" aria-label={`${count}曲`}>{count}</span>
      </button>
    )
  }

  const folderItemClass = (id: string) =>
    ['folder-item', selectedFolder === id ? 'selected' : '', dropTarget === id ? 'drop-target' : ''].filter(Boolean).join(' ')

  return (
    <div className="song-library">
      <nav className="folder-sidebar" aria-label="フォルダ">
        <h3 className="folder-sidebar-title">フォルダ</h3>
        <ul className="folder-list">
          <li data-testid="folder-item" className={folderItemClass(ALL_FOLDERS)}>
            {renderFolderButton(ALL_FOLDERS, 'すべての曲', '🎵')}
          </li>
          <li data-testid="folder-item" className={folderItemClass(UNFILED)} {...folderDropProps(UNFILED)}>
            {renderFolderButton(UNFILED, '未分類', '📥')}
          </li>
          {folders.map(folder => (
            <li
              key={folder.id}
              data-testid="folder-item"
              className={folderItemClass(folder.id)}
              {...folderDropProps(folder.id)}
            >
              {editingFolderId === folder.id ? (
                <form className="folder-inline-form" onSubmit={submitRename}>
                  <input
                    type="text"
                    value={editFolderName}
                    onChange={e => setEditFolderName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Escape') { setEditingFolderId(null); setFolderError(null) } }}
                    aria-label={`フォルダ「${folder.name}」の新しい名前`}
                    autoFocus
                  />
                  <button type="submit" className="button button-primary button-small">保存</button>
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    onClick={() => { setEditingFolderId(null); setFolderError(null) }}
                  >
                    キャンセル
                  </button>
                </form>
              ) : (
                <>
                  {renderFolderButton(folder.id, folder.name, '📁')}
                  <span className="folder-item-actions">
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => startRename(folder)}
                      aria-label={`フォルダ「${folder.name}」の名前を変更`}
                      title="名前を変更"
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      className="icon-button delete"
                      onClick={() => handleDeleteFolder(folder)}
                      aria-label={`フォルダ「${folder.name}」を削除`}
                      title="フォルダを削除"
                    >
                      🗑️
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
        {creating ? (
          <form className="folder-inline-form folder-create-form" onSubmit={submitNewFolder}>
            <input
              type="text"
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setCreating(false); setFolderError(null) } }}
              placeholder="フォルダ名"
              aria-label="新しいフォルダ名"
              autoFocus
            />
            <button type="submit" className="button button-primary button-small">作成</button>
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => { setCreating(false); setNewFolderName(''); setFolderError(null) }}
            >
              キャンセル
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="folder-create-button"
            onClick={() => { setCreating(true); setFolderError(null) }}
          >
            + フォルダを作成
          </button>
        )}
        {folderError && <div className="error-message folder-error" role="alert">{folderError}</div>}
      </nav>

      <section className="song-library-main" aria-label="曲一覧">
        <div className="song-filters">
          <input
            type="search"
            className="song-search-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="曲名・アーティスト・タグで検索"
            aria-label="曲名・アーティスト・タグで検索"
          />
          {allTags.length > 0 && (
            <div className="tag-filter" role="group" aria-label="タグで絞り込み">
              {allTags.map(tag => {
                const active = selectedTags.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    className={`tag-filter-chip${active ? ' active' : ''}`}
                    aria-pressed={active}
                    onClick={() => toggleFilterTag(tag)}
                    title={active ? `タグ「${tag}」の絞り込みを外す` : `タグ「${tag}」で絞り込む`}
                  >
                    #{tag}
                  </button>
                )
              })}
              {selectedTags.length > 0 && (
                <button type="button" className="tag-filter-clear" onClick={() => setSelectedTags([])}>
                  タグ絞り込みを解除
                </button>
              )}
            </div>
          )}
        </div>

        {songError && <div className="error-message" role="alert">{songError}</div>}

        <datalist id={TAG_DATALIST_ID}>
          {allTags.map(tag => <option key={tag} value={tag} />)}
        </datalist>

        {songs.length === 0 ? (
          <div className="info-box">
            まだ曲が保存されていません。下のボタンからPDFをインポートしてください。
          </div>
        ) : visibleSongs.length === 0 ? (
          <div className="info-box song-empty-filter">該当する曲がありません</div>
        ) : (
          <div className="saved-songs-list">
            {visibleSongs.map(song => {
              const tags = song.tags ?? []
              const editorOpen = tagEditorFor === song.id
              return (
                <div
                  key={song.id}
                  className="song-item"
                  draggable={!editorOpen}
                  onDragStart={e => {
                    e.dataTransfer.setData(SONG_DRAG_TYPE, song.id)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragEnd={() => setDropTarget(null)}
                  onClick={() => onOpenSong(song)}
                  onKeyDown={e => {
                    if (e.target === e.currentTarget && e.key === 'Enter') onOpenSong(song)
                  }}
                  tabIndex={0}
                  aria-label={`${song.title}を開く`}
                >
                  <div className="song-info">
                    <div className="song-title">{song.title}</div>
                    <div className="song-meta">
                      {song.artist && `${song.artist} • `}
                      {new Date(song.updatedAt).toLocaleDateString('ja-JP')}
                    </div>
                    {tags.length > 0 && (
                      <div className="song-tags">
                        {tags.map(tag => <span key={tag} className="tag-chip">#{tag}</span>)}
                      </div>
                    )}
                  </div>
                  <div className="song-actions" onClick={stop} onKeyDown={stop}>
                    <select
                      className="song-folder-select"
                      aria-label="フォルダ"
                      title="フォルダ"
                      value={songFolderId(song, folders)}
                      onChange={e => moveSong(song.id, e.target.value)}
                    >
                      <option value={UNFILED}>未分類</option>
                      {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                    <button
                      type="button"
                      className={`icon-button tag-edit-button${editorOpen ? ' active' : ''}`}
                      onClick={() => toggleTagEditor(song.id)}
                      aria-expanded={editorOpen}
                      aria-label={`${song.title}のタグを編集`}
                      title="タグを編集"
                    >
                      🏷️ タグ
                    </button>
                    <button
                      type="button"
                      className="icon-button delete"
                      onClick={(e) => onDeleteSong(song.id, e)}
                      aria-label={`${song.title}を削除`}
                      title="削除"
                    >
                      🗑️
                    </button>
                  </div>
                  {editorOpen && (
                    <div
                      className="tag-editor"
                      onClick={stop}
                      onKeyDown={stop}
                    >
                      <div className="tag-editor-chips">
                        {tags.length === 0 && <span className="tag-editor-empty">タグはまだありません</span>}
                        {tags.map(tag => (
                          <span key={tag} className="tag-chip editable">
                            #{tag}
                            <button
                              type="button"
                              className="tag-chip-remove"
                              aria-label={`タグ ${tag} を削除`}
                              title={`タグ ${tag} を削除`}
                              onClick={() => updateTags(song.id, tags.filter(t => t !== tag))}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="tag-editor-input-row">
                        <input
                          type="text"
                          list={TAG_DATALIST_ID}
                          value={tagInput}
                          onChange={e => setTagInput(e.target.value)}
                          onKeyDown={e => {
                            e.stopPropagation()
                            if (e.key === 'Enter') { e.preventDefault(); addTags(song) }
                            if (e.key === 'Escape') setTagEditorFor(null)
                          }}
                          placeholder="タグを入力（カンマ区切り可）"
                          aria-label={`${song.title}に追加するタグ`}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="button button-primary button-small"
                          onClick={() => addTags(song)}
                          disabled={splitTagInput(tagInput).length === 0}
                        >
                          追加
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
