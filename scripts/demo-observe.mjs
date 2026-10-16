// Test-host admissions only: never retain request headers, cookies or mail bodies.
import { readFile, appendFile, mkdir } from 'node:fs/promises'
const account = process.env.CLOUDFLARE_ACCOUNT_ID
if (account !== 'b20c0ca9cab0c2b70e13d7cf724b89bd') throw Error('wrong-account')
const config = JSON.parse(await readFile('.rer/demo-host/wrangler.json', 'utf8'))
if (!config.vars.DEMO_ORIGIN.startsWith('https://demo.test.')) throw Error('test-host-required')
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${config.name}/tails`
const headers = { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' }
const output = '.rer/demo-admissions.jsonl'
await mkdir('.rer', { recursive: true })
const record = value => appendFile(output, JSON.stringify(value) + '\n')
const response = await fetch(base, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(20000) })
const result = await response.json()
if (!response.ok || !result.success) throw Error('tail-create-failed')
const tail = result.result, socket = new WebSocket(tail.url, 'trace-v1')
socket.binaryType = 'arraybuffer'
let timer, stop
try {
 await new Promise((resolve, reject) => {
  const deadline = setTimeout(() => reject(Error('tail-connect-timeout')), 30000)
  socket.addEventListener('open', () => { clearTimeout(deadline); resolve() }, { once: true })
  socket.addEventListener('error', () => { clearTimeout(deadline); reject(Error('tail-connect-failed')) }, { once: true })
 })
 await record({ event: 'observation_started', at: new Date().toISOString(), worker: config.name })
 console.log('Admission observation started')
 const pending = []
 socket.addEventListener('message', message => {
  try {
   const event = JSON.parse(typeof message.data === 'string' ? message.data : new TextDecoder().decode(message.data))
   for (const log of event.logs ?? []) for (const part of log.message ?? []) {
    let value
    try { value = typeof part === 'string' ? JSON.parse(part) : part } catch { continue }
    if (value?.event === 'demo_admitted') pending.push(record({ event: value.event, at: value.at, correlation: value.correlation, agent: value.agent, network: value.network }))
   }
  } catch { pending.push(record({ event: 'parse_error', at: new Date().toISOString() })) }
 })
 await new Promise((resolve, reject) => {
  stop = resolve
  timer = setTimeout(resolve, 15 * 60 * 1000)
  socket.addEventListener('close', () => reject(Error('tail-closed-before-window-ended')), { once: true })
  socket.addEventListener('error', () => reject(Error('tail-failed')), { once: true })
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
 })
 await Promise.all(pending)
 await record({ event: 'observation_completed', at: new Date().toISOString() })
 console.log('Admission observation completed')
} finally {
 clearTimeout(timer)
 if (stop) { process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop) }
 socket.close()
 const removed = await fetch(base + '/' + tail.id, { method: 'DELETE', headers, signal: AbortSignal.timeout(20000) })
 await removed.arrayBuffer()
 if (!removed.ok) throw Error('tail-delete-failed')
 console.log('Admission tail deleted')
}
// Node's native WebSocket can retain its closing handle after the provider has
// deleted the tail. This CLI has finished all writes and provider cleanup.
process.exit(0)
