// ============================================================================
// REPORTS AND NOTICES (Update A, phase A6)
//   A player reports another airline, an alliance or a logo; only moderators see
//   it (cloud/supabase/2026-11-07-admin.sql). When a moderator changes something
//   of theirs, the player gets a plain notice, shown once, never saying who.
// ============================================================================
import { cloudRpc } from './cloud';

export type ReportKind = 'airline' | 'alliance' | 'logo';
export type ReportReason = 'name' | 'logo' | 'impersonation' | 'other';

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'name', label: 'Offensive name or text' },
  { value: 'logo', label: 'Offensive logo or livery' },
  { value: 'impersonation', label: 'Pretends to be a real airline or company' },
  { value: 'other', label: 'Something else' },
];
export const REPORT_NOTE_MAX = 300;

const ANSWERS: Record<string, string> = {
  sent: 'Thanks. A moderator will look at it. You won’t hear back, but they will act if it breaks the rules.',
  already: 'You’ve already reported this. A moderator will look at it.',
  too_many_today: 'That’s enough reports for today. Try again tomorrow.',
  off: 'Reporting isn’t available right now. You can report it on the Boarding Pass Discord.',
  share_first: 'Share this airline first.',
  not_found: 'That isn’t shared any more.',
  self: 'That’s one of your own airlines.',
  bad: 'That report didn’t work. Try again.',
};
export const reportAnswer = (r: unknown) => ANSWERS[String(r)] ?? 'That report didn’t work. Try again later.';

export async function makeReport(me: string, kind: ReportKind, target: string, reason: ReportReason, note: string, logo?: string | null): Promise<string> {
  return String(await cloudRpc('report_make', { p_me: me, p_kind: kind, p_target: target, p_logo: logo ?? null, p_reason: reason, p_note: note.trim().slice(0, REPORT_NOTE_MAX) }));
}

export interface Notice {
  text: string;
  at: string;
}
/** What the server sent, safe to show as plain text. */
export function normaliseNotices(x: unknown): Notice[] {
  if (!Array.isArray(x)) return [];
  return x
    .filter((n): n is Record<string, unknown> => !!n && typeof n === 'object' && typeof (n as { text?: unknown }).text === 'string')
    .slice(0, 20)
    .map((n) => ({ text: String(n.text).slice(0, 500), at: typeof n.at === 'string' && !Number.isNaN(Date.parse(n.at)) ? n.at : '' }));
}
/** New notices for this player (in this channel). Each is given once. */
export const takeNotices = async () => normaliseNotices(await cloudRpc('notices_mine', {}));
