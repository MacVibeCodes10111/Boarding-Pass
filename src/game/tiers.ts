// ============================================================================
// UNIFIED 5-TIER SYSTEM — shared by airports (runway length) and aircraft
// ============================================================================
import type { AircraftModel, Airport, OperationalTier } from './types';

export interface TierInfo {
  tier: OperationalTier;
  /** Plain size class shown in the UI: "Narrowbody", "Widebody"… */
  sizeLabel: string;
  shortLabel: string;
  fullLabel: string;
  groupHeader: string;
  iconScale: number;
  badgeColor: string;
}

export const TIERS: OperationalTier[] = [1, 2, 3, 4, 5];

export const UNIFIED_TIER_CONFIG: Record<OperationalTier, TierInfo> = {
  1: {
    tier: 1,
    sizeLabel: 'Turboprop',
    shortLabel: 'Tier 1: Turboprop',
    fullLabel: 'Tier 1: Commuter & Regional Turboprop (Twin Otter / ATR / Dash 8 / MA60 / An-24)',
    groupHeader: 'Tier 1 — Turboprop Capable (< 4,800 ft)',
    iconScale: 0.54,
    badgeColor: '#c9b37a',
  },
  2: {
    tier: 2,
    sizeLabel: 'Regional jet',
    shortLabel: 'Tier 2: Small Regional Jet',
    fullLabel: 'Tier 2: Small Regional Jet (ERJ / E-Jet / CRJ / C909 / SJ-100)',
    groupHeader: 'Tier 2 — Small Regional Jet Capable (4,800–5,999 ft)',
    iconScale: 0.66,
    badgeColor: '#7fc8a9',
  },
  3: {
    tier: 3,
    sizeLabel: 'Narrowbody',
    shortLabel: 'Tier 3: Medium Narrowbody Jet',
    fullLabel: 'Tier 3: Medium Narrowbody Jet (A220 / A320 / A321 / B737 / B757 / C919 / Tu-204)',
    groupHeader: 'Tier 3 — Medium Narrowbody Jet Capable (6,000–7,999 ft)',
    iconScale: 0.78,
    badgeColor: '#8fb8de',
  },
  4: {
    tier: 4,
    sizeLabel: 'Widebody',
    shortLabel: 'Tier 4: Large Widebody Jet',
    fullLabel: 'Tier 4: Large Widebody & Trijet (A330 / A350-900 / B767 / B787 / B777-200 / MD-11 / Il-96)',
    groupHeader: 'Tier 4 — Large Widebody Jet Capable (8,000–9,799 ft)',
    iconScale: 0.92,
    badgeColor: '#b3a3e6',
  },
  5: {
    tier: 5,
    sizeLabel: 'Heavy',
    shortLabel: 'Tier 5: Heavy / Superjumbo',
    fullLabel: 'Tier 5: Heavy Quad, Superjumbo & Outsized (B747 / A380 / A340 / A350-1000 / B777-300ER / An-124)',
    groupHeader: 'Tier 5 — Heavy & Superjumbo Capable (≥ 9,800 ft)',
    iconScale: 1.08,
    badgeColor: '#e3a1c0',
  },
};

export function tierForRunwayFt(rwyFt: number): OperationalTier {
  if (rwyFt >= 9800) return 5;
  if (rwyFt >= 8000) return 4;
  if (rwyFt >= 6000) return 3;
  if (rwyFt >= 4800) return 2;
  return 1;
}

/** The largest aircraft tier an airport can handle, from its longest runway. */
export function getAirportMaxAircraftTier(rwyFt: number): TierInfo {
  return UNIFIED_TIER_CONFIG[tierForRunwayFt(rwyFt || 7000)];
}

export function getAircraftTierInfo(tier: OperationalTier): TierInfo {
  return UNIFIED_TIER_CONFIG[tier] || UNIFIED_TIER_CONFIG[3];
}

/** Returns a reason string if the aircraft cannot use the airport, else null. */
export function airportRestrictionFor(model: AircraftModel, airport: Airport): string | null {
  const apTier = getAirportMaxAircraftTier(airport.max_runway_length_ft).tier;
  if (airport.max_runway_length_ft < model.min_runway_ft) {
    return `${airport.iata_code} runway ${airport.max_runway_length_ft.toLocaleString()} ft < ${model.min_runway_ft.toLocaleString()} ft required`;
  }
  if (model.tier > apTier) {
    return `${airport.iata_code} is Max Tier ${apTier}, aircraft is Tier ${model.tier}`;
  }
  return null;
}

export function calcHubPurchasePriceUsd(airport: Airport): number {
  const isLarge = airport.type === 'large_airport';
  const sizeBase = isLarge ? 12_000_000 : 2_800_000;
  const demandComponent = Math.pow(Math.max(10, airport.demand_weight), 1.08) * 145_000;
  const rwyComponent = (airport.runway_count || 1) * (isLarge ? 2_200_000 : 750_000);
  const tierMult = 0.75 + 0.1 * getAirportMaxAircraftTier(airport.max_runway_length_ft).tier;
  const rawPrice = (sizeBase + demandComponent + rwyComponent) * tierMult;
  return Math.round(rawPrice / 100_000) * 100_000;
}

/** Hubs sell back for 70% of the current purchase price. */
export function calcHubSaleRefundUsd(airport: Airport): number {
  return Math.round((calcHubPurchasePriceUsd(airport) * 0.7) / 100_000) * 100_000;
}

/** Owned aircraft resell for 75% of list price. */
export function calcAircraftResaleUsd(model: AircraftModel): number {
  return Math.round(model.base_price_usd * 0.75);
}
