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
