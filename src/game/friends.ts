// ============================================================================
// FRIENDS (Update A, phase A3; per airline since 2026-11-07)
//   Friends are airlines, found by each airline's private code, and the server
//   (cloud/supabase/2026-11-07-airlines.sql) decides everything: this is only what
//   the Friends screen needs. Every call is made as one of the player's shared
//   airlines (`me`). Career and Sandbox airlines can't be friends.
//   Everything here came from other players, so it's all checked before it's used.
// ============================================================================
import { cloudRpc } from './cloud';

/** Enough of an alliance for a badge next to an airline's name. */
export interface AllianceBadge {
  id: string;
  name: string;
  tag: string;
  colours: { a: string; b: string };
  /** The hash of its logo, which may not be approved yet. */
  logo: string | null;
  members: number;
}

export interface FriendCard {
  airline: string;
  code: string;
  callsign: string;
  colours: { a: string; b: string };
  fleet: number | null;
  /** Their airline's summary (the same one as in their profile), when it came through. */
  stats: { routes: number; airports: number; hubs: number; weeks: number; founded: string | null } | null;
  /** The hash of the airline's badge, which may not be approved yet. */
  badge: string | null;
  /** The alliance it's in, if any. */
  alliance: AllianceBadge | null;
}
export interface Friend {
  id: string;
  onMap: boolean;
  /** Null while they aren't sharing an airline. */
  card: FriendCard | null;
}
export interface FriendsData {
  id: string;
  code: string;
  mode: 'career' | 'sandbox';
  friends: Friend[];
  /** Requests made to this airline. */
  incoming: { id: string; card: FriendCard | null }[];
  /** Requests this airline made: just the code typed, until it's accepted. */
  outgoing: { id: string; code: string }[];
  /** The player's blocks, whichever airline they were made from. */
  blocked: { id: string; label: string }[];
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const HASH = /^[0-9a-f]{64}$/;
const FRIEND_CODE = /^[2-9BCDFGHJKLMNPQRSTVWXZ]{8}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const short = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');
const list = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter((v) => v && typeof v === 'object') : []);
const withId = <T extends { id: string }>(xs: T[]) => xs.filter((x) => ID.test(x.id));

const colourPair = (x: unknown) => {
  const col = (x ?? {}) as Record<string, unknown>;
  return { a: HEX.test(String(col.a)) ? String(col.a) : '#475569', b: HEX.test(String(col.b)) ? String(col.b) : '#94a3b8' };
};

/** An alliance badge from another player's data, or null if it isn't one. */
export function normaliseAllianceBadge(x: unknown): AllianceBadge | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const tag = String(o.tag ?? '');
  const name = short(o.name, 40);
  if (typeof o.id !== 'string' || !ID.test(o.id) || !/^[A-Z0-9]{2,4}$/.test(tag) || !name) return null;
  const members = Number(o.members);
  return { id: o.id, name, tag, colours: colourPair(o.colours), logo: HASH.test(String(o.logo)) ? String(o.logo) : null, members: Number.isFinite(members) ? Math.max(0, Math.min(20, Math.floor(members))) : 0 };
}

/** Another player's airline card, safe to show. Null if it isn't one. */
export function normaliseCard(x: unknown): FriendCard | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const airline = short(o.airline, 40);
  if (!airline) return null;
  const col = (o.colours ?? {}) as Record<string, unknown>;
  const st = (o.stats && typeof o.stats === 'object' ? o.stats : {}) as Record<string, unknown>;
  const fleet = st.fleet;
  const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1e6, Math.floor(v))) : null);
  const routes = count(st.routes), airports = count(st.airports), hubs = count(st.hubs), weeks = count(st.weeks);
  return {
    airline,
    code: short(o.code, 3),
    callsign: short(o.callsign, 30),
    colours: { a: HEX.test(String(col.a)) ? String(col.a) : '#475569', b: HEX.test(String(col.b)) ? String(col.b) : '#94a3b8' },
    fleet: typeof fleet === 'number' && Number.isFinite(fleet) ? Math.max(0, Math.floor(fleet)) : null,
    stats:
      routes !== null && airports !== null && hubs !== null && weeks !== null
        ? { routes, airports, hubs, weeks, founded: /^\d{4}-\d{2}-\d{2}$/.test(String(st.founded)) ? String(st.founded) : null }
        : null,
    badge: HASH.test(String(o.badge)) ? String(o.badge) : null,
    alliance: normaliseAllianceBadge(o.alliance),
  };
}

/** What the server sent, safe to show. Null if it isn't a Friends list at all. */
export function normaliseFriends(x: unknown): FriendsData | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || !ID.test(o.id) || typeof o.code !== 'string' || !FRIEND_CODE.test(o.code)) return null;
  return {
    id: o.id,
    code: o.code,
    mode: o.mode === 'sandbox' ? 'sandbox' : 'career',
    friends: withId(list(o.friends).map((f) => ({ id: String(f.id), onMap: f.onMap !== false, card: normaliseCard(f.card) }))),
    incoming: withId(list(o.incoming).map((f) => ({ id: String(f.id), card: normaliseCard(f.card) }))),
    outgoing: withId(list(o.outgoing).map((f) => ({ id: String(f.id), code: short(f.code, 8) }))),
    blocked: withId(list(o.blocked).map((f) => ({ id: String(f.id), label: short(f.label, 40) || 'An airline' }))),
  };
}

/** ABCD EFGH, easier to read out. */
export const formatFriendCode = (c: string) => (c.length === 8 ? `${c.slice(0, 4)} ${c.slice(4)}` : c);

/** Letters and digits only, in capitals. */
export const cleanFriendCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

const ANSWERS: Record<string, string> = {
  sent: 'Request sent.',
  accepted: 'They’d already asked you, so you’re friends now.',
  not_found: 'No airline has that code.',
  self: 'That’s one of your own airlines.',
  other_mode: 'That airline plays a different mode. Career airlines can only be friends with Career airlines, and Sandbox with Sandbox.',
  already: 'You’re already friends.',
  already_sent: 'You’ve already asked them.',
  too_soon: 'They didn’t accept last time. You can ask again in a week.',
  you_blocked: 'You’ve blocked that player. Unblock them first.',
  limit: 'This airline has reached the limit: 100 friends and 50 requests waiting.',
  their_limit: 'They can’t take any more friends right now.',
  too_many_today: 'That’s enough tries for today. Try again tomorrow.',
  share_first: 'Share this airline first, so they can see who’s asking.',
  off: 'Friends aren’t available right now.',
};
/** What to tell the player after a request. */
export const friendAnswer = (r: unknown) => ANSWERS[String(r)] ?? 'That didn’t work. Try again later.';

export async function loadFriends(me: string): Promise<FriendsData | null> {
  return normaliseFriends(await cloudRpc('friends_list', { p_me: me }));
}
export const sendFriendRequest = async (me: string, code: string) => friendAnswer(await cloudRpc('friend_request', { p_me: me, p_code: cleanFriendCode(code) }));
export async function respondToFriend(me: string, id: string, accept: boolean): Promise<string> {
  const r = await cloudRpc('friend_respond', { p_me: me, p_id: id, p_accept: accept });
  if (r === 'limit') return 'This airline has reached the limit of 100 friends.';
  if (r === 'their_limit') return 'They can’t take any more friends right now.';
  if (r === 'off') return 'Friends aren’t available right now.';
  return '';
}
export const removeFriend = (me: string, id: string) => cloudRpc('friend_remove', { p_me: me, p_id: id });
/** Blocks the player behind that airline: none of their airlines can reach any of yours. */
export const blockFriend = (me: string, id: string) => cloudRpc('friend_block', { p_me: me, p_id: id });
export const unblockFriend = (block: string) => cloudRpc('friend_unblock', { p_block: block });
export const setFriendOnMap = (me: string, id: string, on: boolean) => cloudRpc('friend_map_set', { p_me: me, p_id: id, p_on: on });
/** A new code for this airline; the old one stops working. Null when that's enough for today. */
export const newFriendCode = async (me: string) => {
  const r = await cloudRpc('friend_code_new', { p_me: me });
  return typeof r === 'string' && FRIEND_CODE.test(r) ? r : null;
};
