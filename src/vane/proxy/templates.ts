import { adapterFile, validateSetup, type ProxySetupInput, type ProxySetup } from './templates/common'
import { cloudflareFiles, netlifyFiles, nextFiles } from './templates/platforms'
import { apacheFiles, nginxFile, nodeServerFile } from './templates/ingress'
export type { ProxyPlatform, ProxySetupInput, ProxySetup, ProxySetupFile } from './templates/common'

/** Generates server source only. Secrets are read on the destination server and never accepted here. */
export function generateProxySetup(input: ProxySetupInput): ProxySetup {
 validateSetup(input)
 let files, instructions
 const credential='Set VANE_PROXY_CREDENTIAL as a server-only secret to the credential issued for this connection. Never prefix it NEXT_PUBLIC_ or put it in source control. Disable request/header/body and visitor logging, including provider HTTP logs, drains and tracing, for this path.'
 switch(input.platform) {
  case 'cloudflare':
   files=cloudflareFiles(input)
   instructions='Use the existing forwarding Worker selected by the owner; set its Worker name and route in your own deployment configuration. Add the secret with wrangler secret put VANE_PROXY_CREDENTIAL, then deploy. Route only '+(input.publicOrigin??input.siteOrigin).replace('https://','')+input.publicPrefix+'/* to this Worker. Disable Workers Logs, Tail sessions, Logpush and request tracing for the route. This is the external forwarding Worker option, not the same-account installation Worker one-click route. Disable Pseudo IPv4 header overwrites and do not chain untrusted Workers in front of this route.'
   break
  case 'nextjs':
   files=[...nextFiles(input),nginxFile(input,true)]
   instructions='Merge the Next config rewrite; install server-only. Run Next bound to 127.0.0.1:3000 behind the supplied Nginx location. The ingress must receive the actual browser connection and overwrite x-vane-ingress-ip. Block all public access to port 3000. Do not trust Next x-forwarded-for or attach this self-hosted handler directly to another provider. Use the Vercel setup when deploying on Vercel.'
   break
  case 'vercel':
   files=nextFiles(input,true)
   instructions='Merge the Next rewrite and install @vercel/functions and server-only. Deploy this App Router Route Handler on Vercel. ipAddress/geolocation rely on Vercel overwriting its platform headers. Do not place another proxy in front unless Vercel Trusted Proxy is configured to preserve the actual visitor. Local dev without platform visitor metadata refuses collection.'
   break
  case 'netlify':
   files=netlifyFiles(input)
   instructions='Deploy the generated Netlify Edge Function with the root vane-proxy.mjs. Set the secret through Netlify environment settings with Functions scope, then redeploy. The handler reads context.ip and context.geo. Disable Split Testing for this site; Edge Functions do not support it.'
   break
  case 'nginx':
   files=[nodeServerFile(input),nginxFile(input)]
   instructions='Run node vane-proxy-server.mjs as a supervised service with the server secret in its private environment. Include the generated location in the existing HTTPS server block. The service binds only 127.0.0.1:3031. The ingress must be internet-facing; configure a trusted real-IP module before using it behind another proxy.'
   break
  case 'apache':
   files=apacheFiles(input)
   instructions='Run node vane-proxy-server.mjs as a supervised service with the server secret in its private environment. Include the generated directives in the existing HTTPS VirtualHost. Add env=!vane_private to every CustomLog/TransferLog for the vhost and any inherited global access log. Disable request/body tracing, mod_dumpio and mod_security audit logging on this narrow location. Apache must receive the actual visitor connection; this recipe deliberately uses CONN_REMOTE_ADDR rather than trusting forwarded headers.'
   break
  default: throw new Error('Unsupported proxy platform')
 }
 const base=(input.publicOrigin??'')+input.publicPrefix
 return {files:[adapterFile(),...files],instructions:instructions+' '+credential,scriptTag:`<script defer src="${base}/script.js" data-site="${input.siteId}" data-api="${input.publicPrefix}"></script>`}
}
