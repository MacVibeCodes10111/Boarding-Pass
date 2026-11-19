// ============================================================================
// WINGTIPS (2026-11)
//   Aircraft that were built, or later fitted, with different wingtips: 737
//   blended winglets and split scimitars, A320-family wingtip fences and
//   sharklets, 757, 767 and 727 winglets, the E175's enhanced winglets.
//
//   Each aircraft wears one (none saved = the type's usual one, so old saves
//   are unchanged). They're chosen free when buying; fitting others later
//   costs money. They save fuel the way the real ones do, more on longer
//   flights. The type's usual wingtips are what its fuel burn already
//   counts, so only a change from them makes a difference.
//
//   Each version has its own picture and paint mask, public/aircraft/
//   <model>~<wingtip>.webp (made by tools/art/wingtips.py); the usual one is
//   the type's own picture.
// ============================================================================
import type { AircraftModel, PlayerAircraft, WingtipId } from './types';
export type { WingtipId } from './types';

export const WINGTIP_LABEL: Record<WingtipId, string> = {
  none: 'No winglets',
  winglet: 'Blended winglets',
  scimitar: 'Split scimitar winglets',
  fence: 'Wingtip fences',
  sharklet: 'Sharklets',
  standard: 'Standard winglets',
  enhanced: 'Enhanced winglets',
};

/** Fuel saved on a long flight, against no winglets (shorter flights save less). */
const SAVING: Record<WingtipId, number> = { none: 0, fence: 0, standard: 0, winglet: 0.04, scimitar: 0.055, sharklet: 0.04, enhanced: 0.015 };

interface TypeWingtips {
  /** What the type usually has (its picture, and what its fuel burn counts). */
  usual: WingtipId;
  options: WingtipId[];
  /** Winglets on this type save this much instead (757, 767, 727 winglets). */
  saving?: Partial<Record<WingtipId, number>>;
  /** Price of fitting each, in $M. */
  fitM: Partial<Record<WingtipId, number>>;
}

const NG: TypeWingtips = { usual: 'winglet', options: ['none', 'winglet', 'scimitar'], fitM: { none: 0.25, winglet: 1.2, scimitar: 2.0 } };
const CLASSIC: TypeWingtips = { usual: 'none', options: ['none', 'winglet'], fitM: { none: 0.25, winglet: 1.2 } };
const A320: TypeWingtips = { usual: 'fence', options: ['fence', 'sharklet'], fitM: { fence: 0.3, sharklet: 1.9 } };
const B757: TypeWingtips = { usual: 'winglet', options: ['none', 'winglet'], saving: { winglet: 0.05 }, fitM: { none: 0.3, winglet: 2.2 } };

export const WINGTIP_TYPES: Record<string, TypeWingtips> = {
  'b737-300': CLASSIC,
  'b737-300sf': CLASSIC,
  'b737-500': CLASSIC,
  'b737-700': NG,
  'b737-800': NG,
  'b737-900': { ...NG, options: ['none', 'winglet'] },
  'b737-900er': { ...NG, options: ['winglet', 'scimitar'] },
  'b737-800bcf': { ...NG, usual: 'scimitar' },
  'a319-100': A320,
  'a320-200': A320,
  'a320-p2f': A320,
  'a321-100': A320,
  'a321-200': A320,
  'a321-p2f': A320,
  'b757-200': B757,
  'b757-300': B757,
  'b767-300er': { usual: 'winglet', options: ['none', 'winglet'], saving: { winglet: 0.045 }, fitM: { none: 0.3, winglet: 2.6 } },
  'b767-300f': { usual: 'none', options: ['none', 'winglet'], saving: { winglet: 0.045 }, fitM: { none: 0.3, winglet: 2.6 } },
  'b727-200f': { usual: 'none', options: ['none', 'winglet'], saving: { winglet: 0.03 }, fitM: { none: 0.2, winglet: 1.0 } },
  'e175': { usual: 'standard', options: ['standard', 'enhanced'], fitM: { standard: 0.2, enhanced: 0.6 } },
  'e175lr': { usual: 'standard', options: ['standard', 'enhanced'], fitM: { standard: 0.2, enhanced: 0.6 } },
};

/** The wingtips a type can wear (none when it has only the one kind). */
export const wingtipOptions = (modelId: string): WingtipId[] => WINGTIP_TYPES[modelId]?.options ?? [];

/** What an aircraft wears: its own choice when the type offers it, else the type's usual. */
export function wingtipOf(ac: { model: Pick<AircraftModel, 'id'>; wingtip?: string }): WingtipId | null {
  const t = WINGTIP_TYPES[ac.model.id];
  if (!t) return null;
  return ac.wingtip && t.options.includes(ac.wingtip as WingtipId) ? (ac.wingtip as WingtipId) : t.usual;
}

/** Old saves and junk: a wingtip the type can't wear is dropped (the type's usual one). */
export function normaliseWingtip<T extends { model: Pick<AircraftModel, 'id'>; wingtip?: unknown }>(ac: T): T {
  if (ac.wingtip === undefined) return ac;
  const t = WINGTIP_TYPES[ac.model.id];
  const ok = t && typeof ac.wingtip === 'string' && t.options.includes(ac.wingtip as WingtipId) && ac.wingtip !== t.usual;
  if (ok) return ac;
  const { wingtip: _drop, ...rest } = ac;
  return rest as T;
}

/** The picture to show: the type's own, or its version with these wingtips. */
export function artIdFor(modelId: string, wingtip?: string | null): string {
  const t = WINGTIP_TYPES[modelId];
  if (!t || !wingtip || wingtip === t.usual || !t.options.includes(wingtip as WingtipId)) return modelId;
  return `${modelId}~${wingtip}`;
}
/** The type a picture belongs to (its livery adjustments are the type's). */
export const modelOfArt = (artId: string) => artId.split('~')[0];

const savingOf = (t: TypeWingtips, w: WingtipId) => t.saving?.[w] ?? SAVING[w];

/** How far the saving reaches its full amount (climbing and descending gain little). */
const FULL_SAVING_NM = 1500;

/**
 * Fuel burnt with these wingtips against the type's usual ones (1 = the same),
 * on a flight of this distance.
 */
export function wingtipFuelFactor(ac: { model: Pick<AircraftModel, 'id'>; wingtip?: string }, distanceNm: number): number {
  const t = WINGTIP_TYPES[ac.model.id];
  const w = wingtipOf(ac);
  if (!t || !w || w === t.usual) return 1;
  const reach = Math.min(1, Math.max(0.3, distanceNm / FULL_SAVING_NM));
  return (1 - savingOf(t, w) * reach) / (1 - savingOf(t, t.usual) * reach);
}

/** Fuel saved on a long flight against the usual wingtips, as a share (negative: burns more). */
export function wingtipLongSaving(modelId: string, w: WingtipId): number {
  const t = WINGTIP_TYPES[modelId];
  if (!t) return 0;
  return 1 - (1 - savingOf(t, w)) / (1 - savingOf(t, t.usual));
}

/** What fitting these wingtips costs, $ (0 when it already has them). Scimitars over blended winglets cost less. */
export function wingtipFitUsd(ac: { model: Pick<AircraftModel, 'id'>; wingtip?: string }, to: WingtipId): number {
  const t = WINGTIP_TYPES[ac.model.id];
  const from = wingtipOf(ac);
  if (!t || !t.options.includes(to) || from === to) return 0;
  const m = to === 'scimitar' && from === 'winglet' ? 0.8 : t.fitM[to] ?? 0;
  return Math.round(m * 1e6);
}

/** The aircraft with these wingtips (none saved when they're the type's usual). */
export function withWingtip(ac: PlayerAircraft, w: WingtipId): PlayerAircraft {
  const t = WINGTIP_TYPES[ac.model.id];
  const { wingtip: _old, ...rest } = ac;
  return t && t.options.includes(w) && w !== t.usual ? { ...rest, wingtip: w } : rest;
}
