// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { emptyMediaDoc, emptyProgressDoc, ensureUpdatedAt, isMediaDoc, isNewer, isProgressDoc, mergeMediaDocs, mergeProgressDocs, normalizeProgressDoc, planSongSync, sectionKey, summarizeSong } from './syncMerge'
describe('songs',()=>{
  it('summarizes only supported defined fields',()=>{
    expect(summarizeSong({id:'a',updatedAt:1,deleted:false,title:'t',artist:'a',createdAt:0,extra:4})).toEqual({id:'a',updatedAt:1,title:'t',artist:'a',createdAt:0})
    expect(summarizeSong({id:'a',updatedAt:1,deleted:true})).toEqual({id:'a',updatedAt:1,deleted:true})
  })
  it('backfills timestamps and compares strictly',()=>{
    expect(ensureUpdatedAt({updatedAt:0,createdAt:3},9).updatedAt).toBe(0)
    expect(ensureUpdatedAt({updatedAt:NaN,createdAt:3},9).updatedAt).toBe(3)
    expect(ensureUpdatedAt({updatedAt:Infinity,createdAt:'3'},9).updatedAt).toBe(9)
    expect(isNewer({updatedAt:1},null)).toBe(true)
    expect(isNewer({updatedAt:1},{updatedAt:1})).toBe(false)
    expect(isNewer({updatedAt:2},{updatedAt:1})).toBe(true)
  })
  it('plans all reconciliation branches in sorted order',()=>{
    const local = ['z','a','b','c','d','e','f'].map(id=>({id,updatedAt:5}))
    const remote = [{id:'a',updatedAt:5,deleted:true},{id:'b',updatedAt:4,deleted:true},{id:'c',updatedAt:6},{id:'d',updatedAt:4},{id:'e',updatedAt:5},{id:'g',updatedAt:5},{id:'h',updatedAt:5},{id:'i',updatedAt:5},{id:'j',updatedAt:5,deleted:true},{id:'k',updatedAt:5,deleted:true}]
    expect(planSongSync(local,{g:5,h:4,j:4,l:3},remote)).toEqual({pull:['c','h','i'],push:['b','d','f','z'],deleteLocal:['a'],pushDelete:['g','l']})
  })
})
describe('media',()=>{
  it('merges entries by timestamp with b winning ties',()=>{
    const a = {version:1 as const,entries:{a:{updatedAt:2,settings:1},b:{updatedAt:3,settings:1}}}, b = {version:1 as const,entries:{a:{updatedAt:2,settings:null},b:{updatedAt:1,settings:2},c:{updatedAt:4,settings:{x:true}}}}
    expect(mergeMediaDocs(a,b).entries).toEqual({...b.entries,b:a.entries.b})
    expect(mergeMediaDocs(a,a)).toEqual(a)
    expect(mergeMediaDocs(emptyMediaDoc(),a)).toEqual(a)
    expect(a.entries.a.settings).toBe(1)
    expect(isMediaDoc(a)).toBe(true)
    for (const v of [null,{version:1,entries:[]},{version:1,entries:{a:{updatedAt:NaN,settings:1}}},{version:1,entries:{a:{updatedAt:1}}}]) expect(isMediaDoc(v)).toBe(false)
  })
})
describe('progress',()=>{
  const early = '2025-01-01T00:00:00Z', later = '2025-02-01T00:00:00Z'
  it('unions records, uses newer sections, retains maximum tempo and tombstones',()=>{
    const a = {...emptyProgressDoc(),sessions:[{id:'a',v:1}],accuracy:[{id:'a'}],sections:[{id:'s',songId:'song',updatedAt:early,maxTempoPercent:120}],deletedSections:{old:early}}
    const b = {...emptyProgressDoc(),sessions:[{id:'a',v:2},{id:'b'}],accuracy:[{id:'b'}],sections:[{id:'s',songId:'song',updatedAt:later,maxTempoPercent:80}],deletedSections:{old:later}}
    const merged = mergeProgressDocs(a,b)
    expect(merged.sessions).toEqual(b.sessions)
    expect(merged.accuracy).toEqual([{id:'a'},{id:'b'}])
    expect(merged.sections).toEqual([{...b.sections[0],maxTempoPercent:120}])
    expect(merged.deletedSections).toEqual({old:later})
    expect(mergeProgressDocs(a,a)).toEqual(a)
    expect(mergeProgressDocs(a,b).sections).toEqual(mergeProgressDocs(b,a).sections)
  })
  it('drops older and equal sections but permits newer recreation; scopes keys by song',()=>{
    const a = {...emptyProgressDoc(),sections:[{id:'s',songId:'a',updatedAt:early},{id:'s',songId:'b',updatedAt:later}]}
    const tomb = {...emptyProgressDoc(),deletedSections:{[sectionKey('a','s')]:early,[sectionKey('b','s')]:early}}
    expect(mergeProgressDocs(a,tomb).sections).toEqual([a.sections[1]])
    expect(mergeProgressDocs(a,tomb).deletedSections).toEqual(tomb.deletedSections)
  })
  it('uses b on section ties and validates legacy optional fields',()=>{
    const a = {...emptyProgressDoc(),sections:[{id:'s',songId:'a',updatedAt:early,v:1}]}
    expect(mergeProgressDocs(a,{...a,sections:[{...a.sections[0],v:2}]}).sections[0].v).toBe(2)
    expect(isProgressDoc({version:1,sessions:[],sections:[]})).toBe(true)
    expect(normalizeProgressDoc({version:1,sessions:[],sections:[]})).toEqual(emptyProgressDoc())
    expect(isProgressDoc({...a,sections:[{id:'x'}]})).toBe(false)
    expect(isProgressDoc({...a,deletedSections:{x:1}})).toBe(false)
  })
})

it('rejects invalid section and tombstone dates',()=>{
  for (const date of ['invalid','',123,null]) {
    expect(isProgressDoc({...emptyProgressDoc(),sections:[{id:'s',songId:'a',updatedAt:date}]})).toBe(false)
    expect(isProgressDoc({...emptyProgressDoc(),deletedSections:{s:date}})).toBe(false)
  }
})
