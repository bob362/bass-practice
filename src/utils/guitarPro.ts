/**
 * Guitar Pro ファイル（.gp / .gp3 / .gp4 / .gp5 / .gpx）の判定と保存用エンコード。
 * 実際のパースは alphaTab（api.load(ArrayBuffer)）が行う。
 */

export const GUITAR_PRO_EXTENSIONS = ['.gp', '.gp3', '.gp4', '.gp5', '.gpx'] as const
export const GUITAR_PRO_ACCEPT = GUITAR_PRO_EXTENSIONS.join(',')
/** localStorage（概ね5MB）を圧迫しないための上限（元ファイルのバイト数） */
export const MAX_GUITAR_PRO_BYTES = 2 * 1024 * 1024

export type GuitarProFormat = 'gp' | 'gp3' | 'gp4' | 'gp5' | 'gpx'

export function guitarProFormatFromName(name: string): GuitarProFormat | null {
  const m = /\.(gp|gp3|gp4|gp5|gpx)$/i.exec(name.trim())
  return m ? (m[1].toLowerCase() as GuitarProFormat) : null
}

export function isGuitarProFile(name: string): boolean {
  return guitarProFormatFromName(name) !== null
}

/**
 * 中身が Guitar Pro らしいか簡易チェック。
 * GP7/8 (.gp) は ZIP（"PK\x03\x04"）、.gpx は "BCFZ"/"BCFS"、
 * GP3〜5 は先頭が長さバイト + "FICHIER GUITAR PRO"。
 */
export function looksLikeGuitarPro(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false
  const head4 = String.fromCharCode(...bytes.slice(0, 4))
  if (head4 === 'PK\x03\x04' || head4 === 'BCFZ' || head4 === 'BCFS') return true
  const head = String.fromCharCode(...bytes.slice(1, 19))
  return head === 'FICHIER GUITAR PRO' || head.startsWith('FICHIER GUITAR')
}

/** ファイル名から拡張子を除いた曲名 */
export function titleFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim() || name
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const data = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}
