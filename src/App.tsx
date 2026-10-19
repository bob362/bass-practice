import { useEffect, useState } from 'react'
import './App.css'
import TabViewer from './components/TabViewer'
import PDFImport from './components/pdf-import/PDFImport'
import Dashboard from './components/Dashboard'
import SyncStatusIndicator from './components/SyncStatusIndicator'
import { startCloudSync } from './utils/cloudSync'
import type { ConvertedSong } from './utils/storage'
import { base64ToArrayBuffer } from './utils/guitarPro'

type View = 'practice' | 'dashboard' | 'import'

function App() {
  const [view, setView] = useState<View>('import')
  const [currentFile, setCurrentFile] = useState<string | ArrayBuffer>('/sample-bass.tex')
  const [currentPdf, setCurrentPdf] = useState<string | null>(null)
  const [currentSongId, setCurrentSongId] = useState<string | null>(null)

  useEffect(() => {
    startCloudSync().catch(() => {})
  }, [])

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const arrayBuffer = e.target?.result
        if (arrayBuffer) {
          setCurrentFile(arrayBuffer as any)
          setCurrentPdf(null)
          setCurrentSongId(null)
        }
      }
      reader.readAsArrayBuffer(file)
    }
  }

  const handleSongSelected = (song: ConvertedSong) => {
    // texDataを直接渡す（alphaTabはtexフォーマットの文字列を直接処理できる）
    setCurrentFile(song.gpData ? base64ToArrayBuffer(song.gpData) : song.texData)
    setCurrentPdf(song.pdfData || null)
    setCurrentSongId(song.id)
    setView('practice')
  }

  return (
    <div className="app">
      <header className="header">
        <h1>🎸 ベース練習アプリ</h1>
        <div className="header-right">
          <SyncStatusIndicator />
          <div className="header-nav">
            <button 
              className={`nav-button ${view === 'practice' ? 'active' : ''}`}
              onClick={() => setView('practice')}
            >
              練習
            </button>
            <button 
              className={`nav-button ${view === 'dashboard' ? 'active' : ''}`}
              onClick={() => setView('dashboard')}
            >
              ダッシュボード
            </button>
            <button 
              className={`nav-button ${view === 'import' ? 'active' : ''}`}
              onClick={() => setView('import')}
            >
              曲の管理
            </button>
          </div>
        </div>
      </header>
      <div className="main-content">
        {view === 'practice' ? (
          <TabViewer 
            filePath={currentFile}
            pdfData={currentPdf}
            songId={currentSongId}
            onFileImport={handleFileImport}
          />
        ) : view === 'dashboard' ? (
          <div style={{ flex: 1, overflow: 'auto', background: '#1a1a1a' }}>
            <Dashboard onOpenSong={handleSongSelected} />
          </div>
        ) : (
          <div style={{ flex: 1, overflow: 'auto', background: '#1a1a1a' }}>
            <PDFImport onSongSelected={handleSongSelected} />
          </div>
        )}
      </div>
    </div>
  )
}

export default App
