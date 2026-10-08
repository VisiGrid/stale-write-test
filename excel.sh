#!/usr/bin/env bash
# Excel Online via Microsoft Graph: is a write based on a stale read refused?
#
#   GRAPH_TOKEN   an access token with Files.ReadWrite (Graph Explorer works)
#   ITEM_ID       the drive item id of a scratch .xlsx in your OneDrive
#   WORKSHEET     optional, default Sheet1 (its A1 is overwritten)
set -euo pipefail
: "${GRAPH_TOKEN:?set GRAPH_TOKEN}" "${ITEM_ID:?set ITEM_ID}"
url="https://graph.microsoft.com/v1.0/me/drive/items/$ITEM_ID/workbook/worksheets('${WORKSHEET:-Sheet1}')/range(address='A1')"
auth=(-H "Authorization: Bearer $GRAPH_TOKEN")

put() { curl -s -o /dev/null -w '%{http_code}' -X PATCH "$url" "${auth[@]}" \
          -H 'Content-Type: application/json' -d "{\"values\":[[\"$1\"]]}"; }
get() { curl -sf "$url" "${auth[@]}" | jq -r '.values[0][0] // ""'; }

put "original" >/dev/null
echo "A and B both read A1:           $(get)"
a=$(put 'writer A')
echo "A writes 'writer A':            HTTP $a"
# B computed its value from the read above. Range PATCH takes no If-Match;
# Graph's ETags apply to whole-file uploads, not cell edits.
b=$(put 'writer B')
echo "B writes from its stale read:   HTTP $b"
final=$(get)
echo "A1 is now:                      $final"
if [ "$a" != 200 ] || { [ "$b" != 200 ] && [ "$b" != 409 ]; }; then
  echo "=> inconclusive: a write failed (HTTP $a / $b), so nothing was tested; wait a minute and rerun"
elif [ "$final" = "writer A" ]; then
  echo "=> stale write refused"
else
  echo "=> A's edit was overwritten, and nobody was told"
fi
