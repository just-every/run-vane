import { demoEffect } from './modules/demo/index.mjs'
import { createMailSender } from './modules/mail/index.mjs'
import { createD1DevelopmentOutbox } from './modules/mail/src/development/index.mjs'

function realOperatorMail(env) {
 return env.MAIL_PROVIDER === 'development'
  ? env.AUTH_LOCAL === 'true' ? createMailSender({ provider: 'development', mode: 'development' }, { outbox: createD1DevelopmentOutbox({ db: env.DB }) }) : undefined
  : env.MAIL_PROVIDER ? createMailSender({ provider: env.MAIL_PROVIDER, mode: 'production', apiKey: env.MAIL_API_KEY, ...(env.MAIL_PROVIDER === 'cloudflare' ? { accountId: env.MAIL_ACCOUNT_ID } : {}) }) : undefined
}

// Construct the configured transport only for real sends: demos hold no provider secret.
export function operatorMail(env) {
 if (env.RER_DEMO !== '1') return realOperatorMail(env)
 return { send: message => demoEffect(
  () => { const sender = realOperatorMail(env); if (!sender) throw new Error('Mail is not configured'); return sender.send(message) },
  () => ({ provider: env.MAIL_PROVIDER ?? 'resend', status: env.MAIL_PROVIDER === 'development' ? 'development' : 'accepted', providerMessageId: null }),
 ) }
}
