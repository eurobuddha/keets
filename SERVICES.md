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

## Node bridge: the `keets` command + `KEETS` MDS event

For apps that talk to the Minima node rather than the sidecar directly (MiniDapps,
web pages, APKs), minima-core (main `ea37438033` / keets-android `686d2c504d`) exposes
the whole thing as one RPC command — the node holds the API token, apps never see it,
and node RPC already sends open CORS so a plain web page can use it:

```
keets action:info | send (to:, message:|datahex:) | inbox | ack (id:)
      | publish (path:, datahex:) | fetch (url:) | pin (url:) | pins | unpin (drive:)
```

Inbound consumption has two modes:
- **MDS enabled**: the node polls the sidecar inbox every 5s and pushes each message
  as MDS event `KEETS` `{id, from, ts, payload b64, message utf8, via}`, acking after
  the event posts (a dapp's service.js persists them — see mds/keetchat).
- **No MDS** (the family node lines — MDS is stripped): the node does NOT auto-drain;
  apps poll `keets action:inbox` and `action:ack` what they have stored.

Reference app: `mds/keetchat` — one page that runs as an MDS MiniDapp or as a plain
RPC page (`index.html?rpc=http://127.0.0.1:<rpcport>`), with the full integration
contract in its README.

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

### Signed mailbox list (sidecar 1.3.0)

Nodes no longer depend on the baked-in list alone: at startup the Java node
(`KeetsMailboxList.java`, core fork) fetches `https://eurobuddha.com/keets/mailboxes.json`,
verifies its Ed25519 signature against the baked-in public key
(`GeneralParams.KEETS_MAILBOX_SIGNKEY`), caches it at `<data>/keets/mailboxes.json`, and
passes it to the sidecar as `--mailboxes` — which now **replaces** `DEFAULT_MAILBOXES`
(absent/invalid/offline → cached copy → baked defaults). So a new mailbox joins the
network with a re-signed file, no app release.

File: `{"v":1,"ts":<ms>,"mailboxes":["<64-hex>",…],"sig":"<128-hex>"}`; signed string
`"1\n<ts>\n<sorted mailboxes joined by ,>"`. A file whose `ts` is older than the cached
one is rejected (no rollback). Maintained with `tools/mailboxes-sign.js`:

```
node tools/mailboxes-sign.js --keygen ~/.keets/mailbox-signing.key          # once; prints the pubkey to bake
node tools/mailboxes-sign.js --key ~/.keets/mailbox-signing.key \
     --in mailboxes.json --out mailboxes.json --add 0x<new mailbox pubkey>   # re-sign
node tools/mailboxes-sign.js --verify mailboxes.json --pub <64-hex>          # what the nodes do
scp mailboxes.json hetzner:/var/www/html/keets/mailboxes.json
```

`primaryMailbox()` hashes the recipient key over the sorted list, so a list change
re-maps some recipients' primary; the 45 s / 10 min poll of every mailbox covers the gap.

### Serve mode — one process per fleet box (sidecar 1.3.0)

`index.js --serve [--dht-port 49737] [--public-host <ip>] [--mailbox-dir <dir>]` makes the
node's own sidecar ALSO the box's public DHT bootstrap node (fixed port, non-ephemeral and
unfirewalled from the first tick — what `DHT.bootstrapper()` does) and its mailbox: a second
HyperDHT server on the mailbox keypair from `<mailbox-dir>/keypair`, sharing the one DHT
instance. The parlons-node fleet jar spawns it this way; `hyperdht-bootstrap.service` and
`keets-mailbox.service` are no longer needed on such a box. `GET /info` reports
`dht.serve = { dhtPort, publicHost, mailboxPubkey, store }` — the pubkey to sign into the
list and the `host:49737` to list as a bootstrap. `--bootstrap none` = private DHT root.
`mailbox.js` still runs standalone for the original fleet units (same seed file layout, so
a box can later be migrated without changing its published pubkey).

## Tests

- `test/services-test.sh` — private DHT: API auth, publish/fetch byte-exact, hash
  tamper rejection, direct message + ack, offline → mailbox → restart → fetch.
- `test/serve-test.js` — serve mode: A (`--serve --bootstrap none`) is the only bootstrap
  for B, `--mailboxes` replaces the defaults, B→offline C lands in A's store, C fetches it
  and its ack deletes the copy.
- `test/two-node.sh` — the Minima bridge regression (unchanged, still passes with the
  peek routing).

### Salon public hosting (sidecar 1.2.1)

`/info` now advertises `boundedMedia: true` and `salondrive`. The existing `drive`
remains the attachment drive; its identity and old links are unchanged. Publishing
paths beginning `/salon/` uses a separate Hyperdrive namespace so a public profile
link does not reveal the drive containing chat attachments. `GET /files?scope=salon`
lists public Salon files; deleting `/media/salon/...` targets that same public drive.

`GET /media?url=...&maxbytes=N` checks the signed Hyperdrive entry size before
loading the blob. N must be an integer from 1 through 64 MiB; omitted means 64 MiB.
The read uses that exact checked entry, checks the completed byte length, retains
hash verification, and cancels its own outstanding reads at the 30-second deadline.
Mutable profile reads update the drive before looking up the current path.

Salon applies a smaller 24 MiB aggregate profile allowance (JSON plus unique media),
with a 1 MiB JSON ceiling and 8 MiB image-reader ceiling. These are Salon rules,
not changes to existing chat upload limits. Public profile/media is not confidential;
other peers can retain copies. Removing a local file cannot recall those copies.

Verification: `node --test test/media-limits-test.js` and
`KEETS_MEDIA_ONLY=1 KEETS_TEST_DIR=<fresh-test-directory> bash test/services-test.sh`.
The latter reuses the private two-sidecar fixture and skips message transmission.

### Fetch re-dials a peer the swarm gave up on (sidecar 1.3.2, 1.3.3)

Hyperswarm dials a peer found on a topic four times (about 40 s) and then leaves it alone
until the topic's own refresh, every 10 minutes, finds it again. Two phones whose hole-punch
failed once (one asleep, mid network change, behind CGNAT) therefore stayed apart for up to
10 minutes however often the user tapped Resume: a media fetch only waited for peers. Proven on
the Fold 2026-10-27: a file transfer did nothing for 25 minutes, then completed in seconds once
a refresh re-dialed the sender. `media.fetch` now refreshes the drive's topic first when the
drive has no connected peer (`wakeDrive`), which re-queues an exhausted peer at once; a drive
with a peer is untouched, so block-by-block transfers add no lookups.

`api.js` logs every failed request as `keets api <METHOD> <path> failed: <reason>` (never the
token or body); the apps used to hide that reason behind one generic line.

Verification: `node test/private-shared-connection-test.js` (private files over a connection the
photo drive paired first, in every order, and a fetch on a drive whose only holder the swarm had
given up on - 30 s "media unavailable" on 1.3.1, 71 ms on 1.3.2), plus
`node --test test/media-recovery-test.js`, `node test/private-sharing-test.js`,
`node --test test/media-limits-test.js`.

1.3.3: `POST /private-sharing` with `sharing:false` for a transfer that has no record (sent
before 1.2.12's per-transfer storage) answers `{sharing:false}`: nothing serves it, so it is
already stopped. Refusing it made the apps' delivery tick retry every 5 s forever and blocked
Remove for those files. Re-sharing an unknown transfer is still refused.
