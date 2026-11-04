#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const ID = /^[A-Za-z0-9_\-.]{1,128}$/
const DEFAULT_SETTINGS = { playthroughOffsetSec: 0, originalOffsetSec: 0, playbackRate: 1, volume: 100, bassVolume: 100, masterVolume: 100, muted: false }
export function parseArgs(args) {
  const out = {}
  const values = new Set(['gp', 'title', 'artist', 'id', 'original-url', 'performance-url', 'env-file'])
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, '')
    if (args[i] === '--dry-run' || args[i] === '--help') out[key] = true
    else if (args[i].startsWith('--') && values.has(key) && args[i + 1] && !args[i + 1].startsWith('--')) out[key] = args[++i]
    else throw new Error(`Unknown argument or missing value: ${args[i]}`)
  }
  return out
}
export function parseEnv(text) {
  const out = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) throw new Error('Invalid env file line (expected KEY=VALUE)')
    let value = match[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    else value = value.replace(/\s+#.*$/, '').trim()
    out[match[1]] = value
  }
  return out
}
export function songId(title, explicit) {
  if (explicit !== undefined) {
    if (!ID.test(explicit) || explicit === '.' || explicit === '..') throw new Error('Invalid --id (use 1–128 letters, digits, _, -, or .)')
    return explicit
  }
  const slug = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 128)
  return (slug && slug !== '.' && slug !== '..' ? slug : '') || `song-${createHash('sha256').update(title).digest('hex').slice(0, 24)}`
}
export function youtubeUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('Invalid YouTube URL') }
  const host = url.hostname.toLowerCase()
  const video = host === 'youtu.be' ? url.pathname.slice(1) : ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host) ? (url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:embed|shorts|live)\/([^/]+)\/?$/.exec(url.pathname)?.[1]) : null
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || !/^[A-Za-z0-9_-]{11}$/.test(video ?? '')) throw new Error('Invalid YouTube video URL')
  return value
}
export function buildSong(existing, input, now = Date.now()) {
  const updatedAt = Math.max(now, (existing?.updatedAt ?? 0) + 1)
  if (!Number.isSafeInteger(updatedAt)) throw new Error('Song timestamp cannot be advanced safely')
  const song = { ...existing, id: input.id, title: input.title, texData: '', gpData: input.bytes.toString('base64'), gpFormat: input.format, createdAt: existing?.createdAt ?? now, updatedAt }
  delete song.deleted
  if (input.artist !== undefined) song.artist = input.artist
  return song
}
export function buildMedia(doc, id, urls, now = Date.now()) {
  if (doc?.version !== 1 || !doc.entries || typeof doc.entries !== 'object' || Array.isArray(doc.entries)) throw new Error('Invalid settings document')
  const previous = Object.hasOwn(doc.entries, id) ? doc.entries[id] : undefined
  const updatedAt = Math.max(now, (previous?.updatedAt ?? 0) + 1)
  if (!Number.isSafeInteger(updatedAt)) throw new Error('Settings timestamp cannot be advanced safely')
  return { version: 1, entries: { [id]: { updatedAt, settings: { ...DEFAULT_SETTINGS, ...previous?.settings, ...urls } } } }
}
export async function registerSong(input, config, fetcher = fetch) {
  const base = new URL(config.base)
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || !['', '/'].includes(base.pathname)) throw new Error('BASS_PRACTICE_API_BASE must be an HTTP(S) origin')
  const headers = { 'Content-Type': 'application/json', 'CF-Access-Client-Id': config.clientId, 'CF-Access-Client-Secret': config.clientSecret }
  async function request(path, method = 'GET', body) {
    // Access redirects can otherwise turn an authentication failure into HTML, or leak credentials.
    const response = await fetcher(new URL(path, base), { method, headers, redirect: 'error', ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    if (!response.ok && response.status !== 404 && response.status !== 409) throw new Error(`${method} ${path}: HTTP ${response.status}`)
    return response
  }
  const path = `/api/songs/${encodeURIComponent(input.id)}`
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await request(path)
    if (current.status !== 200 && current.status !== 404) throw new Error(`GET song: HTTP ${current.status}`)
    const existing = current.status === 404 ? null : await current.json()
    if (existing && (existing.id !== input.id || !Number.isFinite(existing.updatedAt))) throw new Error('Invalid song response')
    const response = await request(path, 'PUT', buildSong(existing, input))
    if (response.status === 409 && attempt === 0) continue
    if (!response.ok) throw new Error(`PUT song: HTTP ${response.status}`)
    break
  }
  if (Object.keys(input.urls).length) {
    // Video URLs belong to the media document, not to the song record.
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const current = await request('/api/settings')
        if (!current.ok) throw new Error(`GET settings: HTTP ${current.status}`)
        const patch = buildMedia(await current.json(), input.id, input.urls)
        const response = await request('/api/settings', 'PUT', patch)
        if (response.status === 409 && attempt === 0) continue
        if (!response.ok) throw new Error(`PUT settings: HTTP ${response.status}`)
        break
      }
    } catch (error) { throw new Error(`Song saved, but URLs were not confirmed; rerun to update URLs. ${error.message}`) }
  }
}
export async function main(args = process.argv.slice(2), env = process.env) {
  const options = parseArgs(args)
  if (options.help) {
    console.log('Usage: node scripts/register-song.mjs --gp file.gp [--title title] [--artist artist] [--id id] [--original-url YouTubeURL] [--performance-url YouTubeURL] [--env-file path] [--dry-run]')
    return
  }
  if (!options.gp) throw new Error('--gp is required')
  const config = { ...(options['env-file'] ? parseEnv(await readFile(options['env-file'], 'utf8')) : {}), ...env }
  const format = extname(options.gp).slice(1).toLowerCase()
  if (!['gp', 'gp3', 'gp4', 'gp5', 'gpx'].includes(format)) throw new Error('Unsupported Guitar Pro extension')
  const bytes = await readFile(options.gp)
  const head = bytes.subarray(0, 4).toString('latin1')
  if (!['PK\x03\x04', 'BCFZ', 'BCFS'].includes(head) && !bytes.subarray(1, 19).toString('latin1').startsWith('FICHIER GUITAR')) throw new Error('Unrecognized Guitar Pro file header')
  if (bytes.length > 2 * 1024 * 1024) throw new Error('Guitar Pro file exceeds the app import limit (2 MiB)')
  const title = (options.title ?? basename(options.gp, extname(options.gp))).trim()
  if (!title) throw new Error('Title must not be empty')
  const urls = {}
  if (options['original-url'] !== undefined) urls.originalUrl = youtubeUrl(options['original-url'])
  if (options['performance-url'] !== undefined) urls.playthroughUrl = youtubeUrl(options['performance-url'])
  const input = { id: songId(title, options.id), title, artist: options.artist, bytes, format, urls }
  if (!config.BASS_PRACTICE_API_BASE) throw new Error('BASS_PRACTICE_API_BASE is required')
  const base = new URL(config.BASS_PRACTICE_API_BASE)
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('BASS_PRACTICE_API_BASE must be an HTTP(S) origin')
  if (options['dry-run']) {
    console.log(JSON.stringify({ method: 'PUT', url: new URL(`/api/songs/${input.id}`, base).href, id: input.id, title, fields: Object.keys(buildSong(null, input)), gpBytes: bytes.length, ...(Object.keys(urls).length ? { media: { method: 'PUT', url: new URL('/api/settings', base).href, fields: Object.keys(urls) } } : {}) }, null, 2))
    return
  }
  if (!config.CF_ACCESS_CLIENT_ID || !config.CF_ACCESS_CLIENT_SECRET) throw new Error('CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are required')
  await registerSong(input, { base: base.href, clientId: config.CF_ACCESS_CLIENT_ID, clientSecret: config.CF_ACCESS_CLIENT_SECRET })
  console.log(`Registered ${input.id}: ${title}`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
