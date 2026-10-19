// ============================================================================
// CAREER: THE BANK AND THE CARRIER DEVELOPMENT PROGRAMME
//   Career mode has a house bank. It lends money (repaid weekly by the
//   economy clock, see advanceEconomy) and runs a five-stage milestone
//   programme: each milestone met earns a grant, each stage completed raises
//   the airline's standing, which means a bigger credit line and lower rates.
//   Everything the bank says arrives as a letter.
// ============================================================================
import { econDayOfWeek, econWeekOf, ledgerNet, type WeekLedger } from './clock';
import type { FlightEconomics } from './economics';
import { calcAircraftResaleUsd } from './tiers';
import { daysOrAll } from './time';
import type { Airport, BankLetter, BankLoan, CareerState, PlayerAircraft, ScheduledFlight } from './types';

export const BANK = {
  name: 'Northgate Aviation Bank',
  short: 'Northgate',
  division: 'Carrier Finance Division',
  programme: 'Carrier Development Programme',
  signatory: 'E. Marlowe',
  signatoryTitle: 'Head of Carrier Relations',
  refPrefix: 'NAB',
};

// ---------------------------------------------------------------------------
// Standing: one step per completed programme stage
// ---------------------------------------------------------------------------
export interface Standing {
  label: string;
  /** Base credit line before collateral. */
  creditLine: number;
  /** Base yearly rate on new loans, %. */
  ratePct: number;
}

export const STANDINGS: Standing[] = [
  { label: 'New client', creditLine: 100_000_000, ratePct: 8.5 },
  { label: 'Start-up carrier', creditLine: 200_000_000, ratePct: 7.75 },
  { label: 'Regional operator', creditLine: 500_000_000, ratePct: 6.9 },
  { label: 'National carrier', creditLine: 1_250_000_000, ratePct: 6.1 },
  { label: 'International carrier', creditLine: 3_000_000_000, ratePct: 5.4 },
  { label: 'Global network', creditLine: 8_000_000_000, ratePct: 4.75 },
];

/** Share of owned aircraft resale value the bank lends against. */
export const COLLATERAL_SHARE = 0.25;
export const OVERDRAFT_SURCHARGE_PCT = 2;
export const OVERDRAFT_SURCHARGE_WEEKS = 4;
export const MAX_ACTIVE_LOANS = 4;
export const MIN_LOAN = 5_000_000;

// ---------------------------------------------------------------------------
// Loan products
// ---------------------------------------------------------------------------
export interface LoanProduct {
  id: string;
  name: string;
  termWeeks: number;
  /** Added to the standing's base rate, % per year. */
  rateAdjPct: number;
  blurb: string;
}

export const LOAN_PRODUCTS: LoanProduct[] = [
  { id: 'bridge', name: 'Bridging loan', termWeeks: 8, rateAdjPct: -0.5, blurb: 'Short-term cash to cover a purchase until new routes start paying.' },
  { id: 'fleet', name: 'Fleet finance', termWeeks: 26, rateAdjPct: 0, blurb: 'The usual way to fund an aircraft purchase.' },
  { id: 'growth', name: 'Growth facility', termWeeks: 52, rateAdjPct: 0.6, blurb: 'Lower weekly instalments for a bigger expansion.' },
  { id: 'term', name: 'Long-term facility', termWeeks: 104, rateAdjPct: 1.2, blurb: 'The smallest instalments, spread over two years of game time.' },
];

export const freshCareer = (): CareerState => ({
  loans: [],
  letters: [],
  goalsMet: [],
  stagesMet: [],
  loansRepaid: 0,
  nextLoanNo: 1,
  bestWeekNet: -Infinity,
  surchargeUntilWeek: 0,
});

/** Fills in fields older saves don't have. */
export function hydrateCareer(c: Partial<CareerState> | undefined): CareerState {
  const base = freshCareer();
  if (!c) return base;
  return {
    ...base,
    ...c,
    loans: c.loans ?? [],
    letters: c.letters ?? [],
    goalsMet: c.goalsMet ?? [],
    stagesMet: c.stagesMet ?? [],
    bestWeekNet: typeof c.bestWeekNet === 'number' ? c.bestWeekNet : -Infinity,
  };
}

export const activeLoans = (c: CareerState) => c.loans.filter((l) => l.paid < l.totalRepayable);
/** Principal still owed (interest for weeks not yet reached is not charged). */
export const loanOutstanding = (l: BankLoan) => Math.max(0, Math.round(l.principal * (1 - l.paid / l.totalRepayable)));
export const totalOutstanding = (c: CareerState) => activeLoans(c).reduce((s, l) => s + loanOutstanding(l), 0);
export const weeklyInstalments = (c: CareerState) => activeLoans(c).reduce((s, l) => s + l.weeklyPayment, 0);

export function standingIndex(c: CareerState): number {
  let k = 0;
  while (k < STAGES.length && c.stagesMet.includes(k + 1)) k++;
  return k;
}

export function creditLine(c: CareerState, fleet: PlayerAircraft[]): number {
  const owned = fleet.filter((a) => a.acquisition === 'owned').reduce((s, a) => s + calcAircraftResaleUsd(a.model), 0);
  return STANDINGS[standingIndex(c)].creditLine + Math.round(owned * COLLATERAL_SHARE);
}

export const availableCredit = (c: CareerState, fleet: PlayerAircraft[]) => Math.max(0, creditLine(c, fleet) - totalOutstanding(c));

export function loanRatePct(c: CareerState, product: LoanProduct, econMin: number): number {
  const surcharge = econWeekOf(econMin) <= c.surchargeUntilWeek ? OVERDRAFT_SURCHARGE_PCT : 0;
  return Math.round((STANDINGS[standingIndex(c)].ratePct + product.rateAdjPct + surcharge) * 100) / 100;
}

export function loanTerms(principal: number, ratePct: number, termWeeks: number) {
  const totalRepayable = Math.round(principal * (1 + (ratePct / 100) * (termWeeks / 52)));
  return { totalRepayable, weeklyPayment: totalRepayable / termWeeks, interest: totalRepayable - principal };
}

/** Why a loan can't be taken right now, or null. */
export function borrowBlocker(c: CareerState, fleet: PlayerAircraft[], cash: number, amount: number): string | null {
  if (cash < 0) return 'New borrowing is suspended while your account is overdrawn.';
  if (activeLoans(c).length >= MAX_ACTIVE_LOANS) return `You can hold up to ${MAX_ACTIVE_LOANS} loans at once. Repay one first.`;
  const avail = availableCredit(c, fleet);
  if (avail < MIN_LOAN) return 'Your credit line is fully used.';
  if (amount < MIN_LOAN) return `The smallest loan is ${usdShort(MIN_LOAN)}.`;
  if (amount > avail) return `That is more than your available credit of ${usdShort(avail)}.`;
  return null;
}

// ---------------------------------------------------------------------------
// Programme: metrics, goals, stages
// ---------------------------------------------------------------------------
export interface CareerMetrics {
  aircraft: number;
  owned: number;
  routes: number;
  intlRoutes: number;
  destinations: number;
  countries: number;
  continents: number;
  hubs: number;
  hubContinents: number;
  departuresPerWeek: number;
  paxPerWeek: number;
  widebodies: number;
  heavies: number;
  transatlantic: number;
  transpacific: number;
  ultraLong: number;
  bestWeekNet: number;
  loansRepaid: number;
  closedWeekInProfit: number;
}

export function computeCareerMetrics(args: {
  fleet: PlayerAircraft[];
  schedule: ScheduledFlight[];
  hubs: string[];
  airportByIata: Map<string, Airport>;
  econById: Map<string, FlightEconomics>;
  career: CareerState;
}): CareerMetrics {
  const { fleet, schedule, hubs, airportByIata, econById, career } = args;
  const pairs = new Map<string, { a: Airport; b: Airport; nm: number }>();
  const airports = new Set<string>();
  let departures = 0;
  let pax = 0;
  for (const fl of schedule) {
    const key = [fl.origin.iata_code, fl.destination.iata_code].sort().join('-');
    if (!pairs.has(key)) pairs.set(key, { a: fl.origin, b: fl.destination, nm: fl.distanceNm });
    airports.add(fl.origin.iata_code);
    airports.add(fl.destination.iata_code);
    const days = daysOrAll(fl.daysOfWeek).filter(Boolean).length;
    departures += days;
    pax += (econById.get(fl.id)?.totalPax ?? 0) * days;
  }
  const routes = [...pairs.values()];
  const servedAps = [...airports].map((c) => airportByIata.get(c)).filter(Boolean) as Airport[];
  const isPair = (r: { a: Airport; b: Airport }, x: (ap: Airport) => boolean, y: (ap: Airport) => boolean) => (x(r.a) && y(r.b)) || (x(r.b) && y(r.a));
  const cont = (c: string) => (ap: Airport) => ap.continent === c;
  const asiaPac = (ap: Airport) => ap.continent === 'AS' || ap.continent === 'OC';
  const scheduledTails = new Set(schedule.map((f) => f.tailNumber));
  const flying = fleet.filter((a) => scheduledTails.has(a.tailNumber));
  return {
    aircraft: fleet.length,
    owned: fleet.filter((a) => a.acquisition === 'owned').length,
    routes: routes.length,
    intlRoutes: routes.filter((r) => r.a.iso_country !== r.b.iso_country).length,
    destinations: airports.size,
    countries: new Set(servedAps.map((a) => a.iso_country)).size,
    continents: new Set(servedAps.map((a) => a.continent).filter((c) => c && c !== 'AN')).size,
    hubs: hubs.length,
    hubContinents: new Set(hubs.map((h) => airportByIata.get(h)?.continent).filter(Boolean)).size,
    departuresPerWeek: departures,
    paxPerWeek: Math.round(pax),
    widebodies: flying.filter((a) => a.model.category === 'widebody' || a.model.category === 'heavy_widebody').length,
    heavies: flying.filter((a) => a.model.category === 'heavy_widebody').length,
    transatlantic: routes.filter((r) => isPair(r, cont('NA'), cont('EU'))).length,
    transpacific: routes.filter((r) => isPair(r, cont('NA'), asiaPac)).length,
    ultraLong: routes.filter((r) => r.nm >= 5000).length,
    bestWeekNet: Number.isFinite(career.bestWeekNet) ? career.bestWeekNet : 0,
    loansRepaid: career.loansRepaid,
    closedWeekInProfit: career.bestWeekNet > 0 ? 1 : 0,
  };
}

export interface GoalDef {
  id: string;
  stage: number;
  title: string;
  /** How to get there, shown under the goal. */
  hint: string;
  metric: keyof CareerMetrics;
  target: number;
  reward: number;
  /** Progress text, e.g. "3 of 5 aircraft". */
  unit: string;
  money?: boolean;
}

export interface StageDef {
  stage: number;
  name: string;
  bonus: number;
}

export const STAGES: StageDef[] = [
  { stage: 1, name: 'Start-up carrier', bonus: 25_000_000 },
  { stage: 2, name: 'Regional operator', bonus: 100_000_000 },
  { stage: 3, name: 'National carrier', bonus: 300_000_000 },
  { stage: 4, name: 'International carrier', bonus: 800_000_000 },
  { stage: 5, name: 'Global network', bonus: 2_000_000_000 },
];

const M = 1_000_000;
export const GOALS: GoalDef[] = [
  // Stage 1: first steps
  { id: 's1-aircraft', stage: 1, title: 'Take delivery of your first aircraft', hint: 'Open Buy in the left bar and buy or lease an aircraft.', metric: 'aircraft', target: 1, reward: 8 * M, unit: 'aircraft' },
  { id: 's1-route', stage: 1, title: 'Open your first route', hint: 'Click any airport on the map and schedule a round trip from your hub.', metric: 'routes', target: 1, reward: 8 * M, unit: 'routes' },
  { id: 's1-fleet3', stage: 1, title: 'Operate a fleet of 3 aircraft', hint: 'Owned and leased aircraft both count. A Fleet finance loan can help.', metric: 'aircraft', target: 3, reward: 15 * M, unit: 'aircraft' },
  { id: 's1-routes5', stage: 1, title: 'Fly 5 routes', hint: 'A route is any pair of airports you fly between.', metric: 'routes', target: 5, reward: 15 * M, unit: 'routes' },
  { id: 's1-profit', stage: 1, title: 'Close a week in profit', hint: 'Flights must earn more than your leases and loan instalments in a game week.', metric: 'closedWeekInProfit', target: 1, reward: 10 * M, unit: 'profitable weeks' },

  // Stage 2: regional operator
  { id: 's2-fleet8', stage: 2, title: 'Operate 8 aircraft', hint: 'Owned and leased aircraft both count.', metric: 'aircraft', target: 8, reward: 40 * M, unit: 'aircraft' },
  { id: 's2-routes15', stage: 2, title: 'Fly 15 routes', hint: 'Chain one-way flights to reach new airports from your hub.', metric: 'routes', target: 15, reward: 40 * M, unit: 'routes' },
  { id: 's2-dest25', stage: 2, title: 'Serve 25 airports', hint: 'Every airport your flights touch counts, hubs included.', metric: 'destinations', target: 25, reward: 35 * M, unit: 'airports' },
  { id: 's2-intl1', stage: 2, title: 'Open your first international route', hint: 'Fly to an airport in another country.', metric: 'intlRoutes', target: 1, reward: 30 * M, unit: 'international routes' },
  { id: 's2-hub2', stage: 2, title: 'Open a second hub', hint: 'Open an airport and choose Buy as hub.', metric: 'hubs', target: 2, reward: 40 * M, unit: 'hubs' },
  { id: 's2-deps250', stage: 2, title: 'Fly 250 departures a week', hint: 'Daily flights count 7 times. Add frequencies on busy routes.', metric: 'departuresPerWeek', target: 250, reward: 40 * M, unit: 'departures a week' },
  { id: 's2-week2m', stage: 2, title: 'Close a week with $2M net profit', hint: 'Shown as This week in the top bar.', metric: 'bestWeekNet', target: 2 * M, reward: 50 * M, unit: 'best week', money: true },

  // Stage 3: national carrier
  { id: 's3-fleet20', stage: 3, title: 'Operate 20 aircraft', hint: 'Owned and leased aircraft both count.', metric: 'aircraft', target: 20, reward: 120 * M, unit: 'aircraft' },
  { id: 's3-routes40', stage: 3, title: 'Fly 40 routes', hint: 'A route is any pair of airports you fly between.', metric: 'routes', target: 40, reward: 120 * M, unit: 'routes' },
  { id: 's3-intl10', stage: 3, title: 'Fly 10 international routes', hint: 'Routes between airports in different countries.', metric: 'intlRoutes', target: 10, reward: 100 * M, unit: 'international routes' },
  { id: 's3-widebody', stage: 3, title: 'Put a widebody into service', hint: 'Buy or lease a widebody and give it at least one flight.', metric: 'widebodies', target: 1, reward: 80 * M, unit: 'widebodies flying' },
  { id: 's3-pax25k', stage: 3, title: 'Carry 25,000 passengers a week', hint: 'Bigger aircraft and more frequencies on strong routes.', metric: 'paxPerWeek', target: 25_000, reward: 100 * M, unit: 'passengers a week' },
  { id: 's3-week10m', stage: 3, title: 'Close a week with $10M net profit', hint: 'Shown as This week in the top bar.', metric: 'bestWeekNet', target: 10 * M, reward: 150 * M, unit: 'best week', money: true },
  { id: 's3-repay', stage: 3, title: 'Repay a loan in full', hint: 'Let a loan run its term or repay it early from the Loans tab.', metric: 'loansRepaid', target: 1, reward: 50 * M, unit: 'loans repaid' },

  // Stage 4: international carrier
  { id: 's4-fleet40', stage: 4, title: 'Operate 40 aircraft', hint: 'Owned and leased aircraft both count.', metric: 'aircraft', target: 40, reward: 300 * M, unit: 'aircraft' },
  { id: 's4-owned15', stage: 4, title: 'Own 15 aircraft outright', hint: 'Leased aircraft do not count for this one.', metric: 'owned', target: 15, reward: 250 * M, unit: 'owned aircraft' },
  { id: 's4-transatlantic', stage: 4, title: 'Open a transatlantic route', hint: 'Fly between North America and Europe.', metric: 'transatlantic', target: 1, reward: 150 * M, unit: 'transatlantic routes' },
  { id: 's4-transpacific', stage: 4, title: 'Open a transpacific route', hint: 'Fly between North America and Asia or Oceania.', metric: 'transpacific', target: 1, reward: 150 * M, unit: 'transpacific routes' },
  { id: 's4-hubs3', stage: 4, title: 'Run hubs on two continents', hint: 'Own at least one hub outside your home continent.', metric: 'hubContinents', target: 2, reward: 250 * M, unit: 'continents with a hub' },
  { id: 's4-routes100', stage: 4, title: 'Fly 100 routes', hint: 'A route is any pair of airports you fly between.', metric: 'routes', target: 100, reward: 300 * M, unit: 'routes' },
  { id: 's4-intl25', stage: 4, title: 'Fly 25 international routes', hint: 'Routes between airports in different countries.', metric: 'intlRoutes', target: 25, reward: 250 * M, unit: 'international routes' },

  // Stage 5: global network
  { id: 's5-fleet100', stage: 5, title: 'Operate 100 aircraft', hint: 'Owned and leased aircraft both count.', metric: 'aircraft', target: 100, reward: 1000 * M, unit: 'aircraft' },
  { id: 's5-routes250', stage: 5, title: 'Fly 250 routes', hint: 'A route is any pair of airports you fly between.', metric: 'routes', target: 250, reward: 1000 * M, unit: 'routes' },
  { id: 's5-continents', stage: 5, title: 'Serve all six inhabited continents', hint: 'North and South America, Europe, Africa, Asia and Oceania.', metric: 'continents', target: 6, reward: 750 * M, unit: 'continents' },
  { id: 's5-ultralong', stage: 5, title: 'Fly 10 routes over 5,000 nm', hint: 'Ultra long-haul needs widebodies with the range.', metric: 'ultraLong', target: 10, reward: 600 * M, unit: 'routes over 5,000 nm' },
  { id: 's5-countries50', stage: 5, title: 'Serve 50 countries', hint: 'Count of countries your flights touch.', metric: 'countries', target: 50, reward: 600 * M, unit: 'countries' },
  { id: 's5-heavy', stage: 5, title: 'Put a very large aircraft into service', hint: 'An A380 or 747 class aircraft with at least one flight.', metric: 'heavies', target: 1, reward: 400 * M, unit: 'very large aircraft flying' },
  { id: 's5-pax250k', stage: 5, title: 'Carry 250,000 passengers a week', hint: 'Shown on each flight in your schedule.', metric: 'paxPerWeek', target: 250_000, reward: 1000 * M, unit: 'passengers a week' },
  { id: 's5-week100m', stage: 5, title: 'Close a week with $100M net profit', hint: 'Shown as This week in the top bar.', metric: 'bestWeekNet', target: 100 * M, reward: 1500 * M, unit: 'best week', money: true },
];

export const goalsOfStage = (stage: number) => GOALS.filter((g) => g.stage === stage);
export const goalValue = (g: GoalDef, m: CareerMetrics) => m[g.metric];
export const goalDone = (g: GoalDef, m: CareerMetrics) => goalValue(g, m) >= g.target;

/** "3 of 5 aircraft" / "$1.2M of $2.0M". */
export function goalProgressText(g: GoalDef, m: CareerMetrics): string {
  const v = Math.max(0, goalValue(g, m));
  if (g.target === 1 && !g.money) return v >= 1 ? 'Done' : 'Not yet';
  if (g.money) return `${usdShort(Math.min(v, g.target))} of ${usdShort(g.target)}`;
  return `${Math.min(v, g.target).toLocaleString()} of ${g.target.toLocaleString()} ${g.unit}`;
}

// ---------------------------------------------------------------------------
// Letters
// ---------------------------------------------------------------------------
export function usdShort(v: number): string {
  const a = Math.abs(v);
  const s = a >= 1e9 ? `$${(a / 1e9).toFixed(a % 1e9 === 0 ? 0 : 2)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(a % 1e6 === 0 ? 0 : 1)}M` : `$${Math.round(a).toLocaleString()}`;
  return v < 0 ? `−${s}` : s;
}
/** Full figure for letters: $25,000,000. */
export const usdFull = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString()}`;
export const econDateText = (econMin: number) => `Week ${econWeekOf(econMin)}, day ${econDayOfWeek(econMin)}`;

let letterSeq = 0;
const letterId = () => `L${Date.now().toString(36)}${(letterSeq++).toString(36)}`;
const signOff = [`Yours faithfully,`, `${BANK.signatory}\n${BANK.signatoryTitle}, ${BANK.name}`];

export function welcomeLetter(airlineName: string, iata: string, hub: string, econMin: number): BankLetter {
  const s = STANDINGS[0];
  return {
    id: letterId(),
    econMin,
    kind: 'welcome',
    subject: `Your corporate account with ${BANK.name}`,
    body: [
      `Dear ${airlineName} management,`,
      `${BANK.name} is pleased to confirm the opening of a corporate operating account for ${airlineName} (${iata}), based at ${hub}.`,
      `Your airline has been enrolled in the Bank's ${BANK.programme}. The programme sets a series of operating milestones in five stages. Each milestone met qualifies ${airlineName} for a performance grant, paid into your operating account on collection. Completing every milestone in a stage raises your standing with the Bank, increases your credit line and lowers the rates we are able to offer.`,
      `Your opening credit line is ${usdFull(s.creditLine)}, plus ${Math.round(COLLATERAL_SHARE * 100)}% of the resale value of any aircraft you own outright, at rates from ${s.ratePct}% a year. Our current facilities are set out under Loans.`,
      ...signOff,
    ],
    read: false,
  };
}

function milestoneLetter(g: GoalDef, m: CareerMetrics, airlineName: string, econMin: number): BankLetter {
  const stage = STAGES[g.stage - 1];
  return {
    id: letterId(),
    econMin,
    kind: 'milestone',
    subject: `Milestone met: ${g.title}`,
    body: [
      `Dear ${airlineName} management,`,
      `We write to confirm that ${airlineName} has met the following milestone under stage ${g.stage} (${stage.name}) of the ${BANK.programme}: ${g.title.toLowerCase()}. ${g.target === 1 && !g.money ? 'This is confirmed by our records' : `Our records show ${goalProgressText(g, m)}`} as of ${econDateText(econMin)}.`,
      `A performance grant of ${usdFull(g.reward)} has been approved and is available to collect.`,
      ...signOff,
    ],
    reward: g.reward,
    collected: false,
    read: false,
    goalId: g.id,
    stage: g.stage,
  };
}

function stageLetter(stage: StageDef, airlineName: string, econMin: number, newLine: number): BankLetter {
  const next = STANDINGS[stage.stage];
  return {
    id: letterId(),
    econMin,
    kind: 'standing',
    subject: `Revised standing: ${next.label}`,
    body: [
      `Dear ${airlineName} management,`,
      `Following review of your account, the Bank is pleased to confirm that ${airlineName} has completed stage ${stage.stage} of the ${BANK.programme}. With effect from ${econDateText(econMin)} your standing with the Bank is raised to ${next.label}.`,
      `Your credit line is increased to ${usdFull(newLine)} and new borrowing is offered from ${next.ratePct}% a year. A stage completion bonus of ${usdFull(stage.bonus)} is available to collect.`,
      stage.stage < STAGES.length
        ? `The milestones for stage ${stage.stage + 1} (${STAGES[stage.stage].name}) are now open.`
        : `${airlineName} has now completed the ${BANK.programme} in full. The Bank thanks you for your custom.`,
      ...signOff,
    ],
    reward: stage.bonus,
    collected: false,
    read: false,
    stage: stage.stage,
  };
}

export function loanLetter(loan: BankLoan, product: LoanProduct, airlineName: string): BankLetter {
  return {
    id: letterId(),
    econMin: loan.startMin,
    kind: 'loan',
    subject: `Loan agreement ${loan.ref}: ${product.name}`,
    body: [
      `Dear ${airlineName} management,`,
      `This letter confirms the advance of ${usdFull(loan.principal)} to ${airlineName} under a ${product.name.toLowerCase()} agreement (reference ${loan.ref}), credited to your operating account on ${econDateText(loan.startMin)}.`,
      `The loan is repayable in ${loan.termWeeks} weekly instalments of ${usdFull(loan.weeklyPayment)} at a fixed rate of ${loan.ratePct}% a year. The total repayable is ${usdFull(loan.totalRepayable)}. Instalments are taken automatically from your operating account as the week runs.`,
      `You may repay the outstanding principal at any time. The Bank makes no charge for early repayment.`,
      ...signOff,
    ],
    read: false,
  };
}

export function repaidLetter(loan: BankLoan, airlineName: string, econMin: number, early: boolean): BankLetter {
  return {
    id: letterId(),
    econMin,
    kind: 'repaid',
    subject: `Loan ${loan.ref} settled`,
    body: [
      `Dear ${airlineName} management,`,
      early
        ? `We confirm receipt of ${usdFull(loanOutstanding(loan))} in full settlement of loan ${loan.ref}. No further instalments will be taken.`
        : `We confirm that the final instalment on loan ${loan.ref} has been received and the loan is settled in full.`,
      `The Bank appreciates ${airlineName}'s prompt settlement, which has been noted on your account.`,
      ...signOff,
    ],
    read: false,
  };
}

export function overdraftLetter(airlineName: string, closedWeek: WeekLedger, cash: number, econMin: number, untilWeek: number): BankLetter {
  return {
    id: letterId(),
    econMin,
    kind: 'notice',
    subject: 'Notice: operating account overdrawn',
    body: [
      `Dear ${airlineName} management,`,
      `Your operating account closed week ${closedWeek.week} with a balance of ${usdFull(cash)} (net result for the week ${usdFull(ledgerNet(closedWeek))}).`,
      `Under the terms of your facilities, new borrowing is suspended until the account returns to credit, and new loans will carry a surcharge of ${OVERDRAFT_SURCHARGE_PCT}% a year until the end of week ${untilWeek}. Instalments on existing loans continue as scheduled.`,
      `We recommend reviewing loss-making routes and lease commitments at the earliest opportunity.`,
      ...signOff,
    ],
    read: false,
  };
}

/**
 * Issues a letter for every newly met milestone and completed stage. Milestones
 * latch: once met, the grant stays collectable even if the airline later
 * shrinks. Returns null when nothing changed.
 */
export function reviewProgramme(
  career: CareerState,
  metrics: CareerMetrics,
  ctx: { airlineName: string; econMin: number; fleet: PlayerAircraft[] }
): { career: CareerState; letters: BankLetter[] } | null {
  const letters: BankLetter[] = [];
  const goalsMet = [...career.goalsMet];
  const stagesMet = [...career.stagesMet];
  for (const g of GOALS) {
    if (goalsMet.includes(g.id) || !goalDone(g, metrics)) continue;
    goalsMet.push(g.id);
    letters.push(milestoneLetter(g, metrics, ctx.airlineName, ctx.econMin));
  }
  for (const st of STAGES) {
    if (stagesMet.includes(st.stage)) continue;
    if (!goalsOfStage(st.stage).every((g) => goalsMet.includes(g.id))) continue;
    stagesMet.push(st.stage);
    const after = { ...career, goalsMet, stagesMet };
    letters.push(stageLetter(st, ctx.airlineName, ctx.econMin, creditLine(after, ctx.fleet)));
  }
  if (letters.length === 0) return null;
  return { career: { ...career, goalsMet, stagesMet, letters: [...[...letters].reverse(), ...career.letters] }, letters };
}

/** The open stage (lowest not yet completed), or null when all are done. */
export function currentStage(career: CareerState): StageDef | null {
  return STAGES.find((s) => !career.stagesMet.includes(s.stage)) ?? null;
}

/** First goal of the open stage that hasn't been met yet. */
export function nextGoal(career: CareerState): GoalDef | null {
  const st = currentStage(career);
  if (!st) return null;
  return goalsOfStage(st.stage).find((g) => !career.goalsMet.includes(g.id)) ?? null;
}

export const uncollected = (c: CareerState) => c.letters.filter((l) => l.reward && !l.collected);
export const unread = (c: CareerState) => c.letters.filter((l) => !l.read);

/**
 * Applies an economy advance to the bank side: drops loans that were paid off
 * (with a letter), records the best closed week, and sends an overdraft notice
 * when a week closes with the account below zero.
 */
export function settleCareerAdvance(
  career: CareerState,
  res: { econMin: number; loans: BankLoan[]; finishedLoans: BankLoan[]; closedWeeks: WeekLedger[] },
  cashAfter: number,
  airlineName: string
): CareerState {
  if (career.loans.length === 0 && res.closedWeeks.length === 0) return career;
  const letters: BankLetter[] = [];
  for (const l of res.finishedLoans) letters.push(repaidLetter(l, airlineName, res.econMin, false));
  let { bestWeekNet, surchargeUntilWeek } = career;
  for (const w of res.closedWeeks) bestWeekNet = Math.max(bestWeekNet, ledgerNet(w));
  const last = res.closedWeeks[res.closedWeeks.length - 1];
  if (last && cashAfter < 0) {
    const until = last.week + OVERDRAFT_SURCHARGE_WEEKS;
    // One notice per overdraft spell; later overdrawn weeks just extend the surcharge
    if (surchargeUntilWeek < last.week) letters.push(overdraftLetter(airlineName, last, cashAfter, res.econMin, until));
    surchargeUntilWeek = until;
  }
  return {
    ...career,
    loans: res.loans.filter((l) => l.paid < l.totalRepayable),
    loansRepaid: career.loansRepaid + res.finishedLoans.length,
    bestWeekNet,
    surchargeUntilWeek,
    letters: letters.length ? [...[...letters].reverse(), ...career.letters] : career.letters,
  };
}

/** Draws a new loan. Returns the updated career, the loan and its agreement letter. */
export function drawLoan(career: CareerState, product: LoanProduct, amount: number, econMin: number, airlineName: string) {
  const ratePct = loanRatePct(career, product, econMin);
  const principal = Math.round(amount);
  const { totalRepayable, weeklyPayment } = loanTerms(principal, ratePct, product.termWeeks);
  const loan: BankLoan = {
    id: `LOAN-${Date.now().toString(36)}-${career.nextLoanNo}`,
    ref: `${BANK.refPrefix}-${String(career.nextLoanNo).padStart(4, '0')}`,
    product: product.id,
    principal,
    ratePct,
    termWeeks: product.termWeeks,
    weeklyPayment,
    totalRepayable,
    paid: 0,
    startMin: econMin,
  };
  const letter = loanLetter(loan, product, airlineName);
  return { loan, career: { ...career, loans: [...career.loans, loan], nextLoanNo: career.nextLoanNo + 1, letters: [letter, ...career.letters] } };
}

/** Repays a loan early. The caller checks there's enough cash for `amount`. */
export function repayLoanEarly(career: CareerState, loanId: string, econMin: number, airlineName: string) {
  const loan = career.loans.find((l) => l.id === loanId);
  if (!loan) return null;
  const amount = loanOutstanding(loan);
  const letter = repaidLetter(loan, airlineName, econMin, true);
  return {
    amount,
    career: { ...career, loans: career.loans.filter((l) => l.id !== loanId), loansRepaid: career.loansRepaid + 1, letters: [letter, ...career.letters] },
  };
}

export const productById = (id: string) => LOAN_PRODUCTS.find((p) => p.id === id) ?? LOAN_PRODUCTS[1];
