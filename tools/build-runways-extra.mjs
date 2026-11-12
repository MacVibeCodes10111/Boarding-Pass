#!/usr/bin/env node
// build-runways-extra.mjs: makes public/data/runways-extra.json, the runways
// of the game's airports that OurAirports lists without coordinates (about
// 800, many of them in China and Brazil), from OpenStreetMap
// (© OpenStreetMap contributors, ODbL). Without it those airports get a
// made-up runway through the middle of the airport, so aircraft take off
// and land across the terminal.
//
// Run where OpenStreetMap's Overpass API can be reached:
//   node tools/build-runways-extra.mjs
// Resumable: batches already downloaded are kept in tools/.runways-extra.state.json
// (not in public/, so it never ends up in a build).
//
// Output: { "v": 1, "built": "...", "airports": { "YNT": [[le, he, lengthFt, leLat, leLon, heLat, heLon], …] } }
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = (f) => resolve(root, 'public/data', f);
const LOG = resolve(root, 'tools/.runways-extra.log');
writeFileSync(LOG, '');
const log = (s) => {
  console.log(s);
  appendFileSync(LOG, s + '\n');
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else if (ch !== '\r') cur += ch;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  const head = rows.shift();
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

// The game's airports (scheduled large and medium ones, and every airport airlines fly to)…
const net = JSON.parse(readFileSync(data('network.json'), 'utf8'));
const inNetwork = new Set(net.airports.map((a) => a[0]));
// …that have no usable runway with coordinates in runways.csv
const withCoords = new Set();
for (const r of parseCsv(readFileSync(data('runways.csv'), 'utf8'))) {
  if (r.closed === '1' || !(Number(r.length_ft) >= 1200)) continue;
  if (r.le_ident && r.le_latitude_deg && r.le_longitude_deg && r.he_latitude_deg && r.he_longitude_deg) withCoords.add(r.airport_ref);
}
const seen = new Set();
const airports = [];
for (const r of parseCsv(readFileSync(data('airports.csv'), 'utf8'))) {
  const iata = (r.iata_code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{3}$/.test(iata) || seen.has(iata)) continue;
  const big = r.type === 'large_airport' || r.type === 'medium_airport';
  const listed = (r.scheduled_service === 'yes' && big) || (inNetwork.has(iata) && (big || r.type === 'small_airport'));
  if (!listed) continue;
  seen.add(iata);
  const lat = Number(r.latitude_deg);
  const lon = Number(r.longitude_deg);
  if (withCoords.has(r.id) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  airports.push({ iata, lat, lon });
}
log(`${airports.length} airports without runway coordinates`);

const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const STATE = resolve(root, 'tools/.runways-extra.state.json');
let state = {};
try {
  state = JSON.parse(readFileSync(STATE, 'utf8'));
} catch {}
const BATCH = 25;
const AROUND_M = 4500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fetchBatch = async (q) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const url of MIRRORS) {
      try {
        const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), headers: { 'User-Agent': 'BoardingPass-data-build (boardingpass.my)', Accept: 'application/json' }, signal: AbortSignal.timeout(120_000) });
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = JSON.parse(text);
        if (j.remark && /timed out|out of memory|error/i.test(j.remark)) throw new Error(j.remark.slice(0, 100));
        return j.elements;
      } catch (e) {
        log(`  ${url.split('/')[2]} failed: ${String(e.message).slice(0, 80)}`);
      }
    }
    await sleep(15_000 * (attempt + 1));
  }
  return null;
};

const startedAt = Date.now();
let left = 0;
for (let i = 0; i < airports.length; i += BATCH) {
  const part = airports.slice(i, i + BATCH);
  const key = part.map((a) => a.iata).join(',');
  if (state[key]) continue;
  if (Date.now() - startedAt > 70 * 60_000) {
    left++;
    continue;
  }
  const q = `[out:json][timeout:90];(${part.map((a) => `way(around:${AROUND_M},${a.lat},${a.lon})["aeroway"="runway"];`).join('')});out tags geom;`;
  const els = await fetchBatch(q);
  if (els) {
    // Only what the game needs is kept: the name, the surface and the two ends
    state[key] = els
      .filter((e) => e.type === 'way' && Array.isArray(e.geometry) && e.geometry.length >= 2)
      .map((e) => ({ id: e.id, ref: e.tags?.ref ?? '', surface: e.tags?.surface ?? '', kind: e.tags?.runway ?? '', closed: e.geometry[0].lat === e.geometry.at(-1).lat && e.geometry[0].lon === e.geometry.at(-1).lon, g: e.geometry.map((p) => [p.lat, p.lon]) }));
    log(`${i + part.length}/${airports.length}: ${state[key].length} runways`);
    writeFileSync(STATE, JSON.stringify(state));
  } else {
    left++;
    log(`${key.slice(0, 40)}…: GAVE UP (try again next run)`);
  }
  await sleep(2500);
}

// ---------------------------------------------------------------------------
const R = Math.PI / 180;
const metres = (a, b) => {
  const h = Math.sin(((b[0] - a[0]) * R) / 2) ** 2 + Math.cos(a[0] * R) * Math.cos(b[0] * R) * Math.sin(((b[1] - a[1]) * R) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
};
const bearing = (a, b) => {
  const y = Math.sin((b[1] - a[1]) * R) * Math.cos(b[0] * R);
  const x = Math.cos(a[0] * R) * Math.sin(b[0] * R) - Math.sin(a[0] * R) * Math.cos(b[0] * R) * Math.cos((b[1] - a[1]) * R);
  return (Math.atan2(y, x) / R + 360) % 360;
};
const diff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const two = (n) => String(n).padStart(2, '0');

const out = {};
const ways = new Map();
for (const list of Object.values(state)) for (const w of list) ways.set(w.id, w);
for (const w of ways.values()) {
  if (w.closed || /water|grass_?paver/i.test(w.surface) || /displaced|blast|stopway/i.test(w.kind)) continue;
  let a = w.g[0];
  let b = w.g.at(-1);
  const lenM = metres(a, b);
  if (lenM < 366 || lenM > 6500) continue; // 1,200 ft, as for runways.csv
  // The airport it belongs to: the nearest one to its middle, within the search circle
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let ap = null;
  let best = AROUND_M + 500;
  for (const x of airports) {
    if (Math.abs(x.lat - mid[0]) > 0.1) continue;
    const d = metres(mid, [x.lat, x.lon]);
    if (d < best) [ap, best] = [x, d];
  }
  if (!ap) continue;
  // Names from the map ("07/25", "18L/36R"), else from the direction
  let hdg = bearing(a, b);
  const m = /^(\d{1,2})([LRC]?)\s*\/\s*(\d{1,2})([LRC]?)$/.exec(w.ref.trim().toUpperCase());
  let le;
  let he;
  if (m && diff(Number(m[1]) * 10, Number(m[3]) * 10) > 150) {
    [le, he] = [`${two(Number(m[1]))}${m[2]}`, `${two(Number(m[3]))}${m[4]}`];
    // the first name is the end aircraft land towards that heading from
    if (diff(hdg, Number(m[1]) * 10) > 90) [a, b] = [b, a];
  } else {
    if (hdg >= 180) {
      [a, b] = [b, a];
      hdg -= 180;
    }
    const n = Math.round(hdg / 10) || 36;
    [le, he] = [two(n), two(n > 18 ? n - 18 : n + 18)];
  }
  (out[ap.iata] ??= []).push([le, he, Math.round(lenM / 0.3048), r6(a[0]), r6(a[1]), r6(b[0]), r6(b[1])]);
}
// One entry per runway (a runway drawn in two pieces keeps its longer piece), longest first, at most 6
for (const k of Object.keys(out)) {
  const byName = new Map();
  for (const r of out[k].sort((x, y) => y[2] - x[2])) if (!byName.has(`${r[0]}/${r[1]}`)) byName.set(`${r[0]}/${r[1]}`, r);
  out[k] = [...byName.values()].slice(0, 6);
}
const n = Object.keys(out).length;
writeFileSync(data('runways-extra.json'), JSON.stringify({ v: 1, built: new Date().toISOString().slice(0, 10), source: '© OpenStreetMap contributors (ODbL)', airports: out }));
log(`batches left: ${left}${left ? '' : ' (all done)'}`);
log(`runways-extra.json: ${n} of ${airports.length} airports, ${Object.values(out).reduce((s, x) => s + x.length, 0)} runways`);
