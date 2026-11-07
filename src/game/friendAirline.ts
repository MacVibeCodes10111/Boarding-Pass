// ============================================================================
// A FRIEND'S AIRLINE AT A GLANCE (Update A)
//   What the window opened from a friend's aircraft shows: worked out from the
//   weekly schedule they already share for the map, so it tells friends nothing
//   new. Their money, passengers and anything else in their save never leave
//   their game.
// ============================================================================
import { AIRCRAFT_BY_ID } from './aircraftCatalog';
import { calcCoordDistanceNm, interpolateCoordPair } from './geo';
import type { ScheduleSnapshot } from './scheduleSnapshot';
import type { Airport } from './types';

export interface FriendRoute {
  /** Airport codes, in alphabetical order (a route is both directions). */
  a: string;
  b: string;
  /** Flights a week, both directions together. */
  weekly: number;
  nm: number;
}
export interface FriendAirlineStats {
  aircraft: number;
  weeklyFlights: number;
  destinations: number;
  routes: FriendRoute[];
  /** Aircraft of each type, most first. */
  types: { modelId: string; name: string; count: number }[];
  /** Airports with the most flights a week, most first. */
  busiest: { iata: string; name: string; weekly: number }[];
  longest: FriendRoute | null;
  /** The type they fly most, for the livery pictures. */
  mainModel: string | null;
}

const daysIn = (mask: number) => {
  let n = 0;
  for (let m = mask & 127; m; m &= m - 1) n++;
  return n;
};

export function friendAirlineStats(snap: ScheduleSnapshot, airports: ReadonlyMap<string, Airport>): FriendAirlineStats {
  const routes = new Map<string, FriendRoute>();
  const atAirport = new Map<string, number>();
  const regsOfModel = new Map<number, Set<number>>();
  const flownByModel = new Map<number, number>();
  const regs = new Set<number>();
  let weeklyFlights = 0;
  for (const [o, d, , , days, mi, ri] of snap.flights) {
    const A = airports.get(o);
    const B = airports.get(d);
    if (!A || !B || o === d) continue;
    const n = daysIn(days);
    weeklyFlights += n;
    regs.add(ri);
    if (!regsOfModel.has(mi)) regsOfModel.set(mi, new Set());
    regsOfModel.get(mi)!.add(ri);
    flownByModel.set(mi, (flownByModel.get(mi) ?? 0) + n);
    atAirport.set(o, (atAirport.get(o) ?? 0) + n);
    atAirport.set(d, (atAirport.get(d) ?? 0) + n);
    const [a, b] = o < d ? [o, d] : [d, o];
    const key = `${a}-${b}`;
    const r = routes.get(key);
    if (r) r.weekly += n;
    else routes.set(key, { a, b, weekly: n, nm: Math.round(calcCoordDistanceNm(A.longitude_deg, A.latitude_deg, B.longitude_deg, B.latitude_deg)) });
  }
  const list = [...routes.values()].sort((x, y) => y.weekly - x.weekly || y.nm - x.nm || x.a.localeCompare(y.a));
  const types = [...regsOfModel.entries()]
    .map(([mi, set]) => ({ modelId: snap.models[mi], name: AIRCRAFT_BY_ID.get(snap.models[mi])?.name ?? snap.models[mi], count: set.size }))
    .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
  const busiest = [...atAirport.entries()]
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    // "Paris (Roissy-en-France, Val-d'Oise)" reads as Paris
    .map(([iata, weekly]) => ({ iata, name: (airports.get(iata)?.municipality || airports.get(iata)?.name || iata).replace(/\s*\(.*\)\s*$/, '') || iata, weekly }));
  const main = [...flownByModel.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
  return {
    aircraft: regs.size,
    weeklyFlights,
    destinations: atAirport.size,
    routes: list,
    types,
    busiest,
    longest: list.reduce<FriendRoute | null>((best, r) => (!best || r.nm > best.nm ? r : best), null),
    mainModel: main === undefined ? null : snap.models[main],
  };
}

/** The routes as great-circle lines and the airports as points, for a map. */
type Feature = { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: 'LineString'; coordinates: [number, number][] } | { type: 'Point'; coordinates: [number, number] } };

/** A route on a map with several airlines: drawn in its airline's colour. */
export type MapRoute = FriendRoute & { colour?: string };

export function friendRouteMap(routes: readonly MapRoute[], airports: ReadonlyMap<string, Airport>) {
  const lines: Feature[] = [];
  const seen = new Set<string>();
  const points: Feature[] = [];
  let west = 180, east = -180, south = 90, north = -90;
  for (const r of routes) {
    const A = airports.get(r.a);
    const B = airports.get(r.b);
    if (!A || !B) continue;
    const from: [number, number] = [A.longitude_deg, A.latitude_deg];
    const to: [number, number] = [B.longitude_deg, B.latitude_deg];
    const steps = Math.max(2, Math.min(64, Math.ceil(r.nm / 60)));
    const coords: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const p = interpolateCoordPair(from, to, i / steps) as [number, number];
      // Keeps a line crossing the date line in one piece, not drawn the long way round
      const prev = coords[coords.length - 1];
      let lon = p[0];
      if (prev) while (lon - prev[0] > 180) lon -= 360;
      if (prev) while (lon - prev[0] < -180) lon += 360;
      coords.push([lon, p[1]]);
    }
    lines.push({ type: 'Feature', properties: r.colour ? { weekly: r.weekly, colour: r.colour } : { weekly: r.weekly }, geometry: { type: 'LineString', coordinates: coords } });
    for (const ap of [A, B]) {
      if (seen.has(ap.iata_code)) continue;
      seen.add(ap.iata_code);
      points.push({ type: 'Feature', properties: { iata: ap.iata_code }, geometry: { type: 'Point', coordinates: [ap.longitude_deg, ap.latitude_deg] } });
      west = Math.min(west, ap.longitude_deg);
      east = Math.max(east, ap.longitude_deg);
      south = Math.min(south, ap.latitude_deg);
      north = Math.max(north, ap.latitude_deg);
    }
  }
  return {
    lines: { type: 'FeatureCollection' as const, features: lines },
    points: { type: 'FeatureCollection' as const, features: points },
    bounds: points.length ? ([[west, south], [east, north]] as [[number, number], [number, number]]) : null,
  };
}
