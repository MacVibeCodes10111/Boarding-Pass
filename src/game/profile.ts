// ============================================================================
// THE AIRLINE'S PROFILE (Update A, phases A1 and A2)
//   What a player's chosen career shares: name, codes, colours, liveries and a
//   small summary. Everything else in the save stays private. Logos are shared
//   by name (the hash of the picture); the pictures themselves go through the
//   Worker in cloud/logos-worker, and other players only get them once approved.
//   The server checks all of this again (cloud/supabase/), and anyone showing a
//   profile must use liveryFromProfile, which puts it through normaliseLivery.
// ============================================================================
import { DEFAULT_AIRLINE_COLOURS, normaliseAirlineColours, normaliseLiveries, normaliseLivery, normaliseLogo, standardLivery, type Layer, type Livery } from './livery';
import { sha256Hex } from './sha256';
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
/** Career and Sandbox airlines never meet online. An edited save plays as Sandbox, so it's shared as one. */
export type OnlineMode = 'career' | 'sandbox';
export const onlineModeOf = (s: Pick<SaveGameState, 'gameMode'>): OnlineMode => (s.gameMode === 'sandbox' ? 'sandbox' : 'career');

export interface Profile {
  saveId: string;
  mode: OnlineMode;
  airline: string;
  code: string;
  callsign: string;
  colours: { a: string; b: string };
  liveries: unknown[];
  stats: ProfileStats;
  /** The logos its liveries use: hash → picture, kept here to upload and never sent to Supabase. */
  logos: Record<string, string>;
}

const round = (x: unknown): unknown => {
  if (typeof x === 'number') return Math.round(x * 1000) / 1000;
  if (Array.isArray(x)) return x.map(round);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined).map(([k, v]) => [k, round(v)]));
  return x;
};

const hashes = new Map<string, string>();
/** The hash of a logo's picture (not of its data URL), the same one the Worker works out. Saves are written often, so it's remembered. */
export function logoHash(dataUrl: string): string {
  let h = hashes.get(dataUrl);
  if (!h) {
    h = sha256Hex(logoBytes(dataUrl));
    if (hashes.size > 50) hashes.clear();
    hashes.set(dataUrl, h);
  }
  return h;
}

/** The picture in a logo's data URL. */
export function logoBytes(dataUrl: string): Uint8Array {
  return Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));
}

/** A layer as shared: visible ones only, without editor details like its name or id, rounded to keep it small. */
function compactLayer(l: Layer, hashOf: (id: string) => string | undefined): unknown | null {
  if (l.hidden) return null;
  const { id: _id, name: _name, locked: _locked, hidden: _hidden, ...rest } = l;
  if (l.kind !== 'logo') return round(rest);
  const hash = hashOf(l.logo);
  return hash ? { ...(round(rest) as object), logo: hash } : null;
}

function compactLivery(l: Livery, withPaint: boolean, withLogos: boolean) {
  const hashOf = (id: string) => (withLogos && l.logos[id] ? logoHash(l.logos[id]) : undefined);
  const layers = l.layers.filter((x) => withPaint || x.kind !== 'paint').map((x) => compactLayer(x, hashOf)).filter(Boolean);
  const badge = l.badge ? hashOf(l.badge) : undefined;
  return { v: 2, ...(l.name ? { name: l.name } : {}), layers, ...(badge ? { badge } : {}) };
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

/** The profile of a career. Brush-painted layers are dropped if the liveries would be too big to share. Logos only join when they can be uploaded. */
export function buildProfile(s: SaveGameState, opts: { logos?: boolean } = {}): Profile {
  const colours = normaliseAirlineColours(s.airlineColours) ?? DEFAULT_AIRLINE_COLOURS;
  const liveries = s.liveries === undefined && !s.livery ? [standardLivery(colours)] : normaliseLiveries(s.liveries, s.livery);
  const list = liveries.length ? liveries : [standardLivery(colours)];
  const withLogos = opts.logos === true;
  let out: unknown[] = list.map((l) => compactLivery(l, true, withLogos));
  if (JSON.stringify(out).length > MAX_LIVERY_CHARS) out = list.map((l) => compactLivery(l, false, withLogos));

  const logos: Record<string, string> = {};
  if (withLogos) {
    const used = new Set<string>();
    for (const l of out as { layers: { logo?: string }[]; badge?: string }[]) {
      if (l.badge) used.add(l.badge);
      for (const x of l.layers) if (x.logo) used.add(x.logo);
    }
    for (const l of list) for (const url of Object.values(l.logos)) if (used.has(logoHash(url))) logos[logoHash(url)] = url;
  }
  return {
    saveId: s.saveId,
    mode: onlineModeOf(s),
    airline: s.airlineName.trim(),
    code: (s.airlineIata ?? '').toUpperCase(),
    callsign: s.airlineCallsign ?? '',
    colours: { a: colours.a, b: colours.b },
    liveries: out,
    stats: summary(s),
    logos,
  };
}

/** Changes when anything shared changes, so an unchanged airline isn't sent again. */
export function profileKey(p: Profile): string {
  const { logos: _logos, ...sent } = p;
  const s = JSON.stringify(sent);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `${(h >>> 0).toString(36)}-${s.length}`;
}

/**
 * A livery from another player's profile, ready to paint. `pictures` holds the
 * logos that could be fetched (hash → data URL). Anything else (waiting for
 * review, refused, not fetched yet) just isn't drawn. Null if it isn't a livery.
 */
export function liveryFromProfile(shared: unknown, pictures: Record<string, string>): Livery | null {
  if (!shared || typeof shared !== 'object') return null;
  const o = shared as { layers?: unknown; badge?: unknown };
  if (!Array.isArray(o.layers)) return null;
  const logos: Record<string, string> = {};
  const idFor = (hash: unknown) => {
    const url = typeof hash === 'string' ? normaliseLogo(pictures[hash]) : undefined;
    if (!url) return null;
    // A livery's logo ids are shorter than a hash
    const id = (hash as string).slice(0, 40);
    logos[id] = url;
    return id;
  };
  const layers = o.layers.filter((l) => (l as { kind?: unknown })?.kind !== 'logo' || idFor((l as { logo?: unknown }).logo) !== null).map((l, i) => {
    const x = l as { kind?: unknown; logo?: string };
    return { ...x, id: `s${i}`, ...(x.kind === 'logo' ? { logo: idFor(x.logo) } : {}) };
  });
  return normaliseLivery({ ...o, layers, logos, badge: idFor(o.badge) ?? undefined }) ?? null;
}
