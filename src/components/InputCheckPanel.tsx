import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { detectPitch, hzToMidi, midiToName, rms } from '../audio/pitch'
import { OnsetDetector } from '../audio/onset'
import { notesInBars, notesInTickRange } from '../utils/scoreModel'
import type { PlainNote, PlainScore } from '../utils/scoreModel'
import { judgeLive, scoreAttempt } from '../utils/scoring'
import type { DetectedNote, Verdict } from '../utils/scoring'
import type { SimplifyLevel } from '../utils/simplify'
import { addAccuracyRecord, bestAccuracy } from '../utils/progress'
import type { PracticeSection } from '../utils/progress'
import type { PositionListener } from './YouTubePanel'

/** 判定対象の範囲。sectionIdがあればセクション、tickがあればA-Bループ */
export interface JudgeRange {
  sectionId?: string
  startBar: number
  endBar: number
  startTick?: number
  endTick?: number
}

interface InputCheckPanelProps {
  songId: string | null
  /** 現在表示中（簡単アレンジ適用後を含む）の譜面 */
  score: PlainScore | null
  isPlaying: boolean
  tempoPercent: number
  simplifyLevel: SimplifyLevel
  range: JudgeRange | null
  sections: PracticeSection[]
  getTabSec: () => number
  subscribePosition: (listener: PositionListener) => () => void
  /** ループが1周したときに通知を受け取る */
  subscribeLoopPass: (listener: () => void) => () => void
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  hit: 'ジャスト',
  early: '早い',
  late: '遅い',
  miss: 'ミス',
  wrong_pitch: '音違い',
}

const FFT_SIZE = 4096
/** オンセット判定に使う直近のサンプル数（約20ms） */
const ONSET_WINDOW = 1024
/** オンセット後、この時間が経ってから音程を取る */
const PITCH_DELAY_SEC = 0.04
/** この時間内に音程が取れなければ、そのオンセットは捨てる */
const PITCH_GIVE_UP_SEC = 0.15
/** これ未満の音数の試行は採点しない（一時停止直後など） */
const MIN_SCORED_NOTES = 4
/** 再生位置イベントの間を補間する上限（秒） */
const MAX_EXTRAPOLATE_SEC = 0.25

interface AttemptResult {
  accuracy: number
  counts: { hits: number; early: number; late: number; misses: number; wrong_pitch: number; total: number }
  startBar: number
  endBar: number
  sectionId?: string
  tempoPercent: number
  level: SimplifyLevel
  saved: boolean
}

function micErrorMessage(error: unknown): string {
  const name = (error as { name?: string } | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'マイクの使用が許可されていません。ブラウザの設定で許可してください'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return '入力デバイスが見つかりません'
  if (name === 'NotReadableError') return '入力デバイスを開けません。他のアプリが使用中の可能性があります'
  return 'マイクを開始できませんでした'
}


export default function InputCheckPanel({
  songId, score, isPlaying, tempoPercent, simplifyLevel, range, sections,
  getTabSec, subscribePosition, subscribeLoopPass,
}: InputCheckPanelProps) {
  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(supported ? null : 'このブラウザ（またはHTTPS以外の接続）ではマイク入力を利用できません')
  const [level, setLevel] = useState(0)
  const [detected, setDetected] = useState<{ name: string; hz: number } | null>(null)
  const [expectedNote, setExpectedNote] = useState<PlainNote | null>(null)
  const [latencyMs, setLatencyMs] = useState(0)
  const [feedback, setFeedback] = useState<{ verdict: Verdict; key: number } | null>(null)
  const [result, setResult] = useState<AttemptResult | null>(null)
  const [autoSave, setAutoSave] = useState(true)
  const [recordsVersion, setRecordsVersion] = useState(0)

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const detectionsRef = useRef<DetectedNote[]>([])
  /** 今回の試行で再生した範囲（譜面秒） */
  const spanRef = useRef<{ start: number; end: number } | null>(null)
  const lastPosRef = useRef<{ tabSec: number; at: number } | null>(null)
  /** マイク開始のたびに増やし、許可待ちの間に停止・アンマウントされた開始を無効にする */
  const startTokenRef = useRef(0)

  // rAFループ・イベントから最新値を参照する
  const latest = useRef({ score, isPlaying, tempoPercent, simplifyLevel, range, songId, latencyMs, autoSave, running })
  latest.current = { score, isPlaying, tempoPercent, simplifyLevel, range, songId, latencyMs, autoSave, running }

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput')
      setDevices(list)
    } catch (e) {
      console.error('Failed to enumerate devices:', e)
    }
  }, [])

  useEffect(() => {
    if (!supported) return
    refreshDevices()
    const md = navigator.mediaDevices
    md.addEventListener?.('devicechange', refreshDevices)
    return () => md.removeEventListener?.('devicechange', refreshDevices)
  }, [supported, refreshDevices])

  /** 補間した現在の譜面位置（秒・100%テンポ基準） */
  const currentTabSec = useCallback(() => {
    const last = lastPosRef.current
    if (!last || !latest.current.isPlaying) return getTabSec()
    const elapsed = (performance.now() - last.at) / 1000 * latest.current.tempoPercent / 100
    return last.tabSec + Math.min(Math.max(0, elapsed), MAX_EXTRAPOLATE_SEC)
  }, [getTabSec])

  const save = useCallback((attempt: AttemptResult): AttemptResult => {
    const id = latest.current.songId
    if (!id || attempt.saved) return attempt
    try {
      addAccuracyRecord({
        songId: id,
        ...(attempt.sectionId ? { sectionId: attempt.sectionId } : {}),
        startBar: attempt.startBar,
        endBar: attempt.endBar,
        level: attempt.level,
        accuracy: attempt.accuracy,
        hits: attempt.counts.hits,
        misses: attempt.counts.misses,
        early: attempt.counts.early,
        late: attempt.counts.late,
        total: attempt.counts.total,
        tempoPercent: attempt.tempoPercent,
        date: new Date().toISOString(),
      })
      setRecordsVersion(v => v + 1)
      return { ...attempt, saved: true }
    } catch (e) {
      console.error('Failed to save accuracy record:', e)
      return attempt
    }
  }, [])

  /** 集めた検出音を採点し、次の試行のためにリセットする */
  const finalizeAttempt = useCallback((fullPass: boolean) => {
    const detections = detectionsRef.current
    const span = spanRef.current
    detectionsRef.current = []
    spanRef.current = null
    const { score, range, running, tempoPercent, simplifyLevel, autoSave } = latest.current
    if (!score || !running || !span) return

    let expected: PlainNote[]
    if (range?.startTick !== undefined && range.endTick !== undefined) expected = notesInTickRange(score, range.startTick, range.endTick)
    else if (range) expected = notesInBars(score, range.startBar, range.endBar)
    else expected = score.notes
    // ループ1周以外（途中停止など）は実際に再生した範囲だけを採点する
    if (!fullPass || !range) expected = expected.filter(n => n.startSec >= span.start - 0.05 && n.startSec <= span.end)
    const scored = scoreAttempt(expected, detections)
    if (scored.counts.total < MIN_SCORED_NOTES) return

    const bars = expected.map(n => n.bar)
    let attempt: AttemptResult = {
      accuracy: Math.round(scored.accuracy * 10) / 10,
      counts: scored.counts,
      startBar: Math.min(...bars),
      endBar: Math.max(...bars),
      sectionId: range?.sectionId,
      tempoPercent,
      level: simplifyLevel,
      saved: false,
    }
    if (autoSave) attempt = save(attempt)
    setResult(attempt)
  }, [save])

  // 再生位置を追跡（予定音の表示・再生範囲の記録・シーク時の区切り）
  useEffect(() => subscribePosition((tabSec, isSeek) => {
    if (isSeek && latest.current.isPlaying) finalizeAttempt(false)
    lastPosRef.current = { tabSec, at: performance.now() }
    if (latest.current.isPlaying) {
      const span = spanRef.current
      spanRef.current = span ? { start: Math.min(span.start, tabSec), end: Math.max(span.end, tabSec) } : { start: tabSec, end: tabSec }
    }
    const notes = latest.current.score?.notes
    let current: PlainNote | null = null
    if (notes) {
      for (const n of notes) {
        if (n.startSec > tabSec + 0.02) break
        current = n
      }
      if (!current && notes.length) current = notes[0]
    }
    setExpectedNote(prev => (prev?.id === current?.id && prev?.midi === current?.midi ? prev : current))
  }), [subscribePosition, finalizeAttempt])

  useEffect(() => subscribeLoopPass(() => finalizeAttempt(true)), [subscribeLoopPass, finalizeAttempt])

  // 再生停止で採点
  const wasPlaying = useRef(isPlaying)
  useEffect(() => {
    if (wasPlaying.current && !isPlaying) finalizeAttempt(false)
    if (!wasPlaying.current && isPlaying) {
      detectionsRef.current = []
      spanRef.current = null
      lastPosRef.current = null
    }
    wasPlaying.current = isPlaying
  }, [isPlaying, finalizeAttempt])

  // 譜面が差し替わったら（簡単アレンジ等）途中の試行は捨てる
  useEffect(() => {
    detectionsRef.current = []
    spanRef.current = null
    setExpectedNote(null)
  }, [score])

  const stop = useCallback(() => {
    startTokenRef.current++
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    const ctx = ctxRef.current
    ctxRef.current = null
    if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {})
    setRunning(false)
    setLevel(0)
    setDetected(null)
  }, [])

  const start = useCallback(async (id: string) => {
    if (!navigator.mediaDevices?.getUserMedia) return
    stop()
    const token = startTokenRef.current
    setError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(id ? { deviceId: { exact: id } } : {}),
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
    } catch (e) {
      if (token === startTokenRef.current) setError(micErrorMessage(e))
      return
    }
    if (token !== startTokenRef.current) {
      stream.getTracks().forEach(t => t.stop())
      return
    }
    // 許可後はデバイス名が取れるので再取得する
    refreshDevices()
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) {
      stream.getTracks().forEach(t => t.stop())
      setError('このブラウザでは音声解析を利用できません')
      return
    }
    const ctx = new AudioCtx()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = FFT_SIZE
    ctx.createMediaStreamSource(stream).connect(analyser)
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    streamRef.current = stream
    ctxRef.current = ctx
    setRunning(true)

    const buf = new Float32Array(FFT_SIZE)
    const onset = new OnsetDetector()
    let pending: { audioSec: number; tabSec: number } | null = null
    let lastUiUpdate = 0

    const tick = () => {
      if (ctxRef.current !== ctx) return
      rafRef.current = requestAnimationFrame(tick)
      analyser.getFloatTimeDomainData(buf)
      const now = ctx.currentTime
      const isOnset = onset.push(buf.subarray(FFT_SIZE - ONSET_WINDOW), now)
      if (isOnset) pending = { audioSec: now, tabSec: currentTabSec() }

      const pitch = detectPitch(buf, ctx.sampleRate)
      if (pending && now - pending.audioSec >= PITCH_DELAY_SEC) {
        if (pitch) {
          const { latencyMs, tempoPercent, isPlaying, score } = latest.current
          // 遅延は実時間なので、再生速度を掛けて譜面時間に換算する
          const note: DetectedNote = { timeSec: pending.tabSec - latencyMs / 1000 * tempoPercent / 100, midi: hzToMidi(pitch.hz) }
          pending = null
          if (isPlaying && score) {
            detectionsRef.current.push(note)
            const nearby = score.notes.filter(n => Math.abs(n.startSec - note.timeSec) < 1)
            const live = judgeLive(nearby, note)
            setFeedback({ verdict: live?.verdict ?? 'miss', key: performance.now() })
          }
        } else if (now - pending.audioSec > PITCH_GIVE_UP_SEC) {
          pending = null
        }
      }

      const ms = performance.now()
      if (ms - lastUiUpdate > 50) {
        lastUiUpdate = ms
        // -60dB〜0dBを0〜100%に
        const db = 20 * Math.log10(Math.max(rms(buf), 1e-6))
        setLevel(Math.max(0, Math.min(100, (db + 60) / 60 * 100)))
        setDetected(pitch ? { name: midiToName(hzToMidi(pitch.hz)), hz: pitch.hz } : null)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [stop, refreshDevices, currentTabSec])

  useEffect(() => stop, [stop])

  const handleDeviceChange = (id: string) => {
    setDeviceId(id)
    if (running) start(id)
  }

  const handleManualSave = () => {
    if (result) setResult(save(result))
  }

  const bestBySection = useMemo(() => {
    if (!songId) return []
    return [...sections]
      .sort((a, b) => a.startBar - b.startBar || a.endBar - b.endBar)
      .map(s => ({ section: s, best: bestAccuracy(songId, s.id) }))
    // recordsVersionは保存後の再計算用
  }, [songId, sections, recordsVersion])

  return (
    <div className="input-check-panel">
      {error && <div className="field-error">{error}</div>}

      {supported && (
        <>
          <label className="field-label" htmlFor="input-device">入力デバイス</label>
          <select
            id="input-device"
            className="status-select"
            value={deviceId}
            onChange={e => handleDeviceChange(e.target.value)}
          >
            <option value="">既定のデバイス</option>
            {devices.filter(d => d.deviceId && d.deviceId !== 'default').map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `入力デバイス ${i + 1}`}</option>
            ))}
          </select>
          <button
            className={`button ${running ? 'button-secondary' : 'button-primary'} button-small`}
            onClick={() => (running ? stop() : start(deviceId))}
          >
            {running ? '⏹ マイク停止' : '🎤 マイク開始'}
          </button>
        </>
      )}

      {running && (
        <>
          <div className="level-meter" aria-label="入力レベル">
            <div className="level-meter-value" style={{ width: `${level}%` }} />
          </div>
          <div className="input-notes">
            <div className="input-note">
              <span className="input-note-label">検出</span>
              <span className="input-note-value">{detected ? detected.name : '—'}</span>
              <span className="input-note-sub">{detected ? `${detected.hz.toFixed(1)} Hz` : ''}</span>
            </div>
            <div className="input-note">
              <span className="input-note-label">譜面</span>
              <span className="input-note-value">{expectedNote ? midiToName(expectedNote.midi) : '—'}</span>
              <span className="input-note-sub">{expectedNote ? `${expectedNote.string}弦 ${expectedNote.fret}F` : ''}</span>
            </div>
          </div>
          {feedback && (
            <div key={feedback.key} className={`verdict-badge verdict-${feedback.verdict}`}>
              {VERDICT_LABELS[feedback.verdict]}
            </div>
          )}
        </>
      )}

      <div className="slider-container">
        <div className="slider-label">
          <span>遅延補正</span>
          <span>{latencyMs}ms</span>
        </div>
        <input
          type="range"
          min="0"
          max="300"
          step="5"
          value={latencyMs}
          onChange={e => setLatencyMs(Number(e.target.value))}
          className="slider"
          aria-label="遅延補正"
        />
      </div>

      <div className="judge-range">
        判定範囲: {range ? `${range.startBar}〜${range.endBar}小節${range.sectionId ? '（セクション）' : '（A-B区間）'}` : '再生した範囲'}
      </div>

      {result && (
        <div className="accuracy-result">
          <div className="slider-label">
            <span>正確さ（{result.startBar}〜{result.endBar}小節・{result.tempoPercent}%）</span>
            <span className="accuracy-value">{result.accuracy}%</span>
          </div>
          <div className="progress-track"><div className="progress-value" style={{ width: `${result.accuracy}%` }} /></div>
          <div className="accuracy-counts">
            <span className="verdict-hit">{VERDICT_LABELS.hit} {result.counts.hits}</span>
            <span className="verdict-early">{VERDICT_LABELS.early} {result.counts.early}</span>
            <span className="verdict-late">{VERDICT_LABELS.late} {result.counts.late}</span>
            <span className="verdict-wrong_pitch">{VERDICT_LABELS.wrong_pitch} {result.counts.wrong_pitch}</span>
            <span className="verdict-miss">{VERDICT_LABELS.miss} {result.counts.misses}</span>
          </div>
          <button
            className="button button-secondary button-small"
            onClick={handleManualSave}
            disabled={!songId || result.saved}
          >
            {result.saved ? '✓ 保存済み' : '結果を保存'}
          </button>
        </div>
      )}

      {songId ? (
        <label className="checkbox-row">
          <input type="checkbox" checked={autoSave} onChange={e => setAutoSave(e.target.checked)} />
          結果を自動保存
        </label>
      ) : (
        <div className="info-text">「曲の管理」から保存済みの曲を開くと、判定結果を記録できます。</div>
      )}

      {bestBySection.length > 0 && (
        <ul className="best-accuracy-list">
          {bestBySection.map(({ section, best }) => (
            <li key={section.id} className={section.id === range?.sectionId ? 'active' : ''}>
              <span className="section-name">{section.name}</span>
              <span className="section-tempo">ベスト {best > 0 ? `${Math.round(best)}%` : '—'}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="info-text">
        マイクを開始して再生すると、弾いた音を譜面と照合します。ループ1周ごと、または停止時に正確さを表示します。音が遅れて判定される場合は遅延補正を上げてください。
      </div>
    </div>
  )
}
