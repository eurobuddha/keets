#!/usr/bin/env node
// Serve mode (1.3.0): ONE sidecar (A, --serve) is a fixed-port DHT bootstrap node AND a
// mailbox. B joins the DHT with A as its ONLY bootstrap, sends to C while C is offline
// (--mailboxes = A's mailbox key, replacing the defaults), the mail lands in A's store,
// and C fetches it on start. Private DHT: A has --bootstrap none.
const path = require('path')
const fs = require('fs')
const http = require('http')
const { spawn } = require('child_process')
const SIDECAR = path.join(__dirname, '..', 'sidecar', 'index.js')

const WORK = process.env.KEETS_TEST_DIR || '/tmp/keets-serve-test'
const DHT_PORT = 40400
const TOK = { a: 'a'.repeat(64), b: 'b'.repeat(64), c: 'c'.repeat(64) }
const API = { a: 10406, b: 10416, c: 10426 }
fs.rmSync(WORK, { recursive: true, force: true })
for (const d of ['a', 'b', 'c']) fs.mkdirSync(path.join(WORK, d), { recursive: true })

const kids = new Map()
function run (name, args) {
  const p = spawn(process.execPath, [SIDECAR, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, KEETS_TOKEN: TOK[name], KEETS_STDIN_EXIT: '0' }
  })
  const out = fs.createWriteStream(path.join(WORK, name + '.log')); p.stdout.pipe(out); p.stderr.pipe(out)
  kids.set(name, p); return p
}
function stop (name) { const p = kids.get(name); if (p) { try { p.kill() } catch (e) {} kids.delete(name) } }
function cleanup () { for (const n of [...kids.keys()]) stop(n) }
function fail (msg) { console.log('FAIL: ' + msg); for (const n of ['a', 'b', 'c']) { try { console.log('--- ' + n + '.log:\n' + fs.readFileSync(path.join(WORK, n + '.log'), 'utf8').split('\n').slice(-15).join('\n')) } catch (e) {} } cleanup(); process.exit(1) }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function waitLog (name, re, tries = 60) {
  for (let i = 0; i < tries; i++) { try { const m = re.exec(fs.readFileSync(path.join(WORK, name + '.log'), 'utf8')); if (m) return m } catch (e) {} await sleep(500) }
  return null
}
function api (name, method, p, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: API[name], method, path: p, headers: { 'x-keets-token': TOK[name], 'content-type': 'application/json' } }, (res) => {
      const chunks = []; res.on('data', d => chunks.push(d)); res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

;(async () => {
  // A: the serve node — root of a private DHT, mailbox included
  run('a', ['--serve', '--dht-port', String(DHT_PORT), '--public-host', '127.0.0.1', '--bootstrap', 'none',
    '--port', '10401', '--apiport', String(API.a), '--datadir', path.join(WORK, 'a'), '--mailbox-dir', path.join(WORK, 'a', 'mb')])
  const mb = await waitLog('a', /keets mailbox up — pubkey:0x([0-9a-f]{64})/)
  if (!mb) fail('A: mailbox never came up')
  const MB = mb[1]
  if (!(await waitLog('a', /keets api up/))) fail('A: api never came up')
  const ainfo = await api('a', 'GET', '/info')
  if (!ainfo.dht || ainfo.dht.mode !== 'serve' || !ainfo.dht.serve || ainfo.dht.serve.mailboxPubkey !== '0x' + MB || ainfo.dht.serve.dhtPort !== DHT_PORT) fail('A /info.dht.serve wrong: ' + JSON.stringify(ainfo.dht))
  if (ainfo.dht.routing !== true || ainfo.dht.firewalled !== false) fail('A is not a routing, unfirewalled node from the start: ' + JSON.stringify(ainfo.dht))
  console.log('PASS: A serves — routing from tick 0, mailbox 0x' + MB + ' on udp ' + DHT_PORT)

  // C: start once to learn its pubkey, then take it offline
  run('c', ['--bootstrap', '127.0.0.1:' + DHT_PORT, '--mailboxes', MB, '--port', '10421', '--apiport', String(API.c), '--datadir', path.join(WORK, 'c')])
  const cpub = await waitLog('c', /keets sidecar up — pubkey:0x([0-9a-f]{64})/)
  if (!cpub) fail('C never started')
  const C = cpub[1]
  stop('c'); await sleep(1000)

  // B: A is its ONLY bootstrap; mailbox list = A's mailbox only
  run('b', ['--bootstrap', '127.0.0.1:' + DHT_PORT, '--mailboxes', '0x' + MB, '--port', '10411', '--apiport', String(API.b), '--datadir', path.join(WORK, 'b')])
  if (!(await waitLog('b', /swarm flushed — announced on DHT/))) fail('B never announced via A as bootstrap')
  const binfo = await api('b', 'GET', '/info')
  if (JSON.stringify(binfo.dht.mailboxes) !== JSON.stringify(['0x' + MB])) fail('--mailboxes did not REPLACE the defaults: ' + JSON.stringify(binfo.dht.mailboxes))
  console.log('PASS: B bootstrapped from A alone; --mailboxes replaces the default list')

  // B -> C (offline): must land in A's mailbox store
  const r = await api('b', 'POST', '/message', { to: '0x' + C, payload: 'via the fleet jar mailbox' })
  if (r.delivered !== 'mailbox') fail('B->C not delivered via mailbox: ' + JSON.stringify(r))
  const cdir = path.join(WORK, 'a', 'mb', 'mail', C)
  const stored = fs.existsSync(cdir) ? fs.readdirSync(cdir).filter(f => f.endsWith('.bin')) : []
  if (stored.length !== 1) fail('A store has ' + stored.length + ' files for C (want 1)')
  console.log('PASS: mail for offline C stored at A (' + stored[0] + ')')

  // let B's direct dial to C time out (DIAL_TIMEOUT 15 s) so the mailbox is the only path left
  await sleep(17000)

  // C back online: fetches from A's mailbox
  run('c', ['--bootstrap', '127.0.0.1:' + DHT_PORT, '--mailboxes', MB, '--port', '10421', '--apiport', String(API.c), '--datadir', path.join(WORK, 'c')])
  if (!(await waitLog('c', /keets api up/))) fail('C did not restart')
  let inbox = []
  for (let i = 0; i < 60; i++) { try { inbox = await api('c', 'GET', '/messages') } catch (e) {} if (inbox.length) break; await sleep(1000) }
  const got = inbox.find(m => Buffer.from(m.payload, 'base64').toString() === 'via the fleet jar mailbox')
  if (!got) fail('C never fetched the mail: ' + JSON.stringify(inbox))
  if (got.via !== 'mailbox') fail('C got the mail but not via the mailbox: ' + JSON.stringify(got))
  console.log('PASS: C fetched the mail from A\'s mailbox (from 0x' + got.from.replace(/^0x/, '') + ')')
  let left = -1
  for (let i = 0; i < 20; i++) { left = fs.existsSync(cdir) ? fs.readdirSync(cdir).filter(f => f.endsWith('.bin')).length : 0; if (!left) break; await sleep(500) }
  if (left) fail('A store still holds ' + left + ' file(s) for C after the fetch (ack did not delete)')
  console.log('PASS: C\'s ack deleted the copy at A')

  console.log('== ALL PASS')
  cleanup(); process.exit(0)
})().catch((e) => fail(e.stack || e.message))
