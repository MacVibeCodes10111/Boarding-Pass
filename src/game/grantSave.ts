// ============================================================================
// WHAT A SAVE KEEPS OF ADMIN GRANTS (see grants.ts)
//   The ids of the grants this career has applied, so nothing applies twice.
//   Kept apart from grants.ts so loading a save needs nothing from the network code.
// ============================================================================
export const GRANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Grant ids a save keeps. The server stops sending a grant once it's claimed, long before these run out. */
export const MAX_GRANT_IDS = 200;

export interface GrantSave {
  /** Grants this career has applied, oldest first. */
  applied: string[];
}

export function normaliseGrants(x: unknown): GrantSave {
  const a = (x as { applied?: unknown } | null | undefined)?.applied;
  return { applied: Array.isArray(a) ? [...new Set(a.filter((k): k is string => typeof k === 'string' && GRANT_ID.test(k)))].slice(-MAX_GRANT_IDS) : [] };
}

export const withGrants = (s: GrantSave, ids: string[]): GrantSave => ({ applied: [...s.applied.filter((k) => !ids.includes(k)), ...ids].slice(-MAX_GRANT_IDS) });
