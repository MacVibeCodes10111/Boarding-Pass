// ============================================================================
// TWO CLOCKS
//   • Map clock     — real-world UTC, purely cosmetic (where planes are drawn).
//   • Economy clock — game time that drives money. 1 game week = 1 real day
//                     (7× real time). Keeps running while the app is closed
//                     and is settled on the next launch ("catch-up").
// ============================================================================
import { dailyLeaseOf } from './leasing';
import { MIN_PER_DAY, MIN_PER_WEEK, daysOrAll } from './time';
import type { FlightEconomics } from './economics';
import type { BankLoan, PlayerAircraft, ScheduledFlight } from './types';

// ---------------------------------------------------------------------------
// Map clock (real UTC)
// ---------------------------------------------------------------------------
/** 1970-01-05 00:00 UTC was a Monday; counting days from it gives Mon = day 1. */
const MONDAY_EPOCH_MS = Date.UTC(1970, 0, 5);
const MS_PER_DAY = 86_400_000;

export interface UtcClock {
  nowMs: number;
  /**
   * Day counter whose weekday matches the real UTC weekday (dayIndexOf(day) is
   * 0 on Mondays). Pass it wherever the map/weather code expects a "sim day".
   */
  day: number;
  /** Fractional minutes since 00:00 UTC. */
  min: number;
  /** Real UTC day of month (for METAR strings). */
  dayOfMonth: number;
}

export function utcClockAt(nowMs: number): UtcClock {
  const sinceEpoch = nowMs - MONDAY_EPOCH_MS;
  const day = Math.floor(sinceEpoch / MS_PER_DAY) + 1;
  const min = (sinceEpoch - (day - 1) * MS_PER_DAY) / 60_000;
  return { nowMs, day, min, dayOfMonth: new Date(nowMs).getUTCDate() };
}

/** Map speed: real UTC, or 7× following the economy clock. */
export type MapSpeed = 'live' | 'x7';

/**
 * The economy clock dressed as a map clock, for the 7× map. Economy day 1 is a
 * Monday, so weekdays line up with the schedule's day-of-week flags.
 */
export function econMapClock(econMin: number, nowMs: number): UtcClock {
  const day = Math.floor(econMin / MIN_PER_DAY) + 1;
  return { nowMs, day, min: econMin - (day - 1) * MIN_PER_DAY, dayOfMonth: ((day - 1) % 28) + 1 };
}

// ---------------------------------------------------------------------------
// Economy clock
// ---------------------------------------------------------------------------
export type EconomySpeed = 'paused' | 'normal' | 'test';

/** Game minutes that pass per real second at each speed. */
export const ECONOMY_RATE: Record<EconomySpeed, number> = {
  paused: 0,
  normal: MIN_PER_WEEK / 86_400, // 1 week per real day = 7× real time (~0.117 game-min/s)
  test: MIN_PER_WEEK / 600, // 1 week per 10 real minutes (testing only)
};

/** Longest stretch of game time settled after the app was closed. */
export const MAX_CATCH_UP_GAME_MIN = 4 * MIN_PER_WEEK;

/** One-off money movements, booked into the week they happen in (v2.29+). */
export type CashFlowKind = 'loan' | 'repay' | 'purchase' | 'sale' | 'grant' | 'bailout';
export const CASH_FLOW_LABELS: Record<CashFlowKind, string> = {
  loan: 'Loans drawn',
  repay: 'Extra loan repayments',
  purchase: 'Aircraft and hubs bought',
  sale: 'Aircraft and hubs sold',
  grant: 'Bank grants',
  bailout: 'Debts cleared by the bank',
};

export interface WeekLedger {
  week: number; // 1-based
  flightProfit: number; // operating profit of all flights
  leaseCost: number; // positive number = money paid out
  /** Loan instalments paid (v2.8+): principal and interest. */
  loanCost?: number;
  /** The interest part of loanCost (v2.29+). */
  interestCost?: number;
  /** Interest charged on an overdrawn account (v2.29+). */
  overdraftCost?: number;
  /** One-off money in (+) and out (−) by kind (v2.29+). */
  flows?: Partial<Record<CashFlowKind, number>>;
  /** Balances when the week closed (v2.29+). */
  cashEnd?: number;
  debtEnd?: number;
}

/**
 * Net profit: flights less leases and interest. Repaying a loan's principal
 * isn't a cost (it lowers the debt), so only the interest part of instalments
 * counts. Weeks from before v2.29 didn't split it out, so they count the whole
 * instalment as before.
 */
export const ledgerNet = (w: WeekLedger) =>
  w.flightProfit - w.leaseCost - (w.interestCost ?? w.loanCost ?? 0) - (w.overdraftCost ?? 0);

/** One-off money in and out during the week, net. */
export const ledgerOneOffs = (w: WeekLedger) => Object.values(w.flows ?? {}).reduce((s, v) => s + (v ?? 0), 0);

/**
 * Cash flow: every dollar in less every dollar out during the week, so it is
 * exactly how much the cash balance moved. Includes full loan instalments,
 * loans drawn, purchases, sales and grants.
 */
export const ledgerCashFlow = (w: WeekLedger) =>
  w.flightProfit - w.leaseCost - (w.loanCost ?? 0) - (w.overdraftCost ?? 0) + ledgerOneOffs(w);

/** Books a one-off amount (+ in, − out) into a week. */
export const bookFlow = (w: WeekLedger, kind: CashFlowKind, amount: number): WeekLedger =>
  amount === 0 ? w : { ...w, flows: { ...w.flows, [kind]: (w.flows?.[kind] ?? 0) + amount } };

/** Yearly rate charged on an overdrawn account, %. */
export const OVERDRAFT_RATE_PCT = 18;

/** Economy time is stored as total game minutes since the career began. */
export const econDayOf = (econMin: number) => Math.floor(econMin / MIN_PER_DAY) + 1;
export const econWeekOf = (econMin: number) => Math.floor(econMin / MIN_PER_WEEK) + 1;
export const econDayOfWeek = (econMin: number) => Math.floor((econMin % MIN_PER_WEEK) / MIN_PER_DAY) + 1; // 1..7
export const econMinOfDay = (econMin: number) => econMin % MIN_PER_DAY;

/** Converts the v2.2 save fields (simDay + simMin) into total economy minutes. */
export const econMinFromLegacy = (simDay: number, simMin: number) =>
  Math.max(0, (Math.max(1, simDay) - 1) * MIN_PER_DAY + Math.max(0, simMin));

/** Share of a flat-rate loan's repayments that is interest. */
export const loanInterestShare = (l: BankLoan) => (l.totalRepayable > 0 ? Math.max(0, (l.totalRepayable - l.principal) / l.totalRepayable) : 0);
/** Principal still owed on a loan. */
export const loanPrincipalLeft = (l: BankLoan) => (l.totalRepayable > 0 ? Math.max(0, l.principal * (1 - l.paid / l.totalRepayable)) : 0);

export interface EconomyRates {
  /** Sum of every flight's profit × departures per week. */
  weeklyFlightProfit: number;
  /** Lease payments per game day. */
  dailyLeaseCost: number;
}

/**
 * The airline's regular cash flow per week at today's schedule: flights, less
 * leases, loan instalments and (when overdrawn) overdraft interest. One-offs
 * such as purchases aren't in it.
 */
export function weeklyCashFlowRate(rates: EconomyRates, loans: BankLoan[], cash: number) {
  const instalments = loans.filter((l) => l.paid < l.totalRepayable).reduce((s, l) => s + l.weeklyPayment, 0);
  const leases = rates.dailyLeaseCost * 7;
  const overdraft = cash < 0 ? (-cash * OVERDRAFT_RATE_PCT) / 100 / 52 : 0;
  return { flights: rates.weeklyFlightProfit, leases, instalments, overdraft, net: rates.weeklyFlightProfit - leases - instalments - overdraft };
}

export function computeEconomyRates(
  schedule: ScheduledFlight[],
  econById: Map<string, FlightEconomics>,
  fleet: PlayerAircraft[]
): EconomyRates {
  const weeklyFlightProfit = schedule.reduce(
    (sum, fl) => sum + (econById.get(fl.id)?.profit ?? 0) * daysOrAll(fl.daysOfWeek).filter(Boolean).length,
    0
  );
  const dailyLeaseCost = fleet.reduce((s, a) => s + dailyLeaseOf(a), 0);
  return { weeklyFlightProfit, dailyLeaseCost };
}

export interface EconomyAdvance {
  econMin: number;
  /** Ledger for the week now in progress. */
  current: WeekLedger;
  /** Weeks that finished during this advance, oldest first. */
  closedWeeks: WeekLedger[];
  cashDelta: number;
  flightProfit: number;
  leaseCost: number;
  loanCost: number;
  /** Interest part of loanCost. */
  interestCost: number;
  overdraftCost: number;
  /** Loans after this advance's instalments (finished ones have paid === totalRepayable). */
  loans: BankLoan[];
  /** Loans that were paid off during this advance. */
  finishedLoans: BankLoan[];
}

/**
 * Moves the economy forward by `deltaMin` game minutes at constant rates,
 * splitting the money into weekly ledgers. Used both for live ticks and for
 * the lump-sum catch-up after the app was closed.
 */
export function advanceEconomy(
  econMin: number,
  current: WeekLedger,
  deltaMin: number,
  rates: EconomyRates,
  loansIn: BankLoan[] = [],
  /** Cash at the start: an overdrawn account is charged interest, and closed weeks record their balances. */
  cashIn?: number
): EconomyAdvance {
  const closedWeeks: WeekLedger[] = [];
  let t = econMin;
  const week = econWeekOf(econMin);
  const fresh = (w: number): WeekLedger => ({ week: w, flightProfit: 0, leaseCost: 0, loanCost: 0, interestCost: 0, overdraftCost: 0 });
  let ledger: WeekLedger =
    current.week === week ? { ...current, loanCost: current.loanCost ?? 0, interestCost: current.interestCost ?? 0, overdraftCost: current.overdraftCost ?? 0 } : fresh(week);
  let cash = cashIn ?? 0;
  const overdraftPerMin = OVERDRAFT_RATE_PCT / 100 / (52 * MIN_PER_WEEK);

  const profitPerMin = rates.weeklyFlightProfit / MIN_PER_WEEK;
  const leasePerMin = rates.dailyLeaseCost / MIN_PER_DAY;
  const loans = loansIn.map((l) => ({ ...l }));
  const finishedLoans: BankLoan[] = [];
  let remaining = Math.max(0, deltaMin);
  let flightProfit = 0;
  let leaseCost = 0;
  let loanCost = 0;
  let interestCost = 0;
  let overdraftCost = 0;

  while (remaining > 0) {
    const weekEnd = ledger.week * MIN_PER_WEEK;
    // Stop early where a loan's last instalment is paid, so the rate drops right then
    const active = loans.filter((l) => l.paid < l.totalRepayable);
    let step = Math.min(remaining, weekEnd - t);
    for (const l of active) step = Math.min(step, ((l.totalRepayable - l.paid) * MIN_PER_WEEK) / l.weeklyPayment);
    step = Math.max(step, 1e-9);
    let loanStep = 0;
    let interestStep = 0;
    for (const l of active) {
      const pay = Math.min(l.totalRepayable - l.paid, (l.weeklyPayment / MIN_PER_WEEK) * step);
      l.paid += pay;
      loanStep += pay;
      // Flat-rate loans: every instalment is principal and interest in the same proportion
      interestStep += pay * loanInterestShare(l);
      if (l.totalRepayable - l.paid < 0.01) {
        l.paid = l.totalRepayable;
        finishedLoans.push(l);
      }
    }
    const opStep = (profitPerMin - leasePerMin) * step - loanStep;
    // Overdraft interest on the balance halfway through the step (only when a balance was given)
    const mid = cash + opStep / 2;
    const odStep = cashIn !== undefined && mid < 0 ? -mid * overdraftPerMin * step : 0;
    cash += opStep - odStep;
    ledger.flightProfit += profitPerMin * step;
    ledger.leaseCost += leasePerMin * step;
    ledger.loanCost = (ledger.loanCost ?? 0) + loanStep;
    ledger.interestCost = (ledger.interestCost ?? 0) + interestStep;
    ledger.overdraftCost = (ledger.overdraftCost ?? 0) + odStep;
    flightProfit += profitPerMin * step;
    leaseCost += leasePerMin * step;
    loanCost += loanStep;
    interestCost += interestStep;
    overdraftCost += odStep;
    t += step;
    remaining -= step;
    if (t >= weekEnd - 1e-9) {
      if (cashIn !== undefined) {
        ledger.cashEnd = cash;
        ledger.debtEnd = loans.reduce((s, l) => s + loanPrincipalLeft(l), 0);
      }
      closedWeeks.push(ledger);
      ledger = fresh(ledger.week + 1);
    }
  }

  return {
    econMin: t,
    current: ledger,
    closedWeeks,
    cashDelta: flightProfit - leaseCost - loanCost - overdraftCost,
    flightProfit,
    leaseCost,
    loanCost,
    interestCost,
    overdraftCost,
    loans,
    finishedLoans,
  };
}

export interface CatchUpReport {
  realAwayMs: number;
  gameMinutes: number;
  capped: boolean;
  flightProfit: number;
  leaseCost: number;
  loanCost?: number;
  net: number;
  weeksClosed: number;
}

/** How much game time to settle for a real absence (7×, capped at 4 weeks). */
export function catchUpGameMinutes(realAwayMs: number): { gameMinutes: number; capped: boolean } {
  const raw = (Math.max(0, realAwayMs) / 1000) * ECONOMY_RATE.normal;
  return { gameMinutes: Math.min(raw, MAX_CATCH_UP_GAME_MIN), capped: raw > MAX_CATCH_UP_GAME_MIN };
}

export function formatAway(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatGameSpan(gameMin: number): string {
  const weeks = gameMin / MIN_PER_WEEK;
  if (weeks >= 1) return `${weeks.toFixed(1)} game weeks`;
  const days = gameMin / MIN_PER_DAY;
  if (days >= 1) return `${days.toFixed(1)} game days`;
  return `${Math.round(gameMin / 60)} game hours`;
}
