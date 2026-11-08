// ============================================================================
// WHAT A SAVE KEEPS OF THE MARKETPLACE (Update B; see market.ts)
//   The keys of what this career has applied, so nothing applies twice. Kept
//   apart from market.ts so loading a save needs nothing from the network code.
// ============================================================================
const KEY = /^(l|r|s|b|xs|xb):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** How many applied keys a save keeps. The server stops sending things long before these run out. */
export const MAX_APPLIED = 500;

export interface MarketSave {
  /** Keys this career has applied, oldest first. */
  applied: string[];
}
export function normaliseMarket(x: unknown): MarketSave {
  const a = (x as { applied?: unknown } | null | undefined)?.applied;
  return { applied: Array.isArray(a) ? [...new Set(a.filter((k): k is string => typeof k === 'string' && KEY.test(k)))].slice(-MAX_APPLIED) : [] };
}
export const withApplied = (m: MarketSave, keys: string[]): MarketSave => ({ applied: [...m.applied.filter((k) => !keys.includes(k)), ...keys].slice(-MAX_APPLIED) });
