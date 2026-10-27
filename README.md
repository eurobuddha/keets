# keets — Minima over the Keet/Holepunch transport

Dual-transport Minima: alongside classic TCP, nodes connect over **Hyperswarm + HyperDHT**
(the Keet stack). Any node — a phone behind CGNAT included — is dialable by its Noise
public key via DHT hole punching, with relay fallback where punching fails. Phone nodes
become first-class peers on the existing mainnet; classic nodes are unaffected.

## Pieces

| piece | where |
|---|---|
| Sidecar (Node.js + bare, hyperswarm) | `sidecar/index.js` |
| Bridge protocol spec (the Android contract) | `BRIDGE.md` |
| Services: media hosting + messages (spec + API) | `SERVICES.md` |
| Media (Hyperdrive host/fetch/pin) | `sidecar/media.js` |
| Messages (direct + mailbox store-and-forward) | `sidecar/messages.js`, `sidecar/wire.js` |
| App loopback API (port+5, token-authed) | `sidecar/api.js` |
| Mailbox (standalone fleet daemon, or embedded via `index.js --serve`) | `sidecar/mailbox.js` |
| Signed mailbox list maintainer (keygen / re-sign / verify) | `tools/mailboxes-sign.js` |
| Serve-mode test (bootstrap + mailbox in one sidecar) | `test/serve-test.js` |
| Java node changes | `core/minima-core` branch **`keets`** (worktree: `_worktrees/minima-core-keets`) |
| Two-node loopback test | `test/two-node.sh` |
| Services test (media + messages + mailbox) | `test/services-test.sh` |

## How it works

The Java node can't speak Noise, so a sidecar process terminates the DHT streams and
bridges each one to the node's own Minima port over loopback. One injected `MSG_KEETS`
preamble (type 24, per-boot auth token + remote pubkey) flags the connection and gives the
peer a synthetic `127.113.x.y` identity derived from its public key. After that it's the
untouched Minima protocol: greeting, IBD, txpow gossip. Keets peers are invisible to the
classic P2P walk — hyperswarm does its own discovery, reconnection and hole punching.

## Services (sidecar 1.2.0): host media + message by pubkey — no server

On top of the same transport the sidecar provides two app-facing services via a loopback
HTTP API on `127.0.0.1:<minima port + 5>` (token-authed, CORS-open — a MiniDapp or APK
calls it directly): **media hosting** — `POST /media/<path>` returns a hash-pinned
`keets://` URL served P2P from the device over Hyperdrive, with every fetcher re-seeding
and optional permanent pins — and **messages** — `POST /message` delivers E2E-encrypted
to a keets pubkey directly when online, else sealed into fleet-run mailbox nodes the
recipient drains on its next start. Full spec and API table: `SERVICES.md`. Verified live
on the mainnet DHT 2026-10-13.

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
