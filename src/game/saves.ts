// ============================================================================
// CAREER SAVES (localStorage slots + .json export/import)
// ============================================================================
import { AIRCRAFT_BY_ID } from './aircraftCatalog';
import { getDefaultCabinForModel } from './economics';
import { daysOrAll } from './time';
import type { Airport, PlayerAircraft, SaveGameState, ScheduledFlight } from './types';

export const MULTI_SAVE_STORAGE_KEY = 'bp_pc_saves_list_v2';
export const CUSTOM_AIRPORTS_KEY = 'bp_pc_custom_airports_v3';
const MAX_SAVE_SLOTS = 10;

/** Drops bulky runway geometry from airports embedded in flights. */
function slimAirport(ap: Airport): Airport {
  const { runways: _runways, ...rest } = ap;
  return rest;
}

export function serializeSave(state: SaveGameState): SaveGameState {
  return {
    ...state,
    schedule: state.schedule.map((fl) => ({
      ...fl,
      origin: slimAirport(fl.origin),
      destination: slimAirport(fl.destination),
    })),
  };
}

/** Re-links saved flights/aircraft to the current airport list and catalog. */
export function hydrateSave(raw: SaveGameState, airportByIata: Map<string, Airport>): SaveGameState {
  const fleet: PlayerAircraft[] = (raw.fleet ?? []).map((ac) => {
    const model = AIRCRAFT_BY_ID.get(ac.model?.id) ?? ac.model;
    return { ...ac, model, cabin: ac.cabin ?? getDefaultCabinForModel(model) };
  });
  const tails = new Set(fleet.map((a) => a.tailNumber));
  const schedule: ScheduledFlight[] = (raw.schedule ?? [])
    .filter((fl) => tails.has(fl.tailNumber))
    .map((fl) => ({
      ...fl,
      origin: airportByIata.get(fl.origin.iata_code) ?? fl.origin,
      destination: airportByIata.get(fl.destination.iata_code) ?? fl.destination,
      daysOfWeek: [...daysOrAll(fl.daysOfWeek)],
    }));
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
  };
}

export function isValidSave(x: unknown): x is SaveGameState {
  const s = x as SaveGameState;
  return Boolean(s && typeof s.airlineName === 'string' && Array.isArray(s.fleet) && typeof s.hubIata === 'string');
}

export function readSaveSlots(): SaveGameState[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(MULTI_SAVE_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isValidSave) : [];
  } catch {
    return [];
  }
}

/** Writes the slot list; returns false when storage is full or unavailable. */
export function writeSaveSlots(list: SaveGameState[]): boolean {
  try {
    localStorage.setItem(MULTI_SAVE_STORAGE_KEY, JSON.stringify(list.slice(0, MAX_SAVE_SLOTS)));
    return true;
  } catch {
    return false;
  }
}

export function upsertSaveSlot(list: SaveGameState[], state: SaveGameState): SaveGameState[] {
  return [serializeSave(state), ...list.filter((s) => s.saveId !== state.saveId)].slice(0, MAX_SAVE_SLOTS);
}

export function downloadSaveFile(state: SaveGameState) {
  const blob = new Blob([JSON.stringify(serializeSave(state), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(state.airlineIata || 'bp').toLowerCase()}_career_save.boardingpass.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been processed (immediate revoke can cancel it in some browsers)
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
