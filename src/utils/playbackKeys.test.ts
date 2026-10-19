import { describe, it, expect } from 'vitest'
import {
  isPlayPauseShortcut,
  getPlayPauseKeyAction,
  isEditableOrActivatableTarget,
  isPlainButtonTarget,
  rewindToStart,
} from './playbackKeys'

function capture(target: Element, init: KeyboardEventInit = {}): boolean {
  let captured: KeyboardEvent | null = null
  const listener = (e: Event): void => {
    captured = e as KeyboardEvent
  }
  target.addEventListener('keydown', listener)
  target.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', cancelable: true, ...init }))
  target.removeEventListener('keydown', listener)
  return isPlayPauseShortcut(captured!)
}

type PlainTarget = EventTarget | null

function plainEvent(overrides: {
  key?: string
  code?: string
  repeat?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  target?: PlainTarget
  defaultPrevented?: boolean
  isComposing?: boolean
} = {}): Pick<
  KeyboardEvent,
  'key' | 'code' | 'repeat' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'target' | 'defaultPrevented' | 'isComposing'
> {
  return {
    key: ' ',
    code: 'Space',
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    defaultPrevented: false,
    isComposing: false,
    ...overrides,
  }
}

function append<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, parent: HTMLElement = document.body): HTMLElement {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v)
  }
  parent.appendChild(el)
  return el
}

describe('isPlayPauseShortcut', () => {
  it('space on document.body -> true', () => {
    expect(capture(document.body)).toBe(true)
  })

  it("key ' ' with code 'Space' -> true", () => {
    expect(capture(document.body, { key: ' ', code: 'Space' })).toBe(true)
  })

  it("legacy 'Spacebar' -> true", () => {
    expect(isPlayPauseShortcut(plainEvent({ key: 'Spacebar', code: '', target: document.body }))).toBe(true)
  })

  it('other keys -> false', () => {
    expect(capture(document.body, { key: 'Enter', code: 'Enter' })).toBe(false)
    expect(capture(document.body, { key: 'k', code: 'KeyK' })).toBe(false)
  })

  it('repeat -> false', () => {
    expect(capture(document.body, { repeat: true })).toBe(false)
  })

  it('each modifier -> false', () => {
    expect(capture(document.body, { ctrlKey: true })).toBe(false)
    expect(capture(document.body, { metaKey: true })).toBe(false)
    expect(capture(document.body, { altKey: true })).toBe(false)
    expect(capture(document.body, { shiftKey: true })).toBe(false)
  })

  it('defaultPrevented -> false', () => {
    expect(isPlayPauseShortcut(plainEvent({ target: document.body, defaultPrevented: true }))).toBe(false)
  })

  it('isComposing -> false', () => {
    expect(isPlayPauseShortcut(plainEvent({ target: document.body, isComposing: true }))).toBe(false)
  })

  it('editable/activatable targets -> false', () => {
    const input = append('input', { type: 'text' })
    const textarea = append('textarea')
    const select = append('select')
    const button = append('button')
    const anchor = append('a')
    const roleButton = append('div', { role: 'button' })
    const contentEditable = append('div', { contenteditable: 'true' })

    for (const el of [input, textarea, select, anchor, contentEditable]) {
      expect(capture(el), `${el.tagName}`).toBe(false)
    }
    // ボタン上ではスペースで再生/一時停止する
    expect(capture(button)).toBe(true)
    expect(capture(roleButton)).toBe(true)
  })

  it('nested span: button -> true, contenteditable -> false', () => {
    const btn = append('button')
    const spanInBtn = append('span', {}, btn)
    expect(capture(spanInBtn)).toBe(true)

    const ce = append('div', { contenteditable: 'true' })
    const spanInCe = append('span', {}, ce)
    expect(capture(spanInCe)).toBe(false)
    expect(isEditableOrActivatableTarget(spanInBtn)).toBe(true)
    expect(isEditableOrActivatableTarget(spanInCe)).toBe(true)
  })

  it("div[contenteditable=false] -> true", () => {
    const el = append('div', { contenteditable: 'false' })
    expect(capture(el)).toBe(true)
  })

  it('null / window target -> true', () => {
    expect(isPlayPauseShortcut(plainEvent({ target: null }))).toBe(true)
    expect(isPlayPauseShortcut(plainEvent({ target: window }))).toBe(true)
    expect(isEditableOrActivatableTarget(null)).toBe(false)
    expect(isEditableOrActivatableTarget(window)).toBe(false)
    expect(isEditableOrActivatableTarget(document)).toBe(false)
  })

  it('summary and ARIA interactive roles -> false', () => {
    const elements = [
      append('summary'),
      append('div', { role: 'checkbox' }),
      append('div', { role: 'switch' }),
      append('div', { role: 'slider' }),
      append('div', { role: 'radio' }),
      append('div', { role: 'menuitem' }),
      append('div', { role: 'tab' }),
      append('div', { role: 'option' }),
      append('div', { role: 'spinbutton' }),
      append('div', { role: 'textbox' }),
      append('div', { role: 'combobox' }),
    ]

    for (const el of elements) {
      expect(isEditableOrActivatableTarget(el), `${el.tagName}[role=${el.getAttribute('role')}]`).toBe(true)
      expect(capture(el)).toBe(false)
    }
  })
})

describe('getPlayPauseKeyAction', () => {
  it("space on document.body -> 'toggle'", () => {
    expect(getPlayPauseKeyAction(plainEvent({ target: document.body }))).toBe('toggle')
  })

  it("space with repeat -> 'consume'", () => {
    expect(getPlayPauseKeyAction(plainEvent({ target: document.body, repeat: true }))).toBe('consume')
  })

  it("repeat on editable target -> 'ignore'", () => {
    const input = append('input', { type: 'text' })
    expect(getPlayPauseKeyAction(plainEvent({ target: input, repeat: true }))).toBe('ignore')
  })

  it("each modifier -> 'ignore'", () => {
    expect(getPlayPauseKeyAction(plainEvent({ target: document.body, ctrlKey: true }))).toBe('ignore')
    expect(getPlayPauseKeyAction(plainEvent({ target: document.body, metaKey: true }))).toBe('ignore')
    expect(getPlayPauseKeyAction(plainEvent({ target: document.body, altKey: true }))).toBe('ignore')
    expect(getPlayPauseKeyAction(plainEvent({ target: document.body, shiftKey: true }))).toBe('ignore')
  })

  it("non-space key -> 'ignore'", () => {
    expect(getPlayPauseKeyAction(plainEvent({ target: document.body, key: 'Enter', code: 'Enter' }))).toBe('ignore')
  })

  it('isPlayPauseShortcut stays in sync with toggle', () => {
    expect(isPlayPauseShortcut(plainEvent({ target: document.body }))).toBe(true)
    expect(isPlayPauseShortcut(plainEvent({ target: document.body, repeat: true }))).toBe(false)
  })
})

describe('rewindToStart', () => {
  it('sets tickPosition 0 from 5000', () => {
    const api = { tickPosition: 5000 }
    expect(rewindToStart(api)).toBe(true)
    expect(api.tickPosition).toBe(0)
  })

  it('resets scrollTop/scrollLeft', () => {
    const api = { tickPosition: 5000 }
    const scrollEl = { scrollTop: 1000, scrollLeft: 500 }
    expect(rewindToStart(api, scrollEl)).toBe(true)
    expect(scrollEl.scrollTop).toBe(0)
    expect(scrollEl.scrollLeft).toBe(0)
    expect(api.tickPosition).toBe(0)
  })

  it('returns false for null api', () => {
    expect(rewindToStart(null)).toBe(false)
    expect(rewindToStart(undefined)).toBe(false)
  })

  it('works without scrollEl', () => {
    const api = { tickPosition: 42 }
    expect(rewindToStart(api, null)).toBe(true)
    expect(api.tickPosition).toBe(0)
  })
})

describe('space on focused buttons', () => {
  it('toggles when focus is on a plain button, ignores in input', () => {
    const btn = document.createElement('button'); document.body.appendChild(btn)
    const input = document.createElement('input'); document.body.appendChild(input)
    const ev = (target: EventTarget) => ({ key: ' ', code: 'Space', repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target, defaultPrevented: false, isComposing: false })
    expect(getPlayPauseKeyAction(ev(btn))).toBe('toggle')
    expect(isPlainButtonTarget(btn)).toBe(true)
    expect(getPlayPauseKeyAction(ev(input))).toBe('ignore')
    expect(isPlainButtonTarget(input)).toBe(false)
  })
})

it('button with role=radio is not a plain button', () => {
  const b = document.createElement('button'); b.setAttribute('role', 'radio'); document.body.appendChild(b)
  expect(isPlainButtonTarget(b)).toBe(false)
})
