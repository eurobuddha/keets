#!/usr/bin/env node
// Local HyperDHT bootstrap node for the two-node test.
const DHT = require('../sidecar/node_modules/hyperdht')
const port = parseInt(process.argv[2] || '40000')
const node = DHT.bootstrapper(port, '127.0.0.1')
node.ready().then(() => console.log('bootstrap up on 127.0.0.1:' + port))
