#!/usr/bin/env node
// build-cargo-aprons.mjs: makes public/data/cargo-aprons.json, the cargo
// aprons and cargo stands at the game's airports, from OpenStreetMap
// (© OpenStreetMap contributors, ODbL), so freighters park on cargo ramps.
//
// Run where OpenStreetMap's Overpass API can be reached (the "Cargo data"
// GitHub workflow does this): node tools/build-cargo-aprons.mjs
//
// Output: { "v": 1, "built": "...", "airports": { "MEM": { "a": [polygon…], "p": [[lon,lat]…] } } }
//   a: cargo apron outlines (lon/lat rings, 5 decimals), b: cargo buildings, p: single cargo stands
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const net = JSON.parse(readFileSync(resolve(root, 'public/data/network.json'), 'utf8'));
const airports = net.airports.map((a) => ({ iata: a[0], lat: a[5], lon: a[6] }));

const WORDS = 'cargo|freight|fret|carga|fracht|frakt|vracht|merci|kargo|frete|carico|cargas|грузов|货|貨|화물|貨物';
import { appendFileSync } from 'node:fs';
const LOG = resolve(root, 'public/data/cargo-aprons.log');
writeFileSync(LOG, '');
const log = (s) => {
  console.log(s);
  appendFileSync(LOG, s + '\n');
};
// The world is split into tiles (30° to start). A tile the servers can't
// manage is split into four smaller ones there and then, down to 2.5°.
const wayQ = (bb) => `[out:json][timeout:170];(way["aeroway"="apron"]["apron"~"cargo|freight",i]${bb};way["aeroway"="apron"]["usage"~"cargo|freight",i]${bb};way["aeroway"="apron"]["name"~"${WORDS}",i]${bb};);out geom;`;
const extraQ = (bb) => `[out:json][timeout:170];(relation["aeroway"="apron"]["apron"~"cargo|freight",i]${bb};relation["aeroway"="apron"]["name"~"${WORDS}",i]${bb};node["aeroway"="parking_position"]["name"~"${WORDS}",i]${bb};node["aeroway"="parking_position"]["usage"~"cargo|freight",i]${bb};);out geom;`;
// Cargo buildings and carrier ramps inside airports with an IATA code (many
// airports map their cargo terminals but not a cargo apron)
const CARRIERS = 'Atlas Air|Kalitta|Cargolux|Polar Air|Western Global|Amazon Air|Prime Air|AeroLogic|Swissport|Worldwide Flight|Menzies|dnata|SkyCargo|Cargo City|Luftfracht|Fedex|Federal Express';
const bQ = (bb) => `[out:json][timeout:170];(way["aeroway"="aerodrome"]["iata"]${bb};relation["aeroway"="aerodrome"]["iata"]${bb};);map_to_area->.a;(way(area.a)["building"]["name"~"${WORDS}|${CARRIERS}",i];way(area.a)["building"]["name"~"UPS|DHL|FedEx|ABX|TNT"];way(area.a)["building"]["operator"~"UPS|DHL|FedEx"];way(area.a)["aeroway"="apron"]["name"~"${CARRIERS}",i];way(area.a)["aeroway"="apron"]["name"~"UPS|DHL|FedEx"];way(area.a)["aeroway"~"^(terminal|hangar)$"]["name"~"${WORDS}|${CARRIERS}",i];);out geom;`;
const KINDS = { 'apron ways': wayQ, extras: extraQ, 'cargo buildings': bQ };
const key = (kind, [s, w, n, e]) => `${kind} (${s},${w},${n},${e})`;
const quarters = ([s, w, n, e]) => {
  const m = (s + n) / 2;
  const c = (w + e) / 2;
  return [[s, w, m, c], [s, c, m, e], [m, w, n, c], [m, c, n, e]];
};
const TOP = [];
for (const [s0, n0] of [[-60, -20], [-20, 15], [15, 35], [35, 50], [50, 75]])
  for (let w0 = -180; w0 < 180; w0 += 30) TOP.push([s0, w0, n0, w0 + 30]);
// No airports in a tile: nothing to fetch there
const hasAirport = ([s, w, n, e]) => airports.some((a) => a.lat >= s - 0.1 && a.lat <= n + 0.1 && a.lon >= w - 0.1 && a.lon <= e + 0.1);
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
// Resumable: tiles already downloaded are kept in a state file and skipped
// next time (the servers are often busy, so a run may not get through them all)
const STATE = resolve(root, 'public/data/cargo-aprons.state.json');
let state = {};
try {
  state = JSON.parse(readFileSync(STATE, 'utf8'));
} catch {}
// Older state files named the two worldwide queries without a tile
if (state['apron relations'] || state['cargo stands']) {
  if (state['apron relations'] && state['cargo stands']) state['extras (-90,-180,90,180)'] = [...state['apron relations'], ...state['cargo stands']];
  delete state['apron relations'];
  delete state['cargo stands'];
}
const split = new Set(state.__split ?? []);
const save = () => writeFileSync(STATE, JSON.stringify({ ...state, __split: [...split] }));
delete state.__split;
const startedAt = Date.now();
const data = { elements: [] };
const seen = new Set();
const take = (els) => {
  for (const el of els) {
    const id = `${el.type}${el.id}`;
    if (!seen.has(id)) seen.add(id), data.elements.push(el);
  }
};
let left = 0;
const fetchTile = async (q) => {
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), headers: { 'User-Agent': 'BoardingPass-data-build (boardingpass.my)', Accept: 'application/json' }, signal: AbortSignal.timeout(185_000) });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
      const j = JSON.parse(text);
      if (j.remark && /timed out|out of memory|error/i.test(j.remark)) throw new Error(j.remark.slice(0, 120));
      return { els: j.elements, url };
    } catch (e) {
      log(`  ${url.split('/')[2]} failed: ${e.message.slice(0, 90)}`);
    }
  }
  return null;
};
const extrasWorld = state['extras (-90,-180,90,180)'];
const queue = [];
for (const bb of TOP) queue.push(['apron ways', bb]);
for (const bb of TOP) queue.push(['cargo buildings', bb]);
if (extrasWorld) take(extrasWorld);
else for (const [s, n] of [[-60, -20], [-20, 15], [15, 35], [35, 50], [50, 75]]) queue.push(['extras', [s, -180, n, 180]]);
while (queue.length) {
  const [kind, bb] = queue.shift();
  const k = key(kind, bb);
  if (state[k]) {
    take(state[k]);
    continue;
  }
  if (!hasAirport(bb)) continue;
  if (split.has(k)) {
    queue.unshift(...quarters(bb).map((b) => [kind, b]));
    continue;
  }
  if (Date.now() - startedAt > 70 * 60_000) {
    left++;
    continue;
  }
  const got = await fetchTile(KINDS[kind](`(${bb.join(',')})`));
  if (got) {
    state[k] = got.els;
    take(got.els);
    log(`${k}: ${got.els.length} from ${got.url.split('/')[2]}`);
  } else if (bb[2] - bb[0] > 2.5 && bb[3] - bb[1] > 2.5) {
    split.add(k);
    log(`${k}: too big for the servers, splitting it in four`);
    queue.unshift(...quarters(bb).map((b) => [kind, b]));
  } else {
    left++;
    log(`${k}: GAVE UP (try again next run)`);
  }
  save();
  await new Promise((r) => setTimeout(r, 1500));
}
save();
if (!data.elements.length) process.exit(1);

const r5 = (x) => Math.round(x * 1e5) / 1e5;
const km = (a, b) => {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
// Nearest airport within 8 km (a coarse grid keeps it quick)
const grid = new Map();
for (const a of airports) {
  const k = `${Math.floor(a.lat)}:${Math.floor(a.lon)}`;
  (grid.get(k) ?? grid.set(k, []).get(k)).push(a);
}
const nearest = (p) => {
  let best = null;
  let bestKm = 8;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      for (const a of grid.get(`${Math.floor(p.lat) + dy}:${Math.floor(p.lon) + dx}`) ?? []) {
        const d = km(p, a);
        if (d < bestKm) [best, bestKm] = [a, d];
      }
  return best;
};
// Keeps rings small: at most 48 points
const thin = (ring) => {
  const step = Math.max(1, Math.ceil(ring.length / 48));
  const out = ring.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== ring[ring.length - 1]) out.push(ring[ring.length - 1]);
  return out.map((q) => [r5(q.lon), r5(q.lat)]);
};

const out = {};
const add = (iata) => (out[iata] ??= { a: [], b: [], p: [] });
for (const el of data.elements) {
  if (el.type === 'node') {
    const ap = nearest(el);
    if (ap) add(ap.iata).p.push([r5(el.lon), r5(el.lat)]);
    continue;
  }
  const rings = el.type === 'way' ? [el.geometry] : (el.members ?? []).filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry);
  for (const ring of rings) {
    if (!ring || ring.length < 4) continue;
    const c = { lat: ring.reduce((s, q) => s + q.lat, 0) / ring.length, lon: ring.reduce((s, q) => s + q.lon, 0) / ring.length };
    const ap = nearest(c);
    if (ap) add(ap.iata)[el.type === 'way' && el.tags?.aeroway !== 'apron' ? 'b' : 'a'].push(thin(ring));
  }
}
for (const k of Object.keys(out)) for (const f of ['b', 'p']) if (!out[k][f].length) delete out[k][f];
const file = resolve(root, 'public/data/cargo-aprons.json');
writeFileSync(file, JSON.stringify({ v: 1, built: new Date().toISOString().slice(0, 10), source: '© OpenStreetMap contributors (ODbL)', airports: out }));
const n = Object.keys(out).length;
log(`tiles left: ${left}${left ? "" : " (all done)"}`);
log(`cargo-aprons.json: ${n} airports, ${Object.values(out).reduce((s, x) => s + x.a.length, 0)} aprons, ${Object.values(out).reduce((s, x) => s + (x.b?.length ?? 0), 0)} buildings, ${Object.values(out).reduce((s, x) => s + (x.p?.length ?? 0), 0)} stands, ${(JSON.stringify(out).length / 1024).toFixed(0)} kB`);
