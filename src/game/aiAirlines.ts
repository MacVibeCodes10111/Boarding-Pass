// ============================================================================
// CURATED AI AIRLINES (cosmetic background traffic)
//
// About 10 of the biggest airlines per region, picked from OpenFlights route
// counts and corrected by hand, because the OpenFlights data is from ~2014:
//   • `mergeFrom` folds routes of airlines that no longer exist into their
//     successor (US Airways → American, TAM → LATAM, Germanwings → Eurowings…).
//   • Names and callsigns are set here, because some OpenFlights codes point
//     at the wrong airline (G3 shows as "City Connexion" but is GOL, VY shows
//     as "Formosa" but is Vueling, FJ is listed under its old name Air Pacific).
//
// Edit freely: add a line to include an airline, delete one to drop it.
// `code` is the IATA code used in routes.dat.
// ============================================================================

export type AiRegion = 'NA' | 'SA' | 'EU' | 'ME' | 'AF' | 'AS' | 'OC';

export interface AiAirlineDef {
  code: string;
  name: string;
  callsign: string;
  region: AiRegion;
  /** Codes of defunct/merged airlines whose routes this airline now flies. */
  mergeFrom?: string[];
}

export const AI_REGION_LABELS: Record<AiRegion, string> = {
  NA: 'North & Central America',
  SA: 'South America',
  EU: 'Europe',
  ME: 'Middle East',
  AF: 'Africa',
  AS: 'Asia',
  OC: 'Oceania',
};

export const AI_AIRLINES: AiAirlineDef[] = [
  // North & Central America
  { code: 'AA', name: 'American Airlines', callsign: 'AMERICAN', region: 'NA', mergeFrom: ['US'] },
  { code: 'DL', name: 'Delta Air Lines', callsign: 'DELTA', region: 'NA' },
  { code: 'UA', name: 'United Airlines', callsign: 'UNITED', region: 'NA' },
  { code: 'WN', name: 'Southwest Airlines', callsign: 'SOUTHWEST', region: 'NA', mergeFrom: ['FL'] },
  { code: 'B6', name: 'JetBlue', callsign: 'JETBLUE', region: 'NA' },
  { code: 'AS', name: 'Alaska Airlines', callsign: 'ALASKA', region: 'NA', mergeFrom: ['VX'] },
  { code: 'AC', name: 'Air Canada', callsign: 'AIR CANADA', region: 'NA' },
  { code: 'WS', name: 'WestJet', callsign: 'WESTJET', region: 'NA' },
  { code: 'AM', name: 'Aeroméxico', callsign: 'AEROMEXICO', region: 'NA' },
  { code: 'CM', name: 'Copa Airlines', callsign: 'COPA', region: 'NA' },

  // South America
  { code: 'LA', name: 'LATAM Airlines', callsign: 'LAN', region: 'SA', mergeFrom: ['JJ', 'PZ'] },
  { code: 'G3', name: 'GOL Linhas Aéreas', callsign: 'GOL TRANSPORTE', region: 'SA' },
  { code: 'AD', name: 'Azul', callsign: 'AZUL', region: 'SA', mergeFrom: ['8R'] },
  { code: 'AV', name: 'Avianca', callsign: 'AVIANCA', region: 'SA' },
  { code: 'AR', name: 'Aerolíneas Argentinas', callsign: 'ARGENTINA', region: 'SA' },
  { code: 'H2', name: 'Sky Airline', callsign: 'AEROSKY', region: 'SA' },
  { code: 'V0', name: 'Conviasa', callsign: 'CONVIASA', region: 'SA' },
  { code: '9R', name: 'SATENA', callsign: 'SATENA', region: 'SA' },

  // Europe
  { code: 'FR', name: 'Ryanair', callsign: 'RYANAIR', region: 'EU' },
  { code: 'U2', name: 'easyJet', callsign: 'EASY', region: 'EU' },
  { code: 'LH', name: 'Lufthansa', callsign: 'LUFTHANSA', region: 'EU' },
  { code: 'TK', name: 'Turkish Airlines', callsign: 'TURKISH', region: 'EU' },
  { code: 'W6', name: 'Wizz Air', callsign: 'WIZZ AIR', region: 'EU' },
  { code: 'DY', name: 'Norwegian', callsign: 'NOR SHUTTLE', region: 'EU' },
  { code: 'AF', name: 'Air France', callsign: 'AIRFRANS', region: 'EU' },
  { code: 'BA', name: 'British Airways', callsign: 'SPEEDBIRD', region: 'EU' },
  { code: 'VY', name: 'Vueling', callsign: 'VUELING', region: 'EU' },
  { code: 'EW', name: 'Eurowings', callsign: 'EUROWINGS', region: 'EU', mergeFrom: ['4U'] },

  // Middle East
  { code: 'EK', name: 'Emirates', callsign: 'EMIRATES', region: 'ME' },
  { code: 'QR', name: 'Qatar Airways', callsign: 'QATARI', region: 'ME' },
  { code: 'EY', name: 'Etihad Airways', callsign: 'ETIHAD', region: 'ME' },
  { code: 'SV', name: 'Saudia', callsign: 'SAUDIA', region: 'ME' },
  { code: 'FZ', name: 'flydubai', callsign: 'SKY DUBAI', region: 'ME' },
  { code: 'G9', name: 'Air Arabia', callsign: 'ARABIA', region: 'ME' },

  // Africa
  { code: 'ET', name: 'Ethiopian Airlines', callsign: 'ETHIOPIAN', region: 'AF' },
  { code: 'AT', name: 'Royal Air Maroc', callsign: 'ROYALAIR MAROC', region: 'AF' },
  { code: 'MS', name: 'EgyptAir', callsign: 'EGYPTAIR', region: 'AF' },
  { code: 'AH', name: 'Air Algérie', callsign: 'AIR ALGERIE', region: 'AF' },
  { code: 'KQ', name: 'Kenya Airways', callsign: 'KENYA', region: 'AF' },
  { code: 'TU', name: 'Tunisair', callsign: 'TUNAIR', region: 'AF' },
  { code: 'SA', name: 'South African Airways', callsign: 'SPRINGBOK', region: 'AF' },
  { code: 'DT', name: 'TAAG Angola Airlines', callsign: 'DTA', region: 'AF' },
  { code: 'WB', name: 'RwandAir', callsign: 'RWANDAIR', region: 'AF' },
  { code: 'MK', name: 'Air Mauritius', callsign: 'AIRMAURITIUS', region: 'AF' },

  // Asia
  { code: 'CZ', name: 'China Southern Airlines', callsign: 'CHINA SOUTHERN', region: 'AS' },
  { code: 'MU', name: 'China Eastern Airlines', callsign: 'CHINA EASTERN', region: 'AS' },
  { code: 'CA', name: 'Air China', callsign: 'AIR CHINA', region: 'AS' },
  { code: 'HU', name: 'Hainan Airlines', callsign: 'HAINAN', region: 'AS' },
  { code: '6E', name: 'IndiGo', callsign: 'IFLY', region: 'AS' },
  { code: 'AI', name: 'Air India', callsign: 'AIRINDIA', region: 'AS' },
  { code: 'NH', name: 'All Nippon Airways', callsign: 'ALL NIPPON', region: 'AS' },
  { code: 'KE', name: 'Korean Air', callsign: 'KOREANAIR', region: 'AS' },
  { code: 'CX', name: 'Cathay Pacific', callsign: 'CATHAY', region: 'AS' },
  { code: 'SQ', name: 'Singapore Airlines', callsign: 'SINGAPORE', region: 'AS' },

  // Oceania
  { code: 'QF', name: 'Qantas', callsign: 'QANTAS', region: 'OC' },
  { code: 'JQ', name: 'Jetstar', callsign: 'JETSTAR', region: 'OC' },
  { code: 'VA', name: 'Virgin Australia', callsign: 'VELOCITY', region: 'OC', mergeFrom: ['TT'] },
  { code: 'NZ', name: 'Air New Zealand', callsign: 'NEW ZEALAND', region: 'OC' },
  { code: 'HA', name: 'Hawaiian Airlines', callsign: 'HAWAIIAN', region: 'OC' },
  { code: 'FJ', name: 'Fiji Airways', callsign: 'FIJI', region: 'OC' },
  { code: 'PX', name: 'Air Niugini', callsign: 'NIUGINI', region: 'OC' },
  { code: 'ZL', name: 'Rex Airlines', callsign: 'REX', region: 'OC' },
];

// ---------------------------------------------------------------------------
// Matching the player's airline against the real ones
// ---------------------------------------------------------------------------
/** Lower-case name without punctuation and generic words ("Airlines", "Airways"…). */
export function airlineNameCore(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(air lines|airlines|airline|airways|aviation|group|company|co|inc|ltd|plc|sa|ag)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface AiAirlineMatch {
  airline: AiAirlineDef;
  /** What matched, for the message. */
  by: ('name' | 'code' | 'callsign')[];
}

/**
 * Real airline that the player's new airline would duplicate: same name
 * (ignoring words like "Airlines"), same IATA code or same radio callsign.
 */
export function findMatchingAiAirline(name: string, iata: string, callsign: string, list: AiAirlineDef[] = AI_AIRLINES): AiAirlineMatch | null {
  const core = airlineNameCore(name);
  const code = iata.trim().toUpperCase();
  const cs = callsign.trim().toUpperCase();
  let best: AiAirlineMatch | null = null;
  for (const a of list) {
    const by: AiAirlineMatch['by'] = [];
    if (core && core === airlineNameCore(a.name)) by.push('name');
    if (code && (code === a.code || a.mergeFrom?.includes(code))) by.push('code');
    if (cs && cs === a.callsign.toUpperCase()) by.push('callsign');
    // A name match is the strongest reason; otherwise take whatever matches most
    if (by.length && (!best || by.includes('name') > best.by.includes('name') || by.length > best.by.length)) best = { airline: a, by };
  }
  return best;
}
