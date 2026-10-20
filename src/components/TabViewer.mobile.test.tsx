import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import TabViewer from './TabViewer'

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
}))

vi.mock('../utils/pdfjsConfig', () => ({
  configurePdfjsWorker: vi.fn(),
  pdfDocumentParams: vi.fn(),
}))

vi.mock('./YouTubePanel', () => ({
  default: () => null,
}))

vi.mock('./SectionPanel', () => ({
  default: () => null,
}))

vi.mock('./InputCheckPanel', () => ({
  default: () => null,
}))

vi.mock('./SimplifyPanel', () => ({
  default: () => null,
}))

class FakeAlphaTabEvent {
  handlers: Array<(e?: unknown) => void> = []

  on(fn: (e?: unknown) => void): void {
    this.handlers.push(fn)
  }

  fire(e?: unknown): void {
    for (const handler of [...this.handlers]) handler(e)
  }
}

const apiInstances: FakeApi[] = []

class FakeApi {
  scoreLoaded = new FakeAlphaTabEvent()
  renderFinished = new FakeAlphaTabEvent()
  error = new FakeAlphaTabEvent()
  playerStateChanged = new FakeAlphaTabEvent()
  playerFinished = new FakeAlphaTabEvent()
  playerPositionChanged = new FakeAlphaTabEvent()

  timePosition = 0
  tickPosition = 0
  playbackSpeed = 1
  masterVolume = 1
  score: { masterBars: unknown[] } = { masterBars: [] }
  settings = { display: { scale: 1.1 } }

  play = vi.fn()
  pause = vi.fn()
  stop = vi.fn()
  destroy = vi.fn()
  load = vi.fn()
  tex = vi.fn()
  updateSettings = vi.fn()
  render = vi.fn()

  constructor(_element: HTMLElement, _options: unknown) {
    void _element
    void _options
    apiInstances.push(this)
  }
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
const originalMatchMedia = window.matchMedia

/** スマホ幅として振る舞うmatchMedia */
function mockMobileMatchMedia() {
  window.matchMedia = vi.fn((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  })) as unknown as typeof window.matchMedia
}

async function mountReadyViewer() {
  await act(async () => {
    root.render(
      <TabViewer
        filePath={'\\title "x" . 3.3.4'}
        songId={null}
        onFileImport={() => {}}
      />,
    )
  })
  for (let i = 0; i < 10 && apiInstances.length === 0; i++) {
    await act(async () => { await Promise.resolve() })
  }
  expect(apiInstances.length).toBe(1)
  await act(async () => {
    apiInstances[0].renderFinished.fire()
  })
}

const $ = <T extends Element = HTMLElement>(sel: string) => container.querySelector<T>(sel)!

function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  })
}

function click(target: Element) {
  act(() => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(window as unknown as { alphaTab?: unknown }).alphaTab = { AlphaTabApi: FakeApi }
  mockMobileMatchMedia()
  apiInstances.length = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete (window as unknown as { alphaTab?: unknown }).alphaTab
  window.matchMedia = originalMatchMedia
  vi.clearAllMocks()
})

it('renders the mobile transport bar and keeps the sheet closed by default', async () => {
  await mountReadyViewer()
  expect($('[data-testid="mobile-transport"]')).not.toBeNull()
  const toggle = $('[data-testid="mobile-sheet-toggle"]')
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(toggle.getAttribute('aria-controls')).toBe('mobile-sheet')
  expect($('[data-testid="mobile-sheet"]').getAttribute('data-sheet-open')).toBe('false')
  expect($('[data-testid="mobile-play-toggle"]').getAttribute('aria-label')).toBe('再生')
})

it('opens the sheet, moves focus into the active panel with Tab and back with Shift+Tab', async () => {
  await mountReadyViewer()
  const toggle = $('[data-testid="mobile-sheet-toggle"]')
  click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('true')

  const videoTab = $('[data-testid="mobile-sheet-tab-video"]')
  expect(document.activeElement).toBe(videoTab)

  // 動画パネル（中身なし）はパネル自体にフォーカスする
  press(videoTab, 'Tab')
  const videoPane = $('#mobile-sheet-pane-video')
  expect(document.activeElement).toBe(videoPane)

  press(videoPane, 'Tab', { shiftKey: true })
  expect(document.activeElement).toBe(videoTab)

  // 設定タブでは最初の操作ボタンへ
  press(videoTab, 'ArrowRight')
  const settingsTab = $('[data-testid="mobile-sheet-tab-settings"]')
  expect(document.activeElement).toBe(settingsTab)
  expect(settingsTab.getAttribute('aria-selected')).toBe('true')

  press(settingsTab, 'Tab')
  const settingsPane = $('#mobile-sheet-pane-settings')
  const active = document.activeElement as HTMLElement
  expect(settingsPane.contains(active)).toBe(true)
  expect(active.tagName).toBe('BUTTON')

  press(active, 'Tab', { shiftKey: true })
  expect(document.activeElement).toBe(settingsTab)
})

it('Tab from the end of the panel reaches the close button, and Shift+Tab from close goes back into the panel', async () => {
  await mountReadyViewer()
  click($('[data-testid="mobile-sheet-toggle"]'))
  const close = $('[data-testid="mobile-sheet-close"]')

  // 動画パネル（中身なし）：パネル自体 → 閉じる → パネル自体
  const videoTab = $('[data-testid="mobile-sheet-tab-video"]')
  press(videoTab, 'Tab')
  const videoPane = $('#mobile-sheet-pane-video')
  expect(document.activeElement).toBe(videoPane)
  press(videoPane, 'Tab')
  expect(document.activeElement).toBe(close)
  press(close, 'Tab', { shiftKey: true })
  expect(document.activeElement).toBe(videoPane)

  // 設定パネル：最後の操作要素 → 閉じる → 最後の操作要素
  press(videoTab, 'ArrowRight')
  const settingsPane = $('#mobile-sheet-pane-settings')
  const controls = Array.from(settingsPane.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'))
    .filter(el => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && !(el instanceof HTMLInputElement && el.type === 'file'))
  const last = controls[controls.length - 1]
  expect(controls.length).toBeGreaterThan(1)
  act(() => last.focus())
  press(last, 'Tab')
  expect(document.activeElement).toBe(close)
  press(close, 'Tab', { shiftKey: true })
  expect(document.activeElement).toBe(last)

  // 途中の要素でのTabは横取りしない（ブラウザの通常の移動に任せる）
  const first = controls[0]
  act(() => first.focus())
  const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
  act(() => { first.dispatchEvent(event) })
  expect(event.defaultPrevented).toBe(false)
})

it('closes the sheet with Escape and returns focus to the toggle', async () => {
  await mountReadyViewer()
  const toggle = $('[data-testid="mobile-sheet-toggle"]')
  click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('true')

  press(document.activeElement!, 'Escape')
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect($('[data-testid="mobile-sheet"]').getAttribute('data-sheet-open')).toBe('false')
  expect(document.activeElement).toBe(toggle)
})

it('changes the tempo with the + / - buttons', async () => {
  await mountReadyViewer()
  const value = () => $('.mobile-tempo-value').textContent
  expect(value()).toBe('100%')

  click($('[data-testid="mobile-tempo-down"]'))
  expect(value()).toBe('95%')
  click($('[data-testid="mobile-tempo-up"]'))
  click($('[data-testid="mobile-tempo-up"]'))
  expect(value()).toBe('105%')
})
