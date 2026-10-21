import { insist, type Actor, type Env } from '../core'
import { createConnection, listConnections, revokeConnection, rotateConnection } from './connections'
import { connectCloudflareDomain, connectCloudflareRoute } from './cloudflare'
import { generateProxySetup } from './templates'

export async function proxyCommand(env:Env,actor:Actor,p:any) {
 switch(p.operation) {
  case 'proxy.create':return createConnection(env,actor,p)
  case 'proxy.rotate':return rotateConnection(env,actor,p)
  case 'proxy.revoke':await revokeConnection(env,actor,p);return null
  case 'proxy.cloudflare.route':await connectCloudflareRoute(env,actor,p);return null
  case 'proxy.cloudflare.domain':await connectCloudflareDomain(env,actor,p);return null
  default:insist(false,'proxy_operation','Choose a proxy connection action.')
 }
}
export async function proxySetup(env:Env,actor:Actor,siteId:string,connectionId:string,platform:string) {
 const connection=(await listConnections(env,actor,siteId)).find(c=>c.id===connectionId&&!c.revokedAt)
 insist(connection,'proxy_connection','Choose an active connection.',404)
 insist(connection.mode==='external','proxy_mode','A same-Worker connection uses the Cloudflare route or custom domain.')
 insist(['nextjs','vercel','netlify','cloudflare','nginx','apache'].includes(platform),'proxy_platform','Choose a supported server platform.')
 return generateProxySetup({installationOrigin:env.AUTH_ORIGIN,connectionId,siteId,siteOrigin:connection.siteOrigin,publicPrefix:connection.publicPrefix,platform:platform as any})
}
