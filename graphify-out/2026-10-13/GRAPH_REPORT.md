# Graph Report - keets  (2026-10-13)

## Corpus Check
- 13 files · ~8,789 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 161 nodes · 184 edges · 14 communities (12 shown, 2 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 10 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `96a12fdd`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- index.js
- package.json
- mailbox.js
- bootstrap.js
- two-node.sh
- keets bridge protocol — MSG_KEETS preamble
- dependencies
- media.js
- messages.js
- wire.js
- keets — Minima over the Keet/Holepunch transport
- keets services — media hosting + messages (sidecar 1.2.0)
- services-test.sh
- api.js

## God Nodes (most connected - your core abstractions)
1. `keets — Minima over the Keet/Holepunch transport` - 8 edges
2. `keets services — media hosting + messages (sidecar 1.2.0)` - 7 edges
3. `keets bridge protocol — MSG_KEETS preamble` - 7 edges
4. `fetchMail()` - 6 edges
5. `own()` - 5 edges
6. `getDrive()` - 4 edges
7. `fetch()` - 4 edges
8. `hex()` - 4 edges
9. `dialService()` - 4 edges
10. `sendDirect()` - 4 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (14 total, 2 thin omitted)

### Community 0 - "index.js"
Cohesion: 0.08
Nodes (26): APIPORT, BOOTSTRAP, bridge(), CONNECT, DATADIR, DEFAULT_MAILBOXES, DHT, done() (+18 more)

### Community 1 - "package.json"
Cohesion: 0.29
Nodes (6): description, license, main, name, type, version

### Community 2 - "mailbox.js"
Cohesion: 0.13
Nodes (15): BOOTSTRAP, DATADIR, DHT, dhtOpts, dirSize(), fs, keyPair, maildir (+7 more)

### Community 3 - "bootstrap.js"
Cohesion: 0.50
Nodes (3): DHT, node, port

### Community 5 - "keets bridge protocol — MSG_KEETS preamble"
Cohesion: 0.25
Nodes (7): Bootstrap, Flow, Java-side acceptance rules (all must hold, else disconnect), keets bridge protocol — MSG_KEETS preamble, MSG_KEETS frame (74 bytes total), Sidecar files (under `<datadir>/keets/`), Topics

### Community 6 - "dependencies"
Cohesion: 0.10
Nodes (21): bare-fs, bare-http1, bare-path, bare-process, bare-tcp, corestore, hyperdht, hyperdrive (+13 more)

### Community 7 - "media.js"
Cohesion: 0.18
Nodes (15): Corestore, DHT, fetch(), getDrive(), Hyperdrive, Hyperswarm, list(), own() (+7 more)

### Community 8 - "messages.js"
Cohesion: 0.31
Nodes (10): dialService(), fetchMail(), handleConn(), hex(), saveInbox(), send(), sendDirect(), sendViaMailbox() (+2 more)

### Community 10 - "keets — Minima over the Keet/Holepunch transport"
Cohesion: 0.22
Nodes (8): Build the jar, How it works, keets — Minima over the Keet/Holepunch transport, Pieces, Run a node, Services (sidecar 1.2.0): host media + message by pubkey — no server, Test, v1 scope

### Community 11 - "keets services — media hosting + messages (sidecar 1.2.0)"
Cohesion: 0.25
Nodes (7): Decentralization model, keets services — media hosting + messages (sidecar 1.2.0), Loopback HTTP API, Mailbox fleet, Media internals, Tests, Wire protocol (KTS1)

### Community 12 - "services-test.sh"
Cohesion: 0.47
Nodes (3): api(), check(), services-test.sh script

### Community 13 - "api.js"
Cohesion: 0.67
Nodes (3): handle(), send(), TYPES

## Knowledge Gaps
- **81 isolated node(s):** `Pieces`, `How it works`, `Services (sidecar 1.2.0): host media + message by pubkey — no server`, `Run a node`, `Build the jar` (+76 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **What connects `Pieces`, `How it works`, `Services (sidecar 1.2.0): host media + message by pubkey — no server` to the rest of the system?**
  _81 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `index.js` be split into smaller, more focused modules?**
  _Cohesion score 0.07635467980295567 - nodes in this community are weakly interconnected._
- **Should `mailbox.js` be split into smaller, more focused modules?**
  _Cohesion score 0.13071895424836602 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._