import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePracticeTimer } from './usePracticeTimer'
import { listSessions } from '../utils/progress'

let clock = 0
let root: ReturnType<typeof createRoot>
let timer: ReturnType<typeof usePracticeTimer>
function Harness({ songId, playing }: { songId: string; playing: boolean }) {
  timer = usePracticeTimer(songId, playing)
  return null
}
function render(songId: string, playing: boolean) {
  act(() => root.render(HarnessElement(songId, playing)))
}
// No JSX is needed for this hook's test harness.
const HarnessElement = (songId: string, playing: boolean) => createElement(Harness, { songId, playing })
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear()
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  root = createRoot(document.createElement('div'))
})
afterEach(() => { act(() => root.unmount()); vi.restoreAllMocks() })
it('saves only active intervals of at least 30 seconds', () => {
  render('a', true)
  clock = 29000
  render('a', false)
  expect(listSessions()).toHaveLength(0)
  clock = 100000
  render('a', true)
  clock = 130000
  act(() => { timer.tick() })
  expect(timer.elapsedSec).toBe(30)
  render('a', false)
  expect(listSessions()[0]).toMatchObject({ songId: 'a', durationSec: 30 })
  clock = 200000
  act(() => timer.stop())
  expect(listSessions()).toHaveLength(1)
})
it('flushes on song change, beforeunload and unmount without duplicate saves', () => {
  render('a', true)
  clock = 31000
  render('b', true)
  expect(listSessions()[0].songId).toBe('a')
  clock = 65000
  act(() => window.dispatchEvent(new Event('beforeunload')))
  expect(listSessions()).toHaveLength(2)
  act(() => root.unmount())
  expect(listSessions()).toHaveLength(2)
  root = createRoot(document.createElement('div'))
  render('c', true)
  clock = 96000
  act(() => root.unmount())
  expect(listSessions()).toHaveLength(3)
  root = createRoot(document.createElement('div'))
})
