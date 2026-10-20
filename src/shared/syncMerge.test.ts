// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { emptyFoldersDoc, emptyMediaDoc, emptyProgressDoc, ensureUpdatedAt, isFoldersDoc, isMediaDoc, isNewer, isProgressDoc, mergeFoldersDocs, mergeMediaDocs, mergeProgressDocs, normalizeProgressDoc, planSongSync, sectionKey, summarizeSong } from './syncMerge'
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
describe('folders',()=>{
  it('merges commutatively with deleted winning equal timestamps and larger names breaking ties',()=>{
    const a = {version:1 as const,folders:{f:{id:'f',name:'x',updatedAt:5},g:{id:'g',name:'a',updatedAt:3}}}, b = {version:1 as const,folders:{f:{id:'f',name:'renamed',updatedAt:3},g:{id:'g',name:'b',updatedAt:3},h:{id:'h',name:'new',updatedAt:9}}}
    expect(mergeFoldersDocs(a,b)).toEqual(mergeFoldersDocs(b,a))
    expect(mergeFoldersDocs(a,b).folders.f).toEqual({id:'f',name:'x',updatedAt:5})
    expect(mergeFoldersDocs(a,b).folders.g).toEqual({id:'g',name:'b',updatedAt:3})
    expect(mergeFoldersDocs(b,a).folders.f).toEqual({id:'f',name:'x',updatedAt:5})
    expect(mergeFoldersDocs(b,a).folders.g).toEqual({id:'g',name:'b',updatedAt:3})
    expect(mergeFoldersDocs(emptyFoldersDoc(),a).folders.f).toEqual(a.folders.f)
    expect(mergeFoldersDocs(a,b).folders.h).toEqual({id:'h',name:'new',updatedAt:9})
    expect(mergeFoldersDocs(a,a).folders.f).toEqual(a.folders.f)
  })
  it('keeps tombstones so older renames never resurrect deleted folders',()=>{
    const alive = {version:1 as const,folders:{f:{id:'f',name:'x',updatedAt:5}}}
    const tomb = {version:1 as const,folders:{f:{id:'f',name:'x',updatedAt:6,deleted:true}}}
    expect(mergeFoldersDocs(alive,tomb).folders.f.deleted).toBe(true)
    expect(mergeFoldersDocs(alive,tomb)).toEqual(mergeFoldersDocs(tomb,alive))
    expect(mergeFoldersDocs(tomb,{version:1 as const,folders:{f:{id:'f',name:'later rename',updatedAt:6}}}).folders.f.deleted).toBe(true)
    expect(mergeFoldersDocs(tomb,{version:1 as const,folders:{f:{id:'f',name:'older rename',updatedAt:4}}}).folders.f.deleted).toBe(true)
  })
  it('validates document shape',()=>{
    expect(isFoldersDoc(emptyFoldersDoc())).toBe(true)
    expect(isFoldersDoc({version:1,folders:{f:{id:'f',name:'名前'.repeat(20),updatedAt:1,deleted:true}}})).toBe(true)
    for (const v of [null,{version:1,folders:[]},{version:2,folders:{}},{version:1},{version:1,folders:{f:{id:'other',name:'x',updatedAt:1}}},{version:1,folders:{f:{id:'f',name:'x'.repeat(101),updatedAt:1}}},{version:1,folders:{f:{id:'f',name:'x',updatedAt:'1'}}},{version:1,folders:{f:{id:'f',name:'x',updatedAt:NaN}}},{version:1,folders:{f:{id:'f',name:'x',updatedAt:1,deleted:'yes'}}},{version:1,folders:{f:{name:'x',updatedAt:1}}}]) expect(isFoldersDoc(v)).toBe(false)
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
