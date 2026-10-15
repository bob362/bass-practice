/**
 * 変換済みタブ譜のlocalStorage管理
 */

export interface ConvertedSong {
  id: string
  title: string
  artist?: string
  texData: string
  pdfData?: string // base64エンコードされたPDFデータ
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'bass_practice_songs'

/**
 * 全ての曲を取得
 */
export function getAllSongs(): ConvertedSong[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? JSON.parse(data) : []
  } catch (error) {
    console.error('Failed to load songs:', error)
    return []
  }
}

/**
 * 曲を保存
 */
export function saveSong(song: Omit<ConvertedSong, 'id' | 'createdAt' | 'updatedAt'>): ConvertedSong {
  const songs = getAllSongs()
  const now = Date.now()
  
  const newSong: ConvertedSong = {
    ...song,
    id: `song_${now}_${Math.random().toString(36).substr(2, 9)}`,
    createdAt: now,
    updatedAt: now,
  }
  
  songs.push(newSong)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(songs))
  
  return newSong
}

/**
 * 曲を更新
 */
export function updateSong(id: string, updates: Partial<Omit<ConvertedSong, 'id' | 'createdAt'>>): ConvertedSong | null {
  const songs = getAllSongs()
  const index = songs.findIndex(s => s.id === id)
  
  if (index === -1) return null
  
  songs[index] = {
    ...songs[index],
    ...updates,
    updatedAt: Date.now(),
  }
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(songs))
  return songs[index]
}

/**
 * 曲を削除
 */
export function deleteSong(id: string): boolean {
  const songs = getAllSongs()
  const filtered = songs.filter(s => s.id !== id)
  
  if (filtered.length === songs.length) return false
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
  return true
}

/**
 * IDで曲を取得
 */
export function getSongById(id: string): ConvertedSong | null {
  const songs = getAllSongs()
  return songs.find(s => s.id === id) || null
}

/**
 * PDFをbase64に変換
 */
export async function pdfToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * base64からPDF Blobを生成
 */
export function base64ToPdfBlob(base64: string): Blob {
  const parts = base64.split(',')
  const data = parts.length > 1 ? parts[1] : parts[0]
  const binary = atob(data)
  const array = new Uint8Array(binary.length)
  
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i)
  }
  
  return new Blob([array], { type: 'application/pdf' })
}
