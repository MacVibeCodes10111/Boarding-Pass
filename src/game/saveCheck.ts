// ============================================================================
// THE SERVER'S CHECK OF A CLOUD CAREER (2026-11-17)
//   The game runs on the player's device, so the server checks each Career it
//   receives against the copy before it, by the server's own clock:
//     time: more game time passed than real time allows (clock or speed cheats)
//     cash: cash (less loans owed) grew more than flights could earn
//     edited: the save fails its signature (changed outside the game)
//   It flags, never deletes: the owner sees flags in the rich list and decides.
//   The limits are generous (real careers bank up to about $15M per aircraft
//   per game week), so an honest player isn't flagged.
// ============================================================================
import { MIN_PER_WEEK } from './time';
import type { SaveFlag, SaveStats } from './saveStats';

/** Most a Career can bank per aircraft per game week. */
export const CASH_PER_PLANE_WEEK = 50_000_000;
/** Most an aircraft sells for. */
export const SALE_PER_PLANE = 500_000_000;
/** Milestone rewards (up to $600M), bail-outs and the like. */
export const CASH_SLACK = 1_000_000_000;
/** Game time allowed beyond the real time between two copies: a game day, and a quarter more. */
const TIME_SLACK_MIN = 24 * 60;
const TIME_FACTOR = 1.25;
/** Game minutes per real second at normal speed (clock.ts NORMAL_RATE: a game week per real day). */
export const NORMAL_RATE = MIN_PER_WEEK / 86_400;

const net = (s: SaveStats) => (s.cash ?? 0) - (s.debt ?? 0);

/**
 * Judges a new copy against the one before (`prev`, if the server has it).
 * `elapsedMs`: real time between the server receiving them. `grants`: admin cash given in that time.
 */
export function judgeSave(prev: SaveStats | null | undefined, next: SaveStats, elapsedMs: number | null, grants = 0): SaveFlag[] {
  const flags: SaveFlag[] = [];
  if (next.tampered) flags.push('edited');
  if (next.mode === 'sandbox' || next.unreadable) return flags;
  const fleet = Math.max(prev?.fleet ?? 0, next.fleet ?? 0, 1);
  if (prev && prev.econMin !== undefined && next.econMin !== undefined && elapsedMs !== null && elapsedMs >= 0) {
    const gameMin = next.econMin - prev.econMin;
    const allowed = (elapsedMs / 1000) * NORMAL_RATE * TIME_FACTOR + TIME_SLACK_MIN;
    if (gameMin > allowed) flags.push('time');
    const weeks = Math.max(0, gameMin) / MIN_PER_WEEK;
    const sold = Math.max(0, (prev.fleet ?? 0) - (next.fleet ?? 0));
    const most = weeks * fleet * CASH_PER_PLANE_WEEK + sold * SALE_PER_PLANE + CASH_SLACK + Math.max(0, grants);
    if (prev.cash !== undefined && next.cash !== undefined && net(next) - net(prev) > most) flags.push('cash');
  } else if (next.cash !== undefined) {
    // First look at this career: against its whole life
    const weeks = Math.max(1, (next.econMin ?? 0) / MIN_PER_WEEK);
    if (net(next) > weeks * fleet * CASH_PER_PLANE_WEEK + CASH_SLACK + Math.max(0, grants)) flags.push('cash');
  }
  return flags;
}
