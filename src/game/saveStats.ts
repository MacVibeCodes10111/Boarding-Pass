// ============================================================================
// WHAT THE SERVER KNOWS ABOUT A CAREER (2026-11-16, server check 2026-11-17)
//   Read from the cloud save itself by the save-check server function
//   (cloud/save-check), which also judges it (saveCheck.ts). The owner's rich
//   list shows the result.
// ============================================================================
import { readProtectedSave } from './saveCrypt';
import { MIN_PER_WEEK } from './time';

export interface SaveStats {
  cash?: number;
  /** What's still owed on bank loans. */
  debt?: number;
  mode?: 'career' | 'sandbox';
  /** Game weeks played. */
  weeks?: number;
  /** Game minutes played (the economy clock). */
  econMin?: number;
  fleet?: number;
  routes?: number;
  hubs?: number;
  /** When the career was started (ms). */
  startedAt?: number;
  /** The save's signature doesn't match: it was edited outside the game. */
  tampered?: boolean;
  unreadable?: boolean;
  /** When the server received this copy (ms). Set by the server. */
  pushedAt?: number;
  /** What the server check found odd (saveCheck.ts). */
  flags?: SaveFlag[];
}

export type SaveFlag = 'edited' | 'time' | 'cash';

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);

export function saveStats(data: unknown, saveId: string): SaveStats {
  const opened = typeof data === 'string' ? readProtectedSave<Record<string, any>>(data) : null;
  const s = opened?.value;
  if (!s || typeof s !== 'object') return { unreadable: true };
  const loans: any[] = Array.isArray(s.career?.loans) ? s.career.loans : [];
  const debt = loans.reduce((sum, l) => sum + Math.max(0, (num(l?.termWeeks) ?? 0) - (num(l?.paid) ?? 0)) * (num(l?.weeklyPayment) ?? 0), 0);
  const pairs = new Set<string>();
  for (const f of Array.isArray(s.schedule) ? s.schedule : []) {
    const a = f?.origin?.iata_code, b = f?.destination?.iata_code;
    if (typeof a === 'string' && typeof b === 'string') pairs.add([a, b].sort().join('-'));
  }
  const started = /^SAVE-(\d{13})$/.exec(saveId)?.[1];
  return {
    cash: num(s.cash),
    debt: Math.round(debt),
    mode: s.gameMode === 'sandbox' ? 'sandbox' : 'career',
    weeks: Math.floor((num(s.econMin) ?? 0) / MIN_PER_WEEK) + 1,
    econMin: Math.max(0, Math.round(num(s.econMin) ?? 0)),
    fleet: Array.isArray(s.fleet) ? s.fleet.length : 0,
    routes: pairs.size,
    hubs: Array.isArray(s.hubs) && s.hubs.length ? s.hubs.length : 1,
    ...(started ? { startedAt: Number(started) } : {}),
    ...(opened && !opened.signed ? { tampered: true } : {}),
  };
}
