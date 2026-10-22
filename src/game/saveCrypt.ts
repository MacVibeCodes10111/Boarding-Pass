// ============================================================================
// PROTECTED SAVES (v2.38+)
//
// Careers are stored and exported scrambled and signed, so editing a save
// (more cash, extra grants, aircraft for free) doesn't work: a changed save
// fails its signature and won't load as a career.
//
//   BP2.<salt>.<signature>.<scrambled save, base64>
//
// The game runs on the player's own computer, so this keeps out casual save
// editing, not a determined cheat with the game's source in hand.
//
// Saves from before v2.38 (plain JSON) load once as they are and are re-saved
// protected. After that, a plain save (an old export, or one written by hand)
// opens in Sandbox mode, where money doesn't matter.
// ============================================================================

const PREFIX = 'BP2.';
// Mixed into the signature and the scrambling; not a secret from anyone who reads the code
const PEPPER = 'boarding-pass:northgate:7f3c91e2a4d6b8f0:save-v2';

/** 32-bit string hash (MurmurHash3-style mixing), seeded. */
function hash32(str: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    let k = str.charCodeAt(i);
    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
  }
  h ^= str.length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const hex8 = (n: number) => (n >>> 0).toString(16).padStart(8, '0');

/** 128-bit signature of the save text (four differently seeded passes). */
function sign(salt: string, text: string): string {
  const body = `${PEPPER}|${salt}|${text}|${PEPPER}`;
  return [0x9e3779b9, 0x7f4a7c15, 0x94d049bb, 0x2545f491].map((s) => hex8(hash32(body, s))).join('');
}

/** Keystream (xorshift128) for the scrambling, from the salt. */
function keystream(salt: string) {
  let x = hash32(PEPPER + salt, 1) || 1;
  let y = hash32(PEPPER + salt, 2) || 2;
  let z = hash32(PEPPER + salt, 3) || 3;
  let w = hash32(PEPPER + salt, 4) || 4;
  return () => {
    const t = x ^ (x << 11);
    x = y;
    y = z;
    z = w;
    w = (w ^ (w >>> 19) ^ (t ^ (t >>> 8))) >>> 0;
    return w & 0xff;
  };
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function randomSalt(): string {
  const a = new Uint32Array(2);
  try {
    crypto.getRandomValues(a);
  } catch {
    a[0] = (Math.random() * 2 ** 32) >>> 0;
    a[1] = (Date.now() & 0xffffffff) >>> 0;
  }
  return hex8(a[0]) + hex8(a[1]);
}

/** Scrambles and signs a save. */
export function protectSave(value: unknown): string {
  const text = JSON.stringify(value);
  const salt = randomSalt();
  const bytes = new TextEncoder().encode(text);
  const ks = keystream(salt);
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= ks();
  return `${PREFIX}${salt}.${sign(salt, text)}.${toBase64(bytes)}`;
}

export const isProtectedSave = (s: unknown): s is string => typeof s === 'string' && s.startsWith(PREFIX);

export type OpenedSave<T> = { ok: true; value: T } | { ok: false; reason: 'tampered' | 'unreadable' };

/** Unscrambles a save and checks its signature. */
export function openProtectedSave<T = unknown>(s: string): OpenedSave<T> {
  try {
    const [salt, sig, b64] = s.slice(PREFIX.length).split('.');
    if (!salt || !sig || !b64) return { ok: false, reason: 'unreadable' };
    const bytes = fromBase64(b64);
    const ks = keystream(salt);
    for (let i = 0; i < bytes.length; i++) bytes[i] ^= ks();
    const text = new TextDecoder().decode(bytes);
    if (sign(salt, text) !== sig) return { ok: false, reason: 'tampered' };
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}
