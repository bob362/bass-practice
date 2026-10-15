import { useState } from 'react'
import './App.css'
import TabViewer from './components/TabViewer'
import PDFImport from './components/pdf-import/PDFImport'

type View = 'practice' | 'import'

function App() {
  const [view, setView] = useState<View>('import')
  const [currentFile, setCurrentFile] = useState<string | ArrayBuffer>('/sample-bass.tex')
  const [currentPdf, setCurrentPdf] = useState<string | null>(null)

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const arrayBuffer = e.target?.result
        if (arrayBuffer) {
          setCurrentFile(arrayBuffer as any)
          setCurrentPdf(null)
        }
      }
      reader.readAsArrayBuffer(file)
    }
  }

  const handleSongSelected = (texData: string, pdfData?: string) => {
    // texDataを直接渡す（alphaTabはtexフォーマットの文字列を直接処理できる）
    setCurrentFile(texData)
    setCurrentPdf(pdfData || null)
    setView('practice')
  }

  return (
    <div className="app">
      <header className="header">
        <h1>🎸 ベース練習アプリ</h1>
        <div className="header-nav">
          <button 
            className={`nav-button ${view === 'practice' ? 'active' : ''}`}
            onClick={() => setView('practice')}
          >
            練習
          </button>
          <button 
            className={`nav-button ${view === 'import' ? 'active' : ''}`}
            onClick={() => setView('import')}
          >
            曲の管理
          </button>
        </div>
      </header>
      <div className="main-content">
        {view === 'practice' ? (
          <TabViewer 
            filePath={currentFile}
            pdfData={currentPdf}
            onFileImport={handleFileImport}
          />
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
