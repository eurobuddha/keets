# keets bridge protocol — MSG_KEETS preamble

This is the contract between the sidecar (any runtime: Node on desktop, bare-kit worklet on
Android) and the keets-patched Minima node. Java side: `NIOMessage.java` (`MSG_KEETS`,
type 24) on the `keets` branch of `core/minima-core`.

## Flow

1. Minima node starts with `-keets`. Once its NIO server is listening, `KeetsManager`
   spawns the sidecar with args `--port --datadir --topic --maxconns [--bootstrap]
   [--connect]` and env `KEETS_TOKEN` (32-byte hex, random per node boot — never crosses
   the DHT, never on argv).
2. The sidecar joins the Hyperswarm topic `sha256(topicString)` with
   `{server: true, client: true}` and optionally `joinPeer()`s each `--connect` pubkey.
3. For EVERY established hyperswarm connection — dialed or accepted — the sidecar opens a
   plain TCP connection to `127.0.0.1:<port>` (the node's own Minima port), writes exactly
   one MSG_KEETS frame, then pipes bytes both ways. It never parses Minima frames.
4. The Java node, on receiving MSG_KEETS as a client's first message from 127.0.0.1 with
   the correct token, flags the client as keets, assigns it a synthetic identity
   `127.113.<pk[1]>.<pk[2]>:<9001+pk[3]>` derived from the remote Noise public key, and —
   if `initiator` — sends the Minima Greeting. Greeting → IBD → gossip then run unchanged.
   Keets clients are invisible to the P2P system (no P2P_CONNECTED/DISCONNECTED/MSG_P2P).
5. The sidecar exits when its stdin closes (parent node died). The node respawns the
   sidecar with backoff if it exits.

## MSG_KEETS frame (74 bytes total)

All integers big-endian. Outer framing is Minima's standard 4-byte length prefix.

| bytes | content |
|---|---|
| 4 | frame length = 74 (payload length) |
| 1 | message type = `24` (MiniByte MSG_KEETS) |
| 4 | MiniData length = `32` |
| 32 | auth token (from `KEETS_TOKEN` env, hex-decoded) |
| 4 | MiniData length = `32` |
| 32 | remote peer's Noise public key |
| 1 | initiator: `1` if this side dialed the hyperswarm connection, else `0` |

## Java-side acceptance rules (all must hold, else disconnect)

- client socket host is exactly `127.0.0.1`
- token equals this boot's `KEETS_TOKEN`
- client is not already flagged keets
- no Greeting received yet on this connection
- pubkey is exactly 32 bytes

## Sidecar files (under `<datadir>/keets/`)

- `keypair` — 32-byte seed (mode 0600). This seed IS the node's network identity; back it
  up like a key. Public key = `DHT.keyPair(seed).publicKey`.
- `pubkey` — the derived public key as `0x`-prefixed hex, one line, for scripts/humans.
  Give this string to other nodes' `-keetsconnect` to let them dial you by key.

## Topics

- mainnet: `minima-mainnet-keets-v1`
- testnet (`-test`): `minima-testnet-keets-v1`

## Bootstrap

`--bootstrap host:port,host:port,...` — our own HyperDHT bootstrap fleet (see
`tools/publicIPnodes`). Empty = hyperswarm's default (Holepunch-run) bootstrap — fine for
dev, not the production default once the fleet is live.
