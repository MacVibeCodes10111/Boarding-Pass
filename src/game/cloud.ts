// ============================================================================
// CLOUD SAVES AND ACCOUNTS (v2.49+)
//
// Optional. A player who signs in (Google, Discord, or a username and
// password) has their careers copied between their devices through the game's
// Supabase project. Nothing here runs, and the Supabase code isn't even loaded,
// until someone signs in.
//
// How a career moves between devices:
//   - Upload: the protected save (the same scrambled, signed text as on the
//     device) goes up with its revision number. The server keeps only the
//     newest copy of each career and refuses an older one.
//   - Download: a device fetches the copies it hasn't received, stores each
//     one, reads it back to check it arrived whole, and only then tells the
//     server ("ack"). Once every other device used in the last 30 days has
//     the newest copy, the server deletes it, so the cloud holds only careers
//     still on their way somewhere. A copy no other device needs yet stays as
//     the copy for the next device; copies untouched for 90 days are deleted.
//   - The career open on this device is never replaced while it's being
//     played; it's offered when the player is back on the home screen.
//   - A career changed on two devices since they last synced isn't doubled
//     up: the player picks which version to keep (v3.0.2).
//   - An account is signed in on one device at a time: the newest sign-in
//     wins and older devices are signed out (v3.0.2, see ELSEWHERE_CODE).
//   - Dev builds and the test site use their own channel and never exchange
//     careers with the real game.
// The server side (tables, functions, daily clean-up) is in the Supabase
// project "boarding-pass"; players can only call the cloud_* functions, and
// each only touches that player's own rows.
// ============================================================================
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { IS_DEV } from './channel';
import { clearOnlineState, featureOn, setFeatures } from './features';
import { buildProfile, logoBytes, profileKey, type OnlineMode, type Profile } from './profile';
import { buildSnapshot } from './scheduleSnapshot';
import { normaliseLogo } from './livery';
import { IS_MAC } from './platform';
import { openProtectedSave, protectSave } from './saveCrypt';
import { MAX_SAVE_SLOTS, hasRoomForCareer, readSaveSlots, serializeSave, writeSaveSlots, isValidSave } from './saves';
import type { SaveGameState } from './types';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
// `npm run dev` can point at the build project (.env.development.local); a released build always uses the real one
const SUPABASE_URL = (env.DEV && env.VITE_BP_SUPABASE_URL) || 'https://dlgkdknfxhmtkhpegufq.supabase.co';
/** The project's publishable key: public by design (it only allows what the database lets players do). */
const SUPABASE_KEY = (env.DEV && env.VITE_BP_SUPABASE_KEY) || 'sb_publishable_AP8t-FaDMPZ0dHYFezBqPQ_MDoYkfXv';
// The logos Worker (cloud/logos-worker). Logos stay off until the server's flag is on.
const LOGOS_URL = (env.DEV && env.VITE_BP_LOGOS_URL) || 'https://bp-logos.boardingpass-game.workers.dev';

/** Storage keys (listed on boardingpass.my/cookies.html). */
export const CLOUD_SESSION_KEY = 'bp_cloud_session_v1';
const DEVICE_KEY = 'bp_cloud_device_v1';
const SYNCED_KEY = 'bp_cloud_synced_v1';
const AGE_KEY = 'bp_cloud_age_v1';
const AUTO_KEY = 'bp_cloud_auto_v1';

const CHANNEL = IS_DEV ? 'dev' : 'main';
/** Desktop apps get sign-in back from the browser through this link. */
const APP_SCHEME = IS_DEV ? 'boardingpass-dev' : 'boardingpass';
const APP_REDIRECT = `${APP_SCHEME}://auth`;
/** Usernames become this address inside Supabase; no mail is ever sent to it. */
const USERNAME_DOMAIN = 'players.boardingpass.my';
const MAX_UPLOAD_CHARS = 3_000_000;

export const inDesktopApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Opens a web page in the player's browser, from the desktop apps. */
export async function openExternal(url: string): Promise<void> {
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  },
  remove(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* storage unavailable */
    }
  },
};

// ---------------------------------------------------------------------------
// Age check (US COPPA): accounts are for players 13 and over. The answer is
// kept only as "ok" or "under13", never the date itself.
// ---------------------------------------------------------------------------
export type AgeStatus = 'unknown' | 'ok' | 'under13';
export const ageStatus = (): AgeStatus => {
  const v = store.get(AGE_KEY);
  return v === 'ok' || v === 'under13' ? v : 'unknown';
};
export function recordAge(year: number, month: number, now = new Date()): AgeStatus {
  let age = now.getFullYear() - year;
  // Only the month is asked, so a birthday this month counts as still to come
  if (now.getMonth() + 1 <= month) age -= 1;
  const status: AgeStatus = age >= 13 ? 'ok' : 'under13';
  store.set(AGE_KEY, status);
  return status;
}

// ---------------------------------------------------------------------------
// The Supabase client, loaded only when needed
// ---------------------------------------------------------------------------
let clientP: Promise<SupabaseClient> | null = null;
function client(): Promise<SupabaseClient> {
  clientP ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { storageKey: CLOUD_SESSION_KEY, flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      global: { fetch: watchedFetch },
    }),
  );
  return clientP;
}

// ---------------------------------------------------------------------------
// One device at a time (v3.0.2): the server lets an account be signed in on
// the device that signed in most recently. Any call from an older one is
// refused with this code, and that device signs out (its careers stay).
// ---------------------------------------------------------------------------
const ELSEWHERE_CODE = 'P0410';
const elsewhereListeners = new Set<() => void>();
/** Runs when this device was signed out because the account signed in on another one. */
export function onSignedOutElsewhere(fn: () => void): () => void {
  elsewhereListeners.add(fn);
  return () => elsewhereListeners.delete(fn);
}

async function watchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (res.status >= 400 && url.includes('/rest/v1/')) {
    res
      .clone()
      .json()
      .then((b: { code?: string } | null) => {
        if (b?.code === ELSEWHERE_CODE) void signedOutElsewhere();
      })
      .catch(() => {});
  }
  return res;
}

let leaving = false;
async function signedOutElsewhere(): Promise<void> {
  if (leaving || !mightBeSignedIn()) return;
  leaving = true;
  try {
    const c = await client();
    await c.auth.signOut({ scope: 'local' }).catch(() => {});
    store.remove(CLOUD_SESSION_KEY); // even if the sign-out call failed
    store.remove(SYNCED_KEY);
    conflicts.clear();
    setPicks(null);
    forgetSharing();
    for (const fn of elsewhereListeners) fn();
  } finally {
    leaving = false;
  }
}

/** True when this device has (or may have) a signed-in session, without loading anything. */
export const mightBeSignedIn = () => store.get(CLOUD_SESSION_KEY) !== null;

export type CloudUser = { id: string; name: string; provider: 'google' | 'discord' | 'username' | string };
function describeUser(u: User): CloudUser {
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const provider = String(u.app_metadata?.provider ?? 'email');
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  if (provider === 'email') return { id: u.id, name: str(meta.username) || (u.email ?? '').split('@')[0], provider: 'username' };
  return { id: u.id, name: str(meta.full_name) || str(meta.name) || str(meta.user_name) || u.email || 'Player', provider };
}

/** The signed-in player, or null. Loads the client only if a session is stored. */
export async function currentUser(): Promise<CloudUser | null> {
  if (!mightBeSignedIn()) return null;
  const c = await client();
  const { data } = await c.auth.getSession();
  return data.session ? describeUser(data.session.user) : null;
}

/** Called once at start: finishes a Google/Discord sign-in that returned to this page. */
export async function finishWebSignIn(): Promise<CloudUser | null> {
  if (inDesktopApp() || typeof location === 'undefined') return null;
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (!code && !error) return null;
  url.searchParams.delete('code');
  url.searchParams.delete('error');
  url.searchParams.delete('error_code');
  url.searchParams.delete('error_description');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  if (!code) throw new Error(error || 'Sign-in was cancelled.');
  return exchangeCode(code);
}

async function exchangeCode(code: string): Promise<CloudUser> {
  const c = await client();
  const { data, error } = await c.auth.exchangeCodeForSession(code);
  if (error || !data.session) throw new Error(friendlyAuthError(error?.message));
  return describeUser(data.session.user);
}

/** Desktop apps: the browser hands the sign-in back as boardingpass://auth?code=… */
export async function finishDesktopSignIn(link: string): Promise<CloudUser | null> {
  if (!link.startsWith(`${APP_SCHEME}://`)) return null;
  const url = new URL(link);
  const code = url.searchParams.get('code');
  if (!code) throw new Error(url.searchParams.get('error_description') || 'Sign-in was cancelled.');
  return exchangeCode(code);
}

/** Opens Google's or Discord's sign-in (a new page on the web, the system browser in the desktop apps). */
export async function signInWith(provider: 'google' | 'discord'): Promise<void> {
  const c = await client();
  const desktop = inDesktopApp();
  const redirectTo = desktop ? APP_REDIRECT : `${location.origin}${location.pathname}`;
  const { data, error } = await c.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true, scopes: provider === 'discord' ? 'identify email' : undefined },
  });
  if (error || !data.url) throw new Error(friendlyAuthError(error?.message));
  if (desktop) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(data.url);
  } else {
    location.assign(data.url);
  }
}

export const USERNAME_RULE = '3 to 20 letters, numbers or underscores';
export const normaliseUsername = (s: string) => s.trim().toLowerCase();
export const validUsername = (s: string) => /^[a-z0-9_]{3,20}$/.test(normaliseUsername(s));
export const PASSWORD_MIN = 8;

export async function signInWithUsername(username: string, password: string, create: boolean): Promise<CloudUser> {
  const u = normaliseUsername(username);
  if (!validUsername(u)) throw new Error(`Usernames are ${USERNAME_RULE}.`);
  if (password.length < PASSWORD_MIN) throw new Error(`Passwords need at least ${PASSWORD_MIN} characters.`);
  const c = await client();
  const email = `${u}@${USERNAME_DOMAIN}`;
  if (create) {
    // Username accounts are made by the game's create-account function (it
    // checks the name and limits how many accounts one address can make);
    // the open sign-up endpoint refuses password accounts.
    let res: Response;
    try {
      res = await fetch(`${SUPABASE_URL}/functions/v1/create-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
        body: JSON.stringify({ username: u, password, device: deviceId() }),
      });
    } catch {
      throw new Error('Can’t reach the cloud. Check your connection.');
    }
    if (!res.ok) {
      const code = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      throw new Error(
        code === 'taken'
          ? 'That username is taken. Pick another.'
          : code === 'rate_limited'
            ? 'Too many new accounts from this device or connection today. Try again tomorrow.'
            : code === 'bad_username'
              ? `Usernames are ${USERNAME_RULE}.`
              : code === 'bad_password' || code === 'weak_password'
                ? `Pick a password of ${PASSWORD_MIN} to 72 characters that isn’t easy to guess.`
                : 'Accounts can’t be created right now. Try again later.',
      );
    }
  }
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(friendlyAuthError(error?.message));
  return describeUser(data.session.user);
}

function friendlyAuthError(msg?: string): string {
  const m = (msg ?? '').toLowerCase();
  if (m.includes('invalid login')) return 'That username and password don’t match.';
  if (m.includes('already registered') || m.includes('already exists')) return 'That username is taken. Pick another.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many tries. Wait a few minutes and try again.';
  if (m.includes('weak') || m.includes('password')) return 'Pick a longer or less common password.';
  if (m.includes('provider is not enabled') || m.includes('unsupported provider')) return 'That sign-in option isn’t switched on yet.';
  if (m.includes('fetch') || m.includes('network')) return 'Can’t reach the cloud. Check your connection.';
  if (m.includes('another device')) return 'You signed in on another device, so you were signed out here. Your careers stay on this device.';
  if (m.includes('too many syncs')) return 'You’ve synced a lot today, so syncing is paused for a while. Your careers are safe on this device.';
  if (m.includes('database error') || m.includes('not allowed') || m.includes('not available')) return 'That isn’t possible with Boarding Pass accounts.';
  return msg || 'Something went wrong. Try again.';
}

// ---------------------------------------------------------------------------
// This device
// ---------------------------------------------------------------------------
function deviceId(): string {
  let id = store.get(DEVICE_KEY);
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
    id = crypto.randomUUID();
    store.set(DEVICE_KEY, id);
  }
  return id;
}

function deviceName(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const base = inDesktopApp()
    ? IS_MAC
      ? 'Mac app'
      : 'Windows app'
    : /iphone/i.test(ua)
      ? 'iPhone browser'
      : /ipad/i.test(ua) || (IS_MAC && 'ontouchend' in document)
        ? 'iPad browser'
        : /android/i.test(ua)
          ? 'Android browser'
          : IS_MAC
            ? 'Mac browser'
            : /windows/i.test(ua)
              ? 'Windows browser'
              : 'Browser';
  return IS_DEV ? `${base} (Dev)` : base;
}

/** Signs out on this device; this device stops counting as one waiting for careers. */
export async function signOut(): Promise<void> {
  const c = await client();
  try {
    await c.rpc('cloud_forget_device', { p_device: deviceId() });
  } catch {
    /* offline: the server forgets the device after 30 days anyway */
  }
  await c.auth.signOut({ scope: 'local' });
  store.remove(SYNCED_KEY);
  conflicts.clear();
  setPicks(null);
  forgetSharing();
}

/** Deletes the account and every cloud copy. Careers on devices stay. */
export async function deleteAccount(): Promise<void> {
  const c = await client();
  const { error } = await c.rpc('delete_my_account');
  if (error) throw new Error(friendlyAuthError(error.message));
  await c.auth.signOut({ scope: 'local' });
  store.remove(SYNCED_KEY);
  setPicks(null);
  forgetSharing();
}

const forgetListeners = new Set<() => void>();
/** Runs when the player signs out or deletes their account: nothing of other players' stays behind. */
export function onForgetOnline(fn: () => void): () => void {
  forgetListeners.add(fn);
  return () => forgetListeners.delete(fn);
}

function forgetSharing() {
  clearOnlineState();
  for (const fn of forgetListeners) fn();
  mine = null;
  published.clear();
  scheduled.clear();
  logoStatus = {};
}

/** Reads which online features are on (see features.ts). Any failure leaves them all off. */
export async function refreshFeatures(): Promise<void> {
  const c = await signedInClient().catch(() => null);
  if (!c) return setFeatures(null);
  try {
    const { data, error } = await c.from('features').select('feature,enabled').eq('channel', CHANNEL);
    setFeatures(error ? null : data);
  } catch {
    setFeatures(null);
  }
  if (featureOn('profiles')) await refreshMyAirlines();
}

// ---------------------------------------------------------------------------
// Shared airlines (A1, per airline since 2026-11-07): each shared career is an
// airline of its own online, with its own friend code, friends and map choice.
// Up to 10 a player. A career is shared from inside it; the list is kept on the
// server so every device agrees. Each is published when it's shared, then when
// its details change, every few minutes at most.
// ---------------------------------------------------------------------------
export interface MyAirline {
  /** Its public id: what other players and the Worker know it by. */
  id: string;
  saveId: string;
  airline: string;
  code: string;
  friendCode: string;
  mode: OnlineMode;
  /** Its flights are shown on its friends' maps. */
  mapOn: boolean;
}

const PUBLISH_EVERY_MS = 5 * 60_000;
export const MAX_SHARED_AIRLINES = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FRIEND_CODE = /^[2-9BCDFGHJKLMNPQRSTVWXZ]{8}$/;

/** Null until the server has been asked. */
let mine: MyAirline[] | null = null;
/** For each shared career: when it was last sent, what was sent, and which logos are in step. */
const published = new Map<string, { at: number; key: string; logos: string }>();

export const myAirlines = (): MyAirline[] => mine ?? [];
export const myAirlinesKnown = () => mine !== null;
/** The shared airline of this career, if it's shared. */
export const airlineFor = (saveId: string | null | undefined): MyAirline | null => (saveId ? (mine ?? []).find((a) => a.saveId === saveId) ?? null : null);

/** What the server sent, safe to use. */
export function normaliseMyAirlines(x: unknown): MyAirline[] {
  if (!Array.isArray(x)) return [];
  const out: MyAirline[] = [];
  for (const v of x) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    if (typeof o.id !== 'string' || !UUID.test(o.id) || typeof o.saveId !== 'string' || !o.saveId) continue;
    out.push({
      id: o.id,
      saveId: o.saveId.slice(0, 80),
      airline: typeof o.airline === 'string' ? o.airline.slice(0, 40) : '',
      code: typeof o.code === 'string' ? o.code.slice(0, 3) : '',
      friendCode: typeof o.friendCode === 'string' && FRIEND_CODE.test(o.friendCode) ? o.friendCode : '',
      mode: o.mode === 'sandbox' ? 'sandbox' : 'career',
      mapOn: o.mapOn === true,
    });
  }
  return out.slice(0, MAX_SHARED_AIRLINES);
}

const PUBLISH_PROBLEM: Record<string, string> = {
  bad_name: 'That airline’s name, code or callsign can’t be shared. Change it in Airline details and try again.',
  bad_text: 'A name or text on this airline’s liveries can’t be shared. Change it in the livery editor and try again.',
  bad_livery: 'This airline’s liveries can’t be shared. Open them in the livery editor, save, and try again.',
  too_big: 'These liveries are too detailed to share. Remove some brush painting and try again.',
  too_many: `You can share ${MAX_SHARED_AIRLINES} airlines at most. Stop sharing one first.`,
  off: 'Sharing isn’t available right now.',
  suspended: 'This account can’t share airlines right now, because of the sharing rules. Your careers keep working as before.',
};

/** Reads the player's shared airlines from the server. */
export async function refreshMyAirlines(): Promise<void> {
  const c = await signedInClient().catch(() => null);
  if (!c) return;
  const { data, error } = await c.rpc('airlines_mine', { p_channel: CHANNEL });
  if (error) return;
  const next = normaliseMyAirlines(data);
  if (JSON.stringify(next) !== JSON.stringify(mine)) {
    mine = next;
    notify();
  }
}

const profileOf = (s: SaveGameState) => buildProfile(s, { logos: logosReady() });

async function publish(c: SupabaseClient, p: Profile): Promise<string> {
  const { data, error } = await c.rpc('profile_publish', {
    p_channel: CHANNEL,
    p_save_id: p.saveId,
    p_airline: p.airline,
    p_code: p.code,
    p_callsign: p.callsign,
    p_colours: p.colours,
    p_liveries: p.liveries,
    p_stats: p.stats,
    p_mode: p.mode,
  });
  if (error) throw new Error(friendlyAuthError(error.message));
  if (data === 'saved') published.set(p.saveId, { at: Date.now(), key: profileKey(p), logos: published.get(p.saveId)?.logos ?? '' });
  return String(data);
}

/** Shares this career as an airline of its own (or updates it). Says why if it can't. */
export async function shareCareer(s: SaveGameState): Promise<void> {
  const c = await signedInClient();
  if (!c) throw new Error('Sign in to share your airline.');
  const p = profileOf(s);
  const r = await publish(c, p);
  if (r !== 'saved' && r !== 'too_soon') throw new Error(PUBLISH_PROBLEM[r] ?? 'Sharing didn’t work. Try again later.');
  await refreshMyAirlines();
  const air = airlineFor(s.saveId);
  if (air) await syncLogos(c, air.id, p);
}

/** Stops sharing this airline: the server deletes it straight away, with its friends, and its logos and schedule go too. */
export async function stopSharing(saveId: string): Promise<void> {
  const c = await signedInClient();
  if (!c) throw new Error('Sign in to change what you share.');
  const air = airlineFor(saveId);
  const { error } = await c.rpc('profile_delete', { p_channel: CHANNEL, p_save_id: saveId });
  if (error) throw new Error(friendlyAuthError(error.message));
  published.delete(saveId);
  if (mine) mine = mine.filter((a) => a.saveId !== saveId);
  notify();
  if (!air) return;
  scheduled.delete(air.id);
  delete logoStatus[air.id];
  // If these don't get through, the server has queued them for the nightly clean-up
  await workerRequest(c, '/logo', air.id, { method: 'DELETE' }).catch(() => undefined);
  await workerRequest(c, '/schedule', air.id, { method: 'DELETE' }).catch(() => undefined);
}

/** After a save: sends a shared career's details if they changed. Never gets in the way of playing. */
export async function publishIfDue(s: SaveGameState, now = Date.now()): Promise<void> {
  const air = airlineFor(s.saveId);
  if (!air) return;
  void publishScheduleIfDue(air, s, now);
  const last = published.get(s.saveId);
  if (!featureOn('profiles') || now - (last?.at ?? 0) < PUBLISH_EVERY_MS) return;
  try {
    const p = profileOf(s);
    const unchanged = profileKey(p) === last?.key;
    if (unchanged && last?.logos === logoSet(p)) return;
    const c = await signedInClient();
    if (!c) return;
    if (unchanged) {
      published.set(s.saveId, { ...last!, at: now });
      return await syncLogos(c, air.id, p);
    }
    if ((await publish(c, p)) === 'saved') {
      await syncLogos(c, air.id, p);
      // A name or mode change shows in the Online window
      if (p.airline !== air.airline || p.code !== air.code || p.mode !== air.mode) await refreshMyAirlines();
    }
  } catch {
    /* offline, or the details can't be shared right now: the last good copy stays */
  }
}

// ---------------------------------------------------------------------------
// Shared logos (A2): pictures go to the Worker, each with the airline that uses
// it, and other players see them once they're approved. A player's own copy
// stays in their save, so nothing about playing depends on any of this: a
// failure here is tried again later.
// ---------------------------------------------------------------------------
/** For each shared airline: its logos' review status. */
let logoStatus: Record<string, Record<string, string>> = {};

/** Logos are shared only once the Worker's address is in the game and the server has them switched on. */
const logosReady = () => Boolean(LOGOS_URL) && featureOn('logos');
const logoSet = (p: Profile) => Object.keys(p.logos).sort().join(',');

/** How a shared airline's logos are doing in review. */
export function logoReview(airline: string | null | undefined): { waiting: number; refused: number } {
  const all = Object.values((airline && logoStatus[airline]) || {});
  return { waiting: all.filter((x) => x === 'pending').length, refused: all.filter((x) => x === 'rejected').length };
}

/** A request to the Worker, as the signed-in player, for one of their airlines (or none). */
async function workerRequest(c: SupabaseClient, path: string, airline: string | null, init: RequestInit): Promise<Response> {
  const { data } = await c.auth.getSession();
  const token = data.session?.access_token;
  if (!token || !LOGOS_URL) throw new Error('No logo service');
  const q = `?channel=${CHANNEL}${airline ? `&airline=${encodeURIComponent(airline)}` : ''}`;
  const res = await fetch(`${LOGOS_URL}${path}${q}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Logo service: ${res.status}`);
  return res;
}

/** Makes the Worker hold exactly the logos this airline's profile uses. Fails quietly: the next save tries again. */
async function syncLogos(c: SupabaseClient, airline: string, p: Profile): Promise<void> {
  if (!logosReady()) return;
  const mark = (logos: string) => published.set(p.saveId, { ...(published.get(p.saveId) ?? { at: Date.now(), key: '' }), logos });
  try {
    const keep = Object.keys(p.logos);
    const had = (await (await workerRequest(c, '/logo/sync', airline, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keep }) })).json()) as { logos: Record<string, string> };
    const next = { ...had.logos };
    for (const hash of keep) {
      if (next[hash]) continue;
      const url = p.logos[hash];
      const bytes = logoBytes(url);
      const res = await workerRequest(c, '/logo', airline, { method: 'PUT', headers: { 'content-type': url.slice(5, url.indexOf(';')) }, body: bytes.slice().buffer });
      next[hash] = ((await res.json()) as { status: string }).status;
    }
    logoStatus = { ...logoStatus, [airline]: next };
    mark(logoSet(p));
    notify();
  } catch {
    mark('failed');
  }
}

/** Reads how one of this player's airlines' logos are doing in review. */
export async function refreshLogoReview(airline: string): Promise<void> {
  if (!logosReady() || !UUID.test(airline)) return;
  const c = await signedInClient().catch(() => null);
  if (!c) return;
  try {
    const got = ((await (await workerRequest(c, '/logo/mine', airline, { method: 'GET' })).json()) as { logos: Record<string, string> }).logos;
    logoStatus = { ...logoStatus, [airline]: got };
    notify();
  } catch {
    /* it'll show the last known state */
  }
}

/** Another player's logo as a data URL, or null if it isn't approved or can't be fetched. */
export async function fetchSharedLogo(hash: string): Promise<string | null> {
  if (!LOGOS_URL || !/^[0-9a-f]{64}$/.test(hash)) return null;
  try {
    const res = await fetch(`${LOGOS_URL}/logo/${hash}`);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(normaliseLogo(r.result) ?? null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Friends (A3, see friends.ts): a server function for the signed-in player.
// ---------------------------------------------------------------------------
/** Calls a server function in this channel. Null when nobody is signed in. */
export async function cloudRpc(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const c = await signedInClient();
  if (!c) return null;
  const { data, error } = await c.rpc(name, { p_channel: CHANNEL, ...args });
  if (error) throw new Error(friendlyAuthError(error.message));
  return data;
}

// ---------------------------------------------------------------------------
// Showing flights to friends (A4, see scheduleSnapshot.ts). Off until the player
// turns it on for a shared airline, and only ever that airline's own flights.
// ---------------------------------------------------------------------------
const SCHEDULE_EVERY_MS = 5 * 60_000;
/** For each shared airline: when its schedule was last sent, and what was sent. */
const scheduled = new Map<string, { at: number; key: string }>();

/** Sends this career's schedule if it changed. Fails quietly: the next save tries again. */
async function sendSchedule(c: SupabaseClient, airline: string, s: SaveGameState, now: number): Promise<void> {
  const body = JSON.stringify(buildSnapshot(s));
  if (body === scheduled.get(airline)?.key) return;
  scheduled.set(airline, { at: now, key: scheduled.get(airline)?.key ?? '' });
  await workerRequest(c, '/schedule', airline, { method: 'PUT', headers: { 'content-type': 'application/json' }, body });
  scheduled.set(airline, { at: now, key: body });
}

/** Turns showing a shared airline's flights to its friends on or off. Says why if it can't. */
export async function setMapSharing(airline: string, on: boolean, career?: SaveGameState): Promise<void> {
  const c = await signedInClient();
  if (!c) throw new Error('Sign in to change what you share.');
  const r = await cloudRpc('map_share_set', { p_me: airline, p_on: on });
  if (on && r !== 'on') throw new Error(r === 'share_first' ? 'Share this airline first.' : 'That isn’t available right now.');
  if (mine) mine = mine.map((a) => (a.id === airline ? { ...a, mapOn: on } : a));
  scheduled.delete(airline);
  notify();
  if (on) {
    if (career) await sendSchedule(c, airline, career, Date.now()).catch(() => undefined);
  } else {
    // If this doesn't get through, the server has queued it for the nightly clean-up
    await workerRequest(c, '/schedule', airline, { method: 'DELETE' }).catch(() => undefined);
  }
}

async function publishScheduleIfDue(air: MyAirline, s: SaveGameState, now: number): Promise<void> {
  if (!air.mapOn || !featureOn('friends_map') || now - (scheduled.get(air.id)?.at ?? 0) < SCHEDULE_EVERY_MS) return;
  try {
    const c = await signedInClient();
    if (c) await sendSchedule(c, air.id, s, now);
  } catch {
    /* offline: the last good copy stays */
  }
}

/** The friends of this airline that its map can show, and any schedule newer than the versions given. Null if that can't be asked right now. */
export async function fetchFriendSchedules(airline: string, known: Record<string, number>): Promise<unknown> {
  const c = await signedInClient().catch(() => null);
  if (!c || !LOGOS_URL) return null;
  try {
    const res = await workerRequest(c, '/schedules', airline, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ known }) });
    return await res.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------
/** A save's revision: newer is bigger (v2.49+ `rev`, else the time it was written). */
export const saveRev = (s: SaveGameState) => Math.floor(s.rev ?? s.lastRealTs ?? 0);

function readSynced(): Record<string, number> {
  try {
    const v = JSON.parse(store.get(SYNCED_KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
function markSynced(id: string, rev: number) {
  const m = readSynced();
  m[id] = Math.max(m[id] ?? 0, rev);
  store.set(SYNCED_KEY, JSON.stringify(m));
}

export type SyncReport = {
  /** Careers that arrived from another device. */
  received: string[];
  sent: number;
  /** Careers with a newer copy from another device that weren't applied (the one being played). */
  waiting: string[];
  /** Careers changed on two devices since they last synced: the player picks which version to keep (see cloudConflicts). */
  conflicts: string[];
  /** Something the player should know (full, too big, offline…). */
  problem?: string;
};

async function signedInClient(): Promise<SupabaseClient | null> {
  if (!mightBeSignedIn()) return null;
  const c = await client();
  const { data } = await c.auth.getSession();
  return data.session ? c : null;
}

/** Whether careers from other devices download by themselves (on unless turned off). */
export const autoDownload = () => store.get(AUTO_KEY) !== 'off';
export const setAutoDownload = (on: boolean) => store.set(AUTO_KEY, on ? 'on' : 'off');

/** Whether this device's copy of a career has been uploaded (or came from the cloud) since it last changed. */
export const isSynced = (s: SaveGameState) => saveRev(s) <= (readSynced()[s.saveId] ?? 0);

type PushResult = 'saved' | 'same' | 'older' | 'full' | 'server_full' | 'too_big' | 'rate_limited' | 'not_picked' | 'skip';

// ---------------------------------------------------------------------------
// Which careers live in the cloud (v2.52): the player picks up to 4 per
// account; the list is kept on the server so every device agrees. A career
// this device hasn't seen before is picked automatically while there's room.
// ---------------------------------------------------------------------------
export const MAX_CLOUD_CAREERS = 4;
let picks: Set<string> | null = null; // null until the first overview
const listeners = new Set<() => void>();
export const cloudPicks = () => picks;
export function onCloudChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => listeners.forEach((f) => f());
function setPicks(list: string[] | null) {
  picks = list ? new Set(list) : null;
  notify();
}

/** Where a career on this device lives: only here, or here and in the cloud (up to date or not yet). */
export function cloudStatus(s: SaveGameState): 'local' | 'cloud' | 'pending' | 'unknown' {
  if (!mightBeSignedIn() || picks === null) return 'unknown';
  if (!picks.has(s.saveId)) return 'local';
  return isSynced(s) ? 'cloud' : 'pending';
}

/** Puts a career in the cloud (and uploads it now) or takes it out (the copy on devices stays). */
export async function setCloudPick(s: SaveGameState, on: boolean): Promise<void> {
  const c = await signedInClient();
  if (!c) throw new Error('Sign in to use cloud saves.');
  const { data, error } = await c.rpc('cloud_pick', { p_channel: CHANNEL, p_save_id: s.saveId, p_airline: s.airlineName ?? '', p_on: on });
  if (error) throw new Error(friendlyAuthError(error.message));
  if (data === 'full') throw new Error(`${MAX_CLOUD_CAREERS} careers are in the cloud already. Turn one off first.`);
  markSeen(s.saveId);
  const next = new Set(picks ?? []);
  if (on) next.add(s.saveId);
  else next.delete(s.saveId);
  setPicks([...next]);
  if (on) {
    const r = await pushOne(c, s, true);
    if (r === 'too_big') throw new Error('This career is too big to sync, so it stays on this device.');
    if (r === 'rate_limited') throw new Error('You’ve synced a lot this hour. It will upload later.');
  } else {
    const m = readSynced();
    m[s.saveId] = 0;
    store.set(SYNCED_KEY, JSON.stringify(m));
  }
  notify();
}

function markSeen(id: string) {
  const m = readSynced();
  if (!(id in m)) {
    m[id] = 0;
    store.set(SYNCED_KEY, JSON.stringify(m));
  }
}

/** Uploads one career if it changed since it was last synced (or always, with `force`). */
async function pushOne(c: SupabaseClient, s: SaveGameState, force = false): Promise<PushResult> {
  const rev = saveRev(s);
  if (!(rev > 0) || (!force && rev <= (readSynced()[s.saveId] ?? 0))) return 'skip';
  const data = protectSave(serializeSave(s));
  if (data.length > MAX_UPLOAD_CHARS) return 'too_big';
  const { data: res, error } = await c.rpc('cloud_push', {
    p_device: deviceId(),
    p_device_name: deviceName(),
    p_channel: CHANNEL,
    p_save_id: s.saveId,
    p_rev: rev,
    p_airline: s.airlineName ?? '',
    p_data: data,
  });
  if (error) throw error;
  if (res === 'saved' || res === 'same') markSynced(s.saveId, rev);
  notify();
  return res as PushResult;
}

type CloudRow = { save_id: string; rev: number; airline: string; data: string; from_name?: string };
type StoreResult =
  | { kind: 'stored' | 'had' | 'playing' | 'dropped' | 'conflict'; name: string }
  | { kind: 'full' | 'failed'; name: string; message: string };

/**
 * This device's unsent changes count as real play past this much time since the
 * last sync. Sync runs every few minutes, so a shorter gap is just the moments
 * before the game was closed: the newer copy simply replaces it.
 */
const REAL_PLAY_UNSYNCED_MS = 10 * 60_000;

/**
 * A career changed on this device and on another since they last synced (v3.0.2).
 * Until v3.0.1 the other version became a second career, "(other copy)"; now the
 * player picks one version and the other is dropped, so careers never double up.
 * Nothing changes on either side until they pick, and the career doesn't upload.
 */
export type CloudConflict = { saveId: string; name: string; here: SaveGameState; cloud: SaveGameState; cloudRev: number; fromName: string };
const conflicts = new Map<string, CloudConflict>();
export const cloudConflicts = (): CloudConflict[] => [...conflicts.values()];

/**
 * Stores a career that came from the cloud: checks it, never replaces the
 * career being played, writes it, reads it back, and only then tells the
 * server it arrived. The newest version keeps the career's place. If both
 * devices really changed it since they last synced, nothing is replaced: the
 * player is asked which version to keep (cloudConflicts, resolveConflict).
 */
export async function storeIncoming(c: SupabaseClient, row: CloudRow, openSaveId: string | null): Promise<StoreResult> {
  const dev = deviceId();
  const rev = Number(row.rev);
  const opened = openProtectedSave<SaveGameState>(row.data);
  const ack = async () => {
    await c.rpc('cloud_ack', { p_device: dev, p_channel: CHANNEL, p_save_id: row.save_id, p_rev: rev });
  };
  if (!opened.ok || !isValidSave(opened.value) || opened.value.saveId !== row.save_id) {
    await ack(); // damaged or not a career: drop it
    return { kind: 'dropped', name: row.airline };
  }
  const name = row.airline || opened.value.airlineName;
  const slots = readSaveSlots();
  const local = slots.find((s) => s.saveId === row.save_id);
  const incoming: SaveGameState = { ...opened.value, rev };
  const base = readSynced()[row.save_id] ?? 0;
  const localRev = local ? saveRev(local) : 0;
  const changedSinceSync = rev > base; // another device changed it
  conflicts.delete(row.save_id);
  const ask = (here: SaveGameState): StoreResult => {
    if (row.save_id === openSaveId) return { kind: 'playing', name }; // asked on the home screen
    conflicts.set(row.save_id, { saveId: row.save_id, name, here, cloud: incoming, cloudRev: rev, fromName: row.from_name ?? '' });
    return { kind: 'conflict', name };
  };

  if (local && localRev >= rev) {
    if (changedSinceSync && localRev > rev) return ask(local);
    // This device's version keeps its place; if it's newer, it still has to upload
    markSynced(row.save_id, rev);
    await ack();
    return { kind: 'had', name };
  }
  if (row.save_id === openSaveId) return { kind: 'playing', name };
  if (local && base > 0 && changedSinceSync && localRev - base > REAL_PLAY_UNSYNCED_MS) return ask(local);
  if (!hasRoomForCareer(slots, row.save_id)) {
    return { kind: 'full', name, message: `This device has ${MAX_SAVE_SLOTS} careers, so ${name} couldn’t be downloaded. Delete one and try again; it stays in the cloud until then.` };
  }
  const next = local ? slots.map((s) => (s.saveId === row.save_id ? incoming : s)) : [incoming, ...slots];
  if (!writeSaveSlots(next)) return { kind: 'full', name, message: STORAGE_FULL };
  const check = readSaveSlots().find((s) => s.saveId === row.save_id);
  if (!check || saveRev(check) !== rev) {
    return { kind: 'failed', name, message: `${name} didn’t store correctly. It stays in the cloud; try again.` };
  }
  markSynced(row.save_id, rev);
  await ack();
  return { kind: 'stored', name };
}

const STORAGE_FULL = 'This device’s storage is full, so a career from the cloud couldn’t be stored. Delete or export a career and try again.';

/**
 * Settles a conflict with the version the player picked. The other one is
 * dropped. Keeping this device's version makes it newer than the cloud's, so
 * it uploads and replaces it everywhere.
 */
export async function resolveConflict(saveId: string, keep: 'here' | 'cloud', signedIn?: SupabaseClient): Promise<void> {
  const k = conflicts.get(saveId);
  if (!k) return;
  const c = signedIn ?? (await signedInClient());
  if (!c) throw new Error('Sign in to use cloud saves.');
  const slots = readSaveSlots();
  const here = slots.find((s) => s.saveId === saveId) ?? k.here;
  const chosen = keep === 'here' ? { ...here, rev: Math.max(saveRev(here), k.cloudRev + 1) } : k.cloud;
  const next = slots.some((s) => s.saveId === saveId) ? slots.map((s) => (s.saveId === saveId ? chosen : s)) : [chosen, ...slots];
  if (!writeSaveSlots(next)) throw new Error(STORAGE_FULL);
  const check = readSaveSlots().find((s) => s.saveId === saveId);
  if (!check || saveRev(check) !== saveRev(chosen)) throw new Error(`${k.name} didn’t store correctly. Try again.`);
  conflicts.delete(saveId);
  markSynced(saveId, k.cloudRev); // the cloud's copy is settled; this device's newer one still uploads
  await c.rpc('cloud_ack', { p_device: deviceId(), p_channel: CHANNEL, p_save_id: saveId, p_rev: k.cloudRev });
  notify();
}

/**
 * The player chose to open this device's copy although the cloud has a newer
 * one: that newer copy is set aside, so this one uploads instead of being
 * asked about later.
 */
export async function preferThisCopy(s: SaveGameState, cloudRev: number): Promise<SaveGameState> {
  // Above the cloud's revision even if the other device's clock is ahead, so it isn't refused as older
  const mine = { ...s, rev: Math.max(saveRev(s), cloudRev + 1) };
  const slots = readSaveSlots();
  if (!slots.some((x) => x.saveId === s.saveId) || !writeSaveSlots(slots.map((x) => (x.saveId === s.saveId ? mine : x)))) return s;
  markSynced(s.saveId, cloudRev);
  conflicts.delete(s.saveId);
  try {
    const c = await signedInClient();
    await c?.rpc('cloud_ack', { p_device: deviceId(), p_channel: CHANNEL, p_save_id: s.saveId, p_rev: cloudRev });
  } catch {
    /* offline: the next sync finds this device's copy newer and keeps it */
  }
  return mine;
}

/**
 * A newer copy of this career from another device that hasn't reached this
 * one, if the cloud can say quickly. Asked before a career opens, because
 * playing an older copy would otherwise replace that progress. Null when
 * signed out, offline or slow: opening a career never waits long on the cloud.
 */
export async function newerCloudCopy(s: SaveGameState, waitMs = 2500): Promise<{ fromName: string; rev: number } | null> {
  if (!mightBeSignedIn()) return null;
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs));
    const o = await Promise.race([cloudOverview(), timeout]);
    const copy = o?.saves.find((x) => x.saveId === s.saveId);
    return copy && copy.waitingHere && Number(copy.rev) > saveRev(s) ? { fromName: copy.fromName, rev: Number(copy.rev) } : null;
  } catch {
    return null;
  }
}

/** Downloads one career the player picked from the cloud (v2.52). Returns its name. */
export async function downloadCareer(saveId: string, openSaveId: string | null = null): Promise<string> {
  const c = await signedInClient();
  if (!c) throw new Error('Sign in to download careers.');
  const { data, error } = await c.rpc('cloud_fetch', { p_device: deviceId(), p_device_name: deviceName(), p_channel: CHANNEL, p_save_id: saveId });
  if (error) throw new Error(friendlyAuthError(error.message));
  const row = ((data ?? []) as CloudRow[])[0];
  if (!row) throw new Error('That career isn’t in the cloud any more.');
  const r = await storeIncoming(c, row, openSaveId);
  if (r.kind === 'conflict') {
    await resolveConflict(saveId, 'cloud'); // asked for the cloud's copy
    return r.name;
  }
  if (r.kind === 'playing') throw new Error(`You’re playing ${r.name} right now. Leave to the home screen to load the newer copy.`);
  if (r.kind === 'full' || r.kind === 'failed') throw new Error(r.message);
  if (r.kind === 'dropped') throw new Error('That copy is damaged, so it was removed.');
  return r.name;
}

/** Uploads one career now, even if it was uploaded before (v2.52). */
export async function uploadCareer(saveId: string): Promise<void> {
  const c = await signedInClient();
  if (!c) throw new Error('Sign in to upload careers.');
  const s = readSaveSlots().find((x) => x.saveId === saveId);
  if (!s) throw new Error('That career isn’t on this device.');
  const r = await pushOne(c, s, true);
  if (r === 'saved' || r === 'same' || r === 'skip') return;
  throw new Error(
    r === 'older'
      ? 'The cloud has a newer copy of this career from another device. Download it instead.'
      : r === 'full' || r === 'not_picked'
        ? `Turn on “Keep in the cloud” for this career first (up to ${MAX_CLOUD_CAREERS}).`
        : r === 'too_big'
          ? 'This career is too big to sync, so it stays on this device.'
          : r === 'rate_limited'
            ? 'You’ve synced a lot this hour. Try again later.'
            : 'The cloud is full right now. Try again later.',
  );
}

let running: Promise<SyncReport> | null = null;

/**
 * Downloads careers from other devices, then uploads this device's changed
 * careers. `openSaveId` is the career being played here: it is uploaded but
 * never replaced. Safe to call often; calls made while one runs share it.
 */
export function syncNow(openSaveId: string | null = null): Promise<SyncReport> {
  running ??= doSync(openSaveId).finally(() => {
    running = null;
  });
  return running;
}

async function doSync(openSaveId: string | null): Promise<SyncReport> {
  const report: SyncReport = { received: [], sent: 0, waiting: [], conflicts: [] };
  const c = await signedInClient();
  if (!c) return report;
  const dev = deviceId();
  try {
    // 1. Download (unless the player downloads careers themselves). If this
    //    fails, uploads below still run: only a career with a copy still on
    //    its way here is held back.
    if (autoDownload()) {
      try {
        const { data: rows, error } = await c.rpc('cloud_pull', { p_device: dev, p_device_name: deviceName(), p_channel: CHANNEL });
        if (error) throw error;
        for (const row of (rows ?? []) as CloudRow[]) {
          const r = await storeIncoming(c, row, openSaveId);
          if (r.kind === 'stored') report.received.push(r.name);
          else if (r.kind === 'playing') report.waiting.push(r.name);
          else if (r.kind === 'full') {
            report.problem = r.message;
            break;
          } else if (r.kind === 'failed') report.problem = r.message;
          else if (r.kind === 'conflict') report.conflicts.push(r.name);
        }
      } catch (e) {
        report.problem = friendlyAuthError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
      }
    }

    // 2. Which careers are in the cloud; pick new ones while there's room
    const ov = await cloudOverview();
    // A copy from another device that hasn't landed here must not be overwritten by an upload
    const undelivered = new Set((ov?.saves ?? []).filter((x) => x.waitingHere).map((x) => x.saveId));
    const picked = new Set(picks ?? []);
    const seen = readSynced();
    for (const s of readSaveSlots()) {
      if (s.saveId in seen) continue;
      markSeen(s.saveId);
      if (picked.size >= (ov?.maxPicks ?? MAX_CLOUD_CAREERS)) continue;
      const { data } = await c.rpc('cloud_pick', { p_channel: CHANNEL, p_save_id: s.saveId, p_airline: s.airlineName ?? '', p_on: true });
      if (data === 'ok') picked.add(s.saveId);
    }
    setPicks([...picked]);

    // 3. Upload what changed here (careers in the cloud only)
    for (const s of readSaveSlots()) {
      if (!picked.has(s.saveId)) continue;
      if (undelivered.has(s.saveId)) {
        if (!report.waiting.includes(s.airlineName)) report.waiting.push(s.airlineName);
        continue;
      }
      const r = await pushOne(c, s);
      if (r === 'saved') report.sent++;
      else if (r === 'full') report.problem = `The cloud keeps ${MAX_CLOUD_CAREERS} careers per account. Turn one off in Cloud saves to sync another.`;
      else if (r === 'server_full') report.problem = 'The cloud is full right now. Your careers are safe on this device; try again later.';
      else if (r === 'too_big') report.problem = `${s.airlineName} is too big to sync, so it stays on this device.`;
      else if (r === 'older' && s.saveId !== openSaveId) report.waiting.push(s.airlineName);
      else if (r === 'rate_limited') {
        report.problem = 'You’ve synced a lot this hour, so uploads are paused for a while. Your careers are safe on this device.';
        break;
      }
    }
  } catch (e) {
    report.problem = friendlyAuthError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
  }
  store.set('bp_cloud_last_sync_v1', String(Date.now()));
  return report;
}

/** When this device last finished a sync (ms), or 0. */
export const lastSyncMs = () => Number(store.get('bp_cloud_last_sync_v1')) || 0;

/** Removes a career from the cloud when it's deleted on this device. */
export async function cloudDeleteSave(saveId: string): Promise<void> {
  const c = await signedInClient().catch(() => null);
  if (!c) return;
  await c.rpc('cloud_delete_save', { p_channel: CHANNEL, p_save_id: saveId });
  const m = readSynced();
  delete m[saveId];
  store.set(SYNCED_KEY, JSON.stringify(m));
}

export type CloudOverview = {
  saves: { saveId: string; airline: string; rev: number; updatedAt: string; fromThisDevice: boolean; fromName: string; bytes: number; waitingHere: boolean }[];
  picks: { saveId: string; airline: string }[];
  maxPicks: number;
  devices: { name: string; lastSeen: string; thisDevice: boolean }[];
};
export async function cloudOverview(): Promise<CloudOverview | null> {
  const c = await signedInClient();
  if (!c) return null;
  const { data, error } = await c.rpc('cloud_overview', { p_device: deviceId(), p_channel: CHANNEL });
  if (error) throw new Error(friendlyAuthError(error.message));
  const o = data as CloudOverview;
  setPicks((o.picks ?? []).map((p) => p.saveId));
  return o;
}

/** The next revision for a career being saved: always above the last one, even if this device's clock is behind. */
export const nextRev = (prev: SaveGameState | undefined) => Math.max(Date.now(), prev ? saveRev(prev) + 1 : 0);
