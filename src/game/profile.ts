// ============================================================================
// THE AIRLINE'S PROFILE (Update A, phase A1)
//   What a player's chosen career shares: name, codes, colours, liveries and a
//   small summary. Everything else in the save stays private. Logos join in A2;
//   until then their layers are left out. The server checks all of this again
//   (cloud/supabase/2026-11-05-profiles.sql), and anyone showing a profile must
//   put its liveries through normaliseLiveries first.
// ============================================================================
import { DEFAULT_AIRLINE_COLOURS, normaliseAirlineColours, normaliseLiveries, standardLivery, type Layer, type Livery } from './livery';
import { MIN_PER_WEEK } from './time';
import type { SaveGameState } from './types';

/** Stays under the server's limit (128,000 bytes). */
export const MAX_LIVERY_CHARS = 120_000;

export interface ProfileStats {
  fleet: number;
  routes: number;
  airports: number;
  hubs: number;
  weeks: number;
  /** When the airline started (YYYY-MM-DD), if its save says. */
  founded?: string;
}
export interface Profile {
  saveId: string;
  airline: string;
  code: string;
  callsign: string;
  colours: { a: string; b: string };
  liveries: unknown[];
  stats: ProfileStats;
}

const round = (x: unknown): unknown => {
  if (typeof x === 'number') return Math.round(x * 1000) / 1000;
  if (Array.isArray(x)) return x.map(round);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined).map(([k, v]) => [k, round(v)]));
  return x;
};

/** A layer as shared: visible ones only, without editor details like its name or id, rounded to keep it small. */
function compactLayer(l: Layer): unknown | null {
  if (l.hidden || l.kind === 'logo') return null;
  const { id: _id, name: _name, locked: _locked, hidden: _hidden, ...rest } = l;
  return round(rest);
}

function compactLivery(l: Livery, withPaint: boolean) {
  const layers = l.layers.filter((x) => withPaint || x.kind !== 'paint').map(compactLayer).filter(Boolean);
  return { v: 2, ...(l.name ? { name: l.name } : {}), layers };
}

function summary(s: SaveGameState): ProfileStats {
  const pairs = new Set<string>();
  const airports = new Set<string>();
  for (const f of s.schedule ?? []) {
    const a = f.origin?.iata_code, b = f.destination?.iata_code;
    if (!a || !b) continue;
    pairs.add([a, b].sort().join('-'));
    airports.add(a);
    airports.add(b);
  }
  const started = /^SAVE-(\d{13})$/.exec(s.saveId)?.[1];
  const founded = started ? new Date(Number(started)).toISOString().slice(0, 10) : undefined;
  return {
    fleet: s.fleet?.length ?? 0,
    routes: pairs.size,
    airports: airports.size,
    hubs: s.hubs?.length || 1,
    weeks: Math.floor((s.econMin ?? 0) / MIN_PER_WEEK) + 1,
    ...(founded ? { founded } : {}),
  };
}

/** The profile of a career. Brush-painted layers are dropped if the liveries would be too big to share. */
export function buildProfile(s: SaveGameState): Profile {
  const colours = normaliseAirlineColours(s.airlineColours) ?? DEFAULT_AIRLINE_COLOURS;
  const liveries = s.liveries === undefined && !s.livery ? [standardLivery(colours)] : normaliseLiveries(s.liveries, s.livery);
  const list = liveries.length ? liveries : [standardLivery(colours)];
  let out: unknown[] = list.map((l) => compactLivery(l, true));
  if (JSON.stringify(out).length > MAX_LIVERY_CHARS) out = list.map((l) => compactLivery(l, false));
  return {
    saveId: s.saveId,
    airline: s.airlineName.trim(),
    code: (s.airlineIata ?? '').toUpperCase(),
    callsign: s.airlineCallsign ?? '',
    colours: { a: colours.a, b: colours.b },
    liveries: out,
    stats: summary(s),
  };
}

/** Changes when anything shared changes, so an unchanged airline isn't sent again. */
export function profileKey(p: Profile): string {
  const s = JSON.stringify(p);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `${(h >>> 0).toString(36)}-${s.length}`;
}
