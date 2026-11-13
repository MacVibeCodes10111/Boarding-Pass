// ============================================================================
// BRAND SECTIONS (2026-11): lists of aircraft split into one fold-out section
// for the airline and one for each subsidiary. With no subsidiaries the list
// shows as it always did, without a section.
// ============================================================================
import { useState } from 'react';
import type { BrandKind, PlayerAircraft, Subsidiary } from '../game/types';
import { Icon } from '../ui/icons';
import { C } from '../ui/kit';

export type BrandKey = 'main' | BrandKind;
export interface BrandGroup<T> {
  key: BrandKey;
  name: string;
  items: T[];
}

/** Items split by the brand their aircraft flies for: the airline first, then the regional and cargo brands. Empty ones are left out. */
export function groupByBrand<T>(items: T[], acOf: (t: T) => Pick<PlayerAircraft, 'brand'> | undefined, airlineName: string, subs: Subsidiary[]): BrandGroup<T>[] {
  const keyOf = (t: T): BrandKey => {
    const b = acOf(t)?.brand;
    return b && subs.some((s) => s.kind === b) ? b : 'main';
  };
  const groups: BrandGroup<T>[] = [{ key: 'main', name: airlineName, items: [] }, ...subs.map((s) => ({ key: s.kind as BrandKey, name: s.name, items: [] as T[] }))];
  for (const t of items) groups.find((g) => g.key === keyOf(t))!.items.push(t);
  return groups.filter((g) => g.items.length > 0);
}

const KEY = 'bp_brand_folded_v1';
function readFolded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

/** Which brand sections are folded away, kept on this device. `place` keeps each screen's choice apart. */
export function useFoldedBrands(place: string): [(k: BrandKey) => boolean, (k: BrandKey) => void] {
  const [folded, setFolded] = useState(readFolded);
  const id = (k: BrandKey) => `${place}:${k}`;
  return [
    (k) => folded.has(id(k)),
    (k) => {
      const n = new Set(folded);
      if (n.has(id(k))) n.delete(id(k));
      else n.add(id(k));
      setFolded(n);
      try {
        localStorage.setItem(KEY, JSON.stringify([...n]));
      } catch {
        /* kept for this visit */
      }
    },
  ];
}

/** A fold-out section with the brand's name and how many aircraft it has. */
export function BrandSection(props: { name: string; count: number; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <section aria-label={props.name} style={{ marginBottom: 10 }}>
      <button
        type="button"
        className="bp-group-toggle"
        aria-expanded={props.open}
        onClick={props.onToggle}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px', marginBottom: props.open ? 6 : 0, background: 'none', border: 'none', borderBottom: `1px solid ${C.line}`, color: C.text, cursor: 'pointer', textAlign: 'left' }}
      >
        <Icon name="chevron" size={14} style={{ transform: props.open ? 'rotate(90deg)' : 'none', transition: 'transform .12s', flex: 'none' }} />
        <span style={{ fontSize: 14, fontWeight: 700, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{props.name}</span>
        <span className="num" style={{ fontSize: 12, color: C.faint, whiteSpace: 'nowrap' }}>
          {props.count === 1 ? '1 aircraft' : `${props.count} aircraft`}
        </span>
      </button>
      {props.open && props.children}
    </section>
  );
}

/** Splits a list into brand sections when there are subsidiaries; otherwise renders it whole. */
export function BrandSections<T>(props: {
  place: string;
  items: T[];
  acOf: (t: T) => Pick<PlayerAircraft, 'brand'> | undefined;
  airlineName: string;
  subsidiaries: Subsidiary[];
  /** How many aircraft a section holds, when items aren't one per aircraft. */
  countOf?: (items: T[]) => number;
  children: (items: T[]) => React.ReactNode;
}) {
  const [isFolded, toggle] = useFoldedBrands(props.place);
  if (!props.subsidiaries.length) return <>{props.children(props.items)}</>;
  return (
    <>
      {groupByBrand(props.items, props.acOf, props.airlineName, props.subsidiaries).map((g) => (
        <BrandSection key={g.key} name={g.name} count={props.countOf ? props.countOf(g.items) : g.items.length} open={!isFolded(g.key)} onToggle={() => toggle(g.key)}>
          {props.children(g.items)}
        </BrandSection>
      ))}
    </>
  );
}
