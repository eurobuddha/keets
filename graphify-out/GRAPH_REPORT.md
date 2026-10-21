# Graph Report - keets  (2026-10-21)

## Corpus Check
- 18 files · ~12,171 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 199 nodes · 234 edges · 15 communities (13 shown, 2 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f361084e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- index.js
- media-recovery-test.js
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
- media-recovery-p2p.js

## God Nodes (most connected - your core abstractions)
1. `keets — Minima over the Keet/Holepunch transport` - 8 edges
2. `keets services — media hosting + messages (sidecar 1.2.0)` - 8 edges
3. `own()` - 7 edges
4. `keets bridge protocol — MSG_KEETS preamble` - 7 edges
5. `getDrive()` - 6 edges
6. `fetchMail()` - 6 edges
7. `Swarm` - 6 edges
8. `readyStore()` - 5 edges
9. `fetch()` - 5 edges
10. `readMedia()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `fetch()` --calls--> `readMedia()`  [EXTRACTED]
  sidecar/media.js → sidecar/media-read.js

## Import Cycles
- None detected.

## Communities (15 total, 2 thin omitted)

### Community 0 - "index.js"
Cohesion: 0.08
Nodes (26): APIPORT, BOOTSTRAP, bridge(), CONNECT, DATADIR, DEFAULT_MAILBOXES, DHT, done() (+18 more)

### Community 1 - "media-recovery-test.js"
Cohesion: 0.12
Nodes (12): assert, DHT, factory(), fixture(), fs, Module, os, path (+4 more)

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
Cohesion: 0.07
Nodes (27): bare-fs, bare-http1, bare-path, bare-process, bare-tcp, corestore, hyperdht, hyperdrive (+19 more)

### Community 7 - "media.js"
Cohesion: 0.11
Nodes (23): Corestore, DHT, fetch(), getDrive(), Hyperdrive, Hyperswarm, list(), openDrive() (+15 more)

### Community 8 - "messages.js"
Cohesion: 0.31
Nodes (10): dialService(), fetchMail(), handleConn(), hex(), saveInbox(), send(), sendDirect(), sendViaMailbox() (+2 more)

### Community 10 - "keets — Minima over the Keet/Holepunch transport"
Cohesion: 0.22
Nodes (8): Build the jar, How it works, keets — Minima over the Keet/Holepunch transport, Pieces, Run a node, Services (sidecar 1.2.0): host media + message by pubkey — no server, Test, v1 scope

### Community 11 - "keets services — media hosting + messages (sidecar 1.2.0)"
Cohesion: 0.20
Nodes (9): Decentralization model, keets services — media hosting + messages (sidecar 1.2.0), Loopback HTTP API, Mailbox fleet, Media internals, Node bridge: the `keets` command + `KEETS` MDS event, Salon public hosting (sidecar 1.2.1), Tests (+1 more)

### Community 12 - "services-test.sh"
Cohesion: 0.47
Nodes (3): api(), check(), services-test.sh script

### Community 13 - "api.js"
Cohesion: 0.67
Nodes (3): handle(), send(), TYPES

### Community 14 - "media-recovery-p2p.js"
Cohesion: 0.50
Nodes (3): createMedia, DHT, peer()

## Knowledge Gaps
- **94 isolated node(s):** `TYPES`, `Hyperswarm`, `DHT`, `sodium`, `PORT` (+89 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `TYPES`, `Hyperswarm`, `DHT` to the rest of the system?**
  _94 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `index.js` be split into smaller, more focused modules?**
  _Cohesion score 0.07635467980295567 - nodes in this community are weakly interconnected._
- **Should `media-recovery-test.js` be split into smaller, more focused modules?**
  _Cohesion score 0.12280701754385964 - nodes in this community are weakly interconnected._
- **Should `mailbox.js` be split into smaller, more focused modules?**
  _Cohesion score 0.13071895424836602 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.07142857142857142 - nodes in this community are weakly interconnected._
- **Should `media.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11264367816091954 - nodes in this community are weakly interconnected._