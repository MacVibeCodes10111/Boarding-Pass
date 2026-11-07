// ============================================================================
// THE ADMIN SITE'S LINK TO THE SERVER (Update A, phase A6)
//   The same public key as the game. Every power comes from the admin_* database
//   functions, which check private.admins and two-factor on each call; the logos
//   Worker asks Supabase the same before it does anything. The session is kept for
//   this tab only (sessionStorage), apart from the game's own.
// ============================================================================
import { createClient } from '@supabase/supabase-js';
import { normaliseLogo } from '../../src/game/livery';

const env = import.meta.env;
const SUPABASE_URL = (env.DEV && env.VITE_BP_SUPABASE_URL) || 'https://dlgkdknfxhmtkhpegufq.supabase.co';
const SUPABASE_KEY = (env.DEV && env.VITE_BP_SUPABASE_KEY) || 'sb_publishable_AP8t-FaDMPZ0dHYFezBqPQ_MDoYkfXv';
const WORKER_URL = (env.DEV && env.VITE_BP_LOGOS_URL) || 'https://bp-logos.boardingpass-game.workers.dev';
const USERNAME_DOMAIN = 'players.boardingpass.my';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storageKey: 'bp_admin_session', storage: window.sessionStorage, flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export type Channel = 'main' | 'dev';
export type Role = 'owner' | 'moderator';
export interface Me {
  id: string;
  role: Role;
  name: string;
}

const MESSAGES: Record<string, string> = {
  not_admin: 'This account isn’t an admin.',
  needs_2fa: 'Two-factor sign-in is needed.',
  owner_only: 'Only the owner can do that.',
  reason_needed: 'Give a short reason (3 to 300 characters).',
  too_many_changes: 'That’s 60 changes this hour. Wait a while before making more.',
};
const friendly = (m: string) => {
  for (const [k, v] of Object.entries(MESSAGES)) if (m.includes(k)) return v;
  if (/fetch|network/i.test(m)) return 'Can’t reach the server. Check your connection.';
  return m || 'Something went wrong.';
};

// ---------------------------------------------------------------------------
// Signing in: lock 2 (a Boarding Pass account with two-factor)
// ---------------------------------------------------------------------------
export async function signInUsername(username: string, password: string) {
  const u = username.trim().toLowerCase();
  const { error } = await sb.auth.signInWithPassword({ email: `${u}@${USERNAME_DOMAIN}`, password });
  if (error) throw new Error(/invalid login/i.test(error.message) ? 'That username and password don’t match.' : friendly(error.message));
}
export async function signInWith(provider: 'google' | 'discord') {
  const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: `${location.origin}/` } });
  if (error) throw new Error(friendly(error.message));
}
export const signOut = () => sb.auth.signOut({ scope: 'local' });

/** 'none' (signed out), 'aal1' (password only), 'aal2' (two-factor done), and whether a factor exists. */
export async function signInState(): Promise<{ level: 'none' | 'aal1' | 'aal2'; hasFactor: boolean }> {
  const { data: s } = await sb.auth.getSession();
  if (!s.session) return { level: 'none', hasFactor: false };
  const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  return { level: data?.currentLevel === 'aal2' ? 'aal2' : 'aal1', hasFactor: data?.nextLevel === 'aal2' };
}
const totpFactors = async () => {
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error) throw new Error(friendly(error.message));
  return data.all.filter((f) => f.factor_type === 'totp');
};
/** Starts adding an authenticator app. Any half-finished one is dropped first. */
export async function startEnrol(): Promise<{ id: string; qr: string; secret: string }> {
  for (const f of await totpFactors()) if (f.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Boarding Pass admin ${new Date().toISOString().slice(0, 10)}` });
  if (error) throw new Error(friendly(error.message));
  return { id: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}
/** Checks a code from the authenticator app; the session is two-factor after this. */
export async function verifyCode(code: string, factorId?: string) {
  const id = factorId ?? (await totpFactors()).find((f) => f.status === 'verified')?.id;
  if (!id) throw new Error('There’s no authenticator app on this account yet.');
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: id, code: code.replace(/\s/g, '') });
  if (error) throw new Error(/invalid/i.test(error.message) ? 'That code isn’t right. Try the newest one.' : friendly(error.message));
}

// ---------------------------------------------------------------------------
// The admin functions: lock 3 (private.admins), checked on every call
// ---------------------------------------------------------------------------
export async function rpc<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(friendly(error.message));
  return data as T;
}
export const whoami = () => rpc<Me>('admin_whoami');

/** Runs a change and turns a word answer that isn't ok into an error. */
export async function act(name: string, args: Record<string, unknown>) {
  const r = await rpc<string>(name, args);
  if (r !== 'ok') throw new Error(ANSWERS[r] ?? `The server said: ${r}`);
}
const ANSWERS: Record<string, string> = {
  not_found: 'That isn’t there any more.',
  bad: 'Something in that wasn’t right.',
  admin: 'Admins can’t be suspended. Remove them from the team first.',
  last_owner: 'There has to be at least one owner.',
};

// ---------------------------------------------------------------------------
// The logos Worker, with the admin's own token
// ---------------------------------------------------------------------------
async function worker(path: string, init: RequestInit = {}) {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in again.');
  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  } catch {
    throw new Error('Can’t reach the logos server.');
  }
  if (res.status === 403) throw new Error('The logos server says this account isn’t allowed.');
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `The logos server said ${res.status}.`);
  return res;
}
export interface LogoRow {
  hash: string;
  bytes: number;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  reviewedAt: number | null;
  players: number;
  owners: { channel: Channel; airline: string; seen: number }[];
}
export const listLogos = async (status: string, before?: number) => (await (await worker(`/admin/logos?status=${status}${before ? `&before=${before}` : ''}`)).json()) as { logos: LogoRow[]; more: boolean };
export const actOnLogo = async (hash: string, action: 'approve' | 'remove', reason: string) => (await worker(`/admin/logo/${hash}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, reason }) })).json();
export const storageUsage = async () => (await (await worker('/admin/usage')).json()) as { bytes: number; objects: number; cap: number; logos: Record<string, { count: number; bytes: number }>; schedules: { n: number; bytes: number } };

const pictures = new Map<string, Promise<string | null>>();
/** A logo for review, even one still waiting: a data URL, fetched once. */
export function logoPicture(hash: string | null | undefined): Promise<string | null> {
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return Promise.resolve(null);
  let p = pictures.get(hash);
  if (!p) {
    p = worker(`/admin/logo/${hash}`)
      .then((r) => r.blob())
      .then((b) => new Promise<string | null>((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(normaliseLogo(fr.result) ?? null);
        fr.onerror = () => resolve(null);
        fr.readAsDataURL(b);
      }))
      .catch(() => null);
    pictures.set(hash, p);
  }
  return p;
}
export const forgetPicture = (hash: string) => pictures.delete(hash);
