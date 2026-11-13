// ============================================================================
// SUBSIDIARIES (2026-11): brands that fly part of the airline's fleet
//   Like American Eagle or Delta Connection (a regional brand) and Delta Cargo
//   (a cargo brand). One of each at most. They share the airline's money, bank
//   and credit line, and their flights keep the airline's flight numbers; each
//   has its own name, radio callsign and livery.
//   The regional brand pays its crews less (as real regional airlines do), but
//   flies only passenger aircraft up to A320 size (165 seats). The cargo brand
//   flies freighters only and costs the same.
// ============================================================================
import { normaliseLivery, type Livery } from './livery';
import { moderate } from './moderation';
import type { AircraftModel, BrandKind, PlayerAircraft, Subsidiary } from './types';

export const BRAND_KINDS: BrandKind[] = ['regional', 'cargo'];
/** The regional brand's biggest aircraft, in usual seats: an A320neo's (2026-11-13: E2s, A220s, A319s and A320-sized jets fly too). */
export const REGIONAL_MAX_SEATS = 165;
/** What the regional brand's crews cost, against the airline's own. */
export const REGIONAL_CREW_SHARE = 0.8;

export const BRAND_LABEL: Record<BrandKind, string> = { regional: 'Regional', cargo: 'Cargo' };
/** What it flies, in a few words. */
export const BRAND_RULE: Record<BrandKind, string> = {
  regional: `Passenger aircraft up to A320 size (${REGIONAL_MAX_SEATS} seats). Crews cost ${Math.round((1 - REGIONAL_CREW_SHARE) * 100)}% less.`,
  cargo: 'Freighters only.',
};

/** True when a subsidiary of this kind may fly the type. */
export function brandAllows(kind: BrandKind, m: Pick<AircraftModel, 'is_cargo' | 'category' | 'typical_seats'>): boolean {
  if (kind === 'cargo') return m.is_cargo;
  return !m.is_cargo && m.category !== 'widebody' && m.category !== 'heavy_widebody' && m.typical_seats <= REGIONAL_MAX_SEATS;
}

/** Why the type can't join the subsidiary, or null when it can. */
export function brandBlocker(kind: BrandKind, m: Pick<AircraftModel, 'name' | 'is_cargo' | 'category' | 'typical_seats'>): string | null {
  if (brandAllows(kind, m)) return null;
  if (kind === 'cargo') return `${m.name} is a passenger aircraft: the cargo brand flies freighters only.`;
  if (m.is_cargo) return `${m.name} is a freighter: the regional brand flies passenger aircraft.`;
  return `${m.name} is too big for the regional brand: it flies aircraft up to A320 size (${REGIONAL_MAX_SEATS} seats).`;
}

/** The share of the usual crew cost an aircraft pays (less in the regional brand). */
export const crewShareOf = (ac: Pick<PlayerAircraft, 'brand'>): number => (ac.brand === 'regional' ? REGIONAL_CREW_SHARE : 1);

/** A name to start from: "Northwind Connection", "Northwind Cargo". */
export function suggestedBrandName(kind: BrandKind, airlineName: string): string {
  const base = airlineName.trim().replace(/\s+(airlines?|airways|air lines|aviation)$/i, '') || airlineName.trim();
  return `${base} ${kind === 'cargo' ? 'Cargo' : 'Connection'}`.slice(0, 40);
}

export function suggestedBrandCallsign(kind: BrandKind, airlineCallsign: string): string {
  return (kind === 'cargo' ? `${airlineCallsign} CARGO` : `${airlineCallsign} CONNECT`).slice(0, 20);
}

/** Checks a subsidiary's name and callsign; returns the tidied pair or an error to show. */
export function checkBrandNames(nameRaw: string, callRaw: string): { name: string; callsign: string } | { error: string } {
  const name = nameRaw.trim().replace(/\s+/g, ' ');
  const callsign = callRaw.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!/^[\p{L}\p{N} .,'&-]{2,40}$/u.test(name)) return { error: 'The name needs 2 to 40 letters, digits, spaces or . , \' & -' };
  if (!/^[A-Z0-9 ]{2,20}$/.test(callsign)) return { error: 'The callsign needs 2 to 20 letters, digits or spaces.' };
  const bad = moderate(name) ?? moderate(callsign);
  return bad ? { error: bad } : { name, callsign };
}

/** Subsidiaries from saved data: one of each kind at most, with anything wrong dropped. */
export function normaliseSubsidiaries(raw: unknown): Subsidiary[] {
  if (!Array.isArray(raw)) return [];
  const out: Subsidiary[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const kind = o.kind;
    if ((kind !== 'regional' && kind !== 'cargo') || out.some((s) => s.kind === kind)) continue;
    const names = checkBrandNames(typeof o.name === 'string' ? o.name : '', typeof o.callsign === 'string' ? o.callsign : '');
    if ('error' in names) continue;
    const livery: Livery | undefined = normaliseLivery(o.livery);
    out.push({ kind, ...names, ...(livery ? { livery } : {}) });
  }
  return BRAND_KINDS.flatMap((k) => out.filter((s) => s.kind === k));
}

/** The fleet with brands that still make sense: the subsidiary exists and may fly the type. Same list when nothing changes. */
export function tidyFleetBrands<T extends Pick<PlayerAircraft, 'brand' | 'model'>>(fleet: T[], subs: Subsidiary[]): T[] {
  let changed = false;
  const out = fleet.map((a) => {
    if (a.brand === undefined) return a;
    if ((a.brand === 'regional' || a.brand === 'cargo') && subs.some((s) => s.kind === a.brand) && brandAllows(a.brand, a.model)) return a;
    changed = true;
    const { brand: _brand, ...rest } = a;
    return rest as T;
  });
  return changed ? out : fleet;
}

/** The brand an aircraft flies for, or undefined for the airline itself. */
export const subsidiaryOf = (ac: Pick<PlayerAircraft, 'brand'>, subs: Subsidiary[]): Subsidiary | undefined =>
  ac.brand ? subs.find((s) => s.kind === ac.brand) : undefined;
