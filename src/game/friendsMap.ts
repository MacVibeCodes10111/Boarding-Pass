// ============================================================================
// FRIENDS' AIRCRAFT ON THE MAP (Update A, phase A4)
//   Friends' weekly schedules (scheduleSnapshot.ts) are joined onto the other
//   airlines' traffic, so the map moves, draws and opens them with the code it
//   already has, in 2D and 3D. Each viewer flies them on their own clock.
//
//   Other airlines' flights don't need taking off the map for a friend's: they're a
//   different airline, like any two airlines on one route. Friends' flights don't
//   hold other traffic back on the runways either, and yours don't wait for theirs.
//
//   Friends are an airline's: the map shows the friends of the career being played,
//   if it's shared (setFriendsMapAirline).
//
//   Kept in memory only: nothing of a friend's is saved on this device, so removing
//   a friend, blocking or a friend turning this off ends at the next refresh.
// ============================================================================
import { AIRCRAFT_BY_ID } from './aircraftCatalog';
import { EARTH_NM, angleBetween, toVec, type AiAirport, type AiFlight, type AiTraffic } from './aiTraffic';
import { fetchFriendSchedules, fetchSharedLogo, cloudRpc, onForgetOnline } from './cloud';
import { getRadarIconGroup } from './icons';
import { liveryFromProfile } from './profile';
import { checkSnapshot, type ScheduleSnapshot } from './scheduleSnapshot';
import { normaliseAllianceBadge, type AllianceBadge } from './friends';
import type { Livery } from './livery';
import type { Airport } from './types';

export interface FriendOnMap {
  id: string;
  airline: string;
  code: string;
  callsign: string;
  colours: { a: string; b: string };
  updatedAt: string;
  version: number;
  snapshot: ScheduleSnapshot;
  /** In the viewer's alliance. */
  ally: boolean;
  /** The alliance they're in, if any. */
  alliance: AllianceBadge | null;
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
/** 20 friends, and up to 19 others from the airline's alliance. */
const MAX_FRIENDS_ON_MAP = 40;

/**
 * The next list from the Worker's answer. A friend missing from the answer has gone from the
 * map; one without a snapshot hasn't changed, so what's already here stays. Nothing in the
 * answer is trusted: a bad entry is left out and the rest still show.
 */
export function mergeFriendAnswer(prev: readonly FriendOnMap[], answer: unknown): FriendOnMap[] {
  const raw = (answer as { airlines?: unknown } | null)?.airlines;
  if (!Array.isArray(raw)) return [...prev];
  const had = new Map(prev.map((f) => [f.id, f]));
  const out: FriendOnMap[] = [];
  for (const x of raw.slice(0, MAX_FRIENDS_ON_MAP)) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    if (typeof o.id !== 'string' || !ID.test(o.id) || typeof o.airline !== 'string' || !o.airline) continue;
    const version = typeof o.version === 'number' ? o.version : 0;
    const old = had.get(o.id);
    // The Worker has already checked the words, so that isn't done again on every friend's device
    const fresh = 'snapshot' in o ? checkSnapshot(o.snapshot, false) : null;
    const snapshot = fresh ?? (old?.version === version ? old.snapshot : null);
    if (!snapshot) continue;
    const col = (o.colours ?? {}) as Record<string, unknown>;
    out.push({
      id: o.id,
      airline: o.airline.slice(0, 40),
      code: typeof o.code === 'string' ? o.code.slice(0, 3) : '',
      callsign: typeof o.callsign === 'string' ? o.callsign.slice(0, 30) : '',
      colours: { a: HEX.test(String(col.a)) ? String(col.a) : '#475569', b: HEX.test(String(col.b)) ? String(col.b) : '#94a3b8' },
      updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
      version,
      snapshot,
      ally: o.ally === true,
      alliance: normaliseAllianceBadge(o.alliance),
    });
  }
  return out;
}

/**
 * The other airlines' traffic with these friends' flights added on the end. Flights keep their
 * ids (an id is its place in the list), so nothing already on the map changes. Flights to an
 * airport this game doesn't know are left out.
 */
export function withFriends(base: AiTraffic, friends: readonly FriendOnMap[], gameAirports: ReadonlyMap<string, Airport>): AiTraffic {
  if (!friends.length) return base;
  const airlines = [...base.airlines];
  const airports = [...base.airports];
  const flights = [...base.flights];
  const typeNames = new Map(base.typeNames);
  const airportAt = new Map(base.airports.map((a, i) => [a.iata, i]));
  const placeOf = (iata: string): number | undefined => {
    const known = airportAt.get(iata);
    if (known !== undefined) return known;
    const a = gameAirports.get(iata);
    if (!a) return undefined;
    const lat = a.latitude_deg;
    const lon = a.longitude_deg;
    const added: AiAirport = { iata, name: a.name, city: a.municipality, country: a.country_name, lat, lon, elevFt: a.elevation_ft, tz: 'UTC', tzHours: 0, v: toVec(lat, lon) };
    airportAt.set(iata, airports.length);
    airports.push(added);
    return airports.length - 1;
  };
  for (const fr of friends) {
    const airline = airlines.length;
    // A code no real airline has, so a friend can't end up in the list of airlines you've hidden
    airlines.push({ code: `~${fr.id}`, name: fr.airline, callsign: fr.callsign || fr.airline, region: 'EU' });
    for (const [od, dd, dep, block, days, mi, ri, no, livery] of fr.snapshot.flights) {
      const o = placeOf(od);
      const d = placeOf(dd);
      if (o === undefined || d === undefined || o === d) continue;
      const modelId = fr.snapshot.models[mi];
      const reg = fr.snapshot.regs[ri];
      const model = AIRCRAFT_BY_ID.get(modelId);
      if (model) typeNames.set(modelId, model.name);
      const distanceNm = Math.round(angleBetween(airports[o].v, airports[d].v) * EARTH_NM);
      const f: AiFlight = {
        id: flights.length,
        airline,
        flightNumber: no || reg,
        o,
        d,
        depUtcMin: dep,
        blockMin: block,
        daysMask: days,
        typeCode: modelId,
        group: getRadarIconGroup(model),
        // A newer game's aircraft isn't in this one's list yet: its speed comes from the flight itself
        cruiseKts: model?.cruise_speed_kts ?? Math.max(120, Math.round(distanceNm / Math.max(0.5, block / 60))),
        distanceNm,
        friend: { owner: fr.id, reg, modelId, livery },
      };
      flights.push(f);
    }
  }
  return { ...base, airlines, airports, flights, typeNames, friendsFrom: base.flights.length };
}

// ---------------------------------------------------------------------------
// Keeping the list up to date
// ---------------------------------------------------------------------------
let shown: FriendOnMap[] = [];
const listeners = new Set<() => void>();
const pictures = new Map<string, Promise<{ updatedAt: string; liveries: (Livery | null)[] } | null>>();

export const friendsOnMap = () => shown;

export function onFriendsMapChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setShown(next: FriendOnMap[]) {
  const same = next.length === shown.length && next.every((f, i) => f.id === shown[i].id && f.version === shown[i].version && f.airline === shown[i].airline && f.callsign === shown[i].callsign && f.ally === shown[i].ally && f.alliance?.tag === shown[i].alliance?.tag);
  shown = next;
  if (!same) for (const fn of listeners) fn();
}

/** The map is showing friends. While it isn't, nothing is asked for. */
let wanted = false;
export function wantFriendsMap(on: boolean) {
  wanted = on;
  if (!on) clearFriendsMap();
}

/** Whose friends: the shared airline of the career being played, or null. */
let viewer: string | null = null;
export function setFriendsMapAirline(airline: string | null) {
  if (airline === viewer) return;
  viewer = airline;
  clearFriendsMap();
}

/** Asks who's on the map now. If that can't be answered, what's showing stays until it can. */
export async function refreshFriendsMap(): Promise<void> {
  const me = viewer;
  if (!wanted || !me) return;
  const known = Object.fromEntries(shown.map((f) => [f.id, f.version]));
  const answer = await fetchFriendSchedules(me, known);
  // Still the same airline: a career switch while asking would mix two airlines' friends
  if (answer && wanted && viewer === me) setShown(mergeFriendAnswer(shown, answer));
}

/** Takes everything off the map (the layer was turned off, or the feature is off). */
export function clearFriendsMap() {
  setShown([]);
  pictures.clear();
}
onForgetOnline(clearFriendsMap);

/** A friend's livery for the pop-up. Only fetched when one is opened, then kept while the map shows that version of their airline. */
export async function friendLivery(owner: string, index: number): Promise<Livery | null> {
  const fr = shown.find((f) => f.id === owner);
  if (!fr) return null;
  const key = `${owner}|${fr.updatedAt}`;
  let got = pictures.get(key);
  if (!got) {
    got = loadLiveries(owner);
    pictures.set(key, got);
  }
  const r = await got;
  return r?.liveries[index] ?? r?.liveries[0] ?? null;
}

/** All of a friend's liveries (main, then special if they have one). Empty if they can't be fetched. */
export async function friendLiveries(owner: string): Promise<Livery[]> {
  const fr = shown.find((f) => f.id === owner);
  if (!fr) return [];
  const key = `${owner}|${fr.updatedAt}`;
  let got = pictures.get(key);
  if (!got) {
    got = loadLiveries(owner);
    pictures.set(key, got);
  }
  const r = await got;
  return (r?.liveries ?? []).filter((l): l is Livery => l !== null);
}

/** The shared airline of the career being played, if it's shared. */
export const friendsMapViewer = () => viewer;

async function loadLiveries(owner: string) {
  try {
    if (!viewer) return null;
    const r = (await cloudRpc('friend_liveries', { p_me: viewer, p_id: owner })) as { liveries?: unknown; updatedAt?: unknown } | null;
    if (!r || !Array.isArray(r.liveries)) return null;
    const hashes = new Set<string>();
    for (const lv of r.liveries as { badge?: unknown; layers?: { logo?: unknown }[] }[]) {
      if (typeof lv?.badge === 'string') hashes.add(lv.badge);
      for (const l of Array.isArray(lv?.layers) ? lv.layers : []) if (typeof l?.logo === 'string') hashes.add(l.logo);
    }
    const pics: Record<string, string> = {};
    await Promise.all(
      [...hashes].slice(0, 10).map(async (h) => {
        const url = await fetchSharedLogo(h);
        if (url) pics[h] = url;
      }),
    );
    return { updatedAt: String(r.updatedAt ?? ''), liveries: r.liveries.map((lv) => liveryFromProfile(lv, pics)) };
  } catch {
    return null;
  }
}
