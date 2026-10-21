# Serve Vane through your own domain

A first-party proxy serves the tracker and every tracker request through an owner-selected path such as `/insights`. A dedicated collection host such as `stats.example.com` can use the same path. Your Vane installation remains the only destination behind the proxy. WordPress plugin insertion is future work under INSTALL-002; this guide does not claim a supported WordPress plugin.

Create a proxy connection for the site in Vane, select the public hostname and prefix, then download that connection's server setup. Install the generated files on the website server or hosting platform. Copy the generated script tag into the website:

```html
<script defer src="/insights/script.js" data-site="YOUR_SITE_ID" data-api="/insights"></script>
```

The public prefix is configurable. Keep `data-api` and the script URL on the same proxy. For a collection subdomain both values must be absolute, for example `https://stats.example.com/insights`. Keep the registered site origin as the website's origin, not the collection host.

## The server credential

Set `VANE_PROXY_CREDENTIAL` to the credential issued for this connection in the destination server's private environment or provider secret store. It is separate from a Cloudflare API token. Do not put it in a browser, a `NEXT_PUBLIC_` variable, HTML, a URL, a repository, a request log or a response. Generated setup downloads contain public configuration and server source; they do not contain the credential. Revoking the connection stops collection through that setup. Replace the private environment value when rotating the connection credential.

The adapter adds `Authorization: Bearer …` only on its server request to your installation. It forwards the browser's Origin, User-Agent, Content-Type, DNT and Sec-GPC, plus platform-attested visitor metadata. It never forwards browser cookies or browser authorization, and response headers are rebuilt without upstream cookies or authentication. No upstream redirects are followed. A literal credential echoed by the upstream fails closed. The installation still validates the connection, site, path and credential before dispatching the request into the ordinary collector.

## Next.js rewrites and Route Handler

Copy `vane-proxy.mjs` to the project root, copy the generated App Router handler to `app/api/vane-forward/[...path]/route.js`, install `server-only`, and merge the generated `beforeFiles` rewrite into the existing `next.config.mjs`. The public prefix rewrites internally to the handler; it never rewrites directly to an authenticated installation URL. Deploy the handler on the Node runtime.

For a self-hosted Next server, include `vane-location.nginx.conf` in the existing HTTPS Nginx server block. Run Next bound to `127.0.0.1:3000`, make that port inaccessible from outside the host, and preserve the generated ingress header overwrite. The ingress supplies `X-Vane-Ingress-IP` from its actual peer address. Direct public requests to the internal handler path are refused at Nginx. Do not mount a service accepting that trusted header on a publicly accessible port.

Next itself fills `x-forwarded-for` only when the header is absent, so a browser-supplied value can survive. The self-hosted recipe deliberately uses an isolated ingress and a dedicated header. This trust boundary follows [Next's request handling source](https://github.com/vercel/next.js/blob/canary/packages/next/src/server/base-server.ts) and its [reverse proxy guidance](https://nextjs.org/docs/app/guides/self-hosting).

The supplied ingress assumes it receives the visitor connection directly. If another CDN or load balancer is in front, configure Nginx's real-IP module with only that provider's trusted address ranges before using this recipe. Never substitute the Next server's socket address for an unknown visitor. Self-hosted Next does not guess a country, region or city; absent trusted GeoIP metadata is omitted.

## Vercel

Choose the Vercel setup for a Next App Router site deployed on Vercel. Install `@vercel/functions` and `server-only`, merge the generated rewrite, and set the credential in Vercel's server environment before deploying. The handler uses `ipAddress(request)` and `geolocation(request)`; region forwarding uses `countryRegion`, not the edge datacenter region. Local execution without attested platform metadata refuses collection.

Vercel overwrites its visitor headers. A separate proxy in front changes the apparent visitor unless Vercel Trusted Proxy is configured. These requirements come from the official [functions API](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package) and [request header documentation](https://vercel.com/docs/headers/request-headers).

## Netlify Edge

Copy the generated root adapter and `netlify/edge-functions/vane-forward.mjs`. Set the secret in Netlify environment settings with Functions scope and redeploy. The inline function config registers only the selected prefix. It uses `context.ip`, `context.geo.country.code`, `context.geo.subdivision.code` and `context.geo.city`; it reads no browser-supplied visitor metadata. Disable Split Testing, which does not support Edge Functions. Environment variables declared only in `netlify.toml` are not available to Edge Functions. See Netlify's [Edge Functions API](https://docs.netlify.com/build/edge-functions/api/).

## Cloudflare forwarding Worker

The external forwarding Worker setup consists of `worker.mjs`, `vane-proxy.mjs` and a `wrangler.jsonc` fragment. Merge it into the configuration for the owner-selected Worker; preserve that Worker's existing name and account. Set the secret interactively with `wrangler secret put VANE_PROXY_CREDENTIAL`. Register only the desired hostname plus prefix route and deploy. A Worker route requires the site's DNS record to be proxied through Cloudflare. The same-account one-click installation route is a separate connection mode on the existing installation Worker.

The forwarding Worker reads country, region code and city from `request.cf`, and visitor IP from Cloudflare's `CF-Connecting-IP`. Disable Pseudo IPv4's header overwrite mode for this zone. Do not chain an untrusted Worker before this route: Worker subrequests have different visitor-header trust behavior. Missing platform metadata or a missing/invalid visitor IP refuses the request. See Cloudflare's [Request metadata](https://developers.cloudflare.com/workers/runtime-apis/request/) and [HTTP header behavior](https://developers.cloudflare.com/fundamentals/reference/http-headers/).

For a custom collection subdomain, attach `stats.example.com` as the forwarding Worker's Custom Domain in the owning Cloudflare zone and let Cloudflare provision DNS and TLS. Keep the collection hostname distinct from the installation hostname to avoid a forwarding loop. Set `publicOrigin` in setup generation to that bare HTTPS origin and use the generated absolute script tag. The Worker only accepts the configured prefix; it forwards no other paths. Cross-origin JSON posts receive a local preflight response only for the registered website Origin, the known tracker door and Content-Type. No credential or visitor data is sent upstream for a preflight. Follow the [Cloudflare Custom Domains guide](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## Nginx and Apache

These setups run the same bounded adapter as a small Node 22+ service behind the existing web server. Copy the generated adapter and `vane-proxy-server.mjs`, supervise `node vane-proxy-server.mjs` with the credential in its private environment, and include the generated location in the existing TLS virtual host. The service listens only on `127.0.0.1:3031`. If that port is already assigned, set `VANE_PROXY_PORT` and update the generated web server upstream port to match. No additional public listener is needed. The generated web server configuration overwrites visitor-IP metadata using the actual connection peer and clears browser cookies, authorization and visitor-location headers.

Nginx supplies `$remote_addr` and disables access/error request logs inside the proxy location. Apache uses `CONN_REMOTE_ADDR`, so forwarded headers and mod_remoteip do not silently substitute an address. The Apache recipe must receive the actual visitor connection. If Apache sits behind another proxy, adapt the trusted ingress explicitly before enabling the connection. Neither recipe guesses GeoIP from browser headers: country/region/city remain absent. If a trusted GeoIP integration is added, supply its derived values to the adapter and keep raw data out of logs.

For Apache, add `env=!vane_private` to **every** CustomLog covering this virtual host, including inherited/global access logs. Convert any relevant TransferLog to conditional CustomLog. Disable `mod_dumpio`, request/body tracing and `mod_security` audit logging for this narrow location before enabling it. The generated fragment marks the path but cannot rewrite an installation's existing log directives. Nginx logging is disabled inside the narrow generated location. Do not enable proxy debug logging. Configuration references: [Nginx proxy headers](https://nginx.org/en/docs/http/ngx_http_proxy_module.html), [Apache mod_headers](https://httpd.apache.org/docs/2.4/mod/mod_headers.html), [Apache conditional logs](https://httpd.apache.org/docs/2.4/logs.html#accesslog).

## Protocol and verification

All upstream requests go to `INSTALLATION_ORIGIN/api/vane/proxy/CONNECTION_ID/SUFFIX`. GET accepts only `script.js` and `config/SITE_ID`. POST accepts `collect`, `engage`, `custom`, `event`, `perf`, `exposure`, `signal/SITE_ID`, `declined/SITE_ID` and `ignored/SITE_ID`. Other paths, methods, query strings, cross-site Origins, compressed bodies and bodies exceeding 64 KiB are refused. Body size is measured while reading, including chunked requests. The public prefix has no trailing slash. Site IDs in path suffixes must match the generated site. Server-side visitor metadata is required even for the script and config doors; unknown visitor IP never becomes the proxy server's IP.

Visitor country is a two-letter uppercase code. Region is a subdivision code; region and city headers are percent-encoded UTF-8, decoded once by the installation before normal derivation. The adapter has no logging or persistent visitor storage. Disable hosting-provider request logs, HTTP logs, drains, traces, analytics, Tail/Logpush and request inspection covering this route as well; disabling application console output alone does not disable provider access logs. The generated Worker configuration disables its own observability. The raw IP, user agent and location exist only while handling the request; the installation derives the ordinary report values before persistence.

Verify every request uses the public path and that accepted events are labeled proxy traffic in Vane. Account-free adapter checks cover local HTTP forwarding and generated setup execution. Provider deployments, same-account one-click routing, custom-host TLS and Chromium with uBlock Origin/EasyPrivacy require their own deployment/browser evidence. This adapter test does not establish blocker resilience or live provider acceptance.

Forwarded region metadata is the country subdivision code used for regional consent. A region name unavailable from the trusted edge stays unknown; Vane never stores that raw code as a location name.
