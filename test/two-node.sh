#!/bin/bash
# keets two-node loopback test:
#   private DHT bootstrap + node A (test genesis) + node B pinned to A's pubkey.
# Pass: B connects to A over the hyperswarm bridge (synthetic 127.113.x.y peer),
#       greeting valid, B syncs A's chain tip, gossip flows.
set -u

KEETS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
JAR="${KEETS_JAR:-$KEETS_DIR/../_worktrees/minima-core-keets/build/minima-keets.jar}"
SIDECAR="$KEETS_DIR/sidecar/index.js"
WORK="${KEETS_TEST_DIR:-/tmp/keets-test}"
BOOT_PORT=40000

rpc() { curl -s "127.0.0.1:$1/$2"; }

cleanup() {
  [ -n "${APID:-}" ] && kill "$APID" 2>/dev/null
  [ -n "${BPID:-}" ] && kill "$BPID" 2>/dev/null
  [ -n "${BOOTPID:-}" ] && kill "$BOOTPID" 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT

rm -rf "$WORK" && mkdir -p "$WORK/a" "$WORK/b"

echo "== starting local DHT bootstrap on 127.0.0.1:$BOOT_PORT"
(cd "$KEETS_DIR/sidecar" && node "$KEETS_DIR/test/bootstrap.js" $BOOT_PORT > "$WORK/bootstrap.log" 2>&1) &
BOOTPID=$!
sleep 2

echo "== starting node A (test genesis, keets, no p2p) port 10001 rpc 10005"
java -jar "$JAR" -data "$WORK/a" -port 10001 -rpcenable true -test -genesis -nop2p \
  -keets -keetssidecar "$SIDECAR" -keetsbootstrap 127.0.0.1:$BOOT_PORT \
  > "$WORK/a.log" 2>&1 &
APID=$!

# wait for A's sidecar to write its pubkey (minima nests the datadir, e.g. a/1.1/)
APUB=""
for i in $(seq 1 30); do
  PUBFILE="$(find "$WORK/a" -name pubkey -path "*/keets/*" 2>/dev/null | head -1)"
  [ -n "$PUBFILE" ] && APUB="$(cat "$PUBFILE")" && break
  sleep 1
done
if [ -z "$APUB" ]; then echo "FAIL: node A sidecar never wrote pubkey"; tail -20 "$WORK/a.log"; exit 1; fi
echo "== node A keets pubkey: $APUB"

echo "== starting node B (pins A via keetsconnect) port 10011 rpc 10015"
java -jar "$JAR" -data "$WORK/b" -port 10011 -rpcenable true -test -nop2p \
  -keets -keetssidecar "$SIDECAR" -keetsbootstrap 127.0.0.1:$BOOT_PORT \
  -keetsconnect "$APUB" \
  > "$WORK/b.log" 2>&1 &
BPID=$!

echo "== waiting for bridge + greeting + IBD (max 90s)"
PASS_CONN=0
for i in $(seq 1 90); do
  NET="$(rpc 10015 network 2>/dev/null)"
  if echo "$NET" | grep -q '"host":"127.113.' && echo "$NET" | grep -q '"valid":true'; then
    PASS_CONN=1
    break
  fi
  sleep 1
done
if [ "$PASS_CONN" != "1" ]; then
  echo "FAIL: B never got a valid keets connection"
  echo "--- B network:"; rpc 10015 network; echo "--- B log:"; tail -30 "$WORK/b.log"
  exit 1
fi
echo "PASS: B has a valid keets peer (synthetic 127.113.x.y, greeting valid)"

# chain sync: B's tip must reach A's tip
PASS_SYNC=0
for i in $(seq 1 60); do
  ABLK="$(rpc 10005 block | sed -n 's/.*"block":"\([0-9]*\)".*/\1/p')"
  BBLK="$(rpc 10015 block | sed -n 's/.*"block":"\([0-9]*\)".*/\1/p')"
  # BBLK >= 3 proves ongoing block gossip over the bridge, not just the initial IBD
  if [ -n "$ABLK" ] && [ -n "$BBLK" ] && [ "$BBLK" -ge "$ABLK" ] && [ "$BBLK" -ge 3 ] 2>/dev/null; then
    PASS_SYNC=1
    break
  fi
  sleep 2
done
if [ "$PASS_SYNC" != "1" ]; then
  echo "FAIL: B did not sync to A's tip (A=$ABLK B=$BBLK)"
  echo "--- B log:"; tail -30 "$WORK/b.log"
  exit 1
fi
echo "PASS: chain synced over keets bridge (A=$ABLK B=$BBLK)"

# leak check: no synthetic address may appear in either node's P2P state
if rpc 10005 "peers" | grep -q "127.113." || rpc 10015 "peers" | grep -q "127.113."; then
  echo "FAIL: synthetic 127.113.* leaked into peers list"
  exit 1
fi
echo "PASS: no synthetic address leak in peers"

echo "== ALL PASS"
exit 0
