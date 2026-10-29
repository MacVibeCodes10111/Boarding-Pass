#!/usr/bin/env node
// build-cargo-aprons.mjs: makes public/data/cargo-aprons.json, the cargo
// aprons and cargo stands at the game's airports, from OpenStreetMap
// (© OpenStreetMap contributors, ODbL), so freighters park on cargo ramps.
//
// Run where OpenStreetMap's Overpass API can be reached (the "Cargo data"
// GitHub workflow does this): node tools/build-cargo-aprons.mjs
//
// Output: { "v": 1, "built": "...", "airports": { "MEM": { "a": [polygon…], "p": [[lon,lat]…] } } }
//   a: cargo apron outlines (lon/lat rings, 5 decimals), p: single cargo stands
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
// Three smaller queries (busy servers turn away one big one)
const QUERIES = {
  'apron ways': `[out:json][timeout:600];(way["aeroway"="apron"]["apron"~"cargo|freight",i];way["aeroway"="apron"]["usage"~"cargo|freight",i];way["aeroway"="apron"]["name"~"${WORDS}",i];);out geom;`,
  'apron relations': `[out:json][timeout:600];(relation["aeroway"="apron"]["apron"~"cargo|freight",i];relation["aeroway"="apron"]["name"~"${WORDS}",i];);out geom;`,
  'cargo stands': `[out:json][timeout:600];(node["aeroway"="parking_position"]["name"~"${WORDS}",i];node["aeroway"="parking_position"]["usage"~"cargo|freight",i];);out;`,
};
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const data = { elements: [] };
for (const [what, q] of Object.entries(QUERIES)) {
  let ok = false;
  for (let attempt = 0; attempt < 2 && !ok; attempt++)
    for (const url of MIRRORS) {
      try {
        const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), headers: { 'User-Agent': 'BoardingPass-data-build (boardingpass.my)', Accept: 'application/json' }, signal: AbortSignal.timeout(660_000) });
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 200).replace(/\s+/g, ' ')}`);
        const j = JSON.parse(text);
        if (j.remark) log(`  remark: ${j.remark}`);
        data.elements.push(...j.elements);
        log(`${what}: ${j.elements.length} from ${url}`);
        ok = true;
        break;
      } catch (e) {
        log(`${what}: ${url} failed: ${e.message}`);
      }
    }
  if (!ok) log(`${what}: GAVE UP`);
}
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
const add = (iata) => (out[iata] ??= { a: [], p: [] });
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
    if (ap) add(ap.iata).a.push(thin(ring));
  }
}
for (const k of Object.keys(out)) if (!out[k].p.length) delete out[k].p;
const file = resolve(root, 'public/data/cargo-aprons.json');
writeFileSync(file, JSON.stringify({ v: 1, built: new Date().toISOString().slice(0, 10), source: '© OpenStreetMap contributors (ODbL)', airports: out }));
const n = Object.keys(out).length;
log(`cargo-aprons.json: ${n} airports, ${Object.values(out).reduce((s, x) => s + x.a.length, 0)} aprons, ${Object.values(out).reduce((s, x) => s + (x.p?.length ?? 0), 0)} stands, ${(JSON.stringify(out).length / 1024).toFixed(0)} kB`);
