#!/bin/bash
# End-to-end smoke test: public site, OAuth gating, sync protocol, field-level
# merge, Siri endpoints, PWA wiring.
#
#   npm run dev            # in one terminal
#   bash scripts/smoke.sh  # in another
#
# The Google round-trip itself isn't covered — it needs a real browser and a
# real Google account. Everything up to and after the redirect is.
cd "$(dirname "$0")/.." || exit 1
set -a; . ./.env; set +a
B=${BASE_URL:-http://localhost:4321}
pass=0; fail=0
chk() { if [ "$2" = "$3" ]; then echo "  ok   $1 ($2)"; pass=$((pass+1)); else echo "  FAIL $1: got '$2' want '$3'"; fail=$((fail+1)); fi; }
has() { if echo "$2" | grep -q "$3"; then echo "  ok   $1"; pass=$((pass+1)); else echo "  FAIL $1: '$2' lacks '$3'"; fail=$((fail+1)); fi; }
A=(-H "authorization: Bearer $SHORTCUTS_TOKEN")
JSON=(-H 'content-type: application/json')

echo "== public site =="
chk "GET /  200"            "$(curl -s -o /dev/null -w %{http_code} $B/)" 200
has "renders name"          "$(curl -s $B/)" "Adarsh Ambati"
has "renders tagline"       "$(curl -s $B/)" "Robotics and physical intelligence"
has "renders a project"     "$(curl -s $B/)" "Suturebot"
has "renders company"       "$(curl -s $B/)" "Candor"
has "renders earlier work"  "$(curl -s $B/)" "Gro-STEMs"
has "both emails present"   "$(curl -s $B/)" "adarsh1@stanford.edu"
has "linkedin present"      "$(curl -s $B/)" "linkedin.com/in/adarshambati"
chk "home is indexable"     "$(curl -s $B/ | grep -c noindex)" 0
has "canonical set"         "$(curl -s $B/)" "adarshambati.com"

echo "== gating =="
chk "GET /todo redirects"   "$(curl -s -o /dev/null -w %{http_code} $B/todo)" 302
chk "  ...to /login"        "$(curl -s -o /dev/null -w %{redirect_url} $B/todo)" "$B/login?next=%2Ftodo"
chk "GET /login  200"       "$(curl -s -o /dev/null -w %{http_code} $B/login)" 200
has "offers google"         "$(curl -s $B/login)" "Continue with Google"
chk "login is noindex"      "$(curl -s $B/login | grep -c noindex)" 1
chk "POST /api/sync  401"   "$(curl -s -o /dev/null -w %{http_code} -X POST $B/api/sync "${JSON[@]}" -d '{"cursor":0,"changes":[]}')" 401
chk "GET /api/list   401"   "$(curl -s -o /dev/null -w %{http_code} $B/api/list)" 401

echo "== oauth handshake =="
OUT=$(curl -s -o /dev/null -D - "$B/api/auth/login?next=/todo")
has "redirects to google"   "$OUT" "accounts.google.com"
has "requests email scope"  "$OUT" "scope=openid.email"
has "sets state cookie"     "$OUT" "oauth_state"
has "state cookie httponly" "$OUT" "HttpOnly"
chk "callback w/o state"    "$(curl -s -o /dev/null -w %{redirect_url} "$B/api/auth/callback?code=x&state=y")" "$B/login?error=state"
chk "callback on cancel"    "$(curl -s -o /dev/null -w %{redirect_url} "$B/api/auth/callback?error=access_denied")" "$B/login?error=cancelled"
chk "open redirect blocked" "$(curl -s -o /dev/null -D - "$B/api/auth/login?next=https://evil.example" | grep -c 'evil.example')" 0

echo "== sync: push then pull (bearer) =="
T1=$(uuidgen); T2=$(uuidgen)
NOW=$(($(date +%s)*1000))
st() { echo "{\"title\":$1,\"done\":$2,\"notes\":$3,\"due\":$3,\"deleted\":$4}"; }
R=$(curl -s "${A[@]}" -X POST $B/api/sync "${JSON[@]}" -d "{\"cursor\":0,\"changes\":[
  {\"id\":\"$T1\",\"title\":\"buy milk\",\"notes\":\"\",\"done\":0,\"due\":null,\"deleted\":0,\"ts\":$(st $NOW $NOW $NOW $NOW)},
  {\"id\":\"$T2\",\"title\":\"call mom\",\"notes\":\"\",\"done\":0,\"due\":null,\"deleted\":0,\"ts\":$(st $NOW $NOW $NOW $NOW)}]}")
chk "both records echoed" "$(echo "$R" | python3 -c "
import json,sys
ids={c['id'] for c in json.load(sys.stdin)['changes']}
print('$T1' in ids and '$T2' in ids)")" True
CUR=$(echo "$R" | python3 -c 'import json,sys;print(json.load(sys.stdin)["cursor"])')
chk "pull at cursor empty" "$(curl -s "${A[@]}" -X POST $B/api/sync "${JSON[@]}" -d "{\"cursor\":$CUR,\"changes\":[]}" | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["changes"]))')" 0
chk "idempotent re-push"   "$(curl -s "${A[@]}" -X POST $B/api/sync "${JSON[@]}" -d "{\"cursor\":$CUR,\"changes\":[
  {\"id\":\"$T1\",\"title\":\"buy milk\",\"notes\":\"\",\"done\":0,\"due\":null,\"deleted\":0,\"ts\":$(st $NOW $NOW $NOW $NOW)}]}" | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["changes"]))')" 0

echo "== field-level merge (the whole point) =="
# Device A checks the box at T+2000. Device B renames the title at T+1000.
# Neither write may clobber the other.
LATER=$((NOW+2000)); MID=$((NOW+1000))
curl -s -o /dev/null "${A[@]}" -X POST $B/api/sync "${JSON[@]}" -d "{\"cursor\":$CUR,\"changes\":[
  {\"id\":\"$T1\",\"title\":\"buy milk\",\"notes\":\"\",\"done\":1,\"due\":null,\"deleted\":0,\"ts\":$(st $NOW $LATER $NOW $NOW)}]}"
R2=$(curl -s "${A[@]}" -X POST $B/api/sync "${JSON[@]}" -d "{\"cursor\":0,\"changes\":[
  {\"id\":\"$T1\",\"title\":\"buy oat milk\",\"notes\":\"\",\"done\":0,\"due\":null,\"deleted\":0,\"ts\":$(st $MID $MID $NOW $NOW)}]}")
chk "title from B, done from A" "$(echo "$R2" | python3 -c "
import json,sys
for c in json.load(sys.stdin)['changes']:
    if c['id']=='$T1': print(c['title'],'|',c['done'])")" "buy oat milk | 1"

echo "== tombstone =="
DEL=$((NOW+3000))
curl -s -o /dev/null "${A[@]}" -X POST $B/api/sync "${JSON[@]}" -d "{\"cursor\":0,\"changes\":[
  {\"id\":\"$T2\",\"title\":\"call mom\",\"notes\":\"\",\"done\":0,\"due\":null,\"deleted\":1,\"ts\":$(st $NOW $NOW $NOW $DEL)}]}"
chk "delete propagates" "$(curl -s "${A[@]}" -X POST $B/api/sync "${JSON[@]}" -d '{"cursor":0,"changes":[]}' | python3 -c "
import json,sys
print([c['deleted'] for c in json.load(sys.stdin)['changes'] if c['id']=='$T2'][0])")" 1

echo "== siri endpoints =="
chk "quick-add json"     "$(curl -s -X POST $B/api/quick-add "${A[@]}" "${JSON[@]}" -d '{"title":"pick up dry cleaning"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["ok"])')" True
chk "quick-add raw text" "$(curl -s -X POST $B/api/quick-add "${A[@]}" -d 'water the plants' | python3 -c 'import json,sys;print(json.load(sys.stdin)["title"])')" "water the plants"
chk "bad bearer 401"     "$(curl -s -o /dev/null -w %{http_code} -X POST $B/api/quick-add -H 'authorization: Bearer wrong' -d 'x')" 401
chk "list speaks"        "$(curl -s "$B/api/list?format=text" "${A[@]}" | grep -c 'dry cleaning')" 1
chk "empty title 400"    "$(curl -s -o /dev/null -w %{http_code} -X POST $B/api/quick-add "${A[@]}" -d '   ')" 400
chk "deleted not spoken" "$(curl -s "$B/api/list?format=text" "${A[@]}" | grep -c 'call mom')" 0

echo "== pwa =="
chk "manifest-todo start_url" "$(curl -s $B/manifest-todo.webmanifest | python3 -c 'import json,sys;print(json.load(sys.stdin)["start_url"])')" /todo
chk "manifest-site start_url" "$(curl -s $B/manifest-site.webmanifest | python3 -c 'import json,sys;print(json.load(sys.stdin)["start_url"])')" /
chk "distinct manifest ids"   "$(curl -s $B/manifest-todo.webmanifest | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')" /todo
chk "sw.js served"            "$(curl -s -o /dev/null -w %{http_code} $B/sw.js)" 200
chk "icon 192 served"         "$(curl -s -o /dev/null -w %{http_code} $B/icons/icon-192.png)" 200
chk "home links site manifest" "$(curl -s $B/ | grep -c 'manifest-site')" 1
chk "login links todo manifest" "$(curl -s $B/login | grep -c 'manifest-todo')" 1

echo
echo "passed: $pass   failed: $fail"
exit $fail
