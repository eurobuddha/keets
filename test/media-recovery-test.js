// Real pinned Corestore/Hyperdrive and disposable files. The swarm is replaced
// only to keep the fixture off the public network; storage locking is real.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const sourcePath = path.resolve(__dirname, '../sidecar/media.js')
class Swarm {
  constructor () { this.connections = new Set(); this.topics = new Set() }
  on () {}
  join (topic) { this.topics.add(topic.toString('hex')) }
  leave (topic) { this.topics.delete(topic.toString('hex')); return Promise.resolve() }
  flush () { return Promise.resolve() }
  destroy () { this.connections.clear(); return Promise.resolve() }
}
class DHT { static keyPair () { return {} } }
function factory () {
  const module = new Module(sourcePath)
  module.filename = sourcePath
  module.paths = Module._nodeModulePaths(path.dirname(sourcePath))
  module.require = function (name) {
    if (name === 'hyperswarm') return Swarm
    if (name === 'hyperdht') return DHT
    return Module.prototype.require.call(this, name)
  }
  module._compile(fs.readFileSync(process.env.KEETS_MEDIA_SOURCE || sourcePath, 'utf8'), sourcePath)
  return module.exports
}
function fixture (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keets-recovery-'))
  const instances = []
  const create = factory()
  t.after(async () => {
    for (const media of instances) if (media.store) await media.store.close().catch(() => {})
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return () => {
    const media = create({ keetsdir: dir, seed: Buffer.alloc(32, 1), maxconns: 1 })
    instances.push(media)
    return media
  }
}
test('released startup lock recovers existing chat and Salon identities and content', async t => {
  const create = fixture(t)
  const owner = create()
  const before = await owner.start()
  const bytes = Buffer.from('previous chat attachment')
  const old = await owner.publish('/chat/previous.jpg', bytes)
  const blocked = create()
  await assert.rejects(blocked.start(), /locked/i)
  await owner.store.close()
  const next = await blocked.publish('/chat/next.jpg', Buffer.from('next attachment'))
  const after = await blocked.start()
  assert.equal(after.drive, before.drive)
  assert.equal(after.salondrive, before.salondrive)
  assert.equal(next.drive, old.drive)
  assert.deepEqual(await blocked.fetch(old.url), bytes)
})
test('concurrent recovery callers share storage and keep public and attachment drives separate', async t => {
  const create = fixture(t)
  const owner = create()
  const before = await owner.start()
  const blocked = create()
  await assert.rejects(blocked.start(), /locked/i)
  await owner.store.close()
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
    blocked.publish((i % 2 ? '/salon/test/' : '/chat/') + i + '.jpg', Buffer.from('file-' + i))))
  for (let i = 0; i < results.length; i++) {
    assert.equal(results[i].drive, i % 2 ? before.salondrive : before.drive)
    assert.deepEqual(await blocked.fetch(results[i].url), Buffer.from('file-' + i))
  }
  assert.notEqual(before.drive, before.salondrive)
})
test('a persistent lock is reported without deleting or replacing stored identities', async t => {
  const create = fixture(t)
  const owner = create()
  const before = await owner.start()
  const blocked = create()
  for (let i = 0; i < 3; i++) await assert.rejects(blocked.start(), /locked/i)
  assert.deepEqual(await owner.start(), before)
  await owner.store.close()
  assert.deepEqual(await blocked.start(), before)
})
test('a closed store clears stale drive handles and reopens without losing existing files', async t => {
  const media = fixture(t)()
  const before = await media.start()
  const data = Buffer.from('retained bytes')
  const saved = await media.publish('/salon/test/profile.json', data)
  await media.store.close()
  const after = await media.start()
  assert.deepEqual(after, before)
  assert.deepEqual(await media.fetch(saved.url), data)
  await media.publish('/chat/after.jpg', Buffer.from('new bytes'))
})

test('chat-triggered recovery restores Salon and previously mirrored drive subscriptions', async t => {
  const create = fixture(t)
  const media = create()
  await media.start()
  const other = fixture(t)()
  const remote = await other.start()
  await media.pin(remote.drive)
  const topics = new Set(media.swarm.topics)
  assert.equal(topics.size, 3)
  await media.store.close()
  await media.publish('/chat/recovered.jpg', Buffer.from('new bytes'))
  assert.deepEqual(media.swarm.topics, topics)
  assert.deepEqual(media.pinsList(), [remote.drive])
})

// Keep /info's independent identity response while exercising the real upload API.
test('/info remains available during storage failure and uploads recover after the lock clears', async t => {
  const http = require('node:http')
  const { once } = require('node:events')
  const create = fixture(t)
  const owner = create()
  const before = await owner.start()
  const old = await owner.publish('/chat/old.jpg', Buffer.from('retained attachment'))
  const blocked = create()
  await assert.rejects(blocked.start(), /locked/i)
  const token = 'a'.repeat(64), mypub = 'b'.repeat(64)
  const server = require('../sidecar/api')({ port: 0, token, mypub, media: blocked, messages: {}, version: '1.2.3' })
  t.after(() => new Promise(resolve => server.close(resolve)))
  await once(server, 'listening')
  function request (method, path, body, authenticated = true) {
    return new Promise((resolve, reject) => {
      const headers = authenticated ? { 'x-keets-token': token } : {}
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port, method, path, headers, agent: false }, res => {
        const chunks = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('error', reject)
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
      })
      req.on('error', reject)
      req.setTimeout(10000, () => req.destroy(new Error('local API test timeout')))
      req.end(body)
    })
  }
  assert.equal((await request('GET', '/info', undefined, false)).status, 401)
  const unavailable = await request('GET', '/info')
  assert.equal(unavailable.status, 200)
  const info = JSON.parse(unavailable.body)
  assert.equal(info.pubkey, '0x' + mypub)
  assert.equal(info.version, '1.2.3')
  assert.equal(info.drive, null)
  assert.equal(info.salondrive, null)
  const failed = await request('POST', '/media/chat/new.jpg', 'new attachment')
  assert.equal(failed.status, 500)
  assert.match(JSON.parse(failed.body).error, /locked/i)
  await owner.store.close()
  const upload = await request('POST', '/media/chat/new.jpg', 'new attachment')
  assert.equal(upload.status, 200)
  assert.equal(JSON.parse(upload.body).drive, before.drive)
  const recovered = await request('GET', '/info')
  assert.equal(recovered.status, 200)
  assert.equal(JSON.parse(recovered.body).drive, before.drive)
  assert.equal(JSON.parse(recovered.body).salondrive, before.salondrive)
  const retained = await request('GET', '/media?url=' + encodeURIComponent(old.url))
  assert.equal(retained.status, 200)
  assert.equal(retained.body, 'retained attachment')
})

test('acknowledged worklet shutdown releases chat and private stores for same-process restart', async t => {
  const create = fixture(t), first = create()
  const before = await first.start()
  const photo = await first.publish('/chat/restart.jpg', Buffer.from('photo retained'))
  const id = 'a'.repeat(32)
  const file = await first.publish('/private/' + id + '/manifest', Buffer.from('file retained'))
  const EventEmitter = require('node:events')
  const kit = new EventEmitter()
  require('../sidecar/worklet-lifecycle')(kit, first)
  const reply = () => new Promise((resolve, reject) => kit.emit('push', Buffer.from('close-media-v1'),
    (error, value) => error ? reject(error) : resolve(value)))
  assert.deepEqual(await Promise.all([reply(), reply()]), ['media-closed-v1', 'media-closed-v1'])
  await assert.rejects(first.publish('/chat/late.jpg', Buffer.from('late')), /shutting down/)
  await assert.rejects(first.start(), /shutting down/)
  const next = create()
  t.after(() => next.close())
  assert.deepEqual(await next.start(), before)
  assert.deepEqual(await next.fetch(photo.url), Buffer.from('photo retained'))
  assert.deepEqual(await next.fetch(file.url), Buffer.from('file retained'))
  await next.publish('/chat/new.jpg', Buffer.from('new photo'))
})

test('worklet shutdown does not acknowledge a failed store close or unknown command', async () => {
  const EventEmitter = require('node:events'), kit = new EventEmitter()
  let calls = 0
  require('../sidecar/worklet-lifecycle')(kit, { async close () { calls++; throw new Error('close failed') } })
  const send = command => new Promise((resolve, reject) => kit.emit('push', Buffer.from(command),
    (error, value) => error ? reject(error) : resolve(value)))
  await assert.rejects(send('wrong'), /Unknown worklet control/)
  assert.equal(calls, 0)
  await assert.rejects(send('close-media-v1'), /close failed/)
})

test('shutdown racing an opening transfer leaves no storage lock behind', async t => {
  const create = fixture(t), first = create()
  await first.start()
  const opening = first.publish('/private/' + 'b'.repeat(32) + '/manifest', Buffer.from('racing file'))
  // Observe the result immediately, including rejection when close wins.
  const settled = Promise.allSettled([opening])
  await Promise.resolve()
  await first.close()
  await settled
  const next = create()
  t.after(() => next.close())
  await next.start()
  await next.publish('/private/' + 'b'.repeat(32) + '/manifest', Buffer.from('retried file'))
})
