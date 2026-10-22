// ============================================================================
// AIRLINES SHOWN AS OTHER TRAFFIC
//
// Every airline in the real network (network.json, about 600 of them) flies
// its real routes on the map. This list is the hand-made part, for about 280
// of the biggest and best-known ones:
//   • name and radio callsign as they are today (the route data sometimes
//     has an old or wrong name for a code);
//   • fleet: the aircraft each one flies in 2026, so an easyJet route gets an
//     A320neo, Emirates an A380 or 777, Widerøe a Dash 8;
//   • `mergeFrom` folds routes of airlines that no longer exist into their
//     successor (used with the old OpenFlights route file).
// Airlines not listed here get their name from the route data, a callsign
// made from the name and a typical fleet for the flying they do.
//
// Edit freely: add a line to give an airline its own fleet, change a fleet
// when an airline gets new aircraft. `code` is the airline's IATA code.
// ============================================================================

export type AiRegion = 'NA' | 'SA' | 'EU' | 'ME' | 'AF' | 'AS' | 'OC';

export interface AiAirlineDef {
  code: string;
  name: string;
  callsign: string;
  region: AiRegion;
  /** Codes of defunct/merged airlines whose routes this airline now flies. */
  mergeFrom?: string[];
  /**
   * Aircraft the airline flies today (IATA type codes, see aiFleets.ts), for
   * choosing the aircraft on each of its routes. Airlines without a list get
   * a typical fleet for the flying they do.
   */
  fleet?: string;
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
  { code: 'AA', name: 'American Airlines', callsign: 'AMERICAN', region: 'NA', fleet: 'ER4 E75 CR9 319 320 738 7M8 321 32Q 788 789 772 77W', mergeFrom: ['US'] },
  { code: 'DL', name: 'Delta Air Lines', callsign: 'DELTA', region: 'NA', fleet: 'CR9 E75 221 223 319 320 739 321 32Q 752 763 332 339 359' },
  { code: 'UA', name: 'United Airlines', callsign: 'UNITED', region: 'NA', fleet: 'ER4 CR7 E75 319 320 738 739 7M8 7M9 32Q 752 763 788 789 781 772 77W' },
  { code: 'WN', name: 'Southwest Airlines', callsign: 'SOUTHWEST', region: 'NA', fleet: '73G 738 7M8', mergeFrom: ['FL'] },
  { code: 'B6', name: 'JetBlue', callsign: 'JETBLUE', region: 'NA', fleet: '223 320 321 32Q' },
  { code: 'AS', name: 'Alaska Airlines', callsign: 'ALASKA', region: 'NA', fleet: 'E75 738 739 7M8 7M9', mergeFrom: ['VX'] },
  { code: 'HA', name: 'Hawaiian Airlines', callsign: 'HAWAIIAN', region: 'OC', fleet: '717 321 32Q 332 789' },
  { code: 'F9', name: 'Frontier Airlines', callsign: 'FRONTIER FLIGHT', region: 'NA', fleet: '320 32N 321 32Q' },
  { code: 'NK', name: 'Spirit Airlines', callsign: 'SPIRIT WINGS', region: 'NA', fleet: '320 32N 321' },
  { code: 'G4', name: 'Allegiant Air', callsign: 'ALLEGIANT', region: 'NA', fleet: '320 319 7M8' },
  { code: 'MX', name: 'Breeze Airways', callsign: 'MOXY', region: 'NA', fleet: 'E90 E95 223' },
  { code: 'SY', name: 'Sun Country Airlines', callsign: 'SUN COUNTRY', region: 'NA', fleet: '738 739' },
  { code: 'XP', name: 'Avelo Airlines', callsign: 'AVELO', region: 'NA', fleet: '73G 738' },
  { code: 'AC', name: 'Air Canada', callsign: 'AIR CANADA', region: 'NA', fleet: 'DH4 CR9 E75 223 320 321 7M8 333 788 789 77W' },
  { code: 'WS', name: 'WestJet', callsign: 'WESTJET', region: 'NA', fleet: 'DH4 73G 738 7M8 789' },
  { code: 'PD', name: 'Porter Airlines', callsign: 'PORTER', region: 'NA', fleet: 'DH4 295' },
  { code: 'TS', name: 'Air Transat', callsign: 'AIR TRANSAT', region: 'NA', fleet: '321 32Q 333' },
  { code: 'F8', name: 'Flair Airlines', callsign: 'FLAIR', region: 'NA', fleet: '738 7M8' },
  { code: '5T', name: 'Canadian North', callsign: 'EMPRESS', region: 'NA', fleet: 'AT5 73G' },
  { code: 'WP', name: 'Wasaya Airways', callsign: 'WASAYA', region: 'NA', fleet: 'BE1 AT5' },
  { code: '9K', name: 'Cape Air', callsign: 'CAIR', region: 'NA', fleet: 'CNA' },
  { code: '8E', name: 'Bering Air', callsign: 'BERING AIR', region: 'NA', fleet: 'CNC BE1' },
  { code: 'LF', name: 'Contour Airlines', callsign: 'VALUE JET', region: 'NA', fleet: 'ER4' },
  { code: 'AM', name: 'Aeroméxico', callsign: 'AEROMEXICO', region: 'NA', fleet: 'E90 738 7M8 7M9 788 789' },
  { code: 'Y4', name: 'Volaris', callsign: 'VOLARIS', region: 'NA', fleet: '320 32N 321 32Q' },
  { code: 'VB', name: 'Viva Aerobus', callsign: 'AEROENLACES', region: 'NA', fleet: '320 32N 32Q' },
  { code: 'CM', name: 'Copa Airlines', callsign: 'COPA', region: 'NA', fleet: '738 7M8 7M9' },
  { code: 'DM', name: 'Arajet', callsign: 'ARAJET', region: 'NA', fleet: '7M8' },
  { code: 'BW', name: 'Caribbean Airlines', callsign: 'CARIBBEAN AIRLINES', region: 'NA', fleet: 'AT7 7M8' },
  { code: 'UP', name: 'Bahamasair', callsign: 'BAHAMAS', region: 'NA', fleet: 'AT7 73G' },
  { code: 'JY', name: 'interCaribbean Airways', callsign: 'INTERCARIBBEAN', region: 'NA', fleet: 'EM2 AT7' },
  { code: '5L', name: 'LIAT20', callsign: 'LIAT', region: 'NA', fleet: 'AT7' },

  // South America
  { code: 'LA', name: 'LATAM Airlines', callsign: 'LAN', region: 'SA', fleet: '319 320 32N 321 32Q 763 788 789 77W', mergeFrom: ['JJ', 'PZ'] },
  { code: 'G3', name: 'GOL Linhas Aéreas', callsign: 'GOL TRANSPORTE', region: 'SA', fleet: '73G 738 7M8' },
  { code: 'AD', name: 'Azul', callsign: 'AZUL', region: 'SA', fleet: 'AT7 E95 295 32N 339', mergeFrom: ['8R'] },
  { code: 'AV', name: 'Avianca', callsign: 'AVIANCA', region: 'SA', fleet: '320 32N 788' },
  { code: 'AR', name: 'Aerolíneas Argentinas', callsign: 'ARGENTINA', region: 'SA', fleet: 'E90 738 7M8 332' },
  { code: 'JA', name: 'JetSMART', callsign: 'ROCKSMART', region: 'SA', fleet: '320 32N 321 32Q' },
  { code: 'H2', name: 'Sky Airline', callsign: 'AEROSKY', region: 'SA', fleet: '32N 32Q' },
  { code: 'P5', name: 'Wingo', callsign: 'AEROREPUBLICA', region: 'SA', fleet: '738' },
  { code: 'V0', name: 'Conviasa', callsign: 'CONVIASA', region: 'SA', fleet: 'E90' },
  { code: '9R', name: 'SATENA', callsign: 'SATENA', region: 'SA', fleet: 'AT5 AT7 E70' },
  { code: 'VE', name: 'Clic', callsign: 'EASYFLY', region: 'SA', fleet: 'AT5 AT7' },

  // Europe
  { code: 'FR', name: 'Ryanair', callsign: 'RYANAIR', region: 'EU', fleet: '738 7M8' },
  { code: 'RK', name: 'Ryanair UK', callsign: 'BLUEJET', region: 'EU', fleet: '738 7M8' },
  { code: 'U2', name: 'easyJet', callsign: 'EASY', region: 'EU', fleet: '319 320 32N 321 32Q' },
  { code: 'LS', name: 'Jet2', callsign: 'CHANNEX', region: 'EU', fleet: '738 32Q' },
  { code: 'W6', name: 'Wizz Air', callsign: 'WIZZ AIR', region: 'EU', fleet: '320 321 32Q' },
  { code: 'W4', name: 'Wizz Air Malta', callsign: 'WIZZ AIR', region: 'EU', fleet: '320 321 32Q' },
  { code: 'W9', name: 'Wizz Air UK', callsign: 'WIZZ AIR', region: 'EU', fleet: '320 321 32Q' },
  { code: 'EW', name: 'Eurowings', callsign: 'EUROWINGS', region: 'EU', fleet: '319 320 32N 321', mergeFrom: ['4U'] },
  { code: 'V7', name: 'Volotea', callsign: 'VOLOTEA', region: 'EU', fleet: '319 320' },
  { code: 'PC', name: 'Pegasus', callsign: 'SUNTURK', region: 'EU', fleet: '320 32N 321 32Q 738 7M8' },
  { code: 'XQ', name: 'SunExpress', callsign: 'SUNEXPRESS', region: 'EU', fleet: '738 7M8' },
  { code: 'VF', name: 'AJet', callsign: 'ANATOLIAN', region: 'EU', fleet: '738 7M8 32Q' },
  { code: 'LH', name: 'Lufthansa', callsign: 'LUFTHANSA', region: 'EU', fleet: 'CR9 E90 E95 319 320 32N 321 32Q 333 343 346 359 789 744 74H 388' },
  { code: 'VL', name: 'Lufthansa City Airlines', callsign: 'LUFTHANSA CITY', region: 'EU', fleet: '32N' },
  { code: 'SK', name: 'SAS', callsign: 'SCANDINAVIAN', region: 'EU', fleet: 'AT7 CR9 E95 320 32N 333 359' },
  { code: 'DY', name: 'Norwegian', callsign: 'NOR SHUTTLE', region: 'EU', fleet: '738 7M8' },
  { code: 'D8', name: 'Norwegian Air Sweden', callsign: 'NORTRANS', region: 'EU', fleet: '738 7M8' },
  { code: 'TK', name: 'Turkish Airlines', callsign: 'TURKISH', region: 'EU', fleet: '32N 321 32Q 738 7M8 7M9 332 333 339 359 789 77W' },
  { code: 'BA', name: 'British Airways', callsign: 'SPEEDBIRD', region: 'EU', fleet: 'E90 319 320 32N 321 32Q 788 789 781 772 77W 351 388' },
  { code: 'SU', name: 'Aeroflot', callsign: 'AEROFLOT', region: 'EU', fleet: 'SU9 320 321 738 333 77W' },
  { code: 'TO', name: 'Transavia France', callsign: 'FRENCH SUN', region: 'EU', fleet: '738 32N' },
  { code: 'HV', name: 'Transavia', callsign: 'TRANSAVIA', region: 'EU', fleet: '738 32N 32Q' },
  { code: 'NO', name: 'Neos', callsign: 'MOONFLOWER', region: 'EU', fleet: '738 7M8 789' },
  { code: 'VY', name: 'Vueling', callsign: 'VUELING', region: 'EU', fleet: '320 32N 321' },
  { code: 'IB', name: 'Iberia', callsign: 'IBERIA', region: 'EU', fleet: 'AT7 CRK 320 32N 321 32Q 333 359' },
  { code: 'UX', name: 'Air Europa', callsign: 'EUROPA', region: 'EU', fleet: 'E95 738 7M8 788 789' },
  { code: 'AF', name: 'Air France', callsign: 'AIRFRANS', region: 'EU', fleet: 'E75 E90 223 320 321 32N 359 772 77W 789' },
  { code: 'KL', name: 'KLM', callsign: 'KLM', region: 'EU', fleet: 'E75 E90 295 73G 738 739 32N 32Q 332 333 772 77W 789 781' },
  { code: 'DE', name: 'Condor', callsign: 'CONDOR', region: 'EU', fleet: '32N 32Q 339' },
  { code: 'A3', name: 'Aegean Airlines', callsign: 'AEGEAN', region: 'EU', fleet: '320 32N 321 32Q' },
  { code: 'OA', name: 'Olympic Air', callsign: 'OLYMPIC', region: 'EU', fleet: 'DH4 AT7' },
  { code: 'GQ', name: 'Sky Express', callsign: 'AIR CRETE', region: 'EU', fleet: 'AT7 32N' },
  { code: 'OS', name: 'Austrian Airlines', callsign: 'AUSTRIAN', region: 'EU', fleet: 'E95 320 321 32N 763 772 789' },
  { code: 'LX', name: 'SWISS', callsign: 'SWISS', region: 'EU', fleet: '221 223 320 32N 321 32Q 333 343 359 77W' },
  { code: 'WK', name: 'Edelweiss', callsign: 'EDELWEISS', region: 'EU', fleet: '320 343 359' },
  { code: 'EI', name: 'Aer Lingus', callsign: 'SHAMROCK', region: 'EU', fleet: 'AT7 320 32N 32Q 332 333' },
  { code: 'BT', name: 'airBaltic', callsign: 'AIRBALTIC', region: 'EU', fleet: '223' },
  { code: 'AY', name: 'Finnair', callsign: 'FINNAIR', region: 'EU', fleet: 'AT7 E90 319 320 321 333 359' },
  { code: 'LO', name: 'LOT Polish Airlines', callsign: 'POLLOT', region: 'EU', fleet: 'DH4 E75 E90 E95 738 7M8 788 789' },
  { code: 'TP', name: 'TAP Air Portugal', callsign: 'AIR PORTUGAL', region: 'EU', fleet: 'AT7 E90 32N 321 32Q 339' },
  { code: 'TB', name: 'TUI fly Belgium', callsign: 'BEAUTY', region: 'EU', fleet: 'E90 738 7M8 789' },
  { code: 'X3', name: 'TUI fly', callsign: 'TUI JET', region: 'EU', fleet: '738 7M8' },
  { code: 'OR', name: 'TUI fly Netherlands', callsign: 'ORANGE', region: 'EU', fleet: '738 7M8 789' },
  { code: 'BY', name: 'TUI Airways', callsign: 'TOMJET', region: 'EU', fleet: '738 7M8 789' },
  { code: '4Y', name: 'Discover Airlines', callsign: 'DISCOVER', region: 'EU', fleet: '320 333' },
  { code: 'LG', name: 'Luxair', callsign: 'LUXAIR', region: 'EU', fleet: 'DH4 295 738 7M8' },
  { code: 'JU', name: 'Air Serbia', callsign: 'AIR SERBIA', region: 'EU', fleet: 'AT7 319 320 332' },
  { code: 'SN', name: 'Brussels Airlines', callsign: 'BEELINE', region: 'EU', fleet: '319 320 32N 333' },
  { code: 'QS', name: 'Smartwings', callsign: 'SMART WINGS', region: 'EU', fleet: '738 7M8' },
  { code: 'AZ', name: 'ITA Airways', callsign: 'ITARROW', region: 'EU', fleet: '221 223 320 32N 32Q 339 359' },
  { code: 'WF', name: 'Widerøe', callsign: 'WIDEROE', region: 'EU', fleet: 'DH1 DH3 DH4 290' },
  { code: 'FI', name: 'Icelandair', callsign: 'ICEAIR', region: 'EU', fleet: 'DH4 7M8 7M9 32Q 752' },
  { code: 'OU', name: 'Croatia Airlines', callsign: 'CROATIA', region: 'EU', fleet: 'DH4 223' },
  { code: 'LM', name: 'Loganair', callsign: 'LOGAN', region: 'EU', fleet: 'DHT SF3 AT7 ER4' },
  { code: 'XK', name: 'Air Corsica', callsign: 'CORSICA', region: 'EU', fleet: 'AT7 320 32N' },
  { code: 'NT', name: 'Binter', callsign: 'BINTER', region: 'EU', fleet: 'AT7 295' },
  { code: 'EN', name: 'Air Dolomiti', callsign: 'DOLOMITI', region: 'EU', fleet: 'E95' },
  { code: 'BQ', name: 'Sky Alps', callsign: 'SKY ALPS', region: 'EU', fleet: 'DH4 221' },
  { code: 'B2', name: 'Belavia', callsign: 'BELARUS AVIA', region: 'EU', fleet: 'CRJ E95 738 7M8' },
  { code: 'XZ', name: 'Aeroitalia', callsign: 'AEROITALIA', region: 'EU', fleet: 'AT7 738' },
  { code: 'XR', name: 'Corendon Airlines Europe', callsign: 'SKYLOOP', region: 'EU', fleet: '738 7M8' },
  { code: 'XC', name: 'Corendon Airlines', callsign: 'CORENDON', region: 'EU', fleet: '738 7M8' },
  { code: 'DI', name: 'Marabu', callsign: 'MARABU', region: 'EU', fleet: '32N' },
  { code: 'RO', name: 'TAROM', callsign: 'TAROM', region: 'EU', fleet: 'AT7 738 7M8' },
  { code: 'A2', name: 'Animawings', callsign: 'ANIMA', region: 'EU', fleet: 'AT7 320' },
  { code: 'DP', name: 'Pobeda', callsign: 'POBEDA', region: 'EU', fleet: '738' },
  { code: 'S7', name: 'S7 Airlines', callsign: 'SIBERIAN AIRLINES', region: 'EU', fleet: 'E70 319 320 32N 32Q 738' },
  { code: 'UT', name: 'UTair', callsign: 'UTAIR', region: 'EU', fleet: 'AT7 73G 738' },
  { code: 'WZ', name: 'Red Wings', callsign: 'REMO', region: 'EU', fleet: 'SU9 320 321' },
  { code: 'U6', name: 'Ural Airlines', callsign: 'SVERDLOVSK AIR', region: 'EU', fleet: '319 320 321 32N' },
  { code: 'N4', name: 'Nordwind Airlines', callsign: 'NORDLAND', region: 'EU', fleet: '321 738 333' },
  { code: '5N', name: 'Smartavia', callsign: 'DVINA', region: 'EU', fleet: '738 32N' },
  { code: 'A4', name: 'Azimuth', callsign: 'AZIMUTH', region: 'EU', fleet: 'SU9' },
  { code: 'HZ', name: 'Aurora', callsign: 'AURORA', region: 'EU', fleet: 'DHT DH3 SU9 319 320' },
  { code: 'IO', name: 'IrAero', callsign: 'IRAERO', region: 'EU', fleet: 'CRJ SU9' },
  { code: 'YC', name: 'Yamal Airlines', callsign: 'YAMAL', region: 'EU', fleet: 'CRJ SU9 320' },
  { code: 'R3', name: 'Yakutia', callsign: 'AIR YAKUTIA', region: 'EU', fleet: 'AN4 DH3 SU9 738' },
  { code: 'KV', name: 'KrasAvia', callsign: 'KRASAVIA', region: 'EU', fleet: 'L4T AN4' },
  { code: 'Y7', name: 'NordStar', callsign: 'TAIMYR', region: 'EU', fleet: 'AT5 738' },
  { code: 'RT', name: 'UVT Aero', callsign: 'UVT', region: 'EU', fleet: 'CRJ' },
  { code: 'EO', name: 'Ikar', callsign: 'PEGAS', region: 'EU', fleet: 'SU9 738' },
  { code: 'J2', name: 'Azerbaijan Airlines', callsign: 'AZAL', region: 'AS', fleet: 'E90 320 32N 788' },
  { code: 'HY', name: 'Uzbekistan Airways', callsign: 'UZBEK', region: 'AS', fleet: '320 32N 763 788' },
  { code: 'C6', name: 'Centrum Air', callsign: 'CENTRUM', region: 'AS', fleet: '320 321' },
  { code: 'KC', name: 'Air Astana', callsign: 'ASTANALINE', region: 'AS', fleet: 'E90 295 32N 32Q 763 789' },
  { code: 'FS', name: 'FlyArystan', callsign: 'ARYSTAN', region: 'AS', fleet: '320 32N 32Q' },
  { code: 'DV', name: 'SCAT Airlines', callsign: 'VLASTA', region: 'AS', fleet: 'CRJ 73G 738 7M8' },

  // Middle East
  { code: 'EK', name: 'Emirates', callsign: 'EMIRATES', region: 'ME', fleet: '359 77W 388' },
  { code: 'QR', name: 'Qatar Airways', callsign: 'QATARI', region: 'ME', fleet: '320 32N 32Q 7M8 788 789 333 359 351 77W 77L 388' },
  { code: 'EY', name: 'Etihad Airways', callsign: 'ETIHAD', region: 'ME', fleet: '320 32N 32Q 789 781 359 351 77W 388' },
  { code: 'SV', name: 'Saudia', callsign: 'SAUDIA', region: 'ME', fleet: '320 32N 321 32Q 333 789 781 77W' },
  { code: 'FZ', name: 'flydubai', callsign: 'SKY DUBAI', region: 'ME', fleet: '738 7M8 7M9' },
  { code: 'G9', name: 'Air Arabia', callsign: 'ARABIA', region: 'ME', fleet: '320 32N 32Q' },
  { code: '3L', name: 'Air Arabia Abu Dhabi', callsign: 'ALPHA ARABIA', region: 'ME', fleet: '320 32N' },
  { code: '3O', name: 'Air Arabia Maroc', callsign: 'ARABIA MAROC', region: 'AF', fleet: '320 32N' },
  { code: 'XY', name: 'flynas', callsign: 'NAS EXPRESS', region: 'ME', fleet: '32N 32Q 339' },
  { code: 'F3', name: 'flyadeal', callsign: 'SAUDI SPIRIT', region: 'ME', fleet: '320 32N' },
  { code: 'J9', name: 'Jazeera Airways', callsign: 'JAZEERA', region: 'ME', fleet: '320 32N' },
  { code: 'KU', name: 'Kuwait Airways', callsign: 'KUWAITI', region: 'ME', fleet: '320 32N 332 339 77W' },
  { code: 'GF', name: 'Gulf Air', callsign: 'GULF AIR', region: 'ME', fleet: '32N 32Q 789' },
  { code: 'WY', name: 'Oman Air', callsign: 'OMAN AIR', region: 'ME', fleet: '738 7M8 788 789' },
  { code: 'OV', name: 'SalamAir', callsign: 'MAZOON', region: 'ME', fleet: '295 32N' },
  { code: 'RJ', name: 'Royal Jordanian', callsign: 'JORDANIAN', region: 'ME', fleet: 'E95 320 321 32N 788' },
  { code: 'ME', name: 'Middle East Airlines', callsign: 'CEDAR JET', region: 'ME', fleet: '32Q 332' },
  { code: 'LY', name: 'El Al', callsign: 'ELAL', region: 'ME', fleet: '738 739 788 789 781 772' },
  { code: 'IZ', name: 'Arkia', callsign: 'ARKIA', region: 'ME', fleet: 'E95 32Q' },
  { code: 'W5', name: 'Mahan Air', callsign: 'MAHAN AIR', region: 'ME', fleet: '146 320 310 343' },
  { code: 'IA', name: 'Iraqi Airways', callsign: 'IRAQI', region: 'ME', fleet: '738 7M8 788' },
  { code: 'B9', name: 'Iran Airtour', callsign: 'IRAN AIRTOUR', region: 'ME', fleet: 'M80 320' },
  { code: 'HH', name: 'Taban Air', callsign: 'TABAN', region: 'ME', fleet: 'M80' },
  { code: 'PK', name: 'Pakistan International', callsign: 'PAKISTAN', region: 'AS', fleet: 'AT7 320 772 77W' },

  // Africa
  { code: 'ET', name: 'Ethiopian Airlines', callsign: 'ETHIOPIAN', region: 'AF', fleet: 'DH4 738 7M8 788 789 359 351 77W' },
  { code: 'AT', name: 'Royal Air Maroc', callsign: 'ROYALAIR MAROC', region: 'AF', fleet: 'AT7 E90 738 7M8 788 789' },
  { code: 'MS', name: 'EgyptAir', callsign: 'EGYPTAIR', region: 'AF', fleet: '223 32N 32Q 738 333 789 359 77W' },
  { code: 'SM', name: 'Air Cairo', callsign: 'AIR CAIRO', region: 'AF', fleet: 'AT7 320 32N' },
  { code: 'AH', name: 'Air Algérie', callsign: 'AIR ALGERIE', region: 'AF', fleet: 'AT7 738 332 339' },
  { code: 'SF', name: 'Tassili Airlines', callsign: 'TASSILI AIR', region: 'AF', fleet: 'DH4 73G 738' },
  { code: 'TU', name: 'Tunisair', callsign: 'TUNAIR', region: 'AF', fleet: 'AT7 320 32N 332' },
  { code: 'BJ', name: 'Nouvelair', callsign: 'NOUVELAIR', region: 'AF', fleet: '320' },
  { code: 'KQ', name: 'Kenya Airways', callsign: 'KENYA', region: 'AF', fleet: 'E90 738 788' },
  { code: 'SA', name: 'South African Airways', callsign: 'SPRINGBOK', region: 'AF', fleet: '320 332 333 359' },
  { code: '4Z', name: 'Airlink', callsign: 'LINK', region: 'AF', fleet: 'ER4 E75 E90 E95' },
  { code: 'FA', name: 'FlySafair', callsign: 'SAFAIR', region: 'AF', fleet: '738' },
  { code: 'DT', name: 'TAAG Angola Airlines', callsign: 'DTA', region: 'AF', fleet: 'DH4 73G 7M8 789' },
  { code: 'WB', name: 'RwandAir', callsign: 'RWANDAIR', region: 'AF', fleet: 'CR9 738 332' },
  { code: 'MK', name: 'Air Mauritius', callsign: 'AIRMAURITIUS', region: 'AF', fleet: 'AT7 32N 339 359' },
  { code: 'KP', name: 'ASKY Airlines', callsign: 'ASKY', region: 'AF', fleet: 'DH4 73G 738 7M8' },
  { code: 'TC', name: 'Air Tanzania', callsign: 'TANZANIA', region: 'AF', fleet: 'DH4 223 7M8 789' },
  { code: 'P4', name: 'Air Peace', callsign: 'PEACE BIRD', region: 'AF', fleet: 'E95 738' },
  { code: 'HF', name: 'Air Côte d\'Ivoire', callsign: 'COTE DIVOIRE', region: 'AF', fleet: 'DH4 223 32N 339' },

  // Asia
  { code: 'MU', name: 'China Eastern Airlines', callsign: 'CHINA EASTERN', region: 'AS', fleet: 'ARJ 320 32N 321 32Q 738 7M8 C19 332 333 359 789 77W' },
  { code: 'CZ', name: 'China Southern Airlines', callsign: 'CHINA SOUTHERN', region: 'AS', fleet: 'ARJ E90 320 32N 321 32Q 738 7M8 C19 332 333 359 788 789 77W' },
  { code: 'CA', name: 'Air China', callsign: 'AIR CHINA', region: 'AS', fleet: 'ARJ 319 320 32N 321 32Q 738 7M8 C19 333 359 789 77W 74H' },
  { code: 'HU', name: 'Hainan Airlines', callsign: 'HAINAN', region: 'AS', fleet: '738 7M8 332 333 359 788 789' },
  { code: '3U', name: 'Sichuan Airlines', callsign: 'SICHUAN', region: 'AS', fleet: '319 320 32N 321 32Q C19 333 359' },
  { code: 'MF', name: 'Xiamen Airlines', callsign: 'XIAMEN AIR', region: 'AS', fleet: '738 7M8 788 789' },
  { code: 'ZH', name: 'Shenzhen Airlines', callsign: 'SHENZHEN AIR', region: 'AS', fleet: 'ARJ 320 32N 321 738 7M8' },
  { code: 'SC', name: 'Shandong Airlines', callsign: 'SHANDONG', region: 'AS', fleet: '738 7M8' },
  { code: 'GS', name: 'Tianjin Airlines', callsign: 'BOHAI', region: 'AS', fleet: 'E90 295 320 32N 332' },
  { code: 'EU', name: 'Chengdu Airlines', callsign: 'UNITED EAGLE', region: 'AS', fleet: 'ARJ 320 32N C19' },
  { code: '9C', name: 'Spring Airlines', callsign: 'AIR SPRING', region: 'AS', fleet: '320 32N 321 32Q' },
  { code: 'JD', name: 'Beijing Capital Airlines', callsign: 'CAPITAL JET', region: 'AS', fleet: '320 32N 321 332' },
  { code: 'HO', name: 'Juneyao Air', callsign: 'JUNEYAO AIRLINES', region: 'AS', fleet: '320 32N 321 32Q 789' },
  { code: 'GJ', name: 'Loong Air', callsign: 'LOONG AIR', region: 'AS', fleet: '320 32N 321' },
  { code: 'FM', name: 'Shanghai Airlines', callsign: 'SHANGHAI AIR', region: 'AS', fleet: '738 7M8 333 789' },
  { code: 'TV', name: 'Tibet Airlines', callsign: 'TIBET', region: 'AS', fleet: '319 320 32N 332' },
  { code: 'PN', name: 'West Air', callsign: 'WEST CHINA', region: 'AS', fleet: '320 32N 321' },
  { code: '8L', name: 'Lucky Air', callsign: 'LUCKY AIR', region: 'AS', fleet: '738 7M8 332' },
  { code: 'KN', name: 'China United Airlines', callsign: 'LIANHANG', region: 'AS', fleet: '738 7M8' },
  { code: 'QW', name: 'Qingdao Airlines', callsign: 'SKY LEGEND', region: 'AS', fleet: '320 32N' },
  { code: 'AQ', name: '9 Air', callsign: 'TRANS JADE', region: 'AS', fleet: '738 7M8' },
  { code: 'DR', name: 'Ruili Airlines', callsign: 'SENDI', region: 'AS', fleet: '738 7M8' },
  { code: 'DZ', name: 'Donghai Airlines', callsign: 'DONGHAI AIR', region: 'AS', fleet: '738 7M8' },
  { code: 'GY', name: 'Colorful Guizhou Airlines', callsign: 'COLORFUL', region: 'AS', fleet: 'CR9 ARJ' },
  { code: 'LT', name: 'Longjiang Airlines', callsign: 'SNOW EAGLE', region: 'AS', fleet: 'ARJ 320' },
  { code: 'G5', name: 'China Express Airlines', callsign: 'CHINA EXPRESS', region: 'AS', fleet: 'CR9 ARJ' },
  { code: 'A6', name: 'Hongtu Airlines', callsign: 'HONGTU', region: 'AS', fleet: '319 320' },
  { code: 'GX', name: 'GX Airlines', callsign: 'GUANGXI', region: 'AS', fleet: 'E90 320 32N' },
  { code: '9H', name: 'Air Changan', callsign: 'CHANGAN', region: 'AS', fleet: 'E90 738' },
  { code: 'UQ', name: 'Urumqi Air', callsign: 'LOULAN', region: 'AS', fleet: '320 738' },
  { code: 'OQ', name: 'Chongqing Airlines', callsign: 'CHONG QING', region: 'AS', fleet: '319 320 32N' },
  { code: 'KY', name: 'Kunming Airlines', callsign: 'KUNMING AIR', region: 'AS', fleet: '738 7M8' },
  { code: 'BK', name: 'Okay Airways', callsign: 'OKAYJET', region: 'AS', fleet: '738 7M8 789' },
  { code: 'NS', name: 'Hebei Airlines', callsign: 'HEBEI AIR', region: 'AS', fleet: 'E90 738 7M8' },
  { code: 'Y8', name: 'Suparna Airlines', callsign: 'YANGTZE RIVER', region: 'AS', fleet: '738 7M8' },
  { code: 'FU', name: 'Fuzhou Airlines', callsign: 'STRAITS AIR', region: 'AS', fleet: '738 7M8' },
  { code: 'RY', name: 'Jiangxi Air', callsign: 'AIR JIANGXI', region: 'AS', fleet: '738 7M8' },
  { code: 'GT', name: 'Air Guilin', callsign: 'WELKIN', region: 'AS', fleet: '320 738' },
  { code: '6E', name: 'IndiGo', callsign: 'IFLY', region: 'AS', fleet: 'AT7 320 32N 32Q 789' },
  { code: 'AI', name: 'Air India', callsign: 'AIRINDIA', region: 'AS', fleet: '319 320 32N 321 32Q 788 789 772 77L 77W 359' },
  { code: 'IX', name: 'Air India Express', callsign: 'EXPRESS INDIA', region: 'AS', fleet: '738 7M8 32N' },
  { code: 'QP', name: 'Akasa Air', callsign: 'AKASA AIR', region: 'AS', fleet: '7M8' },
  { code: '9I', name: 'Alliance Air', callsign: 'ALLIED', region: 'AS', fleet: 'DHT AT5 AT7' },
  { code: 'SG', name: 'SpiceJet', callsign: 'SPICEJET', region: 'AS', fleet: 'DH4 738 7M8' },
  { code: 'S5', name: 'Star Air', callsign: 'STAR AIR', region: 'AS', fleet: 'ER4 E75' },
  { code: 'NH', name: 'All Nippon Airways', callsign: 'ALL NIPPON', region: 'AS', fleet: 'DH4 738 32Q 788 789 781 772 77W 388' },
  { code: 'JL', name: 'Japan Airlines', callsign: 'JAPANAIR', region: 'AS', fleet: 'E70 E90 738 7M8 788 789 359 351' },
  { code: 'MM', name: 'Peach', callsign: 'AIR PEACH', region: 'AS', fleet: '320 32N 32Q' },
  { code: 'GK', name: 'Jetstar Japan', callsign: 'ORANGE LINER', region: 'AS', fleet: '320 32N 32Q' },
  { code: 'BC', name: 'Skymark', callsign: 'SKYMARK', region: 'AS', fleet: '738 7M8' },
  { code: 'NU', name: 'Japan Transocean Air', callsign: 'JAI OCEAN', region: 'AS', fleet: '738 7M8' },
  { code: 'KE', name: 'Korean Air', callsign: 'KOREANAIR', region: 'AS', fleet: '223 738 7M8 32Q 333 789 781 77W 74H 388' },
  { code: 'OZ', name: 'Asiana Airlines', callsign: 'ASIANA', region: 'AS', fleet: '320 321 32Q 333 359 77W 388' },
  { code: '7C', name: 'Jeju Air', callsign: 'JEJU AIR', region: 'AS', fleet: '738 7M8' },
  { code: 'TW', name: 'T\'way Air', callsign: 'TWAYAIR', region: 'AS', fleet: '738 7M8 333' },
  { code: 'LJ', name: 'Jin Air', callsign: 'JIN AIR', region: 'AS', fleet: '738 772' },
  { code: 'ZE', name: 'Eastar Jet', callsign: 'EASTAR', region: 'AS', fleet: '738 7M8' },
  { code: 'BX', name: 'Air Busan', callsign: 'AIR BUSAN', region: 'AS', fleet: '320 321 32Q' },
  { code: 'CX', name: 'Cathay Pacific', callsign: 'CATHAY', region: 'AS', fleet: '320 32N 321 32Q 333 359 351 77W' },
  { code: 'UO', name: 'HK Express', callsign: 'HONGKONG SHUTTLE', region: 'AS', fleet: '320 32N 32Q' },
  { code: 'HX', name: 'Hong Kong Airlines', callsign: 'BAUHINIA', region: 'AS', fleet: '320 333 359' },
  { code: 'CI', name: 'China Airlines', callsign: 'DYNASTY', region: 'AS', fleet: '738 32Q 333 359 77W' },
  { code: 'AE', name: 'Mandarin Airlines', callsign: 'MANDARIN', region: 'AS', fleet: 'AT7 E90' },
  { code: 'BR', name: 'EVA Air', callsign: 'EVA', region: 'AS', fleet: '32N 321 32Q 333 789 781 77W' },
  { code: 'JX', name: 'Starlux Airlines', callsign: 'STARWALKER', region: 'AS', fleet: '32Q 339 359' },
  { code: 'IT', name: 'Tigerair Taiwan', callsign: 'SMART CAT', region: 'AS', fleet: '320 32N' },
  { code: 'SQ', name: 'Singapore Airlines', callsign: 'SINGAPORE', region: 'AS', fleet: '738 7M8 781 359 77W 388' },
  { code: 'TR', name: 'Scoot', callsign: 'SCOOTER', region: 'AS', fleet: '295 320 32N 788 789' },
  { code: 'MH', name: 'Malaysia Airlines', callsign: 'MALAYSIAN', region: 'AS', fleet: '738 7M8 333 339 359' },
  { code: 'OD', name: 'Batik Air Malaysia', callsign: 'MALINDO', region: 'AS', fleet: '738 7M8 333' },
  { code: 'AK', name: 'AirAsia', callsign: 'RED CAP', region: 'AS', fleet: '320 32N 321' },
  { code: 'D7', name: 'AirAsia X', callsign: 'XANADU', region: 'AS', fleet: '333' },
  { code: 'FD', name: 'Thai AirAsia', callsign: 'THAI ASIA', region: 'AS', fleet: '320 32N' },
  { code: 'TG', name: 'Thai Airways', callsign: 'THAI', region: 'AS', fleet: '320 32N 333 359 788 789 77W' },
  { code: 'SL', name: 'Thai Lion Air', callsign: 'MENTARI', region: 'AS', fleet: 'AT7 738 7M8 333' },
  { code: 'VZ', name: 'Thai Vietjet', callsign: 'THAIVIET JET', region: 'AS', fleet: '320 321' },
  { code: 'PG', name: 'Bangkok Airways', callsign: 'BANGKOK AIR', region: 'AS', fleet: 'AT7 319 320' },
  { code: 'VN', name: 'Vietnam Airlines', callsign: 'VIET NAM AIRLINES', region: 'AS', fleet: 'AT7 321 32Q 359 789 781' },
  { code: 'VJ', name: 'VietJet Air', callsign: 'VIETJET', region: 'AS', fleet: '320 321 32Q 7M8 333' },
  { code: '5J', name: 'Cebu Pacific', callsign: 'CEBU', region: 'AS', fleet: 'AT7 320 32N 321 32Q 339' },
  { code: 'DG', name: 'Cebgo', callsign: 'BLUE JAY', region: 'AS', fleet: 'AT7' },
  { code: 'PR', name: 'Philippine Airlines', callsign: 'PHILIPPINE', region: 'AS', fleet: 'DH4 320 321 32N 333 359 789 77W' },
  { code: 'JT', name: 'Lion Air', callsign: 'LION INTER', region: 'AS', fleet: '738 739 7M8 333' },
  { code: 'IW', name: 'Wings Air', callsign: 'WINGS ABADI', region: 'AS', fleet: 'AT5 AT7' },
  { code: 'ID', name: 'Batik Air', callsign: 'BATIK', region: 'AS', fleet: '320 738 739 333' },
  { code: 'QG', name: 'Citilink', callsign: 'SUPERGREEN', region: 'AS', fleet: 'AT7 320 32N 333' },
  { code: 'GA', name: 'Garuda Indonesia', callsign: 'INDONESIA', region: 'AS', fleet: 'CRK 738 333 77W' },
  { code: 'SJ', name: 'Sriwijaya Air', callsign: 'SRIWIJAYA', region: 'AS', fleet: '73G 738' },
  { code: '8M', name: 'Myanmar Airways International', callsign: 'MYANMAR', region: 'AS', fleet: 'E90 319 320' },
  { code: 'BG', name: 'Biman Bangladesh Airlines', callsign: 'BANGLADESH', region: 'AS', fleet: 'DH4 738 788 789' },
  { code: 'UL', name: 'SriLankan Airlines', callsign: 'SRILANKAN', region: 'AS', fleet: '320 32N 321 332 333' },
  { code: 'Q2', name: 'Maldivian', callsign: 'ISLAND AVIATION', region: 'AS', fleet: 'DHT DH8' },

  // Oceania
  { code: 'QF', name: 'Qantas', callsign: 'QANTAS', region: 'OC', fleet: 'DH4 717 E90 223 738 32X 332 333 789 388' },
  { code: 'JQ', name: 'Jetstar', callsign: 'JETSTAR', region: 'OC', fleet: '320 321 32Q 788' },
  { code: 'VA', name: 'Virgin Australia', callsign: 'VELOCITY', region: 'OC', fleet: 'AT7 E90 738 7M8', mergeFrom: ['TT'] },
  { code: 'NZ', name: 'Air New Zealand', callsign: 'NEW ZEALAND', region: 'OC', fleet: 'DH3 AT7 320 32N 32Q 789 77W' },
  { code: 'FJ', name: 'Fiji Airways', callsign: 'FIJI', region: 'OC', fleet: 'AT7 7M8 332 359' },
  { code: 'PX', name: 'Air Niugini', callsign: 'NIUGINI', region: 'OC', fleet: 'DH4 221 738 763' },
  { code: 'ZL', name: 'Rex Airlines', callsign: 'REX', region: 'OC', fleet: 'SF3' },
  { code: 'VT', name: 'Air Tahiti', callsign: 'AIR TAHITI', region: 'OC', fleet: 'AT5 AT7' },
  { code: 'TN', name: 'Air Tahiti Nui', callsign: 'TAHITI AIRLINES', region: 'OC', fleet: '789' },
  { code: 'IE', name: 'Solomon Airlines', callsign: 'SOLOMON', region: 'OC', fleet: 'DHT DH8 320' },
  { code: 'SB', name: 'Aircalin', callsign: 'AIRCALIN', region: 'OC', fleet: '32N 339' },
  { code: 'GL', name: 'Air Greenland', callsign: 'GREENLAND', region: 'NA', fleet: 'DHT DH8 DH4 338' },
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
 * (ignoring words like "Airlines") or same radio callsign. A matching IATA
 * code alone doesn't count: with every airline in the world on the map,
 * almost every two-letter code belongs to someone.
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
    if (!by.includes('name') && !by.includes('callsign')) continue;
    // A name match is the strongest reason; otherwise take whatever matches most
    if (by.length && (!best || by.includes('name') > best.by.includes('name') || by.length > best.by.length)) best = { airline: a, by };
  }
  return best;
}
