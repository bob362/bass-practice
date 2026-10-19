export class FakeR2 {
  objects = new Map<string,{text:string;etag:string;customMetadata?:Record<string,string>}>()
  sequence = 0
  failPuts = 0
  pageSize = 2
  async get(key:string) {
    const stored = this.objects.get(key)
    return stored ? {key,etag:stored.etag,customMetadata:stored.customMetadata,json:async <T=unknown>():Promise<T> => JSON.parse(stored.text),text:async () => stored.text} : null
  }
  async put(key:string,value:string,options?:{customMetadata?:Record<string,string>;onlyIf?:{etagMatches?:string}}) {
    if (this.failPuts > 0) { this.failPuts--; return null }
    const old = this.objects.get(key), condition = options?.onlyIf
    if ((condition?.etagMatches !== undefined && condition.etagMatches !== old?.etag)) return null
    const stored = {text:value,etag:String(++this.sequence),customMetadata:options?.customMetadata}
    this.objects.set(key,stored)
    return {key,etag:stored.etag}
  }
  async list(options:{prefix?:string;cursor?:string;limit?:number;include?:string[]}) {
    const all = [...this.objects.keys()].filter(k=>k.startsWith(options.prefix ?? '')).sort()
    const start = Number(options.cursor ?? 0), end = start + Math.min(options.limit ?? this.pageSize,this.pageSize)
    return {objects:all.slice(start,end).map(key=>({key,etag:this.objects.get(key)!.etag,...(options.include?.includes('customMetadata') ? {customMetadata:this.objects.get(key)!.customMetadata} : {})})),truncated:end<all.length,...(end<all.length ? {cursor:String(end)} : {})}
  }
}
