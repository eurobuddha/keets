#!/bin/bash
# keets --chat-only test: a sidecar that keeps chat and the mailbox but carries no Minima
# traffic. Three sidecars on a private local DHT (no Minima nodes needed):
#   A full, B --chat-only, C full and told to dial B directly (--connect) as a chain peer.
# Each sidecar's node port is a TCP sink (tcp-sink.js) that logs every link piped into it.
# Pass: C finds and bridges A on the topic (control), B bridges NOBODY (not found on the
#       topic, C's direct chain dial is refused, nothing reaches B's node port), messages
#       reach B and A over a direct dial, and B gets mail stored while it was offline.
# Media is not covered: it rides its own swarm (media.js), which the flag does not touch, and
# a fetch on the local test DHT fails intermittently in full mode too (2026-11-23).
set -u

KEETS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR="$KEETS_DIR/sidecar/index.js"
WORK="${KEETS_TEST_DIR:-/tmp/keets-chat-only-test}"
BOOT_PORT=40200

TOK_A=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
TOK_B=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
TOK_C=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc

api() { # api <port> <token> <method> <path> [body]
  local port=$1 tok=$2 method=$3 p=$4 body="${5:-}"
  if [ -n "$body" ]; then
    curl -s -m 40 -X "$method" -H "x-keets-token: $tok" --data-binary "$body" "127.0.0.1:$port$p"
  else
    curl -s -m 40 -X "$method" -H "x-keets-token: $tok" "127.0.0.1:$port$p"
  fi
}

cleanup() {
  for p in "${APID:-}" "${BPID:-}" "${CPID:-}" "${MBPID:-}" "${BOOTPID:-}" ${SINKS:-}; do [ -n "$p" ] && kill "$p" 2>/dev/null; done
  wait 2>/dev/null
}
trap cleanup EXIT

FAIL=0
check() { # check <desc> <ok-bool>
  if [ "$2" = "true" ]; then echo "PASS: $1"; else echo "FAIL: $1"; FAIL=1; fi
}

rm -rf "$WORK" && mkdir -p "$WORK/a" "$WORK/b" "$WORK/c" "$WORK/mb"

node "$KEETS_DIR/test/bootstrap.js" $BOOT_PORT > "$WORK/bootstrap.log" 2>&1 &
BOOTPID=$!
sleep 2
node "$KEETS_DIR/sidecar/mailbox.js" --datadir "$WORK/mb" --bootstrap 127.0.0.1:$BOOT_PORT > "$WORK/mb.log" 2>&1 &
MBPID=$!
for i in $(seq 1 20); do grep -q 'mailbox up' "$WORK/mb.log" && break; sleep 1; done
MBPK="$(sed -n 's/.*pubkey:0x\([0-9a-f]*\).*/\1/p' "$WORK/mb.log" | head -1)"
[ -n "$MBPK" ] || { echo "FAIL: mailbox did not start"; exit 1; }

start_sidecar() { # start_sidecar <dir> <port> <token> [extra args...] -> pid
  local dir=$1 port=$2 tok=$3; shift 3
  KEETS_TOKEN=$tok KEETS_STDIN_EXIT=0 node "$SIDECAR" \
      --port $port --datadir "$WORK/$dir" --topic keets-chat-only-test \
      --bootstrap 127.0.0.1:$BOOT_PORT --mailboxes "$MBPK" "$@" \
      >> "$WORK/$dir.log" 2>&1 &
  echo $!
}

# send_direct <from api port> <from token> <to pubkey> <to api port> <to token> <from pubkey> <text>
# A send reports whichever of the direct dial and the mailbox store finishes first, so the proof
# of a direct dial is the copy the recipient holds with via:"direct". A few tries: a first dial
# on the local test DHT is sometimes slower than the mailbox, in full mode as well.
send_direct() {
  local try inbox
  for try in 1 2 3 4; do
    api $1 $2 POST /message "{\"to\":\"$3\",\"payload\":\"$7 $try\"}" > /dev/null
    sleep 3
    inbox=$(api $4 $5 GET /messages)
    if echo "$inbox" | tr '{' '\n' | grep -i "\"from\":\"$6\"" | grep -q '"via":"direct"'; then
      echo "   direct on try $try" >&2
      return 0
    fi
  done
  return 1
}

echo "== a TCP sink on each sidecar's node port (stands in for the Minima node)"
SINKS=
for port in 7301 7401 7501; do
  node "$KEETS_DIR/test/tcp-sink.js" $port > "$WORK/sink-$port.log" 2>&1 &
  SINKS="$SINKS $!"
done
sleep 1

echo "== sidecars A full (api 7306), B --chat-only (api 7406)"
APID=$(start_sidecar a 7301 $TOK_A)
BPID=$(start_sidecar b 7401 $TOK_B --chat-only)
for i in $(seq 1 30); do grep -q 'media up' "$WORK/a.log" && grep -q 'media up' "$WORK/b.log" && break; sleep 1; done
APK="$(cat "$WORK/a/keets/pubkey" | tr -d '\n')"
BPK="$(cat "$WORK/b/keets/pubkey" | tr -d '\n')"
echo "   A: $APK"
echo "   B: $BPK"

echo "== C full, dialing B directly as a chain peer (api 7506)"
CPID=$(start_sidecar c 7501 $TOK_C --connect "$BPK")
for i in $(seq 1 30); do grep -q 'media up' "$WORK/c.log" && break; sleep 1; done
CPK="$(cat "$WORK/c/keets/pubkey" | tr -d '\n')"
echo "   C: $CPK"

echo "== TEST 1: /info reports the mode"
check "B reports chatOnly" "$(api 7406 $TOK_B GET /info | grep -q '"chatOnly":true' && echo true || echo false)"
check "A reports not chatOnly" "$(api 7306 $TOK_A GET /info | grep -q '"chatOnly":false' && echo true || echo false)"

echo "== TEST 2: chain bridging — C bridges on the topic, B bridges nobody"
for i in $(seq 1 40); do grep -qi "peer connected pubkey:$APK" "$WORK/c.log" && grep -qi "peer connected pubkey:$BPK" "$WORK/c.log" && break; sleep 1; done
sleep 18   # longer than the 15 s an acceptor waits before bridging a silent link
check "control: C found A on the topic and bridged it" "$(grep -qi "peer connected pubkey:$APK" "$WORK/c.log" && echo true || echo false)"
check "control: C's node port received its bridged links" "$(grep -q '^conn' "$WORK/sink-7501.log" && echo true || echo false)"
check "control: C's direct chain dial reached B" "$(grep -qi "peer connected pubkey:$BPK" "$WORK/c.log" && echo true || echo false)"
check "B never joined the topic" "$(grep -q 'chain topic not joined' "$WORK/b.log" && ! grep -q 'topic joined' "$WORK/b.log" && echo true || echo false)"
check "B bridged no peer (incl. C's direct dial)" "$(! grep -q 'peer connected' "$WORK/b.log" && echo true || echo false)"
check "nothing was piped into B's node port" "$(grep -q 'sink up' "$WORK/sink-7401.log" && ! grep -q '^conn' "$WORK/sink-7401.log" && echo true || echo false)"
check "A never bridged B" "$(! grep -qi "peer connected pubkey:$BPK" "$WORK/a.log" && echo true || echo false)"

echo "== TEST 3: direct messages both ways with the chat-only sidecar"
check "A->B arrived over a direct dial (B reachable by key without the topic)" "$(send_direct 7306 $TOK_A "$BPK" 7406 $TOK_B "$APK" 'hello chat-only B' && echo true || echo false)"
check "B->A arrived over a direct dial" "$(send_direct 7406 $TOK_B "$APK" 7306 $TOK_A "$BPK" 'hello from chat-only B' && echo true || echo false)"
for id in $(api 7406 $TOK_B GET /messages | grep -o '"id":"[0-9a-f]*"' | cut -d'"' -f4); do api 7406 $TOK_B DELETE /message/$id > /dev/null; done
check "B's inbox cleared" "$([ "$(api 7406 $TOK_B GET /messages)" = "[]" ] && echo true || echo false)"

echo "== TEST 4: store-and-forward — B offline, A sends, B restarts chat-only and fetches"
kill $BPID 2>/dev/null; wait $BPID 2>/dev/null; BPID=
sleep 2
# A's own dial to the mailbox occasionally times out on the local test DHT (nothing to do with
# B's mode); the API reports it and the caller sends again, as the apps do.
for try in 1 2 3; do
  R=$(api 7306 $TOK_A POST /message "{\"to\":\"$BPK\",\"payload\":\"offline msg for B\"}")
  echo "   send (try $try): $R"
  echo "$R" | grep -q '"delivered"' && break
done
check "fell back to mailbox" "$(echo "$R" | grep -q '"delivered":"mailbox"' && echo true || echo false)"
BPID=$(start_sidecar b 7401 $TOK_B --chat-only)
for i in $(seq 1 40); do api 7406 $TOK_B GET /messages 2>/dev/null | grep -q "$(echo -n 'offline msg for B' | base64)" && break; sleep 1; done
INBOX=$(api 7406 $TOK_B GET /messages)
check "B received the offline message after restart (sender verified)" "$(echo "$INBOX" | grep -q "$(echo -n 'offline msg for B' | base64)" && echo "$INBOX" | grep -qi "\"from\":\"$APK\"" && echo true || echo false)"
check "B still bridged no peer after restart" "$(! grep -q 'peer connected' "$WORK/b.log" && ! grep -q '^conn' "$WORK/sink-7401.log" && echo true || echo false)"

echo
[ $FAIL = 0 ] && echo "ALL TESTS PASSED" || echo "SOME TESTS FAILED"
exit $FAIL
