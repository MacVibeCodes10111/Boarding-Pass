// ============================================================================
// PICKING AIRCRAFT IN THE FLEET LIST (2026-11)
//   Shift-click (or "Select in between" on a phone) picks every aircraft
//   between two; "Select…" picks all, half or a quarter of a type, base,
//   route, airport or the like, in the order the list shows them.
// ============================================================================

/** Every tail from a to b (either way round) in the list's order; just b when a isn't in it. */
export function rangeBetween(order: string[], a: string, b: string): string[] {
  const i = order.indexOf(a), j = order.indexOf(b);
  if (i < 0 || j < 0) return j < 0 ? [] : [b];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** Every tail between the first and last picked one, in the list's order. */
export function fillBetween(order: string[], picked: Set<string>): string[] {
  let i = -1, j = -1;
  order.forEach((t, k) => {
    if (!picked.has(t)) return;
    if (i < 0) i = k;
    j = k;
  });
  return i < 0 ? [] : order.slice(i, j + 1);
}

/** How many of a group: all, half or a quarter (rounded up, at least one). */
export type Share = 1 | 0.5 | 0.25;
export const takeShare = <T,>(list: T[], share: Share): T[] => list.slice(0, list.length ? Math.max(1, Math.ceil(list.length * share)) : 0);

export interface PickRow {
  tail: string;
  type: string;
  base: string;
  /** Airports in the order it flies them (the base first). */
  path: string[];
  idle: boolean;
  busy: boolean;
  leased: boolean;
  brand?: string;
}
export interface PickGroup {
  id: string;
  /** Shown in the menu's sections: Shown, Type, Base, Route, Airport, Brand. */
  section: string;
  label: string;
  tails: string[];
}

const leg = (a: string, b: string) => (a < b ? `${a}–${b}` : `${b}–${a}`);

/** The groups the fleet can be picked by, each in the list's order. */
export function pickGroups(rows: PickRow[], brandName?: (b: string | undefined) => string): PickGroup[] {
  const out: PickGroup[] = [];
  const add = (section: string, label: string, tails: string[]) => tails.length && out.push({ id: `${section}:${label}`, section, label, tails });
  add('Shown', 'Every aircraft shown', rows.map((r) => r.tail));
  add('Shown', 'Idle', rows.filter((r) => r.idle).map((r) => r.tail));
  add('Shown', 'Busy (85% or more)', rows.filter((r) => r.busy).map((r) => r.tail));
  add('Shown', 'Leased', rows.filter((r) => r.leased).map((r) => r.tail));
  const by = (section: string, keys: (r: PickRow) => string[], min = 1) => {
    const m = new Map<string, string[]>();
    for (const r of rows) for (const k of new Set(keys(r))) m.set(k, [...(m.get(k) ?? []), r.tail]);
    [...m.entries()]
      .filter(([, t]) => t.length >= min)
      .sort(([a, ta], [b, tb]) => tb.length - ta.length || a.localeCompare(b))
      .forEach(([k, t]) => add(section, k, t));
  };
  by('Type', (r) => [r.type]);
  by('Base', (r) => [r.base]);
  by('Route', (r) => r.path.slice(1).map((b, k) => leg(r.path[k], b)).filter((_, k) => r.path[k] !== r.path[k + 1]));
  by('Airport', (r) => r.path.filter((a) => a !== r.base));
  if (brandName && new Set(rows.map((r) => r.brand ?? '')).size > 1) by('Brand', (r) => [brandName(r.brand)]);
  return out;
}
