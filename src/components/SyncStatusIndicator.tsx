import { useEffect, useState } from 'react'
import { getSyncStatus, subscribeSyncStatus, syncNow } from '../utils/cloudSync'
import type { SyncState, SyncStatus } from '../utils/cloudSync'

const LABELS: Record<SyncState, string> = {
  idle: '同期中…',
  syncing: '同期中…',
  synced: '同期済み',
  offline: 'オフライン',
  error: 'エラー',
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** ヘッダーに表示するクラウド同期状態。クリックで今すぐ同期する */
export default function SyncStatusIndicator() {
  // getSyncStatus が毎回新しいオブジェクトを返しても無限再描画にならないよう useState で保持する
  const [status, setStatus] = useState<SyncStatus>(() => getSyncStatus())
  useEffect(() => {
    setStatus(getSyncStatus())
    return subscribeSyncStatus(setStatus)
  }, [])
  const label = LABELS[status.state] ?? status.state
  const pendingText = status.pending > 0 ? `（未送信 ${status.pending}件）` : ''
  const showMessage = (status.state === 'offline' || status.state === 'error') && !!status.message
  const tooltip = [
    `クラウド同期: ${label}${pendingText}`,
    status.message,
    status.lastSyncedAt ? `最終同期: ${formatTime(status.lastSyncedAt)}` : null,
    'クリックで今すぐ同期',
  ].filter(Boolean).join('\n')
  const ariaLabel = `クラウド同期: ${label}${pendingText}${status.message ? `、${status.message}` : ''}。クリックで今すぐ同期`

  const handleClick = () => {
    try {
      syncNow().catch(() => {})
    } catch {
      // 同期の失敗は状態表示に反映されるのでここでは無視する
    }
  }

  return (
    <div className="sync-status" role="status" aria-live="polite">
      <button
        type="button"
        className={`sync-status-pill sync-${status.state}`}
        onClick={handleClick}
        title={tooltip}
        aria-label={ariaLabel}
      >
        <span className="sync-status-dot" aria-hidden="true" />
        <span className="sync-status-label">{label}{pendingText}</span>
        {showMessage && <span className="sync-status-message">{status.message}</span>}
      </button>
    </div>
  )
}
