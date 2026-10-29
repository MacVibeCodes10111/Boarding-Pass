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
  // v2.57: every other country in the game (they used to get US "N" registrations)
  // Caribbean and the Americas
  AW: 'P4-@@@', CW: 'PJ-@@@', SX: 'PJ-@@@', BQ: 'PJ-@@@', BS: 'C6-@@@', JM: '6Y-@@@', TT: '9Y-@@@', BB: '8P-@@@', DO: 'HI####',
  CU: 'CU-T####', HT: 'HH-@@@', KY: 'VP-C@@', BM: 'VP-B@@', VG: 'VP-L@@', AI: 'VP-A@@', MS: 'VP-M@@', TC: 'VQ-T@@', AG: 'V2-@@@',
  KN: 'V4-@@@', LC: 'J6-@@@', VC: 'J8-@@@', GD: 'J3-@@@', DM: 'J7-@@@', VE: 'YV####', EC: 'HC-@@@', BO: 'CP-####', PY: 'ZP-@@@',
  UY: 'CX-@@@', SR: 'PZ-@@@', GY: '8R-@@@', CR: 'TI-@@@', NI: 'YN-@@@', HN: 'HR-@@@', SV: 'YS-@@@', GT: 'TG-@@@', BZ: 'V3-@@@',
  FK: 'VP-F@@',
  // Europe
  HR: '9A-@@@', EE: 'ES-@@@', LT: 'LY-@@@', LV: 'YL-@@@', BG: 'LZ-@@@', BY: 'EW-#####', SK: 'OM-@@@', GE: '4L-@@@', BA: 'E7-@@@',
  RS: 'YU-@@@', CY: '5B-@@@', MD: 'ER-@@@', SI: 'S5-@@@', MK: 'Z3-@@@', ME: '4O-@@@', AL: 'ZA-@@@', LU: 'LX-@@@', MT: '9H-@@@',
  MC: '3A-@@@', XK: 'Z6-@@@', AM: 'EK-#####', AZ: '4K-AZ##', GG: '2-@@@@', JE: 'ZJ-@@@', IM: 'M-@@@@', GI: 'VP-G@@',
  // Asia
  MM: 'XY-@@@', KZ: 'UP-@####', UZ: 'UK-#####', MV: '8Q-@@@', MN: 'JU-####', LA: 'RDPL-#####', KH: 'XU-###', AF: 'YA-@@@',
  TM: 'EZ-@###', KG: 'EX-#####', TJ: 'EY-#####', BT: 'A5-@@@', KP: 'P-###', TL: '4W-@@@', BN: 'V8-@@@', IQ: 'YI-@@@',
  SY: 'YK-@@@', YE: '7O-@@@', LB: 'OD-@@@',
  // Oceania
  SB: 'H4-@@@', KI: 'T3-@@@', VU: 'YJ-@@@', TO: 'A3-@@@', FM: 'V6-@@@', MH: 'V7-####', WS: '5W-@@@', CK: 'E5-@@@', PW: 'T8A-##',
  NR: 'C2-@@@', TV: 'T2-@@@',
  // Africa
  TZ: '5H-@@@', CD: '9S-@@@', AO: 'D2-@@@', MG: '5R-@@@', MZ: 'C9-@@@', LY: '5A-@@@', NA: 'V5-@@@', ZM: '9J-@@@', SO: '6O-@@@',
  SD: 'ST-@@@', UG: '5X-@@@', CV: 'D4-@@@', CI: 'TU-@@@', TD: 'TT-@@@', CM: 'TJ-@@@', GA: 'TR-@@@', BW: 'A2-@@@', ML: 'TZ-@@@',
  GQ: '3C-@@@', ZW: 'Z-@@@', CG: 'TN-@@@', NE: '5U-@@@', MR: '5T-@@@', SN: '6V-@@@', SS: 'Z8-@@@', KM: 'D6-@@@', SH: 'VQ-H@@',
  BI: '9U-@@@', MW: '7Q-@@@', BF: 'XT-@@@', RW: '9XR-@@', LR: 'A8-@@@', MU: '3B-@@@', ST: 'S9-@@@', SC: 'S7-@@@', ER: 'E3-@@@',
  CF: 'TL-@@@', GM: 'C5-@@@', GN: '3X-@@@', BJ: 'TY-@@@', SL: '9L-@@@', DJ: 'J2-@@@', TG: '5V-@@@', LS: '7P-@@@', GW: 'J5-@@@',
  SZ: '3DC-@@',
};

/** Places that use another country's register (territories, dependencies). */
const REG_COUNTRY_ALIAS: Record<string, string> = {
  PR: 'US', VI: 'US', GU: 'US', AS: 'US', MP: 'US', UM: 'US',
  GF: 'FO_FR', GP: 'FO_FR', MQ: 'FO_FR', RE: 'FO_FR', YT: 'FO_FR', BL: 'FO_FR', MF: 'FO_FR', PM: 'FO_FR', WF: 'FO_FR', NC: 'FO_FR', PF: 'FO_FR',
  GL: 'DK', FO: 'DK', AX: 'FI', SJ: 'NO', CC: 'AU', CX: 'AU', NF: 'AU', NU: 'NZ', EH: 'MA',
};
/** French overseas departments and territories register as F-O… */
REG_PATTERNS.FO_FR = 'F-O@@@';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O (they look like 1 and 0)

/** The n-th registration for an airline based in `country`. */
function registrationAt(country: string, airlineIata: string, n: number): string {
  const pattern = REG_PATTERNS[REG_COUNTRY_ALIAS[country] ?? country] ?? REG_PATTERNS.US;
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

// ----------------------------------------------------------------------------
// Sequences (v2.52): registrations that count on from one you choose
//   The part that counts is the last run of digits after the country prefix
//   (N418JT → N419JT, B-3021 → B-3022, JA401A → JA402A); with no digits
//   there, the letters after the dash (P4-AAA → P4-AAB, G-JTAZ → G-JTBA).
// ----------------------------------------------------------------------------
type RegParts = { head: string; group: string; tail: string; kind: 'digits' | 'letters' };

function regParts(reg: string): RegParts | null {
  const r = reg.toUpperCase();
  const dash = r.lastIndexOf('-');
  const prefix = dash >= 0 ? r.slice(0, dash + 1) : '';
  const body = dash >= 0 ? r.slice(dash + 1) : r;
  const m = /^(.*?)(\d+)(\D*)$/.exec(body);
  if (m) return { head: prefix + m[1], group: m[2], tail: m[3], kind: 'digits' };
  const l = /^(.*?)([A-Z]+)$/.exec(body);
  if (l) return { head: prefix + l[1], group: l[2], tail: '', kind: 'letters' };
  return null;
}

/** The shape two registrations share when they belong to one sequence. */
export function regShape(reg: string): string {
  const p = regParts(reg);
  return p ? `${p.head}|${p.kind}${p.group.length}|${p.tail}` : reg.toUpperCase();
}

/** Position in its sequence (a number, so "after" can be compared). */
function regOrdinal(reg: string): number {
  const p = regParts(reg);
  if (!p) return -1;
  if (p.kind === 'digits') return Number(p.group);
  return [...p.group].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
}

/** The registration after this one in its sequence (null if it has nothing to count). */
export function incrementRegistration(reg: string): string | null {
  const p = regParts(reg);
  if (!p) return null;
  let group: string;
  if (p.kind === 'digits') {
    group = String(Number(p.group) + 1).padStart(p.group.length, '0');
  } else {
    const chars = [...p.group];
    let i = chars.length - 1;
    while (i >= 0 && chars[i] === 'Z') chars[i--] = 'A';
    if (i < 0) chars.unshift('A');
    else chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
    group = chars.join('');
  }
  const next = `${p.head}${group}${p.tail}`;
  return validRegistration(next) ? next : null;
}

/**
 * `count` free registrations counting on from `start`: `start` itself first
 * when `includeStart` and it is free, then the ones after it, skipping any
 * already `taken`. Falls back to null if the sequence runs out.
 */
export function sequenceFrom(start: string, count: number, taken: Iterable<string>, includeStart = true): string[] | null {
  const used = new Set([...taken].map((t) => t.toUpperCase()));
  const out: string[] = [];
  let cur: string | null = start.toUpperCase();
  if (!includeStart) cur = incrementRegistration(cur);
  let guard = 0;
  while (out.length < count && cur && guard++ < 100_000) {
    if (!used.has(cur)) {
      out.push(cur);
      used.add(cur);
    }
    cur = incrementRegistration(cur);
  }
  return out.length === count ? out : null;
}

/**
 * Registrations for new aircraft (v2.52). They follow the airline's first
 * aircraft: the next ones after the highest registration in its sequence, so
 * the numbers always go up and never fill in gaps left by aircraft sold. A
 * typed registration starts the batch and the rest count on from it. With no
 * fleet yet, the hub country's usual style is used.
 */
export function registrationsForNewAircraft(
  fleetInOrder: string[],
  airlineIata: string,
  country: string,
  count: number,
  typedFirst?: string
): string[] {
  const taken = fleetInOrder;
  if (typedFirst) {
    const seq = sequenceFrom(typedFirst, count, taken);
    if (seq) return seq;
  }
  if (fleetInOrder.length > 0) {
    const shape = regShape(fleetInOrder[0]);
    const same = fleetInOrder.filter((r) => regShape(r) === shape);
    const last = same.reduce((a, b) => (regOrdinal(b) > regOrdinal(a) ? b : a), same[0]);
    const seq = sequenceFrom(last, count, taken, false);
    if (seq) return seq;
  }
  return nextRegistrations(taken, airlineIata, country, count);
}

/**
 * New registrations for several aircraft at once, counting on from `start`
 * in the order given. Registrations of the aircraft being renamed are free to
 * reuse; others in the fleet are skipped. Null if `start` can't count.
 */
export function reRegisterSequence(start: string, renaming: string[], fleet: string[]): string[] | null {
  const moving = new Set(renaming.map((r) => r.toUpperCase()));
  return sequenceFrom(start, renaming.length, fleet.filter((r) => !moving.has(r.toUpperCase())));
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
