// ============================================================================
// OURAIRPORTS CSV PARSERS (airports.csv + runways.csv + navaids.csv)
// ============================================================================
import type { Airport, NavaidWaypoint, RunwayEndPair } from './types';

/** RFC-4180 style line splitter: handles quoted commas and "" escapes. */
export function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

interface CsvTable {
  rows: string[][];
  col: (name: string) => number;
}

function readCsv(text: string): CsvTable {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const headers = splitCsvLine(lines[0] ?? '');
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]) rows.push(splitCsvLine(lines[i]));
  }
  return { rows, col: (name) => headers.indexOf(name) };
}

/** Number or null for empty / non-numeric cells (so "" never becomes 0). */
function num(cell: string | undefined): number | null {
  if (cell === undefined || cell.trim() === '') return null;
  const v = Number(cell);
  return Number.isFinite(v) ? v : null;
}

function headingFromRunwayIdent(ident: string): number | null {
  const m = (ident || '').trim().match(/^(\d{1,2})/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 36 ? n * 10 : null;
}

const D2R = Math.PI / 180;
/** Initial great-circle bearing from one point to another, degrees true. */
function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / D2R) + 360) % 360;
}
const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

interface RunwaySummary {
  count: number;
  maxLenFt: number;
  pairs: RunwayEndPair[];
}

function parseRunways(runwaysCsvText: string): Map<number, RunwaySummary> {
  const byAirport = new Map<number, RunwaySummary>();
  const t = readCsv(runwaysCsvText);
  const c = {
    apRef: t.col('airport_ref'),
    len: t.col('length_ft'),
    closed: t.col('closed'),
    leIdent: t.col('le_ident'),
    leLat: t.col('le_latitude_deg'),
    leLon: t.col('le_longitude_deg'),
    leHdg: t.col('le_heading_degT'),
    heIdent: t.col('he_ident'),
    heLat: t.col('he_latitude_deg'),
    heLon: t.col('he_longitude_deg'),
    heHdg: t.col('he_heading_degT'),
    leDisp: t.col('le_displaced_threshold_ft'),
    heDisp: t.col('he_displaced_threshold_ft'),
  };

  for (const r of t.rows) {
    if (r[c.closed] === '1') continue;
    const apRef = num(r[c.apRef]);
    const lenFt = num(r[c.len]) ?? 0;
    if (!apRef || lenFt < 1200) continue;

    const summary = byAirport.get(apRef) ?? { count: 0, maxLenFt: 0, pairs: [] };
    summary.count++;
    summary.maxLenFt = Math.max(summary.maxLenFt, lenFt);
    byAirport.set(apRef, summary);

    const leIdent = (r[c.leIdent] || '').trim();
    const heIdent = (r[c.heIdent] || '').trim();
    const leLat = num(r[c.leLat]);
    const leLon = num(r[c.leLon]);
    const heLat = num(r[c.heLat]);
    const heLon = num(r[c.heLon]);
    if (!leIdent || leLat === null || leLon === null || heLat === null || heLon === null) continue;
    if (summary.pairs.length >= 8) continue;

    const disp = (v: string | undefined) => {
      const d = num(v);
      return d && d > 0 && d < lenFt * 0.5 ? d : undefined;
    };
    summary.pairs.push(runwayPair(leIdent, heIdent, lenFt, leLat, leLon, heLat, heLon, num(r[c.leHdg]), disp(r[c.leDisp]), disp(r[c.heDisp])));
  }
  return byAirport;
}

/**
 * One runway from its two ends. Its direction comes from the ends: the listed
 * headings are often a few degrees out (and sometimes far out), which put
 * approaches and landing rolls beside the runway. Ends whose coordinates are
 * the wrong way round for the runway number (e.g. "18" pointing north) are
 * swapped back.
 */
function runwayPair(leIdent: string, heIdent: string, lenFt: number, leLat: number, leLon: number, heLat: number, heLon: number, listedHdg: number | null = null, leDisp?: number, heDisp?: number): RunwayEndPair {
  let ends = { leLat, leLon, heLat, heLon };
  let leHdg = bearingDeg(leLat, leLon, heLat, heLon);
  const identHdg = headingFromRunwayIdent(leIdent);
  if (identHdg !== null && angleDiff(leHdg, identHdg) > 90) {
    ends = { leLat: heLat, leLon: heLon, heLat: leLat, heLon: leLon };
    leHdg = (leHdg + 180) % 360;
  }
  if (!Number.isFinite(leHdg) || (ends.leLat === ends.heLat && ends.leLon === ends.heLon)) {
    leHdg = listedHdg ?? identHdg ?? 90;
  }
  const heHdg = (leHdg + 180) % 360;
  return {
    le_ident: leIdent,
    he_ident: heIdent || '—',
    length_ft: lenFt,
    le_lat: ends.leLat,
    le_lon: ends.leLon,
    le_heading_degT: Math.round(leHdg * 10) / 10,
    he_lat: ends.heLat,
    he_lon: ends.heLon,
    he_heading_degT: Math.round(heHdg * 10) / 10,
    le_displaced_ft: leDisp,
    he_displaced_ft: heDisp,
  };
}

const feetBetween = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const h = Math.sin(((lat2 - lat1) * D2R) / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(((lon2 - lon1) * D2R) / 2) ** 2;
  return (2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)))) / 0.3048;
};

/**
 * A runway whose two ends are much further apart than the runway is long has
 * one end in the wrong place (one in the data was 40 nm from its airport, so
 * landings rolled out across the countryside). The end nearer the airport is
 * kept and the other is put where the runway's number and length say it is.
 */
function repairRunway(p: RunwayEndPair, apLat: number, apLon: number): RunwayEndPair {
  const geoFt = feetBetween(p.le_lat, p.le_lon, p.he_lat, p.he_lon);
  if (!(p.length_ft > 0)) return p;
  if (geoFt < 300 && p.length_ft >= 1200) {
    // Both ends listed at the same spot: that spot is one end. The runway runs
    // from it whichever way puts its middle nearer the airport.
    const far = (h: number) => {
      const dNm = p.length_ft / 6076.12;
      return { lat: p.le_lat + (dNm / 60) * Math.cos(h * D2R), lon: p.le_lon + ((dNm / 60) * Math.sin(h * D2R)) / Math.max(0.05, Math.cos(p.le_lat * D2R)) };
    };
    const a = far(p.le_heading_degT);
    const b = far(p.he_heading_degT);
    const mid = (q: { lat: number; lon: number }) => feetBetween(apLat, apLon, (p.le_lat + q.lat) / 2, (p.le_lon + q.lon) / 2);
    return mid(a) <= mid(b)
      ? runwayPair(p.le_ident, p.he_ident, p.length_ft, p.le_lat, p.le_lon, a.lat, a.lon, null, p.le_displaced_ft, p.he_displaced_ft)
      : runwayPair(p.le_ident, p.he_ident, p.length_ft, b.lat, b.lon, p.le_lat, p.le_lon, null, p.le_displaced_ft, p.he_displaced_ft);
  }
  if (geoFt <= p.length_ft * 1.4) return p;
  const hdg = headingFromRunwayIdent(p.le_ident) ?? p.le_heading_degT;
  const leNear = feetBetween(apLat, apLon, p.le_lat, p.le_lon) <= feetBetween(apLat, apLon, p.he_lat, p.he_lon);
  const from = leNear ? { lat: p.le_lat, lon: p.le_lon, hdg } : { lat: p.he_lat, lon: p.he_lon, hdg: (hdg + 180) % 360 };
  const dNm = p.length_ft / 6076.12;
  const lat = from.lat + (dNm / 60) * Math.cos(from.hdg * D2R);
  const lon = from.lon + ((dNm / 60) * Math.sin(from.hdg * D2R)) / Math.max(0.05, Math.cos(from.lat * D2R));
  return leNear
    ? runwayPair(p.le_ident, p.he_ident, p.length_ft, p.le_lat, p.le_lon, lat, lon, null, p.le_displaced_ft, p.he_displaced_ft)
    : runwayPair(p.le_ident, p.he_ident, p.length_ft, lat, lon, p.he_lat, p.he_lon, null, p.le_displaced_ft, p.he_displaced_ft);
}

/**
 * Runways of airports that runways.csv lists without coordinates
 * (public/data/runways-extra.json, from OpenStreetMap by
 * tools/build-runways-extra.mjs), by IATA code. Anything not in the expected
 * shape is left out.
 */
export function parseRunwaysExtra(json: unknown): Map<string, RunwayEndPair[]> {
  const out = new Map<string, RunwayEndPair[]>();
  const airports = (json as { airports?: unknown } | null)?.airports;
  if (!airports || typeof airports !== 'object') return out;
  const ident = (v: unknown) => (typeof v === 'string' && /^\d{2}[LRC]?$/.test(v) ? v : null);
  const ok = (v: unknown, max: number) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max;
  for (const [iata, list] of Object.entries(airports as Record<string, unknown>)) {
    if (!/^[A-Z0-9]{3}$/.test(iata) || !Array.isArray(list)) continue;
    const pairs: RunwayEndPair[] = [];
    for (const r of list.slice(0, 8)) {
      if (!Array.isArray(r)) continue;
      const [le, he, len, leLat, leLon, heLat, heLon] = r as unknown[];
      const a = ident(le);
      const b = ident(he);
      if (!a || !b || !ok(len, 25000) || (len as number) < 1200 || !ok(leLat, 90) || !ok(heLat, 90) || !ok(leLon, 180) || !ok(heLon, 180)) continue;
      pairs.push(runwayPair(a, b, Math.round(len as number), leLat as number, leLon as number, heLat as number, heLon as number));
    }
    if (pairs.length) out.set(iata, pairs);
  }
  return out;
}

/**
 * Commercial airports only: scheduled service, large/medium, unique 3-letter
 * IATA code. Runway data (when supplied) sets runway count, length and layout.
 *
 * airlineAirports: IATA codes of airports that airlines fly to today (from
 * network.json). These are included even when OurAirports lists them as
 * small or without scheduled service (many island and Arctic airports), as
 * long as they are an airport with a runway (not a heliport or seaplane base)
 * and in the same place (IATA codes are sometimes reused).
 */
export function parseOurAirportsCsvFiles(
  airportsCsvText: string,
  runwaysCsvText?: string,
  airlineAirports?: ReadonlyMap<string, { lat: number; lon: number }>,
  /** Runways for airports that runways.csv has no coordinates for (parseRunwaysExtra). */
  extraRunways?: ReadonlyMap<string, RunwayEndPair[]>
): Airport[] {
  const runways = runwaysCsvText ? parseRunways(runwaysCsvText) : new Map<number, RunwaySummary>();
  const t = readCsv(airportsCsvText);
  const c = {
    id: t.col('id'),
    ident: t.col('ident'),
    type: t.col('type'),
    name: t.col('name'),
    lat: t.col('latitude_deg'),
    lon: t.col('longitude_deg'),
    elev: t.col('elevation_ft'),
    continent: t.col('continent'),
    country: t.col('iso_country'),
    muni: t.col('municipality'),
    sched: t.col('scheduled_service'),
    icao: t.col('icao_code'),
    gps: t.col('gps_code'),
    iata: t.col('iata_code'),
  };

  const parsed: Airport[] = [];
  const seenIata = new Set<string>();

  t.rows.forEach((r, i) => {
    const type = r[c.type];
    const iata = (r[c.iata] || '').trim().toUpperCase();
    const lat = num(r[c.lat]);
    const lon = num(r[c.lon]);
    const listed = r[c.sched] === 'yes' && (type === 'large_airport' || type === 'medium_airport');
    const known = airlineAirports?.get(iata);
    const airline =
      !!known &&
      lat !== null &&
      lon !== null &&
      Math.abs(known.lat - lat) < 0.25 &&
      Math.abs(known.lon - lon) * Math.cos(lat * D2R) < 0.25 &&
      (type === 'large_airport' || type === 'medium_airport' || type === 'small_airport');
    if (
      !(listed || airline) ||
      !/^[A-Z0-9]{3}$/.test(iata) ||
      seenIata.has(iata) ||
      lat === null ||
      lon === null
    ) {
      return;
    }
    seenIata.add(iata);

    const id = num(r[c.id]) ?? i + 1;
    const isLarge = type === 'large_airport';
    const isSmall = type === 'small_airport';
    const rwy = runways.get(id);
    // Real runways from the extra file when the main one has none with coordinates, and only
    // ones at this airport (a reused code somewhere else in the world must not bring its runways)
    const extra = rwy?.pairs.length ? undefined : extraRunways?.get(iata)?.filter((p) => feetBetween(lat, lon, p.le_lat, p.le_lon) < 40000 && feetBetween(lat, lon, p.he_lat, p.he_lon) < 40000);
    const pairs = rwy?.pairs.length ? rwy.pairs.map((p) => repairRunway(p, lat, lon)) : extra?.length ? extra : undefined;
    const rwyCount = rwy?.count || extra?.length || 1;
    const maxRwy = rwy?.maxLenFt || (extra?.length ? Math.max(...extra.map((p) => p.length_ft)) : 0) || (isLarge ? 10000 : isSmall ? 4000 : 7003);
    // A first guess from size and runways; network.json replaces it with real traffic
    const demandWeight =
      Math.round(
        (isLarge ? 100 : isSmall ? 10 : 22) * (1 + 0.35 * (rwyCount - 1)) * Math.max(0.5, Math.min(1.6, maxRwy / 8000)) * 10
      ) / 10;
    const name = r[c.name] || iata;

    parsed.push({
      id,
      iata_code: iata,
      icao_code: (r[c.icao] || r[c.gps] || r[c.ident] || iata).trim().toUpperCase(),
      name,
      municipality: r[c.muni] || name,
      iso_country: r[c.country] || 'US',
      country_name: r[c.country] || 'US',
      continent: r[c.continent] || 'NA',
      type: isLarge ? 'large_airport' : isSmall ? 'small_airport' : 'medium_airport',
      latitude_deg: lat,
      longitude_deg: lon,
      elevation_ft: num(r[c.elev]) ?? 0,
      runway_count: rwyCount,
      max_runway_length_ft: maxRwy,
      demand_weight: demandWeight,
      hourly_slot_limit: rwyCount * (isLarge ? 28 : isSmall ? 8 : 14),
      runways: pairs,
    });
  });

  return parsed.sort((a, b) => a.iata_code.localeCompare(b.iata_code));
}

export function parseOurAirportsNavaidsCsv(navaidsCsvText: string): NavaidWaypoint[] {
  const t = readCsv(navaidsCsvText);
  const c = {
    id: t.col('id'),
    ident: t.col('ident'),
    name: t.col('name'),
    type: t.col('type'),
    freq: t.col('frequency_khz'),
    lat: t.col('latitude_deg'),
    lon: t.col('longitude_deg'),
    assoc: t.col('associated_airport'),
  };

  const navaids: NavaidWaypoint[] = [];
  t.rows.forEach((r, i) => {
    const ident = (r[c.ident] || '').trim().toUpperCase();
    const lat = num(r[c.lat]);
    const lon = num(r[c.lon]);
    if (!ident || lat === null || lon === null || (lat === 0 && lon === 0)) return;
    navaids.push({
      id: num(r[c.id]) ?? i + 1,
      ident,
      name: r[c.name] || ident,
      type: r[c.type] || 'VOR',
      frequency_khz: num(r[c.freq]) ?? 0,
      latitude_deg: lat,
      longitude_deg: lon,
      associated_airport: (r[c.assoc] || '').trim().toUpperCase(),
    });
  });
  return navaids;
}
