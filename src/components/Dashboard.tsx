import { useCallback, useEffect, useRef, useState } from 'react'
import { getAllSongs } from '../utils/storage'
import type { ConvertedSong } from '../utils/storage'
import { bestAccuracy, exportAllJSON, importAllJSON, listAccuracyRecords, listSections, listSessions, songProgress, streakDays, totalPracticeSec } from '../utils/progress'
import type { AccuracyRecord } from '../utils/progress'
import { SIMPLIFY_LEVEL_LABELS } from './SimplifyPanel'
import { SONGS_CHANGED_EVENT } from '../utils/cloudSync'

interface DashboardProps {
  onOpenSong: (song: ConvertedSong) => void
}

interface SongRow {
  song: ConvertedSong
  percent: number
  mastered: number
  total: number
  practiceSec: number
  lastPracticed: string | null
  recentAccuracy: AccuracyRecord[]
  sectionBest: { id: string; name: string; best: number }[]
  sectionNames: Record<string, string>
}

const RECENT_ACCURACY_COUNT = 3

export function formatDuration(sec: number): string {
  const minutes = Math.floor(sec / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}時間${minutes % 60}分`
  if (minutes > 0) return `${minutes}分`
  return sec > 0 ? '1分未満' : '0分'
}

function formatLastPracticed(iso: string | null): string {
  if (!iso) return '未練習'
  const date = new Date(iso)
  const today = new Date()
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(today) - startOf(date)) / 86400000)
  if (days === 0) return '今日'
  if (days === 1) return '昨日'
  if (days > 1 && days < 7) return `${days}日前`
  return date.toLocaleDateString('ja-JP')
}

function loadRows(): SongRow[] {
  return getAllSongs().map(song => {
    const progress = songProgress(song.id)
    const records = listAccuracyRecords(song.id)
    const sections = listSections(song.id).sort((a, b) => a.startBar - b.startBar || a.endBar - b.endBar)
    const recorded = new Set(records.map(r => r.sectionId))
    return {
      recentAccuracy: records.slice(0, RECENT_ACCURACY_COUNT),
      sectionBest: sections.filter(s => recorded.has(s.id)).map(s => ({ id: s.id, name: s.name, best: bestAccuracy(song.id, s.id) })),
      sectionNames: Object.fromEntries(sections.map(s => [s.id, s.name])),
      song,
      ...progress,
      practiceSec: totalPracticeSec(song.id),
      lastPracticed: listSessions(song.id)[0]?.start ?? null,
    }
  }).sort((a, b) => (b.lastPracticed ?? '').localeCompare(a.lastPracticed ?? '') || b.song.updatedAt - a.song.updatedAt)
}

export default function Dashboard({ onOpenSong }: DashboardProps) {
  const [rows, setRows] = useState<SongRow[]>([])
  const [streak, setStreak] = useState(0)
  const [totalSec, setTotalSec] = useState(0)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => {
    setRows(loadRows())
    setStreak(streakDays())
    setTotalSec(totalPracticeSec())
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // クラウドから曲・進捗が反映されたら読み直す
  useEffect(() => {
    window.addEventListener(SONGS_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(SONGS_CHANGED_EVENT, refresh)
  }, [refresh])

  const handleExport = () => {
    try {
      const blob = new Blob([exportAllJSON()], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const d = new Date()
      a.href = url
      a.download = `bass-practice-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 0)
      setMessage({ type: 'success', text: 'バックアップをエクスポートしました' })
    } catch {
      setMessage({ type: 'error', text: 'エクスポートに失敗しました' })
    }
  }

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!confirm('バックアップを読み込み、現在のデータと統合します。よろしいですか？')) return
    try {
      importAllJSON(await file.text(), 'merge')
      refresh()
      setMessage({ type: 'success', text: 'バックアップをインポートしました' })
    } catch {
      setMessage({ type: 'error', text: 'インポートに失敗しました。ファイルの形式を確認してください' })
    }
  }

  return (
    <div className="dashboard">
      <h2>ダッシュボード</h2>

      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-label">連続練習日数</div>
          <div className="stat-value">{streak}<span className="stat-unit">日</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">合計練習時間</div>
          <div className="stat-value">{formatDuration(totalSec)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">曲数</div>
          <div className="stat-value">{rows.length}<span className="stat-unit">曲</span></div>
        </div>
      </div>

      <h3 className="dashboard-heading">曲ごとの進捗</h3>
      {rows.length === 0 ? (
        <div className="info-text">
          まだ曲がありません。「曲の管理」からPDFをインポートしてください。
        </div>
      ) : (
        <div className="dashboard-songs">
          {rows.map(row => (
            <div key={row.song.id} className="dashboard-song" onClick={() => onOpenSong(row.song)}>
              <div className="dashboard-song-main">
                <div className="dashboard-song-title">{row.song.title}</div>
                <div className="dashboard-song-meta">
                  {row.song.artist && `${row.song.artist} • `}
                  練習時間 {formatDuration(row.practiceSec)} • 最終練習 {formatLastPracticed(row.lastPracticed)}
                </div>
                {row.recentAccuracy.length > 0 && (
                  <div className="dashboard-accuracy">
                    {row.sectionBest.length > 0 && (
                      <div className="dashboard-accuracy-row">
                        <span className="dashboard-accuracy-label">ベスト正確さ</span>
                        {row.sectionBest.map(s => (
                          <span key={s.id} className="accuracy-chip">{s.name} {Math.round(s.best)}%</span>
                        ))}
                      </div>
                    )}
                    <div className="dashboard-accuracy-row">
                      <span className="dashboard-accuracy-label">最近の判定</span>
                      {row.recentAccuracy.map(r => (
                        <span key={r.id} className="accuracy-chip" title={`${SIMPLIFY_LEVEL_LABELS[r.level]} • テンポ${r.tempoPercent}% • ${new Date(r.date).toLocaleString('ja-JP')}`}>
                          {(r.sectionId && row.sectionNames[r.sectionId]) || `${r.startBar}〜${r.endBar}小節`} {Math.round(r.accuracy)}%
                          {r.level > 0 && <span className="accuracy-chip-level">簡{r.level}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="dashboard-song-progress">
                <div className="slider-label">
                  <span>{row.total > 0 ? `弾けた ${row.mastered}/${row.total}` : 'セクション未登録'}</span>
                  <span>{Math.round(row.percent)}%</span>
                </div>
                <div className="progress-track"><div className="progress-value" style={{ width: `${row.percent}%` }} /></div>
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 className="dashboard-heading">バックアップ</h3>
      <div className="dashboard-actions">
        <button className="button button-secondary" onClick={handleExport}>
          ⬇ JSONエクスポート
        </button>
        <button className="button button-secondary" onClick={() => fileInputRef.current?.click()}>
          ⬆ JSONインポート
        </button>
        <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={handleImport} hidden />
      </div>
      {message && <div className={message.type === 'success' ? 'dashboard-success' : 'field-error'}>{message.text}</div>}
      <div className="info-text">
        曲・動画の設定・練習記録をすべてJSONファイルに保存します。インポート時は現在のデータと統合されます。
      </div>
    </div>
  )
}
