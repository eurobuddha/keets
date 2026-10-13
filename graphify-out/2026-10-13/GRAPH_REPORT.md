# Graph Report - keets  (2026-10-13)

## Corpus Check
- 6 files · ~2,560 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 59 nodes · 55 edges · 12 communities (5 shown, 7 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `694ac5ca`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- index.js
- package.json
- hyperdht
- bootstrap.js
- two-node.sh
- keets bridge protocol — MSG_KEETS preamble
- dependencies
- bare-fs
- bare-path
- bare-process
- hyperswarm
- sodium-universal

## God Nodes (most connected - your core abstractions)
1. `keets bridge protocol — MSG_KEETS preamble` - 7 edges
2. `bare-fs` - 2 edges
3. `bare-path` - 2 edges
4. `bare-process` - 2 edges
5. `bare-tcp` - 2 edges
6. `hyperdht` - 2 edges
7. `hyperswarm` - 2 edges
8. `sodium-universal` - 2 edges
9. `two-node.sh script` - 2 edges
10. `rpc()` - 2 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (12 total, 7 thin omitted)

### Community 0 - "index.js"
Cohesion: 0.10
Nodes (17): BOOTSTRAP, CONNECT, DATADIR, DHT, hb, Hyperswarm, keetsdir, keyPair (+9 more)

### Community 1 - "package.json"
Cohesion: 0.29
Nodes (6): description, license, main, name, type, version

### Community 3 - "bootstrap.js"
Cohesion: 0.50
Nodes (3): DHT, node, port

### Community 5 - "keets bridge protocol — MSG_KEETS preamble"
Cohesion: 0.25
Nodes (7): Bootstrap, Flow, Java-side acceptance rules (all must hold, else disconnect), keets bridge protocol — MSG_KEETS preamble, MSG_KEETS frame (74 bytes total), Sidecar files (under `<datadir>/keets/`), Topics

### Community 6 - "dependencies"
Cohesion: 0.67
Nodes (3): bare-tcp, dependencies, bare-tcp

## Knowledge Gaps
- **39 isolated node(s):** `Hyperswarm`, `DHT`, `sodium`, `PORT`, `DATADIR` (+34 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `package.json`, `hyperdht`, `bare-fs`, `bare-path`, `bare-process`, `hyperswarm`, `sodium-universal`?**
  _High betweenness centrality (0.110) - this node is a cross-community bridge._
- **Why does `bare-fs` connect `bare-fs` to `dependencies`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `Hyperswarm`, `DHT`, `sodium` to the rest of the system?**
  _39 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `index.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._