// A private (per-transfer Corestore) file must replicate over a media-swarm connection the
// SHARED store already paired, and vice versa. Real local DHT, real media.js, no public peers.
//
// Repro of the 2026-10-27 report: photos arrive, file transfers never start. On a phone the one
// media connection to a contact is usually made by a photo first; the private store then rides
// that same connection.
const IS_BARE = typeof Bare !== 'undefined'
const fs = IS_BARE ? require('../sidecar/node_modules/bare-fs') : require('fs')
const path = IS_BARE ? require('../sidecar/node_modules/bare-path') : require('path')
const os = IS_BARE ? require('../sidecar/node_modules/bare-os') : require('os')
const DHT = require('../sidecar/node_modules/hyperdht')
const createMedia = require('../sidecar/media')

const BLOCK = 112 * 1024
const BLOCKS = 14 // ~1.5 MB, like KeetsFiles

function equal (a, b, what) { if (!a.equals(b)) throw Error(what + ': bytes differ') }

;(async () => {
  const dir = path.join(os.tmpdir(), 'keets-shared-conn-' + Date.now() + '-' + Math.random().toString(16).slice(2))
  fs.mkdirSync(dir, { mode: 0o700 })
  const boot = DHT.bootstrapper(45994, '127.0.0.1'); await boot.ready()
  const peers = []
  const timer = setTimeout(() => { console.error('FAIL fixture timed out'); if (IS_BARE) Bare.exit(1); else process.exit(1) }, 150000)
  function peer (name, seed) {
    const media = createMedia({ keetsdir: path.join(dir, name), seed: Buffer.alloc(32, seed), bootstrap: [{ host: '127.0.0.1', port: boot.address().port }], maxconns: 6 })
    peers.push(media); return media
  }
  async function publishFile (a, id) {
    const urls = []
    for (let i = 0; i < BLOCKS; i++) urls.push((await a.publish('/private/' + id + '/' + i, Buffer.alloc(BLOCK, i + 1))).url)
    const manifest = await a.publish('/private/' + id + '/manifest', Buffer.from('manifest-' + id))
    return { urls, manifest: manifest.url }
  }
  async function fetchFile (b, id, file, label) {
    const t0 = Date.now()
    equal(await b.fetch(file.manifest, 64 * 1024), Buffer.from('manifest-' + id), label + ' manifest')
    for (let i = 0; i < BLOCKS; i++) equal(await b.fetch(file.urls[i], BLOCK), Buffer.alloc(BLOCK, i + 1), label + ' block ' + i)
    console.log('PASS ' + label + ' (' + (Date.now() - t0) + ' ms)')
  }
  try {
    const a = peer('a', 1); const b = peer('b', 2); const c = peer('c', 3)
    await a.start(); await b.start(); await c.start()
    const id1 = 'a'.repeat(32); const id2 = 'b'.repeat(32)
    const photo = await a.publish('/chat/p.jpg', Buffer.from('photo'))
    const file1 = await publishFile(a, id1)
    const file2 = await publishFile(a, id2)

    // B: photo first (connection paired by the shared store), then the private file over it.
    equal(await b.fetch(photo.url), Buffer.from('photo'), 'b photo')
    if (b.swarm.connections.size !== 1) throw Error('b expected one media connection, has ' + b.swarm.connections.size)
    await fetchFile(b, id1, file1, 'b: private file after a photo on the same connection')
    await fetchFile(b, id2, file2, 'b: second private file on the same connection')

    // C: private first, then the photo, then another private file.
    await fetchFile(c, id1, file1, 'c: private file on a fresh connection')
    equal(await c.fetch(photo.url), Buffer.from('photo'), 'c photo')
    await fetchFile(c, id2, file2, 'c: second private file after the photo')

    // The phones' order: the connection already exists, THEN the sender publishes a new file.
    const id3 = 'c'.repeat(32)
    const file3 = await publishFile(a, id3)
    await fetchFile(b, id3, file3, 'b: file published after the connection existed')
    await fetchFile(c, id3, file3, 'c: same')
    // ... and the receiver has the sender's file open before the sender re-shares it
    await a.privateSharing(file3.manifest, false)
    await a.privateSharing(file3.manifest, true)
    const d = peer('d', 4); await d.start()
    equal(await d.fetch(photo.url), Buffer.from('photo'), 'd photo')
    await fetchFile(d, id3, file3, 'd: file re-shared after a stop, photo connection first')

    // The phones' failure: the swarm gave up on the sender (4 failed dials) and would only look
    // again at the topic's 10-minute refresh. A fetch must re-dial now.
    // Both sides dial on a topic, so both must have given up (as two phones that cannot
    // hole-punch each other have).
    const aMedia = a.swarm.keyPair.publicKey.toString('hex')
    const id4 = 'd'.repeat(32)
    const file4 = await publishFile(a, id4) // only a holds this one (b, c mirror what they fetched)
    // the drive is already open on d (a first attempt happened): a later Resume joins no topic
    equal(await d.fetch(file4.manifest, 64 * 1024), Buffer.from('manifest-' + id4), 'd manifest4')
    await new Promise(resolve => setTimeout(resolve, 3000)) // let the joins' own lookups finish first
    const lost = new Promise(resolve => { for (const c of d.swarm.connections) c.once('close', resolve) })
    for (const c of d.swarm.connections) c.destroy()
    await lost
    await new Promise(resolve => setTimeout(resolve, 200))
    const info = d.swarm.peers.get(aMedia)
    if (!info) throw Error('d has no PeerInfo for a')
    // exhausted, as after four failed hole-punches: no retry for attempts > 3, priority decayed
    for (const p of [...d.swarm.peers.values(), ...a.swarm.peers.values()]) { p.attempts = 4; p.priority = 0 }
    await new Promise(resolve => setTimeout(resolve, 2500)) // the retry timers fire and skip them
    const toA = () => [...d.swarm.connections].some(c => c.remotePublicKey.toString('hex') === aMedia)
    if (toA()) throw Error('fixture: d re-dialed a on its own')
    const t0 = Date.now()
    await fetchFile(d, id4, file4, 'd: fetch re-dials a sender the swarm had given up on')
    if (Date.now() - t0 > 25000) throw Error('re-dial took the full media deadline')
    if (!toA()) throw Error('the file arrived without a connection to its only holder?')
  } finally {
    clearTimeout(timer)
    for (const p of peers) { try { await p.close() } catch (e) {} }
    await boot.destroy()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})().catch(e => { console.error('FAIL ' + (e.stack || e)); if (IS_BARE) Bare.exit(1); else process.exitCode = 1 })
