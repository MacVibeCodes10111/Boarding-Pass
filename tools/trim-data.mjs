// ============================================================================
// Trims the built copies of airports.csv and runways.csv (dist/data/), after
// `vite build`. The game only ever keeps airports with a three-letter code that
// are large, medium or small airports (parseOurAirportsCsvFiles in
// src/game/csv.ts), so every other row (heliports, seaplane bases, closed and
// codeless fields: about 80% of the file) is dropped, with the runways of the
// airports that go. Rows stay in their order, so the game reads exactly the same
// airports (checked by src/game/trimData.test.ts). public/data/ is untouched.
// ============================================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** CSV records (a quoted field may hold commas, quotes and line breaks), each as its raw text and its fields. */
export function records(text) {
  const out = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const start = i;
    const fields = [];
    let field = '';
    let quoted = false;
    for (; i < n; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else quoted = false;
        } else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        fields.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') break;
      else field += ch;
    }
    fields.push(field);
    let end = i;
    if (text[i] === '\r') i++;
    if (text[i] === '\n') i++;
    out.push({ raw: text.slice(start, end), fields });
  }
  return out;
}

const KEEP_TYPES = new Set(['large_airport', 'medium_airport', 'small_airport']);

/** The trimmed airports and runways files. */
export function trim(airportsCsv, runwaysCsv) {
  const ap = records(airportsCsv);
  const head = ap[0].fields;
  const col = (name) => head.indexOf(name);
  const cType = col('type');
  const cIata = col('iata_code');
  const cId = col('id');
  if (cType < 0 || cIata < 0 || cId < 0) return null;
  const ids = new Set();
  const kept = [ap[0].raw];
  for (const r of ap.slice(1)) {
    if (!r.raw.trim()) continue;
    if (!KEEP_TYPES.has(r.fields[cType]) || !/^[A-Z0-9]{3}$/.test((r.fields[cIata] || '').trim().toUpperCase())) continue;
    kept.push(r.raw);
    ids.add(r.fields[cId]);
  }
  let runways = null;
  if (runwaysCsv) {
    const rw = records(runwaysCsv);
    const cRef = rw[0].fields.indexOf('airport_ref');
    if (cRef >= 0) {
      runways = [rw[0].raw, ...rw.slice(1).filter((r) => r.raw.trim() && ids.has(r.fields[cRef])).map((r) => r.raw)].join('\n') + '\n';
    }
  }
  return { airports: kept.join('\n') + '\n', runways };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? 'dist/data';
  const apPath = `${dir}/airports.csv`;
  const rwPath = `${dir}/runways.csv`;
  if (!existsSync(apPath)) {
    console.log('trim-data: no airports.csv, nothing to trim');
    process.exit(0);
  }
  const before = readFileSync(apPath, 'utf8');
  const rwBefore = existsSync(rwPath) ? readFileSync(rwPath, 'utf8') : undefined;
  const out = trim(before, rwBefore);
  if (!out) {
    console.log('trim-data: unexpected airports.csv columns, left as it is');
    process.exit(0);
  }
  writeFileSync(apPath, out.airports);
  if (out.runways && rwBefore) writeFileSync(rwPath, out.runways);
  const mb = (s) => (Buffer.byteLength(s) / 1e6).toFixed(1);
  console.log(`trim-data: airports.csv ${mb(before)} → ${mb(out.airports)} MB${out.runways && rwBefore ? `, runways.csv ${mb(rwBefore)} → ${mb(out.runways)} MB` : ''}`);
}
