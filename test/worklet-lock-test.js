const fs = require('../sidecar/node_modules/bare-fs')
const Corestore = require('../sidecar/node_modules/corestore')
const bundle = fs.readFileSync(Bare.argv[2])
const os = require('../sidecar/node_modules/bare-os')
const root = os.tmpdir() + '/keets-worklet-lock-' + Date.now()
fs.mkdirSync(root)
const mount = root + '/worker.bundle'
fs.mkdirSync(mount)
fs.symlinkSync(__dirname + '/../sidecar', mount + '/sidecar')
async function wait(flag, value) {
  const end = Date.now() + 10000
  while (Atomics.load(flag, 0) !== value) {
    if (Date.now() > end || Atomics.load(flag, 0) < 0) throw new Error('worker did not become ready')
    await new Promise(r => setTimeout(r, 10))
  }
}
;(async () => {
  for (const graceful of [false, true]) {
    const dir = root + (graceful ? '/graceful' : '/abrupt')
    const state = new SharedArrayBuffer(4), flag = new Int32Array(state)
    const thread = new Bare.Thread(mount, bundle, { data: { dir, state } })
    await wait(flag, 1)
    if (graceful) { Atomics.store(flag, 0, 2); await wait(flag, 3) }
    thread.terminate(); thread.join()
    const store = new Corestore(dir)
    try {
      await store.ready(); await store.get({ name: 'photo-lock-check' }).ready()
      if (!graceful) throw new Error('Expected retained lock after abrupt termination')
      console.log('PASS graceful shutdown releases storage for a replacement thread')
    } catch (e) {
      if (graceful || !/ELOCKED/.test(e.message)) throw e
      console.log('PASS reproduced ELOCKED after abrupt thread termination')
    }
    finally { await store.close() }
  }
  fs.rmSync(root, { recursive: true, force: true })
})().catch(e => { console.error(e); Bare.exitCode = 1 })
