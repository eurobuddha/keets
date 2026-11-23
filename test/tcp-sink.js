#!/usr/bin/env node
// Stand-in for a Minima node's port in sidecar-only tests: accepts and holds every bridged
// link (so the swarm does not redial in a loop) and logs one "conn" line per connection.
const port = parseInt(process.argv[2])
require('net').createServer((s) => { console.log('conn'); s.on('error', () => {}); s.resume() })
  .listen(port, '127.0.0.1', () => console.log('sink up on ' + port))
