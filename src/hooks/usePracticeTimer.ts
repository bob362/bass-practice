import { useCallback, useEffect, useRef, useState } from 'react'
import { addSession } from '../utils/progress'

/** Each uninterrupted playing interval is a session; pauses stop the clock.
 * Passing isPlaying drives it automatically; start/stop also support manual use. */
export function usePracticeTimer(songId: string | null | undefined, isPlaying = false) {
  const active = useRef<{ songId: string; start: string; clock: number } | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [isActive, setIsActive] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const tick = useCallback(() => {
    const seconds = active.current ? Math.max(0, (performance.now() - active.current.clock) / 1000) : 0
    setElapsedSec(seconds)
    return seconds
  }, [])
  const finish = useCallback((updateState: boolean) => {
    const session = active.current
    if (!session) {
      if (updateState) setIsActive(false)
      return
    }
    const durationSec = Math.max(0, (performance.now() - session.clock) / 1000)
    // Clear before persisting so stop, beforeunload and cleanup cannot double-save.
    active.current = null
    try {
      if (durationSec >= 30) addSession({ songId: session.songId, start: session.start, durationSec })
    } catch (cause) { if (updateState) setError(cause) }
    if (updateState) { setElapsedSec(durationSec); setIsActive(false) }
  }, [])
  const stop = useCallback(() => finish(true), [finish])
  const start = useCallback(() => {
    if (!songId || active.current) return
    active.current = { songId, start: new Date().toISOString(), clock: performance.now() }
    setElapsedSec(0)
    setError(null)
    setIsActive(true)
  }, [songId])
  useEffect(() => {
    if (isPlaying) start()
    else stop()
    return () => finish(false)
  }, [songId, isPlaying, start, stop, finish])
  useEffect(() => {
    if (!isActive) return
    const interval = window.setInterval(tick, 1000)
    return () => window.clearInterval(interval)
  }, [isActive, tick])
  useEffect(() => {
    const flush = () => finish(false)
    window.addEventListener('beforeunload', flush)
    return () => { window.removeEventListener('beforeunload', flush); flush() }
  }, [finish])
  return { elapsedSec, isActive, start, stop, tick, error }
}
