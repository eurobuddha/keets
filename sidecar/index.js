#!/usr/bin/env node
// keets sidecar — bridges Hyperswarm/HyperDHT peer streams to the local Minima node.
//
// Every peer stream (dialed or accepted) becomes a loopback TCP connection to the
// node's own Minima port. Before piping, exactly one Minima-framed MSG_KEETS (type 24)
// preamble is injected so the Java side can flag the client and derive its synthetic
// per-pubkey identity. Frame spec: ../BRIDGE.md. After the preamble the bytes are
// end-to-end Minima protocol between the two Java nodes — this process never parses them.
//
// Runs on TWO runtimes from one source: node (desktop, incl. Electron via
// ELECTRON_RUN_AS_NODE) and bare (Android bare-kit worklet). Builtins are picked at
// runtime — node's package-"imports" can't target builtins from CJS (ERR_INVALID_URL_SCHEME,
// v24) — and all crypto goes through sodium-universal, which both runtimes load natively.
// Keep every require specifier a string literal so bare-pack can preresolve them.

const IS_BARE = typeof Bare !== 'undefined'

// On bare an uncaught error ABORTS the host process — inside a bare-kit worklet that
// takes the whole Android app down with SIGABRT (proven on-device 2026-10-13, missing
// addon). The node hosting us must never die for the sidecar: log and keep running.
if (IS_BARE) {
  Bare.on('uncaughtException', (err) => { console.error('keets uncaught:', err) })
  Bare.on('unhandledRejection', (err) => { console.error('keets unhandled:', err) })
}

const Hyperswarm = require('hyperswarm')
const DHT = require('hyperdht')
const sodium = require('sodium-universal')
const net = IS_BARE ? require('bare-tcp') : require('net')
const fs = IS_BARE ? require('bare-fs') : require('fs')
const path = IS_BARE ? require('bare-path') : require('path')
const process = IS_BARE ? require('bare-process') : require('process')

// --- args ---------------------------------------------------------------
function arg (name, def) {
  const i = process.argv.indexOf('--' + name)
  return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def
}
const PORT = parseInt(arg('port', '9001'))
const DATADIR = arg('datadir', '.')
const TOPIC = arg('topic', 'minima-mainnet-keets-v1')
const MAXCONNS = parseInt(arg('maxconns', '6'))
const CONNECT = arg('connect', '').split(',').filter(Boolean)
const BOOTSTRAP = arg('bootstrap', '').split(',').filter(Boolean).map(s => {
  const ix = s.lastIndexOf(':')
  return { host: s.slice(0, ix), port: parseInt(s.slice(ix + 1)) }
})

// env on desktop (never argv — visible in ps); --token only inside a bare-kit worklet,
// whose arguments live in process memory, not /proc cmdline.
const TOKEN = (process.env.KEETS_TOKEN || arg('token', '')).replace(/^0x/i, '')
if (TOKEN.length !== 64) {
  console.error('KEETS_TOKEN env var missing or invalid — refusing to start')
  process.exit(1)
}

function sha256 (buf) {
  const out = Buffer.alloc(32)
  sodium.crypto_hash_sha256(out, buf)
  return out
}

// --- keypair: persistent 32-byte seed = this node's network identity ----
const keetsdir = path.join(DATADIR, 'keets')
fs.mkdirSync(keetsdir, { recursive: true })
const seedfile = path.join(keetsdir, 'keypair')
let seed
if (fs.existsSync(seedfile)) {
  seed = fs.readFileSync(seedfile)
} else {
  seed = Buffer.alloc(32)
  sodium.randombytes_buf(seed)
  fs.writeFileSync(seedfile, seed, { mode: 0o600 })
}
const keyPair = DHT.keyPair(seed)
const mypub = keyPair.publicKey.toString('hex')
fs.writeFileSync(path.join(keetsdir, 'pubkey'), '0x' + mypub + '\n')

// --- MSG_KEETS preamble (one Minima frame) -------------------------------
// [4B BE frame len][1B type=24][4B BE len=32][32B token][4B BE len=32][32B pubkey][1B initiator]
function preamble (remotePubKey, initiator) {
  const payload = Buffer.alloc(1 + 4 + 32 + 4 + 32 + 1)
  let o = 0
  payload.writeUInt8(24, o); o += 1
  payload.writeInt32BE(32, o); o += 4
  Buffer.from(TOKEN, 'hex').copy(payload, o); o += 32
  payload.writeInt32BE(32, o); o += 4
  remotePubKey.copy(payload, o); o += 32
  payload.writeUInt8(initiator ? 1 : 0, o)
  const frame = Buffer.alloc(4)
  frame.writeInt32BE(payload.length, 0)
  return Buffer.concat([frame, payload])
}

// --- swarm ----------------------------------------------------------------
const opts = { keyPair }
if (BOOTSTRAP.length) opts.bootstrap = BOOTSTRAP
const swarm = new Hyperswarm(opts)

let conns = 0
swarm.on('connection', (conn, info) => {
  if (conns >= MAXCONNS) {
    conn.destroy()
    return
  }
  conns++
  const pk = '0x' + info.publicKey.toString('hex')
  // path = the UDP endpoint actually carrying the bytes: the peer itself after a
  // successful hole punch, or a DHT relay node when punching failed (CGNAT fallback).
  const raw = conn.rawStream
  const via = raw && raw.remoteHost ? raw.remoteHost + ':' + raw.remotePort : 'unknown'
  console.log('peer connected pubkey:' + pk + ' initiator:' + conn.isInitiator + ' path:' + via + ' conns:' + conns)

  const tcp = net.connect(PORT, '127.0.0.1')
  tcp.on('connect', () => {
    tcp.write(preamble(info.publicKey, conn.isInitiator))
    conn.pipe(tcp)
    tcp.pipe(conn)
  })
  conn.on('error', () => tcp.destroy())
  tcp.on('error', () => conn.destroy())
  conn.on('close', () => {
    conns--
    tcp.destroy()
    console.log('peer closed pubkey:' + pk + ' conns:' + conns)
  })
  tcp.on('close', () => conn.destroy())
})

const topic = sha256(Buffer.from(TOPIC))
swarm.join(topic, { server: true, client: true })
for (const pk of CONNECT) {
  swarm.joinPeer(Buffer.from(pk.replace(/^0x/i, ''), 'hex'))
}

console.log('keets sidecar up — pubkey:0x' + mypub + ' topic:' + TOPIC + ' node:127.0.0.1:' + PORT)
swarm.flush().then(() => console.log('swarm flushed — announced on DHT'))

// exit when the parent Minima node dies (its end of our stdin pipe closes).
// A bare-kit worklet has no parent pipe — its host app owns the lifecycle instead.
if (process.stdin && typeof process.stdin.resume === 'function') {
  process.stdin.resume()
  process.stdin.on('end', () => process.exit(0))
  process.stdin.on('close', () => process.exit(0))
}
