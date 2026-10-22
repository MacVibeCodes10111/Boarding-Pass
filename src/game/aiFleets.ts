// ============================================================================
// AIRCRAFT TYPES FOR OTHER AIRLINES' FLIGHTS
//
// IATA aircraft type codes (the ones timetables use) with a typical seat
// count and range, so each airline's route gets an aircraft that fits it:
// a Dash 8 to the islands, an A321neo on a busy short route, an A350 to Asia.
// ============================================================================

export interface AiTypeInfo {
  name: string;
  seats: number;
  rangeNm: number;
}

export const AI_TYPES: Record<string, AiTypeInfo> = {
  // Commuter and turboprop
  CNA: { name: 'Cessna 402 / Tecnam P2012', seats: 9, rangeNm: 600 },
  CNC: { name: 'Cessna 208 Caravan', seats: 9, rangeNm: 700 },
  DHT: { name: 'De Havilland Canada Twin Otter', seats: 19, rangeNm: 450 },
  BE1: { name: 'Beechcraft 1900D', seats: 19, rangeNm: 700 },
  L4T: { name: 'Let L-410', seats: 19, rangeNm: 750 },
  EM2: { name: 'Embraer 120 Brasilia', seats: 30, rangeNm: 800 },
  SF3: { name: 'Saab 340', seats: 34, rangeNm: 900 },
  DH1: { name: 'De Havilland Canada Dash 8-100', seats: 37, rangeNm: 900 },
  DH8: { name: 'De Havilland Canada Dash 8-200', seats: 37, rangeNm: 1000 },
  DH3: { name: 'De Havilland Canada Dash 8-300', seats: 50, rangeNm: 900 },
  DH4: { name: 'De Havilland Canada Dash 8-400', seats: 76, rangeNm: 1100 },
  AT5: { name: 'ATR 42-600', seats: 48, rangeNm: 700 },
  AT7: { name: 'ATR 72-600', seats: 70, rangeNm: 800 },
  AN4: { name: 'Antonov An-24', seats: 48, rangeNm: 1100 },
  // Regional jets
  ER4: { name: 'Embraer ERJ 145', seats: 50, rangeNm: 1500 },
  CRJ: { name: 'Bombardier CRJ200', seats: 50, rangeNm: 1300 },
  CR7: { name: 'Bombardier CRJ700', seats: 70, rangeNm: 1400 },
  CR9: { name: 'Bombardier CRJ900', seats: 76, rangeNm: 1500 },
  CRK: { name: 'Bombardier CRJ1000', seats: 100, rangeNm: 1600 },
  E70: { name: 'Embraer E170', seats: 72, rangeNm: 2000 },
  E75: { name: 'Embraer E175', seats: 76, rangeNm: 2000 },
  E90: { name: 'Embraer E190', seats: 100, rangeNm: 2400 },
  E95: { name: 'Embraer E195', seats: 120, rangeNm: 2200 },
  '290': { name: 'Embraer E190-E2', seats: 106, rangeNm: 2800 },
  '295': { name: 'Embraer E195-E2', seats: 136, rangeNm: 2600 },
  ARJ: { name: 'COMAC C909 (ARJ21)', seats: 90, rangeNm: 1200 },
  SU9: { name: 'Sukhoi Superjet 100', seats: 98, rangeNm: 1700 },
  F70: { name: 'Fokker 70', seats: 80, rangeNm: 1700 },
  '100': { name: 'Fokker 100', seats: 100, rangeNm: 1600 },
  '146': { name: 'BAe 146', seats: 95, rangeNm: 1600 },
  '717': { name: 'Boeing 717', seats: 125, rangeNm: 1800 },
  M80: { name: 'McDonnell Douglas MD-80', seats: 150, rangeNm: 2000 },
  // Narrowbody
  '221': { name: 'Airbus A220-100', seats: 115, rangeNm: 3100 },
  '223': { name: 'Airbus A220-300', seats: 140, rangeNm: 3300 },
  '319': { name: 'Airbus A319', seats: 140, rangeNm: 3500 },
  '320': { name: 'Airbus A320', seats: 174, rangeNm: 3200 },
  '32N': { name: 'Airbus A320neo', seats: 180, rangeNm: 3400 },
  '321': { name: 'Airbus A321', seats: 200, rangeNm: 3000 },
  '32Q': { name: 'Airbus A321neo', seats: 210, rangeNm: 3700 },
  '32X': { name: 'Airbus A321XLR', seats: 190, rangeNm: 4600 },
  '73G': { name: 'Boeing 737-700', seats: 140, rangeNm: 3000 },
  '738': { name: 'Boeing 737-800', seats: 180, rangeNm: 2900 },
  '739': { name: 'Boeing 737-900ER', seats: 185, rangeNm: 2900 },
  '7M8': { name: 'Boeing 737 MAX 8', seats: 180, rangeNm: 3500 },
  '7M9': { name: 'Boeing 737 MAX 9', seats: 190, rangeNm: 3500 },
  C19: { name: 'COMAC C919', seats: 158, rangeNm: 2200 },
  '752': { name: 'Boeing 757-200', seats: 190, rangeNm: 3900 },
  // Widebody
  '310': { name: 'Airbus A310', seats: 220, rangeNm: 4500 },
  '763': { name: 'Boeing 767-300ER', seats: 230, rangeNm: 5900 },
  '332': { name: 'Airbus A330-200', seats: 250, rangeNm: 7200 },
  '333': { name: 'Airbus A330-300', seats: 290, rangeNm: 6000 },
  '338': { name: 'Airbus A330-800', seats: 260, rangeNm: 8000 },
  '339': { name: 'Airbus A330-900', seats: 290, rangeNm: 7200 },
  '343': { name: 'Airbus A340-300', seats: 280, rangeNm: 7400 },
  '346': { name: 'Airbus A340-600', seats: 300, rangeNm: 7800 },
  '359': { name: 'Airbus A350-900', seats: 310, rangeNm: 8100 },
  '351': { name: 'Airbus A350-1000', seats: 350, rangeNm: 8700 },
  '788': { name: 'Boeing 787-8', seats: 240, rangeNm: 7300 },
  '789': { name: 'Boeing 787-9', seats: 290, rangeNm: 7600 },
  '781': { name: 'Boeing 787-10', seats: 330, rangeNm: 6300 },
  '772': { name: 'Boeing 777-200ER', seats: 310, rangeNm: 7000 },
  '77L': { name: 'Boeing 777-200LR', seats: 300, rangeNm: 8500 },
  '77W': { name: 'Boeing 777-300ER', seats: 370, rangeNm: 7300 },
  '744': { name: 'Boeing 747-400', seats: 400, rangeNm: 7200 },
  '74H': { name: 'Boeing 747-8', seats: 400, rangeNm: 7700 },
  '388': { name: 'Airbus A380', seats: 500, rangeNm: 8000 },
};

// ----------------------------------------------------------------------------
// Fleets of airlines without their own entry, by the kind of flying they do
// ----------------------------------------------------------------------------
export const GENERIC_FLEETS = {
  /** Island hoppers, bush and Arctic airlines (short routes, small airports). */
  regional: 'DHT AT5 AT7 DH4',
  /** Ordinary airlines. */
  mainline: 'AT7 E90 320 738 32N 332 789',
  /** Big airlines with long-haul flights. */
  network: 'E90 320 32N 738 321 333 789 359 77W',
} as const;
