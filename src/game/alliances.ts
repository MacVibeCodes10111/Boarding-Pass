// ============================================================================
// ALLIANCES (Update A, phase A5)
//   Alliances are made of shared airlines, one alliance each, up to 20, all Career
//   or all Sandbox. The server (cloud/supabase/2026-11-07-alliances.sql) decides
//   everything; this is what the Alliances screen needs. Every call is made as one
//   of the player's airlines (`me`). There are no messages of any kind.
//   Everything here came from other players, so it's all checked before it's used.
// ============================================================================
import { cloudRpc } from './cloud';
import { normaliseAllianceBadge, normaliseCard as card, type AllianceBadge, type FriendCard } from './friends';

export const MAX_ALLIANCE = 20;

export interface AllianceMember {
  id: string;
  role: 'leader' | 'member';
  joinedAt: string;
  me: boolean;
  card: FriendCard | null;
}
export interface Alliance extends Omit<AllianceBadge, 'members'> {
  description: string;
  createdAt: string;
  /** This airline's place in it. */
  role: 'leader' | 'member';
  /** Every member, including any hidden from this player by a block. */
  count: number;
  members: AllianceMember[];
  /** Airlines invited and not answered yet (the leader only). */
  invited: { id: string; at: string; card: FriendCard | null }[];
}
export interface AllianceInvite {
  alliance: AllianceBadge;
  from: FriendCard | null;
  at: string;
}
export interface AllianceData {
  mode: 'career' | 'sandbox';
  alliance: Alliance | null;
  invites: AllianceInvite[];
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const list = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter((v) => v && typeof v === 'object') : []);
const when = (x: unknown) => (typeof x === 'string' && !Number.isNaN(Date.parse(x)) ? x : '');

/** What the server sent, safe to show. Null if it isn't the Alliances screen at all. */
export function normaliseAlliances(x: unknown): AllianceData | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  let alliance: Alliance | null = null;
  const a = o.alliance as Record<string, unknown> | null | undefined;
  const badge = a ? normaliseAllianceBadge({ ...a, members: a.count }) : null;
  if (a && badge) {
    const members = list(a.members)
      .filter((m) => typeof m.id === 'string' && ID.test(m.id))
      .slice(0, MAX_ALLIANCE)
      .map((m) => ({ id: String(m.id), role: m.role === 'leader' ? ('leader' as const) : ('member' as const), joinedAt: when(m.joinedAt), me: m.me === true, card: card(m.card) }));
    const { members: _count, ...rest } = badge;
    alliance = {
      ...rest,
      description: typeof a.description === 'string' ? a.description.slice(0, 300) : '',
      createdAt: when(a.createdAt),
      role: a.role === 'leader' ? 'leader' : 'member',
      count: Math.max(members.length, _count),
      members,
      invited: list(a.invited)
        .filter((i) => typeof i.id === 'string' && ID.test(i.id))
        .slice(0, MAX_ALLIANCE)
        .map((i) => ({ id: String(i.id), at: when(i.at), card: card(i.card) })),
    };
  }
  const invites: AllianceInvite[] = [];
  for (const i of list(o.invites).slice(0, 50)) {
    const al = normaliseAllianceBadge(i.alliance);
    if (al) invites.push({ alliance: al, from: card(i.from), at: when(i.at) });
  }
  return { mode: o.mode === 'sandbox' ? 'sandbox' : 'career', alliance, invites };
}

// ---------------------------------------------------------------------------
// What players type
// ---------------------------------------------------------------------------
export const ALLIANCE_NAME = /^[\p{L}\p{N} &'.-]{3,40}$/u;
export const cleanTag = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
export const validTag = (t: string) => /^[A-Z0-9]{2,4}$/.test(t);

const ANSWERS: Record<string, string> = {
  created: '',
  saved: '',
  sent: 'Invite sent.',
  joined: '',
  declined: '',
  off: 'Alliances aren’t available right now.',
  share_first: 'Share this airline first.',
  already_in: 'This airline is already in an alliance. Leave it first.',
  bad_name: 'Pick another name: 3 to 40 letters, numbers, spaces, &, ’, . or -, and nothing rude.',
  bad_tag: 'Pick another tag: 2 to 4 capital letters or numbers, and nothing rude.',
  bad_colours: 'Those colours don’t work. Pick two others.',
  bad_text: 'Change the description: up to 300 characters, and nothing rude.',
  name_taken: 'Another alliance has that name.',
  tag_taken: 'Another alliance has that tag.',
  too_many_today: 'That’s enough alliance changes for today. Try again tomorrow.',
  not_leader: 'Only the alliance’s leader can do that.',
  not_friend: 'You can only invite this airline’s friends.',
  other_mode: 'That airline plays a different mode. Career and Sandbox airlines can’t be in the same alliance.',
  in_alliance: 'That airline is already in an alliance.',
  already: 'You’ve already invited them.',
  full: `The alliance is full: ${MAX_ALLIANCE} airlines, counting the ones invited.`,
  gone: 'That invite isn’t there any more.',
};
/** What to tell the player after an alliance action ('' when it worked and needs no words). */
export const allianceAnswer = (r: unknown) => ANSWERS[String(r)] ?? 'That didn’t work. Try again later.';

export interface AllianceForm {
  name: string;
  tag: string;
  colours: { a: string; b: string };
  description: string;
  useLogo: boolean;
}
const formArgs = (f: AllianceForm) => ({ p_name: f.name.trim(), p_tag: cleanTag(f.tag), p_colours: f.colours, p_description: f.description.trim(), p_use_logo: f.useLogo });

export const loadAlliance = async (me: string) => normaliseAlliances(await cloudRpc('alliance_mine', { p_me: me }));
export const createAlliance = async (me: string, f: AllianceForm) => String(await cloudRpc('alliance_create', { p_me: me, ...formArgs(f) }));
export const editAlliance = async (me: string, f: AllianceForm) => String(await cloudRpc('alliance_edit', { p_me: me, ...formArgs(f) }));
export const inviteToAlliance = async (me: string, id: string) => String(await cloudRpc('alliance_invite', { p_me: me, p_id: id }));
export const cancelAllianceInvite = (me: string, id: string) => cloudRpc('alliance_invite_cancel', { p_me: me, p_id: id });
export const answerAllianceInvite = async (me: string, alliance: string, accept: boolean) => String(await cloudRpc('alliance_respond', { p_me: me, p_alliance: alliance, p_accept: accept }));
export const leaveAlliance = (me: string) => cloudRpc('alliance_leave', { p_me: me });
export const removeFromAlliance = (me: string, id: string) => cloudRpc('alliance_kick', { p_me: me, p_id: id });
export const handOverAlliance = (me: string, id: string) => cloudRpc('alliance_lead', { p_me: me, p_id: id });
export const disbandAlliance = (me: string) => cloudRpc('alliance_disband', { p_me: me });
