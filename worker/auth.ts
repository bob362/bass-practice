import type { Env } from './index'
const cache = new Map<string,{expires:number; keys:JsonWebKey[]}>()
export function _resetJwksCache(): void { cache.clear() }
function decode(s:string): Uint8Array { return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0)) }
export async function verifyAccessJwt(token:string, opts:{teamDomain:string;aud:string;now?:number;fetchJwks?:()=>Promise<{keys:JsonWebKey[]}>}):Promise<{email?:string;sub?:string}> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('invalid token')
  const [h,p,s] = parts, header = JSON.parse(new TextDecoder().decode(decode(h))), payload = JSON.parse(new TextDecoder().decode(decode(p)))
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) throw new Error('invalid header')
  const fetchKeys = opts.fetchJwks ?? (async () => { const r = await fetch(`https://${opts.teamDomain}/cdn-cgi/access/certs`); if (!r.ok) throw new Error('JWKS unavailable'); return r.json() as Promise<{keys:JsonWebKey[]}> })
  const refresh = async () => { const {keys} = await fetchKeys(); cache.set(opts.teamDomain,{keys,expires:Date.now()+600000}); return keys }
  const cached = cache.get(opts.teamDomain)
  let keys = cached && cached.expires > Date.now() ? cached.keys : await refresh()
  let jwk = keys.find(k => (k as JsonWebKey & {kid?:string}).kid === header.kid)
  if (!jwk) { keys = await refresh(); jwk = keys.find(k => (k as JsonWebKey & {kid?:string}).kid === header.kid) }
  if (!jwk) throw new Error('unknown kid')
  const key = await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify'])
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(s),new TextEncoder().encode(`${h}.${p}`))) throw new Error('bad signature')
  const now = opts.now ?? Date.now()/1000
  if (payload.iss !== `https://${opts.teamDomain}` || !(typeof payload.aud === 'string' ? payload.aud === opts.aud : Array.isArray(payload.aud) && payload.aud.includes(opts.aud)) || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp + 60 <= now || (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf) || payload.nbf > now+60))) throw new Error('invalid claims')
  return { ...(typeof payload.email === 'string' ? {email:payload.email} : {}), ...(typeof payload.sub === 'string' ? {sub:payload.sub} : {}) }
}
export async function identify(req:Request,env:Env):Promise<string|null> {
  try {
    const dev = req.headers.get('X-Dev-User-Email')
    if (env.DEV_FAKE_IDENTITY === '1' && dev) return dev.trim().toLowerCase() || null
    const token = req.headers.get('Cf-Access-Jwt-Assertion')
    if (!token) return null
    const claims = await verifyAccessJwt(token,{teamDomain:env.ACCESS_TEAM_DOMAIN,aud:env.ACCESS_AUD})
    return claims.email !== undefined ? claims.email.trim().toLowerCase() || null : claims.sub || null
  } catch { return null }
}
