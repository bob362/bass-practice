import { useEffect, useState } from 'react'
import { deleteSection, upsertSection } from '../utils/progress'
import type { PracticeSection, SectionStatus } from '../utils/progress'

export const STATUS_LABELS: Record<SectionStatus, string> = {
  not_started: '未着手',
  practicing: '練習中',
  mastered: '弾けた',
}

export interface BarRange { startBar: number; endBar: number }

interface SectionPanelProps {
  songId: string | null
  sections: PracticeSection[]
  /** 現在のA-Bループの小節範囲（未設定ならnull） */
  loopRange: BarRange | null
  barCount: number
  /** ループ中のセクションID */
  activeSectionId: string | null
  onChanged: () => void
  onLoopSection: (section: PracticeSection) => void
}

export default function SectionPanel({ songId, sections, loopRange, barCount, activeSectionId, onChanged, onLoopSection }: SectionPanelProps) {
  const [name, setName] = useState('')
  const [startBar, setStartBar] = useState('1')
  const [endBar, setEndBar] = useState('1')
  const [error, setError] = useState<string | null>(null)

  // A-Bループが設定されたら小節範囲に反映
  useEffect(() => {
    if (!loopRange) return
    setStartBar(String(loopRange.startBar))
    setEndBar(String(loopRange.endBar))
  }, [loopRange?.startBar, loopRange?.endBar])

  if (!songId) {
    return (
      <div className="info-text">
        「曲の管理」から保存済みの曲を開くと、セクションごとの進捗を記録できます。
      </div>
    )
  }

  const handleSave = () => {
    const start = Number(startBar)
    const end = Number(endBar)
    if (!name.trim()) return setError('セクション名を入力してください')
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      return setError('小節の範囲が正しくありません')
    }
    if (barCount > 0 && end > barCount) return setError(`この曲は${barCount}小節までです`)
    try {
      upsertSection({ songId, name: name.trim(), startBar: start, endBar: end, status: 'not_started' })
      setName('')
      setError(null)
      onChanged()
    } catch {
      setError('セクションを保存できませんでした')
    }
  }

  const handleStatus = (section: PracticeSection, status: SectionStatus) => {
    upsertSection({ ...section, status })
    onChanged()
  }

  const handleDelete = (section: PracticeSection) => {
    if (!confirm(`セクション「${section.name}」を削除しますか？`)) return
    deleteSection(songId, section.id)
    onChanged()
  }

  const mastered = sections.filter(s => s.status === 'mastered').length
  const percent = sections.length ? Math.round(mastered / sections.length * 100) : 0
  const sorted = [...sections].sort((a, b) => a.startBar - b.startBar || a.endBar - b.endBar)

  return (
    <div className="section-panel">
      {sections.length > 0 && (
        <div className="section-summary">
          <div className="slider-label">
            <span>弾けた {mastered}/{sections.length}</span>
            <span>{percent}%</span>
          </div>
          <div className="progress-track"><div className="progress-value" style={{ width: `${percent}%` }} /></div>
        </div>
      )}

      <div className="section-form">
        <input
          type="text"
          className="text-input"
          placeholder="セクション名（例: Aメロ）"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
        />
        <div className="section-bars-row">
          <input type="number" min="1" className="text-input" value={startBar} onChange={e => setStartBar(e.target.value)} aria-label="開始小節" />
          <span>〜</span>
          <input type="number" min="1" className="text-input" value={endBar} onChange={e => setEndBar(e.target.value)} aria-label="終了小節" />
          <span>小節</span>
        </div>
        <button className="button button-secondary button-small" onClick={handleSave}>
          {loopRange ? '＋ A-B区間をセクションとして保存' : '＋ セクションを保存'}
        </button>
        {error && <div className="field-error">{error}</div>}
      </div>

      {sorted.length > 0 && (
        <ul className="section-list">
          {sorted.map(section => (
            <li key={section.id} className={`section-item ${section.id === activeSectionId ? 'active' : ''}`}>
              <div className="section-item-header">
                <span className="section-name">{section.name}</span>
                <span className="section-bars">{section.startBar}〜{section.endBar}小節</span>
              </div>
              <div className="section-item-row">
                <select
                  className={`status-select status-${section.status}`}
                  value={section.status}
                  onChange={e => handleStatus(section, e.target.value as SectionStatus)}
                  aria-label="状態"
                >
                  {(Object.keys(STATUS_LABELS) as SectionStatus[]).map(status => (
                    <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                  ))}
                </select>
                <span className="section-tempo" title="ループ練習した最高テンポ">
                  最高 {section.maxTempoPercent > 0 ? `${Math.round(section.maxTempoPercent)}%` : '—'}
                </span>
              </div>
              <div className="section-item-row">
                <button className="button button-secondary button-small" onClick={() => onLoopSection(section)}>
                  🔁 ループ
                </button>
                <button className="icon-button-small" onClick={() => handleDelete(section)} title="削除">
                  🗑️
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="info-text">
        セクションをループ再生すると、1周ごとにそのテンポが最高テンポとして記録されます。
      </div>
    </div>
  )
}
