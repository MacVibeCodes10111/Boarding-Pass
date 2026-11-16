// ============================================================================
// ADMIN GRANTS (2026-11-16; server: cloud/supabase/2026-11-16-admin-grants.sql)
//   The owner can give a cloud career cash, or take it away (a negative
//   amount), with a reason. The grant waits on the server until this career is
//   open and signed in: the game applies it once (keeping its id in the save so
//   it never applies twice), writes a Bank letter with the reason, saves, and
//   then claims it so the server stops sending it. A kind the game doesn't know
//   (gems, paid items, later) is left for a newer version.
// ============================================================================
import { cloudRpc } from './cloud';
import { GRANT_ID, type GrantSave } from './grantSave';
import type { BankLetter } from './types';

export { normaliseGrants, withGrants, type GrantSave } from './grantSave';

/** The kinds this version knows. */
const KINDS = new Set(['cash']);

export interface Grant {
  id: string;
  kind: string;
  amount: number;
  reason: string;
  at: string;
}

/** The server's answer, keeping only well-formed grants. */
export function parseGrants(x: unknown): Grant[] {
  if (!Array.isArray(x)) return [];
  return x.flatMap((g) => {
    const r = g as Partial<Grant>;
    return typeof r?.id === 'string' && GRANT_ID.test(r.id) && typeof r.kind === 'string' && typeof r.amount === 'number' && Number.isFinite(r.amount) && r.amount !== 0
      ? [{ id: r.id, kind: r.kind, amount: Math.round(r.amount), reason: typeof r.reason === 'string' ? r.reason.slice(0, 300) : '', at: typeof r.at === 'string' ? r.at : '' }]
      : [];
  });
}

/** What to apply now (new grants of known kinds) and what only needs claiming (applied before, claim lost). */
export function grantActions(list: Grant[], save: GrantSave): { apply: Grant[]; claim: string[] } {
  const done = new Set(save.applied);
  return {
    apply: list.filter((g) => KINDS.has(g.kind) && !done.has(g.id)),
    claim: list.filter((g) => done.has(g.id)).map((g) => g.id),
  };
}

const usd = (n: number) => `$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

/** The Bank letter for a grant. */
export function grantLetter(g: Grant, airlineName: string, econMin: number, sandbox: boolean): BankLetter {
  const added = g.amount > 0;
  return {
    id: `G${g.id.slice(0, 8)}`,
    econMin,
    kind: 'notice',
    subject: added ? `${usd(g.amount)} added to your account` : `${usd(g.amount)} taken from your account`,
    body: [
      `Dear ${airlineName} management,`,
      added
        ? `Boarding Pass has added ${usd(g.amount)} to your account.`
        : `Boarding Pass has taken ${usd(g.amount)} from your account.`,
      ...(g.reason ? [`Reason: ${g.reason}`] : []),
      ...(sandbox ? ['This is a Sandbox career, so your cash doesn’t change.'] : []),
    ],
    read: false,
  };
}

/** This career's open grants (empty when signed out or offline). */
export async function loadGrants(saveId: string): Promise<Grant[]> {
  return parseGrants(await cloudRpc('grants_mine', { p_save_id: saveId }));
}

export const claimGrant = (saveId: string, id: string) => cloudRpc('grant_claim', { p_save_id: saveId, p_id: id });
