import { file, settings, type ProxySetupInput, type ProxySetupFile } from './common'

/** Both web servers send only to a loopback server; the reusable adapter owns the upstream credential. */
export function nodeServerFile(input: ProxySetupInput): ProxySetupFile {
 return file('vane-proxy-server.mjs',`import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { createVaneProxy } from './vane-proxy.mjs';
const settings = ${settings(input)};
const proxy = createVaneProxy({ ...settings, serverCredential: process.env.VANE_PROXY_CREDENTIAL });
export const server = createServer(async (incoming, outgoing) => {
 try {
  const init = { method: incoming.method, headers: incoming.headers };
  if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
   init.body = Readable.toWeb(incoming); init.duplex = 'half';
  }
  const request = new Request('http://127.0.0.1:3031' + incoming.url, init);
  const response = await proxy(request, { ip: incoming.headers['x-vane-ingress-ip'] });
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
 } catch { outgoing.writeHead(502, { 'cache-control': 'no-store' }); outgoing.end(); }
}).listen(Number(process.env.VANE_PROXY_PORT || 3031), '127.0.0.1');
`)
}

export function nginxFile(input: ProxySetupInput, next=false): ProxySetupFile {
 const escaped = input.publicPrefix.replace(/\//g,'\\/')
 return file('vane-location.nginx.conf',`# Include inside the site's existing TLS server block. Internet must reach this ingress first.
# The upstream listens ONLY on 127.0.0.1. Do not expose its port through Docker/firewall rules.
location ~ ^${escaped}/ {
 access_log off;
 error_log /dev/null crit;
 client_max_body_size 64k;
 proxy_request_buffering on;
 proxy_http_version 1.1;
 proxy_pass http://127.0.0.1:${next?'3000':'3031'};
 proxy_set_header Host $host;
 proxy_set_header X-Vane-Ingress-IP $remote_addr;
 proxy_set_header X-Vane-Proxy-IP "";
 proxy_set_header X-Vane-Proxy-Country "";
 proxy_set_header X-Vane-Proxy-Region "";
 proxy_set_header X-Vane-Proxy-City "";
 proxy_set_header Cookie "";
 proxy_set_header Authorization "";
 proxy_set_header X-Forwarded-For "";
 proxy_set_header Connection "";
}
${next?`# Prevent the internal rewrite destination from being reached directly from the public internet.
location ^~ /api/vane-forward/ { return 404; }
`:''}`)
}

export function apacheFiles(input: ProxySetupInput): ProxySetupFile[] {
 const path=input.publicPrefix
 return [nodeServerFile(input),file('vane-location.apache.conf',`# Requires mod_proxy, mod_proxy_http, mod_headers, mod_setenvif.
# Include in the site's TLS VirtualHost; the Node upstream binds ONLY 127.0.0.1:3031.
# Add env=!vane_private to EVERY existing access/transfer CustomLog covering this vhost.
SetEnvIf Request_URI "^${path}/" vane_private
ProxyRequests Off
ProxyPass "${path}/" "http://127.0.0.1:3031${path}/" retry=0
<Location "${path}/">
 LimitRequestBody 65536
 LogLevel emerg
 RequestHeader set X-Vane-Ingress-IP "expr=%{CONN_REMOTE_ADDR}"
 RequestHeader unset X-Vane-Proxy-IP
 RequestHeader unset X-Vane-Proxy-Country
 RequestHeader unset X-Vane-Proxy-Region
 RequestHeader unset X-Vane-Proxy-City
 RequestHeader unset Cookie
 RequestHeader unset Authorization
 RequestHeader unset X-Forwarded-For
 Header always unset Set-Cookie
</Location>
`)]
}
