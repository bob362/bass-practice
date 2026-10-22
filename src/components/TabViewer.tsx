import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { base64ToPdfBlob } from '../utils/storage'
import { configurePdfjsWorker, pdfDocumentParams } from '../utils/pdfjsConfig'
import { listSections, updateSectionTempo, upsertSection } from '../utils/progress'
import type { PracticeSection } from '../utils/progress'
import { usePracticeTimer } from '../hooks/usePracticeTimer'
import YouTubePanel from './YouTubePanel'
import { applyAlphaTabMix } from '../utils/mixer'
import type { AlphaTabMix } from '../utils/mixer'
import type { PositionListener } from './YouTubePanel'
import SectionPanel from './SectionPanel'
import type { BarRange } from './SectionPanel'
import InputCheckPanel from './InputCheckPanel'
import type { JudgeRange } from './InputCheckPanel'
import SimplifyPanel from './SimplifyPanel'
import type { SimplifyResult } from './SimplifyPanel'
import { extractPlainScore } from '../utils/scoreModel'
import type { PlainScore } from '../utils/scoreModel'
import { getPlayPauseKeyAction, isPlainButtonTarget, rewindToStart } from '../utils/playbackKeys'
import {
  VIEW_MODES,
  VIEW_MODE_LABELS,
  applyViewModeToSettings,
  loadViewMode,
  prepareBassScoreForNotation,
  saveViewMode,
} from '../utils/viewMode'
import type { ViewMode } from '../utils/viewMode'
import { enhanceTabRhythmDots } from './tabRhythmDots'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { MOBILE_MEDIA_QUERY, TEMPO_MAX, TEMPO_MIN, TEMPO_STEP, scoreScaleForWidth, stepTempo } from '../utils/mobile'
import { installAudioUnlock, preferPlaybackAudioSession } from '../utils/audioUnlock'

// alphaTabのグローバルインポート
declare global {
  interface Window {
    alphaTab: any
  }
}

configurePdfjsWorker()

interface TabViewerProps {
  filePath: string | ArrayBuffer
  pdfData?: string | null
  /** 保存済みの曲を開いている場合のID（進捗・動画設定の保存先） */
  songId?: string | null
  onFileImport: (event: React.ChangeEvent<HTMLInputElement>) => void
}

/** ループ1周を「通し」とみなすA地点からのずれの許容量（tick） */
const PASS_START_TOLERANCE_TICKS = 480

function formatElapsed(sec: number): string {
  const total = Math.floor(sec)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** tickを含む小節番号（1始まり） */
function tickToBar(api: any, tick: number): number | null {
  const bars: any[] | undefined = api?.score?.masterBars
  if (!bars?.length) return null
  let index = 0
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].start <= tick) index = i
    else break
  }
  return index + 1
}

/** CDNから読み込むalphaTabのバージョン（package.jsonと揃える。@latestは使わない） */
const ALPHATAB_VERSION = '1.8.4'

/** スマホ表示のボトムシートのタブ */
type SheetTab = 'video' | 'settings'
const SHEET_TABS: { key: SheetTab; label: string }[] = [
  { key: 'video', label: '動画・同期' },
  { key: 'settings', label: '設定' },
]
const SHEET_ID = 'mobile-sheet'
const sheetPaneId = (tab: SheetTab) => `mobile-sheet-pane-${tab}`
const sheetTabId = (tab: SheetTab) => `mobile-sheet-tab-${tab}`

const FOCUSABLE_SELECTOR = 'button, input, select, textarea, a[href], [tabindex]'

/** 要素内でキーボードでフォーカスできる要素（DOM順） */
function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(el => {
    if (el.tabIndex < 0 || (el as HTMLButtonElement).disabled || el.closest('[hidden]')) return false
    return !(el instanceof HTMLInputElement && (el.type === 'hidden' || el.type === 'file'))
  })
}
const firstFocusable = (root: HTMLElement): HTMLElement | null => focusables(root)[0] ?? null
const lastFocusable = (root: HTMLElement): HTMLElement | null => {
  const list = focusables(root)
  return list[list.length - 1] ?? null
}

/** 現在の画面幅に合った譜面の拡大率 */
function currentScoreScale(): number {
  return scoreScaleForWidth(typeof window === 'undefined' ? 1024 : window.innerWidth)
}

/** 曲データ（URL・alphaTex文字列・バイナリ）をalphaTabに読み込む */
function loadSource(api: any, source: string | ArrayBuffer) {
  if (typeof source === 'string') {
    // 文字列の場合、URLかtexデータか判定
    if (source.startsWith('/') || source.startsWith('http')) {
      api.load(source)
    } else {
      api.tex(source)
    }
  } else {
    // alphaTabはバッファをワーカーへ転送（detach）することがあるため、毎回コピーを渡す。
    // StrictModeの再マウントや「原曲に戻す」で同じArrayBufferを再利用しても読み込めるようにする。
    api.load(new Uint8Array(source.slice(0)))
  }
}

function barToTicks(api: any, startBar: number, endBar: number): { start: number; end: number } | null {
  const bars: any[] | undefined = api?.score?.masterBars
  if (!bars?.length) return null
  const first = bars[Math.min(startBar, bars.length) - 1]
  const last = bars[Math.min(endBar, bars.length) - 1]
  return { start: first.start, end: last.start + last.calculateDuration() }
}

export default function TabViewer({ filePath, pdfData, songId = null, onFileImport }: TabViewerProps) {
  const viewerRef = useRef<HTMLDivElement>(null)
  /** 実際にスクロールする外側のコンテナ（alphaTabの描画先とは分ける） */
  const scrollRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<any>(null)
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const isReadyRef = useRef(isReady)
  isReadyRef.current = isReady
  const [tempo, setTempo] = useState(100)
  const [loopStart, setLoopStart] = useState<number | null>(null)
  const [loopEnd, setLoopEnd] = useState<number | null>(null)
  const [isLooping, setIsLooping] = useState(false)
  const [showPdf, setShowPdf] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [barCount, setBarCount] = useState(0)
  const [sections, setSections] = useState<PracticeSection[]>([])
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
  /** 読み込んだ原曲の譜面（簡単アレンジは常にここから作る） */
  const [originalScore, setOriginalScore] = useState<PlainScore | null>(null)
  /** 現在表示・再生している譜面（簡単アレンジ適用後を含む） */
  const [displayedScore, setDisplayedScore] = useState<PlainScore | null>(null)
  const [simplified, setSimplified] = useState<SimplifyResult | null>(null)
  /** 譜面の表示モード（全曲共通で保存） */
  const [viewMode, setViewMode] = useState<ViewMode>(() => loadViewMode())

  const timer = usePracticeTimer(songId, isPlaying)

  // スマホ表示（下部の再生バーとボトムシート）
  const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetTab, setSheetTab] = useState<SheetTab>('video')
  const sheetToggleRef = useRef<HTMLButtonElement>(null)
  const sheetTabsRef = useRef<HTMLDivElement>(null)

  // PC表示に戻ったらシートは閉じておく
  useEffect(() => {
    if (!isMobile) setSheetOpen(false)
  }, [isMobile])

  const closeSheet = useCallback(() => {
    setSheetOpen(false)
    sheetToggleRef.current?.focus()
  }, [])

  // 開いたら選択中のタブへフォーカス、Escapeで閉じる
  useEffect(() => {
    if (!sheetOpen) return
    sheetTabsRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return
      e.preventDefault()
      closeSheet()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [sheetOpen, closeSheet])

  // 矢印キーでシートのタブを移動。Tabで表示中のパネルの中へ（パネルはDOM上タブより前にあるため）
  const handleSheetTabKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>, tab: SheetTab) => {
    if (e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const pane = document.getElementById(sheetPaneId(tab))
      if (!pane) return
      e.preventDefault()
      ;(firstFocusable(pane) ?? pane).focus()
      return
    }
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const index = SHEET_TABS.findIndex(t => t.key === tab)
    const next = SHEET_TABS[(index + delta + SHEET_TABS.length) % SHEET_TABS.length].key
    setSheetTab(next)
    document.getElementById(sheetTabId(next))?.focus()
  }, [])

  // パネルの先頭（またはパネル自体）でShift+Tabなら選択中のタブへ、
  // 末尾（またはパネル自体）でTabなら閉じるボタンへ（タブへ戻るとループするため）
  const handleSheetPaneKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return
    const pane = e.currentTarget
    const target = e.target as HTMLElement
    if (e.shiftKey) {
      if (target !== pane && target !== firstFocusable(pane)) return
      e.preventDefault()
      document.getElementById(sheetTabId(sheetTabRef.current))?.focus()
      return
    }
    if (target !== pane && target !== lastFocusable(pane)) return
    if (!sheetCloseRef.current) return
    e.preventDefault()
    sheetCloseRef.current.focus()
  }, [])

  // 閉じるボタンでShift+Tabなら表示中のパネルの末尾へ戻す
  const handleSheetCloseKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'Tab' || !e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return
    const pane = document.getElementById(sheetPaneId(sheetTabRef.current))
    if (!pane) return
    e.preventDefault()
    ;(lastFocusable(pane) ?? pane).focus()
  }, [])
  const sheetCloseRef = useRef<HTMLButtonElement>(null)
  const sheetTabRef = useRef(sheetTab)
  sheetTabRef.current = sheetTab

  /** シート内の各パネル（PCでは影響しない属性） */
  const sheetPaneProps = (tab: SheetTab) => isMobile ? {
    id: sheetPaneId(tab),
    role: 'tabpanel',
    tabIndex: -1,
    onKeyDown: handleSheetPaneKeyDown,
    'aria-labelledby': sheetTabId(tab),
    'data-sheet-open': sheetOpen ? 'true' : 'false',
    'data-sheet-active': sheetTab === tab ? 'true' : 'false',
  } : {}

  // iOSで最初のタップ時に音声を有効化する
  useEffect(() => {
    preferPlaybackAudioSession()
    return installAudioUnlock(() => apiRef.current)
  }, [])

  // 表示モードの切り替え。曲の再読み込みや再生停止はせず、現在の譜面を描き直すだけにする
  // （カーソル・ループ・動画同期・簡単アレンジはそのまま維持される）
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode)
    saveViewMode(mode)
    const api = apiRef.current
    if (!api) return
    applyViewModeToSettings(api.settings, mode)
    api.updateSettings()
    api.render()
  }, [])

  // 矢印キーで表示モードを移動（radiogroupの標準的なキーボード操作）
  const handleViewModeKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>, mode: ViewMode) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const index = VIEW_MODES.indexOf(mode)
    const next = VIEW_MODES[(index + delta + VIEW_MODES.length) % VIEW_MODES.length]
    handleViewModeChange(next)
    const group = e.currentTarget.parentElement
    group?.querySelector<HTMLButtonElement>(`[data-view-mode="${next}"]`)?.focus()
  }, [handleViewModeChange])

  // alphaTabのイベントハンドラは読み込み時に一度だけ登録されるため、最新値はrefで参照する
  const loopRef = useRef({ loopStart, loopEnd, isLooping })
  loopRef.current = { loopStart, loopEnd, isLooping }
  const tempoRef = useRef(tempo)
  tempoRef.current = tempo
  const songIdRef = useRef(songId)
  songIdRef.current = songId
  const sectionsRef = useRef(sections)
  sectionsRef.current = sections
  const activeSectionRef = useRef(activeSectionId)
  activeSectionRef.current = activeSectionId
  const viewModeRef = useRef(viewMode)
  viewModeRef.current = viewMode

  // TAB+リズム表示では、描画された SVG が DOM に入るたびに付点を見やすく補正する
  useEffect(() => {
    const host = viewerRef.current
    if (!host || typeof MutationObserver === 'undefined') return
    let frame = 0
    const run = () => {
      frame = 0
      if (viewModeRef.current === 'tab-rhythm') enhanceTabRhythmDots(host)
    }
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(run)
    })
    observer.observe(host, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])
  /** 現在のループ周回の開始tickと、その周回中の最低テンポ */
  const passRef = useRef<{ startTick: number; minTempo: number } | null>(null)
  const positionListeners = useRef(new Set<PositionListener>())
  const loopPassListeners = useRef(new Set<() => void>())
  /** 次に読み込まれる譜面が簡単アレンジか（trueなら原曲のキャッシュを上書きしない） */
  const loadingSimplifiedRef = useRef(false)

  const refreshSections = useCallback(() => {
    setSections(songId ? listSections(songId) : [])
  }, [songId])

  useEffect(() => {
    refreshSections()
    setActiveSectionId(null)
  }, [refreshSections])

  const subscribePosition = useCallback((listener: PositionListener) => {
    positionListeners.current.add(listener)
    return () => { positionListeners.current.delete(listener) }
  }, [])

  const subscribeLoopPass = useCallback((listener: () => void) => {
    loopPassListeners.current.add(listener)
    return () => { loopPassListeners.current.delete(listener) }
  }, [])

  /** 100%テンポ基準の譜面位置（秒）。alphaTabのtimePositionは再生速度で伸縮済み */
  const getTabSec = useCallback(() => {
    const api = apiRef.current
    if (!api) return 0
    return (api.timePosition ?? 0) * (api.playbackSpeed ?? 1) / 1000
  }, [])

  /** 動画側の操作から譜面を再生・一時停止・シーク・テンポ変更する（YouTube同期用） */
  const playTab = useCallback(() => {
    apiRef.current?.play()
  }, [])

  const pauseTab = useCallback(() => {
    apiRef.current?.pause()
  }, [])

  /** tabSecは100%テンポ基準の秒（getTabSecの逆変換）。alphaTabのtimePositionは再生速度で伸縮した値 */
  const seekTab = useCallback((tabSec: number) => {
    const api = apiRef.current
    if (!api || !Number.isFinite(tabSec)) return
    api.timePosition = Math.max(0, tabSec) * 1000 / (api.playbackSpeed || 1)
  }, [])

  /**
   * 譜面の音量バランス（マスター・ベース・その他のトラック）を反映する。
   * 音量0でもプレイヤーは動かしたままなのでカーソル・同期は維持される
   */
  const mixRef = useRef<AlphaTabMix>({ master: 1, bass: 1, other: 1 })
  const setTabMix = useCallback((mix: AlphaTabMix) => {
    mixRef.current = mix
    if (apiRef.current) applyAlphaTabMix(apiRef.current, mix)
  }, [])

  const startPass = (startTick: number) => {
    passRef.current = { startTick, minTempo: tempoRef.current }
  }

  /** ループが1周したとき、該当セクションの最高テンポを更新する */
  const recordLoopPass = () => {
    const api = apiRef.current
    const id = songIdRef.current
    const pass = passRef.current
    const { loopStart: start, loopEnd: end } = loopRef.current
    if (!api || !id || !pass || start === null || end === null) return
    if (pass.startTick > start + PASS_START_TOLERANCE_TICKS) return
    const startBar = tickToBar(api, start)
    const endBar = tickToBar(api, Math.max(start, end - 1))
    const targets = sectionsRef.current.filter(s =>
      s.id === activeSectionRef.current || (s.startBar === startBar && s.endBar === endBar))
    if (!targets.length) return
    try {
      for (const section of targets) {
        const updated = updateSectionTempo(id, section.id, pass.minTempo)
        if (updated && updated.status === 'not_started') upsertSection({ ...updated, status: 'practicing' })
      }
      setSections(listSections(id))
    } catch (error) {
      console.error('Failed to update section tempo:', error)
    }
  }
  const recordLoopPassRef = useRef(recordLoopPass)
  recordLoopPassRef.current = recordLoopPass

  useEffect(() => {
    if (!viewerRef.current) return

    setIsReady(false)
    setLoadError(null)
    setLoopStart(null)
    setLoopEnd(null)
    setIsLooping(false)
    setBarCount(0)
    setOriginalScore(null)
    setDisplayedScore(null)
    setSimplified(null)
    loadingSimplifiedRef.current = false

    // StrictModeの二重実行などでスクリプト読み込み中にアンマウントされた場合、APIを生成しない
    let cancelled = false

    const loadAlphaTab = async () => {
      // alphaTabのCDNからロード
      if (!window.alphaTab) {
        const script = document.createElement('script')
        script.src = `https://cdn.jsdelivr.net/npm/@coderline/alphatab@${ALPHATAB_VERSION}/dist/alphaTab.js`
        script.async = true
        
        await new Promise<void>((resolve) => {
          script.onload = () => resolve()
          document.head.appendChild(script)
        })

      }

      if (cancelled || !viewerRef.current) return

      // alphaTab APIの初期化
      const api = new window.alphaTab.AlphaTabApi(viewerRef.current, {
        core: {
          logLevel: 1,
          fontDirectory: `https://cdn.jsdelivr.net/npm/@coderline/alphatab@${ALPHATAB_VERSION}/dist/font/`,
          enableLazyLoading: false,
        },
        display: {
          layoutMode: 'page',
          // staveProfile / rhythmMode は表示モードに応じて applyViewModeToSettings で設定する
          // 画面幅に合わせる（PCは DESKTOP_SCORE_SCALE）
          scale: currentScoreScale(),
          resources: {
            staffLineColor: '#3a3a3a',
            barSeparatorColor: '#3a3a3a',
            mainGlyphColor: '#f2f2f2',
            secondaryGlyphColor: '#c8c8c8',
            scoreInfoColor: '#ccc',
            barNumberColor: '#e07070',
            // barNumberFont は設定 JSON からは読まれない（1.8.4 のシリアライザに項目がない）ため、
            // NotationElement.BarNumber のフォントとして渡す（キーは列挙名、値は CSS の font 文字列）
            elementFonts: { barNumber: 'bold 12px Arial, sans-serif' },
            // 値は px（display.scale 前）。alphaTab は連桁を「太さ＋間隔」ずつずらして重ねるため、
            // 暗い背景でも 8分/16分/32分の本数が数えられるよう、間隔を太さより広めに取る
            engravingSettings: {
              beamThickness: 3.2,
              beamSpacing: 4.4,
              stemThickness: 1.6,
              brokenBeamWidth: 12,
              tupletBracketThickness: 1.6,
            },
          }
        },
        notation: {
          elements: {
            scoreTitle: true,
            scoreSubTitle: true,
            scoreArtist: true,
            scoreAlbum: false,
            scoreWords: false,
            scoreMusic: false,
            scoreCopyright: false,
            guitarTuning: true,
          }
        },
        player: {
          enablePlayer: true,
          enableCursor: true,
          enableUserInteraction: true,
          soundFont: `https://cdn.jsdelivr.net/npm/@coderline/alphatab@${ALPHATAB_VERSION}/dist/soundfont/sonivox.sf2`,
          // 描画先そのものをscrollElementにするとalphaTabのスクロール位置計算がずれ、
          // 再生開始直後に末尾まで飛んでカーソルが画面外に出てしまう。外側のスクロールコンテナを渡す。
          scrollElement: scrollRef.current ?? viewerRef.current,
          scrollMode: 'continuous',
          // カーソルが上端に張り付かないよう、表示領域の約1/3の位置に来るようにする
          scrollOffsetY: -Math.round((scrollRef.current?.clientHeight ?? 600) / 3),
        }
      })

      // イベントリスナーの設定
      api.scoreLoaded.on((score: any) => {
        // 五線譜表示用にヘ音記号・オクターブ表記を整える（音高は変えない）
        prepareBassScoreForNotation(score)
        const plain = extractPlainScore(score)
        setDisplayedScore(plain)
        if (!loadingSimplifiedRef.current) setOriginalScore(plain)
      })

      api.renderFinished.on(() => {
        // 譜面を差し替えるとプレイヤーも作り直されるため、速度を再適用する
        api.playbackSpeed = tempoRef.current / 100
        // トラックごとの音量もリセットされるので、音量バランスを再適用する（簡略化譜面への切り替え時も）
        applyAlphaTabMix(api, mixRef.current)
        setLoadError(null)
        setBarCount(api.score?.masterBars?.length ?? 0)
        setIsReady(true)
      })

      api.error.on((e: { message?: string }) => {
        setLoadError(e?.message || 'タブ譜を表示できませんでした')
        setIsReady(false)
      })

      const wrapLoop = () => {
        const { loopStart } = loopRef.current
        recordLoopPassRef.current()
        loopPassListeners.current.forEach(listener => listener())
        api.tickPosition = loopStart || 0
        startPass(loopStart || 0)
      }

      api.playerStateChanged.on((e: any) => {
        const playing = e.state === 1 // 1 = playing
        setIsPlaying(playing)
        if (playing) startPass(api.tickPosition)
      })

      api.playerFinished?.on(() => {
        // 最終小節までのループは終端に達すると停止するので、先頭に戻して再開する
        const { isLooping, loopEnd } = loopRef.current
        if (isLooping && loopEnd !== null) {
          wrapLoop()
          api.play()
        }
      })

      api.playerPositionChanged.on((e: any) => {
        // A-Bループのチェック
        const { isLooping, loopEnd } = loopRef.current
        if (isLooping && loopEnd !== null && api.tickPosition >= loopEnd) {
          wrapLoop()
        } else if (e?.isSeek) {
          startPass(api.tickPosition)
        }
        if (passRef.current) passRef.current.minTempo = Math.min(passRef.current.minTempo, tempoRef.current)
        const tabSec = (e?.currentTime ?? api.timePosition ?? 0) * (api.playbackSpeed ?? 1) / 1000
        positionListeners.current.forEach(listener => listener(tabSec, !!e?.isSeek))
      })

      apiRef.current = api

      // 表示モード（TAB+リズム等）を読み込み前に反映する
      applyViewModeToSettings(api.settings, viewModeRef.current)
      api.updateSettings()

      // ファイルをロード
      loadSource(api, filePath)
    }

    loadAlphaTab()

    return () => {
      cancelled = true
      if (apiRef.current) {
        apiRef.current.destroy()
        apiRef.current = null
      }
    }
  }, [filePath])

  // 画面幅（スマホ⇔PCの切り替えや回転）が変わったら譜面の拡大率を合わせる
  useEffect(() => {
    let timeout = 0
    const apply = () => {
      timeout = 0
      const api = apiRef.current
      if (!api?.settings?.display) return
      const scale = currentScoreScale()
      if (api.settings.display.scale === scale) return
      api.settings.display.scale = scale
      api.updateSettings()
      if (api.score) api.render()
    }
    apply()
    const onResize = () => {
      if (timeout) window.clearTimeout(timeout)
      timeout = window.setTimeout(apply, 150)
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      if (timeout) window.clearTimeout(timeout)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [isMobile])

  // テンポ変更の処理
  useEffect(() => {
    if (apiRef.current && isReady) {
      apiRef.current.playbackSpeed = tempo / 100
    }
  }, [tempo, isReady])

  // 曲の読み込み直後にも譜面の音量バランスを反映
  useEffect(() => {
    if (apiRef.current && isReady) applyAlphaTabMix(apiRef.current, mixRef.current)
  }, [isReady])

  // PDFレンダリング
  useEffect(() => {
    if (pdfData && showPdf && pdfCanvasRef.current) {
      renderPDF(pdfData)
    }
  }, [pdfData, showPdf])

  const renderPDF = async (base64Data: string) => {
    if (!pdfCanvasRef.current) return

    try {
      const blob = base64ToPdfBlob(base64Data)
      const arrayBuffer = await blob.arrayBuffer()
      const pdf = await pdfjsLib.getDocument(pdfDocumentParams(arrayBuffer)).promise
      const page = await pdf.getPage(1)
      const viewport = page.getViewport({ scale: 1.0 })

      const canvas = pdfCanvasRef.current
      const context = canvas.getContext('2d')!
      canvas.width = viewport.width
      canvas.height = viewport.height

      await page.render({
        canvasContext: context,
        viewport: viewport,
      }).promise
    } catch (error) {
      console.error('PDF rendering error:', error)
    }
  }

  const handlePlayPause = () => {
    if (!apiRef.current) return
    
    if (isPlaying) {
      apiRef.current.pause()
    } else {
      apiRef.current.play()
    }
  }
  const handlePlayPauseRef = useRef(handlePlayPause)
  handlePlayPauseRef.current = handlePlayPause

  // スペースキーで再生／一時停止（再生ボタンと同じ処理を呼ぶ）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const action = getPlayPauseKeyAction(e)
      if (action === 'ignore') return
      if (!apiRef.current || !isReadyRef.current) return
      e.preventDefault()
      if (action === 'toggle') handlePlayPauseRef.current()
    }
    // ボタン上でスペースを離したときのクリック（再押下）を抑止する
    const onKeyUp = (e: KeyboardEvent) => {
      const isSpace = e.code === 'Space' || e.key === ' '
      if (isSpace && isPlainButtonTarget(e.target)) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
    }
  }, [])

  /** 先頭に戻す。再生状態は維持する（再生中なら先頭から再生を続ける） */
  const handleRewind = () => {
    const api = apiRef.current
    if (!rewindToStart(api, scrollRef.current)) return
    startPass(0)
    // 一時停止中はalphaTabがシークイベントを出さない場合があるので動画側へ明示的に通知する
    positionListeners.current.forEach(listener => listener(0, true))
  }

  const handleStop = () => {
    if (!apiRef.current) return
    apiRef.current.stop()
  }

  const handleSetLoopStart = () => {
    if (!apiRef.current) return
    setLoopStart(apiRef.current.tickPosition)
    setActiveSectionId(null)
  }

  const handleSetLoopEnd = () => {
    if (!apiRef.current) return
    setLoopEnd(apiRef.current.tickPosition)
    setActiveSectionId(null)
  }

  const handleClearLoop = () => {
    setLoopStart(null)
    setLoopEnd(null)
    setIsLooping(false)
    setActiveSectionId(null)
  }

  const handleToggleLoop = () => {
    if (loopStart !== null && loopEnd !== null) {
      setIsLooping(!isLooping)
    }
  }

  const handleLoopSection = (section: PracticeSection) => {
    const api = apiRef.current
    const ticks = barToTicks(api, section.startBar, section.endBar)
    if (!api || !ticks) return
    setLoopStart(ticks.start)
    setLoopEnd(ticks.end)
    setIsLooping(true)
    setActiveSectionId(section.id)
    api.tickPosition = ticks.start
    startPass(ticks.start)
  }

  const handleApplySimplify = (tex: string, result: SimplifyResult) => {
    const api = apiRef.current
    if (!api) return
    api.stop()
    loadingSimplifiedRef.current = true
    setSimplified(result)
    setIsReady(false)
    api.tex(tex)
  }

  const handleRestoreOriginal = () => {
    const api = apiRef.current
    if (!api) return
    api.stop()
    loadingSimplifiedRef.current = false
    setSimplified(null)
    setIsReady(false)
    loadSource(api, filePath)
  }

  const loopStartBar = isReady && loopStart !== null ? tickToBar(apiRef.current, loopStart) : null
  const loopEndBar = isReady && loopEnd !== null ? tickToBar(apiRef.current, Math.max(loopStart ?? 0, loopEnd - 1)) : null
  const loopRange = useMemo<BarRange | null>(() => {
    if (loopStartBar === null || loopEndBar === null || loopEndBar < loopStartBar) return null
    return { startBar: loopStartBar, endBar: loopEndBar }
  }, [loopStartBar, loopEndBar])

  const activeSection = sections.find(s => s.id === activeSectionId) ?? null
  const judgeRange = useMemo<JudgeRange | null>(() => {
    if (activeSection) return { sectionId: activeSection.id, startBar: activeSection.startBar, endBar: activeSection.endBar }
    if (loopRange && loopStart !== null && loopEnd !== null && loopEnd > loopStart) {
      return { ...loopRange, startTick: loopStart, endTick: loopEnd }
    }
    return null
  }, [activeSection, loopRange, loopStart, loopEnd])

  return (
    <>
      <div className="tab-container" style={{ display: 'flex', flexDirection: 'row', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {showPdf && pdfData && (
          <div className="tab-pdf-pane">
            <h3 style={{ color: '#aaa', fontSize: '0.9rem', marginBottom: '1rem' }}>
              元のPDF
            </h3>
            <canvas 
              ref={pdfCanvasRef}
              style={{
                width: '100%',
                height: 'auto',
                border: '1px solid #3a3a3a',
                borderRadius: '4px',
              }}
            />
          </div>
        )}
        <div className="tab-viewer-pane" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
          <div ref={scrollRef} className="at-viewport">
            <div ref={viewerRef} className="at-surface-host" />
          </div>
          {(loadError || !isReady) && (
            <div className="loading" style={{ position: 'absolute', inset: 0, background: '#1e1e1e' }}>
              {loadError ? `タブを表示できません: ${loadError}` : 'タブを読み込み中...'}
            </div>
          )}
        </div>
        {/* PCでは display: contents で従来どおり。スマホではボトムシートの「動画・同期」タブになる（常にマウントしたまま） */}
        <div className="youtube-sheet-pane mobile-sheet-pane" {...sheetPaneProps('video')}>
          <YouTubePanel
            songId={songId}
            isTabPlaying={isPlaying}
            tempoPercent={tempo}
            getTabSec={getTabSec}
            subscribePosition={subscribePosition}
            playTab={playTab}
            pauseTab={pauseTab}
            seekTab={seekTab}
            onTabMixChange={setTabMix}
          />
        </div>
      </div>
      <div className="controls-panel mobile-sheet-pane" {...sheetPaneProps('settings')}>
        <div className="control-group">
          <h3>再生</h3>
          <button
            className="button button-secondary button-small"
            onClick={handleRewind}
            disabled={!isReady}
          >
            ⏮ 最初に戻る
          </button>
          <button 
            className="button button-primary" 
            onClick={handlePlayPause}
            disabled={!isReady}
          >
            {isPlaying ? '⏸ 一時停止' : '▶ 再生'}
          </button>
          <button 
            className="button button-secondary button-small" 
            onClick={handleStop}
            disabled={!isReady}
          >
            ⏹ 停止
          </button>
          {songId && (
            <div className={`practice-timer ${timer.isActive ? 'active' : ''}`}>
              <span>⏱ 今回の練習</span>
              <span>{formatElapsed(timer.elapsedSec)}</span>
            </div>
          )}
        </div>

        <div className="control-group">
          <h3>テンポ</h3>
          <div className="slider-container">
            <div className="slider-label">
              <span>速度</span>
              <span>{tempo}%</span>
            </div>
            <input
              type="range"
              min="50"
              max="120"
              value={tempo}
              onChange={(e) => setTempo(Number(e.target.value))}
              className="slider"
              disabled={!isReady}
            />
          </div>
        </div>

        <div className="control-group">
          <h3>A-Bループ</h3>
          <button 
            className="button button-secondary button-small" 
            onClick={handleSetLoopStart}
            disabled={!isReady}
          >
            A地点を設定
          </button>
          <button 
            className="button button-secondary button-small" 
            onClick={handleSetLoopEnd}
            disabled={!isReady}
          >
            B地点を設定
          </button>
          <div className="loop-points">
            <div className={`loop-point ${loopStart !== null ? 'active' : ''}`}>
              A: {loopStart !== null ? (loopStartBar !== null ? `${loopStartBar}小節` : '設定済み') : '未設定'}
            </div>
            <div className={`loop-point ${loopEnd !== null ? 'active' : ''}`}>
              B: {loopEnd !== null ? (loopEndBar !== null ? `${loopEndBar}小節` : '設定済み') : '未設定'}
            </div>
          </div>
          <button 
            className="button button-primary button-small" 
            onClick={handleToggleLoop}
            disabled={!isReady || loopStart === null || loopEnd === null}
          >
            {isLooping ? 'ループ解除' : 'ループ開始'}
          </button>
          <button 
            className="button button-secondary button-small" 
            onClick={handleClearLoop}
            disabled={!isReady}
          >
            リセット
          </button>
          <div className="info-text">
            再生中の任意の位置でA地点・B地点を設定し、その区間を繰り返し練習できます。
          </div>
        </div>

        <div className="control-group">
          <h3>セクション</h3>
          <SectionPanel
            songId={songId}
            sections={sections}
            loopRange={loopRange}
            barCount={barCount}
            activeSectionId={activeSectionId}
            onChanged={refreshSections}
            onLoopSection={handleLoopSection}
          />
        </div>

        <div className="control-group">
          <h3>入力判定</h3>
          <InputCheckPanel
            songId={songId}
            score={displayedScore}
            isPlaying={isPlaying}
            tempoPercent={tempo}
            simplifyLevel={simplified?.level ?? 0}
            range={judgeRange}
            sections={sections}
            getTabSec={getTabSec}
            subscribePosition={subscribePosition}
            subscribeLoopPass={subscribeLoopPass}
          />
        </div>

        <div className="control-group">
          <h3>簡単アレンジ</h3>
          <SimplifyPanel
            originalScore={originalScore}
            activeSection={activeSection}
            loopRange={loopRange}
            applied={simplified}
            disabled={!isReady}
            onApply={handleApplySimplify}
            onRestore={handleRestoreOriginal}
          />
        </div>

        <div className="control-group">
          <h3>表示</h3>
          <div
            className="view-mode-toggle"
            role="radiogroup"
            aria-label="譜面の表示"
            data-testid="view-mode-toggle"
          >
            {VIEW_MODES.map(mode => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={viewMode === mode}
                tabIndex={viewMode === mode ? 0 : -1}
                data-view-mode={mode}
                className={`button ${viewMode === mode ? 'button-primary' : 'button-secondary'} button-small`}
                onClick={() => handleViewModeChange(mode)}
                onKeyDown={e => handleViewModeKeyDown(e, mode)}
              >
                {VIEW_MODE_LABELS[mode]}
              </button>
            ))}
          </div>
          <div className="info-text">
            TAB+リズム: TABに音符の長さ（棒・旗・連桁）と休符を表示
          </div>
          {pdfData && (
            <button
              className={`button ${showPdf ? 'button-primary' : 'button-secondary'} button-small`}
              onClick={() => setShowPdf(!showPdf)}
            >
              {showPdf ? '📄 PDFを隠す' : '📄 PDFを表示'}
            </button>
          )}
        </div>

        <div className="control-group">
          <h3>ファイル読み込み</h3>
          <div className="file-input-wrapper">
            <label className="button button-secondary" style={{ display: 'block', textAlign: 'center' }}>
              📁 ファイルを選択
              <input
                type="file"
                accept=".gp,.gp3,.gp4,.gp5,.gpx,.musicxml,.xml"
                onChange={onFileImport}
              />
            </label>
          </div>
          <div className="info-text">
            対応形式: Guitar Pro (.gp, .gp3, .gp4, .gp5, .gpx), MusicXML (.musicxml, .xml)
          </div>
        </div>

        <div className="control-group">
          <h3>使い方</h3>
          <div className="info-text">
            • タブ上をクリックすると、その位置から再生開始<br/>
            • テンポスライダーで速度調整<br/>
            • A-B地点を設定して難しいフレーズを反復練習<br/>
            • スペースキーで再生／一時停止
          </div>
        </div>
      </div>
      {isMobile && (
        <>
          <section
            id={SHEET_ID}
            className="mobile-sheet"
            data-testid="mobile-sheet"
            data-sheet-open={sheetOpen ? 'true' : 'false'}
            aria-label="練習パネル"
          >
            <button
              type="button"
              className="mobile-sheet-handle"
              onClick={closeSheet}
              tabIndex={-1}
              aria-hidden="true"
            >
              <span className="mobile-sheet-handle-bar" />
            </button>
            <div className="mobile-sheet-header">
              <div className="mobile-sheet-tabs" role="tablist" aria-label="パネルの切り替え" ref={sheetTabsRef}>
                {SHEET_TABS.map(t => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    id={sheetTabId(t.key)}
                    aria-selected={sheetTab === t.key}
                    aria-controls={sheetPaneId(t.key)}
                    tabIndex={sheetTab === t.key ? 0 : -1}
                    className={`mobile-sheet-tab ${sheetTab === t.key ? 'active' : ''}`}
                    data-testid={`mobile-sheet-tab-${t.key}`}
                    onClick={() => setSheetTab(t.key)}
                    onKeyDown={e => handleSheetTabKeyDown(e, t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                ref={sheetCloseRef}
                className="mobile-sheet-close"
                data-testid="mobile-sheet-close"
                onClick={closeSheet}
                onKeyDown={handleSheetCloseKeyDown}
                aria-label="パネルを閉じる"
              >
                ✕
              </button>
            </div>
          </section>
          <div className="mobile-transport" data-testid="mobile-transport" role="group" aria-label="再生コントロール">
            <button
              type="button"
              className="mobile-transport-button"
              onClick={handleRewind}
              disabled={!isReady}
              aria-label="最初に戻る"
              title="最初に戻る"
            >
              ⏮
            </button>
            <button
              type="button"
              className="mobile-transport-button mobile-transport-play"
              data-testid="mobile-play-toggle"
              onClick={handlePlayPause}
              disabled={!isReady}
              aria-label={isPlaying ? '一時停止' : '再生'}
              title={isPlaying ? '一時停止' : '再生'}
            >
              {isPlaying ? '⏸' : '▶'}
            </button>
            <div className="mobile-tempo" role="group" aria-label="速度">
              <button
                type="button"
                className="mobile-transport-button"
                data-testid="mobile-tempo-down"
                onClick={() => setTempo(t => stepTempo(t, -TEMPO_STEP))}
                disabled={!isReady || tempo <= TEMPO_MIN}
                aria-label="速度を下げる"
              >
                −
              </button>
              <output className="mobile-tempo-value" aria-live="polite" aria-label={`速度 ${tempo}%`}>
                {tempo}%
              </output>
              <button
                type="button"
                className="mobile-transport-button"
                data-testid="mobile-tempo-up"
                onClick={() => setTempo(t => stepTempo(t, TEMPO_STEP))}
                disabled={!isReady || tempo >= TEMPO_MAX}
                aria-label="速度を上げる"
              >
                +
              </button>
            </div>
            <button
              ref={sheetToggleRef}
              type="button"
              className={`mobile-transport-button mobile-sheet-toggle ${sheetOpen ? 'active' : ''}`}
              data-testid="mobile-sheet-toggle"
              onClick={() => setSheetOpen(open => !open)}
              aria-expanded={sheetOpen}
              aria-controls={SHEET_ID}
              aria-label={sheetOpen ? '練習パネルを閉じる' : '練習パネル（動画・設定）を開く'}
              title="動画・設定"
            >
              ☰
            </button>
          </div>
        </>
      )}
    </>
  )
}
