// @vitest-environment node
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { parseArgs, parseEnv, songId, youtubeUrl, buildSong, buildMedia, registerSong, main } from './register-song.mjs'

const input = { id: 'synthetic', title: 'Synthetic', bytes: Buffer.from('synthetic bytes'), format: 'gp', urls: {} }
describe('register-song helpers', () => {
  it('parses arguments and dotenv without exposing or evaluating values', () => {
    expect(parseArgs(['--gp', 'synthetic.gp', '--dry-run'])).toEqual({ gp: 'synthetic.gp', 'dry-run': true })
    expect(parseEnv('# comment\nexport KEY="literal $VALUE"\nOTHER=value # comment')).toEqual({ KEY: 'literal $VALUE', OTHER: 'value' })
    expect(() => parseArgs(['--unknown'])).toThrow()
  })
  it('uses deterministic valid IDs, including non-Latin titles', () => {
    expect(songId('A Nice Song')).toBe('a-nice-song')
    expect(songId('日本語')).toMatch(/^[A-Za-z0-9_.-]{1,128}$/)
    expect(songId('日本語')).toBe(songId('日本語'))
    for (const id of ['../wrong/id', '.', '..']) expect(() => songId('title', id)).toThrow()
    expect(songId('..')).not.toBe('..')
  })
  it('validates YouTube video URLs and rejects deceptive hosts', () => {
    expect(youtubeUrl('https://youtu.be/abcdefghijk')).toBe('https://youtu.be/abcdefghijk')
    expect(youtubeUrl('https://www.youtube.com/watch?v=abcdefghijk&t=3')).toContain('watch')
    for (const url of ['https://youtube.com.evil.test/watch?v=abcdefghijk', 'https://youtube.com/playlist?list=x', 'javascript:alert(1)', 'https://youtu.be/short']) expect(() => youtubeUrl(url)).toThrow()
  })
  it('preserves song fields, folder/tags and createdAt while replacing GP data and advancing time', () => {
    const song = buildSong({ ...input, gpData: 'old', createdAt: 5, updatedAt: 100, folderId: 'folder', tags: ['tag'], artist: 'Artist', custom: { progress: 3 }, deleted: true }, input, 20)
    expect(song).toMatchObject({ id: input.id, gpData: input.bytes.toString('base64'), gpFormat: 'gp', texData: '', createdAt: 5, updatedAt: 101, folderId: 'folder', tags: ['tag'], artist: 'Artist', custom: { progress: 3 } })
    expect(song.deleted).toBeUndefined()
  })
  it('patches only requested URLs while retaining existing offsets and volumes', () => {
    const patch = buildMedia({ version: 1, entries: { synthetic: { updatedAt: 100, settings: { originalUrl: 'old', playthroughOffsetSec: 12, volume: 40 } }, other: { updatedAt: 3, settings: null } } }, input.id, { playthroughUrl: 'new' }, 20)
    expect(patch.entries.synthetic).toMatchObject({ updatedAt: 101, settings: { originalUrl: 'old', playthroughUrl: 'new', playthroughOffsetSec: 12, volume: 40, originalOffsetSec: 0, playbackRate: 1 } })
    expect(Object.keys(patch.entries)).toEqual(['synthetic'])
  })
  it('refetches after one conflict and preserves newer settings in retry', async () => {
    const remoteTime = Date.now() + 100
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ id: input.id, updatedAt: 10, tags: ['first'] })).mockResolvedValueOnce(Response.json({}, { status: 409 })).mockResolvedValueOnce(Response.json({ id: input.id, updatedAt: remoteTime, tags: ['newer'] })).mockResolvedValueOnce(Response.json({ ok: true }))
    await registerSong(input, { base: 'https://example.test', clientId: 'id', clientSecret: 'secret' }, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(4)
    const retry = JSON.parse(fetcher.mock.calls[3][1].body)
    expect(retry.tags).toEqual(['newer'])
    expect(retry.updatedAt).toBeGreaterThan(remoteTime)
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', headers: { 'CF-Access-Client-Id': 'id', 'CF-Access-Client-Secret': 'secret' } })
  })
  it('dry-run makes no requests and reports fields without secrets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'register-song-'))
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not fetch'))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const gp = join(dir, 'Synthetic.gp')
      await writeFile(gp, Buffer.from('PK\x03\x04synthetic'))
      await main(['--gp', gp, '--dry-run', '--performance-url', 'https://youtu.be/abcdefghijk'], { BASS_PRACTICE_API_BASE: 'https://example.test', CF_ACCESS_CLIENT_SECRET: 'never-print-this' })
      expect(fetchSpy).not.toHaveBeenCalled()
      const printed = log.mock.calls[0][0]
      expect(printed).not.toContain('never-print-this')
      expect(JSON.parse(printed)).toMatchObject({ method: 'PUT', id: 'synthetic', gpBytes: 13, fields: expect.arrayContaining(['gpData', 'gpFormat', 'texData']), media: { fields: ['playthroughUrl'] } })
    } finally { fetchSpy.mockRestore(); log.mockRestore(); await rm(dir, { recursive: true, force: true }) }
  })
  it('stops after the second conflict', async () => {
    const fetcher = vi.fn().mockImplementation((_url, options) => Promise.resolve(options.method === 'GET' ? Response.json({}, { status: 404 }) : Response.json({}, { status: 409 })))
    await expect(registerSong(input, { base: 'https://example.test', clientId: 'id', clientSecret: 'secret' }, fetcher)).rejects.toThrow('409')
    expect(fetcher).toHaveBeenCalledTimes(4)
  })
})
