# stale-write-test

Two programs read the same spreadsheet cell. Program A writes a new value. Then
program B, which computed its value from the read *before* A's write, writes to
the same cell. Is B's stale write refused, or does A's edit disappear?

| | Writer A | Writer B (stale) | What's left in the cell |
|---|---|---|---|
| Google Sheets API (`values.update`) | 200 | **200** | B's value. A's edit is gone, with no error. |
| Excel Online, Microsoft Graph (range `PATCH`) | 200 | **200** | B's value. A's edit is gone, with no error. |
| VisiGrid API (`POST …/cells`) | 200 | **409** | A's value. B is told to reread. |

This doesn't depend on timing, so it reproduces on every run. Neither Google's
nor Microsoft's cell-write API can express "only if nothing changed since I
read". [`values.update`](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/update)
has no revision or precondition parameter. [Graph's range update](https://learn.microsoft.com/en-us/graph/api/range-update)
takes no `If-Match`; Graph's ETags cover only whole-file uploads, not cell edits.

People editing together in the browser are fine in all three products. This is
about programs (sync jobs, scripts, AI agents) that read a while ago and write now.

Write-up: <https://visigrid.app/blog/spreadsheet-apis-silently-overwrite>

## Run it

Each script uses only `curl` and `jq`, and overwrites cell A1 of the first sheet,
so point it at a scratch file.

### Google Sheets

```bash
export GOOGLE_TOKEN=...   # access token with https://www.googleapis.com/auth/spreadsheets
export SHEET_ID=...       # from the spreadsheet URL: /spreadsheets/d/<SHEET_ID>/edit
bash sheets.sh
```

You can get a token from the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)
by selecting the Google Sheets API v4 `spreadsheets` scope. A service account
also works if you share the spreadsheet with it.

### Excel Online

```bash
export GRAPH_TOKEN=...    # access token with Files.ReadWrite
export ITEM_ID=...        # drive item id of a scratch .xlsx in your OneDrive
bash excel.sh             # WORKSHEET=... if the first sheet isn't Sheet1
```

[Graph Explorer](https://developer.microsoft.com/graph/graph-explorer) gives you
a token (the "Access token" tab). To find the item id, run
`GET /me/drive/root:/scratch.xlsx`.

### VisiGrid

```bash
export VISIGRID_TOKEN=... # Settings → API tokens on app.visigrid.app
export SHEET_ID=...       # from the workbook URL on app.visigrid.app
bash visigrid.sh
```

Every write carries the `expected_revision` it was computed from. A write from a
revision that's no longer current gets `409 revision_conflict`, and nothing is
written.

### Expected output

```
A and B both read A1:           original
A writes 'writer A':            HTTP 200
B writes from its stale read:   HTTP 200
A1 is now:                      writer B
=> A's edit was overwritten, and nobody was told
```

That's Google Sheets. Excel prints the same. VisiGrid prints `HTTP 409` on the
fourth line and `writer A` on the fifth.

## Latency and quota numbers (Sheets and VisiGrid)

`bench.mjs` produces the other numbers in the write-up: per-call latency, two
minutes of sustained writes from one client, and a 4,000-row recalculation. It
needs Node 20 or later and has no dependencies.

```bash
GOOGLE_TOKEN=... SHEET_ID=... VISIGRID_TOKEN=... VISIGRID_SHEET=... node bench.mjs
```

It adds tabs to `SHEET_ID` and deletes them at the end. It overwrites the first
sheet of `VISIGRID_SHEET`, so use an empty workbook. `N` sets the samples per
test (default 15), `SUSTAIN_S` the sustained-write duration in seconds (default
120), and `ONLY` limits the tests (`latency,sustained,large`).

Excel Online isn't in the benchmark. Microsoft's API terms don't allow
publishing performance tests of its services without a written agreement, so we
report only the stale-write behaviour for Excel.

Your numbers will differ from ours depending on where you run from. Both
services are on the public internet, and Google's quotas depend on your project.

## License

MIT
