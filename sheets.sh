#!/usr/bin/env bash
# Google Sheets API: is a write based on a stale read refused?
#
#   GOOGLE_TOKEN  an OAuth access token with the spreadsheets scope
#   SHEET_ID      a scratch spreadsheet you can edit (A1 of its first tab is overwritten)
set -euo pipefail
: "${GOOGLE_TOKEN:?set GOOGLE_TOKEN}" "${SHEET_ID:?set SHEET_ID}"
url="https://sheets.googleapis.com/v4/spreadsheets/$SHEET_ID/values/A1"
auth=(-H "Authorization: Bearer $GOOGLE_TOKEN")

put() { curl -s -o /dev/null -w '%{http_code}' -X PUT "$url?valueInputOption=RAW" "${auth[@]}" \
          -H 'Content-Type: application/json' -d "{\"values\":[[\"$1\"]]}"; }
get() { curl -sf "$url" "${auth[@]}" | jq -r '.values[0][0] // ""'; }

put "original" >/dev/null
echo "A and B both read A1:           $(get)"
echo "A writes 'writer A':            HTTP $(put 'writer A')"
# B computed its value from the read above. The API has no way to say so:
# no revision, no precondition, no If-Match on values.update.
echo "B writes from its stale read:   HTTP $(put 'writer B')"
final=$(get)
echo "A1 is now:                      $final"
[ "$final" = "writer A" ] && echo "=> stale write refused" || echo "=> A's edit was overwritten, and nobody was told"
