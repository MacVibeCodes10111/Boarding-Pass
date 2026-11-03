// ============================================================================
// LIVERY (v2.64)
//   The airline's colours and how they're laid out on its aircraft. Stored in
//   the save; painted onto the aircraft pictures by liveryPaint.ts.
// ============================================================================

export type CheatLine = 'none' | 'stripe' | 'double' | 'swoosh' | 'tailsweep';
export type TailArt = 'solid' | 'split' | 'band' | 'disc' | 'letter' | 'stripes';

export interface Livery {
  v: 1;
  /** Fuselage colour. */
  body: string;
  /** Lower fuselage (belly) colour; same as body for none. */
  belly: string;
  /** How far up the belly colour comes, 0 to 0.7 of the fuselage height. */
  bellyTo: number;
  /** Tail fin colour. */
  tail: string;
  /** Second colour on the tail (for designs that use one). */
  tail2: string;
  tailArt: TailArt;
  /** Engine nacelle colour. */
  engines: string;
  cheat: CheatLine;
  cheat1: string;
  cheat2: string;
  /** Airline name on the fuselage. */
  titles: boolean;
  titleColour: string;
  titleFont: 'sans' | 'serif' | 'italic';
}

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
const one = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);

export const CHEATS: readonly CheatLine[] = ['none', 'stripe', 'double', 'swoosh', 'tailsweep'];
export const TAIL_ARTS: readonly TailArt[] = ['solid', 'split', 'band', 'disc', 'letter', 'stripes'];

export const DEFAULT_LIVERY: Livery = {
  v: 1,
  body: '#ffffff',
  belly: '#ffffff',
  bellyTo: 0,
  tail: '#1d4e89',
  tail2: '#f5a623',
  tailArt: 'solid',
  engines: '#ffffff',
  cheat: 'none',
  cheat1: '#1d4e89',
  cheat2: '#f5a623',
  titles: true,
  titleColour: '#1d4e89',
  titleFont: 'sans',
};

/** A livery from saved data, with anything missing or wrong set to the default. */
export function normaliseLivery(x: unknown): Livery | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  const d = DEFAULT_LIVERY;
  return {
    v: 1,
    body: hex(o.body, d.body),
    belly: hex(o.belly, d.belly),
    bellyTo: typeof o.bellyTo === 'number' && Number.isFinite(o.bellyTo) ? Math.min(0.7, Math.max(0, o.bellyTo)) : d.bellyTo,
    tail: hex(o.tail, d.tail),
    tail2: hex(o.tail2, d.tail2),
    tailArt: one(o.tailArt, TAIL_ARTS, d.tailArt),
    engines: hex(o.engines, d.engines),
    cheat: one(o.cheat, CHEATS, d.cheat),
    cheat1: hex(o.cheat1, d.cheat1),
    cheat2: hex(o.cheat2, d.cheat2),
    titles: typeof o.titles === 'boolean' ? o.titles : d.titles,
    titleColour: hex(o.titleColour, d.titleColour),
    titleFont: one(o.titleFont, ['sans', 'serif', 'italic'] as const, d.titleFont),
  };
}

/** Ready-made styles to start from; each keeps the player's colours where it can. */
export const LIVERY_STYLES: { id: string; label: string; make: (a: string, b: string) => Partial<Livery> }[] = [
  { id: 'eurowhite', label: 'White with coloured tail', make: (a, b) => ({ body: '#ffffff', belly: '#ffffff', bellyTo: 0, tail: a, tail2: b, tailArt: 'solid', engines: '#ffffff', cheat: 'none', titleColour: a }) },
  { id: 'cheatline', label: 'Classic cheatline', make: (a, b) => ({ body: '#ffffff', belly: '#c9ced4', bellyTo: 0.3, tail: a, tail2: b, tailArt: 'band', engines: a, cheat: 'stripe', cheat1: a, cheat2: b, titleColour: a }) },
  { id: 'belly', label: 'Coloured belly', make: (a, b) => ({ body: '#ffffff', belly: a, bellyTo: 0.35, tail: a, tail2: b, tailArt: 'disc', engines: a, cheat: 'none', titleColour: a }) },
  { id: 'swoosh', label: 'Swoosh', make: (a, b) => ({ body: '#ffffff', belly: '#ffffff', bellyTo: 0, tail: a, tail2: b, tailArt: 'split', engines: a, cheat: 'swoosh', cheat1: a, cheat2: b, titleColour: a }) },
  { id: 'sweep', label: 'Tail sweep', make: (a, b) => ({ body: '#ffffff', belly: '#ffffff', bellyTo: 0, tail: a, tail2: b, tailArt: 'stripes', engines: '#ffffff', cheat: 'tailsweep', cheat1: a, cheat2: b, titleColour: a }) },
  { id: 'full', label: 'Full colour', make: (a, b) => ({ body: a, belly: a, bellyTo: 0, tail: a, tail2: b, tailArt: 'letter', engines: a, cheat: 'none', titleColour: '#ffffff' }) },
];

/** A short key for caching painted pictures. */
export function liveryKey(l: Livery, name: string): string {
  return [l.body, l.belly, l.bellyTo.toFixed(2), l.tail, l.tail2, l.tailArt, l.engines, l.cheat, l.cheat1, l.cheat2, l.titles ? 1 : 0, l.titleColour, l.titleFont, name].join('|');
}
