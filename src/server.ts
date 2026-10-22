import { evidenceDoor } from './vane/movement/evidence'
import { securityFence } from './vane/security/routes'
import { rawOperatorAuth } from './auth.server'
import { resolveProxy } from './vane/proxy/ingress'
import { agencyHostResponse } from './vane/agency/domains'
import { runChatReports } from './vane/chat/delivery'
import { sync as syncBing } from './vane/bing'
import { withDemo } from './modules/demo/index.mjs'
import { seedDemo } from './demo'
import { collector } from './vane/collect'
import { perfResponse } from './vane/performance'
import { methodologyResponse } from './vane/methodology'
import { publicStatsResponse } from './vane/public'
import { shareResponse } from './vane/share'
import { autoEventResponse } from './vane/auto-events'
import { customEventResponse } from './vane/custom-events'
import { exposureResponse } from './vane/experiments'
import { expireSalts } from './vane/visitors'
import { expireKept } from './vane/segments'
import { runExports } from './vane/warehouse'
import { runWebhooks } from './vane/webhooks'
import { runReports, unsubscribeResponse } from './vane/email-reports'
import { mailEventResponse } from './vane/mail-events'
import { sync as syncSearchConsole } from './vane/search-console'
import { runAlerts } from './vane/traffic-alerts'
import { runHealth } from './vane/tracking-health'
import { runFollowUps } from './vane/follow-up'
import { clock, clockResponse } from './vane/clock'
import { vaneResponse } from './vane/routes'
import { apiDoor } from './vane/api-door'
import { annotationDoor } from './vane/annotation-door'
import { githubReleaseDoor } from './vane/github-releases'
import { rejectedResponse } from './base/rejected-response'
import start from '@tanstack/react-start/server-entry'
import { Hono } from 'hono'
import { dispatch } from './base/dispatch'
import { staticAssetResponse } from './base/static-assets'
import { deploymentHealth } from './base/deployment-health'
import { lobbyResponse } from './base/lobby'
import { setupStateResponse } from './base/setup-state'
import { authResponse, runtimeBindings, type Bindings } from './auth.server'
import { identity } from './identity'

const api = new Hono<{ Bindings: Bindings }>()
api.get('/health', (context) => context.json({ status: 'ok', ...deploymentHealth(context.env) }))

// Start documents keep their own cache policy and add no-transform, so no proxy
// rewrites the HTML React hydrates (Cloudflare's email address obfuscation
// honours it; src/base/hydration/README.md).
function noTransform(response: Response): Response {
  const headers = new Headers(response.headers), policy = headers.get('cache-control')
  headers.set('cache-control', policy ? `${policy}, no-transform` : 'no-transform')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export default withDemo({
  async fetch(request, env, execution) {
    const agency = await agencyHostResponse(request, runtimeBindings(env))
    if (agency) return agency
    const proxied = await resolveProxy(request, runtimeBindings(env))
    if (proxied instanceof Response) return proxied
    if (proxied) request = proxied.request as typeof request
    const clocked = await clockResponse(request, runtimeBindings(env))
    if (clocked) return clocked
    const asset = await staticAssetResponse(request, env)
    if (asset) return asset
    const custom = await customEventResponse(request, env)
    if (custom) return custom
    const exposure = await exposureResponse(request, env)
    if (exposure) return exposure
    const automatic = await autoEventResponse(request, env)
    if (automatic) return automatic
    const measured = await perfResponse(request, runtimeBindings(env))
    if (measured) return measured
    const collected = await collector(request, env)
    if (collected) return collected
    if (proxied) return new Response(null, {status:404})
    const evidence = await evidenceDoor(request, runtimeBindings(env))
    if (evidence) return evidence
    const annotated = await annotationDoor(request, runtimeBindings(env))
    if (annotated) return annotated
    const released = await githubReleaseDoor(request, runtimeBindings(env))
    if (released) return released
    const methodology = await methodologyResponse(request)
    if (methodology) return methodology
    const stats = await publicStatsResponse(request, runtimeBindings(env))
    if (stats) return stats
    const shared = await shareResponse(request, runtimeBindings(env))
    if (shared) return shared
    const unsubscribed = await unsubscribeResponse(request, runtimeBindings(env))
    if (unsubscribed) return unsubscribed
    const mailEvent = await mailEventResponse(request, runtimeBindings(env))
    if (mailEvent) return mailEvent
    const keyed = await apiDoor(request, env)
    if (keyed) return keyed
    const held = await securityFence(request,runtimeBindings(env),rawOperatorAuth(runtimeBindings(env)))
    if (held) return held
    const auth = await authResponse(request, env)
    if (auth) return auth
    const vane = await vaneResponse(request, env)
    if (vane) return vane
    // The installed variant: the Lobby at / and the public claim state it reads.
    // Local dev serves the saved origin's data at its own port (RER_DEV_ORIGIN).
    const state = await setupStateResponse(request, runtimeBindings(env))
    if (state) return state
    const lobby = await lobbyResponse(request, runtimeBindings(env), identity)
    if (lobby) return lobby
    return rejectedResponse(request, await dispatch(request, () => api.fetch(request, env, execution), async () => noTransform(await start.fetch(request))))
  },
  // METRIC-001: visitor salts are deleted 24 hours after creation, even when no page load arrives.
  // API-002: each scheduled warehouse export sends the dates that have ended since its last run.
  async scheduled(_controller, env) {
    const sourceSync=syncSearchConsole(runtimeBindings(env), clock());
    const sourceResult=Promise.allSettled([sourceSync,syncBing(runtimeBindings(env),clock())]);
    try {
    await expireSalts(runtimeBindings(env), clock())
    await expireKept(runtimeBindings(env), clock())
    await runExports(runtimeBindings(env), clock())
    // API-003: queue ended minutes' goal conversions and send due webhook deliveries.
    await runWebhooks(runtimeBindings(env), clock())
    // REPORT-001: due email reports and their retries.
    await runReports(runtimeBindings(env), clock())
    await runChatReports(runtimeBindings(env), clock())
    await runAlerts(runtimeBindings(env), clock())
    // ALERT-002: each site's daily tracking-health check at the owner's local time.
    await runHealth(runtimeBindings(env), clock())
    await runFollowUps(runtimeBindings(env), clock())
    } finally {
      const results=await sourceResult;const failed=results.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
    }
  },
} satisfies ExportedHandler<Bindings>, { seed: seedDemo })
