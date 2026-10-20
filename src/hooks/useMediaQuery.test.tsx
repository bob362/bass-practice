import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { useMediaQuery } from './useMediaQuery'

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia')
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

function Probe({ query = '(max-width: 768px)' }: { query?: string }) {
  return <span>{String(useMediaQuery(query))}</span>
}

function fakeQuery(matches: boolean, legacy = false) {
  const listeners = new Set<() => void>()
  const add = vi.fn((listener: () => void) => { listeners.add(listener) })
  const remove = vi.fn((listener: () => void) => { listeners.delete(listener) })
  const mql = {
    matches,
    addEventListener: legacy ? undefined : vi.fn((_event: string, listener: () => void) => add(listener)),
    removeEventListener: vi.fn((_event: string, listener: () => void) => remove(listener)),
    addListener: add,
    removeListener: remove,
  }
  return {
    mql, listeners, remove,
    fire(next: boolean) {
      mql.matches = next
      listeners.forEach(listener => listener())
    },
  }
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia)
  else Reflect.deleteProperty(window, 'matchMedia')
})

describe('useMediaQuery', () => {
  it('returns false without matchMedia', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined })
    act(() => root.render(<Probe />))
    expect(container.textContent).toBe('false')
  })

  it.each([false, true])('subscribes and cleans up with legacy=%s', legacy => {
    const fake = fakeQuery(true, legacy)
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => fake.mql) })
    act(() => root.render(<Probe />))
    expect(container.textContent).toBe('true')
    act(() => fake.fire(false))
    expect(container.textContent).toBe('false')
    act(() => root.render(<></>))
    expect(fake.listeners.size).toBe(0)
    expect(fake.remove).toHaveBeenCalledTimes(1)
  })

  it('re-syncs and replaces the listener when the query changes', () => {
    const first = fakeQuery(true)
    const second = fakeQuery(false)
    const matchMedia = vi.fn((query: string) => query === 'first' ? first.mql : second.mql)
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: matchMedia })
    act(() => root.render(<Probe query="first" />))
    act(() => root.render(<Probe query="second" />))
    expect(container.textContent).toBe('false')
    expect(first.listeners.size).toBe(0)
    expect(second.listeners.size).toBe(1)
  })
})
