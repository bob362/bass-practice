import { useCallback, useEffect, useRef, useState } from 'react'
import { loadYouTubeAPI, parseYouTubeUrl } from '../utils/youtube'
import { tabToVideoTime, videoToTabTime } from '../utils/sync'
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
/** アプリが動画を操作した直後に届くYouTubeのイベントは自分の操作の結果とみなして無視する（ミリ秒） */
const COMMAND_SETTLE_MS = 1000
/** 動画側のシーク（YouTubeのシークバー操作など）を検出する間隔（ミリ秒） */
const SEEK_POLL_MS = 250
/** 予測位置からこれ以上飛んだらユーザーが動画をシークしたとみなす（秒） */
const SEEK_DETECT_SEC = 1.0

type CommandKind = 'play' | 'pause' | 'seek' | 'rate'

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
  /** 譜面を再生する（動画側の操作に譜面を追従させる） */
  playTab?: () => void
  /** 譜面を一時停止する */
  pauseTab?: () => void
  /** 譜面を指定位置（100%テンポ基準の秒）にシークする */
  seekTab?: (tabSec: number) => void
}

export default function YouTubePanel({ songId, isTabPlaying, tempoPercent, getTabSec, subscribePosition, playTab, pauseTab, seekTab }: YouTubePanelProps) {
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
  /** アプリが最後に動画へ出した命令（種類ごとの時刻と、最後の命令） */
  const commandAt = useRef<Record<CommandKind, number>>({ play: -Infinity, pause: -Infinity, seek: -Infinity, rate: -Infinity })
  const lastCommand = useRef<{ kind: CommandKind; at: number } | null>(null)
  /** 動画シーク検出用の基準サンプル */
  const seekBaseline = useRef<{ videoSec: number; at: number; playing: boolean } | null>(null)

  const url = settings[urlKey(slot)] ?? ''
  const offsetSec = settings[offsetKey(slot)]
  const video = parseYouTubeUrl(url)
  const videoId = video?.videoId ?? null
  const volume = settings.volume ?? 100
  const muted = settings.muted ?? false

  // 最新値をイベントハンドラから参照するためのref
  const syncRef = useRef({ syncEnabled, offsetSec, tempoPercent, playbackRate: settings.playbackRate, isTabPlaying })
  syncRef.current = { syncEnabled, offsetSec, tempoPercent, playbackRate: settings.playbackRate, isTabPlaying }
  // 譜面操作用のコールバック（プレイヤーのイベントハンドラは1度しか作られないのでrefで最新を参照）
  const tabRef = useRef({ playTab, pauseTab, seekTab, getTabSec })
  tabRef.current = { playTab, pauseTab, seekTab, getTabSec }
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
  // プレイヤーのイベントハンドラから最新のupdateを呼ぶためのref
  const updateRef = useRef(update)
  updateRef.current = update

  /** アプリからの命令を記録する（直後のYouTubeイベントを自分の操作として無視するため） */
  const markCommand = useCallback((kind: CommandKind) => {
    const at = performance.now()
    commandAt.current[kind] = at
    lastCommand.current = { kind, at }
  }, [])

  const withinCommand = useCallback((kind?: CommandKind) => {
    const at = kind ? commandAt.current[kind] : (lastCommand.current?.at ?? -Infinity)
    return performance.now() - at < COMMAND_SETTLE_MS
  }, [])

  const commandPlay = useCallback((player: YT.Player) => {
    markCommand('play')
    player.playVideo()
  }, [markCommand])

  const commandPause = useCallback((player: YT.Player) => {
    markCommand('pause')
    player.pauseVideo()
  }, [markCommand])

  const commandRate = useCallback((player: YT.Player, rate: number) => {
    markCommand('rate')
    player.setPlaybackRate(rate)
  }, [markCommand])

  /** 動画位置（秒）を譜面位置（100%テンポ基準の秒、0以上）に変換する */
  const videoToTabSec = useCallback((videoSec: number) => {
    const { offsetSec, tempoPercent, playbackRate } = syncRef.current
    try {
      return Math.max(0, videoToTabTime(videoSec, { offsetSec, tempoPercent, playbackRate }))
    } catch {
      return null
    }
  }, [])

  /** 譜面位置を今の動画位置に合わせる（ずれが小さければ何もしない） */
  const syncTabToVideo = useCallback((player: YT.Player) => {
    const { seekTab, getTabSec } = tabRef.current
    if (!seekTab) return
    let videoSec: number
    try { videoSec = player.getCurrentTime() } catch { return }
    const tabSec = videoToTabSec(videoSec)
    if (tabSec === null) return
    const currentTab = getTabSec()
    // 譜面位置から見た動画の位置（動画の範囲内に収める）。プリロールや動画終了後で
    // 動画が端に止まっているだけなら、譜面は動かさない
    const { offsetSec, tempoPercent, playbackRate } = syncRef.current
    let expected: number | null = null
    try { expected = tabToVideoTime(currentTab, { offsetSec, tempoPercent, playbackRate }) } catch { /* 無効な設定 */ }
    if (expected !== null) {
      let duration = 0
      try { duration = player.getDuration() } catch { /* 未取得 */ }
      const clamped = Math.max(0, duration > 0 ? Math.min(expected, duration) : expected)
      if (Math.abs(clamped - videoSec) <= DRIFT_TOLERANCE_SEC) return
    }
    if (Math.abs(tabSec - currentTab) > DRIFT_TOLERANCE_SEC) seekTab(tabSec)
  }, [videoToTabSec])

  /**
   * ユーザーが動画をシークしたかを調べ、そうなら譜面をその位置へシークする。
   * 処理した場合はtrueを返す。基準サンプルは毎回更新する
   */
  const checkVideoSeek = useCallback((): boolean => {
    const player = playerRef.current
    if (!player || !readyRef.current || !syncRef.current.syncEnabled) return false
    let actual: number
    let playing: boolean
    try {
      actual = player.getCurrentTime()
      playing = player.getPlayerState() === YT.PlayerState.PLAYING
    } catch {
      return false
    }
    const now = performance.now()
    const baseline = seekBaseline.current
    seekBaseline.current = { videoSec: actual, at: now, playing }
    if (!baseline || !Number.isFinite(actual)) return false
    const elapsedSec = (now - baseline.at) / 1000
    const predicted = baseline.videoSec + (baseline.playing ? elapsedSec * syncRef.current.playbackRate : 0)
    if (Math.abs(actual - predicted) <= SEEK_DETECT_SEC) return false
    if (now - lastSeekAt.current < SEEK_SETTLE_MS || withinCommand()) return false
    const { seekTab } = tabRef.current
    if (!seekTab) return false
    const tabSec = videoToTabSec(actual)
    if (tabSec === null) return false
    // 譜面のシークイベントで動画が合わせ直される
    seekTab(tabSec)
    return true
  }, [videoToTabSec, withinCommand])

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
            commandRate(event.target, syncRef.current.playbackRate)
            applyVolume(event.target, volumeRef.current.volume, volumeRef.current.muted)
            lastVolumeAppliedAt.current = performance.now()
          },
          onStateChange: event => {
            if (cancelled) return
            setIsVideoPlaying(event.data === YTApi.PlayerState.PLAYING)
            const { syncEnabled, isTabPlaying } = syncRef.current
            const player = playerRef.current
            if (!syncEnabled || !readyRef.current || !player) return
            const { playTab, pauseTab } = tabRef.current
            if (event.data === YTApi.PlayerState.PLAYING) {
              // ユーザーが動画を再生した：譜面を動画の位置に合わせて再生
              if (isTabPlaying || withinCommand('play') || !playTab) return
              syncTabToVideo(player)
              playTab()
            } else if (event.data === YTApi.PlayerState.PAUSED) {
              // ユーザーが動画を一時停止した。プリロールや動画終了でアプリが止めた場合は譜面を止めない
              if (!isTabPlaying || withinCommand('pause') || !pauseTab) return
              pauseTab()
            }
            // BUFFERING / ENDED / CUED / UNSTARTED は無視
          },
          onPlaybackRateChange: event => {
            if (cancelled) return
            seekBaseline.current = null
            if (!syncRef.current.syncEnabled || !readyRef.current) return
            const rate = Number(event.data)
            if (!Number.isFinite(rate) || Math.abs(rate - syncRef.current.playbackRate) <= 0.001) return
            if (withinCommand('rate')) return
            // YouTube側で速度が変わった：設定に取り込み、既存の処理で位置を合わせ直す
            updateRef.current({ playbackRate: rate })
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
    if (isPlayerReady && playerRef.current) commandRate(playerRef.current, settings.playbackRate)
  }, [settings.playbackRate, isPlayerReady, commandRate])

  // 動画側のシーク（YouTubeのシークバー操作など）を検出して譜面を追従させる
  useEffect(() => {
    seekBaseline.current = null
    if (!syncEnabled || !isPlayerReady) return
    const id = window.setInterval(() => { checkVideoSeek() }, SEEK_POLL_MS)
    return () => {
      window.clearInterval(id)
      seekBaseline.current = null
    }
  }, [syncEnabled, isPlayerReady, checkVideoSeek])

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
    markCommand('seek')
    player.seekTo(Math.max(0, sec), true)
    lastSeekAt.current = performance.now()
    seekBaseline.current = null
  }, [markCommand])

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
      if (state === YT.PlayerState.PLAYING) commandPause(player)
      if (force) seekVideo(0)
      return
    }
    const duration = player.getDuration()
    if (duration > 0 && expected >= duration) {
      if (state === YT.PlayerState.PLAYING) commandPause(player)
      return
    }
    // ユーザーが動画をシークした直後なら、動画を引き戻さず譜面側を合わせる
    if (!force && checkVideoSeek()) return
    const drift = Math.abs(player.getCurrentTime() - expected)
    const settling = performance.now() - lastSeekAt.current < SEEK_SETTLE_MS
    if (force || (!settling && drift > DRIFT_TOLERANCE_SEC)) seekVideo(expected)
    if (playing && state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.BUFFERING) commandPlay(player)
    if (!playing && state === YT.PlayerState.PLAYING) commandPause(player)
  }, [expectedVideoSec, seekVideo, checkVideoSeek, commandPlay, commandPause])

  // 譜面の再生・一時停止に追従
  useEffect(() => {
    if (!syncEnabled || !isPlayerReady) return
    const player = playerRef.current
    if (!player) return
    if (!isTabPlaying) commandPause(player)
    alignVideo(getTabSec(), true)
  }, [isTabPlaying, syncEnabled, isPlayerReady, alignVideo, getTabSec, commandPause])

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
    if (syncEnabled && playTab && pauseTab) {
      // 同期中は譜面を操作し、動画は既存の追従処理に任せる
      if (isTabPlaying) {
        pauseTab()
      } else {
        syncTabToVideo(player)
        playTab()
      }
      return
    }
    if (isVideoPlaying) commandPause(player)
    else commandPlay(player)
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
