import type { Env } from './index'
import { emptyFoldersDoc, emptyMediaDoc, emptyProgressDoc, isFoldersDoc, isMediaDoc, isProgressDoc, mergeFoldersDocs, mergeMediaDocs, mergeProgressDocs, normalizeProgressDoc, summarizeSong } from '../src/shared/syncMerge'
import type { SongRecord } from '../src/shared/syncMerge'
export function json(value:unknown,status=200):Response { return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}}) }
class HttpError extends Error { constructor(public status:number, message:string) { super(message) } }
async function body(req:Request,limit:number):Promise<unknown> {
  if (Number(req.headers.get('content-length')) > limit) throw new HttpError(413,'too large')
  const text = await req.text()
  if (new TextEncoder().encode(text).byteLength > limit) throw new HttpError(413,'too large')
  try { return JSON.parse(text) } catch { throw new HttpError(400,'invalid JSON') }
}
export async function handleApi(req:Request,env:Env,identity:string):Promise<Response> {
  try {
    const hash = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity))
    const prefix = `u/${Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')}/`
    const url = new URL(req.url), path = url.pathname, method = req.method
    if (path === '/api/songs') {
      if (method !== 'GET') return json({error:'method not allowed'},405)
      const summaries = []
      let cursor:string|undefined
      do {
        const page = await env.DATA.list({prefix:`${prefix}songs/`,cursor,include:['customMetadata']})
        for (const o of page.objects) {
          if (o.customMetadata?.summary) summaries.push(JSON.parse(o.customMetadata.summary))
          else { const value = await env.DATA.get(o.key); if (value) summaries.push(summarizeSong({...await value.json<SongRecord>(),id:o.key.slice(`${prefix}songs/`.length).replace(/\.json$/, '')})) }
        }
        cursor = page.truncated ? page.cursor : undefined
      } while (cursor !== undefined)
      return json(summaries)
    }
    if (path.startsWith('/api/songs/')) {
      let id:string
      try { id = decodeURIComponent(path.slice('/api/songs/'.length)) } catch { throw new HttpError(400,'invalid id') }
      if (!/^[A-Za-z0-9_\-.]{1,128}$/.test(id)) throw new HttpError(400,'invalid id')
      if (!['GET','PUT','DELETE'].includes(method)) return json({error:'method not allowed'},405)
      const key = `${prefix}songs/${id}.json`
      if (method === 'GET') { const obj = await env.DATA.get(key); return obj ? json(await obj.json()) : json({error:'not found'},404) }
      let song:SongRecord
      if (method === 'PUT') {
        const v = await body(req,20*1024*1024)
        if (!v || typeof v !== 'object' || Array.isArray(v) || (v as SongRecord).id !== id || typeof (v as SongRecord).updatedAt !== 'number' || !Number.isFinite((v as SongRecord).updatedAt)) throw new HttpError(400,'invalid song')
        song = v as SongRecord
        if (song.deleted === true) song = {id,deleted:true,updatedAt:song.updatedAt}
      } else {
        const param = url.searchParams.get('updatedAt'), updatedAt = param === null ? Date.now() : Number(param)
        if (!Number.isFinite(updatedAt) || param?.trim() === '') throw new HttpError(400,'invalid updatedAt')
        song = {id,deleted:true,updatedAt}
      }
      for (let attempt=0;attempt<3;attempt++) {
        const obj = await env.DATA.get(key), current = obj ? await obj.json<SongRecord>() : null
        if (current && current.updatedAt > song.updatedAt) return json({error:'conflict',current},409)
        if (method === 'PUT' && current?.updatedAt === song.updatedAt) return json(current)
        const summary = summarizeSong(song)
        if (typeof summary.title === 'string') summary.title = summary.title.slice(0,200)
        if (typeof summary.artist === 'string') summary.artist = summary.artist.slice(0,200)
        const result = await env.DATA.put(key,JSON.stringify(song),{customMetadata:{summary:JSON.stringify(summary)},...(obj ? {onlyIf:{etagMatches:obj.etag}} : {})})
        if (result) return method === 'DELETE' ? json({ok:true}) : json({ok:true,song:summarizeSong(song)})
      }
      return json({error:'busy'},409)
    }
    if (path === '/api/settings' || path === '/api/progress') {
      if (method !== 'GET' && method !== 'PUT') return json({error:'method not allowed'},405)
      const media = path === '/api/settings', key = `${prefix}${media ? 'settings' : 'progress'}.json`
      if (method === 'GET') { const obj = await env.DATA.get(key); return json(obj ? (media ? await obj.json() : normalizeProgressDoc(await obj.json())) : media ? emptyMediaDoc() : emptyProgressDoc()) }
      const incoming = await body(req,(media ? 2 : 5)*1024*1024)
      if (!(media ? isMediaDoc(incoming) : isProgressDoc(incoming))) throw new HttpError(400,'invalid document')
      for (let attempt=0;attempt<3;attempt++) {
        const obj = await env.DATA.get(key)
        const merged = media ? mergeMediaDocs(obj ? await obj.json() : emptyMediaDoc(),incoming as ReturnType<typeof emptyMediaDoc>) : mergeProgressDocs(obj ? normalizeProgressDoc(await obj.json()) : emptyProgressDoc(),normalizeProgressDoc(incoming))
        const result = await env.DATA.put(key,JSON.stringify(merged),obj ? {onlyIf:{etagMatches:obj.etag}} : undefined)
        if (result) return json(merged)
      }
      return json({error:'busy'},409)
    }
    if (path === '/api/folders') {
      if (method !== 'GET' && method !== 'PUT') return json({error:'method not allowed'},405)
      const key = `${prefix}folders.json`
      if (method === 'GET') { const obj = await env.DATA.get(key); return json(obj ? await obj.json() : emptyFoldersDoc()) }
      const incoming = await body(req,1024*1024)
      if (!isFoldersDoc(incoming)) throw new HttpError(400,'invalid document')
      for (let attempt=0;attempt<3;attempt++) {
        const obj = await env.DATA.get(key)
        const merged = mergeFoldersDocs(obj ? await obj.json() : emptyFoldersDoc(),incoming)
        const result = await env.DATA.put(key,JSON.stringify(merged),obj ? {onlyIf:{etagMatches:obj.etag}} : undefined)
        if (result) return json(merged)
      }
      return json({error:'busy'},409)
    }
    return json({error:'not found'},404)
  } catch (e) { return e instanceof HttpError ? json({error:e.message},e.status) : json({error:'internal server error'},500) }
}
