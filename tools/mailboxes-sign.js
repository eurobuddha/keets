#!/usr/bin/env node
// keets mailbox list signer — maintains the signed list that every node fetches at startup
// (GeneralParams.KEETS_MAILBOX_URL, verified in KeetsMailboxList.java with the baked-in
// Ed25519 public key) and passes to its sidecar as --mailboxes. Lets a new fleet box's
// mailbox join without an app release.
//
//   node tools/mailboxes-sign.js --keygen ~/.keets/mailbox-signing.key      (once; prints the pubkey to bake)
//   node tools/mailboxes-sign.js --key ~/.keets/mailbox-signing.key --in mailboxes.json --out mailboxes.json \
//        [--add 0x<pk>]... [--remove 0x<pk>]...                                 (re-signs with ts = now)
//   node tools/mailboxes-sign.js --verify mailboxes.json --pub <64-hex>        (what the nodes do)
//
// File: {"v":1,"ts":<ms>,"mailboxes":["<64-hex>",...],"sig":"<128-hex>"}
// Signed string (utf8): "1\n<ts>\n<mailboxes sorted, joined by ,>"  — plain Ed25519 (RFC 8032),
// so BouncyCastle's Ed25519Signer verifies it byte-for-byte.

const fs = require('fs')
const path = require('path')
const sodium = require(path.join(__dirname, '..', 'sidecar', 'node_modules', 'sodium-universal'))

function arg (name, def) { const i = process.argv.indexOf('--' + name); return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def }
function args (name) { const out = []; for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === '--' + name && process.argv[i + 1] !== undefined) out.push(process.argv[++i]); return out }
function die (m) { console.error('mailboxes-sign: ' + m); process.exit(1) }
const hex = (s) => String(s).replace(/^0x/i, '').toLowerCase()
const isPk = (s) => /^[0-9a-f]{64}$/.test(s)

function canonical (ts, mailboxes) { return '1\n' + ts + '\n' + [...mailboxes].sort().join(',') }

function sign (file, keyfile, add, remove) {
  const sk = fs.readFileSync(keyfile)
  if (sk.length !== sodium.crypto_sign_SECRETKEYBYTES) die('bad key file (want ' + sodium.crypto_sign_SECRETKEYBYTES + ' bytes)')
  let list = []
  if (file && fs.existsSync(file)) {
    const cur = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (cur.v !== 1 || !Array.isArray(cur.mailboxes)) die('unrecognised input file')
    list = cur.mailboxes.map(hex)
  }
  for (const a of add.map(hex)) { if (!isPk(a)) die('bad pubkey ' + a); if (!list.includes(a)) list.push(a) }
  for (const r of remove.map(hex)) list = list.filter(m => m !== r)
  if (!list.length) die('refusing to sign an empty list')
  list = [...new Set(list)].sort()
  const ts = Date.now()
  const sig = Buffer.alloc(sodium.crypto_sign_BYTES)
  sodium.crypto_sign_detached(sig, Buffer.from(canonical(ts, list), 'utf8'), sk)
  return { v: 1, ts, mailboxes: list, sig: sig.toString('hex') }
}

function verify (doc, pubhex) {
  if (!doc || doc.v !== 1 || !Number.isInteger(doc.ts) || !Array.isArray(doc.mailboxes) || typeof doc.sig !== 'string') return false
  if (!doc.mailboxes.every(isPk)) return false
  const pk = Buffer.from(hex(pubhex), 'hex')
  if (pk.length !== sodium.crypto_sign_PUBLICKEYBYTES) return false
  const sig = Buffer.from(doc.sig, 'hex')
  if (sig.length !== sodium.crypto_sign_BYTES) return false
  return sodium.crypto_sign_verify_detached(sig, Buffer.from(canonical(doc.ts, doc.mailboxes), 'utf8'), pk)
}

module.exports = { canonical, sign, verify }

if (require.main === module) {
  if (arg('keygen')) {
    const out = arg('keygen')
    if (fs.existsSync(out)) die(out + ' exists — not overwriting a signing key')
    const pk = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES)
    const sk = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES)
    sodium.crypto_sign_keypair(pk, sk)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, sk, { mode: 0o600 })
    console.log('signing key written to ' + out + ' (keep it OFF git)')
    console.log('public key (bake into GeneralParams.KEETS_MAILBOX_SIGNKEY): ' + pk.toString('hex'))
  } else if (arg('verify')) {
    const doc = JSON.parse(fs.readFileSync(arg('verify'), 'utf8'))
    const pub = arg('pub') || die('--pub <64-hex> required')
    if (!verify(doc, pub)) die('signature INVALID')
    console.log('signature OK — ts ' + new Date(doc.ts).toISOString() + ', ' + doc.mailboxes.length + ' mailboxes:')
    for (const m of doc.mailboxes) console.log('  0x' + m)
  } else if (arg('key')) {
    const doc = sign(arg('in', arg('out', '')), arg('key'), args('add'), args('remove'))
    const out = arg('out') || die('--out <file> required')
    fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n')
    console.log('signed ' + doc.mailboxes.length + ' mailboxes, ts ' + new Date(doc.ts).toISOString() + ' -> ' + out)
    for (const m of doc.mailboxes) console.log('  0x' + m)
  } else {
    die('usage: --keygen <file> | --key <file> --out <json> [--in <json>] [--add <pk>]... [--remove <pk>]... | --verify <json> --pub <hex>')
  }
}
