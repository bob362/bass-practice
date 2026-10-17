import * as pdfjsLib from 'pdfjs-dist'

/**
 * pdf.js 共通設定。ワーカーURLや cMap の所在は一元管理する。
 * Node/テストではブラウザ向けCDN URLを上書きできる。
 */

/** installed pdfjs-dist version */
export const PDFJS_VERSION: string = pdfjsLib.version

/** `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/` */
export const PDFJS_CDN_BASE: string = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/`

export interface PdfjsResourceUrls {
  workerSrc?: string
  cMapUrl?: string
  standardFontDataUrl?: string
}

// オーバーライド（Node/テスト用）。partial で現在値にマージする
let overrides: PdfjsResourceUrls = {}

export function setPdfjsResourceUrls(urls: PdfjsResourceUrls | null): void {
  if (urls === null) {
    overrides = {}
    return
  }
  overrides = { ...overrides, ...urls }
}

export function getPdfjsResourceUrls(): PdfjsResourceUrls {
  if (typeof window !== 'undefined') {
    return {
      workerSrc: `${PDFJS_CDN_BASE}build/pdf.worker.min.mjs`,
      cMapUrl: `${PDFJS_CDN_BASE}cmaps/`,
      standardFontDataUrl: `${PDFJS_CDN_BASE}standard_fonts/`,
      ...overrides,
    }
  }
  // Node ではデフォルトなし（pdf.js の Node 動作を保つ）
  return { ...overrides }
}

/** workerSrc が決まっているときだけ GlobalWorkerOptions に設定する */
export function configurePdfjsWorker(): void {
  const { workerSrc } = getPdfjsResourceUrls()
  if (workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc
  }
}

export function pdfDocumentParams(data: ArrayBuffer | Uint8Array): {
  data: Uint8Array
  cMapUrl?: string
  cMapPacked?: boolean
  standardFontDataUrl?: string
} {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const urls = getPdfjsResourceUrls()
  const params: { data: Uint8Array; cMapUrl?: string; cMapPacked?: boolean; standardFontDataUrl?: string } = {
    data: bytes,
  }
  if (urls.cMapUrl) {
    params.cMapUrl = urls.cMapUrl
    params.cMapPacked = true
  }
  if (urls.standardFontDataUrl) {
    params.standardFontDataUrl = urls.standardFontDataUrl
  }
  return params
}
