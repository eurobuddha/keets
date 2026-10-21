#!/usr/bin/env node
// Mailbox push (1.2.5): a subscribed recipient receives a stored message as a push
// within seconds, acks it, and the mailbox deletes the file. Also checks the
// primary-mailbox choice is deterministic. Local bootstrap + real mailbox daemon.
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const SIDECAR = path.join(__dirname, '..', 'sidecar')
const DHT = require(path.join(SIDECAR, 'node_modules', 'hyperdht'))
const wire = require(path.join(SIDECAR, 'wire'))
const { primaryMailbox } = require(path.join(SIDECAR, 'messages'))

const BOOT = 40300
const WORK = process.env.KEETS_TEST_DIR || '/tmp/keets-push-test'
fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(path.join(WORK, 'mb'), { recursive: true })
const kids = []
function run (args, logfile) {
  const p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const out = fs.createWriteStream(logfile); p.stdout.pipe(out); p.stderr.pipe(out)
  kids.push(p); return p
}
function fail (msg) { console.log('FAIL: ' + msg); cleanup(); process.exit(1) }
function cleanup () { for (const k of kids) { try { k.kill() } catch (e) {} } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function waitFor (file, re, tries = 40) {
  for (let i = 0; i < tries; i++) { try { const m = re.exec(fs.readFileSync(file, 'utf8')); if (m) return m } catch (e) {} await sleep(500) }
  return null
}
// dial a service pubkey and return a frame session (mirrors messages.js dialService)
function dial (dht, pkhex) {
  return new Promise((resolve, reject) => {
    const conn = dht.connect(Buffer.from(pkhex, 'hex'))
    const timer = setTimeout(() => { conn.destroy(); reject(new Error('dial timeout')) }, 15000)
    conn.on('error', reject)
    conn.once('open', () => {
      conn.write(Buffer.concat([wire.MAGIC, Buffer.from([wire.SVC_MSG])]))
      const feed = wire.frameReader(); let acked = false; const waiting = []; const queued = []
      conn.on('data', (d) => {
        if (!acked) { if (d[0] !== wire.ACK) return conn.destroy(new Error('no ack')); acked = true; clearTimeout(timer); d = d.slice(1); resolve(session); if (!d.length) return }
        for (const f of feed(d)) { if (waiting.length) waiting.shift()(f); else queued.push(f) }
      })
      conn.on('close', () => { while (waiting.length) waiting.shift()(null) })
      const session = { conn, send: (o) => wire.writeFrame(conn, o), next: (ms = 5000) => queued.length ? Promise.resolve(queued.shift()) : new Promise((r) => { waiting.push(r); setTimeout(() => r(null), ms) }), close: () => conn.end() }
    })
  })
}
;(async () => {
  // deterministic primary
  const boxes = ['cc'.repeat(32), 'aa'.repeat(32), 'bb'.repeat(32)]
  const p1 = primaryMailbox('0x' + 'ab'.repeat(32), boxes), p2 = primaryMailbox('ab'.repeat(32), [...boxes].reverse())
  if (p1 !== p2 || !boxes.includes(p1)) fail('primaryMailbox not deterministic / not in list')
  console.log('PASS: primary mailbox is deterministic (' + p1.slice(0, 8) + '…)')

  run([path.join(__dirname, 'bootstrap.js'), String(BOOT)], path.join(WORK, 'boot.log'))
  await sleep(1500)
  run([path.join(SIDECAR, 'mailbox.js'), '--datadir', path.join(WORK, 'mb'), '--bootstrap', '127.0.0.1:' + BOOT], path.join(WORK, 'mb.log'))
  const m = await waitFor(path.join(WORK, 'mb.log'), /pubkey:0x([0-9a-f]{64})/)
  if (!m) fail('mailbox did not start')
  const MB = m[1]
  console.log('   mailbox ' + MB)

  const dhtR = new DHT({ bootstrap: [{ host: '127.0.0.1', port: BOOT }] })
  const dhtS = new DHT({ bootstrap: [{ host: '127.0.0.1', port: BOOT }] })
  const R = DHT.keyPair(), S = DHT.keyPair()
  const rpk = R.publicKey.toString('hex')

  // recipient subscribes
  const sub = await dial(dhtR, MB)
  sub.send({ t: 'fetch', pk: rpk, sub: true })
  const ch = await sub.next(); if (!ch || ch.t !== 'challenge') fail('no challenge')
  sub.send({ t: 'proof', sig: wire.signFetch(R, ch.nonce) })
  const done = await sub.next(); if (!done || done.t !== 'done' || done.sub !== true) fail('mailbox did not confirm subscription: ' + JSON.stringify(done))
  console.log('PASS: subscription confirmed (done sub:true)')

  // sender stores; recipient must get a push without polling
  const payload = Buffer.from('push me ' + Date.now())
  const sealed = wire.seal(S, R.publicKey, payload)
  const st = await dial(dhtS, MB)
  st.send({ t: 'store', to: rpk, sealed: sealed.toString('base64') })
  const ok = await st.next(); if (!ok || ok.t !== 'ok') fail('store refused: ' + JSON.stringify(ok))
  const t0 = Date.now()
  const pushed = await sub.next(3000)
  if (!pushed || pushed.t !== 'stored') fail('no push within 3 s: ' + JSON.stringify(pushed))
  const got = wire.unseal(R, Buffer.from(pushed.sealed, 'base64'))
  if (!got.payload.equals(payload) || got.from !== '0x' + S.publicKey.toString('hex')) fail('pushed message does not unseal to the original')
  console.log('PASS: stored message pushed to the subscriber in ' + (Date.now() - t0) + ' ms, unsealed, sender verified')
  sub.send({ t: 'ack', id: pushed.id })
  await sleep(500)
  const left = fs.existsSync(path.join(WORK, 'mb', 'mail', rpk)) ? fs.readdirSync(path.join(WORK, 'mb', 'mail', rpk)).filter(f => f.endsWith('.bin')).length : 0
  if (left !== 0) fail('ack did not delete the stored message (' + left + ' left)')
  console.log('PASS: ack deleted the stored copy')
  sub.close(); st.close()
  await dhtR.destroy(); await dhtS.destroy()
  cleanup()
  console.log('ALL PUSH TESTS PASSED')
  process.exit(0)
})().catch((e) => fail(e.stack || e.message))
setTimeout(() => fail('timeout'), 90000)
