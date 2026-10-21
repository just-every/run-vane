import { createVaneProxy } from '../adapter'

export type ProxyPlatform = 'nextjs' | 'vercel' | 'netlify' | 'cloudflare' | 'nginx' | 'apache'
export interface ProxySetupInput {
 platform: ProxyPlatform
 installationOrigin: string
 connectionId: string
 siteId: string
 siteOrigin: string
 publicPrefix: string
 /** Set only for a dedicated collection subdomain; otherwise the path is relative. */
 publicOrigin?: string
}
export interface ProxySetupFile { path: string; content: string }
export interface ProxySetup { files: ProxySetupFile[]; instructions: string; scriptTag: string }
export const file = (path: string, content: string): ProxySetupFile => ({path,content})
export function settings(input: ProxySetupInput) {
 const {installationOrigin,connectionId,siteId,siteOrigin,publicPrefix}=input
 return JSON.stringify({installationOrigin,connectionId,siteId,siteOrigin,publicPrefix},null,2)
}
export function adapterFile(): ProxySetupFile {
 // The factory is deliberately self-contained. Serializing emitted JS keeps every setup on one implementation.
 return file('vane-proxy.mjs','// Server only. Never import this file into a client component.\nexport const createVaneProxy = '+createVaneProxy.toString()+';\n')
}
export function validateSetup(input: ProxySetupInput) {
 if (!/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(input.publicPrefix)) throw new Error('Invalid public prefix')
 if (['nextjs','vercel'].includes(input.platform) && (input.publicPrefix === '/api/vane-forward' || input.publicPrefix.startsWith('/api/vane-forward/'))) throw new Error('Choose a public prefix outside the internal /api/vane-forward route')
 for (const id of [input.connectionId,input.siteId]) if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid proxy identifier')
 for (const origin of [input.installationOrigin,input.siteOrigin,...(input.publicOrigin?[input.publicOrigin]:[])]) {
  const url = new URL(origin)
  if (url.origin !== origin || !(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('Setup requires bare HTTPS origins, or local development origins')
 }
}
