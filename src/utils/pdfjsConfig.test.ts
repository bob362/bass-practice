import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as pdfjsLib from 'pdfjs-dist'
import {
  PDFJS_VERSION,
  PDFJS_CDN_BASE,
  setPdfjsResourceUrls,
  getPdfjsResourceUrls,
  configurePdfjsWorker,
  pdfDocumentParams,
} from './pdfjsConfig'

const installedVersion = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'node_modules/pdfjs-dist/package.json'), 'utf8'),
).version as string

afterEach(() => {
  setPdfjsResourceUrls(null)
})

describe('pdfjsConfig', () => {
  it('PDFJS_VERSION matches installed pdfjs-dist', () => {
    expect(PDFJS_VERSION).toBe(installedVersion)
    expect(PDFJS_CDN_BASE).toBe(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/`)
  })

  it('jsdom defaults point to CDN cmaps / standard fonts', () => {
    const urls = getPdfjsResourceUrls()
    expect(urls.workerSrc).toBe(`${PDFJS_CDN_BASE}build/pdf.worker.min.mjs`)
    expect(urls.cMapUrl).toBe(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/cmaps/`)
    expect(urls.standardFontDataUrl).toBe(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/standard_fonts/`)
  })

  it('overrides win over defaults', () => {
    setPdfjsResourceUrls({
      workerSrc: '/worker.mjs',
      cMapUrl: '/cmaps/',
      standardFontDataUrl: '/fonts/',
    })
    expect(getPdfjsResourceUrls()).toEqual({
      workerSrc: '/worker.mjs',
      cMapUrl: '/cmaps/',
      standardFontDataUrl: '/fonts/',
    })
  })

  it('configurePdfjsWorker applies override to GlobalWorkerOptions', () => {
    setPdfjsResourceUrls({ workerSrc: 'http://example.test/worker.mjs' })
    configurePdfjsWorker()
    expect(pdfjsLib.GlobalWorkerOptions.workerSrc).toBe('http://example.test/worker.mjs')
  })

  it('null reset restores jsdom defaults', () => {
    setPdfjsResourceUrls({ cMapUrl: '/cmaps/' })
    setPdfjsResourceUrls(null)
    expect(getPdfjsResourceUrls().cMapUrl).toBe(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/cmaps/`)
  })

  it('pdfDocumentParams wraps ArrayBuffer and includes override URLs', () => {
    setPdfjsResourceUrls({ cMapUrl: '/cmaps/', standardFontDataUrl: '/fonts/' })
    const buf = new ArrayBuffer(4)
    const params = pdfDocumentParams(buf)
    expect(params.data).toBeInstanceOf(Uint8Array)
    expect(params.data.byteLength).toBe(4)
    expect(params.cMapUrl).toBe('/cmaps/')
    expect(params.cMapPacked).toBe(true)
    expect(params.standardFontDataUrl).toBe('/fonts/')
  })

  it('pdfDocumentParams passes Uint8Array as is', () => {
    const bytes = new Uint8Array([1, 2, 3])
    expect(pdfDocumentParams(bytes).data).toBe(bytes)
  })
})
