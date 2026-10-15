import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { base64ToPdfBlob } from '../utils/storage'

// alphaTabのグローバルインポート
declare global {
  interface Window {
    alphaTab: any
  }
}

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs`

interface TabViewerProps {
  filePath: string | ArrayBuffer
  pdfData?: string | null
  onFileImport: (event: React.ChangeEvent<HTMLInputElement>) => void
}

export default function TabViewer({ filePath, pdfData, onFileImport }: TabViewerProps) {
  const viewerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<any>(null)
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const [tempo, setTempo] = useState(100)
  const [loopStart, setLoopStart] = useState<number | null>(null)
  const [loopEnd, setLoopEnd] = useState<number | null>(null)
  const [isLooping, setIsLooping] = useState(false)
  const [showPdf, setShowPdf] = useState(false)

  useEffect(() => {
    if (!viewerRef.current) return

    const loadAlphaTab = async () => {
      // alphaTabのCDNからロード
      if (!window.alphaTab) {
        const script = document.createElement('script')
        script.src = 'https://cdn.jsdelivr.net/npm/@coderline/alphatab@latest/dist/alphaTab.js'
        script.async = true
        
        await new Promise<void>((resolve) => {
          script.onload = () => resolve()
          document.head.appendChild(script)
        })

        // CSSもロード
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = 'https://cdn.jsdelivr.net/npm/@coderline/alphatab@latest/dist/alphaTab.css'
        document.head.appendChild(link)
      }

      if (!viewerRef.current) return

      // alphaTab APIの初期化
      const api = new window.alphaTab.AlphaTabApi(viewerRef.current, {
        core: {
          logLevel: 1,
          fontDirectory: 'https://cdn.jsdelivr.net/npm/@coderline/alphatab@latest/dist/font/',
          enableLazyLoading: false,
        },
        display: {
          layoutMode: 'page',
          staveProfile: 'tab',
          resources: {
            staffLineColor: '#3a3a3a',
            barSeparatorColor: '#3a3a3a',
            mainGlyphColor: '#e0e0e0',
            secondaryGlyphColor: '#aaa',
            scoreInfoColor: '#ccc',
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
          soundFont: 'https://cdn.jsdelivr.net/npm/@coderline/alphatab@latest/dist/soundfont/sonivox.sf2',
          scrollElement: viewerRef.current.querySelector('.at-viewport'),
        }
      })

      // イベントリスナーの設定
      api.renderFinished.on(() => {
        setIsReady(true)
      })

      api.playerStateChanged.on((e: any) => {
        setIsPlaying(e.state === 1) // 1 = playing
      })

      api.playerPositionChanged.on(() => {
        // A-Bループのチェック
        if (isLooping && loopEnd !== null && api.tickPosition >= loopEnd) {
          api.tickPosition = loopStart || 0
        }
      })

      apiRef.current = api

      // ファイルをロード
      if (typeof filePath === 'string') {
        // 文字列の場合、URLかtexデータか判定
        if (filePath.startsWith('/') || filePath.startsWith('http')) {
          // URLの場合はそのままロード
          api.load(filePath)
        } else {
          // texデータの場合は直接渡す
          api.tex(filePath)
        }
      } else {
        // ArrayBufferの場合
        api.load(filePath)
      }
    }

    loadAlphaTab()

    return () => {
      if (apiRef.current) {
        apiRef.current.destroy()
      }
    }
  }, [filePath])

  // テンポ変更の処理
  useEffect(() => {
    if (apiRef.current && isReady) {
      apiRef.current.playbackSpeed = tempo / 100
    }
  }, [tempo, isReady])

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
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
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

  const handleStop = () => {
    if (!apiRef.current) return
    apiRef.current.stop()
  }

  const handleSetLoopStart = () => {
    if (!apiRef.current) return
    setLoopStart(apiRef.current.tickPosition)
  }

  const handleSetLoopEnd = () => {
    if (!apiRef.current) return
    setLoopEnd(apiRef.current.tickPosition)
  }

  const handleClearLoop = () => {
    setLoopStart(null)
    setLoopEnd(null)
    setIsLooping(false)
  }

  const handleToggleLoop = () => {
    if (loopStart !== null && loopEnd !== null) {
      setIsLooping(!isLooping)
    }
  }

  return (
    <>
      <div className="tab-container" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {showPdf && pdfData && (
          <div style={{
            width: '400px',
            background: '#2a2a2a',
            borderRight: '1px solid #3a3a3a',
            padding: '1rem',
            overflow: 'auto',
          }}>
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
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div ref={viewerRef} className="at-viewport">
            {!isReady && <div className="loading">タブを読み込み中...</div>}
          </div>
        </div>
      </div>
      <div className="controls-panel">
        <div className="control-group">
          <h3>再生</h3>
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
              A: {loopStart !== null ? '設定済み' : '未設定'}
            </div>
            <div className={`loop-point ${loopEnd !== null ? 'active' : ''}`}>
              B: {loopEnd !== null ? '設定済み' : '未設定'}
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
          <h3>表示</h3>
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
            対応形式: Guitar Pro (.gp, .gp5, .gpx), MusicXML (.musicxml, .xml)
          </div>
        </div>

        <div className="control-group">
          <h3>使い方</h3>
          <div className="info-text">
            • タブ上をクリックすると、その位置から再生開始<br/>
            • テンポスライダーで速度調整<br/>
            • A-B地点を設定して難しいフレーズを反復練習
          </div>
        </div>
      </div>
    </>
  )
}
