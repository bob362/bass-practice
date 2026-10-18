import { describe, expect, it, vi } from 'vitest'
import { applyVolume, clampVolume, readPlayerVolume } from './youtubeVolume'

describe('clampVolume', () => {
  it('範囲外の値をクランプする', () => {
    expect(clampVolume(150)).toBe(100)
    expect(clampVolume(-5)).toBe(0)
    expect(clampVolume(33.6)).toBe(34)
    expect(clampVolume(50)).toBe(50)
  })

  it('非有限値は100を返す', () => {
    expect(clampVolume(NaN)).toBe(100)
    expect(clampVolume(Infinity)).toBe(100)
  })
})

describe('applyVolume', () => {
  it('setVolume を呼び出し、muted に応じて mute/unMute を呼ぶ', () => {
    const player = { setVolume: vi.fn(), mute: vi.fn(), unMute: vi.fn() }
    applyVolume(player, 42, true)
    expect(player.setVolume).toHaveBeenCalledWith(42)
    expect(player.mute).toHaveBeenCalledTimes(1)
    expect(player.unMute).not.toHaveBeenCalled()

    applyVolume(player, 42, false)
    expect(player.unMute).toHaveBeenCalledTimes(1)
  })

  it('範囲外の音量をクランプして渡す', () => {
    const player = { setVolume: vi.fn(), mute: vi.fn(), unMute: vi.fn() }
    applyVolume(player, 150, false)
    expect(player.setVolume).toHaveBeenLastCalledWith(100)
    applyVolume(player, -20, false)
    expect(player.setVolume).toHaveBeenLastCalledWith(0)
    applyVolume(player, NaN, false)
    expect(player.setVolume).toHaveBeenLastCalledWith(100)
  })

  it('例外を握りつぶす（player が破棄されていても投げない）', () => {
    const player = { setVolume: vi.fn(() => { throw new Error('destroyed') }), mute: vi.fn(), unMute: vi.fn() }
    expect(() => applyVolume(player, 50, true)).not.toThrow()

    const muteThrows = { setVolume: vi.fn(), mute: vi.fn(() => { throw new Error('boom') }), unMute: vi.fn() }
    expect(() => applyVolume(muteThrows, 50, true)).not.toThrow()
  })
})

describe('readPlayerVolume', () => {
  it('音量とミュート状態を返す', () => {
    const player = { getVolume: vi.fn(() => 80), isMuted: vi.fn(() => true) }
    expect(readPlayerVolume(player)).toEqual({ volume: 80, muted: true })
  })

  it('音量をクランプする isMuted は truthy を boolean にする', () => {
    const player = { getVolume: vi.fn(() => -10), isMuted: vi.fn(() => 1 as unknown as boolean) }
    expect(readPlayerVolume(player)).toEqual({ volume: 0, muted: true })
  })

  it('getVolume が非有限値なら null', () => {
    const player = { getVolume: vi.fn(() => NaN), isMuted: vi.fn(() => false) }
    expect(readPlayerVolume(player)).toBeNull()
  })

  it('例外が発生したら null', () => {
    const throwing = { getVolume: vi.fn(() => { throw new Error('boom') }), isMuted: vi.fn(() => false) }
    expect(readPlayerVolume(throwing)).toBeNull()

    const mutedThrows = { getVolume: vi.fn(() => 50), isMuted: vi.fn(() => { throw new Error('boom') }) }
    expect(readPlayerVolume(mutedThrows)).toBeNull()
  })
})
