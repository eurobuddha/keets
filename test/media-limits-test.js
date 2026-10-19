const test = require('node:test')
const assert = require('node:assert/strict')
const { readMedia, MAX_MEDIA_BYTES } = require('../sidecar/media-read')
function fixture (size = 4) {
  const entry = { value: { blob: { byteLength: size } } }
  let gets = 0; let cancelled = 0; let updates = 0
  const drive = {
    findingPeers: () => () => {}, update: async () => { updates++ },
    entry: async () => entry,
    get: async value => { gets++; assert.equal(value, entry); return Buffer.alloc(size) },
    core: { replicator: { clearRequests: () => { cancelled++ } } }
  }
  return { drive, swarm: { flush: async () => {} }, counts: () => ({ gets, cancelled, updates }) }
}
test('reads exact checked entry and updates the mutable drive before each read', async () => {
  const f = fixture()
  assert.equal((await readMedia(f.drive, f.swarm, '/profile.json', 4)).length, 4)
  await readMedia(f.drive, f.swarm, '/profile.json', 4)
  assert.deepEqual(f.counts(), { gets: 2, cancelled: 2, updates: 2 })
})
test('oversized entry is refused before loading its blob', async () => {
  const f = fixture(25 * 1024 * 1024)
  await assert.rejects(readMedia(f.drive, f.swarm, '/video.mp4', 24 * 1024 * 1024), /size limit/)
  assert.equal(f.counts().gets, 0)
})
test('invalid limits cannot disable the maximum', async () => {
  for (const cap of [0, -1, NaN, Infinity, MAX_MEDIA_BYTES + 1, 1.5]) {
    const f = fixture()
    await assert.rejects(readMedia(f.drive, f.swarm, '/file', cap), /invalid/)
    assert.equal(f.counts().gets, 0)
  }
})
test('unreachable update has a real deadline and cancels only its request references', async () => {
  const f = fixture(); let scope
  f.drive.update = opts => { scope = opts.activeRequests; return new Promise(() => {}) }
  f.drive.core.replicator.clearRequests = refs => assert.equal(refs, scope)
  const start = Date.now()
  await assert.rejects(readMedia(f.drive, f.swarm, '/offline', 4, 30), /in time/)
  assert.ok(Date.now() - start < 1000)
  assert.equal(f.counts().gets, 0)
})
test('late metadata after a timeout cannot start a blob allocation', async () => {
  const f = fixture(); let finish
  f.drive.entry = () => new Promise(resolve => { finish = resolve })
  await assert.rejects(readMedia(f.drive, f.swarm, '/late', 4, 30), /in time/)
  finish({ value: { blob: { byteLength: 4 } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.counts().gets, 0)
})
test('incomplete content is not accepted', async () => {
  const f = fixture(); f.drive.get = async () => Buffer.alloc(3)
  await assert.rejects(readMedia(f.drive, f.swarm, '/file', 4), /incomplete/)
})
