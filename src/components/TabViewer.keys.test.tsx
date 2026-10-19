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

let ytProps: Record<string, unknown> | null = null

vi.mock('./YouTubePanel', () => ({
  default: (props: Record<string, unknown>) => {
    ytProps = props
    return null
  },
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

type StateChangeEvent = { state: number }

class FakeApi {
  scoreLoaded = new FakeAlphaTabEvent()
  renderFinished = new FakeAlphaTabEvent()
  error = new FakeAlphaTabEvent()
  playerStateChanged = new FakeAlphaTabEvent()
  playerFinished = new FakeAlphaTabEvent()
  playerPositionChanged = new FakeAlphaTabEvent()

  timePosition = 0
  playbackSpeed = 1
  masterVolume = 1
  score: { masterBars: unknown[] } = { masterBars: [] }

  play = vi.fn(() => {
    this.playerStateChanged.fire({ state: 1 } satisfies StateChangeEvent)
  })
  pause = vi.fn(() => {
    this.playerStateChanged.fire({ state: 0 } satisfies StateChangeEvent)
  })
  stop = vi.fn()
  destroy = vi.fn()
  load = vi.fn()
  tex = vi.fn()

  private tick = 0
  tickHistory: number[] = []

  get tickPosition(): number {
    return this.tick
  }

  set tickPosition(value: number) {
    this.tick = value
    this.tickHistory.push(value)
  }

  constructor(_element: HTMLElement, _options: unknown) {
    void _element
    void _options
    apiInstances.push(this)
  }
}

function pressSpace(target: EventTarget, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: ' ',
    code: 'Space',
    bubbles: true,
    cancelable: true,
    ...init,
  })
  target.dispatchEvent(event)
  return event
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

async function mountViewer() {
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
}

async function makeReady() {
  await act(async () => {
    apiInstances[0].renderFinished.fire()
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(window as unknown as { alphaTab?: unknown }).alphaTab = { AlphaTabApi: FakeApi }
  apiInstances.length = 0
  ytProps = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete (window as unknown as { alphaTab?: unknown }).alphaTab
  vi.clearAllMocks()
})

it('space on body plays and a second space pauses', async () => {
  await mountViewer()
  await makeReady()
  const api = apiInstances[0]

  let firstEvent: KeyboardEvent
  await act(async () => {
    firstEvent = pressSpace(document.body)
  })
  expect(api.play).toHaveBeenCalledTimes(1)
  expect(firstEvent!.defaultPrevented).toBe(true)

  await act(async () => { await Promise.resolve() })
  const secondEvent = pressSpace(document.body)
  expect(api.pause).toHaveBeenCalledTimes(1)
  expect(api.play).toHaveBeenCalledTimes(1)
  expect(secondEvent.defaultPrevented).toBe(true)
})

it('space on input/textarea is ignored', async () => {
  await mountViewer()
  await makeReady()
  const api = apiInstances[0]

  const input = document.createElement('input')
  input.type = 'text'
  document.body.appendChild(input)
  let inputEvent: KeyboardEvent
  await act(async () => {
    inputEvent = pressSpace(input)
  })
  expect(api.play).not.toHaveBeenCalled()
  expect(inputEvent!.defaultPrevented).toBe(false)
  input.remove()

  const textarea = document.createElement('textarea')
  document.body.appendChild(textarea)
  let textareaEvent: KeyboardEvent
  await act(async () => {
    textareaEvent = pressSpace(textarea)
  })
  expect(api.play).not.toHaveBeenCalled()
  expect(textareaEvent!.defaultPrevented).toBe(false)
  textarea.remove()
})

it('repeated or modified space is consumed without toggling playback', async () => {
  await mountViewer()
  await makeReady()
  const api = apiInstances[0]

  let repeatEvent: KeyboardEvent | undefined
  await act(async () => {
    repeatEvent = pressSpace(document.body, { repeat: true })
  })
  expect(repeatEvent!.defaultPrevented).toBe(true)
  const ctrlEvent = pressSpace(document.body, { ctrlKey: true })
  expect(ctrlEvent.defaultPrevented).toBe(false)
  expect(api.play).not.toHaveBeenCalled()
  expect(api.pause).not.toHaveBeenCalled()
})

it('space keydown with repeat on document.body is defaultPrevented and does not toggle playback', async () => {
  await mountViewer()
  await makeReady()
  const api = apiInstances[0]

  let repeatEvent: KeyboardEvent
  await act(async () => {
    repeatEvent = pressSpace(document.body, { repeat: true })
  })
  expect(repeatEvent!.defaultPrevented).toBe(true)
  expect(api.play).not.toHaveBeenCalled()
  expect(api.pause).not.toHaveBeenCalled()
})

it('space before renderFinished is ignored', async () => {
  await mountViewer()
  const api = apiInstances[0]

  pressSpace(document.body)
  expect(api.play).not.toHaveBeenCalled()
  expect(api.pause).not.toHaveBeenCalled()
})

it('rewind button resets position and scroll without touching playback state', async () => {
  await mountViewer()
  await makeReady()
  const api = apiInstances[0]

  const positions: Array<[number, boolean]> = []
  await act(async () => {
    const subscribe = ytProps!.subscribePosition as (listener: (sec: number, isSeek: boolean) => void) => () => void
    subscribe((sec, isSeek) => { positions.push([sec, isSeek]) })
  })

  api.tickPosition = 5000
  const scroll = container.querySelector<HTMLElement>('.at-viewport')!
  scroll.scrollTop = 300

  const rewindButton = [...container.querySelectorAll('button')]
    .find(button => button.textContent?.includes('最初に戻る'))!
  expect(rewindButton.disabled).toBe(false)
  await act(async () => { rewindButton.click() })

  expect(api.tickPosition).toBe(0)
  expect(scroll.scrollTop).toBe(0)
  expect(positions.at(-1)).toEqual([0, true])
  expect(api.play).not.toHaveBeenCalled()
  expect(api.pause).not.toHaveBeenCalled()
  expect(api.stop).not.toHaveBeenCalled()

  api.play.mockClear()
  api.pause.mockClear()
  api.stop.mockClear()
  pressSpace(document.body)
  expect(api.play).toHaveBeenCalledTimes(1)
  api.pause.mockClear()
  api.stop.mockClear()

  api.tickPosition = 4000
  positions.length = 0
  await act(async () => { rewindButton.click() })
  expect(api.pause).not.toHaveBeenCalled()
  expect(api.stop).not.toHaveBeenCalled()
  expect(api.tickPosition).toBe(0)
  expect(positions.at(-1)).toEqual([0, true])
  const playButton = [...container.querySelectorAll('button')]
    .find(button => button.textContent?.includes('一時停止'))
  expect(playButton).toBeDefined()
})

it('rewind button sits right before the play button', async () => {
  await mountViewer()
  await makeReady()

  const playButton = [...container.querySelectorAll('button')]
    .find(button => button.textContent?.includes('再生'))!
  const rewindButton = [...container.querySelectorAll('button')]
    .find(button => button.textContent?.includes('最初に戻る'))!
  expect(playButton.previousElementSibling).toBe(rewindButton)
  const firstGroup = container.querySelector('.control-group')!
  expect(firstGroup.textContent).toContain('最初に戻る')
  expect(firstGroup.textContent).toContain('再生')
})

it('space does nothing after unmount', async () => {
  await mountViewer()
  await makeReady()
  const api = apiInstances[0]

  act(() => root.unmount())
  pressSpace(document.body)
  expect(api.play).not.toHaveBeenCalled()
  expect(api.pause).not.toHaveBeenCalled()
})
