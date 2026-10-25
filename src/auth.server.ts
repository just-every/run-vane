import { pendingSecurity } from './vane/security/policy'
import { securityResponse } from './vane/security/routes'
import { samlResponse } from './vane/security/saml'
import { scimResponse } from './vane/security/scim'
import { rejectedResponse } from './base/rejected-response'
import { createDependencies } from './modules/dependencies/index.mjs'
import { createIdpOwnerClaimHandler, createOwnerClaimHandler } from './modules/owner-claim/index.mjs'
import { firstRunResponse } from './base/setup'
import { fontDocumentResponse } from './base/font-response'
import { AuthError, createOperatorAuth, createAuthHandler, createSignInHandler, defaultRolePolicy, devGate, devNotFound, securityHeaders, type AuthConfig, type PolicyInput } from './modules/operator-auth/index.mjs'
import { operatorMail } from './mail.server.mjs'
import branding from './branding.json'

// The edition's declared theme (public/rer-theme.css), as Base frames link it.
const theme = { href: '/rer-theme.css', productName: branding.name, accentColor: branding.primaryColor }

export interface Bindings {
 /** SEARCH-001: optional installation-owned Google OAuth application credentials. */
 SLACK_CLIENT_ID?:string
 SLACK_CLIENT_SECRET?:string
 GOOGLE_CLIENT_ID?:string
 GOOGLE_CLIENT_SECRET?:string
 /** TEAM-002: private installation bindings; never browser config or history archives. */
 VANE_OIDC_PROVIDERS?: string
 OIDC_TRANSACTION_SECRET?: string
 VANE_SAML_CONFIG?: string
 DB: D1Database
 /** Built browser files; hosted deploys run the Worker first (staticAssetResponse). */
 ASSETS?: Fetcher
 RER_DEPLOY_SOURCE?: string
 RER_DEPLOY_FINGERPRINT?: string
 RER_VERSION?: { id: string }
 IDENTITY_PROVIDER?: string
 AUTH_ORIGIN: string
 AUTH_LOCAL?: string
 RER_DEV_ORIGIN?: string
 /** Local runtimes only: the checkout's key gate and dev identity switch. Deploy refuses both. */
 /** AGENT-007: the deployment's model provider for plain-English questions (Base ai module); off unless AI_ENABLED is 'true'. */
 AI_ENABLED?: string
 AI_API_KEY?: string
 AI_BASE_URL?: string
 AI_MODEL?: string
 MODELS_SERVICE?: string
 MODELS_KEY?: string
 RER_MODELS_SERVICE?: string
 RER_MODELS_KEY?: string
 RER_DEV_KEY?: string
 RER_DEV_IDENTITY?: string
 RER_DEMO?: string
 RER_OWNER_CLAIM_ISSUER?: string
 RER_OWNER_CLAIM_INSTALLATION_ID?: string
 RER_OWNER_CLAIM_PUBLIC_KEYS?: string
 RER_INSTALLATION_ID?: string
 RER_MANAGEMENT_ORIGIN?: string
 OWNER_EMAIL: string
 SESSION_SECRET: string
 SETUP_TOKEN?: string
 INSTALLATION_KEY?: string
 INSTALLATION_KEY_PREVIOUS?: string
 MAIL_PROVIDER?: 'development' | 'rer' | 'resend' | 'sendgrid' | 'cloudflare'
 MAIL_RELAY_URL?: string
 MAIL_FROM?: string
 MAIL_API_KEY?: string
 MAIL_ACCOUNT_ID?: string
 /** REPORT-001: the Resend webhook signing secret (whsec_...) or SendGrid's event-webhook public key. */
 MAIL_WEBHOOK_KEY?: string
 /** Vane's published store capacity in MB (RETENTION-002); unset means D1's 10,240 MB limit on Workers Paid. */
 VANE_STORE_LIMIT_MB?: string
 VANE_WORKER_USAGE_DAY?: string
 VANE_WORKER_PLAN?: string
 VANE_WORKER_DAILY_REQUESTS?: string
}

export const runtimeBindings = (env: Bindings): Bindings => env.RER_DEV_ORIGIN && env.AUTH_LOCAL === 'true' ? { ...env, AUTH_ORIGIN: env.RER_DEV_ORIGIN } : env
// Base's account doors know people but not Vane's sites. Anyone but the owner changes the team only through Vane's
// site-scoped team page (vane/team.ts), and reads or ends only their own sessions.
const OWNER_DOORS = new Set(['/auth/invite', '/auth/invite/cancel', '/auth/operators', '/auth/operator/status', '/auth/operator/role'])
const rolePolicy = (input: PolicyInput) => defaultRolePolicy(input) && (input.actor.role === 'owner' || !input.action.startsWith('sessions:') || input.target?.id === input.actor.id)
export const authConfig = (env: Bindings): AuthConfig => ({ dependencies: true, origin: env.AUTH_ORIGIN, local: env.AUTH_LOCAL === 'true', OWNER_EMAIL: env.OWNER_EMAIL, SESSION_SECRET: env.SESSION_SECRET, SETUP_TOKEN: env.SETUP_TOKEN, MAIL_FROM: env.MAIL_FROM, providers: env.VANE_OIDC_PROVIDERS ? JSON.parse(env.VANE_OIDC_PROVIDERS) : [], externalIssuers: env.VANE_SAML_CONFIG ? [JSON.parse(env.VANE_SAML_CONFIG).issuer] : [], OIDC_TRANSACTION_SECRET: env.OIDC_TRANSACTION_SECRET, branding: { productName: branding.name, accentColor: branding.primaryColor, signInPath: '/signin', theme: theme.href } })
export function rawOperatorAuth(env: Bindings) {
 return createOperatorAuth({ db: env.DB, config: authConfig(env), mailSender: operatorMail(env), rolePolicy, hooks:{async afterConfirm({operator,session}){const pending=await pendingSecurity(env,{...session,operatorId:operator.id,operator});if(pending==='sso')throw new AuthError('sso_required',403);return pending?{returnTo:`/auth/security/${pending}`}:{}}}, clientIp: request => request.headers.get('CF-Connecting-IP') ?? '' })
}

// Direct session consumers share the same fence as HTTP. Enrollment uses rawOperatorAuth only.
export function operatorAuth(env: Bindings) {
 const auth=rawOperatorAuth(env)
 return {...auth, async getSession(request:Request) { const session=await auth.getSession(request);return session&&!await pendingSecurity(env,session)?session:null }}
}

async function handleAuthResponse(request: Request, original: Bindings): Promise<Response | null> {
 const env = runtimeBindings(original), url = new URL(request.url)
 const raw=rawOperatorAuth(env)
 const security=await securityResponse(request,env,raw)
 if(security)return security
 const scim=await scimResponse(request,env)
 if(scim)return scim
 if(env.VANE_SAML_CONFIG){const saml=await samlResponse(request,env,raw,JSON.parse(env.VANE_SAML_CONFIG));if(saml)return saml}

 if (url.pathname === '/auth/owner-claim' && env.RER_OWNER_CLAIM_PUBLIC_KEYS) {
  return createOwnerClaimHandler({ db: env.DB, authConfig: authConfig(env), clientIp: req => req.headers.get('CF-Connecting-IP') ?? '', issuer: env.RER_OWNER_CLAIM_ISSUER ?? '', installationId: env.RER_OWNER_CLAIM_INSTALLATION_ID ?? '', appOrigin: env.AUTH_ORIGIN, expectedEmail: env.OWNER_EMAIL.toLowerCase(), publicKeys: JSON.parse(env.RER_OWNER_CLAIM_PUBLIC_KEYS) })(request)
 }
 if (url.pathname.startsWith('/.well-known/rer-') || url.pathname.startsWith('/auth/dependencies/')) {
  const linked = await createDependencies({ db: env.DB, origin: env.AUTH_ORIGIN, name: branding.name, provider: env.IDENTITY_PROVIDER, INSTALLATION_KEY: env.INSTALLATION_KEY, INSTALLATION_KEY_PREVIOUS: env.INSTALLATION_KEY_PREVIOUS, local: env.AUTH_LOCAL === 'true', auth: operatorAuth(env), claimOwner: token => createIdpOwnerClaimHandler({db:env.DB,authConfig:authConfig(env),clientIp:()=>request.headers.get('CF-Connecting-IP')??''})(new Request(env.AUTH_ORIGIN+'/auth/owner-claim',{method:'POST',headers:{Host:new URL(env.AUTH_ORIGIN).host,Origin:env.AUTH_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({token})})) }).handle(request)
  if (linked) return linked
 }
 if (url.pathname === '/auth/owner-claim') return createIdpOwnerClaimHandler({db:env.DB,authConfig:authConfig(env),clientIp:req=>req.headers.get('CF-Connecting-IP')??''})(request)
 if (url.pathname.startsWith('/__dev/')) return devNotFound()
 // The shared server-rendered sign-in page: plain forms that work before any script.
 if (url.pathname === '/signin') {
  const page = await createSignInHandler(raw, {
   defaultReturnTo: '/setup',
  })(request)
  if (page) {
   if(env.VANE_SAML_CONFIG&&request.method==='GET') {
    const cfg=JSON.parse(env.VANE_SAML_CONFIG),headers=new Headers(page.headers)
    headers.set('content-security-policy',(headers.get('content-security-policy')??'').replace("form-action 'self'",`form-action 'self' ${new URL(cfg.entryPoint).origin}`))
    return fontDocumentResponse(new Response((await page.text()).replace('</main>','<h2>Organization sign-in</h2><div class="stack"><form method="post" action="/auth/saml/start"><button class="secondary" type="submit">Continue with SAML</button></form></div></main>'),{status:page.status,headers}))
   }
   return fontDocumentResponse(page)
  }
 }
 if (OWNER_DOORS.has(url.pathname)) {
  const role = (await raw.getSession(request))?.operator.role
  if (role && role !== 'owner') return Response.json({ error: 'forbidden' }, { status: 403, headers: securityHeaders() })
 }
 if (url.pathname.startsWith('/auth/')) return fontDocumentResponse(await createAuthHandler(raw)(request))
 if (url.pathname === '/setup' || url.pathname === '/app' || url.pathname.startsWith('/app/')) {
  const setup = await firstRunResponse(request, env, operatorAuth(env), { theme })
  if (setup) return setup
 }

 return null
}

export async function authResponse(request: Request, original: Bindings): Promise<Response | null> {
 const response = await handleAuthResponse(request, original)
 return response ? rejectedResponse(request, response) : null
}
