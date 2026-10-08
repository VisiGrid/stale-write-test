#!/usr/bin/env bash
# VisiGrid API: is a write based on a stale read refused?
#
#   VISIGRID_TOKEN  a personal API token (Settings -> API tokens on app.visigrid.app)
#   SHEET_ID        a scratch workbook's id, from its URL (A1 of its first sheet is overwritten)
set -euo pipefail
: "${VISIGRID_TOKEN:?set VISIGRID_TOKEN}" "${SHEET_ID:?set SHEET_ID}"
api="${VISIGRID_ORIGIN:-https://app.visigrid.app}/api/connector/sheets/$SHEET_ID"
auth=(-H "Authorization: Bearer $VISIGRID_TOKEN")

read_a1() { curl -sf "$api/range?range=A1" "${auth[@]}"; }
# Every write names the revision it was computed from.
put() { curl -s -o /dev/null -w '%{http_code}' -X POST "$api/cells" "${auth[@]}" -H 'Content-Type: application/json' \
          -d "{\"expected_revision\":$1,\"edits\":[{\"ref\":\"A1\",\"value\":\"$2\"}]}"; }

put "$(read_a1 | jq .revision)" "original" >/dev/null
seen=$(read_a1)
rev=$(jq .revision <<<"$seen")
echo "A and B both read A1:           $(jq -r '.cells[0].value // ""' <<<"$seen") (revision $rev)"
a=$(put "$rev" 'writer A')
echo "A writes 'writer A':            HTTP $a"
b=$(put "$rev" 'writer B')
echo "B writes from its stale read:   HTTP $b"
final=$(read_a1 | jq -r '.cells[0].value // ""')
echo "A1 is now:                      $final"
if [ "$a" != 200 ] || { [ "$b" != 200 ] && [ "$b" != 409 ]; }; then
  echo "=> inconclusive: a write failed (HTTP $a / $b), so nothing was tested; wait a minute and rerun"
elif [ "$final" = "writer A" ]; then
  echo "=> stale write refused"
else
  echo "=> A's edit was overwritten, and nobody was told"
fi
