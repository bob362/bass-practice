import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Dashboard from './Dashboard'
import SectionPanel from './SectionPanel'
import { addSession, listSections, upsertSection } from '../utils/progress'
import { saveSong } from '../utils/storage'

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks() })

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

it('dashboard shows per-song progress, practice time, streak and opens songs', () => {
  const song = saveSong({ title: 'テスト曲', texData: 'tab' })
  upsertSection({ songId: song.id, name: 'イントロ', startBar: 1, endBar: 4, status: 'mastered' })
  upsertSection({ songId: song.id, name: 'Aメロ', startBar: 5, endBar: 8, status: 'practicing' })
  addSession({ songId: song.id, start: new Date().toISOString(), durationSec: 3900 })
  const onOpen = vi.fn()
  act(() => root.render(<Dashboard onOpenSong={onOpen} />))
  const text = container.textContent ?? ''
  expect(text).toContain('テスト曲')
  expect(text).toContain('弾けた 1/2')
  expect(text).toContain('50%')
  expect(text).toContain('1時間5分')
  expect(text).toContain('最終練習 今日')
  expect(container.querySelector('.stat-value')?.textContent).toBe('1日')
  act(() => (container.querySelector('.dashboard-song') as HTMLElement).click())
  expect(onOpen).toHaveBeenCalledWith(song)
})

it('section panel saves the A-B range as a named section and updates status', () => {
  const onChanged = vi.fn()
  const render = () => root.render(
    <SectionPanel songId="s1" sections={listSections('s1')} loopRange={{ startBar: 3, endBar: 6 }} barCount={16}
      activeSectionId={null} onChanged={() => { onChanged(); render() }} onLoopSection={() => {}} />)
  act(render)
  const [name, start, end] = container.querySelectorAll<HTMLInputElement>('input')
  expect(start.value).toBe('3')
  expect(end.value).toBe('6')
  act(() => setInput(name, 'サビ'))
  act(() => container.querySelector<HTMLButtonElement>('.section-form button')!.click())
  expect(listSections('s1')).toMatchObject([{ name: 'サビ', startBar: 3, endBar: 6, status: 'not_started' }])
  const select = container.querySelector<HTMLSelectElement>('.status-select')!
  act(() => { select.value = 'mastered'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(listSections('s1')[0].status).toBe('mastered')
  expect(container.textContent).toContain('弾けた 1/1')
})
