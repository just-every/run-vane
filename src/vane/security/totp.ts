import { VaneError, type Env } from '../core'
// Authentication uses wall time, independent of the analytics simulation clock.
const clock=Date.now
import { seal, unseal } from '../sealed'

const utf8 = new TextEncoder()
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const pendingPurpose = 'vane-totp-pending-v1'
const credentialPurpose = 'vane-totp-credential-v1'
const lifetime = 10 * 60_000
const attemptWindow = 5 * 60_000
const attemptLimit = 5

interface Credential { secret_sealed: string; last_step: number }
interface Pending { secret_sealed: string; expires_at: number }

function refuse(): never {
 throw new VaneError('second_step', 'Second-step verification was refused.', 403)
}

// Every credential mutation and proof insertion uses the current native session fence.
// Numbered parameters are shared by every statement: operator, session, current time.
const liveSession = `EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id
 WHERE o.id=?1 AND s.id=?2 AND o.status='active' AND s.operator_version=o.version
 AND s.revoked_at IS NULL AND s.expires_at>?3
 AND (s.kind!='oidc' OR EXISTS(SELECT 1 FROM oa_provider_sessions p JOIN oa_auth_settings a ON a.singleton=1 AND a.idp_sign_in=1 AND a.generation=p.generation WHERE p.session_id=s.id))
 AND NOT EXISTS(SELECT 1 FROM oa_provider_session_pins pin WHERE pin.session_id=s.id AND NOT EXISTS(SELECT 1 FROM oa_identity_providers p WHERE p.provider_id=pin.provider_id AND p.status='linked' AND p.issuer=pin.issuer AND p.client_id=pin.client_id AND p.linked_at=pin.linked_at)))`

function base32(bytes: Uint8Array): string {
 let value = 0, bits = 0, result = ''
 for (const byte of bytes) {
  value = (value << 8) | byte
  bits += 8
  while (bits >= 5) { bits -= 5; result += alphabet[(value >>> bits) & 31] }
 }
 if (bits) result += alphabet[(value << (5 - bits)) & 31]
 return result
}

function decode32(secret: string): Uint8Array<ArrayBuffer> {
 let value = 0, bits = 0
 const bytes: number[] = []
 for (const character of secret) {
  const digit = alphabet.indexOf(character)
  if (digit < 0) refuse()
  value = (value << 5) | digit
  bits += 5
  if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255) }
 }
 return new Uint8Array(bytes)
}

function equalCode(left: string, right: string): boolean {
 if (left.length !== right.length) return false
 let difference = 0
 for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i)
 return difference === 0
}

// RFC 6238: SHA-1, 30 seconds, six digits, with one step of clock skew either way.
// Choose the newest matching step if a six-digit collision occurs within the window.
async function matchingStep(secret: string, code: string, now: number): Promise<number | null> {
 if (!/^\d{6}$/.test(code)) return null
 const key = await crypto.subtle.importKey('raw', decode32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
 const current = Math.floor(now / 30_000)
 const matches = await Promise.all([-1, 0, 1].map(async offset => {
  const step = current + offset
  if (step < 0) return null
  const counter = new Uint8Array(8)
  new DataView(counter.buffer).setBigUint64(0, BigInt(step))
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter))
  const start = bytes[bytes.length - 1]! & 15
  const binary = ((bytes[start]! & 127) << 24) | (bytes[start + 1]! << 16) | (bytes[start + 2]! << 8) | bytes[start + 3]!
  return equalCode(String(binary % 1_000_000).padStart(6, '0'), code) ? step : null
 }))
 return matches.reduce<number | null>((latest, step) => step === null ? latest : Math.max(latest ?? -1, step), null)
}

async function openSecret(env: Env, purpose: string, bound: string, value: string): Promise<string> {
 try { return await unseal(env, purpose, bound, value) } catch { return refuse() }
}

async function recoveryHash(env: Env, operatorId: string, code: string): Promise<string> {
 const key = await crypto.subtle.importKey('raw', utf8.encode(`vane-totp-recovery-v1\0${env.SESSION_SECRET}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
 const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8.encode(JSON.stringify([operatorId, code]))))
 return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

// Reserve a guess in BOTH budgets, transactionally. Successful guesses also count;
// replacing pending enrollment or opening another session cannot reset the operator budget.
async function attempt(env: Env, operatorId: string, sessionId: string): Promise<void> {
 const now = clock(), window = Math.floor(now / attemptWindow)
 const results = await env.DB.batch(['operator', 'session'].map(scope => env.DB.prepare(`
  INSERT INTO vane_second_step_attempts(scope,subject,window,count)
  SELECT '${scope}',${scope === 'operator' ? '?1' : '?2'},?4,1 WHERE ${liveSession}
  ON CONFLICT(scope,subject) DO UPDATE SET window=excluded.window,
   count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END
  WHERE window!=excluded.window OR count<?5 RETURNING count
 `).bind(operatorId, sessionId, now, window, attemptLimit)))
 if (results.some(result => result.results.length !== 1)) refuse()
}

// Must immediately follow the one-row credential INSERT/UPDATE or recovery DELETE
// in the same D1 batch. changes() prevents a losing/replayed request minting a proof.
function proof(env: Env, operatorId: string, sessionId: string, now: number): D1PreparedStatement {
 return env.DB.prepare(`INSERT INTO vane_second_step_sessions(session_id,operator_id,verified_at)
  SELECT ?2,?1,?3 WHERE changes()=1 AND ${liveSession}
  ON CONFLICT(session_id) DO UPDATE SET operator_id=excluded.operator_id,verified_at=excluded.verified_at
  RETURNING session_id`).bind(operatorId, sessionId, now)
}

export async function totpState(env: Env, operatorId: string): Promise<{ enrolled: boolean }> {
 const row = await env.DB.prepare(`SELECT EXISTS(SELECT 1 FROM vane_totp_credentials WHERE operator_id=o.id) AS enrolled
  FROM oa_operators o WHERE o.id=? AND o.status='active'`).bind(operatorId).first<{ enrolled: number }>()
 if (!row) refuse()
 return { enrolled: Boolean(row.enrolled) }
}

export async function beginTotp(env: Env, operatorId: string, sessionId: string): Promise<{ secret: string; uri: string }> {
 const secret = base32(crypto.getRandomValues(new Uint8Array(20)))
 const sealed = await seal(env, pendingPurpose, JSON.stringify([operatorId, sessionId]), secret)
 const now = clock()
 const pending = await env.DB.prepare(`INSERT INTO vane_totp_pending(operator_id,session_id,secret_sealed,expires_at)
  SELECT ?1,?2,?4,?5 WHERE ${liveSession}
   AND NOT EXISTS(SELECT 1 FROM vane_totp_credentials WHERE operator_id=?1)
  ON CONFLICT(operator_id) DO UPDATE SET session_id=excluded.session_id,
   secret_sealed=excluded.secret_sealed,expires_at=excluded.expires_at RETURNING operator_id
 `).bind(operatorId, sessionId, now, sealed, now + lifetime).first()
 if (!pending) refuse()
 return { secret, uri: `otpauth://totp/${encodeURIComponent(`Vane:${operatorId}`)}?secret=${secret}&issuer=Vane&algorithm=SHA1&digits=6&period=30` }
}

/** Establishes a credential once, proves this session, and returns eight recovery codes once. */
export async function confirmTotp(env: Env, operatorId: string, sessionId: string, code: string): Promise<string[]> {
 await attempt(env, operatorId, sessionId)
 if (typeof code !== 'string') refuse()
 const pending = await env.DB.prepare(`SELECT secret_sealed,expires_at FROM vane_totp_pending
  WHERE operator_id=? AND session_id=? AND expires_at>?`).bind(operatorId, sessionId, clock()).first<Pending>()
 if (!pending) refuse()
 const secret = await openSecret(env, pendingPurpose, JSON.stringify([operatorId, sessionId]), pending.secret_sealed)
 const step = await matchingStep(secret, code.trim(), clock())
 if (step === null) refuse()
 const sealed = await seal(env, credentialPurpose, operatorId, secret)
 const codes = Array.from({ length: 8 }, () => base32(crypto.getRandomValues(new Uint8Array(10))).match(/.{4}/g)!.join('-'))
 const hashes = await Promise.all(codes.map(code => recoveryHash(env, operatorId, code.replaceAll('-', ''))))
 const now = clock()
 const results = await env.DB.batch([
  env.DB.prepare(`INSERT INTO vane_totp_credentials(operator_id,secret_sealed,last_step,created_at)
   SELECT ?1,?4,?5,?3 FROM vane_totp_pending p WHERE p.operator_id=?1 AND p.session_id=?2
    AND p.secret_sealed=?6 AND p.expires_at>?3 AND ${liveSession}
   ON CONFLICT(operator_id) DO NOTHING RETURNING operator_id
  `).bind(operatorId, sessionId, now, sealed, step, pending.secret_sealed),
  proof(env, operatorId, sessionId, now),
  env.DB.prepare(`INSERT INTO vane_totp_recovery(operator_id,code_hash)
   SELECT ?1,value FROM json_each(?5) WHERE ${liveSession}
    AND EXISTS(SELECT 1 FROM vane_totp_credentials WHERE operator_id=?1 AND secret_sealed=?4)
  `).bind(operatorId, sessionId, now, sealed, JSON.stringify(hashes)),
  env.DB.prepare(`DELETE FROM vane_totp_pending WHERE operator_id=? AND
   EXISTS(SELECT 1 FROM vane_totp_credentials WHERE operator_id=? AND secret_sealed=?)`).bind(operatorId, operatorId, sealed),
 ])
 if (results[0]!.results.length !== 1 || results[1]!.results.length !== 1) refuse()
 return codes
}

/** Consumes either a globally newer TOTP step or a single-use recovery code. */
export async function verifyTotp(env: Env, operatorId: string, sessionId: string, code: string): Promise<void> {
 await attempt(env, operatorId, sessionId)
 if (typeof code !== 'string') refuse()
 const credential = await env.DB.prepare('SELECT secret_sealed,last_step FROM vane_totp_credentials WHERE operator_id=?').bind(operatorId).first<Credential>()
 if (!credential) refuse()
 const value = code.trim().toUpperCase()
 let consume: D1PreparedStatement
 let now: number
 if (/^\d{6}$/.test(value)) {
  const secret = await openSecret(env, credentialPurpose, operatorId, credential.secret_sealed)
  const step = await matchingStep(secret, value, clock())
  if (step === null || step <= credential.last_step) refuse()
  now = clock()
  consume = env.DB.prepare(`UPDATE vane_totp_credentials SET last_step=?4
   WHERE operator_id=?1 AND secret_sealed=?5 AND last_step<?4 AND ${liveSession} RETURNING operator_id
  `).bind(operatorId, sessionId, now, step, credential.secret_sealed)
 } else {
  // 80 random bits per recovery code. Hyphens/case are presentation only.
  const normalized = value.replaceAll('-', '')
  if (!/^[A-Z2-7]{16}$/.test(normalized)) refuse()
  const hash = await recoveryHash(env, operatorId, normalized)
  now = clock()
  consume = env.DB.prepare(`DELETE FROM vane_totp_recovery
   WHERE operator_id=?1 AND code_hash=?4 AND ${liveSession} RETURNING operator_id
  `).bind(operatorId, sessionId, now, hash)
 }
 const results = await env.DB.batch([consume, proof(env, operatorId, sessionId, now)])
 if (results[0]!.results.length !== 1 || results[1]!.results.length !== 1) refuse()
}
