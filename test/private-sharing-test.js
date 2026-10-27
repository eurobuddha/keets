// Reuses the real local-DHT media fixture; no public peers or wallet state.
const IS_BARE = typeof Bare !== 'undefined'
const fs = IS_BARE ? require('../sidecar/node_modules/bare-fs') : require('fs')
const path = IS_BARE ? require('../sidecar/node_modules/bare-path') : require('path')
const os = IS_BARE ? require('../sidecar/node_modules/bare-os') : require('os')
const assert = {
 deepEqual(a,b) { if (!a.equals(b)) throw Error('File bytes differ') },
 async rejects(promise, pattern) { try { await promise } catch(e) { if (pattern.test(e.message)) return; throw e } throw Error('Expected rejection: '+pattern) }
}
const DHT = require('../sidecar/node_modules/hyperdht')
const createMedia = require('../sidecar/media')
;(async () => {
 const dir = path.join(os.tmpdir(), 'keets-private-'+Date.now()+'-'+Math.random().toString(16).slice(2));fs.mkdirSync(dir,{mode:0o700})
 const boot = DHT.bootstrapper(45993, '127.0.0.1'); await boot.ready()
 const peers = []
 const timer = setTimeout(() => { throw Error('private sharing fixture timed out') }, 95000)
 function peer(name,seed) { const media = createMedia({keetsdir:path.join(dir,name), seed:Buffer.alloc(32,seed),bootstrap:[{host:'127.0.0.1',port:boot.address().port}],maxconns:6}); peers.push(media); return media }
 try {
  const a=peer('a',1), b=peer('b',2), c=peer('c',3)
  await a.start(); await b.start(); await c.start()
  const id='a'.repeat(32), other='b'.repeat(32)
  const first=await a.publish('/private/'+id+'/manifest',Buffer.from('manifest'))
  const data=await a.publish('/private/'+id+'/0',Buffer.alloc(112*1024,17))
  const another=await a.publish('/private/'+other+'/manifest',Buffer.from('another file'))
  const photo=await a.publish('/chat/keep.jpg',Buffer.from('photo'))
  assert.deepEqual(await b.fetch(data.url),Buffer.alloc(112*1024,17)); console.log('PASS private P2P fetch')
  await a.privateSharing(first.url,false)
  await assert.rejects(a.fetch(data.url),/sharing stopped/)
  assert.deepEqual(await c.fetch(another.url),Buffer.from('another file'))
  assert.deepEqual(await c.fetch(photo.url),Buffer.from('photo'));console.log('PASS stop leaves unrelated transfers and photos usable')
  // Only b has replicated the original; stop its seeding too. A fresh peer cannot fetch it.
  await b.privateSharing(first.url,false)
  await assert.rejects(c.fetch(data.url),/unavailable|closed|cancel/i);console.log('PASS fresh peer cannot fetch stopped historical bytes')
  await a.close()
  const restarted=peer('a',1);await restarted.start()
  await assert.rejects(restarted.fetch(data.url),/sharing stopped/);console.log('PASS stop persists over restart')
  await restarted.privateSharing(first.url,true)
  assert.deepEqual(await c.fetch(data.url),Buffer.alloc(112*1024,17));console.log('PASS Share again restores identical file')
  await assert.rejects(restarted.forgetPrivate(first.url),/Stop sharing/)
  const legacy='keets://'+'f'.repeat(64)+'/private/'+'e'.repeat(32)+'/manifest?hash='+'0'.repeat(64)
  if((await restarted.privateSharing(legacy,false)).sharing!==false) throw Error('stopping an unknown transfer must already be stopped')
  await assert.rejects(restarted.privateSharing(legacy,true),/Legacy shared drive/);console.log('PASS stop of a pre-1.2.12 transfer is idempotent; re-share still refused')
  await restarted.privateSharing(first.url,false);await restarted.forgetPrivate(first.url)
  if (JSON.parse(fs.readFileSync(path.join(dir,'a','private-transfers.json'),'utf8'))['o-'+id]) throw Error('Removed transfer retained its storage slot')
  if (fs.existsSync(path.join(dir,'a','private-stores','o-'+id))) throw Error('Removed transfer retained its cache')
  console.log('PASS explicit removal frees bounded storage; active removal refused')
 } finally {clearTimeout(timer);for(const p of peers){await p.close()}await boot.destroy();fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);if(IS_BARE)Bare.exit(1);else process.exitCode=1})
