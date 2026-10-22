import { describe, it, expect, vi } from 'vitest'
import {
  getAlphaTabAudioContext, installAudioUnlock, isAudioRunning,
  preferPlaybackAudioSession, UNLOCK_EVENTS, unlockAudio,
} from './audioUnlock'

function fakeApi(state = 'suspended') {
  const buffer = {}
  const source = { buffer: undefined as unknown, connect: vi.fn(), start: vi.fn() }
  const context = {
    state, resume: vi.fn(() => Promise.resolve()), destination: {},
    createBuffer: vi.fn(() => buffer), createBufferSource: vi.fn(() => source),
  }
  const api = { player: { output: { context, activate: vi.fn() } } }
  return { api, context, source, buffer }
}

describe('unlockAudio', () => {
  it.each(['suspended', 'interrupted'])('resumes %s and starts a silent buffer', state => {
    const { api, context, source, buffer } = fakeApi(state)
    expect(unlockAudio(api)).toBe(true)
    expect(api.player.output.activate).toHaveBeenCalledOnce()
    expect(context.resume).toHaveBeenCalledOnce()
    expect(context.createBuffer).toHaveBeenCalledWith(1, 1, 22050)
    expect(source.buffer).toBe(buffer)
    expect(source.connect).toHaveBeenCalledWith(context.destination)
    expect(source.start).toHaveBeenCalledWith(0)
  })

  it('handles rejected resumes', async () => {
    const { api, context } = fakeApi()
    context.resume.mockRejectedValueOnce(new Error('resume'))
    expect(unlockAudio(api)).toBe(true)
    await Promise.resolve()
  })

  it('handles missing players, contexts and throwing getters', () => {
    expect(unlockAudio(null)).toBe(false)
    expect(unlockAudio(undefined)).toBe(false)
    expect(unlockAudio({})).toBe(false)
    const api = { get player() { throw new Error('getter') } }
    expect(getAlphaTabAudioContext(api)).toBeNull()
    expect(unlockAudio(api)).toBe(false)
    expect(getAlphaTabAudioContext({ player: { output: { context: { state: 1 } } } })).toBeNull()
    expect(unlockAudio({ player: { output: { context: null } } })).toBe(true)
  })

  it('does not resume or play a closed context and tolerates activation failure', () => {
    const { api, context } = fakeApi('closed')
    api.player.output.activate.mockImplementation(() => { throw new Error('activate') })
    expect(unlockAudio(api)).toBe(true)
    expect(context.resume).not.toHaveBeenCalled()
    expect(context.createBuffer).not.toHaveBeenCalled()
  })
})

describe('installAudioUnlock', () => {
  it('unlocks on gestures, follows recreated APIs and cleans up twice safely', () => {
    const target = new EventTarget()
    const first = fakeApi()
    const second = fakeApi('interrupted')
    let api = first.api
    const cleanup = installAudioUnlock(() => api, target)
    target.dispatchEvent(new Event('touchstart'))
    expect(first.context.resume).toHaveBeenCalledOnce()
    api = second.api
    target.dispatchEvent(new Event('click'))
    expect(second.context.resume).toHaveBeenCalledOnce()
    cleanup()
    cleanup()
    for (const event of UNLOCK_EVENTS) target.dispatchEvent(new Event(event))
    expect(first.context.resume).toHaveBeenCalledOnce()
    expect(second.context.resume).toHaveBeenCalledOnce()
  })

  it('does nothing while running or before an API exists', () => {
    const target = new EventTarget()
    const { api, context } = fakeApi('running')
    let current: unknown = null
    const cleanup = installAudioUnlock(() => current, target)
    target.dispatchEvent(new Event('click'))
    current = api
    expect(isAudioRunning(api)).toBe(true)
    for (const event of UNLOCK_EVENTS) target.dispatchEvent(new Event(event))
    expect(api.player.output.activate).not.toHaveBeenCalled()
    expect(context.resume).not.toHaveBeenCalled()
    expect(context.createBuffer).not.toHaveBeenCalled()
    cleanup()
  })
})

describe('preferPlaybackAudioSession', () => {
  it('sets playback and handles missing or unwritable sessions', () => {
    const nav = { audioSession: { type: 'auto' } }
    expect(preferPlaybackAudioSession(nav)).toBe(true)
    expect(nav.audioSession.type).toBe('playback')
    expect(preferPlaybackAudioSession({})).toBe(false)
    expect(preferPlaybackAudioSession(null)).toBe(false)
    expect(preferPlaybackAudioSession({ audioSession: Object.freeze({ type: 'auto' }) })).toBe(false)
  })
})
