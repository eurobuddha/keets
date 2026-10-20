// Node AND Bare: real storage and real private DHT peers. Synthetic media only.
const IS_BARE = typeof Bare !== 'undefined'
const fs = IS_BARE ? require('../sidecar/node_modules/bare-fs') : require('fs')
const path = IS_BARE ? require('../sidecar/node_modules/bare-path') : require('path')
const os = IS_BARE ? require('../sidecar/node_modules/bare-os') : require('os')
const DHT = require('../sidecar/node_modules/hyperdht')
const createMedia = require('../sidecar/media')
function check (ok, message) { if (!ok) throw new Error(message); console.log('PASS: ' + message) }
;(async () => {
  const dir = path.join(os.tmpdir(), 'keets-recovery-p2p-' + Date.now() + '-' + Math.random().toString(16).slice(2))
  fs.mkdirSync(dir, { mode: 0o700 })
  const boot = DHT.bootstrapper(Number((IS_BARE ? Bare.argv : process.argv)[2]) || 45991, '127.0.0.1')
  const peers = []
  const timer = setTimeout(() => { throw new Error('recovery fixture timed out') }, 65000)
  try {
    await boot.ready()
    const bootstrap = [{ host: '127.0.0.1', port: boot.address().port }]
    function peer (name, seed) {
      const keetsdir = path.join(dir, name); fs.mkdirSync(keetsdir, { recursive: true })
      const media = createMedia({ keetsdir, seed: Buffer.alloc(32, seed), bootstrap, maxconns: 4 })
      peers.push(media); return media
    }
    const a = peer('a', 1), b = peer('b', 2)
    const before = await a.start(); await b.start()
    const first = await a.publish('/chat/before.jpg', Buffer.alloc(100000, 17))
    check((await b.fetch(first.url)).equals(Buffer.alloc(100000, 17)), 'peer fetch before closure')
    await a.store.close()
    const after = await a.start()
    check(before.drive === after.drive && before.salondrive === after.salondrive, 'same chat and Salon identities after closure')
    const second = await a.publish('/chat/after.jpg', Buffer.alloc(100001, 18))
    check((await b.fetch(second.url)).equals(Buffer.alloc(100001, 18)), 'peer reconnects and fetches after recovery')
    check((await a.fetch(first.url)).equals(Buffer.alloc(100000, 17)), 'previous attachment retained')
    const blocked = peer('a', 3)
    let lock = false
    try { await blocked.start() } catch (error) { lock = /locked/i.test(error.message) }
    check(lock, 'real storage lock refused')
    await a.swarm.destroy(); await a.store.close()
    const recovered = await blocked.start()
    check(recovered.drive === before.drive && recovered.salondrive === before.salondrive, 'startup-lock recovery preserves identities')
    const salon = await blocked.publish('/salon/test/profile.json', Buffer.from('{"name":"recovered"}'))
    check((await b.fetch(salon.url)).equals(Buffer.from('{"name":"recovered"}')), 'Salon peer fetch after startup-lock recovery')
  } finally {
    clearTimeout(timer)
    for (const p of peers) { await p.swarm.destroy(); if (p.store) await p.store.close().catch(() => {}) }
    await boot.destroy()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); if (IS_BARE) Bare.exit(1); else process.exitCode = 1 })
