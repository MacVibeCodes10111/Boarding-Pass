// ============================================================================
// GROUND MOVEMENT: TAXIING BETWEEN THE GATE AND THE RUNWAY
//   The basemap's vector tiles already carry each airport's layout from
//   OpenStreetMap (source layer "aeroway": taxiway centrelines with their
//   names, and gates). When you zoom into an airport, the tiles the map has
//   loaded anyway are read and stitched into a taxi network, and aircraft
//   follow it:
//     departure: at the gate → pushback → taxi → hold short (queue) → line up
//     arrival:   end of the landing roll → vacate → taxi → park at the gate
//   Nothing extra is downloaded. Where the tiles have no gates, dead-end
//   taxilanes (stands) are used instead.
//
//   Everything here works in a flat local frame in metres around the airport.
// ============================================================================
import type { LonLat } from './geo';
import { filletPath } from './navdata';

type XY = [number, number];
const D2R = Math.PI / 180;
const M_PER_DEG = 111_320;

/** One aeroway feature from the map tiles, flattened (multi-geometries split). */
export interface AerowayFeature {
  cls: string;
  ref: string;
  kind: 'point' | 'line' | 'polygon';
  coords: LonLat[];
}

const TAXI_CLASSES = new Set(['taxiway', 'taxilane']);
const GATE_CLASSES = new Set(['gate', 'parking_position', 'stand']);

/** Converts features from map.querySourceFeatures (GeoJSON) into AerowayFeatures. */
export function aerowayFromGeoJson(features: any[]): AerowayFeature[] {
  const out: AerowayFeature[] = [];
  for (const f of features) {
    const g = f?.geometry;
    const p = f?.properties ?? {};
    // OpenMapTiles layout (class), OSM (aeroway), or CARTO's newer layout:
    // runways and taxiways as roads of kind "aeroway", gates and stands as places of interest
    const cls = String(p.class ?? p.aeroway ?? (p.kind === 'aeroway' ? p.kind_detail : p.kind === 'gate' || p.kind === 'parking_position' ? p.kind : '') ?? '');
    if (!g || !cls) continue;
    const refRaw = p.ref ?? (p.kind === 'gate' || p.kind === 'parking_position' ? p.name : undefined);
    const ref = refRaw == null ? '' : String(refRaw).replace(/^Taxiway\s+/i, '').trim();
    const c = g.coordinates;
    switch (g.type) {
      case 'Point':
        out.push({ cls, ref, kind: 'point', coords: [c] });
        break;
      case 'MultiPoint':
        for (const q of c) out.push({ cls, ref, kind: 'point', coords: [q] });
        break;
      case 'LineString':
        out.push({ cls, ref, kind: 'line', coords: c });
        break;
      case 'MultiLineString':
        for (const q of c) out.push({ cls, ref, kind: 'line', coords: q });
        break;
      case 'Polygon':
        if (c[0]) out.push({ cls, ref, kind: 'polygon', coords: c[0] });
        break;
      case 'MultiPolygon':
        for (const q of c) if (q[0]) out.push({ cls, ref, kind: 'polygon', coords: q[0] });
        break;
    }
  }
  return out;
}

/** A runway centreline (both ends), used to keep stands off runways. */
export interface RunwayCenterline {
  a: LonLat;
  b: LonLat;
}

/** Runway end for routing: departure threshold, or the end of the landing roll. */
export interface RunwayPoint {
  ident: string;
  lon: number;
  lat: number;
  /** Takeoff or landing direction, degrees true. */
  hdg: number;
}

export interface Stand {
  ref: string;
  /** The gate (nose position) and where its lead-in line meets the taxiway. */
  g: XY;
  j: XY;
  /** Taxiway edge the lead-in line joins (node indices). */
  ea: number;
  eb: number;
  /** Other stands so close that only one of them can be used at a time. */
  clash: number[];
}

interface Edge {
  a: number;
  b: number;
  len: number;
  ref: string;
}

/** A taxi route in local metres, already smoothed. */
export interface TaxiRoute {
  pts: XY[];
  cum: number[];
  len: number;
  /** Taxiway names along the way, in order. */
  via: string[];
  /** Departure: distance at the hold-short point. Arrival: distance where the runway is vacated. */
  mark: number;
}

const SNAP_M = 3; // vertices closer than this are the same node
const JOIN_M = 5; // a loose end this close to a taxiway joins it
const HOLD_M = 75; // hold-short line distance from the runway centreline
const ENTRY_LAT_M = 110; // how far from the centreline a runway entry/exit node may be

const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unitFromHdg = (hdg: number): XY => [Math.sin(hdg * D2R), Math.cos(hdg * D2R)];
const bearingOf = (from: XY, to: XY) => ((Math.atan2(to[0] - from[0], to[1] - from[1]) / D2R) + 360) % 360;

function projectOnSeg(p: XY, a: XY, b: XY): { t: number; d: number; q: XY } {
  const ab = sub(b, a);
  const l2 = ab[0] * ab[0] + ab[1] * ab[1];
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2)) : 0;
  const q: XY = [a[0] + ab[0] * t, a[1] + ab[1] * t];
  return { t, d: dist(p, q), q };
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Binary min-heap of (key, value) pairs. */
class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number) {
    const { k, v } = this;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const { k, v } = this;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

let networkSerial = 0;

export class TaxiNetwork {
  readonly version = ++networkSerial;
  readonly kx: number;
  readonly ky = M_PER_DEG;
  xs: number[] = [];
  ys: number[] = [];
  edges: Edge[] = [];
  /** Edge ids per node (only nodes of the main connected network have any). */
  adj: number[][] = [];
  stands: Stand[] = [];
  /** True when the stands are real gates from the map (not dead-end taxilanes). */
  realGates = false;
  private routes = new Map<string, TaxiRoute | null>();
  /** Planned taxis per movement, and the space–time they book (grid cell → [from, to, from, to…] minutes). */
  readonly trajs = new Map<string, TaxiTrajectory>();
  readonly bookings = new Map<number, number[]>();
  prunedAt = -Infinity;

  /** Forgets plans and bookings that are over. */
  pruneTaxi(now: number) {
    for (const [k, tr] of this.trajs) if (tr.t[tr.t.length - 1] < now - 30) this.trajs.delete(k);
    for (const [c, list] of this.bookings) {
      const keep: number[] = [];
      for (let i = 0; i < list.length; i += 2) if (list[i + 1] > now - 2) keep.push(list[i], list[i + 1]);
      if (keep.length) this.bookings.set(c, keep);
      else this.bookings.delete(c);
    }
  }
  private alloc = new Map<string, { idx: number; cleared?: boolean }>();
  private busy: GateUse[][] = [];
  private failedAt = new Map<string, number>();
  private ops = 0;

  constructor(readonly iata: string, readonly lon0: number, readonly lat0: number) {
    this.kx = M_PER_DEG * Math.cos(lat0 * D2R);
  }

  toXY(ll: LonLat): XY {
    return [(ll[0] - this.lon0) * this.kx, (ll[1] - this.lat0) * this.ky];
  }

  toLL(p: XY): LonLat {
    return [this.lon0 + p[0] / this.kx, this.lat0 + p[1] / this.ky];
  }

  node(i: number): XY {
    return [this.xs[i], this.ys[i]];
  }

  get edgeCount() {
    return this.edges.length;
  }

  hasRoute(key: string) {
    return this.routes.has(key);
  }

  // --------------------------------------------------------------------------
  // Shortest paths
  // --------------------------------------------------------------------------
  private dijkstra(sources: [number, number][], targets: Map<number, number>, cost?: (u: number, v: number, len: number) => number): number[] | null {
    const n = this.xs.length;
    const best = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const heap: [number, number][] = [];
    const push = (d: number, v: number) => {
      heap.push([d, v]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    for (const [v, d] of sources) {
      if (d < best[v]) {
        best[v] = d;
        push(d, v);
      }
    }
    let goal = -1;
    let goalCost = Infinity;
    while (heap.length) {
      const [d, u] = pop();
      if (d > best[u]) continue;
      if (d >= goalCost) break;
      const extra = targets.get(u);
      if (extra !== undefined && d + extra < goalCost) {
        goalCost = d + extra;
        goal = u;
      }
      for (const eid of this.adj[u]) {
        const e = this.edges[eid];
        const v = e.a === u ? e.b : e.a;
        const nd = d + (cost ? cost(u, v, e.len) : e.len);
        if (nd < best[v]) {
          best[v] = nd;
          prev[v] = u;
          push(nd, v);
        }
      }
    }
    if (goal < 0) return null;
    const path: number[] = [];
    for (let v = goal; v >= 0; v = prev[v]) path.push(v);
    return path.reverse();
  }

  /** Shortest-path tree from `root` over the whole network: each node's next step towards it. */
  private tree(root: number): Int32Array {
    const n = this.xs.length;
    const best = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const heap = new MinHeap();
    best[root] = 0;
    heap.push(0, root);
    while (heap.size) {
      const [d, u] = heap.pop();
      if (d > best[u]) continue;
      for (const eid of this.adj[u]) {
        const e = this.edges[eid];
        const v = e.a === u ? e.b : e.a;
        const nd = d + e.len;
        if (nd < best[v]) {
          best[v] = nd;
          prev[v] = u;
          heap.push(nd, v);
        }
      }
    }
    return prev;
  }

  private edgeRef(u: number, v: number): string {
    for (const eid of this.adj[u]) {
      const e = this.edges[eid];
      if ((e.a === u && e.b === v) || (e.a === v && e.b === u)) return e.ref;
    }
    return '';
  }

  /** Node near a runway, within ENTRY_LAT_M of its centreline and between sMin and sMax metres along it. */
  /**
   * Taxiway node to enter or leave a runway at. Nodes where a taxiway actually
   * meets the runway (on its centreline) come first; only if there are none
   * nearby are nodes further out used (a parallel taxiway node would otherwise
   * make the aircraft hop sideways across the grass).
   */
  /**
   * How far an exit at runway node i points along the landing direction u:
   * about +0.9 for a high-speed exit angled forward, 0 for a right-angle one,
   * negative for one that leads back down the runway. Taken from the taxiway
   * edge that leaves the runway (the neighbour furthest from the centreline).
   */
  private exitForwardness(i: number, P: XY, u: XY): number {
    const latOf = (x: number, y: number) => Math.abs(u[0] * (y - P[1]) - u[1] * (x - P[0]));
    const li = latOf(this.xs[i], this.ys[i]);
    let best = 0;
    let bestGain = 2;
    for (const eid of this.adj[i]) {
      const e = this.edges[eid];
      const j = e.a === i ? e.b : e.a;
      // Follow short pieces until the line has moved ~40 m (tile cuts leave many tiny edges)
      let k = j;
      let prev = i;
      for (let hop = 0; hop < 6 && Math.hypot(this.xs[k] - this.xs[i], this.ys[k] - this.ys[i]) < 40; hop++) {
        const next = this.adj[k].map((id) => (this.edges[id].a === k ? this.edges[id].b : this.edges[id].a)).find((n) => n !== prev);
        if (next === undefined) break;
        prev = k;
        k = next;
      }
      const dx = this.xs[k] - this.xs[i];
      const dy = this.ys[k] - this.ys[i];
      const gain = latOf(this.xs[k], this.ys[k]) - li;
      const len = Math.hypot(dx, dy) || 1;
      if (gain > bestGain) {
        bestGain = gain;
        best = (dx * u[0] + dy * u[1]) / len;
      }
    }
    return best;
  }

  /** Runway entry/exit node per runway point: the same for every gate, so worked out once. */
  private rwyNodes = new Map<string, number>();
  private runwayNode(P: XY, u: XY, sMin: number, sMax: number, exit: boolean): number {
    const key = `${P[0].toFixed(1)},${P[1].toFixed(1)},${u[0].toFixed(5)},${u[1].toFixed(5)},${sMin},${sMax},${exit ? 1 : 0}`;
    const hit = this.rwyNodes.get(key);
    if (hit !== undefined) return hit;
    const found = this.findRunwayNode(P, u, sMin, sMax, exit);
    this.rwyNodes.set(key, found);
    return found;
  }

  private findRunwayNode(P: XY, u: XY, sMin: number, sMax: number, exit: boolean): number {
    const tiers = [25, 60, ENTRY_LAT_M];
    const best = tiers.map(() => ({ i: -1, score: Infinity }));
    let nearI = -1;
    let nearD = Infinity;
    for (let i = 0; i < this.xs.length; i++) {
      if (!this.adj[i].length) continue;
      const dx = this.xs[i] - P[0];
      const dy = this.ys[i] - P[1];
      const dd = Math.hypot(dx, dy);
      if (dd < nearD) {
        nearD = dd;
        nearI = i;
      }
      const s = dx * u[0] + dy * u[1];
      const lat = Math.abs(u[0] * dy - u[1] * dx);
      if (lat > ENTRY_LAT_M || s < sMin || s > sMax) continue;
      // Arrivals: the first exit ahead (one behind only if there is none ahead, or it
      // would have to roll back and turn round). Departures: join at or just before the
      // threshold, or it would line up and then taxi backwards down the runway.
      // Arrivals also prefer a high-speed exit angled forward (worth ~250 m of extra roll),
      // and avoid exits that lead back down the runway, which real aircraft can't take
      // at speed (they would have to stop and turn more than 120°).
      let score: number;
      if (exit) {
        const fwd = lat <= 60 ? this.exitForwardness(i, P, u) : 0;
        score = (s >= -10 ? s : 10_000 - s) + lat * 0.1 - (fwd > 0.45 ? 250 : 0) + (fwd < -0.35 ? 1500 : 0);
      } else score = (s <= 15 ? Math.abs(s) : 10_000 + s) + lat * 0.3;
      tiers.forEach((lim, k) => {
        if (lat <= lim && score < best[k].score) best[k] = { i, score };
      });
    }
    for (const b of best) if (b.i >= 0) return b.i;
    return nearD < 2500 ? nearI : -1;
  }

  private finish(raw: XY[], via: string[], markFn: (pts: XY[], cum: number[]) => number): TaxiRoute {
    // Drop repeated points and short spikes where the line doubles back on itself
    // (map data and runway coordinates never line up exactly), then round the
    // corners (taxi turns of ~35 m radius)
    const clean: XY[] = [];
    for (const p of raw) if (!clean.length || dist(clean[clean.length - 1], p) > 0.5) clean.push(p);
    for (let changed = true; changed && clean.length > 2; ) {
      changed = false;
      for (let i = 1; i < clean.length - 1; i++) {
        const a = clean[i - 1];
        const b = clean[i];
        const c = clean[i + 1];
        const ab = sub(b, a);
        const bc = sub(c, b);
        const la = Math.hypot(ab[0], ab[1]);
        const lc = Math.hypot(bc[0], bc[1]);
        const cos = (ab[0] * bc[0] + ab[1] * bc[1]) / Math.max(1e-9, la * lc);
        if (cos < -0.5 && Math.min(la, lc) < 45) {
          clean.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    const pts = clean.length >= 3 ? filletPath(clean, clean.map(() => 35)) : clean;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    const names: string[] = [];
    for (const r of via) if (r && names[names.length - 1] !== r) names.push(r);
    return { pts, cum, len: cum[cum.length - 1], via: names.slice(0, 5), mark: markFn(pts, cum) };
  }

  /** Gate → taxiways → runway entry → line-up at the threshold. Cached per stand and runway. */
  routeOut(standIdx: number, rwy: RunwayPoint): TaxiRoute | null {
    const key = `o:${standIdx}:${rwy.ident}`;
    if (this.routes.has(key)) return this.routes.get(key)!;
    const s = this.stands[standIdx];
    let route: TaxiRoute | null = null;
    if (s) {
      const T = this.toXY([rwy.lon, rwy.lat]);
      const u = unitFromHdg(rwy.hdg);
      const E = this.runwayNode(T, u, -250, 700, false);
      const path =
        E >= 0
          ? this.dijkstra(
              [
                [s.ea, dist(s.j, this.node(s.ea))],
                [s.eb, dist(s.j, this.node(s.eb))],
              ],
              new Map([[E, 0]])
            )
          : null;
      if (path) {
        const lateral = (p: XY) => Math.abs(u[0] * (p[1] - T[1]) - u[1] * (p[0] - T[0]));
        const along = (p: XY) => (p[0] - T[0]) * u[0] + (p[1] - T[1]) * u[1];
        const e = this.node(E);
        const F: XY = [T[0] + u[0] * along(e), T[1] + u[1] * along(e)];
        const raw: XY[] = [s.j, ...path.map((i) => this.node(i)), ...(lateral(e) < 30 ? [] : [F]), T];
        const via = path.slice(1).map((v, k) => this.edgeRef(path[k], v));
        route = this.finish(raw, via, (pts, cum) => {
          // Hold short where the route last comes within HOLD_M of the centreline
          let k = pts.length - 1;
          while (k > 0 && lateral(pts[k - 1]) < HOLD_M) k--;
          if (k === 0) return 0;
          const a = lateral(pts[k - 1]);
          const b = lateral(pts[k]);
          const f = a > b ? Math.max(0, Math.min(1, (a - HOLD_M) / (a - b))) : 0;
          return cum[k - 1] + f * (cum[k] - cum[k - 1]);
        });
      }
    }
    this.routes.set(key, route);
    return route;
  }

  /**
   * Which way departures flow on each taxiway towards a departure runway:
   * directed edges (from·n + to) of the shortest paths from every node to its
   * entry. Arrivals avoid going against this flow where they can.
   */
  private flows = new Map<string, Set<number>>();
  depFlow(rwy: RunwayPoint): Set<number> {
    const hit = this.flows.get(rwy.ident);
    if (hit) return hit;
    const flow = new Set<number>();
    const T = this.toXY([rwy.lon, rwy.lat]);
    const E = this.runwayNode(T, unitFromHdg(rwy.hdg), -250, 700, false);
    if (E >= 0) {
      // Shortest-path tree rooted at the runway entry
      const n = this.xs.length;
      const prev = this.tree(E);
      for (let v = 0; v < n; v++) if (prev[v] >= 0) flow.add(v * n + prev[v]);
    }
    this.flows.set(rwy.ident, flow);
    return flow;
  }

  /**
   * End of the landing roll → first exit ahead → taxiways → the gate's lead-in
   * line. With `flow` (the departure runway in use), taxiways that departures
   * use the other way count three times their length, so arrivals take a
   * parallel taxiway instead of meeting departures head-on where there is one.
   */
  routeIn(standIdx: number, stop: RunwayPoint, flow?: RunwayPoint): TaxiRoute | null {
    const key = `i:${standIdx}:${stop.ident}:${flow?.ident ?? ''}`;
    if (this.routes.has(key)) return this.routes.get(key)!;
    const s = this.stands[standIdx];
    let route: TaxiRoute | null = null;
    if (s) {
      const S = this.toXY([stop.lon, stop.lat]);
      const u = unitFromHdg(stop.hdg);
      const X = this.runwayNode(S, u, -120, 2500, true);
      const path =
        X >= 0
          ? this.dijkstra(
              [[X, 0]],
              new Map([
                [s.ea, dist(s.j, this.node(s.ea))],
                [s.eb, dist(s.j, this.node(s.eb))],
              ]),
              flow
                ? (() => {
                    const f = this.depFlow(flow);
                    const n = this.xs.length;
                    return (u: number, v: number, len: number) => (f.has(v * n + u) ? len * 3 : len);
                  })()
                : undefined
            )
          : null;
      if (path) {
        const lateral = (p: XY) => Math.abs(u[0] * (p[1] - S[1]) - u[1] * (p[0] - S[0]));
        const x = this.node(X);
        const sx = (x[0] - S[0]) * u[0] + (x[1] - S[1]) * u[1];
        const F: XY = [S[0] + u[0] * Math.max(0, sx), S[1] + u[1] * Math.max(0, sx)];
        const onLine = lateral(x) < 30;
        const raw: XY[] = [S, ...(onLine ? [] : [F]), ...path.map((i) => this.node(i)), s.j];
        const via = path.slice(1).map((v, k) => this.edgeRef(path[k], v));
        route = this.finish(raw, via, (pts, cum) => {
          for (let k = 1; k < pts.length; k++) if (lateral(pts[k]) >= HOLD_M) return cum[k];
          return cum[cum.length - 1];
        });
      }
    }
    this.routes.set(key, route);
    return route;
  }

  // --------------------------------------------------------------------------
  // Gates: first come, first served, near the airline's usual gates. When every
  // gate is taken, an aircraft that has arrived and is just sitting parked gives
  // its stand up (it leaves the map): other airlines' first, then yours with no
  // departure soon. One of yours cleared that way gets a free gate again when
  // its next departure comes up, so a departing aircraft always finds a gate.
  // --------------------------------------------------------------------------
  /** Gate for a movement's visit (stable once given), or -1 while none can be had. */
  assignGate(m: GateRequest, now: number): number {
    const hit = this.alloc.get(m.visit);
    if (hit && !hit.cleared) return hit.idx;
    const n = this.stands.length;
    if (!n) return -1;
    if (hit?.cleared) {
      // Cleared while parked: back at a gate (any free one) from boarding, 40 min before pushback
      if (m.kind !== 'dep' || now < (m.pushAt ?? m.parkFrom ?? m.visitStart) - 40) return -1;
      return this.findGate(m, Math.max(now, m.visitStart), now, true);
    }
    // Gave up earlier: try again a little later (a gate may have freed up): yours
    // every half minute, other airlines' every 2 minutes (busy hubs have many waiting)
    const failed = this.failedAt.get(m.visit);
    if (failed !== undefined && now >= failed && now - failed < (m.visit.startsWith('p') ? 0.5 : 2)) return -1;
    if (++this.ops % 256 === 0) {
      for (let i = 0; i < this.busy.length; i++) this.busy[i] = (this.busy[i] ?? []).filter((iv) => iv.e > now - 60);
      if (this.alloc.size > 4000) this.alloc.clear();
      if (this.failedAt.size > 4000) this.failedAt.clear();
    }
    // Clearing someone else's stand only when this aircraft actually needs one now
    const needFrom = m.kind === 'arr' ? (m.rollEndAt ?? m.visitStart) - 0.5 : (m.parkFrom ?? m.visitStart) - 10;
    // Only your aircraft clear a stand (others just wait for a free one: cheaper at busy hubs)
    return this.findGate(m, m.visitStart, now, m.visit.startsWith('p') && now >= needFrom);
  }

  private findGate(m: GateRequest, start: number, now: number, mayClear: boolean): number {
    const n = this.stands.length;
    const end = m.visitEnd;
    const base = hashStr(m.pref) % n;
    // Stands outward from the airline's usual one: base, base+1, base-1, base+2…
    const at = (k: number) => {
      const step = k % 2 ? (k + 1) >> 1 : -(k >> 1);
      return (((base + step) % n) + n) % n;
    };
    const overlaps = (iv: GateUse) => !(iv.e + 3 <= start || iv.s >= end + 3);
    const free = (i: number) => (this.busy[i] ?? []).every((iv) => !overlaps(iv));
    const take = (idx: number) => {
      const parked = parkedWindow(m);
      (this.busy[idx] ??= []).push({ s: start, e: end, visit: m.visit, key: m.key, ...parked });
      this.alloc.set(m.visit, { idx });
      this.failedAt.delete(m.visit);
      return idx;
    };
    for (let k = 0; k < n; k++) {
      const idx = at(k);
      if (free(idx) && this.stands[idx].clash.every(free)) return take(idx);
    }

    if (mayClear) {
      // Every gate taken: the stand whose occupants can all be cleared right now, cheapest first
      let best = -1;
      let bestCost = Infinity;
      for (let k = 0; k < n && bestCost > 1; k++) {
        const idx = at(k);
        let cost = 0;
        for (const i of [idx, ...this.stands[idx].clash]) {
          for (const iv of this.busy[i] ?? []) {
            if (!overlaps(iv)) continue;
            if (!(now >= iv.clearFrom && now <= iv.clearTo && this.parkedNow(iv, now))) {
              cost = Infinity;
              break;
            }
            cost += 1 + iv.rank * 10;
          }
          if (cost === Infinity) break;
        }
        if (cost < bestCost) {
          bestCost = cost;
          best = idx;
        }
      }
      if (best >= 0) {
        for (const i of [best, ...this.stands[best].clash]) {
          for (const iv of this.busy[i] ?? []) {
            if (!overlaps(iv)) continue;
            iv.e = Math.min(iv.e, start - 4); // the stand is free from now
            const a = this.alloc.get(iv.visit);
            if (a) a.cleared = true;
            this.cleared.add(iv.visit);
          }
        }
        return take(best);
      }
    }
    this.failedAt.set(m.visit, now);
    return -1;
  }

  /** An arrival counts as parked once its taxi to the gate has finished (not just by the clock). */
  private parkedNow(iv: GateUse, now: number): boolean {
    const tr = this.trajs.get(iv.key);
    // No taxi planned (or long finished and forgotten): not drawn on the ground, safe well after landing
    if (!tr) return now >= iv.clearFrom + 10;
    return tr.t[tr.t.length - 1] + 1 <= now;
  }

  /** Visits whose parked aircraft were cleared off their stand (for tests and the map). */
  readonly cleared = new Set<string>();
}

/** What a gate request needs to know about the movement. */
export type GateRequest = Pick<GroundMove, 'key' | 'visit' | 'pref' | 'visitStart' | 'visitEnd' | 'kind' | 'parkFrom' | 'pushAt' | 'rollEndAt' | 'parkUntil'>;

interface GateUse {
  s: number;
  e: number;
  visit: string;
  /** The movement that took the gate (an arrival's taxi must be over before it can be cleared). */
  key: string;
  /** While the aircraft is just sitting parked, it may give the stand up. */
  clearFrom: number;
  clearTo: number;
  /** Who goes first: 0 other airlines, 1 yours with no departure from here, 2 yours waiting for a later departure. */
  rank: number;
}

/**
 * When an occupant is only parked (taxied in, not boarding yet): from 15
 * minutes after landing until its visit ends, or until 40 minutes before its
 * next departure for one of yours staying between flights. Departures waiting
 * at their gate are never cleared.
 */
function parkedWindow(m: GateRequest): { clearFrom: number; clearTo: number; rank: number } {
  if (m.kind !== 'arr') return { clearFrom: Infinity, clearTo: -Infinity, rank: 9 };
  const from = (m.rollEndAt ?? m.visitStart) + 15;
  if (m.visit.startsWith('pv:')) return { clearFrom: from, clearTo: (m.parkUntil ?? m.visitEnd) - 40, rank: 2 };
  return { clearFrom: from, clearTo: m.visitEnd, rank: m.visit.startsWith('p') ? 1 : 0 };
}

// ----------------------------------------------------------------------------
// Building the network from tile features
// ----------------------------------------------------------------------------
/**
 * Stitches taxiway lines into a routable network. Tile data is cut at tile
 * edges and simplified, so pieces are re-joined: shared vertices are merged,
 * loose ends that touch a taxiway are connected to it, and crossings without
 * a shared vertex get one. Only the largest connected part is kept.
 */
export function buildTaxiNetwork(
  iata: string,
  center: LonLat,
  radiusM: number,
  feats: AerowayFeature[],
  runways: RunwayCenterline[] = []
): TaxiNetwork | null {
  const net = new TaxiNetwork(iata, center[0], center[1]);
  const { xs, ys } = net;
  const r2 = radiusM * radiusM;
  const inside = (p: XY) => p[0] * p[0] + p[1] * p[1] <= r2;

  const cells = new Map<string, number[]>();
  const nodeAt = (p: XY): number => {
    const cx = Math.floor(p[0] / SNAP_M);
    const cy = Math.floor(p[1] / SNAP_M);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const list = cells.get(`${cx + dx}:${cy + dy}`);
        if (list) for (const i of list) if (Math.hypot(xs[i] - p[0], ys[i] - p[1]) < SNAP_M) return i;
      }
    const i = xs.length;
    xs.push(p[0]);
    ys.push(p[1]);
    const k = `${cx}:${cy}`;
    (cells.get(k) ?? cells.set(k, []).get(k)!).push(i);
    return i;
  };

  let segs = new Map<string, Edge>();
  const addSeg = (map: Map<string, Edge>, a: number, b: number, ref: string) => {
    if (a === b) return;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const k = `${lo}:${hi}`;
    const ex = map.get(k);
    if (ex) {
      if (!ex.ref && ref) ex.ref = ref;
      return;
    }
    map.set(k, { a: lo, b: hi, len: 0, ref });
  };

  for (const f of feats) {
    if (f.kind !== 'line' || !TAXI_CLASSES.has(f.cls)) continue;
    let prev = -1;
    let prevIn = false;
    for (const c of f.coords) {
      const p = net.toXY(c);
      const isIn = inside(p);
      if (!isIn && !prevIn) {
        prev = -1;
        prevIn = false;
        // still create the node lazily only when needed
        prev = nodeAt(p);
        continue;
      }
      const n = nodeAt(p);
      if (prev >= 0) addSeg(segs, prev, n, f.ref);
      prev = n;
      prevIn = isIn;
    }
  }
  if (segs.size < 6) return null;

  // --- Split at crossings and where loose ends touch another taxiway --------
  const list = [...segs.values()];
  const G = 40;
  const grid = new Map<string, number[]>();
  list.forEach((s, i) => {
    const x0 = Math.floor((Math.min(xs[s.a], xs[s.b]) - JOIN_M) / G);
    const x1 = Math.floor((Math.max(xs[s.a], xs[s.b]) + JOIN_M) / G);
    const y0 = Math.floor((Math.min(ys[s.a], ys[s.b]) - JOIN_M) / G);
    const y1 = Math.floor((Math.max(ys[s.a], ys[s.b]) + JOIN_M) / G);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = `${x}:${y}`;
        (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
      }
  });
  const splits = new Map<number, { t: number; n: number }[]>();
  const addSplit = (si: number, t: number, n: number) => (splits.get(si) ?? splits.set(si, []).get(si)!).push({ t, n });
  const P = (i: number): XY => [xs[i], ys[i]];
  const seen = new Set<number>();
  const M = list.length;
  const touch = (si: number, n: number) => {
    const s = list[si];
    if (n === s.a || n === s.b) return;
    const pr = projectOnSeg(P(n), P(s.a), P(s.b));
    if (pr.d < JOIN_M && pr.t > 0.001 && pr.t < 0.999) addSplit(si, pr.t, n);
  };
  for (const ids of grid.values()) {
    for (let x = 0; x < ids.length; x++)
      for (let y = x + 1; y < ids.length; y++) {
        const i = Math.min(ids[x], ids[y]);
        const j = Math.max(ids[x], ids[y]);
        const pk = i * M + j;
        if (seen.has(pk)) continue;
        seen.add(pk);
        const A = list[i];
        const B = list[j];
        touch(i, B.a);
        touch(i, B.b);
        touch(j, A.a);
        touch(j, A.b);
        if (A.a === B.a || A.a === B.b || A.b === B.a || A.b === B.b) continue;
        // Proper crossing
        const p = P(A.a);
        const r = sub(P(A.b), p);
        const q = P(B.a);
        const s = sub(P(B.b), q);
        const den = r[0] * s[1] - r[1] * s[0];
        if (Math.abs(den) < 1e-9) continue;
        const qp = sub(q, p);
        const t = (qp[0] * s[1] - qp[1] * s[0]) / den;
        const u = (qp[0] * r[1] - qp[1] * r[0]) / den;
        if (t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999) {
          const n = nodeAt([p[0] + r[0] * t, p[1] + r[1] * t]);
          if (n !== A.a && n !== A.b) addSplit(i, t, n);
          if (n !== B.a && n !== B.b) addSplit(j, u, n);
        }
      }
  }
  segs = new Map();
  list.forEach((s, i) => {
    const sp = splits.get(i);
    if (!sp) {
      addSeg(segs, s.a, s.b, s.ref);
      return;
    }
    sp.sort((a, b) => a.t - b.t);
    let prev = s.a;
    for (const x of sp) {
      if (x.n !== prev) addSeg(segs, prev, x.n, s.ref);
      prev = x.n;
    }
    addSeg(segs, prev, s.b, s.ref);
  });

  // --- Loose ends right next to another node are joined ---------------------
  const degree = new Map<number, number>();
  for (const s of segs.values()) {
    degree.set(s.a, (degree.get(s.a) ?? 0) + 1);
    degree.set(s.b, (degree.get(s.b) ?? 0) + 1);
  }
  for (const [n, d] of degree) {
    if (d !== 1) continue;
    const cx = Math.floor(xs[n] / SNAP_M);
    const cy = Math.floor(ys[n] / SNAP_M);
    let best = -1;
    let bestD = JOIN_M;
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++)
        for (const m of cells.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (m === n || !degree.has(m)) continue;
          const dd = Math.hypot(xs[m] - xs[n], ys[m] - ys[n]);
          if (dd < bestD && !segs.has(`${Math.min(m, n)}:${Math.max(m, n)}`)) {
            bestD = dd;
            best = m;
          }
        }
    if (best >= 0) addSeg(segs, n, best, '');
  }

  // --- Adjacency, keep the largest connected part ---------------------------
  const edges = [...segs.values()];
  for (const e of edges) e.len = Math.hypot(xs[e.a] - xs[e.b], ys[e.a] - ys[e.b]);
  const tmpAdj: number[][] = xs.map(() => []);
  edges.forEach((e, i) => {
    tmpAdj[e.a].push(i);
    tmpAdj[e.b].push(i);
  });
  const comp = new Int32Array(xs.length).fill(-1);
  let bestComp = -1;
  let bestSize = 0;
  let c = 0;
  for (let s = 0; s < xs.length; s++) {
    if (comp[s] >= 0 || !tmpAdj[s].length) continue;
    let size = 0;
    const stack = [s];
    comp[s] = c;
    while (stack.length) {
      const u = stack.pop()!;
      size++;
      for (const eid of tmpAdj[u]) {
        const e = edges[eid];
        const v = e.a === u ? e.b : e.a;
        if (comp[v] < 0) {
          comp[v] = c;
          stack.push(v);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestComp = c;
    }
    c++;
  }
  const kept = edges.filter((e) => comp[e.a] === bestComp);
  if (kept.length < 6) return null;
  net.edges = kept;
  net.adj = xs.map(() => []);
  kept.forEach((e, i) => {
    net.adj[e.a].push(i);
    net.adj[e.b].push(i);
  });

  // --- Stands ----------------------------------------------------------------
  const rwys = runways.map((r) => [net.toXY(r.a), net.toXY(r.b)] as [XY, XY]);
  const nearRunway = (p: XY, d: number) => rwys.some(([a, b]) => projectOnSeg(p, a, b).d < d);
  const EG = 60;
  const egrid = new Map<string, number[]>();
  kept.forEach((e, i) => {
    const x0 = Math.floor(Math.min(xs[e.a], xs[e.b]) / EG);
    const x1 = Math.floor(Math.max(xs[e.a], xs[e.b]) / EG);
    const y0 = Math.floor(Math.min(ys[e.a], ys[e.b]) / EG);
    const y1 = Math.floor(Math.max(ys[e.a], ys[e.b]) / EG);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = `${x}:${y}`;
        (egrid.get(k) ?? egrid.set(k, []).get(k)!).push(i);
      }
  });
  const nearestEdge = (p: XY, maxD: number) => {
    const r = Math.ceil(maxD / EG);
    const cx = Math.floor(p[0] / EG);
    const cy = Math.floor(p[1] / EG);
    let best: { e: Edge; d: number; q: XY } | null = null;
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++)
        for (const i of egrid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          const e = kept[i];
          const pr = projectOnSeg(p, P(e.a), P(e.b));
          if (pr.d <= maxD && (!best || pr.d < best.d)) best = { e, d: pr.d, q: pr.q };
        }
    return best;
  };

  // Stand positions: parking positions (the aircraft's stop mark) first, then
  // gates; a gate next to a parking position is the same stand (and names it).
  const stands: Stand[] = [];
  const candidates: { ref: string; p: XY; prio: number }[] = [];
  for (const f of feats) {
    if (!GATE_CLASSES.has(f.cls)) continue;
    const prio = f.cls === 'gate' ? 1 : 0;
    if (f.kind === 'point') candidates.push({ ref: f.ref, p: net.toXY(f.coords[0]), prio });
    else if (f.kind === 'line' && f.coords.length >= 2) {
      // A parking-position line runs from the taxiway to the stop mark: use the far end
      const a = net.toXY(f.coords[0]);
      const b = net.toXY(f.coords[f.coords.length - 1]);
      const da = nearestEdge(a, 400)?.d ?? 0;
      const db = nearestEdge(b, 400)?.d ?? 0;
      candidates.push({ ref: f.ref, p: da > db ? a : b, prio });
    }
  }
  candidates.sort((a, b) => a.prio - b.prio);
  for (const c of candidates) {
    const g = c.p;
    if (!inside(g)) continue;
    const near = stands.find((s) => dist(s.g, g) < (c.prio ? 45 : 20));
    if (near) {
      if (!near.ref && c.ref) near.ref = c.ref;
      continue;
    }
    const hit = nearestEdge(g, 250);
    if (!hit || nearRunway(hit.q, 80)) continue;
    stands.push({ ref: c.ref, g, j: hit.q, ea: hit.e.a, eb: hit.e.b, clash: [] });
  }
  net.realGates = stands.length >= 3;
  if (!net.realGates) {
    // No gates in the tiles (most smaller airports). Aircraft park on the
    // aprons (the paved parking areas the map marks): first at dead-end
    // taxilanes on or next to an apron, otherwise at spots laid out on the
    // apron along its taxiway. Never in the grass off a runway end.
    stands.length = 0;
    const aprons = feats.filter((f) => f.kind === 'polygon' && f.cls === 'apron').map((f) => f.coords.map((c) => net.toXY(c)));
    const inPoly = (p: XY, ring: XY[]) => {
      let inn = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i];
        const b = ring[j];
        if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1] || 1e-9) + a[0]) inn = !inn;
      }
      return inn;
    };
    const ringDist = (p: XY, ring: XY[]) => {
      let d = Infinity;
      for (let i = 1; i < ring.length; i++) d = Math.min(d, projectOnSeg(p, ring[i - 1], ring[i]).d);
      return d;
    };
    const onApron = (p: XY, margin: number) => aprons.some((r) => inPoly(p, r) || ringDist(p, r) < margin);
    // Off either end of a runway, along its line: approach and run-up areas, not parking
    const offRunwayEnd = (p: XY) =>
      rwys.some(([a, b]) => {
        const ab = sub(b, a);
        const L = Math.hypot(ab[0], ab[1]) || 1;
        const u: XY = [ab[0] / L, ab[1] / L];
        const s0 = (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1];
        const lat = Math.abs(u[0] * (p[1] - a[1]) - u[1] * (p[0] - a[0]));
        return lat < 250 && (s0 < 0 ? -s0 : s0 - L) > 0 && (s0 < 0 ? -s0 : s0 - L) < 900;
      });
    for (let i = 0; i < xs.length; i++) {
      if (net.adj[i].length !== 1) continue;
      const g = P(i);
      if (nearRunway(g, 150) || !inside(g) || offRunwayEnd(g)) continue;
      if (aprons.length && !onApron(g, 40)) continue;
      const e = kept[net.adj[i][0]];
      const o = e.a === i ? e.b : e.a;
      const back = Math.min(45, e.len * 0.8);
      const dir = sub(P(o), g);
      const l = Math.hypot(dir[0], dir[1]) || 1;
      stands.push({ ref: '', g, j: [g[0] + (dir[0] / l) * back, g[1] + (dir[1] / l) * back], ea: i, eb: o, clash: [] });
    }
    if (stands.length < 3 && aprons.length) {
      // Spots on the aprons, in a row 25–110 m from the taxiway that serves them
      const SPACING = 45;
      for (const ring of aprons) {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const [x, y] of ring) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
        let made = 0;
        for (let x = x0 + SPACING / 2; x < x1 && made < 30; x += SPACING)
          for (let y = y0 + SPACING / 2; y < y1 && made < 30; y += SPACING) {
            const g: XY = [x, y];
            if (!inside(g) || !inPoly(g, ring) || ringDist(g, ring) < 15 || nearRunway(g, 120) || offRunwayEnd(g)) continue;
            const hit = nearestEdge(g, 120);
            if (!hit || hit.d < 25 || nearRunway(hit.q, 80) || stands.some((st) => dist(st.g, g) < 40)) continue;
            stands.push({ ref: '', g, j: hit.q, ea: hit.e.a, eb: hit.e.b, clash: [] });
            made++;
          }
        if (stands.length >= 120) break;
      }
    }
  }
  const collator = typeof Intl !== 'undefined' ? new Intl.Collator('en', { numeric: true }) : null;
  stands.sort((a, b) => (collator ? collator.compare(a.ref, b.ref) : a.ref < b.ref ? -1 : 1) || a.g[0] - b.g[0]);
  // Stands whose parked aircraft would touch are used one at a time
  const spots = stands.map((s) => parkingSpot(s, 25).c);
  for (let a = 0; a < stands.length; a++)
    for (let b = a + 1; b < stands.length; b++)
      if (dist(spots[a], spots[b]) < 42) {
        stands[a].clash.push(b);
        stands[b].clash.push(a);
      }
  net.stands = stands;
  return net;
}

// ----------------------------------------------------------------------------
// Aircraft on the ground
// ----------------------------------------------------------------------------
/** Minutes: pushback, and the line-up from the hold-short line to the threshold. */
export const PUSH_MIN = 2;
export const LINEUP_MIN = 0.6;
/** Taxi speed, metres per minute (15 kt). */
const V_TAXI = 463;

const KT_PER_MPM = 1 / 30.87;

export interface GroundMove {
  /** Stable id of this movement. */
  key: string;
  /** Gate visit (an arrival and the next departure of the same aircraft can share one). */
  visit: string;
  /** Airline or aircraft: gates are picked near that preference. */
  pref: string;
  /** Half the aircraft's length, metres (how far it parks from the gate). */
  halfLen: number;
  kind: 'dep' | 'arr';
  /** Departure threshold, or the end of the landing roll. */
  rwy: RunwayPoint;
  /** Arrivals: the departure runway in use then (they avoid taxiing against departures). */
  flowRwy?: RunwayPoint;
  /** Departure (absolute minutes): parked from, scheduled pushback, takeoff roll. */
  parkFrom?: number;
  pushAt?: number;
  takeoffAt?: number;
  /** Arrival: end of the landing roll, parked until. */
  rollEndAt?: number;
  parkUntil?: number;
  /** Gate occupancy for allocation. */
  visitStart: number;
  visitEnd: number;
}

export type GroundState = 'gate' | 'pushback' | 'taxi' | 'hold' | 'lineup' | 'vacate' | 'arrived';

export interface GroundPose {
  key: string;
  coordinates: LonLat;
  bearing: number;
  speedKts: number;
  state: GroundState;
  phaseLabel: string;
  gate: string;
  /** Taxi route split at the aircraft, for the trail. */
  trail: () => { flown: LonLat[]; remaining: LonLat[] };
}

function pointOn(route: { pts: XY[]; cum: number[] }, along: number): { p: XY; brg: number; k: number } {
  const { pts, cum } = route;
  if (pts.length < 2) return { p: pts[0] ?? [0, 0], brg: 0, k: 0 };
  const a = Math.max(0, Math.min(cum[cum.length - 1], along));
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (cum[m] <= a) lo = m;
    else hi = m;
  }
  const seg = cum[lo + 1] - cum[lo];
  const t = seg > 0 ? (a - cum[lo]) / seg : 0;
  const A = pts[lo];
  const B = pts[lo + 1];
  return { p: [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t], brg: bearingOf(A, B), k: lo };
}


/** Where the aircraft parks at a stand: nose at the gate, along the lead-in line. */
function parkingSpot(s: Stand, halfLen: number): { c: XY; hdg: number } {
  const d = sub(s.j, s.g);
  const l = Math.hypot(d[0], d[1]);
  if (l < 8) return { c: s.g, hdg: bearingOf(s.j, s.g) || 0 };
  const off = Math.min(halfLen + 3, l * 0.7);
  const c: XY = [s.g[0] + (d[0] / l) * off, s.g[1] + (d[1] / l) * off];
  return { c, hdg: bearingOf(c, s.g) };
}

/**
 * Positions of every aircraft on the ground at one airport at `now`
 * (absolute minutes). `moves` are the movements active now; `budget.left`
 * caps how many new routes may be worked out in this call.
 */
/**
 * The whole taxi path of one movement, from the parking spot to the runway
 * (departure) or from the end of the landing roll to the parking spot
 * (arrival). Reserves the gate if it isn't given yet, so the path drawn ahead
 * of time is the one the aircraft will actually taxi.
 */
export function taxiPath(net: TaxiNetwork, m: GroundMove, now: number): LonLat[] | null {
  const n = net.stands.length;
  if (!n) return null;
  const gate = net.assignGate(m, now);
  const standIdx = gate >= 0 ? gate : hashStr(m.key) % n;
  const route = m.kind === 'dep' ? net.routeOut(standIdx, m.rwy) : net.routeIn(standIdx, m.rwy, m.flowRwy);
  if (!route) return null;
  const spot = parkingSpot(net.stands[standIdx], m.halfLen).c;
  const pts = m.kind === 'dep' ? [spot, ...route.pts] : [...route.pts, spot];
  return pts.map((q) => net.toLL(q));
}

export function groundPoses(net: TaxiNetwork, moves: GroundMove[], now: number, budget: { left: number; planMs?: number }): Map<string, GroundPose> {
  const out = new Map<string, GroundPose>();
  const n = net.stands.length;
  if (!n) return out;

  interface Plan {
    m: GroundMove;
    gate: number;
    stand: Stand;
    route: TaxiRoute;
    spot: { c: XY; hdg: number };
    pushAt: number;
    taxiStart: number;
    holdAt: number;
  }
  const plans: Plan[] = [];
  // Earlier visits first, so gates go to whoever arrived first
  const ordered = [...moves].sort((a, b) => a.visitStart - b.visitStart || (a.key < b.key ? -1 : 1));
  for (const m of ordered) {
    const gate = net.assignGate(m, now);
    // No free gate: not shown on the ground (it would have to wait on someone else's taxiway)
    if (gate < 0) continue;
    const standIdx = gate >= 0 ? gate : hashStr(m.key) % n;
    const key = m.kind === 'dep' ? `o:${standIdx}:${m.rwy.ident}` : `i:${standIdx}:${m.rwy.ident}:${m.flowRwy?.ident ?? ''}`;
    if (!net.hasRoute(key)) {
      if (budget.left <= 0) continue;
      budget.left--;
    }
    const route = m.kind === 'dep' ? net.routeOut(standIdx, m.rwy) : net.routeIn(standIdx, m.rwy, m.flowRwy);
    if (!route) continue;
    const stand = net.stands[standIdx];
    plans.push({ m, gate, stand, route, spot: parkingSpot(stand, m.halfLen), pushAt: m.pushAt ?? 0, taxiStart: 0, holdAt: route.mark });
  }

  // --- Taxi clearances ---------------------------------------------------------
  // Like a ground controller, every aircraft's taxi is planned once, before it
  // moves, against the space and time already booked by the others: it holds
  // wherever needed (at the gate, before a junction, at the hold-short line)
  // so it never meets anyone, whether ahead, crossing or coming the other way.
  // Departures are planned 25 minutes before takeoff, in takeoff order, and
  // reach the hold-short line 20–60 s before their line-up; arrivals are
  // planned as they land and fit around them. A plan never changes once made,
  // so every redraw and zoom level shows the same aircraft in the same place.
  const PLAN_AHEAD_MIN = 25;
  const pathOf = (p: Plan) => {
    const { m, route, spot, stand } = p;
    if (m.kind === 'dep') {
      if (p.gate < 0) return { pts: route.pts, cum: route.cum, lead: 0 };
      const lead = dist(spot.c, stand.j);
      return { pts: [spot.c, ...route.pts], cum: [0, ...route.cum.map((c) => c + lead)], lead };
    }
    if (p.gate < 0) return { pts: route.pts, cum: route.cum, lead: 0 };
    return { pts: [...route.pts, spot.c], cum: [...route.cum, route.len + dist(stand.j, spot.c)], lead: 0 };
  };
  const trigger = (p: Plan) => (p.m.kind === 'dep' ? p.m.takeoffAt! - PLAN_AHEAD_MIN : p.m.rollEndAt!);
  const toPlan = plans.filter((p) => !net.trajs.has(p.m.key) && now >= trigger(p)).sort((x, y) => trigger(x) - trigger(y) || (x.m.key < y.m.key ? -1 : 1));
  // Planning is the costly part: a few milliseconds per redraw, the rest next time (in the same order)
  const clockMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  for (const p of toPlan) {
    if (budget.planMs !== undefined && budget.planMs <= 0) break;
    const t0 = clockMs();
    const path = pathOf(p);
    net.trajs.set(p.m.key, planTaxi(net, p.m, path, p.holdAt));
    if (budget.planMs !== undefined) budget.planMs -= clockMs() - t0;
  }
  if (now - net.prunedAt > 1 || now < net.prunedAt) {
    net.prunedAt = now;
    net.pruneTaxi(now);
  }

  // --- Poses -----------------------------------------------------------------
  const emit = (p: Plan, state: GroundState, pos: XY, brg: number, speed: number, routeAlong: number, waiting: boolean, place = 0) => {
    const { m, route, spot, stand } = p;
    const gateRef = p.gate >= 0 ? stand.ref : '';
    const ident = m.rwy.ident;
    const via = route.via.length ? ` via ${route.via.join(', ')}` : '';
    const phaseLabel =
      state === 'gate' || state === 'arrived'
        ? gateRef
          ? `At gate ${gateRef}`
          : 'At the gate'
        : state === 'pushback'
        ? `Pushing back${gateRef ? ` from gate ${gateRef}` : ''}`
        : state === 'hold'
        ? `Holding short of runway ${ident}${place > 1 ? `, number ${place} for departure` : ''}`
        : state === 'lineup'
        ? `Lining up on runway ${ident}`
        : state === 'vacate'
        ? `Vacating runway ${ident}`
        : waiting
        ? `Holding position for traffic, then ${m.kind === 'dep' ? `runway ${ident}` : gateRef ? `gate ${gateRef}` : 'the gate'}`
        : m.kind === 'dep'
        ? `Taxiing to runway ${ident}${via}`
        : `Taxiing to ${gateRef ? `gate ${gateRef}` : 'the gate'}${via}`;
    const here = pos;
    out.set(m.key, {
      key: m.key,
      coordinates: net.toLL(pos),
      bearing: Math.round(brg),
      speedKts: Math.max(0, Math.round(speed)),
      state,
      phaseLabel,
      gate: gateRef,
      trail: () => {
        if (m.kind === 'dep') {
          if (routeAlong < 0) return { flown: [net.toLL(spot.c), net.toLL(here)], remaining: [net.toLL(here), ...route.pts.map((q) => net.toLL(q))] };
          const k = pointOn(route, routeAlong).k;
          return {
            flown: [spot.c, ...route.pts.slice(0, k + 1), here].map((q) => net.toLL(q)),
            remaining: [here, ...route.pts.slice(k + 1)].map((q) => net.toLL(q)),
          };
        }
        const full = [...route.pts, spot.c];
        if (routeAlong >= route.len) return { flown: [...route.pts, here].map((q) => net.toLL(q)), remaining: [net.toLL(here), net.toLL(spot.c)] };
        const k = pointOn(route, routeAlong).k;
        return {
          flown: [...route.pts.slice(0, k + 1), here].map((q) => net.toLL(q)),
          remaining: [here, ...full.slice(k + 1)].map((q) => net.toLL(q)),
        };
      },
    });
  };

  const holding: { p: Plan; pos: XY; brg: number; along: number; waiting: boolean }[] = [];
  for (const p of plans) {
    const { m, spot, stand } = p;
    const tr = net.trajs.get(m.key);
    if (m.kind === 'dep') {
      const T = m.takeoffAt!;
      if (!tr) {
        // Not planned yet: parked if its taxi isn't due; otherwise it shows once planned (a redraw later)
        if (now >= trigger(p)) continue;
        if (p.gate >= 0 && (m.parkFrom === undefined || now >= m.parkFrom)) emit(p, 'gate', spot.c, spot.hdg, 0, -1, false);
        continue;
      }
      const { a, speed } = trajAt(tr, now);
      if (now >= T || a >= tr.len - 0.5) continue; // rolling: drawn by the flight model (never both)
      if (now < tr.t[0] || a <= 0.01) {
        if (p.gate >= 0 && (m.parkFrom === undefined || now >= m.parkFrom)) emit(p, 'gate', spot.c, spot.hdg, 0, -1, false);
        continue;
      }
      if (a < tr.lead) {
        const f = a / Math.max(1, tr.lead);
        emit(p, 'pushback', [spot.c[0] + (stand.j[0] - spot.c[0]) * f, spot.c[1] + (stand.j[1] - spot.c[1]) * f], spot.hdg, 3, -1, false);
        continue;
      }
      const ra = a - tr.lead;
      const o = pointOn(p.route, ra);
      if (now >= tr.lineupFrom && ra >= p.holdAt - 0.5) {
        const brg = p.route.len - ra < 15 ? m.rwy.hdg : o.brg; // aligned for the roll
        emit(p, 'lineup', o.p, brg, speed, ra, false);
      } else if (speed < 0.5) holding.push({ p, pos: o.p, brg: o.brg, along: ra, waiting: ra < p.holdAt - 0.5 });
      else emit(p, 'taxi', o.p, o.brg, speed, ra, false);
    } else {
      if (!tr) continue;
      const { a, speed } = trajAt(tr, now);
      if (a >= tr.len - 0.5) {
        if (p.gate < 0 || now > (m.parkUntil ?? 0)) continue;
        emit(p, 'arrived', spot.c, spot.hdg, 0, tr.len, false);
        continue;
      }
      if (a > p.route.len) {
        const f = (a - p.route.len) / Math.max(1, tr.len - p.route.len);
        emit(p, 'taxi', [stand.j[0] + (spot.c[0] - stand.j[0]) * f, stand.j[1] + (spot.c[1] - stand.j[1]) * f], spot.hdg, speed, a, false);
        continue;
      }
      const o = pointOn(p.route, a);
      emit(p, a < p.route.mark ? 'vacate' : 'taxi', o.p, o.brg, speed, a, speed < 0.5 && a > p.route.mark);
    }
  }
  // Holding aircraft: in the queue for the runway, numbered in takeoff order
  const places = new Map<string, number>();
  holding.sort((x, y) => x.p.m.takeoffAt! - y.p.m.takeoffAt!);
  for (const h of holding) {
    const id = h.p.m.rwy.ident;
    const nearHold = h.p.holdAt - h.along < 400;
    const place = (places.get(id) ?? 0) + 1;
    if (nearHold) places.set(id, place);
    emit(h.p, nearHold ? 'hold' : 'taxi', h.pos, h.brg, 0, h.along, !nearHold, place);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Taxi planning: space–time bookings on a fine grid
// ----------------------------------------------------------------------------
/** A planned taxi: distance along the path against time (minutes), as a broken line. */
export interface TaxiTrajectory {
  t: number[];
  a: number[];
  len: number;
  /** Length of the pushback at the start of a departure's path. */
  lead: number;
  /** When the line-up from the hold-short line starts (departures). */
  lineupFrom: number;
}

const CELL_M = 15;
const STEP_M = 12;
const PAD_MIN = 0.03;
// Small integer keys (airports are well under 50 km across) keep the map fast
const cellKey = (cx: number, cy: number) => (cx + 5_000) * 10_000 + (cy + 5_000);

function trajAt(tr: TaxiTrajectory, now: number): { a: number; speed: number } {
  const { t, a } = tr;
  if (now <= t[0]) return { a: a[0], speed: 0 };
  if (now >= t[t.length - 1]) return { a: a[a.length - 1], speed: 0 };
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (t[m] <= now) lo = m;
    else hi = m;
  }
  const dt = t[hi] - t[lo];
  const f = dt > 0 ? (now - t[lo]) / dt : 1;
  const speed = dt > 0 ? ((a[hi] - a[lo]) / dt) * KT_PER_MPM : 0;
  return { a: a[lo] + (a[hi] - a[lo]) * f, speed };
}

/**
 * Plans one aircraft's taxi along `path` against the bookings already made at
 * this airport, then books its own. Waiting is allowed at the start (at the
 * gate or at the end of the landing roll) and anywhere the spot it waits on is
 * not needed by someone else meanwhile; otherwise it waits further back.
 */
function planTaxi(net: TaxiNetwork, m: GroundMove, path: { pts: XY[]; cum: number[]; lead: number }, holdAt: number): TaxiTrajectory {
  const len = path.cum[path.cum.length - 1];
  const lead = path.lead;
  const dep = m.kind === 'dep';
  const holdA = dep ? lead + holdAt : Infinity;
  // Waypoints every few metres, plus the pushback end and the hold-short line
  const wp: number[] = [];
  for (let d = 0; d < len; d += STEP_M) wp.push(d);
  if (dep && lead > 0) wp.push(lead);
  if (dep) wp.push(holdA);
  wp.push(len);
  const uniq = [...new Set(wp.map((d) => Math.round(Math.min(len, d) * 100) / 100))].sort((x, y) => x - y);
  const N = uniq.length;
  const holdIdx = dep ? uniq.findIndex((d) => d >= holdA - 0.01) : -1;
  const vPush = Math.max(5, lead / PUSH_MIN);
  const vLine = dep ? Math.max(60, (len - holdA) / LINEUP_MIN) : V_TAXI;
  // A departure held up on the way lines up quicker to make its slot
  let lineSpeed = vLine;
  const speedFrom = (k: number) => (dep && uniq[k] < lead - 0.01 ? vPush : dep && uniq[k] >= holdA - 0.01 ? lineSpeed : V_TAXI);
  const travel = (k: number) => (uniq[k + 1] - uniq[k]) / speedFrom(k);
  // Cells each waypoint covers (about the aircraft's size)
  const r = m.halfLen * 0.6 + 5;
  const cells: number[][] = uniq.map((d) => {
    const q = pointOn(path, d).p;
    const out: number[] = [];
    for (let cx = Math.floor((q[0] - r) / CELL_M); cx <= Math.floor((q[0] + r) / CELL_M); cx++)
      for (let cy = Math.floor((q[1] - r) / CELL_M); cy <= Math.floor((q[1] + r) / CELL_M); cy++) out.push(cellKey(cx, cy));
    return out;
  });
  // The start (gate, end of the landing roll) is a free place to wait; so is the runway after the hold line
  const unchecked = (k: number) => k === 0 || (dep && k > holdIdx);
  const busy = (k: number) => cells[k].flatMap((c) => net.bookings.get(c) ?? []);
  const isFree = (k: number, t0: number, t1: number) => {
    for (const c of cells[k]) {
      const list = net.bookings.get(c);
      if (!list) continue;
      for (let i = 0; i < list.length; i += 2) if (list[i] - PAD_MIN < t1 && list[i + 1] + PAD_MIN > t0) return false;
    }
    return true;
  };
  const earliestFree = (k: number, s0: number, dur: number) => {
    const flat = busy(k);
    const ivs: [number, number][] = [];
    for (let i = 0; i < flat.length; i += 2) if (flat[i + 1] + PAD_MIN > s0) ivs.push([flat[i] - PAD_MIN, flat[i + 1] + PAD_MIN]);
    ivs.sort((x, y) => x[0] - y[0]);
    let s = s0;
    for (const [b0, b1] of ivs) {
      if (b0 >= s + dur) break;
      if (b1 > s) s = b1;
    }
    return s;
  };

  // Ideal start: departures reach the hold-short line 20–60 s before line-up
  const T = m.takeoffAt ?? 0;
  const lineupAt = T - LINEUP_MIN;
  const wait = 0.35 + ((hashStr(m.key) % 100) / 100) * 0.65;
  const start = dep ? lineupAt - wait - holdAt / V_TAXI - (lead > 0 ? PUSH_MIN : 0) : m.rollEndAt!;
  const search = (startAt: number) => {
  const arrive = new Float64Array(N);
  const leave = new Float64Array(N);
  const minLeave = new Float64Array(N).fill(-Infinity);
  if (holdIdx >= 0) minLeave[holdIdx] = lineupAt;
  arrive[0] = startAt;
  lineSpeed = vLine;
  let k = 0;
  let guard = 0;
  while (k < N - 1 && guard++ < 3000) {
    const tr = travel(k);
    let tl = Math.max(arrive[k], minLeave[k]);
    if (!unchecked(k + 1)) {
      const trNext = k + 2 < N ? travel(k + 1) : tr;
      if (!isFree(k + 1, tl + tr, tl + tr + trNext)) tl = earliestFree(k + 1, tl + tr, trNext) - tr;
    }
    // Waiting here: the spot must stay free meanwhile, or wait further back
    if (!unchecked(k) && tl > arrive[k] + 1e-6 && !isFree(k, arrive[k], tl + tr)) {
      minLeave[k - 1] = Math.max(minLeave[k - 1], leave[k - 1] + Math.max(0.02, tl - arrive[k]));
      k--;
      continue;
    }
    leave[k] = tl;
    if (k === holdIdx) {
      lineSpeed = Math.max(vLine, Math.min(vLine * 4, (len - holdA) / Math.max(0.12, (m.takeoffAt ?? 0) - tl)));
      arrive[k + 1] = tl + travel(k);
    } else arrive[k + 1] = tl + tr;
    k++;
  }
  if (k < N - 1) {
    // Gave up (very rare): carry on at taxi speed from where it got to
    for (; k < N - 1; k++) {
      leave[k] = Math.max(arrive[k], minLeave[k]);
      arrive[k + 1] = leave[k] + travel(k);
    }
  }
  leave[N - 1] = arrive[N - 1];
  return { arrive, leave, line: lineSpeed };
  };
  // A departure that would miss its slot pushes back earlier instead (and waits at the hold line)
  let best = search(start);
  if (dep) {
    for (let tries = 0; tries < 3; tries++) {
      const late = best.arrive[N - 1] - T;
      if (late <= 0.02) break;
      const earlier = start - late * (tries + 1) * 1.2 - 0.5;
      if (m.parkFrom !== undefined && earlier < m.parkFrom) break;
      const alt = search(earlier);
      if (alt.arrive[N - 1] < best.arrive[N - 1]) best = alt;
    }
  }
  const { arrive, leave } = best;
  lineSpeed = best.line;
  // Book the space it uses (not the stand it starts from)
  for (let i = dep && lead > 0 ? 1 : 0; i < N; i++) {
    const t0 = arrive[i];
    const t1 = (i < N - 1 ? leave[i] + travel(i) : arrive[i] + (dep ? 0.1 : 0.3));
    for (const c of cells[i]) {
      const list = net.bookings.get(c);
      if (list) list.push(t0, t1);
      else net.bookings.set(c, [t0, t1]);
    }
  }
  const t: number[] = [];
  const a: number[] = [];
  for (let i = 0; i < N; i++) {
    t.push(arrive[i]);
    a.push(uniq[i]);
    if (leave[i] > arrive[i] + 1e-9) {
      t.push(leave[i]);
      a.push(uniq[i]);
    }
  }
  return { t, a, len, lead, lineupFrom: holdIdx >= 0 ? leave[holdIdx] : Infinity };
}

// ----------------------------------------------------------------------------
// Networks per airport, built from whatever tiles the map has loaded
// ----------------------------------------------------------------------------
export interface TaxiAirportRef {
  iata: string;
  lon: number;
  lat: number;
  radiusM: number;
  runways: RunwayCenterline[];
}

const NET_LIMIT = 40;

export class TaxiRegistry {
  private nets = new Map<string, TaxiNetwork>();
  private sigs = new Map<string, number>();

  get(iata: string): TaxiNetwork | undefined {
    const n = this.nets.get(iata);
    if (n) {
      this.nets.delete(iata);
      this.nets.set(iata, n);
    }
    return n;
  }

  /** A network built from the airport's complete layout (all its tiles), not just what was in view. */
  isComplete(iata: string) {
    return this.sigs.get(iata) === Infinity && this.nets.has(iata);
  }

  /** Builds a network from the airport's complete layout, fetched tile by tile. */
  addComplete(ap: TaxiAirportRef, feats: AerowayFeature[]): boolean {
    const net = buildTaxiNetwork(ap.iata, [ap.lon, ap.lat], ap.radiusM, feats, ap.runways);
    this.sigs.set(ap.iata, Infinity);
    if (!net) return false;
    this.nets.delete(ap.iata);
    this.nets.set(ap.iata, net);
    while (this.nets.size > NET_LIMIT) {
      const first = this.nets.keys().next().value as string;
      this.nets.delete(first);
      this.sigs.delete(first);
    }
    return true;
  }

  get size() {
    return this.nets.size;
  }

  /**
   * (Re)builds networks for airports whose loaded tiles now show more of the
   * layout than last time. Returns the IATA codes rebuilt. Stops after
   * `maxMs` (the rest follow on the next call).
   */
  ingest(airports: TaxiAirportRef[], feats: AerowayFeature[], maxMs = 15): string[] {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const boxes = feats.map((f) => {
      let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
      for (const c of f.coords) {
        if (c[0] < w) w = c[0];
        if (c[0] > e) e = c[0];
        if (c[1] < s) s = c[1];
        if (c[1] > n) n = c[1];
      }
      return [w, e, s, n];
    });
    const rebuilt: string[] = [];
    for (const ap of airports) {
      const dLat = ap.radiusM / M_PER_DEG;
      const dLon = dLat / Math.max(0.1, Math.cos(ap.lat * D2R));
      const mine: AerowayFeature[] = [];
      let sig = 0;
      feats.forEach((f, i) => {
        const b = boxes[i];
        if (b[1] < ap.lon - dLon || b[0] > ap.lon + dLon || b[3] < ap.lat - dLat || b[2] > ap.lat + dLat) return;
        if (f.kind === 'line' && TAXI_CLASSES.has(f.cls)) {
          mine.push(f);
          sig += f.coords.length;
        } else if (GATE_CLASSES.has(f.cls)) {
          mine.push(f);
          sig += 20;
        } else if (f.kind === 'polygon' && f.cls === 'apron') {
          mine.push(f);
          sig += 5;
        }
      });
      const old = this.sigs.get(ap.iata) ?? 0;
      if (sig < 30 || sig <= old * 1.03) continue;
      this.sigs.set(ap.iata, sig);
      const net = buildTaxiNetwork(ap.iata, [ap.lon, ap.lat], ap.radiusM, mine, ap.runways);
      if (net) {
        this.nets.delete(ap.iata);
        this.nets.set(ap.iata, net);
        while (this.nets.size > NET_LIMIT) {
          const first = this.nets.keys().next().value as string;
          this.nets.delete(first);
          this.sigs.delete(first);
        }
        rebuilt.push(ap.iata);
      }
      const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (t - t0 > maxMs) break;
    }
    return rebuilt;
  }
}
