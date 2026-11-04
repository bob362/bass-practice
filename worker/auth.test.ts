// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetJwksCache, identify, verifyAccessJwt } from './auth'
import type { Env } from './index'
const teamDomain = 'test.cloudflareaccess.com', aud = 'app', now = 10000
let pair:CryptoKeyPair, jwk:JsonWebKey & {kid:string}
const encode = (v:unknown) => btoa(JSON.stringify(v)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
async function token(claims:Record<string,unknown>={},header:Record<string,unknown>={}) {
  const h = encode({alg:'RS256',kid:'one',...header}), p = encode({iss:`https://${teamDomain}`,aud,exp:now+300,email:'USER@example.com',...claims})
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(`${h}.${p}`)))
  return `${h}.${p}.${btoa(String.fromCharCode(...signature)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}`
}
beforeAll(async()=>{
  pair = await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']) as CryptoKeyPair
  jwk = {...(await crypto.subtle.exportKey('jwk',pair.publicKey) as JsonWebKey),kid:'one'}
})
beforeEach(()=>{ _resetJwksCache(); vi.unstubAllGlobals() })
describe('JWT verification',()=>{
  const opts = () => ({teamDomain,aud,now,fetchJwks:vi.fn(async()=>({keys:[jwk]}))})
  it('verifies valid signatures and caches JWKS',async()=>{
    const o = opts(), t = await token()
    expect(await verifyAccessJwt(t,o)).toEqual({email:'USER@example.com'})
    await verifyAccessJwt(t,o)
    expect(o.fetchJwks).toHaveBeenCalledTimes(1)
  })
  it('supports audience arrays and expiry/nbf leeway',async()=>{
    await expect(verifyAccessJwt(await token({aud:['other',aud],exp:now-59,nbf:now+60}),opts())).resolves.toBeDefined()
  })
  it.each([{aud:'other'},{iss:'https://evil.test'},{exp:now-61},{nbf:now+61},{exp:'forever'}])('rejects invalid claims %j',async claims=>{
    await expect(verifyAccessJwt(await token(claims),opts())).rejects.toThrow()
  })
  it.each(['none','HS256'])('rejects %s',async alg=>{ await expect(verifyAccessJwt(await token({},{alg}),opts())).rejects.toThrow() })
  it('rejects invalid signatures and malformed tokens',async()=>{
    const t = await token()
    await expect(verifyAccessJwt(`${t.slice(0,t.lastIndexOf('.')+1)}AAAA`,opts())).rejects.toThrow()
    await expect(verifyAccessJwt('invalid',opts())).rejects.toThrow()
  })
  it('refetches for unknown kid, rejects when still missing',async()=>{
    const o = opts()
    await verifyAccessJwt(await token(),o)
    await expect(verifyAccessJwt(await token({},{kid:'missing'}),o)).rejects.toThrow()
    expect(o.fetchJwks).toHaveBeenCalledTimes(2)
  })
  it('refreshes cached keys on rotation',async()=>{
    const o = opts()
    await verifyAccessJwt(await token(),o)
    o.fetchJwks.mockResolvedValue({keys:[{...jwk,kid:'two'}]})
    await expect(verifyAccessJwt(await token({},{kid:'two'}),o)).resolves.toBeDefined()
  })
  it('uses the dev identity only when explicitly enabled',async()=>{
    const req = new Request('https://test/api/songs',{headers:{'X-Dev-User-Email':' USER@EXAMPLE.COM '}})
    const env = {DEV_FAKE_IDENTITY:'1'} as Env
    expect(await identify(req,env)).toBe('user@example.com')
    expect(await identify(req,{} as Env)).toBeNull()
  })
  const identityEnv = (mapping?:string) => ({ACCESS_TEAM_DOMAIN:teamDomain,ACCESS_AUD:aud,ACCESS_SERVICE_TOKENS:mapping}) as Env
  async function identifyToken(claims:Record<string,unknown>, mapping?:string) {
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({keys:[jwk]}))))
    return identify(new Request('https://test/api/songs',{headers:{'Cf-Access-Jwt-Assertion':await token({exp:Date.now()/1000+300,...claims})}}),identityEnv(mapping))
  }
  it('maps an allowed service token to its lowercase owner identity',async()=>{
    expect(await identifyToken({email:undefined,common_name:'client-id',sub:'service-sub'},'other=other@example.com, client-id= OWNER@EXAMPLE.COM ')).toBe('owner@example.com')
  })
  it('rejects an unlisted service token instead of using its subject',async()=>{
    expect(await identifyToken({email:undefined,common_name:'unknown',sub:'service-sub'},'client-id=owner@example.com')).toBeNull()
  })
  it('rejects service tokens when the owner mapping is missing',async()=>{
    expect(await identifyToken({email:undefined,common_name:'client-id',sub:'service-sub'})).toBeNull()
  })
  it('rejects a mapped service token with the wrong audience',async()=>{
    expect(await identifyToken({email:undefined,common_name:'client-id',aud:'other'},'client-id=owner@example.com')).toBeNull()
  })
  it('keeps human email identities unchanged with service mappings configured',async()=>{
    expect(await identifyToken({},'client-id=owner@example.com')).toBe('user@example.com')
  })
})
