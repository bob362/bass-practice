import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SyncStatus } from '../utils/cloudSync'

const fake = vi.hoisted(() => {
  let status: SyncStatus = { state: 'idle', pending: 0 }
  const listeners = new Set<(s: SyncStatus) => void>()
  return {
    get: () => status,
    set(next: SyncStatus) { status = next; listeners.forEach(l => l(next)) },
    subscribe(cb: (s: SyncStatus) => void) { listeners.add(cb); return () => { listeners.delete(cb) } },
    listeners,
    syncNow: vi.fn(() => Promise.resolve()),
  }
})

vi.mock('../utils/cloudSync', () => ({
  SONGS_CHANGED_EVENT: 'bass-practice:songs-changed',
  getSyncStatus: () => fake.get(),
  subscribeSyncStatus: (cb: (s: SyncStatus) => void) => fake.subscribe(cb),
  syncNow: fake.syncNow,
  startCloudSync: () => Promise.resolve(),
}))

import SyncStatusIndicator from './SyncStatusIndicator'

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  fake.set({ state: 'idle', pending: 0 })
  fake.syncNow.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

const pill = () => container.querySelector<HTMLButtonElement>('.sync-status-pill')!

it('renders a label for each state and follows updates', () => {
  act(() => root.render(<SyncStatusIndicator />))
  expect(container.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite')
  expect(pill().textContent).toContain('同期中…')
  const cases: [SyncStatus['state'], string][] = [
    ['syncing', '同期中…'], ['synced', '同期済み'], ['offline', 'オフライン'], ['error', 'エラー'], ['idle', '同期中…'],
  ]
  for (const [state, label] of cases) {
    act(() => fake.set({ state, pending: 0 }))
    expect(pill().textContent).toContain(label)
    expect(pill().className).toContain(`sync-${state}`)
    expect(pill().getAttribute('aria-label')).toContain(label)
  }
})

it('shows message and pending count for offline/error, last sync time in tooltip', () => {
  const at = new Date(2026, 9, 20, 9, 5).getTime()
  fake.set({ state: 'error', message: 'サーバーに接続できません', pending: 3, lastSyncedAt: at })
  act(() => root.render(<SyncStatusIndicator />))
  expect(pill().textContent).toContain('エラー（未送信 3件）')
  expect(container.querySelector('.sync-status-message')?.textContent).toBe('サーバーに接続できません')
  expect(pill().title).toContain('サーバーに接続できません')
  expect(pill().title).toContain('最終同期: 09:05')
  expect(pill().getAttribute('aria-label')).toContain('サーバーに接続できません')

  act(() => fake.set({ state: 'synced', message: '詳細', pending: 0, lastSyncedAt: at }))
  expect(container.querySelector('.sync-status-message')).toBeNull()
  expect(pill().textContent).not.toContain('未送信')
})

it('clicking the pill calls syncNow and swallows failures', async () => {
  act(() => root.render(<SyncStatusIndicator />))
  act(() => pill().click())
  expect(fake.syncNow).toHaveBeenCalledTimes(1)
  fake.syncNow.mockImplementationOnce(() => Promise.reject(new Error('boom')))
  await act(async () => { pill().click() })
  expect(fake.syncNow).toHaveBeenCalledTimes(2)
})

it('unsubscribes on unmount', () => {
  act(() => root.render(<SyncStatusIndicator />))
  expect(fake.listeners.size).toBe(1)
  act(() => root.render(<></>))
  expect(fake.listeners.size).toBe(0)
})
