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
//   - Dev builds and the test site use their own channel and never exchange
//     careers with the real game.
// The server side (tables, functions, daily clean-up) is in the Supabase
// project "boarding-pass"; players can only call the cloud_* functions, and
// each only touches that player's own rows.
// ============================================================================
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { IS_DEV } from './channel';
import { IS_MAC } from './platform';
import { openProtectedSave, protectSave } from './saveCrypt';
import { readSaveSlots, serializeSave, writeSaveSlots, isValidSave } from './saves';
import type { SaveGameState } from './types';

const SUPABASE_URL = 'https://dlgkdknfxhmtkhpegufq.supabase.co';
/** The project's publishable key: public by design (it only allows what the database lets players do). */
const SUPABASE_KEY = 'sb_publishable_AP8t-FaDMPZ0dHYFezBqPQ_MDoYkfXv';

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
  if (now.getMonth() + 1 < month) age -= 1;
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
    }),
  );
  return clientP;
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
  setPicks(null);
}

/** Deletes the account and every cloud copy. Careers on devices stay. */
export async function deleteAccount(): Promise<void> {
  const c = await client();
  const { error } = await c.rpc('delete_my_account');
  if (error) throw new Error(friendlyAuthError(error.message));
  await c.auth.signOut({ scope: 'local' });
  store.remove(SYNCED_KEY);
  setPicks(null);
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
    if (r === 'too_big') throw new Error('This career is too big to sync. Use Export save file to move it.');
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

type CloudRow = { save_id: string; rev: number; airline: string; data: string };
type StoreResult =
  | { kind: 'stored' | 'had' | 'playing' | 'dropped'; name: string }
  | { kind: 'full' | 'failed'; name: string; message: string };

/**
 * Stores a career that came from the cloud: checks it, keeps this device's
 * copy if it's as new or newer, never replaces the career being played,
 * writes it, reads it back, and only then tells the server it arrived.
 */
async function storeIncoming(c: SupabaseClient, row: CloudRow, openSaveId: string | null): Promise<StoreResult> {
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
  if (local && saveRev(local) >= rev) {
    markSynced(row.save_id, saveRev(local));
    await ack();
    return { kind: 'had', name };
  }
  if (row.save_id === openSaveId) return { kind: 'playing', name };
  const incoming: SaveGameState = { ...opened.value, rev };
  const next = local ? slots.map((s) => (s.saveId === row.save_id ? incoming : s)) : [incoming, ...slots];
  if (!writeSaveSlots(next)) {
    return { kind: 'full', name, message: 'This device’s storage is full, so a career from the cloud couldn’t be stored. Delete or export a career and try again.' };
  }
  const check = readSaveSlots().find((s) => s.saveId === row.save_id);
  if (!check || saveRev(check) !== rev) {
    return { kind: 'failed', name, message: `${name} didn’t store correctly. It stays in the cloud; try again.` };
  }
  markSynced(row.save_id, rev);
  await ack();
  return { kind: 'stored', name };
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
          ? 'This career is too big to sync. Use Export save file to move it.'
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
  const report: SyncReport = { received: [], sent: 0, waiting: [] };
  const c = await signedInClient();
  if (!c) return report;
  const dev = deviceId();
  try {
    // 1. Download (unless the player downloads careers themselves)
    if (autoDownload()) {
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
      }
    }

    // 2. Which careers are in the cloud; pick new ones while there's room
    const ov = await cloudOverview();
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
      const r = await pushOne(c, s);
      if (r === 'saved') report.sent++;
      else if (r === 'full') report.problem = `The cloud keeps ${MAX_CLOUD_CAREERS} careers per account. Turn one off in Cloud saves to sync another.`;
      else if (r === 'server_full') report.problem = 'The cloud is full right now. Your careers are safe on this device; try again later.';
      else if (r === 'too_big') report.problem = `${s.airlineName} is too big to sync. Use Export save file to move it.`;
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
