import { identify } from './auth'
import { handleApi, json } from './api'
export interface Env { DATA: R2Bucket; ASSETS: Fetcher; ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string; DEV_FAKE_IDENTITY?: string }
export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (!new URL(req.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(req)
    const identity = await identify(req,env)
    return identity ? handleApi(req,env,identity) : json({error:'unauthorized'},401)
  }
}
