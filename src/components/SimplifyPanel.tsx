import { useState } from 'react'
import { simplifyScore, toAlphaTex } from '../utils/simplify'
import type { SimplifyLevel } from '../utils/simplify'
import type { PlainScore } from '../utils/scoreModel'
import type { BarRange } from './SectionPanel'

export const SIMPLIFY_LEVEL_LABELS: Record<SimplifyLevel, string> = {
  0: '原曲',
  1: '装飾音カット',
  2: 'リズム簡略(4分)',
  3: 'ルート音のみ',
}

/** 狭いポジションに寄せるときのフレット幅 */
const NARROW_FRET_SPAN = 5

export type SimplifyScope = 'song' | 'section' | 'loop'

export interface SimplifyResult {
  level: SimplifyLevel
  narrow: boolean
  scope: SimplifyScope
  startBar: number | null
  endBar: number | null
  removedNotes: number
}

interface SimplifyPanelProps {
  /** 読み込んだ原曲（簡略化は常にここから行う） */
  originalScore: PlainScore | null
  activeSection: { name: string; startBar: number; endBar: number } | null
  loopRange: BarRange | null
  /** 現在表示中のアレンジ（原曲表示中はnull） */
  applied: SimplifyResult | null
  /** 適用を無効にする（「原曲に戻す」は読み込み失敗時にも使えるよう常に有効） */
  disabled?: boolean
  onApply: (tex: string, result: SimplifyResult) => void
  onRestore: () => void
}

export default function SimplifyPanel({ originalScore, activeSection, loopRange, applied, disabled = false, onApply, onRestore }: SimplifyPanelProps) {
  const [level, setLevel] = useState<SimplifyLevel>(applied?.level ?? 1)
  const [narrow, setNarrow] = useState(applied?.narrow ?? false)
  const [scope, setScope] = useState<SimplifyScope>(applied?.scope ?? 'song')
  const [error, setError] = useState<string | null>(null)

  const scopeRange = (): BarRange | null => {
    if (scope === 'section') return activeSection
    if (scope === 'loop') return loopRange
    return null
  }

  const handleApply = () => {
    if (!originalScore) return
    if (level === 0 && !narrow) {
      setError(null)
      onRestore()
      return
    }
    const range = scopeRange()
    if (scope !== 'song' && !range) {
      return setError(scope === 'section' ? 'セクションをループ再生してから選択してください' : 'A-B区間を設定してください')
    }
    try {
      const simplified = simplifyScore(originalScore, level, {
        startBar: range?.startBar,
        endBar: range?.endBar,
        ...(narrow ? { maxSpan: NARROW_FRET_SPAN } : {}),
      })
      const tex = toAlphaTex(simplified)
      setError(null)
      onApply(tex, {
        level,
        narrow,
        scope,
        startBar: range?.startBar ?? null,
        endBar: range?.endBar ?? null,
        removedNotes: Math.max(0, originalScore.notes.length - simplified.notes.length),
      })
    } catch (e) {
      console.error('Failed to simplify score:', e)
      setError('この譜面は簡単アレンジに変換できませんでした')
    }
  }

  const scopeLabel = (result: SimplifyResult) =>
    result.startBar !== null && result.endBar !== null ? `${result.startBar}〜${result.endBar}小節` : '曲全体'

  return (
    <div className="simplify-panel">
      <label className="field-label" htmlFor="simplify-level">レベル</label>
      <select
        id="simplify-level"
        className="status-select"
        value={level}
        onChange={e => setLevel(Number(e.target.value) as SimplifyLevel)}
        disabled={disabled}
      >
        {([0, 1, 2, 3] as SimplifyLevel[]).map(l => (
          <option key={l} value={l}>{l} {SIMPLIFY_LEVEL_LABELS[l]}</option>
        ))}
      </select>

      <label className="checkbox-row">
        <input type="checkbox" checked={narrow} onChange={e => setNarrow(e.target.checked)} disabled={disabled} />
        ポジションを狭く ({NARROW_FRET_SPAN}フレット内)
      </label>

      <label className="field-label" htmlFor="simplify-scope">範囲</label>
      <select
        id="simplify-scope"
        className="status-select"
        value={scope}
        onChange={e => setScope(e.target.value as SimplifyScope)}
        disabled={disabled}
      >
        <option value="song">曲全体</option>
        <option value="section" disabled={!activeSection}>
          セクション{activeSection ? ` (${activeSection.name}: ${activeSection.startBar}〜${activeSection.endBar}小節)` : ''}
        </option>
        <option value="loop" disabled={!loopRange}>
          A-B区間{loopRange ? ` (${loopRange.startBar}〜${loopRange.endBar}小節)` : ''}
        </option>
      </select>

      <button className="button button-primary button-small" onClick={handleApply} disabled={disabled || !originalScore}>
        適用
      </button>
      <button className="button button-secondary button-small" onClick={onRestore} disabled={!applied}>
        原曲に戻す
      </button>

      {error && <div className="field-error">{error}</div>}
      {applied ? (
        <div className="simplify-status">
          表示中: {SIMPLIFY_LEVEL_LABELS[applied.level]}{applied.narrow ? ' + ポジション狭め' : ''}（{scopeLabel(applied)}）<br />
          {applied.removedNotes > 0 ? `${applied.removedNotes}音を削除しました` : '削除した音はありません'}
        </div>
      ) : (
        <div className="info-text">
          難しいフレーズを簡単なアレンジに置き換えて表示・再生します。入力判定もアレンジ後の譜面で行います。
        </div>
      )}
    </div>
  )
}
