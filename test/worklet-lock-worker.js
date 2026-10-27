const Corestore = require('../sidecar/node_modules/corestore')
const { dir, state } = Bare.Thread.self.data
const flag = new Int32Array(state)
;(async () => {
  const store = new Corestore(dir)
  await store.ready()
  const core = store.get({ name: 'photo-lock-check' })
  await core.ready()
  await core.append(Buffer.from('synthetic photo bytes'))
  Atomics.store(flag, 0, 1)
  const timer = setInterval(async () => {
    if (Atomics.load(flag, 0) !== 2) return
    clearInterval(timer)
    await store.close()
    Atomics.store(flag, 0, 3)
  }, 10)
})().catch(e => { console.error(e); Atomics.store(flag, 0, -1) })
