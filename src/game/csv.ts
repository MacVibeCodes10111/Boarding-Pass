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

    const leHdg = num(r[c.leHdg]) ?? headingFromRunwayIdent(leIdent) ?? 90;
    const heHdg = num(r[c.heHdg]) ?? headingFromRunwayIdent(heIdent) ?? (leHdg + 180) % 360;
    summary.pairs.push({
      le_ident: leIdent,
      he_ident: heIdent || '—',
      length_ft: lenFt,
      le_lat: leLat,
      le_lon: leLon,
      le_heading_degT: leHdg,
      he_lat: heLat,
      he_lon: heLon,
      he_heading_degT: heHdg,
    });
  }
  return byAirport;
}

/**
 * Commercial airports only: scheduled service, large/medium, unique 3-letter
 * IATA code. Runway data (when supplied) sets runway count, length and layout.
 */
export function parseOurAirportsCsvFiles(airportsCsvText: string, runwaysCsvText?: string): Airport[] {
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
    if (
      r[c.sched] !== 'yes' ||
      (type !== 'large_airport' && type !== 'medium_airport') ||
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
    const rwy = runways.get(id);
    const rwyCount = rwy?.count || 1;
    const maxRwy = rwy?.maxLenFt || (isLarge ? 10000 : 7003);
    const demandWeight =
      Math.round(
        (isLarge ? 100 : 22) * (1 + 0.35 * (rwyCount - 1)) * Math.max(0.5, Math.min(1.6, maxRwy / 8000)) * 10
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
      type: isLarge ? 'large_airport' : 'medium_airport',
      latitude_deg: lat,
      longitude_deg: lon,
      elevation_ft: num(r[c.elev]) ?? 0,
      runway_count: rwyCount,
      max_runway_length_ft: maxRwy,
      demand_weight: demandWeight,
      hourly_slot_limit: rwyCount * (isLarge ? 28 : 14),
      runways: rwy && rwy.pairs.length > 0 ? rwy.pairs : undefined,
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
