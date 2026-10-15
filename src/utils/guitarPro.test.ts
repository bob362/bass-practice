import { describe, it, expect } from 'vitest'
import {
  guitarProFormatFromName, isGuitarProFile, looksLikeGuitarPro, titleFromFileName,
  bytesToBase64, base64ToArrayBuffer, GUITAR_PRO_ACCEPT,
} from './guitarPro'

const enc = (s: string) => new Uint8Array([...s].map(c => c.charCodeAt(0)))

describe('guitarPro', () => {
  it('detects formats from file names', () => {
    expect(guitarProFormatFromName('song.gp')).toBe('gp')
    expect(guitarProFormatFromName('Song.GP5')).toBe('gp5')
    expect(guitarProFormatFromName('a.gpx')).toBe('gpx')
    expect(guitarProFormatFromName('a.gp3')).toBe('gp3')
    expect(guitarProFormatFromName('a.gp4')).toBe('gp4')
    expect(isGuitarProFile('a.pdf')).toBe(false)
    expect(isGuitarProFile('a.gpz')).toBe(false)
    expect(GUITAR_PRO_ACCEPT).toBe('.gp,.gp3,.gp4,.gp5,.gpx')
  })

  it('recognises Guitar Pro magic bytes', () => {
    expect(looksLikeGuitarPro(enc('PK\x03\x04rest'))).toBe(true)
    expect(looksLikeGuitarPro(enc('BCFZxxxx'))).toBe(true)
    expect(looksLikeGuitarPro(enc('\x18FICHIER GUITAR PRO v5.00'))).toBe(true)
    expect(looksLikeGuitarPro(enc('%PDF-1.7'))).toBe(false)
    expect(looksLikeGuitarPro(enc('PK'))).toBe(false)
  })

  it('derives title from file name', () => {
    expect(titleFromFileName('My Song.gp')).toBe('My Song')
  })

  it('round-trips binary through base64', () => {
    const bytes = new Uint8Array(100000).map((_, i) => (i * 7) % 256)
    const back = new Uint8Array(base64ToArrayBuffer(bytesToBase64(bytes)))
    expect(back).toEqual(bytes)
    expect(new Uint8Array(base64ToArrayBuffer('data:application/octet-stream;base64,' + bytesToBase64(bytes)))).toEqual(bytes)
  })
})

describe('guitarPro with alphaTab importer', () => {
  it('a GP7 (.gp) file survives base64 storage and loads in alphaTab', async () => {
    const at: any = await import('@coderline/alphatab')
    const settings = new at.Settings()
    const imp = new at.importer.AlphaTexImporter()
    imp.initFromString('\\title "Test" \\tuning E1 A1 D2 G2 . 3.4.4 5.4.4 3.3.4 5.3.4 |', settings)
    const score = imp.readScore()
    const bytes: Uint8Array = new at.exporter.Gp7Exporter().export(score, settings)
    expect(looksLikeGuitarPro(bytes)).toBe(true)
    const restored = new Uint8Array(base64ToArrayBuffer(bytesToBase64(bytes)))
    const loaded = at.importer.ScoreLoader.loadScoreFromBytes(restored, settings)
    expect(loaded.title).toBe('Test')
    expect(loaded.masterBars.length).toBe(1)
  })
})
