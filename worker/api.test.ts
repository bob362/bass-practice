// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import worker from './index'
import type { Env } from './index'
import { FakeR2 } from './testUtils'
import { emptyProgressDoc, sectionKey } from '../src/shared/syncMerge'
let data:FakeR2, env:Env
beforeEach(()=>{
  data = new FakeR2()
  env = {DATA:data as unknown as R2Bucket,ASSETS:{fetch:async()=>new Response('asset')} as unknown as Fetcher,ACCESS_TEAM_DOMAIN:'test',ACCESS_AUD:'test',DEV_FAKE_IDENTITY:'1'}
})
function request(path:string,method='GET',body?:unknown,email:string|null='User@Example.com',headers:Record<string,string>={}) {
  return worker.fetch(new Request(`https://test${path}`,{method,headers:{...(email ? {'X-Dev-User-Email':email} : {}),...headers},...(body !== undefined ? {body: typeof body === 'string' ? body : JSON.stringify(body)} : {})}),env,{} as ExecutionContext)
}
describe('worker API',()=>{
  it('authenticates API requests and passes assets through',async()=>{
    expect((await request('/api/songs','GET',undefined,null)).status).toBe(401)
    env.DEV_FAKE_IDENTITY = undefined
    expect((await request('/api/songs')).status).toBe(401)
    expect(await (await request('/app')).text()).toBe('asset')
  })
  it('puts, gets, paginates metadata and falls back to objects',async()=>{
    for (const id of ['c','a','b']) expect((await request(`/api/songs/${id}`,'PUT',{id,updatedAt:1,title:id,extra:true})).status).toBe(200)
    const first = [...data.objects.values()][0]; first.customMetadata = undefined
    expect(await (await request('/api/songs/a')).json()).toEqual({id:'a',updatedAt:1,title:'a',extra:true})
    expect(await (await request('/api/songs')).json()).toEqual(['a','b','c'].map(id=>({id,updatedAt:1,title:id})))
    expect((await request('/api/songs/missing')).status).toBe(404)
  })
  it('enforces LWW and equal-timestamp idempotence',async()=>{
    const song = {id:'a',updatedAt:5,title:'a'}
    await request('/api/songs/a','PUT',song)
    const sequence = data.sequence
    expect(await (await request('/api/songs/a','PUT',{...song,title:'other'})).json()).toEqual(song)
    expect(data.sequence).toBe(sequence)
    const conflict = await request('/api/songs/a','PUT',{id:'a',updatedAt:4})
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toEqual({error:'conflict',current:song})
    expect((await request('/api/songs/a?updatedAt=4','DELETE')).status).toBe(409)
    await request('/api/songs/a?updatedAt=6','DELETE')
    expect(await (await request('/api/songs')).json()).toEqual([{id:'a',updatedAt:6,deleted:true}])
    await request('/api/songs/a','PUT',{id:'a',updatedAt:7,deleted:true,title:'discard'})
    expect(await (await request('/api/songs/a')).json()).toEqual({id:'a',updatedAt:7,deleted:true})
    await request('/api/songs/b','DELETE')
    expect((await (await request('/api/songs/b')).json() as {updatedAt:number}).updatedAt).toBeGreaterThan(0)
  })
  it('isolates users',async()=>{
    await request('/api/songs/a','PUT',{id:'a',updatedAt:1})
    expect(await (await request('/api/songs','GET',undefined,'other@example.com')).json()).toEqual([])
  })
  it('rejects malformed IDs, mismatches, invalid JSON and oversized bodies',async()=>{
    for (const method of ['GET','PUT','DELETE']) expect((await request('/api/songs/bad%20id',method)).status).toBe(400)
    expect((await request('/api/songs/a','PUT',{id:'b',updatedAt:1})).status).toBe(400)
    expect((await request('/api/songs/a','PUT',{id:'a',updatedAt:'1'})).status).toBe(400)
    expect((await request('/api/songs/a','PUT','{')).status).toBe(400)
    expect((await request('/api/songs/a','PUT','{}',undefined,{'content-length':String(21*1024*1024)})).status).toBe(413)
    expect((await request('/api/songs/a','PUT',' '.repeat(20*1024*1024+1))).status).toBe(413)
    expect((await request('/api/settings','PUT',' '.repeat(2*1024*1024+1))).status).toBe(413)
    expect((await request('/api/progress','PUT','{}',undefined,{'content-length':String(6*1024*1024)})).status).toBe(413)
    expect((await request('/api/songs/a?updatedAt=oops','DELETE')).status).toBe(400)
  })
  it('merges settings and retries conditional writes',async()=>{
    expect(await (await request('/api/settings')).json()).toEqual({version:1,entries:{}})
    await request('/api/settings','PUT',{version:1,entries:{a:{updatedAt:2,settings:1}}})
    data.failPuts = 2
    expect(await (await request('/api/settings','PUT',{version:1,entries:{a:{updatedAt:1,settings:null},b:{updatedAt:3,settings:null}}})).json()).toEqual({version:1,entries:{a:{updatedAt:2,settings:1},b:{updatedAt:3,settings:null}}})
    data.failPuts = 3
    const busy = await request('/api/settings','PUT',{version:1,entries:{}})
    expect(busy.status).toBe(409)
    expect(await busy.json()).toEqual({error:'busy'})
    expect((await request('/api/settings','PUT',{version:1,entries:[]})).status).toBe(400)
  })
  it('preserves a competing settings write after an etag conflict',async()=>{
    await request('/api/settings','PUT',{version:1,entries:{a:{updatedAt:1,settings:'a'}}})
    const originalPut = data.put.bind(data)
    let compete = true
    data.put = async (key,value,options)=>{
      if (compete) {
        compete = false
        await originalPut(key,JSON.stringify({version:1,entries:{a:{updatedAt:1,settings:'a'},other:{updatedAt:2,settings:'concurrent'}}}))
      }
      return originalPut(key,value,options)
    }
    const response = await request('/api/settings','PUT',{version:1,entries:{b:{updatedAt:3,settings:'b'}}})
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({version:1,entries:{a:{updatedAt:1,settings:'a'},other:{updatedAt:2,settings:'concurrent'},b:{updatedAt:3,settings:'b'}}})
  })
  it('merges progress and normalizes legacy documents',async()=>{
    expect(await (await request('/api/progress')).json()).toEqual(emptyProgressDoc())
    await request('/api/progress','PUT',{version:1,sessions:[{id:'a'}],sections:[{songId:'a',id:'s',updatedAt:'2025-01-01'}]})
    await request('/api/progress','PUT',{...emptyProgressDoc(),sessions:[{id:'b'}],deletedSections:{[sectionKey('a','s')]:'2025-02-01'}})
    expect(await (await request('/api/progress')).json()).toEqual({...emptyProgressDoc(),sessions:[{id:'a'},{id:'b'}],deletedSections:{[sectionKey('a','s')]:'2025-02-01'}})
    expect((await request('/api/progress','PUT',{version:1,sessions:[],sections:[{id:'s'}]})).status).toBe(400)
    expect((await request('/api/progress','PUT','{')).status).toBe(400)
  })
  it('gets, merges and validates folders documents per user',async()=>{
    expect(await (await request('/api/folders')).json()).toEqual({version:1,folders:{}})
    await request('/api/folders','PUT',{version:1,folders:{f:{id:'f',name:'演奏',updatedAt:5}}})
    expect(await (await request('/api/folders','PUT',{version:1,folders:{f:{id:'f',name:'older rename',updatedAt:3}}})).json()).toEqual({version:1,folders:{f:{id:'f',name:'演奏',updatedAt:5}}})
    await request('/api/folders','PUT',{version:1,folders:{f:{id:'f',name:'演奏',updatedAt:6,deleted:true}}})
    expect(await (await request('/api/folders')).json()).toEqual({version:1,folders:{f:{id:'f',name:'演奏',updatedAt:6,deleted:true}}})
    await request('/api/folders','PUT',{version:1,folders:{f:{id:'f',name:'演奏',updatedAt:7}}})
    expect(await (await request('/api/folders')).json()).toEqual({version:1,folders:{f:{id:'f',name:'演奏',updatedAt:7}}})
    await request('/api/folders','PUT',{version:1,folders:{f:{id:'f',name:'演奏',updatedAt:8,deleted:true}}})
    expect(await (await request('/api/folders','GET',undefined,'other@example.com')).json()).toEqual({version:1,folders:{}})
    const busy = await request('/api/folders','PUT',{version:1,folders:{}})
    expect(busy.status).not.toBe(405)
    expect((await request('/api/folders','PUT',{version:1,folders:[]})).status).toBe(400)
    expect((await request('/api/folders','PUT',{version:1,folders:{f:{id:'other',name:'x',updatedAt:1}}})).status).toBe(400)
    expect((await request('/api/folders','PUT',{version:1,folders:{f:{id:'f',name:'x'.repeat(101),updatedAt:1}}})).status).toBe(400)
    expect((await request('/api/folders','PUT',{version:1,folders:{f:{id:'f',name:'x',updatedAt:'1'}}})).status).toBe(400)
    expect((await request('/api/folders','PUT',{version:1,folders:{f:{id:'f',name:'x',updatedAt:1,deleted:null}}})).status).toBe(400)
    expect((await request('/api/folders','PUT',' '.repeat(1024*1024+1))).status).toBe(413)
    expect((await request('/api/folders','DELETE')).status).toBe(405)
  })
  it('returns consistent JSON errors for routes, methods and storage failures',async()=>{
    expect((await request('/api/unknown')).status).toBe(404)
    for (const path of ['/api/songs','/api/songs/a','/api/settings','/api/progress','/api/folders']) expect((await request(path,'POST')).status).toBe(405)
    data.list = async()=>{throw new Error('storage unavailable')}
    const response = await request('/api/songs')
    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
  })
  it('fake R2 supports unconditional creation and enforces etags',async()=>{
    expect(await data.put('a','1',{})).not.toBeNull()
    expect(await data.put('a','2',{})).not.toBeNull()
    expect(await data.put('a','2',{onlyIf:{etagMatches:'wrong'}})).toBeNull()
    const obj = await data.get('a')
    expect(await data.put('a','2',{onlyIf:{etagMatches:obj!.etag}})).not.toBeNull()
  })
})

it('uses JSON keys, bounded metadata and unconditional initial writes',async()=>{
  const put = data.put.bind(data)
  data.put = async (key,value,options)=>{
    if (!data.objects.has(key)) expect(options?.onlyIf).toBeUndefined()
    return put(key,value,options)
  }
  const song = {id:'long',updatedAt:1,title:'猫'.repeat(500),artist:'犬'.repeat(500)}
  expect((await request('/api/songs/long','PUT',song)).status).toBe(200)
  const [key,stored] = [...data.objects.entries()][0]
  expect(key.endsWith('/songs/long.json')).toBe(true)
  expect(JSON.parse(stored.customMetadata!.summary).title).toHaveLength(200)
  expect(JSON.parse(stored.customMetadata!.summary).artist).toHaveLength(200)
  expect(await (await request('/api/songs/long')).json()).toEqual(song)
  expect((await request('/api/progress','PUT',{...emptyProgressDoc(),sections:[{id:'s',songId:'a',updatedAt:'invalid'}]})).status).toBe(400)
})
