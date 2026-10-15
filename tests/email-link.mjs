import {queuedEntrypoint} from '@runeditrun/rer/queued-entry'
const queued=await queuedEntrypoint(import.meta.url,'verify:email-link');if(queued!==null)process.exit(queued)
// The emitted app uses its real email-link flow; only the paid mail edge is fake.
import assert from 'node:assert/strict'
import { installation } from './harness.mjs'
const app=await installation()
try {
 assert.equal((await app.post('/auth/magic-link',{email:'owner@example.test'})).status,202)
 assert.equal((await app.request('/__dev/outbox')).status,404)
 const message=app.sentMail.at(-1)
 const href=message.html.match(/href="([^"]*\/auth\/confirm\?token=[^"]+)"/)[1].replaceAll('&amp;','&')
 const link=new URL(href)
 assert.equal((await app.request(link.pathname+link.search)).status,200)
 const confirmed=await app.post('/auth/confirm',{token:link.searchParams.get('token')})
 assert.equal(confirmed.status,303)
 const cookie=confirmed.headers.getSetCookie().map(line=>line.split(';')[0]).join('; ')
 const session=await app.request('/auth/session',{headers:{cookie}})
 assert.equal(session.status,200)
 assert.equal((await session.json()).operator.email,'owner@example.test')
 console.log('Emitted Worker email link: request, provider edge, confirmation, session passed; no outbox UI')
} finally {await app.close()}
