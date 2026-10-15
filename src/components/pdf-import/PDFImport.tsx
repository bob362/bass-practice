import { useState, useRef, useEffect } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { parseTextPDF } from '../../utils/pdfParser'
import { parseScannedPDF, isPDFScanned } from '../../utils/ocrParser'
import { convertToAlphaTab, texToEditable, editableToTex, EditableScore } from '../../utils/alphaTabConverter'
import { saveSong, getAllSongs, ConvertedSong, deleteSong, pdfToBase64 } from '../../utils/storage'
import './PDFImport.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs`

interface PDFImportProps {
  onSongSelected: (texData: string, pdfData?: string) => void
}

type Stage = 'upload' | 'processing' | 'review' | 'saved-list'

export default function PDFImport({ onSongSelected }: PDFImportProps) {
  const [stage, setStage] = useState<Stage>('saved-list')
  const [currentFile, setCurrentFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [isScanned, setIsScanned] = useState(false)
  const [editableScore, setEditableScore] = useState<EditableScore | null>(null)
  const [_pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null)
  const [savedSongs, setSavedSongs] = useState<ConvertedSong[]>([])
  const [dragOver, setDragOver] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadSavedSongs()
  }, [])

  const loadSavedSongs = () => {
    setSavedSongs(getAllSongs())
  }

  const handleFileSelect = async (file: File) => {
    if (!file.type.includes('pdf')) {
      setError('PDFファイルを選択してください')
      return
    }

    setCurrentFile(file)
    setError(null)
    setStage('processing')
    setProgress(0)

    try {
      const previewUrl = URL.createObjectURL(file)
      setPdfPreviewUrl(previewUrl)

      // スキャンPDFかテキストPDFかを判定
      const scanned = await isPDFScanned(file)
      setIsScanned(scanned)

      setProgress(10)

      // パース
      let parsed
      if (scanned) {
        parsed = await parseScannedPDF(file, (p) => setProgress(10 + p * 60))
      } else {
        parsed = await parseTextPDF(file)
        setProgress(70)
      }

      setProgress(80)

      // alphaTab形式に変換
      const texData = convertToAlphaTab(parsed)
      const editable = texToEditable(texData)
      setEditableScore(editable)

      setProgress(100)
      setStage('review')
    } catch (err) {
      console.error('PDF処理エラー:', err)
      setError(`PDFの処理に失敗しました: ${err instanceof Error ? err.message : '不明なエラー'}`)
      setStage('upload')
    }
  }

  useEffect(() => {
    if (stage !== 'review' || !currentFile || !previewRef.current) return
    const file = currentFile
    const host = previewRef.current
    let cancelled = false

    ;(async () => {
      try {
        const data = new Uint8Array(await file.arrayBuffer())
        const pdf = await pdfjsLib.getDocument({ data }).promise
        if (cancelled || !previewRef.current) return
        host.replaceChildren()
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return
          const page = await pdf.getPage(i)
          const viewport = page.getViewport({ scale: 1.2 })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.style.width = '100%'
          canvas.style.height = 'auto'
          canvas.style.display = 'block'
          canvas.style.marginBottom = '12px'
          canvas.style.background = '#fff'
          host.appendChild(canvas)
          const context = canvas.getContext('2d')
          if (!context) continue
          await page.render({ canvasContext: context, viewport }).promise
        }
      } catch (error) {
        console.error('PDF preview rendering error:', error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [stage, currentFile])

  const handleSave = async () => {
    if (!editableScore || !currentFile) return

    try {
      const texData = editableToTex(editableScore)
      const pdfData = await pdfToBase64(currentFile)

      saveSong({
        title: editableScore.metadata.title || currentFile.name,
        artist: editableScore.metadata.subtitle,
        texData,
        pdfData,
      })

      loadSavedSongs()
      setStage('saved-list')
      setEditableScore(null)
      setCurrentFile(null)
      setPdfPreviewUrl(null)
    } catch (err) {
      setError(`保存に失敗しました: ${err instanceof Error ? err.message : '不明なエラー'}`)
    }
  }

  const handleMetadataChange = (key: string, value: string) => {
    if (!editableScore) return
    setEditableScore({
      ...editableScore,
      metadata: { ...editableScore.metadata, [key]: value },
    })
  }

  const handleMeasureChange = (index: number, value: string) => {
    if (!editableScore) return
    const newMeasures = [...editableScore.measures]
    newMeasures[index] = value
    setEditableScore({ ...editableScore, measures: newMeasures })
  }

  const handleAddMeasure = () => {
    if (!editableScore) return
    setEditableScore({
      ...editableScore,
      measures: [...editableScore.measures, '0.4 0.4 3.4 0.3'],
    })
  }

  const handleDeleteMeasure = (index: number) => {
    if (!editableScore) return
    const newMeasures = editableScore.measures.filter((_, i) => i !== index)
    setEditableScore({ ...editableScore, measures: newMeasures })
  }

  const handleSongSelect = (song: ConvertedSong) => {
    onSongSelected(song.texData, song.pdfData)
  }

  const handleDeleteSong = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm('この曲を削除してもよろしいですか？')) {
      deleteSong(id)
      loadSavedSongs()
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = () => {
    setDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }

  return (
    <div className="pdf-import-container">
      {stage === 'saved-list' && (
        <>
          <h2>保存済みの曲</h2>
          {savedSongs.length === 0 ? (
            <div className="info-box">
              まだ曲が保存されていません。下のボタンからPDFをインポートしてください。
            </div>
          ) : (
            <div className="saved-songs-list">
              {savedSongs.map(song => (
                <div
                  key={song.id}
                  className="song-item"
                  onClick={() => handleSongSelect(song)}
                >
                  <div className="song-info">
                    <div className="song-title">{song.title}</div>
                    <div className="song-meta">
                      {song.artist && `${song.artist} • `}
                      {new Date(song.updatedAt).toLocaleDateString('ja-JP')}
                    </div>
                  </div>
                  <div className="song-actions">
                    <button
                      className="icon-button delete"
                      onClick={(e) => handleDeleteSong(song.id, e)}
                      title="削除"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button
            className="button button-primary"
            onClick={() => setStage('upload')}
            style={{ marginTop: '1.5rem' }}
          >
            + 新しいPDFをインポート
          </button>
        </>
      )}

      {stage === 'upload' && (
        <>
          <h2>PDFタブ譜のインポート</h2>
          <div
            className={`upload-section ${dragOver ? 'drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div
              className="file-input-area"
              onClick={() => fileInputRef.current?.click()}
            >
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📄</div>
              <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                PDFファイルをドロップまたはクリックして選択
              </p>
              <p style={{ fontSize: '0.875rem', color: '#888' }}>
                テキストベースPDFまたはスキャン画像PDFに対応
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              style={{ display: 'none' }}
            />
          </div>
          <div className="info-box">
            <strong>対応するPDF形式：</strong>
            <ul style={{ marginTop: '0.5rem', marginLeft: '1.5rem' }}>
              <li><strong>テキストベースPDF:</strong> 最も精度が高い。文字情報を含むPDF。</li>
              <li><strong>スキャン画像PDF:</strong> OCRで認識（精度は中程度）。レビュー画面で修正可能。</li>
            </ul>
          </div>
          <button
            className="button button-secondary"
            onClick={() => setStage('saved-list')}
            style={{ marginTop: '1rem' }}
          >
            ← 戻る
          </button>
          {error && <div className="error-message">{error}</div>}
        </>
      )}

      {stage === 'processing' && (
        <>
          <h2>処理中...</h2>
          <div className="progress-section">
            <p>{isScanned ? 'OCRで文字認識中...' : 'テキストを抽出中...'}</p>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#888' }}>
              {progress.toFixed(0)}%
            </p>
          </div>
        </>
      )}

      {stage === 'review' && editableScore && (
        <>
          <h2>レビュー・編集</h2>
          <div className="info-box">
            {isScanned
              ? 'OCRで認識した結果です。誤りがあれば修正してください。'
              : 'PDFから抽出した結果です。必要に応じて編集してください。'}
          </div>
          <div className="review-container">
            <div className="pdf-preview">
              <h3 style={{ marginBottom: '1rem' }}>元のPDF</h3>
              <div ref={previewRef} />
            </div>
            <div className="tab-editor">
              <h3>タブ譜データ</h3>
              <div className="metadata-editor">
                <div className="form-group">
                  <label>曲名</label>
                  <input
                    type="text"
                    value={editableScore.metadata.title || ''}
                    onChange={(e) => handleMetadataChange('title', e.target.value)}
                    placeholder="曲名を入力"
                  />
                </div>
                <div className="form-group">
                  <label>アーティスト</label>
                  <input
                    type="text"
                    value={editableScore.metadata.subtitle || ''}
                    onChange={(e) => handleMetadataChange('subtitle', e.target.value)}
                    placeholder="アーティスト名を入力"
                  />
                </div>
                <div className="form-group">
                  <label>チューニング（低い弦から）</label>
                  <input
                    type="text"
                    value={editableScore.metadata.tuning || 'E1 A1 D2 G2'}
                    onChange={(e) => handleMetadataChange('tuning', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>テンポ (BPM)</label>
                  <input
                    type="number"
                    value={editableScore.metadata.tempo || 120}
                    onChange={(e) => handleMetadataChange('tempo', e.target.value)}
                    min="40"
                    max="240"
                  />
                </div>
              </div>
              <h4 style={{ marginBottom: '0.75rem' }}>小節（1が一番低い弦。:8 は8分音符、{'{d}'} は付点、{'{h}'} ハンマリング、{'{sl}'} スライド、x はデッドノート）</h4>
              <div className="measures-editor">
                {editableScore.measures.map((measure, index) => (
                  <div key={index} className="measure-item">
                    <span className="measure-number">第{index + 1}小節</span>
                    <input
                      type="text"
                      className="measure-input"
                      value={measure}
                      onChange={(e) => handleMeasureChange(index, e.target.value)}
                      placeholder="例: 0.4 3.4 5.3"
                    />
                    <div className="measure-actions">
                      <button
                        className="icon-button delete"
                        onClick={() => handleDeleteMeasure(index)}
                        title="削除"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
                <button className="add-measure-button" onClick={handleAddMeasure}>
                  + 小節を追加
                </button>
              </div>
              <div className="action-buttons">
                <button
                  className="button button-secondary"
                  onClick={() => {
                    setStage('upload')
                    setEditableScore(null)
                  }}
                >
                  キャンセル
                </button>
                <button className="button button-primary" onClick={handleSave}>
                  保存して使用
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
