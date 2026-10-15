import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import InputCheckPanel from './InputCheckPanel'
import SimplifyPanel from './SimplifyPanel'
import type { PlainNote, PlainScore } from '../utils/scoreModel'
import Dashboard from './Dashboard'
import { addAccuracyRecord, upsertSection } from '../utils/progress'
import { saveSong } from '../utils/storage'

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
  else delete (navigator as { mediaDevices?: unknown }).mediaDevices
})

function setMediaDevices(value: unknown) {
  Object.defineProperty(navigator, 'mediaDevices', { value, configurable: true })
}

const note = (id: string, tick: number, extra: Partial<PlainNote> = {}): PlainNote => ({
  id, bar: Math.floor(tick / 3840) + 1, startTick: tick, durationTicks: 480, startSec: tick / 1920, durationSec: 0.25,
  string: 4, fret: 0, midi: 28, ghost: false, dead: false, slide: false, tie: false, ...extra,
})
const score: PlainScore = {
  title: 'Bass', tempo: 120, tuning: [43, 38, 33, 28],
  bars: [1, 2].map(index => ({ index, startTick: (index - 1) * 3840, durationTicks: 3840, numerator: 4, denominator: 4 })),
  notes: [note('a', 0), note('ghost', 480, { ghost: true }), note('b', 960), note('c', 3840)],
}

const inputProps = {
  songId: 'song1', score, isPlaying: false, tempoPercent: 100, simplifyLevel: 0 as const, range: null, sections: [],
  getTabSec: () => 0, subscribePosition: () => () => {}, subscribeLoopPass: () => () => {},
}

it('input check panel lists audio input devices and shows best accuracy per section', async () => {
  const section = upsertSection({ songId: 'song1', name: 'サビ', startBar: 1, endBar: 2, status: 'practicing' })
  addAccuracyRecord({ songId: 'song1', sectionId: section.id, startBar: 1, endBar: 2, level: 0, accuracy: 87.5, hits: 7, misses: 1, early: 0, late: 0, total: 8, tempoPercent: 80, date: new Date().toISOString() })
  setMediaDevices({
    getUserMedia: vi.fn(),
    enumerateDevices: vi.fn().mockResolvedValue([
      { deviceId: 'mic1', kind: 'audioinput', label: 'オーディオIF', groupId: '' },
      { deviceId: 'spk1', kind: 'audiooutput', label: 'スピーカー', groupId: '' },
    ]),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  await act(async () => root.render(<InputCheckPanel {...inputProps} sections={[section]} />))
  const options = [...container.querySelectorAll<HTMLOptionElement>('#input-device option')].map(o => o.textContent)
  expect(options).toEqual(['既定のデバイス', 'オーディオIF'])
  expect(container.textContent).toContain('マイク開始')
  expect(container.textContent).toContain('サビ')
  expect(container.textContent).toContain('ベスト 88%')
})

it('input check panel explains when microphone input is unavailable or denied', async () => {
  setMediaDevices(undefined)
  await act(async () => root.render(<InputCheckPanel {...inputProps} />))
  expect(container.querySelector('.field-error')?.textContent).toContain('マイク入力を利用できません')
  expect(container.textContent).not.toContain('マイク開始')
  act(() => root.unmount())

  root = createRoot(container)
  setMediaDevices({
    getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' })),
    enumerateDevices: vi.fn().mockResolvedValue([]),
  })
  await act(async () => root.render(<InputCheckPanel {...inputProps} />))
  await act(async () => container.querySelector<HTMLButtonElement>('.input-check-panel .button')!.click())
  expect(container.querySelector('.field-error')?.textContent).toContain('許可されていません')
})

it('simplify panel simplifies from the original score and reports removed notes', () => {
  const onApply = vi.fn()
  const onRestore = vi.fn()
  act(() => root.render(
    <SimplifyPanel originalScore={score} activeSection={null} loopRange={{ startBar: 1, endBar: 1 }} applied={null} onApply={onApply} onRestore={onRestore} />))
  const scope = container.querySelector<HTMLSelectElement>('#simplify-scope')!
  expect(scope.querySelector<HTMLOptionElement>('option[value="section"]')!.disabled).toBe(true)
  act(() => { scope.value = 'loop'; scope.dispatchEvent(new Event('change', { bubbles: true })) })
  act(() => [...container.querySelectorAll('button')].find(b => b.textContent === '適用')!.click())
  expect(onApply).toHaveBeenCalledTimes(1)
  const [tex, result] = onApply.mock.calls[0]
  expect(tex).toContain('\\tempo 120')
  expect(result).toMatchObject({ level: 1, scope: 'loop', startBar: 1, endBar: 1, removedNotes: 1 })

  act(() => root.render(
    <SimplifyPanel originalScore={score} activeSection={null} loopRange={null} applied={result} onApply={onApply} onRestore={onRestore} />))
  expect(container.textContent).toContain('1音を削除しました')
  act(() => [...container.querySelectorAll('button')].find(b => b.textContent === '原曲に戻す')!.click())
  expect(onRestore).toHaveBeenCalled()
})

it('dashboard shows best accuracy per section and recent attempts', () => {
  const song = saveSong({ title: '判定曲', texData: 'tab' })
  const section = upsertSection({ songId: song.id, name: 'Aメロ', startBar: 1, endBar: 4, status: 'practicing' })
  addAccuracyRecord({ songId: song.id, sectionId: section.id, startBar: 1, endBar: 4, level: 0, accuracy: 92, hits: 23, misses: 2, early: 0, late: 0, total: 25, tempoPercent: 100, date: '2026-10-01T10:00:00.000Z' })
  addAccuracyRecord({ songId: song.id, sectionId: section.id, startBar: 1, endBar: 4, level: 2, accuracy: 70, hits: 7, misses: 3, early: 0, late: 0, total: 10, tempoPercent: 80, date: '2026-10-02T10:00:00.000Z' })
  addAccuracyRecord({ songId: song.id, startBar: 5, endBar: 6, level: 0, accuracy: 55, hits: 5, misses: 4, early: 0, late: 0, total: 9, tempoPercent: 100, date: '2026-10-03T10:00:00.000Z' })
  act(() => root.render(<Dashboard onOpenSong={() => {}} />))
  const chips = [...container.querySelectorAll('.accuracy-chip')].map(c => c.textContent)
  expect(chips).toEqual(['Aメロ 92%', '5〜6小節 55%', 'Aメロ 70%簡2', 'Aメロ 92%'])
})
