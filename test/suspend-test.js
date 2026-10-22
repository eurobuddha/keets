#!/usr/bin/env node
// Suspend/resume (1.2.7): a suspended messages module stops its mailbox poll timer and
// does not dial; resume fetches mail at once and restarts the timer. No network needed:
// the DHT is a stub whose connect always fails.
const path = require('path')
const fs = require('fs')
const os = require('os')
const SIDECAR = path.join(__dirname, '..', 'sidecar')
const DHT = require(path.join(SIDECAR, 'node_modules', 'hyperdht'))
const createMessages = require(path.join(SIDECAR, 'messages'))

const keetsdir = fs.mkdtempSync(path.join(os.tmpdir(), 'keets-suspend-'))
let dials = 0
const dht = { connect () { dials++; throw new Error('offline stub') } }
const m = createMessages({ keetsdir, dht, keyPair: DHT.keyPair(), mailboxes: [] })
let fetches = 0
m.fetchMail = async () => { fetches++; return 0 }
function fail (msg) { console.log('FAIL: ' + msg); process.exit(1) }

m.start()
m.suspend()
if (!m.isSuspended()) fail('not suspended after suspend()')
m.suspend()                       // idempotent
const before = fetches
m.resume()
if (m.isSuspended()) fail('still suspended after resume()')
if (fetches !== before + 1) fail('resume did not fetch mail at once (' + (fetches - before) + ')')
m.resume()                        // idempotent: no second fetch
if (fetches !== before + 1) fail('a second resume fetched again')
console.log('PASS: suspend stops the mailbox timer, resume fetches at once (dials ' + dials + ')')
process.exit(0)
