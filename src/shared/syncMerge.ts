export interface SongRecord { id: string; updatedAt: number; deleted?: boolean; title?: string; artist?: string; createdAt?: number; [k: string]: unknown }
export interface SongSummary { id: string; updatedAt: number; deleted?: boolean; title?: string; artist?: string; createdAt?: number }
export function summarizeSong(s: SongRecord): SongSummary {
  return { id: s.id, updatedAt: s.updatedAt, ...(s.deleted === true ? { deleted: true } : {}), ...(s.title !== undefined ? { title: s.title } : {}), ...(s.artist !== undefined ? { artist: s.artist } : {}), ...(s.createdAt !== undefined ? { createdAt: s.createdAt } : {}) }
}
export function isNewer(a: {updatedAt:number}, b: {updatedAt:number} | null | undefined): boolean { return !b || a.updatedAt > b.updatedAt }
export function ensureUpdatedAt<T extends {updatedAt?: unknown; createdAt?: unknown}>(s: T, now: number): T & {updatedAt:number} {
  return { ...s, updatedAt: typeof s.updatedAt === 'number' && Number.isFinite(s.updatedAt) ? s.updatedAt : typeof s.createdAt === 'number' && Number.isFinite(s.createdAt) ? s.createdAt : now }
}
export interface SongPlan { pull: string[]; push: string[]; deleteLocal: string[]; pushDelete: string[] }
export function planSongSync(local: {id:string; updatedAt:number}[], localTombstones: Record<string, number>, remote: SongSummary[]): SongPlan {
  const plan: SongPlan = {pull: [], push: [], deleteLocal: [], pushDelete: []}
  const ls = new Map(local.map(s => [s.id, s])), rs = new Map(remote.map(s => [s.id, s]))
  for (const id of [...new Set([...ls.keys(), ...rs.keys(), ...Object.keys(localTombstones)])].sort()) {
    const l = ls.get(id), r = rs.get(id), t = localTombstones[id]
    if (r?.deleted) { if (l) plan[r.updatedAt >= l.updatedAt ? 'deleteLocal' : 'push'].push(id) }
    else if (r && l) { if (r.updatedAt !== l.updatedAt) plan[r.updatedAt > l.updatedAt ? 'pull' : 'push'].push(id) }
    else if (r) plan[t !== undefined && t >= r.updatedAt ? 'pushDelete' : 'pull'].push(id)
    else if (l) plan.push.push(id)
    else plan.pushDelete.push(id)
  }
  return plan
}
export interface MediaEntry { updatedAt: number; settings: unknown | null }
export interface MediaDoc { version: 1; entries: Record<string, MediaEntry> }
export function emptyMediaDoc(): MediaDoc { return {version: 1, entries: {}} }
const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)
export function isMediaDoc(v: unknown): v is MediaDoc { return plain(v) && v.version === 1 && plain(v.entries) && Object.values(v.entries).every(e => plain(e) && typeof e.updatedAt === 'number' && Number.isFinite(e.updatedAt) && Object.prototype.hasOwnProperty.call(e, 'settings')) }
export function mergeMediaDocs(a: MediaDoc, b: MediaDoc): MediaDoc {
  const entries = {...a.entries}
  for (const [k, e] of Object.entries(b.entries)) { if (!Object.prototype.hasOwnProperty.call(entries, k) || e.updatedAt >= entries[k].updatedAt) Object.defineProperty(entries, k, {value: {...e}, enumerable: true, writable: true, configurable: true}) }
  return {version: 1, entries}
}
export interface ProgressDoc { version: 1; sessions: {id:string; [k:string]:unknown}[]; sections: {id:string; songId:string; updatedAt:string; maxTempoPercent?: number; [k:string]:unknown}[]; accuracy: {id:string; [k:string]:unknown}[]; deletedSections: Record<string, string> }
export function emptyProgressDoc(): ProgressDoc { return {version: 1, sessions: [], sections: [], accuracy: [], deletedSections: {}} }
export function sectionKey(songId: string, id: string): string { return `${songId}\u0000${id}` }
export function isProgressDoc(v: unknown): boolean {
  const items = (x: unknown) => Array.isArray(x) && x.every(e => plain(e) && typeof e.id === 'string')
  return plain(v) && v.version === 1 && items(v.sessions) && items(v.sections) && (v.sections as Record<string, unknown>[]).every(s => typeof s.songId === 'string' && typeof s.updatedAt === 'string' && Number.isFinite(Date.parse(s.updatedAt))) && (v.accuracy === undefined || items(v.accuracy)) && (v.deletedSections === undefined || (plain(v.deletedSections) && Object.values(v.deletedSections).every(x => typeof x === 'string' && Number.isFinite(Date.parse(x)))))
}
export function normalizeProgressDoc(v: any): ProgressDoc { return {...v, accuracy: v.accuracy ?? [], deletedSections: v.deletedSections ?? {}} }
export function mergeProgressDocs(a: ProgressDoc, b: ProgressDoc): ProgressDoc {
  const union = <T extends {id:string}>(x:T[], y:T[]):T[] => [...new Map([...x, ...y].map(e => [e.id, e])).values()]
  const deletedSections = {...a.deletedSections}
  for (const [k,v] of Object.entries(b.deletedSections)) if (!Object.prototype.hasOwnProperty.call(deletedSections,k) || Date.parse(v) >= Date.parse(deletedSections[k])) Object.defineProperty(deletedSections,k,{value:v,enumerable:true,configurable:true,writable:true})
  const sections = new Map<string, ProgressDoc['sections'][number]>()
  for (const s of [...a.sections, ...b.sections]) {
    const k = sectionKey(s.songId,s.id), old = sections.get(k)
    const winner = !old || Date.parse(s.updatedAt) >= Date.parse(old.updatedAt) ? s : old
    const tempos = [old?.maxTempoPercent,s.maxTempoPercent].filter((x):x is number => typeof x === 'number')
    sections.set(k, {...winner, ...(tempos.length ? {maxTempoPercent: Math.max(...tempos)} : {})})
  }
  return {version:1,sessions:union(a.sessions,b.sessions),accuracy:union(a.accuracy,b.accuracy),deletedSections,sections:[...sections].filter(([k,s]) => !(Date.parse(deletedSections[k]) >= Date.parse(s.updatedAt))).map(([,s]) => s)}
}
