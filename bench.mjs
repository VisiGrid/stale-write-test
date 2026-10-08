// Google Sheets API vs VisiGrid API: the latency, sustained-write and
// large-sheet numbers in the post, from your machine. Node 20+, no dependencies.
//
//   GOOGLE_TOKEN=... SHEET_ID=... VISIGRID_TOKEN=... VISIGRID_SHEET=... node bench.mjs
//
// Google: each test adds a tab to SHEET_ID and deletes it afterwards.
// VisiGrid: VISIGRID_SHEET should be an empty scratch workbook; its first sheet
// is overwritten. Optional: N (samples per test, default 15), SUSTAIN_S (default
// 120), ONLY (comma list of latency,sustained,large).
import assert from 'node:assert/strict';

const { GOOGLE_TOKEN, SHEET_ID, VISIGRID_TOKEN, VISIGRID_SHEET } = process.env;
assert.ok(GOOGLE_TOKEN && SHEET_ID && VISIGRID_TOKEN && VISIGRID_SHEET, 'set GOOGLE_TOKEN, SHEET_ID, VISIGRID_TOKEN, VISIGRID_SHEET');
const VG = `${process.env.VISIGRID_ORIGIN || 'https://app.visigrid.app'}/api/connector/sheets/${VISIGRID_SHEET}`;
const SAPI = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;
const N = Number(process.env.N || 15);
const SUSTAIN_S = Number(process.env.SUSTAIN_S || 120);
const ONLY = (process.env.ONLY || 'latency,sustained,large').split(',');

const pause = ms => new Promise(r => setTimeout(r, ms));
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const stats = xs => xs.length ? `p50 ${Math.round(pct(xs, 0.5))} ms, p95 ${Math.round(pct(xs, 0.95))} ms (n=${xs.length})` : 'no successful samples';
const col = c => { let s = ''; for (c++; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s; return s; };
const ref = (r, c) => `${col(c)}${r + 1}`;
const block = (n, salt) => Array.from({ length: n }, (_, i) => [Math.floor(i / 10), i % 10, (salt * 31 + i) % 1000]);

async function timed(url, init = {}) {
  const t0 = performance.now();
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, ms: performance.now() - t0 };
}

// ---- Google Sheets (values.update / values.get) ------------------------------
const gh = { authorization: `Bearer ${GOOGLE_TOKEN}`, 'content-type': 'application/json' };
const tabs = [];
async function addTab(rows, cols) {
  const title = `bench-${Date.now()}-${tabs.length}`;
  const r = await timed(`${SAPI}:batchUpdate`, { method: 'POST', headers: gh,
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title, gridProperties: { rowCount: rows, columnCount: cols } } } }] }) });
  assert.equal(r.status, 200, r.text.slice(0, 300));
  tabs.push(r.json.replies[0].addSheet.properties.sheetId);
  return title;
}
function rect(cells) {
  const r0 = Math.min(...cells.map(x => x[0])), c0 = Math.min(...cells.map(x => x[1]));
  const r1 = Math.max(...cells.map(x => x[0])), c1 = Math.max(...cells.map(x => x[1]));
  const values = Array.from({ length: r1 - r0 + 1 }, () => Array(c1 - c0 + 1).fill(null));
  for (const [r, c, v] of cells) values[r - r0][c - c0] = v;
  return { range: `${ref(r0, c0)}:${ref(r1, c1)}`, values };
}
const sheets = {
  write: (tab, cells) => {
    const { range, values } = rect(cells);
    return timed(`${SAPI}/values/${encodeURIComponent(`${tab}!${range}`)}?valueInputOption=USER_ENTERED`, { method: 'PUT', headers: gh, body: JSON.stringify({ values }) });
  },
  read: async (tab, range) => {
    const r = await timed(`${SAPI}/values/${encodeURIComponent(`${tab}!${range}`)}?valueRenderOption=UNFORMATTED_VALUE`, { headers: gh });
    return { ...r, value: r.json?.values?.[0]?.[0] };
  },
};

// ---- VisiGrid (connector API; every write carries expected_revision) ---------
const vh = { authorization: `Bearer ${VISIGRID_TOKEN}`, 'content-type': 'application/json' };
let revision;
const visigrid = {
  write: async cells => {
    const edits = cells.map(([r, c, v]) => typeof v === 'string' && v.startsWith('=') ? { ref: ref(r, c), formula: v } : { ref: ref(r, c), value: v });
    const r = await timed(`${VG}/cells`, { method: 'POST', headers: vh, body: JSON.stringify({ expected_revision: revision, edits }) });
    if (r.status === 200) revision = r.json.revision;
    return r;
  },
  read: async range => {
    const r = await timed(`${VG}/range?range=${range}`, { headers: vh });
    if (r.status === 200) revision = r.json.revision;
    return { ...r, value: r.json?.cells?.[0]?.value };
  },
};

try {
  const first = await visigrid.read('A1');
  assert.equal(first.status, 200, `VisiGrid read: ${first.status} ${first.text.slice(0, 200)}`);

  if (ONLY.includes('latency')) {
    const gTab = await addTab(200, 20);
    await sheets.write(gTab, [[0, 0, 1]]);
    await visigrid.write([[0, 0, 1]]);
    const g = [], v = [];
    for (let i = 0; i < N; i++) {
      const a = await sheets.read(gTab, 'A1'); if (a.status === 200) g.push(a.ms);
      const b = await visigrid.read('A1'); if (b.status === 200) v.push(b.ms);
    }
    console.log(`read 1 cell        Sheets ${stats(g)} | VisiGrid ${stats(v)}`);
    for (const n of [1, 100, 1000]) {
      const g = [], v = [];
      for (let i = 0; i < N; i++) {
        const a = await sheets.write(gTab, block(n, i)); if (a.status === 200) g.push(a.ms); else if (a.status === 429) await pause(2000);
        const b = await visigrid.write(block(n, i)); if (b.status === 200) v.push(b.ms);
      }
      console.log(`write ${String(n).padEnd(5)} cells   Sheets ${stats(g)} | VisiGrid ${stats(v)}`);
    }
  }

  if (ONLY.includes('sustained')) {
    // One client, one request at a time, 100-cell writes as fast as each API answers.
    for (const t of ['Sheets', 'VisiGrid']) {
      const tab = t === 'Sheets' ? await addTab(200, 20) : null;
      const codes = {};
      let ok = 0, firstRefusal = null;
      const start = performance.now();
      for (let i = 0; performance.now() - start < SUSTAIN_S * 1000; i++) {
        const r = t === 'Sheets' ? await sheets.write(tab, block(100, i)) : await visigrid.write(block(100, i));
        codes[r.status] = (codes[r.status] || 0) + 1;
        if (r.status === 200) ok++;
        else if (!firstRefusal) firstRefusal = `after ${ok} writes: HTTP ${r.status} ${r.text.slice(0, 100).replace(/\s+/g, ' ')}`;
        if (r.status === 429) await pause(1000);
      }
      console.log(`sustained ${t}: ${ok} writes in ${SUSTAIN_S}s (${Math.round(ok * 60 / SUSTAIN_S)}/min), status counts ${JSON.stringify(codes)}${firstRefusal ? `, first refusal ${firstRefusal}` : ''}`);
      if (t === 'Sheets') await pause(65000); // let the per-minute quota window pass
    }
  }

  if (ONLY.includes('large')) {
    // 4,000 rows x 10 inputs, each row summed in column K. Write one input, then
    // read the dependent total: the time until a caller sees the recalculated result.
    const rows = 4000;
    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 10; c++) cells.push([r, c, (r * 10 + c) % 997]);
      cells.push([r, 10, `=SUM(A${r + 1}:J${r + 1})`]);
    }
    const gTab = await addTab(rows + 10, 12);
    for (let i = 0; i < cells.length; i += 1000) {
      const part = cells.slice(i, i + 1000);
      assert.equal((await sheets.write(gTab, part)).status, 200);
      assert.equal((await visigrid.write(part)).status, 200);
    }
    for (const t of ['Sheets', 'VisiGrid']) {
      const ms = [];
      let correct = 0;
      for (let i = 0; i < N; i++) {
        const v = 1000 + i;
        const t0 = performance.now();
        const w = t === 'Sheets' ? await sheets.write(gTab, [[2000, 0, v]]) : await visigrid.write([[2000, 0, v]]);
        const rd = t === 'Sheets' ? await sheets.read(gTab, 'K2001') : await visigrid.read('K2001');
        if (w.status === 200 && rd.status === 200) ms.push(performance.now() - t0);
        const expected = v + [...Array(9)].reduce((s, _, k) => s + ((2000 * 10 + k + 1) % 997), 0);
        if (Number(rd.value) === expected) correct++;
      }
      console.log(`4,000-row write + read total, ${t}: ${stats(ms)}, ${correct}/${N} totals correct`);
    }
  }
} finally {
  if (tabs.length) await timed(`${SAPI}:batchUpdate`, { method: 'POST', headers: gh, body: JSON.stringify({ requests: tabs.map(id => ({ deleteSheet: { sheetId: id } })) }) });
}
