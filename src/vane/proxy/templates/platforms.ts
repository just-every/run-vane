import { file, settings, type ProxySetupInput, type ProxySetupFile } from './common'

export function cloudflareFiles(input: ProxySetupInput): ProxySetupFile[] {
 return [file('worker.mjs',`import { createVaneProxy } from './vane-proxy.mjs';
const settings = ${settings(input)};
export default {
 async fetch(request, env) {
  // request.cf is platform metadata. Do not replace it with browser-supplied headers.
  // Disable Pseudo IPv4 "Overwrite Headers" for this zone; keep the real visitor address.
  if (!request.cf) return new Response(null, { status: 503 });
  return createVaneProxy({ ...settings, serverCredential: env.VANE_PROXY_CREDENTIAL })(request, {
   ip: request.headers.get('CF-Connecting-IP'),
   country: request.cf.country, region: request.cf.regionCode, city: request.cf.city
  });
 }
};
`),file('wrangler.jsonc',JSON.stringify({main:'worker.mjs',compatibility_date:'2026-10-01',workers_dev:false,preview_urls:false,observability:{enabled:false}},null,2)+'\n')]
}

export function netlifyFiles(input: ProxySetupInput): ProxySetupFile[] {
 return [file('netlify/edge-functions/vane-forward.mjs',`import { createVaneProxy } from '../../vane-proxy.mjs';
const settings = ${settings(input)};
export default async function handler(request, context) {
 return createVaneProxy({ ...settings, serverCredential: Netlify.env.get('VANE_PROXY_CREDENTIAL') })(request, {
  ip: context.ip, country: context.geo?.country?.code,
  region: context.geo?.subdivision?.code, city: context.geo?.city
 });
}
export const config = { path: ${JSON.stringify(input.publicPrefix+'/*')}, onError: 'fail' };
`)]
}

const nextHandler = (input: ProxySetupInput, vercel: boolean) => `import 'server-only';
import { createVaneProxy } from '../../../../vane-proxy.mjs';
${vercel ? "import { ipAddress, geolocation } from '@vercel/functions';" : '// Requires the supplied private Nginx ingress; never expose next start directly.'}
const settings = ${settings(input)};
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handler(request, { params }) {
 const { path } = await params;
 const url = new URL(request.url);
 url.pathname = settings.publicPrefix + '/' + path.join('/');
 const forwarded = new Request(url, request);
 ${vercel ? "const geo = geolocation(request);\n const visitor = { ip: ipAddress(request), country: geo.country, region: geo.countryRegion, city: geo.city };" : "const visitor = { ip: request.headers.get('x-vane-ingress-ip') };"}
 return createVaneProxy({ ...settings, serverCredential: process.env.VANE_PROXY_CREDENTIAL })(forwarded, visitor);
}
export { handler as GET, handler as POST, handler as OPTIONS };
`

export function nextFiles(input: ProxySetupInput, vercel=false): ProxySetupFile[] {
 return [file('app/api/vane-forward/[...path]/route.js',nextHandler(input,vercel)),file('next.config.mjs',`// Merge this beforeFiles rewrite into your existing Next config.
export default {
 async rewrites() {
  return { beforeFiles: [{ source: ${JSON.stringify(input.publicPrefix+'/:path*')}, destination: '/api/vane-forward/:path*' }] };
 }
};
`)]
}
