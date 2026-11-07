// ============================================================================
// FRIENDS (Update A, phase A3)
//   Friends are found by a private code, and the server (cloud/supabase/2026-11-06-
//   friends.sql) decides everything: this is only what the Friends screen needs.
//   Everything here came from other players, so it's all checked before it's used.
// ============================================================================
import { cloudRpc } from './cloud';

export interface FriendCard {
  airline: string;
  code: string;
  callsign: string;
  colours: { a: string; b: string };
  fleet: number | null;
  /** The hash of the airline's badge, which may not be approved yet. */
  badge: string | null;
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
  friends: Friend[];
  /** Requests made to this player. */
  incoming: { id: string; card: FriendCard | null }[];
  /** Requests this player made: just the code they typed, until it's accepted. */
  outgoing: { id: string; code: string }[];
  blocked: { id: string; label: string }[];
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const HASH = /^[0-9a-f]{64}$/;
const FRIEND_CODE = /^[2-9BCDFGHJKLMNPQRSTVWXZ]{8}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const short = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');
const list = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter((v) => v && typeof v === 'object') : []);
const withId = <T extends { id: string }>(xs: T[]) => xs.filter((x) => ID.test(x.id));

function normaliseCard(x: unknown): FriendCard | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const airline = short(o.airline, 40);
  if (!airline) return null;
  const col = (o.colours ?? {}) as Record<string, unknown>;
  const fleet = (o.stats as Record<string, unknown> | undefined)?.fleet;
  return {
    airline,
    code: short(o.code, 3),
    callsign: short(o.callsign, 30),
    colours: { a: HEX.test(String(col.a)) ? String(col.a) : '#475569', b: HEX.test(String(col.b)) ? String(col.b) : '#94a3b8' },
    fleet: typeof fleet === 'number' && Number.isFinite(fleet) ? Math.max(0, Math.floor(fleet)) : null,
    badge: HASH.test(String(o.badge)) ? String(o.badge) : null,
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
  self: 'That’s your own code.',
  already: 'You’re already friends.',
  already_sent: 'You’ve already asked them.',
  too_soon: 'They didn’t accept last time. You can ask again in a week.',
  you_blocked: 'You’ve blocked that airline. Unblock it first.',
  limit: 'You’ve reached the limit: 100 friends and 50 requests waiting.',
  their_limit: 'They can’t take any more friends right now.',
  too_many_today: 'That’s enough tries for today. Try again tomorrow.',
  share_first: 'Share your airline first, so they can see who’s asking.',
  off: 'Friends aren’t available right now.',
};
/** What to tell the player after a request. */
export const friendAnswer = (r: unknown) => ANSWERS[String(r)] ?? 'That didn’t work. Try again later.';

export async function loadFriends(): Promise<FriendsData | null> {
  return normaliseFriends(await cloudRpc('friends_list'));
}
export const sendFriendRequest = async (code: string) => friendAnswer(await cloudRpc('friend_request', { p_code: cleanFriendCode(code) }));
export async function respondToFriend(id: string, accept: boolean): Promise<string> {
  const r = await cloudRpc('friend_respond', { p_id: id, p_accept: accept });
  if (r === 'limit') return 'You’ve reached the limit of 100 friends.';
  if (r === 'their_limit') return 'They can’t take any more friends right now.';
  if (r === 'off') return 'Friends aren’t available right now.';
  return '';
}
export const removeFriend = (id: string) => cloudRpc('friend_remove', { p_id: id });
export const blockFriend = (id: string) => cloudRpc('friend_block', { p_id: id });
export const unblockFriend = (id: string) => cloudRpc('friend_unblock', { p_id: id });
export const setFriendOnMap = (id: string, on: boolean) => cloudRpc('friend_map_set', { p_id: id, p_on: on });
/** A new code; the old one stops working. Null when that's enough for today. */
export const newFriendCode = async () => {
  const r = await cloudRpc('friend_code_new');
  return typeof r === 'string' && FRIEND_CODE.test(r) ? r : null;
};
