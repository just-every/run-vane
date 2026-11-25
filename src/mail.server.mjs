import { createMailSender } from './modules/mail/index.mjs'
export { createD1EventStore, createDeliveryEventIntake, verifyWebhook } from './modules/mail/index.mjs'

const disabledSender = Object.freeze({
 async send() {
  return { status: 'rejected', provider: 'none', providerMessageId: null, code: 'mail_off' }
 },
})

export function operatorMail(env) {
 if (env.RER_DEMO === '1') return createMailSender({ provider: 'development', mode: 'development' })
 if (env.MAIL_PROVIDER === 'none') return disabledSender
 return env.MAIL_PROVIDER === 'development'
  ? env.AUTH_LOCAL === 'true' ? createMailSender({ provider: 'development', mode: 'development' }) : undefined
  : env.MAIL_PROVIDER ? createMailSender({ provider: env.MAIL_PROVIDER, mode: 'production', apiKey: env.MAIL_API_KEY, ...(env.MAIL_PROVIDER === 'rer' ? { relayUrl: env.MAIL_RELAY_URL } : {}), ...(env.MAIL_PROVIDER === 'cloudflare' ? { accountId: env.MAIL_ACCOUNT_ID } : {}) }) : undefined
}
