// ============================================================================
// CAREER SAVES (localStorage slots + .json export/import)
// ============================================================================
import { AIRCRAFT_BY_ID } from './aircraftCatalog';
import { MAX_FARE_MULT, getDefaultCabinForModel, getRouteDemandAndFares } from './economics';
import { isProtectedSave, openProtectedSave, protectSave } from './saveCrypt';
import { daysOrAll } from './time';
import type { Airport, PlayerAircraft, SaveGameState, ScheduledFlight } from './types';

export const MULTI_SAVE_STORAGE_KEY = 'bp_pc_saves_list_v2';
/** Set once the plain saves from before v2.38 have been re-saved protected. */
const PROTECTED_SINCE_KEY = 'bp_pc_saves_protected_v1';
export const CUSTOM_AIRPORTS_KEY = 'bp_pc_custom_airports_v3';
const MAX_SAVE_SLOTS = 10;

/** Drops bulky runway geometry from airports embedded in flights. */
function slimAirport(ap: Airport): Airport {
  const { runways: _runways, ...rest } = ap;
  return rest;
}

/**
 * The save as stored (v2.39+, much smaller for big airlines): each airport is
 * written once in `savedAirports` and flights only name theirs by code;
 * aircraft types are named by id when they are in the catalog. Older saves,
 * with whole airports in every flight, still load.
 */
export function serializeSave(state: SaveGameState): SaveGameState {
  const savedAirports: Record<string, Airport> = {};
  const prev = state.savedAirports ?? {};
  const ref = (ap: Airport) => {
    // A save read back from storage already names airports by code: keep its stored copy
    if (!savedAirports[ap.iata_code]) savedAirports[ap.iata_code] = Number.isFinite(ap.latitude_deg) ? slimAirport(ap) : prev[ap.iata_code] ?? ap;
    return { iata_code: ap.iata_code } as Airport;
  };
  return {
    ...state,
    fleet: state.fleet.map((ac) => (AIRCRAFT_BY_ID.has(ac.model.id) ? { ...ac, model: { id: ac.model.id, name: ac.model.name } as PlayerAircraft['model'] } : ac)),
    schedule: state.schedule.map((fl) => ({ ...fl, origin: ref(fl.origin), destination: ref(fl.destination) })),
    savedAirports,
  };
}

/** Re-links saved flights/aircraft to the current airport list and catalog. */
/** Fares from older saves above five times the market (which used to sell anyway) come down to it. */
function capFares(fl: ScheduledFlight): ScheduledFlight['fares'] {
  if (!fl.fares || !(fl.distanceNm > 0)) return fl.fares;
  const ref = getRouteDemandAndFares(fl.origin, fl.destination, fl.distanceNm).refFares;
  const c = (v: number | undefined, r: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(v, Math.round(r * MAX_FARE_MULT)) : v);
  return { ...fl.fares, econ: c(fl.fares.econ, ref.econ)!, prem: c(fl.fares.prem, ref.prem)!, bus: c(fl.fares.bus, ref.bus)!, first: c(fl.fares.first, ref.first)!, cargoPerTon: c(fl.fares.cargoPerTon, ref.cargoPerTon) };
}

export function hydrateSave(raw: SaveGameState, airportByIata: Map<string, Airport>): SaveGameState {
  const fleet: PlayerAircraft[] = (raw.fleet ?? []).map((ac) => {
    const model = AIRCRAFT_BY_ID.get(ac.model?.id) ?? ac.model;
    return { ...ac, model, cabin: ac.cabin ?? getDefaultCabinForModel(model) };
  });
  const tails = new Set(fleet.map((a) => a.tailNumber));
  const saved = raw.savedAirports ?? {};
  const link = (ap: Airport) => airportByIata.get(ap.iata_code) ?? saved[ap.iata_code] ?? ap;
  const schedule: ScheduledFlight[] = (raw.schedule ?? [])
    .filter((fl) => tails.has(fl.tailNumber))
    .map((fl) => {
      const linked = { ...fl, origin: link(fl.origin), destination: link(fl.destination), daysOfWeek: [...daysOrAll(fl.daysOfWeek)] };
      return { ...linked, fares: capFares(linked) };
    });
  const hubs = raw.hubs && raw.hubs.length > 0 ? raw.hubs : [raw.hubIata];

  return {
    ...raw,
    saveId: raw.saveId || `SAVE-${Date.now()}`,
    hubs,
    gameMode: raw.gameMode === 'sandbox' ? 'sandbox' : 'standard',
    cash: Number.isFinite(raw.cash) ? raw.cash : 150_000_000,
    simMin: Number.isFinite(raw.simMin) ? raw.simMin : 480,
    simDay: Number.isFinite(raw.simDay) && raw.simDay >= 1 ? Math.floor(raw.simDay) : 1,
    fleet,
    schedule,
    savedAirports: undefined,
  };
}

export function isValidSave(x: unknown): x is SaveGameState {
  const s = x as SaveGameState;
  return Boolean(s && typeof s.airlineName === 'string' && Array.isArray(s.fleet) && typeof s.hubIata === 'string');
}

/**
 * The saved careers. Protected saves are checked; one that was changed
 * outside the game is left out. Plain saves from before v2.38 load once as
 * they are (and are re-saved protected); a plain save that turns up after
 * that opens in Sandbox mode.
 */
export function readSaveSlots(): SaveGameState[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(MULTI_SAVE_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const migrated = localStorage.getItem(PROTECTED_SINCE_KEY) === '1';
    let plain = 0;
    const out: SaveGameState[] = [];
    for (const entry of parsed) {
      if (isProtectedSave(entry)) {
        const opened = openProtectedSave<SaveGameState>(entry);
        if (opened.ok && isValidSave(opened.value)) out.push(opened.value);
        continue;
      }
      if (!isValidSave(entry)) continue;
      plain++;
      out.push(migrated ? asUnprotected(entry) : entry);
    }
    // First run of v2.38: re-save the old plain careers protected
    if (!migrated) {
      if (plain === 0 || writeSaveSlots(out)) localStorage.setItem(PROTECTED_SINCE_KEY, '1');
    }
    return out;
  } catch {
    return [];
  }
}

/** A save that isn't protected (edited, or exported before v2.38) plays as Sandbox. */
export function asUnprotected(s: SaveGameState): SaveGameState {
  return s.gameMode === 'sandbox' ? s : { ...s, gameMode: 'sandbox', unprotected: true };
}

/** Writes the slot list; returns false when storage is full or unavailable. */
export function writeSaveSlots(list: SaveGameState[]): boolean {
  try {
    localStorage.setItem(MULTI_SAVE_STORAGE_KEY, JSON.stringify(list.slice(0, MAX_SAVE_SLOTS).map((s) => protectSave(serializeSave(s)))));
    return true;
  } catch {
    return false;
  }
}

export function upsertSaveSlot(list: SaveGameState[], state: SaveGameState): SaveGameState[] {
  return [serializeSave(state), ...list.filter((s) => s.saveId !== state.saveId)].slice(0, MAX_SAVE_SLOTS);
}

export function downloadSaveFile(state: SaveGameState) {
  const blob = new Blob([protectSave(serializeSave(state))], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(state.airlineIata || 'bp').toLowerCase()}_career.boardingpass`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been processed (immediate revoke can cancel it in some browsers)
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type ImportedSave = { ok: true; save: SaveGameState; unprotected: boolean } | { ok: false; message: string };

/** Reads an exported save file: protected (v2.38+) or a plain .json from before. */
export function readSaveFileText(text: string): ImportedSave {
  const t = text.trim();
  if (isProtectedSave(t)) {
    const opened = openProtectedSave<SaveGameState>(t);
    if (!opened.ok)
      return {
        ok: false,
        message: opened.reason === 'tampered' ? 'This save file was changed outside the game, so it can\u2019t be loaded.' : 'This file isn\u2019t a Boarding Pass save, or it is damaged.',
      };
    if (!isValidSave(opened.value)) return { ok: false, message: 'This file isn\u2019t a Boarding Pass save, or it is damaged.' };
    return { ok: true, save: opened.value, unprotected: false };
  }
  try {
    const parsed = JSON.parse(t);
    if (!isValidSave(parsed)) return { ok: false, message: 'This file isn\u2019t a Boarding Pass save, or it is damaged.' };
    const save = asUnprotected(parsed);
    return { ok: true, save, unprotected: save.gameMode !== parsed.gameMode };
  } catch {
    return { ok: false, message: 'This file isn\u2019t a Boarding Pass save, or it is damaged.' };
  }
}
