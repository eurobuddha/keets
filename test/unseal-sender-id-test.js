// 1.3.6: unseal() accepts a sender id only as exactly 64 lower-case hex characters. Before, Buffer.from(from, 'hex')
// stopped at the first non-hex character, so a real key followed by other text verified and was returned whole.
// Run: node test/unseal-sender-id-test.js
const assert = require('assert')
const path = require('path')
const sodium = require(path.join(__dirname, '..', 'sidecar', 'node_modules', 'sodium-universal'))
const wire = require(path.join(__dirname, '..', 'sidecar', 'wire.js'))

function keyPair () {
  const publicKey = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES), secretKey = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES)
  sodium.crypto_sign_keypair(publicKey, secretKey)
  return { publicKey, secretKey }
}
// what seal() does, with the `from` text of the caller's choice (signed by the same key)
function sealWithFrom (fromKeyPair, toEdPubKey, from) {
  const m = Buffer.from(JSON.stringify({ from, ts: Date.now(), payload: Buffer.from('hi').toString('base64') }), 'utf8')
  const sig = Buffer.alloc(sodium.crypto_sign_BYTES)
  sodium.crypto_sign_detached(sig, m, fromKeyPair.secretKey)
  const inner = Buffer.from(JSON.stringify({ m: m.toString('base64'), sig: sig.toString('base64') }), 'utf8')
  const curvePk = Buffer.alloc(sodium.crypto_box_PUBLICKEYBYTES)
  sodium.crypto_sign_ed25519_pk_to_curve25519(curvePk, toEdPubKey)
  const sealed = Buffer.alloc(inner.length + sodium.crypto_box_SEALBYTES)
  sodium.crypto_box_seal(sealed, inner, curvePk)
  return sealed
}

const alice = keyPair(), bob = keyPair(), hex = alice.publicKey.toString('hex')
// an honest envelope still opens
const good = wire.unseal(bob, wire.seal(alice, bob.publicKey, Buffer.from('hello')))
assert.strictEqual(good.from, '0x' + hex)
assert.strictEqual(good.payload.toString(), 'hello')
// a real key followed by text: the signature check alone passed it
for (const from of [hex + ' datahex:00;send amount:1 address:0xEE;x', hex + ';quit', hex + 'zz', hex.toUpperCase(), '0x' + hex, hex.slice(0, 62), 12345, null]) {
  assert.throws(() => wire.unseal(bob, sealWithFrom(alice, bob.publicKey, from)), /bad sender id/, 'accepted: ' + String(from).slice(0, 80))
}
console.log('unseal sender id: ok (1 honest envelope opened, 8 malformed sender ids refused)')
