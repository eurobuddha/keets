# keets services — media hosting + messages (sidecar 1.2.0)

Two services on top of the keets transport, entirely inside the sidecar — **no Java,
protocol or consensus changes**. Built for apps like Atellier and the Salon where users
should never have to configure (or understand) a server: the phone IS the host.

- **Media** (`keets://` URLs): host files from the device over Hyperdrive; any peer that
  fetches re-seeds while running; pinning mirrors permanently. Content is hash-addressed.
- **Messages**: one-shot, E2E-encrypted messages addressed to a node's keets pubkey — the
  Maxima alternative. Online peers get them directly; offline peers get them from mailbox
  nodes (store-and-forward of *sealed* blobs the mailbox cannot read).

Everything an app needs is one loopback HTTP API (below). Verified live on the mainnet
DHT 2026-10-13: media fetch in 112ms; offline message stored at a fleet mailbox and
delivered on the recipient's next start.

## Decentralization model

- Media replication and message delivery are peer-to-peer Noise streams found via the
  HyperDHT (same hybrid fleet + Holepunch global bootstrap as the bridge).
- Mailboxes are **untrusted commodity storage**: messages are sealed
  (`crypto_box_seal`) to the recipient's key and signed by the sender — a mailbox can
  neither read, alter, nor forge them, only delay/drop (so senders try several, and
  anyone can run `mailbox.js`). Recipient proves ownership with a nonce signature.
- Media mirrors cannot alter content: every block is verified against the drive's
  signed merkle tree, and the `?hash=` fragment pins the exact bytes end-to-end.

## Loopback HTTP API

`127.0.0.1:<minima port + 5>` (`--apiport` overrides). Every request needs header
`x-keets-token: <KEETS_TOKEN>` — the per-boot token the node/host app already holds,
also written to `<datadir>/keets/apitoken` (0600). CORS is open (the token is the gate),
so MiniDapp webviews can call it directly.

| endpoint | does |
|---|---|
| `GET /info` | `{pubkey, drive, apiport, version}` |
| `POST /media/<path>` (raw bytes) | host a file → `{url, drive, path, hash, size}` |
| `GET /media?url=keets://...` | fetch bytes P2P (then re-seed them) |
| `GET /files` | list own drive |
| `DELETE /media/<path>` | unpublish from own drive |
| `POST /pin {"url": ...}` / `GET /pins` / `DELETE /pin/<drivekey>` | permanent mirrors |
| `POST /message {"to":"0x<pubkey>","payload":"..."}` | send → `{delivered:"direct"\|"mailbox"}` |
| `GET /messages` | inbox (id, from, ts, payload b64, via) |
| `DELETE /message/<id>` | ack/remove |

An NFT's on-chain state stores the `keets://<drivekey>/<path>?hash=<sha256>` URL —
hash-pinned content, strictly stronger than an HTTP URL.

## Wire protocol (KTS1)

Service connections are HyperDHT Noise streams to a node's **main** keets pubkey:

```
dialer   -> 'KTS1' + 1 service byte      (0x01 = messages)
acceptor -> 0x4F ack
both     -> frames: [4B BE length][utf8 JSON]   (max 1MB)
```

The Minima bridge is untouched: a Minima initiator's first wire byte is the high byte
of a 4-byte BE frame length (0x00), never 'K', so the acceptor peeks the first bytes
and routes. Pre-1.2.0 peers never send the magic and bridge exactly as before; dialing
a service at a pre-1.2.0 peer fails cleanly (its node drops the junk frame) and
messaging falls back to a mailbox.

Dials use an **ephemeral keypair** — raw hyperdht connects with a pubkey that is
announced as a server open and then time out (proven 2026-10-13) — so identity is
proven in-protocol with ed25519 signatures:

- direct msg: `{t:'msg', from, ts, payload, sig}`, `sig = sign('KMSG1'+to+ts+payload)`
  by `from`; `to` = acceptor's pubkey (binds the message to this recipient).
- mailbox store: `{t:'store', to, sealed}` — sealed = `crypto_box_seal` to the
  recipient's curve25519 key of `{m, sig}` where `m` = `{from, ts, payload}` and
  `sig` = sender's signature over `m`.
- mailbox fetch: `{t:'fetch', pk}` → `{t:'challenge', nonce}` →
  `{t:'proof', sig: sign('KFETCH1'+nonce)}` → `{t:'stored', id, sealed}`* →
  `{t:'done'}`; each `{t:'ack', id}` deletes.

Caps: payload 256KB (use media for big content), frame 1MB. Mailbox caps: 16MB per
recipient, 1GB total, 30-day TTL.

## Media internals

A second Hyperswarm on its **own DHT node** and a derived keypair
(`DHT.keyPair(sha256(seed + 'keets-media-v1'))`) — sharing the main swarm's DHT node
made replication handshakes stall under bridge churn (2026-10-13); one swarm per DHT
node is the pattern Keet itself ships. Every connection on it is corestore replication.
Own drive = `Hyperdrive(corestore.namespace('media'))` (stable key across restarts),
storage at `<datadir>/keets/store`. Each known drive's discoveryKey is joined
server+client, so fetched content is re-seeded opportunistically; pins
(`<datadir>/keets/pins.json`) re-join and `download('/')` on every start.

## Mailbox fleet

`sidecar/mailbox.js` (node-only) runs on the publicIPnodes fleet — UDP **49738**,
systemd unit `tools/publicIPnodes/config/keets-mailbox.service`, store
`/var/lib/keets-mailbox` (deploy: copy `mailbox.js` + `wire.js` into the existing
`/opt/keets`). Default pubkeys baked into `sidecar/index.js` (`DEFAULT_MAILBOXES`),
overridable with `--mailboxes`. pi-old is skipped (32-bit userland). Deployed
2026-10-13:

| host | mailbox pubkey |
|---|---|
| sally 95.179.179.181 | `0x7f84f689d4477395d7c4a2493852a56fe646a8d05a94ce8b0a1baae34ac5d1df` |
| eurobuddha 65.109.31.226 | `0x9161e165df60ee780776363143701a82a2e8fb3792a0eea58577b1e4adbb35fd` |
| maxima 45.77.246.226 | `0x3fb497a4eb9ae7681d5967b5fe4c6a56ecd2cd64f0357bd435115fe54dbad6e4` |
| openproject 78.141.237.9 | `0xa5335d9c6d663f8f9d97c6c65750220de479140a627ed317bb200f3167ddd4c6` |
| vigilance 45.77.57.24 | `0x5febd9d332b310ec8a0baa0eacb53dc82e86f9ed77e0954fd494e2ede010693d` |
| megammr 192.248.151.55 | `0x7e63777e3a53a97363b7b6faa16af6d08a315ecca40b76f8352165c52e139221` |

Mailboxes are dialed by pubkey through the DHT — no host:port coupling; the table's
IPs are only where they happen to run today.

## Tests

- `test/services-test.sh` — private DHT: API auth, publish/fetch byte-exact, hash
  tamper rejection, direct message + ack, offline → mailbox → restart → fetch.
- `test/two-node.sh` — the Minima bridge regression (unchanged, still passes with the
  peek routing).
