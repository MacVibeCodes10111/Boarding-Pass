// ============================================================================
// REGISTRATIONS AND FLIGHT NUMBERS (v2.38+)
//
// New aircraft get a registration in the style of the hub's country (N401JT
// in the US, G-JTAB in Britain, D-AJTA in Germany, B-3021 in China, JA401J in
// Japan…), and flights get numbers the way airlines number them: long-haul
// flagships the low numbers, short hops four digits, the return flight the
// next number up (outbound odd, return even).
// ============================================================================

/** Registration pattern per country: @ = letter, # = digit; the rest is literal. */
const REG_PATTERNS: Record<string, string> = {
  US: 'NDDDAA', // N + three digits + the airline's code (filled below)
  GB: 'G-@@@@', DE: 'D-A@@@', FR: 'F-H@@@', IT: 'I-@@@@', ES: 'EC-@@@', NL: 'PH-@@@', IE: 'EI-@@@', CH: 'HB-J@@', AT: 'OE-@@@',
  BE: 'OO-@@@', SE: 'SE-@@@', NO: 'LN-@@@', DK: 'OY-@@@', FI: 'OH-@@@', PT: 'CS-T@@', PL: 'SP-@@@', TR: 'TC-J@@', GR: 'SX-@@@',
  IS: 'TF-@@@', CZ: 'OK-@@@', HU: 'HA-@@@', RO: 'YR-@@@', RU: 'RA-#####', UA: 'UR-@@@',
  CA: 'C-F@@@', MX: 'XA-@@@', BR: 'PR-@@@', AR: 'LV-@@@', CL: 'CC-@@@', CO: 'HK-####', PE: 'OB-####', PA: 'HP-####',
  CN: 'B-####', HK: 'B-H@@', TW: 'B-#####', MO: 'B-M@@', JP: 'JA###@', KR: 'HL####', IN: 'VT-@@@', PK: 'AP-@@@', SG: '9V-@@@',
  MY: '9M-@@@', TH: 'HS-@@@', ID: 'PK-@@@', PH: 'RP-C####', VN: 'VN-A###', LK: '4R-@@@', BD: 'S2-@@@', NP: '9N-@@@',
  AE: 'A6-@@@', QA: 'A7-@@@', SA: 'HZ-@@@', BH: 'A9C-@@', OM: 'A4O-@@', KW: '9K-@@@', JO: 'JY-@@@', IL: '4X-@@@', IR: 'EP-@@@',
  EG: 'SU-@@@', MA: 'CN-@@@', DZ: '7T-@@@', TN: 'TS-@@@', ZA: 'ZS-@@@', KE: '5Y-@@@', ET: 'ET-@@@', NG: '5N-@@@', GH: '9G-@@@',
  AU: 'VH-@@@', NZ: 'ZK-@@@', FJ: 'DQ-@@@', PG: 'P2-@@@',
};

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O (they look like 1 and 0)

/** The n-th registration for an airline based in `country`. */
function registrationAt(country: string, airlineIata: string, n: number): string {
  const pattern = REG_PATTERNS[country] ?? REG_PATTERNS.US;
  const code = (airlineIata.toUpperCase().replace(/[^A-Z]/g, '') || 'XX').padEnd(2, 'X');
  if (pattern === 'NDDDAA') return `N${401 + n}${code.slice(0, 2)}`;
  const letterSlots = [...pattern].filter((c) => c === '@').length;
  const digitSlots = [...pattern].filter((c) => c === '#').length;
  // With three or more letters the first carries the airline's initial (G-JTxx, D-AJxx)
  const fixedFirst = letterSlots >= 3 && LETTERS.includes(code[0]) ? LETTERS.indexOf(code[0]) : -1;
  const freeLetters = letterSlots - (fixedFirst >= 0 ? 1 : 0);
  const combos = LETTERS.length ** freeLetters;
  let li = n % combos;
  const digitIdx = Math.floor(n / combos);
  const letters: number[] = [];
  for (let i = 0; i < freeLetters; i++) {
    letters.unshift(li % LETTERS.length);
    li = Math.floor(li / LETTERS.length);
  }
  if (fixedFirst >= 0) letters.unshift(fixedFirst);
  // Numbers start somewhere believable (B-3021, JA401A, RA-18001), not at 0000
  const base = digitSlots >= 5 ? 18001 : digitSlots === 4 ? 3021 : digitSlots === 3 ? 401 : 1;
  const digits = String((base + digitIdx) % 10 ** Math.max(1, digitSlots)).padStart(digitSlots, '0');
  let d = 0;
  let l = 0;
  return [...pattern].map((c) => (c === '#' ? digits[d++] : c === '@' ? LETTERS[letters[l++]] : c)).join('');
}

/** First free registration for a new aircraft, in the style of `country`. */
export function nextRegistration(taken: Iterable<string>, airlineIata: string, country: string): string {
  const set = new Set([...taken].map((t) => t.toUpperCase()));
  for (let n = 0; n < 200_000; n++) {
    const r = registrationAt(country, airlineIata, n);
    if (!set.has(r)) return r;
  }
  return `N${Date.now() % 100000}${airlineIata}`;
}

/** Several free registrations at once. */
export function nextRegistrations(taken: Iterable<string>, airlineIata: string, country: string, count: number): string[] {
  const all = new Set([...taken].map((t) => t.toUpperCase()));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const r = nextRegistration(all, airlineIata, country);
    all.add(r);
    out.push(r);
  }
  return out;
}

/** A registration the player typed: letters, digits and dashes, 3 to 10 long. */
export const validRegistration = (r: string) => /^[A-Z0-9][A-Z0-9-]{1,8}[A-Z0-9]$/.test(r);

// ----------------------------------------------------------------------------
// Flight numbers
// ----------------------------------------------------------------------------
/** Number range airlines tend to use for a flight of this length. */
export function flightNumberBand(distanceNm?: number): [number, number] {
  if (distanceNm === undefined) return [101, 1999];
  if (distanceNm >= 3000) return [1, 99];
  if (distanceNm >= 1500) return [100, 499];
  if (distanceNm >= 600) return [500, 1999];
  return [2000, 4999];
}
