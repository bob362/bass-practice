import { useState } from 'react'
import './App.css'
import TabViewer from './components/TabViewer'

function App() {
  const [currentFile, setCurrentFile] = useState<string>('/sample-bass.tex')

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const arrayBuffer = e.target?.result
        if (arrayBuffer) {
          setCurrentFile(arrayBuffer as any)
        }
      }
      reader.readAsArrayBuffer(file)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>🎸 ベース練習アプリ</h1>
      </header>
      <div className="main-content">
        <TabViewer 
          filePath={currentFile}
          onFileImport={handleFileImport}
        />
      </div>
    </div>
  )
}

export default App
