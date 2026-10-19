// keets media — host and fetch content over Hyperdrive, P2P, no server.
//
// Every sidecar owns one writable drive (key derived from the corestore primary key,
// stable across restarts). publish() puts bytes in it and returns a keets:// URL;
// fetch() resolves any keets:// URL by joining that drive's discovery key on a
// dedicated media swarm. Peers that fetched a drive keep seeding it while running,
// and pin() seeds it permanently (pins persist in <keetsdir>/pins.json).
//
// The media swarm runs on its OWN keypair (derived from the node seed) sharing the
// same DHT node — so every connection on it is Hyperdrive replication, and the main
// keypair's Minima bridge protocol is untouched.

const Hyperswarm = require('hyperswarm')
const DHT = require('hyperdht')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const sodium = require('sodium-universal')

const IS_BARE = typeof Bare !== 'undefined'
const fs = IS_BARE ? require('bare-fs') : require('fs')
const path = IS_BARE ? require('bare-path') : require('path')

function sha256 (buf) {
  const out = Buffer.alloc(32)
  sodium.crypto_hash_sha256(out, buf)
  return out
}

const { readMedia } = require('./media-read')

module.exports = function createMedia ({ keetsdir, seed, bootstrap, maxconns }) {
  const store = new Corestore(path.join(keetsdir, 'store'))

  // dedicated identity for media replication, derived from the node seed — and a
  // dedicated DHT node: sharing the main swarm's DHT node proved flaky (replication
  // handshakes stall when the main keypair's bridge churns on the same UDX socket,
  // seen 2026-10-13); one swarm per DHT node is the pattern Keet itself ships.
  const mediaSeed = sha256(Buffer.concat([seed, Buffer.from('keets-media-v1')]))
  const dht = new DHT(bootstrap && bootstrap.length ? { bootstrap } : {})
  const swarm = new Hyperswarm({ dht, keyPair: DHT.keyPair(mediaSeed), maxPeers: maxconns })
  swarm.on('connection', (conn) => {
    console.log('keets media conn: 0x' + conn.remotePublicKey.toString('hex'))
    conn.on('error', () => {})
    store.replicate(conn)
  })

  const pinsfile = path.join(keetsdir, 'pins.json')
  let pins = []
  try { pins = JSON.parse(fs.readFileSync(pinsfile, 'utf8')) } catch (e) {}
  const savePins = () => fs.writeFileSync(pinsfile, JSON.stringify(pins))

  const drives = new Map() // hex key -> Hyperdrive
  const ownedDrives = new Map()

  async function own (scope = 'media') {
    // Public Salon links must never reveal the drive key used by chat attachments.
    if (scope !== 'media' && scope !== 'salon') throw new Error('invalid media scope')
    if (!ownedDrives.has(scope)) {
      const opening = (async () => {
        const drive = new Hyperdrive(store.namespace(scope))
        await drive.ready()
        drives.set(drive.key.toString('hex'), drive)
        swarm.join(drive.discoveryKey, { server: true, client: true })
        return drive
      })()
      ownedDrives.set(scope, opening)
      opening.catch(() => ownedDrives.delete(scope))
    }
    return ownedDrives.get(scope)
  }

  async function getDrive (keyhex) {
    let drive = drives.get(keyhex)
    if (!drive) {
      drive = new Hyperdrive(store, Buffer.from(keyhex, 'hex'))
      await drive.ready()
      drives.set(keyhex, drive)
      // client to fetch, server to re-seed what we hold (organic mirroring)
      swarm.join(drive.discoveryKey, { server: true, client: true })
    }
    return drive
  }

  function parseUrl (url) {
    const m = /^keets:\/\/([0-9a-fA-F]{64})(\/[^?#]*)(?:[?#]hash=([0-9a-fA-F]{64}))?$/.exec(url)
    if (!m) throw new Error('bad keets:// url')
    return { key: m[1].toLowerCase(), path: m[2], hash: m[3] ? m[3].toLowerCase() : null }
  }

  return {
    swarm,
    store,

    async publish (pathname, buf) {
      if (!pathname.startsWith('/')) pathname = '/' + pathname
      const drive = await own(pathname.startsWith('/salon/') ? 'salon' : 'media')
      await drive.put(pathname, buf)
      const hash = sha256(buf).toString('hex')
      return {
        url: 'keets://' + drive.key.toString('hex') + pathname + '?hash=' + hash,
        drive: '0x' + drive.key.toString('hex'),
        path: pathname,
        hash: '0x' + hash,
        size: buf.length
      }
    },

    async fetch (url, maxBytes) {
      const { key, path: p, hash } = parseUrl(url)
      const drive = await getDrive(key)
      const buf = await readMedia(drive, swarm, p, maxBytes)
      if (hash && sha256(buf).toString('hex') !== hash) throw new Error('hash mismatch — content does not match url')
      return buf
    },

    async list (scope) {
      const drive = await own(scope)
      const out = []
      for await (const file of drive.list('/')) {
        out.push({ path: file.key, size: file.value && file.value.blob ? file.value.blob.byteLength : 0 })
      }
      return out
    },

    async remove (pathname) {
      if (!pathname.startsWith('/')) pathname = '/' + pathname
      const drive = await own(pathname.startsWith('/salon/') ? 'salon' : 'media')
      await drive.del(pathname)
    },

    async pin (driveOrUrl) {
      const keyhex = driveOrUrl.startsWith('keets://') ? parseUrl(driveOrUrl).key : driveOrUrl.replace(/^0x/i, '').toLowerCase()
      if (!/^[0-9a-f]{64}$/.test(keyhex)) throw new Error('bad drive key')
      const drive = await getDrive(keyhex)
      drive.download('/').catch(() => {}) // mirror everything it has, keep mirroring updates
      if (!pins.includes(keyhex)) { pins.push(keyhex); savePins() }
      return { pinned: '0x' + keyhex }
    },

    async unpin (keyhex) {
      keyhex = keyhex.replace(/^0x/i, '').toLowerCase()
      pins = pins.filter(k => k !== keyhex)
      savePins()
    },

    pinsList () { return pins.map(k => '0x' + k) },

    async start () {
      const drive = await own()
      for (const k of pins) {
        getDrive(k).then(d => d.download('/').catch(() => {})).catch(() => {})
      }
      const salon = await own('salon')
      return { drive: '0x' + drive.key.toString('hex'), salondrive: '0x' + salon.key.toString('hex'), pins: pins.length }
    }
  }
}
