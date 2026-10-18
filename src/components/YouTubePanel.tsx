import { useCallback, useEffect, useRef, useState } from 'react'
import { loadYouTubeAPI, parseYouTubeUrl } from '../utils/youtube'
import { tabToVideoTime } from '../utils/sync'
import { getSongMediaSettings, saveSongMediaSettings } from '../utils/storage'
import type { SongMediaSettings } from '../utils/storage'
import { applyVolume, readPlayerVolume } from '../utils/youtubeVolume'

type Slot = 'playthrough' | 'original'

const SLOTS: { key: Slot; label: string }[] = [
  { key: 'playthrough', label: '演奏動画' },
  { key: 'original', label: '原曲' },
]

const urlKey = (slot: Slot) => slot === 'playthrough' ? 'playthroughUrl' : 'originalUrl'
const offsetKey = (slot: Slot) => slot === 'playthrough' ? 'playthroughOffsetSec' : 'originalOffsetSec'

/** 再生中にこれ以上ずれたら動画をシークし直す（秒） */
const DRIFT_TOLERANCE_SEC = 0.3
/** シーク直後は動画側の位置が安定しないのでドリフト判定を休む（ミリ秒） */
const SEEK_SETTLE_MS = 1200
/** YouTube側の音量変更を取り込む間隔（ミリ秒） */
const VOLUME_POLL_MS = 1000
/** アプリが音量を設定した直後はgetVolumeが古い値を返すことがあるので取り込みを休む（ミリ秒） */
const VOLUME_SETTLE_MS = 1500

export type PositionListener = (tabSec: number, isSeek: boolean) => void

interface YouTubePanelProps {
  songId: string | null
  /** 譜面（alphaTab）が再生中か */
  isTabPlaying: boolean
  /** 譜面のテンポ（%） */
  tempoPercent: number
  /** 現在の譜面位置（100%テンポ基準の秒） */
  getTabSec: () => number
  subscribePosition: (listener: PositionListener) => () => void
}

export default function YouTubePanel({ songId, isTabPlaying, tempoPercent, getTabSec, subscribePosition }: YouTubePanelProps) {
  const [slot, setSlot] = useState<Slot>('playthrough')
  const [settings, setSettings] = useState<SongMediaSettings>(() => getSongMediaSettings(songId ?? ''))
  const [urlDraft, setUrlDraft] = useState('')
  const [offsetDraft, setOffsetDraft] = useState('0')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [isPlayerReady, setIsPlayerReady] = useState(false)
  const [syncEnabled, setSyncEnabled] = useState(false)

  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YT.Player | null>(null)
  const readyRef = useRef(false)
  const lastSeekAt = useRef(0)
  const lastDriftCheck = useRef(0)

  const url = settings[urlKey(slot)] ?? ''
  const offsetSec = settings[offsetKey(slot)]
  const video = parseYouTubeUrl(url)
  const videoId = video?.videoId ?? null
  const volume = settings.volume ?? 100
  const muted = settings.muted ?? false

  // 最新値をイベントハンドラから参照するためのref
  const syncRef = useRef({ syncEnabled, offsetSec, tempoPercent, playbackRate: settings.playbackRate, isTabPlaying })
  syncRef.current = { syncEnabled, offsetSec, tempoPercent, playbackRate: settings.playbackRate, isTabPlaying }
  // 最新の音量設定（ポーリングやonReadyから参照。変更時は即座に更新して書き込みループを防ぐ）
  const volumeRef = useRef({ volume, muted })
  volumeRef.current = { volume, muted }
  const lastVolumeAppliedAt = useRef(0)

  useEffect(() => {
    const loaded = getSongMediaSettings(songId ?? '')
    setSettings(loaded)
    setSyncEnabled(false)
  }, [songId])

  useEffect(() => {
    setUrlDraft(url)
    setUrlError(null)
  }, [url, slot])

  useEffect(() => {
    setOffsetDraft(String(offsetSec))
  }, [offsetSec, slot])

  const update = useCallback((updates: Partial<SongMediaSettings>) => {
    if (!songId) return
    try {
      setSettings(saveSongMediaSettings(songId, updates))
    } catch (error) {
      console.error('Failed to save media settings:', error)
    }
  }, [songId])

  // プレイヤーの生成・破棄（動画IDが変わったら作り直す）
  useEffect(() => {
    setIsPlayerReady(false)
    setIsVideoPlaying(false)
    readyRef.current = false
    if (!videoId || !hostRef.current) return

    let cancelled = false
    // YT.Playerは渡した要素をiframeに置き換えるため、Reactが管理しない子要素を使う
    const mount = document.createElement('div')
    hostRef.current.appendChild(mount)

    loadYouTubeAPI().then(YTApi => {
      if (cancelled) return
      setApiError(null)
      playerRef.current = new YTApi.Player(mount, {
        videoId,
        playerVars: { playsinline: 1, rel: 0, start: Math.floor(video?.startSec ?? 0) },
        events: {
          onReady: event => {
            if (cancelled) return
            readyRef.current = true
            setIsPlayerReady(true)
            event.target.setPlaybackRate(syncRef.current.playbackRate)
            applyVolume(event.target, volumeRef.current.volume, volumeRef.current.muted)
            lastVolumeAppliedAt.current = performance.now()
          },
          onStateChange: event => {
            if (!cancelled) setIsVideoPlaying(event.data === YTApi.PlayerState.PLAYING)
          },
        },
      })
    }).catch(() => {
      if (!cancelled) setApiError('YouTubeプレイヤーを読み込めませんでした')
    })

    return () => {
      cancelled = true
      readyRef.current = false
      try { playerRef.current?.destroy() } catch { /* 破棄済み */ }
      playerRef.current = null
      mount.remove()
      hostRef.current?.replaceChildren()
    }
    // startSecはURLから決まるのでvideoIdと同時に変わる
  }, [videoId, slot])

  useEffect(() => {
    if (isPlayerReady) playerRef.current?.setPlaybackRate(settings.playbackRate)
  }, [settings.playbackRate, isPlayerReady])

  // 音量・ミュートをプレイヤーに反映
  useEffect(() => {
    if (!isPlayerReady || !playerRef.current) return
    applyVolume(playerRef.current, volume, muted)
    lastVolumeAppliedAt.current = performance.now()
  }, [volume, muted, isPlayerReady])

  // YouTube側のコントロールで変更された音量を取り込む
  useEffect(() => {
    if (!isPlayerReady || !songId) return
    const id = window.setInterval(() => {
      const player = playerRef.current
      if (!readyRef.current || !player) return
      if (performance.now() - lastVolumeAppliedAt.current < VOLUME_SETTLE_MS) return
      const r = readPlayerVolume(player)
      if (!r) return
      const latest = volumeRef.current
      if (r.volume !== latest.volume || r.muted !== latest.muted) {
        volumeRef.current = r
        update({ volume: r.volume, muted: r.muted })
      }
    }, VOLUME_POLL_MS)
    return () => window.clearInterval(id)
  }, [isPlayerReady, songId, update])

  const handleVolumeChange = (v: number) => {
    const nextMuted = muted && v === 0 ? true : false
    volumeRef.current = { volume: v, muted: nextMuted }
    update({ volume: v, muted: nextMuted })
  }

  const handleToggleMute = () => {
    volumeRef.current = { volume, muted: !muted }
    update({ muted: !muted })
  }

  const expectedVideoSec = useCallback((tabSec: number) => {
    const { offsetSec, tempoPercent, playbackRate } = syncRef.current
    try {
      return tabToVideoTime(tabSec, { offsetSec, tempoPercent, playbackRate })
    } catch {
      return null
    }
  }, [])

  const seekVideo = useCallback((sec: number) => {
    const player = playerRef.current
    if (!player || !readyRef.current) return
    player.seekTo(Math.max(0, sec), true)
    lastSeekAt.current = performance.now()
  }, [])

  /** 譜面位置に動画を合わせる。force=trueならしきい値に関係なくシークする */
  const alignVideo = useCallback((tabSec: number, force: boolean) => {
    const player = playerRef.current
    if (!player || !readyRef.current || !syncRef.current.syncEnabled) return
    const expected = expectedVideoSec(tabSec)
    if (expected === null) return
    const playing = syncRef.current.isTabPlaying
    const state = player.getPlayerState()

    if (expected < 0) {
      // 動画の開始前（プリロール）：0秒で待機し、到達したら再生を始める
      if (state === YT.PlayerState.PLAYING) player.pauseVideo()
      if (force) seekVideo(0)
      return
    }
    const duration = player.getDuration()
    if (duration > 0 && expected >= duration) {
      if (state === YT.PlayerState.PLAYING) player.pauseVideo()
      return
    }
    const drift = Math.abs(player.getCurrentTime() - expected)
    const settling = performance.now() - lastSeekAt.current < SEEK_SETTLE_MS
    if (force || (!settling && drift > DRIFT_TOLERANCE_SEC)) seekVideo(expected)
    if (playing && state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.BUFFERING) player.playVideo()
    if (!playing && state === YT.PlayerState.PLAYING) player.pauseVideo()
  }, [expectedVideoSec, seekVideo])

  // 譜面の再生・一時停止に追従
  useEffect(() => {
    if (!syncEnabled || !isPlayerReady) return
    const player = playerRef.current
    if (!player) return
    if (!isTabPlaying) player.pauseVideo()
    alignVideo(getTabSec(), true)
  }, [isTabPlaying, syncEnabled, isPlayerReady, alignVideo, getTabSec])

  // テンポ・速度・オフセットが変わったら位置を合わせ直す
  useEffect(() => {
    if (syncEnabled && isPlayerReady) alignVideo(getTabSec(), true)
  }, [tempoPercent, settings.playbackRate, offsetSec, syncEnabled, isPlayerReady, alignVideo, getTabSec])

  // 譜面の位置変化（シーク・ループ・ドリフト）に追従
  useEffect(() => subscribePosition((tabSec, isSeek) => {
    if (!syncRef.current.syncEnabled) return
    const now = performance.now()
    if (!isSeek && now - lastDriftCheck.current < 500) return
    lastDriftCheck.current = now
    alignVideo(tabSec, isSeek)
  }), [subscribePosition, alignVideo])

  const handleSaveUrl = () => {
    const trimmed = urlDraft.trim()
    if (!trimmed) {
      update({ [urlKey(slot)]: undefined })
      return
    }
    const parsed = parseYouTubeUrl(trimmed)
    if (!parsed) {
      setUrlError('YouTubeのURLを認識できませんでした')
      return
    }
    setUrlError(null)
    const updates: Partial<SongMediaSettings> = { [urlKey(slot)]: trimmed }
    // URLに開始時刻(t=)があり、まだオフセット未設定ならそれを1拍目とみなす
    if (parsed.startSec > 0 && offsetSec === 0) updates[offsetKey(slot)] = parsed.startSec
    update(updates)
  }

  const handleVideoPlayPause = () => {
    const player = playerRef.current
    if (!player || !readyRef.current) return
    if (isVideoPlaying) player.pauseVideo()
    else player.playVideo()
  }

  const handleSetOffsetHere = () => {
    const player = playerRef.current
    if (!player || !readyRef.current) return
    update({ [offsetKey(slot)]: Math.round(player.getCurrentTime() * 100) / 100 })
  }

  const commitOffset = () => {
    const n = Number(offsetDraft)
    if (offsetDraft.trim() !== '' && Number.isFinite(n)) update({ [offsetKey(slot)]: n })
    else setOffsetDraft(String(offsetSec))
  }

  const handleMatchTempo = () => {
    const rate = Math.min(1.25, Math.max(0.5, Math.round(tempoPercent / 5) / 20))
    update({ playbackRate: rate })
  }

  const disabled = !songId
  const rateMismatch = syncEnabled && Math.abs(settings.playbackRate - tempoPercent / 100) > 0.001

  return (
    <div className="youtube-panel">
      <div className="youtube-tabs">
        {SLOTS.map(s => (
          <button
            key={s.key}
            className={`youtube-tab ${slot === s.key ? 'active' : ''}`}
            onClick={() => setSlot(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {disabled ? (
        <div className="info-text">
          「曲の管理」から保存済みの曲を開くと、曲ごとにYouTube動画を設定できます。
        </div>
      ) : (
        <>
          <div className="youtube-url-row">
            <input
              type="text"
              className="text-input"
              placeholder="YouTubeのURLを貼り付け"
              value={urlDraft}
              onChange={e => setUrlDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSaveUrl() }}
            />
            <button className="button button-secondary button-small" onClick={handleSaveUrl}>
              保存
            </button>
          </div>
          {urlError && <div className="field-error">{urlError}</div>}
          {apiError && <div className="field-error">{apiError}</div>}

          <div className="youtube-player">
            <div ref={hostRef} className="youtube-player-host" />
            {!videoId && (
              <div className="youtube-placeholder">
                {SLOTS.find(s => s.key === slot)?.label}のURLが未設定です
              </div>
            )}
          </div>

          <div className="youtube-controls">
            <button
              className="button button-primary button-small"
              onClick={handleVideoPlayPause}
              disabled={!isPlayerReady}
            >
              {isVideoPlaying ? '⏸ 一時停止' : '▶ 再生'}
            </button>
            <button
              className={`button ${syncEnabled ? 'button-primary' : 'button-secondary'} button-small`}
              onClick={() => setSyncEnabled(!syncEnabled)}
              disabled={!isPlayerReady}
              aria-pressed={syncEnabled}
            >
              🔗 譜面と一緒に再生{syncEnabled ? '：オン' : '：オフ'}
            </button>
          </div>

          <div className="slider-container">
            <div className="slider-label">
              <span>動画の速度</span>
              <span>{settings.playbackRate.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="1.25"
              step="0.05"
              value={settings.playbackRate}
              onChange={e => update({ playbackRate: Number(e.target.value) })}
              className="slider"
            />
            {rateMismatch && (
              <div className="youtube-hint">
                譜面のテンポ({tempoPercent}%)と動画の速度が異なるため、再生中に少しずつずれます。
                <button className="link-button" onClick={handleMatchTempo}>テンポに合わせる</button>
              </div>
            )}
          </div>

          <div className="slider-container">
            <div className="slider-label">
              <span>動画の音量</span>
              <span className="youtube-volume-value">
                <span>{muted ? 'ミュート' : `${volume}%`}</span>
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={handleToggleMute}
                  aria-pressed={muted}
                  aria-label={muted ? 'ミュート解除' : 'ミュート'}
                >
                  {muted ? '🔇' : '🔊'}
                </button>
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={volume}
              onChange={e => handleVolumeChange(Number(e.target.value))}
              aria-label="動画の音量"
              className="slider"
            />
          </div>

          <div className="youtube-offset-row">
            <label className="slider-label" htmlFor="youtube-offset">
              <span>オフセット（1拍目の位置・秒）</span>
            </label>
            <div className="youtube-url-row">
              <input
                id="youtube-offset"
                type="number"
                step="0.1"
                className="text-input"
                value={offsetDraft}
                onChange={e => setOffsetDraft(e.target.value)}
                onBlur={commitOffset}
                onKeyDown={e => { if (e.key === 'Enter') commitOffset() }}
              />
              <button
                className="button button-secondary button-small"
                onClick={handleSetOffsetHere}
                disabled={!isPlayerReady}
              >
                今の位置を1拍目に設定
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
