# keets — Minima over the Keet/Holepunch transport

Dual-transport Minima: alongside classic TCP, nodes connect over **Hyperswarm + HyperDHT**
(the Keet stack). Any node — a phone behind CGNAT included — is dialable by its Noise
public key via DHT hole punching, with relay fallback where punching fails. Phone nodes
become first-class peers on the existing mainnet; classic nodes are unaffected.

## Pieces

| piece | where |
|---|---|
| Sidecar (Node.js, hyperswarm) | `sidecar/index.js` |
| Bridge protocol spec (the Android contract) | `BRIDGE.md` |
| Java node changes | `core/minima-core` branch **`keets`** (worktree: `_worktrees/minima-core-keets`) |
| Two-node loopback test | `test/two-node.sh` |

## How it works

The Java node can't speak Noise, so a sidecar process terminates the DHT streams and
bridges each one to the node's own Minima port over loopback. One injected `MSG_KEETS`
preamble (type 24, per-boot auth token + remote pubkey) flags the connection and gives the
peer a synthetic `127.113.x.y` identity derived from its public key. After that it's the
untouched Minima protocol: greeting, IBD, txpow gossip. Keets peers are invisible to the
classic P2P walk — hyperswarm does its own discovery, reconnection and hole punching.

## Run a node

```bash
java -jar minima-keets.jar -data ~/minimadata -keets \
  -keetssidecar /path/to/keets/sidecar/index.js \
  [-keetsbootstrap host1:49737,host2:49737] \
  [-keetsconnect 0x<pubkey>,...] [-keetsmaxconns 6]
```

Needs `node` on PATH (desktop). Your dialable identity is printed at startup and written to
`<datadir>/keets/pubkey`. The default bootstrap is the owner-run 7-node fleet baked into
`GeneralParams.KEETS_BOOTSTRAP` (live since 2026-10-12 — host table in
`tools/publicIPnodes/README.md`); `-keetsbootstrap` overrides it, and an explicit empty
value falls back to hyperswarm's default (Holepunch-run) bootstrap.

## Build the jar

Gradle 6.7.1 won't run on modern JDKs; direct javac works:

```bash
cd _worktrees/minima-core-keets
javac --release 11 -nowarn -cp "lib/*" -d build/classes $(find src -name "*.java" ! -path "*/test/*")
cd build/fat && for j in ../../lib/{bcpkix,bcprov,bcutil}-jdk15on-169.jar ../../lib/h2-2.4.240.jar ../../lib/mysql-connector-java-8.0.24.jar; do unzip -oq "$j" -x "META-INF/*.SF" "META-INF/*.DSA" "META-INF/*.RSA" "META-INF/MANIFEST.MF"; done
cp -r ../classes/* . && cd .. && jar cfm minima-keets.jar manifest.txt -C fat .
```

## Test

```bash
test/two-node.sh    # private DHT bootstrap + genesis node + syncing peer, asserts bridge/greeting/IBD/no-leak
```

## v1 scope

IN: greeting, IBD, full block/txpow gossip — a keets-only node fully syncs and transacts.
OUT (still TCP-only): archive/megammr resync, ping; keets pubkey sharing via P2P; Android
(bare-kit worklet — same `BRIDGE.md` contract, sidecar JS is runtime-agnostic).
