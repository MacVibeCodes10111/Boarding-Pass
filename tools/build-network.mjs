#!/usr/bin/env node
// ============================================================================
// build-network.mjs: makes public/data/network.json, the real-world airline
// network the game uses for route demand and for other airlines' flights.
//
//   node tools/build-network.mjs [routes.json] [cities] [airports.csv] [countries.json]
//
//   routes.json   airline_routes.json from github.com/Jonty/airline-route-data
//                 (updated weekly). Default: downloaded from GitHub.
//   cities        GeoNames cities with population: cities5000.txt (from
//                 download.geonames.org/export/dump/cities5000.zip) or the
//                 cities5000.json of the geonamescache package. CC BY 4.0.
//   airports.csv  OurAirports airports (default public/data/airports.csv).
//   countries.json  GeoNames countries (neighbours); geonamescache's
//                 countries.json, or countryInfo.txt from GeoNames.
//
// What goes into network.json:
//   airports  every airport with scheduled airline routes, plus every
//             airport the game already lists: code, name, city, country,
//             region, position, elevation, time zone, how many airline
//             routes leave it (the airport's size in the network) and the
//             population living around it (thousands).
//   carriers  airline code and name.
//   routes    origin, destination, km, minutes and the airlines flying it.
//   neighbours  which countries share a land border (water crossings).
// ============================================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [routesArg, citiesArg, airportsArg, countriesArg] = process.argv.slice(2);
const ROUTES_URL = 'https://raw.githubusercontent.com/Jonty/airline-route-data/main/airline_routes.json';

const routesJson = routesArg ? JSON.parse(readFileSync(routesArg, 'utf8')) : await (await fetch(ROUTES_URL)).json();
if (!citiesArg) throw new Error('Pass a GeoNames cities file (cities5000.txt or cities5000.json) as the second argument.');

// ---------------------------------------------------------------------------
// CSV (OurAirports)
// ---------------------------------------------------------------------------
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
const oa = parseCsv(readFileSync(airportsArg ?? resolve(root, 'public/data/airports.csv'), 'utf8'));
const oaByIata = new Map();
for (const r of oa) if (r.iata_code && !oaByIata.has(r.iata_code)) oaByIata.set(r.iata_code, r);

// The airports the game lists already (OurAirports large/medium with scheduled service)
const gameSet = new Set(oa.filter((r) => r.scheduled_service === 'yes' && (r.type === 'large_airport' || r.type === 'medium_airport') && r.iata_code).map((r) => r.iata_code));

// ---------------------------------------------------------------------------
// Airports and routes
// ---------------------------------------------------------------------------
const airports = new Map();
const add = (iata, info) => {
  if (!airports.has(iata)) airports.set(iata, { iata, ...info, routes: 0, popK: 0 });
};
for (const [iata, v] of Object.entries(routesJson)) {
  const lat = Number(v.latitude);
  const lon = Number(v.longitude);
  if (!/^[A-Z0-9]{3}$/.test(iata) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  const o = oaByIata.get(iata);
  add(iata, {
    name: (v.name || o?.name || iata).trim(),
    city: (v.city_name || o?.municipality || '').trim(),
    cc: v.country_code || o?.iso_country || '',
    region: o?.iso_region || '',
    lat,
    lon,
    elev: Number(v.elevation ?? o?.elevation_ft ?? 0) || 0,
    tz: v.timezone || '',
  });
}
for (const iata of gameSet) {
  const o = oaByIata.get(iata);
  add(iata, { name: o.name, city: o.municipality, cc: o.iso_country, region: o.iso_region, lat: Number(o.latitude_deg), lon: Number(o.longitude_deg), elev: Number(o.elevation_ft) || 0, tz: '' });
}

const carriers = new Map();
const carrierIdx = (c) => {
  const key = `${c.iata}|${c.name}`;
  if (!carriers.has(key)) carriers.set(key, { i: carriers.size, iata: c.iata, name: c.name });
  return carriers.get(key).i;
};
const routes = [];
for (const [o, v] of Object.entries(routesJson)) {
  if (!airports.has(o)) continue;
  for (const r of v.routes) {
    if (!airports.has(r.iata) || r.iata === o) continue;
    const cs = (r.carriers || []).filter((c) => c && c.iata).map(carrierIdx);
    routes.push({ o, d: r.iata, km: r.km, min: r.min, cs });
    airports.get(o).routes += cs.length;
  }
}

// ---------------------------------------------------------------------------
// Population around each airport (GeoNames). Each town's people are shared
// between the airline airports within 120 km in the same country, nearer and
// busier airports getting more; a town with none goes to the nearest within
// 300 km. Airports without airline routes get a share of the towns within
// 40 km on top (people who would fly from there if someone started a route).
// ---------------------------------------------------------------------------
function readCities(path) {
  const text = readFileSync(path, 'utf8');
  if (path.endsWith('.json')) return Object.values(JSON.parse(text)).map((c) => ({ lat: c.latitude, lon: c.longitude, cc: c.countrycode, pop: c.population }));
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'))
    .map((c) => ({ lat: Number(c[4]), lon: Number(c[5]), cc: c[8], pop: Number(c[14]) }));
}
const RAD = Math.PI / 180;
const km = (a, b) => {
  const h = Math.sin(((b.lat - a.lat) * RAD) / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(((b.lon - a.lon) * RAD) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
};
const grid = new Map();
for (const a of airports.values()) {
  const k = `${Math.floor(a.lat)}|${Math.floor(a.lon)}`;
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(a);
}
const near = (p, radiusKm, served = true) => {
  const out = [];
  const r = Math.ceil(radiusKm / 100) + 1;
  for (let i = -r; i <= r; i++)
    for (let j = -r; j <= r; j++)
      for (const a of grid.get(`${Math.floor(p.lat) + i}|${Math.floor(p.lon) + j}`) ?? []) {
        const d = km(a, p);
        if (d <= radiusKm && a.cc === p.cc && (a.routes > 0) === served) out.push([d, a]);
      }
  return out;
};
for (const c of readCities(citiesArg)) {
  if (!(c.pop >= 5000)) continue;
  let cand = near(c, 120);
  let pop = c.pop;
  if (!cand.length) {
    cand = near(c, 300);
    if (!cand.length) continue;
    cand = [cand.reduce((m, x) => (x[0] < m[0] ? x : m))];
    pop *= 0.6;
  }
  const w = cand.map(([d, a]) => (a.routes + 2) / (1 + (d / 35) ** 2));
  const tw = w.reduce((s, x) => s + x, 0);
  cand.forEach(([, a], i) => (a.popK += (pop * w[i]) / tw / 1000));
}
for (const c of readCities(citiesArg)) {
  if (!(c.pop >= 5000)) continue;
  const cand = near(c, 40, false);
  for (const [d, a] of cand) a.popK += (c.pop * 0.3) / (1 + (d / 20) ** 2) / cand.length / 1000;
}

// ---------------------------------------------------------------------------
// Neighbouring countries
// ---------------------------------------------------------------------------
const neighbours = {};
if (countriesArg) {
  const text = readFileSync(countriesArg, 'utf8');
  if (countriesArg.endsWith('.json')) for (const [cc, v] of Object.entries(JSON.parse(text))) neighbours[cc] = v.neighbours || '';
  else
    for (const l of text.split('\n'))
      if (l && !l.startsWith('#')) {
        const c = l.split('\t');
        neighbours[c[0]] = c[17] || '';
      }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------
const list = [...airports.values()].sort((a, b) => a.iata.localeCompare(b.iata));
const index = new Map(list.map((a, i) => [a.iata, i]));
const out = {
  v: 1,
  built: new Date().toISOString().slice(0, 10),
  sources: {
    routes: 'airline-route-data by Jonty Wareing (github.com/Jonty/airline-route-data), from airlines’ published routes',
    population: 'GeoNames (geonames.org), CC BY 4.0',
    airports: 'OurAirports (ourairports.com), public domain',
  },
  airports: list.map((a) => [a.iata, a.name, a.city, a.cc, a.region, +a.lat.toFixed(4), +a.lon.toFixed(4), Math.round(a.elev), a.tz, a.routes, Math.round(a.popK)]),
  carriers: [...carriers.values()].sort((a, b) => a.i - b.i).map((c) => [c.iata, c.name]),
  routes: routes.map((r) => [index.get(r.o), index.get(r.d), r.km, r.min, ...r.cs]),
  neighbours,
};
const file = resolve(root, 'public/data/network.json');
writeFileSync(file, JSON.stringify(out));
console.log(`network.json: ${list.length} airports (${list.filter((a) => a.routes > 0).length} with routes), ${out.carriers.length} airlines, ${routes.length} routes, ${(JSON.stringify(out).length / 1e6).toFixed(2)} MB`);
