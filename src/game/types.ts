// ============================================================================
// BOARDING PASS — shared types
// ============================================================================

export type RadarIconGroup =
  | 'commuter'
  | 'prop'
  | 'rj_tail'
  | 'small_jet'
  | 'rear_jet'
  | 'medium_jet'
  | 'long_narrow'
  | 'large_jet'
  | 'heavy_twin'
  | 'trijet'
  | 'a340'
  | 'b747'
  | 'a380'
  | 'high_quad';

export type OperationalTier = 1 | 2 | 3 | 4 | 5;
export type GameMode = 'standard' | 'sandbox';
export type DashboardTab = 'map' | 'fleet' | 'schedule';

/** Seven booleans, Mon..Sun. */
export type WeekDays = boolean[];

export interface RunwayEndPair {
  le_ident: string;
  he_ident: string;
  length_ft: number;
  le_lat: number;
  le_lon: number;
  le_heading_degT: number;
  he_lat: number;
  he_lon: number;
  he_heading_degT: number;
  /** Landing threshold this far in from the runway end, feet (v2.29+). */
  le_displaced_ft?: number;
  he_displaced_ft?: number;
}

export interface NavaidWaypoint {
  id: number;
  ident: string;
  name: string;
  type: string; // VOR, VOR-DME, VORTAC, DME, NDB, NDB-DME, TACAN ...
  frequency_khz: number;
  latitude_deg: number;
  longitude_deg: number;
  associated_airport: string;
}

export interface Airport {
  id: number;
  iata_code: string;
  icao_code: string;
  name: string;
  municipality: string;
  iso_country: string;
  country_name: string;
  continent: string;
  type: 'large_airport' | 'medium_airport' | 'small_airport';
  latitude_deg: number;
  longitude_deg: number;
  elevation_ft: number;
  runway_count: number;
  max_runway_length_ft: number;
  demand_weight: number;
  hourly_slot_limit: number;
  runways?: RunwayEndPair[];
}

export type AircraftCategory =
  | 'turboprop'
  | 'regional_jet'
  | 'narrowbody'
  | 'widebody'
  | 'heavy_widebody';

export interface AircraftModel {
  id: string;
  name: string;
  manufacturer: string;
  family: string;
  tier: OperationalTier;
  is_cargo: boolean;
  cargo_cap_tons: number;
  category: AircraftCategory;
  icao_code: string;
  range_nm: number;
  cruise_speed_kts: number;
  min_runway_ft: number;
  max_exit_limit: number;
  typical_seats: number;
  cabin_width_m: number;
  usable_cabin_length_m: number;
  max_abreast: number;
  fuel_burn_kg_hr: number;
  mtow_kg: number;
  base_price_usd: number;
  daily_lease_usd: number;
  turnaround_min: number;
  image_key: string;
}

export interface CabinConfig {
  econSeats: number;
  premSeats: number;
  busSeats: number;
  firstSeats: number;
  econPitchIn: number;
  premPitchIn: number;
  busPitchIn: number;
  firstPitchIn: number;
}

export interface LeaseTerms {
  termWeeks: number;
  /** Lease payment per game day. */
  dailyRate: number;
  /** Economy minute the lease started. */
  startMin: number;
  /** Security deposit paid at signing, refunded on return (part of it when early). */
  deposit: number;
}

export interface PlayerAircraft {
  tailNumber: string;
  model: AircraftModel;
  acquisition: 'owned' | 'leased';
  hubIata: string;
  cabin: CabinConfig;
  /** Economy minute the aircraft joined the fleet (v2.38+). */
  acquiredMin?: number;
  /** The lease (v2.38+); leased aircraft from older saves have none and pay day by day. */
  lease?: LeaseTerms;
}

export interface Fares {
  econ: number;
  prem: number;
  bus: number;
  first: number;
  cargoPerTon?: number;
}

export interface ScheduledFlight {
  id: string;
  pairId?: string;
  flightNumber: string;
  tailNumber: string;
  origin: Airport;
  destination: Airport;
  depTimeMin: number; // 0..1435 UTC, snapped to 5-minute increments
  arrTimeMin: number; // 0..1439 UTC
  distanceNm: number;
  blockTimeMin: number;
  daysOfWeek: WeekDays;
  fares: Fares;
}

/** A bank loan, repaid in equal weekly instalments by the economy clock. */
export interface BankLoan {
  id: string;
  /** Agreement reference shown on letters, e.g. NAB-0003. */
  ref: string;
  product: string;
  principal: number;
  ratePct: number;
  termWeeks: number;
  weeklyPayment: number;
  totalRepayable: number;
  /** Instalments paid so far. */
  paid: number;
  /** Economy minute the loan was drawn. */
  startMin: number;
  /**
   * After a part repayment (v2.29+) the loan is re-set on what's left:
   * principal, totalRepayable, weeklyPayment and paid then describe the
   * remainder, and these keep the original amount and what was paid early.
   */
  startPrincipal?: number;
  extraRepaid?: number;
}

export interface BankLetter {
  id: string;
  /** Economy minute the letter was written. */
  econMin: number;
  kind: 'welcome' | 'milestone' | 'standing' | 'loan' | 'repaid' | 'notice' | 'insolvency' | 'settlement';
  subject: string;
  /** Paragraphs. */
  body: string[];
  /** Grant attached to the letter, collected with a button. */
  reward?: number;
  collected?: boolean;
  read?: boolean;
  goalId?: string;
  stage?: number;
}

/** Career-mode bank relationship and the milestone programme. */
export interface CareerState {
  loans: BankLoan[];
  letters: BankLetter[];
  /** Goals whose milestone letter has been issued (met at least once). */
  goalsMet: string[];
  /** Stages whose completion letter has been issued. */
  stagesMet: number[];
  loansRepaid: number;
  nextLoanNo: number;
  /** Best closed-week net result so far. */
  bestWeekNet: number;
  /** New loans carry a surcharge until this week (after an overdraft). */
  surchargeUntilWeek: number;
  // --- v2.29+ ---
  /** Weeks in a row that closed with the account overdrawn. */
  overdrawnWeeks?: number;
  /** Set when the bank declares the airline insolvent; cleared by a settlement. */
  insolvent?: { econMin: number; week: number } | null;
  /** No new loans before this economy minute (after a bank bail-out). */
  noLoansUntilMin?: number;
  /** Bankruptcy settlements so far. */
  bankruptcies?: number;
  /** v2.38+: economy minute each not-yet-paid milestone was first met (it must hold for a game day). */
  goalsSince?: Record<string, number>;
}

export interface SaveGameState {
  saveId: string;
  /** Opened from a save that wasn't protected (v2.38+): plays as Sandbox. */
  unprotected?: boolean;
  /** v2.39+: the airports flights use, written once (flights name them by code). */
  savedAirports?: Record<string, Airport>;
  airlineName: string;
  airlineIata: string;
  airlineCallsign: string;
  hubIata: string;
  hubs?: string[];
  gameMode: string;
  cash: number;
  /** Economy clock (v2.2 fields, still written for compatibility). */
  simMin: number;
  simDay: number;
  fleet: PlayerAircraft[];
  schedule: ScheduledFlight[];
  savedAt: string;
  // --- v2.3+ ---
  appVersion?: string;
  /** Total economy minutes since the career began. */
  econMin?: number;
  /** Real time (ms since epoch) when this save was written; drives catch-up. */
  lastRealTs?: number;
  econPaused?: boolean;
  /** Current week in progress + recently closed weeks (newest last). */
  ledgerCurrent?: { week: number; flightProfit: number; leaseCost: number; loanCost?: number };
  ledgerHistory?: { week: number; flightProfit: number; leaseCost: number; loanCost?: number }[];
  /** True when written by autosave rather than Quick Save. */
  isAutosave?: boolean;
  // --- v2.8+ ---
  career?: CareerState;
  // --- v2.10+ ---
  /** IATA code of the real airline this one replaces; it's left off the map. */
  replacesAiAirline?: string | null;
  // --- v2.49+ ---
  /** Revision for cloud sync: bigger is newer, always above the previous save's. */
  rev?: number;
}

/** Minimal leg description used by the conflict checker. */
export interface CandidateLeg {
  flightNumber: string;
  depTimeMin: number;
  blockTimeMin: number;
  daysOfWeek: WeekDays;
  originIata?: string;
  destIata?: string;
}

export interface GameAlert {
  title: string;
  message: string;
  detail?: string;
  severity?: 'error' | 'warning' | 'info';
  /** When set, the alert becomes a confirm dialog. */
  confirmLabel?: string;
  onConfirm?: () => void;
  /** Optional third button on a confirm dialog (does not close the dialog's purpose). */
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Close the dialog after the secondary action (otherwise it stays open). */
  secondaryCloses?: boolean;
  /** 'subtle' when the secondary action is an equal choice rather than a side action. */
  secondaryVariant?: 'ghost' | 'subtle';
}
