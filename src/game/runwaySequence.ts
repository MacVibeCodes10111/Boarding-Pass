// ============================================================================
// YOUR FLIGHTS ON THE RUNWAY (v2.47+)
//
// Other airlines' flights already take turns on each runway (sequenced when
// their schedule is built). Your flights are fitted around them, and around
// each other, first come first served: a departure waits at the hold-short
// line for a gap, an arrival is held on the approach (it lands a little
// later). Only one aircraft is on a runway at a time (runwayUse.ts). Where
// the network fills a runway completely, other airlines' flights in the way
// of yours don't operate that day (aiSuppressed).
//
// Busy airports use several runways at once (navdata.runwayLanes): each of
// your flights takes the one free first. Worked out per airport and day, when
// first needed, and kept: the same flight always gets the same wait and
// runway, at every zoom level and in every view.
// ============================================================================
import { aiTaxiMin, type AiFlight, type AiTraffic } from './aiTraffic';
import { arrStop, depRunway, type AiAirportIndex } from './groundTraffic';
import { NO_LANES, playerRollMinutes, playerTaxiMin, runwayAt, runwayLanes, runwayPairKey, type RunwayLaneChoice, type RunwaySlots } from './navdata';
import { AI_ARR_ROLL_MIN, AI_DEP_ROLL_MIN, bookInterval, earliestFit, RUNWAY_BUFFER_MIN, runwayOccupancy, type RunwayInterval } from './runwayUse';
import { dayIndexOf, daysOrAll, MIN_PER_DAY } from './time';
import type { Airport, ScheduledFlight } from './types';

export interface SequencerAi {
  traffic: AiTraffic;
  index: AiAirportIndex;
  byIata: Map<string, number>;
  /** Only the other airlines' flights shown on the map take part. */
  keep: (f: AiFlight) => boolean;
}

/** Movements starting this long before a day are sequenced with it, so a queue carries over midnight. */
const WARM_UP_MIN = 180;
/** Longest wait for a departure (minutes), and its share of the flight time at most. */
const MAX_DEP_WAIT_MIN = 20;
const MAX_DEP_WAIT_SHARE = 0.35;

const NONE: RunwaySlots = { dep: 0, arr: 0 };
/** Other airlines' runway times this long after (or before) one of yours can affect it. */
const NEAR_AFTER_MIN = MAX_DEP_WAIT_MIN + 10;
const NEAR_BEFORE_MIN = 10;

/** A booked stretch of runway time; `ai` names another airline's flight-day ("id:depDay"). */
type Booking = RunwayInterval & { ai?: string };

export class RunwaySequencer {
  private readonly byOrigin = new Map<string, ScheduledFlight[]>();
  private readonly byDest = new Map<string, ScheduledFlight[]>();
  private readonly days = new Map<string, Map<string, { wait: number; lane: number }>>();
  /**
   * Other airlines' flight-days that don't operate: at a few airports the
   * network fills the runway at the busiest hours, and one of your flights
   * with no turn within its longest wait goes first (theirs are only scenery).
   */
  private readonly suppressed = new Set<string>();
  /** Days worked out (for tests and the stats). */
  computed = 0;

  constructor(flights: readonly ScheduledFlight[], private readonly ai: SequencerAi | null) {
    for (const f of flights) {
      (this.byOrigin.get(f.origin.iata_code) ?? this.byOrigin.set(f.origin.iata_code, []).get(f.origin.iata_code)!).push(f);
      (this.byDest.get(f.destination.iata_code) ?? this.byDest.set(f.destination.iata_code, []).get(f.destination.iata_code)!).push(f);
    }
  }

  /** How long one departure of a flight waits for the runway at each end. */
  slots(f: ScheduledFlight, depDay: number): RunwaySlots {
    const taxi = playerTaxiMin(f.blockTimeMin);
    const D = depDay * MIN_PER_DAY + f.depTimeMin;
    const T = D + taxi.out;
    const R = D + f.blockTimeMin - taxi.in;
    const dep = this.dayOf(f.origin, Math.floor(T / MIN_PER_DAY)).get(`${f.id}:${depDay}:d`)?.wait ?? 0;
    const arr = this.dayOf(f.destination, Math.floor(R / MIN_PER_DAY)).get(`${f.id}:${depDay}:a`)?.wait ?? 0;
    return dep || arr ? { dep, arr } : NONE;
  }

  /** Which of the runways in use one departure of a flight takes off from and lands on. */
  lanes(f: ScheduledFlight, depDay: number): RunwayLaneChoice {
    const taxi = playerTaxiMin(f.blockTimeMin);
    const D = depDay * MIN_PER_DAY + f.depTimeMin;
    const dep = this.dayOf(f.origin, Math.floor((D + taxi.out) / MIN_PER_DAY)).get(`${f.id}:${depDay}:d`)?.lane ?? 0;
    const arr = this.dayOf(f.destination, Math.floor((D + f.blockTimeMin - taxi.in) / MIN_PER_DAY)).get(`${f.id}:${depDay}:a`)?.lane ?? 0;
    return dep || arr ? { dep, arr } : NO_LANES;
  }

  /** True when another airline's flight (departed on `depDay`) gives way to yours and isn't shown. */
  aiSuppressed(f: AiFlight, depDay: number): boolean {
    const ai = this.ai;
    if (!ai) return false;
    const tx = aiTaxiMin(f);
    const o = this.airportOf(ai.traffic.airports[f.o].iata);
    if (o) this.dayOf(o, Math.floor((depDay * MIN_PER_DAY + f.depUtcMin + tx) / MIN_PER_DAY));
    const d = this.airportOf(ai.traffic.airports[f.d].iata);
    if (d) this.dayOf(d, Math.floor((depDay * MIN_PER_DAY + f.depUtcMin + f.blockMin - tx) / MIN_PER_DAY));
    return this.suppressed.size > 0 && this.suppressed.has(`${f.id}:${depDay}`);
  }

  /** One of your airports (its Airport record), or undefined. */
  private airportOf(iata: string): Airport | undefined {
    return this.byOrigin.get(iata)?.[0].origin ?? this.byDest.get(iata)?.[0].destination;
  }

  private dayOf(ap: Airport, day: number): Map<string, { wait: number; lane: number }> {
    const key = `${ap.iata_code}:${day}`;
    let m = this.days.get(key);
    if (!m) {
      m = this.sequence(ap, day);
      if (this.days.size > 4000) this.days.clear();
      this.days.set(key, m);
      this.computed++;
    }
    return m;
  }

  private sequence(ap: Airport, day: number): Map<string, { wait: number; lane: number }> {
    const out = new Map<string, { wait: number; lane: number }>();
    const deps = this.byOrigin.get(ap.iata_code) ?? [];
    const arrs = this.byDest.get(ap.iata_code) ?? [];
    if (!deps.length && !arrs.length) return out;
    const from = day * MIN_PER_DAY - WARM_UP_MIN;
    const to = (day + 1) * MIN_PER_DAY;
    const strips = new Map<string, Booking[]>();
    const strip = (k: string) => strips.get(k) ?? strips.set(k, []).get(k)!;
    const pairs = new Map<string, string>();
    const pair = (ident: string) => pairs.get(ident) ?? pairs.set(ident, runwayPairKey(ap, ident)).get(ident)!;

    // Yours, first come first served
    interface Mv {
      key: string;
      t: number;
      /** The runway of each lane it may use. */
      strips: string[];
      occ: [number, number];
      maxWait: number;
      id: string;
    }
    const mv: Mv[] = [];
    const lanes = runwayLanes(ap);
    for (const f of deps) {
      const days = daysOrAll(f.daysOfWeek);
      const taxi = playerTaxiMin(f.blockTimeMin);
      const airMin = Math.max(1, f.blockTimeMin - taxi.out - taxi.in);
      for (let dd = -1; dd <= 1; dd++) {
        const depDay = day + dd;
        if (!days[dayIndexOf(depDay)]) continue;
        const T = depDay * MIN_PER_DAY + f.depTimeMin + taxi.out;
        if (T < from || T >= to) continue;
        mv.push({
          key: `${f.id}:${depDay}:d`,
          t: T,
          strips: Array.from({ length: lanes.dep }, (_, l) => pair(runwayAt(ap, depDay, f.depTimeMin + taxi.out, 'departure', l).ident)),
          occ: runwayOccupancy('dep', playerRollMinutes(f, depDay).dep),
          maxWait: Math.min(MAX_DEP_WAIT_MIN, airMin * MAX_DEP_WAIT_SHARE),
          id: f.id,
        });
      }
    }
    for (const f of arrs) {
      const days = daysOrAll(f.daysOfWeek);
      const taxi = playerTaxiMin(f.blockTimeMin);
      for (let dd = -2; dd <= 1; dd++) {
        const depDay = day + dd;
        if (!days[dayIndexOf(depDay)]) continue;
        const R = depDay * MIN_PER_DAY + f.depTimeMin + f.blockTimeMin - taxi.in;
        if (R < from || R >= to) continue;
        mv.push({
          key: `${f.id}:${depDay}:a`,
          t: R,
          strips: Array.from({ length: lanes.arr }, (_, l) => pair(runwayAt(ap, depDay, f.depTimeMin + f.blockTimeMin - taxi.in, 'arrival', l).ident)),
          occ: runwayOccupancy('arr', playerRollMinutes(f, depDay).arr),
          // It must still reach the gate within its block time
          maxWait: Math.max(0, taxi.in - 0.5),
          id: f.id,
        });
      }
    }
    // Other airlines' runway times: fixed. Only those near one of yours matter
    // (yours wait 20 minutes at most), which keeps this quick at busy airports
    const times = mv.map((m) => m.t).sort((x, y) => x - y);
    const near = (t: number) => {
      let lo = 0;
      let hi = times.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] < t - NEAR_AFTER_MIN) lo = mid + 1;
        else hi = mid;
      }
      return lo < times.length && times[lo] <= t + NEAR_BEFORE_MIN;
    };
    const ai = this.ai;
    const apIdx = ai?.byIata.get(ap.iata_code);
    if (ai && apIdx !== undefined && times.length) {
      const dOcc = runwayOccupancy('dep', AI_DEP_ROLL_MIN);
      const aOcc = runwayOccupancy('arr', AI_ARR_ROLL_MIN);
      for (const f of ai.index.deps[apIdx]) {
        if (!ai.keep(f)) continue;
        for (let dd = -1; dd <= 1; dd++) {
          const depDay = day + dd;
          if (!(f.daysMask & (1 << dayIndexOf(depDay)))) continue;
          const T = depDay * MIN_PER_DAY + f.depUtcMin + aiTaxiMin(f);
          if (T + dOcc[1] < from - 30 || T + dOcc[0] > to + 30 || !near(T)) continue;
          strip(pair(depRunway(ap, depDay, f.depUtcMin + aiTaxiMin(f), f.depLane ?? 0).ident)).push({ from: T + dOcc[0], to: T + dOcc[1], ai: `${f.id}:${depDay}` });
        }
      }
      for (const f of ai.index.arrs[apIdx]) {
        if (!ai.keep(f)) continue;
        for (let dd = -2; dd <= 1; dd++) {
          const depDay = day + dd;
          if (!(f.daysMask & (1 << dayIndexOf(depDay)))) continue;
          const arrMin = f.depUtcMin + f.blockMin - aiTaxiMin(f);
          const R = depDay * MIN_PER_DAY + arrMin;
          if (R + aOcc[1] < from - 30 || R + aOcc[0] > to + 30 || !near(R)) continue;
          strip(pair(arrStop(ap, depDay, arrMin, f.arrLane ?? 0).ident)).push({ from: R + aOcc[0], to: R + aOcc[1], ai: `${f.id}:${depDay}` });
        }
      }
      for (const list of strips.values()) list.sort((a, b) => a.from - b.from);
    }

    mv.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || (a.key < b.key ? -1 : 1));
    for (const m of mv) {
      // The runway free first (the first one when equal)
      let lane = 0;
      let wait = Infinity;
      m.strips.forEach((k, l) => {
        const w = earliestFit(strip(k), m.t, m.occ[0], m.occ[1], m.maxWait);
        if (w < wait - 1e-9) {
          wait = w;
          lane = l;
        }
      });
      if (!Number.isFinite(wait)) {
        // No gap within its longest wait (a runway the network fills): the first time
        // free of your other flights, and other airlines' aircraft in the way don't operate
        m.strips.forEach((k, l) => {
          const w = earliestFit(strip(k).filter((b) => !b.ai), m.t, m.occ[0], m.occ[1], m.maxWait);
          if (w < wait - 1e-9) {
            wait = w;
            lane = l;
          }
        });
        if (!Number.isFinite(wait)) wait = 0;
        const list = strip(m.strips[lane]);
        const a = m.t + wait + m.occ[0] - RUNWAY_BUFFER_MIN;
        const b = m.t + wait + m.occ[1] + RUNWAY_BUFFER_MIN;
        for (let i = list.length - 1; i >= 0; i--) {
          const iv = list[i];
          if (iv.ai && iv.from < b && iv.to > a) {
            this.suppressed.add(iv.ai);
            list.splice(i, 1);
          }
        }
      }
      bookInterval(strip(m.strips[lane]), { from: m.t + wait + m.occ[0], to: m.t + wait + m.occ[1] });
      if ((wait > 0.001 || lane > 0) && m.t >= day * MIN_PER_DAY) out.set(m.key, { wait: Math.round(wait * 1000) / 1000, lane });
    }
    return out;
  }
}
