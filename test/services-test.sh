#!/bin/bash
# keets services test: media hosting + pubkey messaging + mailbox store-and-forward,
# two sidecars on a private local DHT (no Minima nodes needed — these are sidecar
# services; the Minima bridge is covered by two-node.sh).
# Pass: B fetches A's published media byte-exact (hash-verified keets:// url),
#       B->A direct message delivered + acked, A->B(offline) stored at the mailbox
#       and fetched by B on restart.
set -u

KEETS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR="$KEETS_DIR/sidecar/index.js"
WORK="${KEETS_TEST_DIR:-/tmp/keets-services-test}"
BOOT_PORT=40100

TOK_A=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
TOK_B=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

api() { # api <port> <token> <method> <path> [body]
  local port=$1 tok=$2 method=$3 p=$4 body="${5:-}"
  if [ -n "$body" ]; then
    curl -s -X "$method" -H "x-keets-token: $tok" --data-binary "$body" "127.0.0.1:$port$p"
  else
    curl -s -X "$method" -H "x-keets-token: $tok" "127.0.0.1:$port$p"
  fi
}

cleanup() {
  for p in "${APID:-}" "${BPID:-}" "${MBPID:-}" "${BOOTPID:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done
  wait 2>/dev/null
}
trap cleanup EXIT

FAIL=0
check() { # check <desc> <ok-bool>
  if [ "$2" = "true" ]; then echo "PASS: $1"; else echo "FAIL: $1"; FAIL=1; fi
}

rm -rf "$WORK" && mkdir -p "$WORK/a" "$WORK/b" "$WORK/mb"

echo "== local DHT bootstrap on 127.0.0.1:$BOOT_PORT"
node "$KEETS_DIR/test/bootstrap.js" $BOOT_PORT > "$WORK/bootstrap.log" 2>&1 &
BOOTPID=$!
sleep 2

echo "== mailbox daemon"
node "$KEETS_DIR/sidecar/mailbox.js" --datadir "$WORK/mb" --bootstrap 127.0.0.1:$BOOT_PORT > "$WORK/mb.log" 2>&1 &
MBPID=$!
for i in $(seq 1 20); do grep -q 'mailbox up' "$WORK/mb.log" && break; sleep 1; done
MBPK="$(sed -n 's/.*pubkey:0x\([0-9a-f]*\).*/\1/p' "$WORK/mb.log" | head -1)"
echo "   mailbox pubkey: 0x$MBPK"
[ -n "$MBPK" ] || { echo "FAIL: mailbox did not start"; exit 1; }

start_sidecar() { # start_sidecar <dir> <port> <token> -> pid
  local dir=$1 port=$2 tok=$3
  KEETS_TOKEN=$tok KEETS_STDIN_EXIT=0 node "$SIDECAR" \
      --port $port --datadir "$WORK/$dir" --topic keets-services-test \
      --bootstrap 127.0.0.1:$BOOT_PORT --mailboxes "$MBPK" \
      > "$WORK/$dir.log" 2>&1 &
  echo $!
}

echo "== sidecars A (api 7106) and B (api 7206)"
APID=$(start_sidecar a 7101 $TOK_A)
BPID=$(start_sidecar b 7201 $TOK_B)
for i in $(seq 1 30); do grep -q 'media up' "$WORK/a.log" && grep -q 'media up' "$WORK/b.log" && break; sleep 1; done
APK="$(cat "$WORK/a/keets/pubkey" | tr -d '\n')"
BPK="$(cat "$WORK/b/keets/pubkey" | tr -d '\n')"
echo "   A: $APK"
echo "   B: $BPK"

echo "== TEST 1: auth — request without token is rejected"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "127.0.0.1:7106/info")
check "API rejects missing token (401)" "$([ "$CODE" = "401" ] && echo true || echo false)"

echo "== TEST 2: media — A publishes, B fetches byte-exact via keets:// url"
head -c 100000 /dev/urandom > "$WORK/blob.bin"
PUB=$(api 7106 $TOK_A POST /media/art/test.bin @"$WORK/blob.bin")
echo "   publish: $PUB"
URL=$(echo "$PUB" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')
[ -n "$URL" ] || { echo "FAIL: no url from publish"; exit 1; }
curl -s -H "x-keets-token: $TOK_B" "127.0.0.1:7206/media?url=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$URL")" -o "$WORK/fetched.bin"
check "fetched content byte-exact" "$(cmp -s "$WORK/blob.bin" "$WORK/fetched.bin" && echo true || echo false)"

echo "== TEST 3: hash verification — tampered hash in url is refused"
BADURL="${URL%\?hash=*}?hash=$(printf '0%.0s' {1..64})"
BAD=$(curl -s -H "x-keets-token: $TOK_B" "127.0.0.1:7206/media?url=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$BADURL")")
check "hash mismatch rejected" "$(echo "$BAD" | grep -q 'mismatch\|error' && echo true || echo false)"

echo "== media limits and mutable profile updates"
LIMITED=$(curl --max-time 40 -s -H "x-keets-token: $TOK_B" "127.0.0.1:7206/media?url=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$URL")&maxbytes=99999")
check "oversized media refused" "$(echo "$LIMITED" | grep -q 'size limit' && echo true || echo false)"
PROFILE=$(api 7106 $TOK_A POST /media/salon/test/profile.json '{"name":"before"}')
PROFILE_URL=$(echo "$PROFILE" | sed -n 's/.*"url":"\([^?]*\)?hash=.*/\1/p')
PROFILE_DRIVE=$(echo "$PROFILE" | sed -n 's/.*"drive":"\([^"]*\)".*/\1/p')
PRIVATE_DRIVE=$(echo "$PUB" | sed -n 's/.*"drive":"\([^"]*\)".*/\1/p')
check "public Salon drive is separate from attachment drive" "$([ -n "$PROFILE_DRIVE" ] && [ "$PROFILE_DRIVE" != "$PRIVATE_DRIVE" ] && echo true || echo false)"
INFO=$(api 7106 $TOK_A GET /info)
check "API advertises isolated bounded Salon hosting" "$(echo "$INFO" | grep -q '"boundedMedia":true' && echo "$INFO" | grep -q '"salondrive":' && echo true || echo false)"
PROFILE_QUERY=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$PROFILE_URL")
BEFORE=$(curl --max-time 40 -s -H "x-keets-token: $TOK_B" "127.0.0.1:7206/media?url=$PROFILE_QUERY&maxbytes=1024")
check "profile initially readable" "$(echo "$BEFORE" | grep -q 'before' && echo true || echo false)"
api 7106 $TOK_A POST /media/salon/test/profile.json '{"name":"after"}' > /dev/null
AFTER=$(curl --max-time 40 -s -H "x-keets-token: $TOK_B" "127.0.0.1:7206/media?url=$PROFILE_QUERY&maxbytes=1024")
check "stable profile sees the updated content" "$(echo "$AFTER" | grep -q 'after' && echo true || echo false)"
if [ "${KEETS_MEDIA_ONLY:-0}" = "1" ]; then
  [ $FAIL = 0 ] && echo "ALL MEDIA TESTS PASSED" || echo "SOME MEDIA TESTS FAILED"
  exit $FAIL
fi

echo "== TEST 4: direct message B -> A"
R=$(api 7206 $TOK_B POST /message "{\"to\":\"$APK\",\"payload\":\"hello from B\"}")
echo "   send: $R"
check "delivered direct" "$(echo "$R" | grep -q '"delivered":"direct"' && echo true || echo false)"
sleep 1
INBOX=$(api 7106 $TOK_A GET /messages)
echo "   A inbox: $INBOX"
check "A received (payload + authenticated sender)" "$(echo "$INBOX" | grep -q "$(echo -n 'hello from B' | base64)" && echo "$INBOX" | grep -qi "\"from\":\"$BPK\"" && echo true || echo false)"
MID=$(echo "$INBOX" | sed -n 's/.*"id":"\([0-9a-f]*\)".*/\1/p' | head -1)
api 7106 $TOK_A DELETE /message/$MID > /dev/null
check "ack clears inbox" "$([ "$(api 7106 $TOK_A GET /messages)" = "[]" ] && echo true || echo false)"

echo "== TEST 5: store-and-forward — B offline, A sends, B restarts and fetches"
kill $BPID 2>/dev/null; wait $BPID 2>/dev/null; BPID=
sleep 2
R=$(api 7106 $TOK_A POST /message "{\"to\":\"$BPK\",\"payload\":\"offline msg for B\"}")
echo "   send: $R"
check "fell back to mailbox" "$(echo "$R" | grep -q '"delivered":"mailbox"' && echo true || echo false)"
BPID=$(start_sidecar b 7201 $TOK_B)
for i in $(seq 1 40); do api 7206 $TOK_B GET /messages 2>/dev/null | grep -q 'payload' && break; sleep 1; done
INBOX=$(api 7206 $TOK_B GET /messages)
echo "   B inbox after restart: $INBOX"
check "B fetched stored message (sender verified)" "$(echo "$INBOX" | grep -q "$(echo -n 'offline msg for B' | base64)" && echo "$INBOX" | grep -qi "\"from\":\"$APK\"" && echo "$INBOX" | grep -q '"via":"mailbox"' && echo true || echo false)"

echo
[ $FAIL = 0 ] && echo "ALL TESTS PASSED" || echo "SOME TESTS FAILED"
exit $FAIL
