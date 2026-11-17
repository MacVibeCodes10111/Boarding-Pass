// ============================================================================
// THE TRUSTED CLOCK (2026-11-17)
//   Careers run by the server's clock, not the device's: changing the time on
//   a phone or computer must not skip the game ahead. Each time the game talks
//   to the server it learns the server's time; between those it counts with
//   the steady timer (performance.now), which ignores clock changes. Before
//   the first answer (or for Sandbox, offline) it falls back to the device clock.
// ============================================================================
let anchorServer = 0;
let anchorSteady = 0;

const steady = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

/** The server said its time was `serverMs`, in an answer that took `roundTripMs`. */
export function anchorClock(serverMs: number, roundTripMs = 0) {
  if (!Number.isFinite(serverMs) || serverMs < 1.5e12) return;
  anchorServer = serverMs + Math.max(0, Math.min(roundTripMs, 10_000)) / 2;
  anchorSteady = steady();
}

export const clockAnchored = () => anchorServer > 0;

/** Now, by the server's clock when known. */
export const trustedNow = () => (anchorServer ? Math.round(anchorServer + (steady() - anchorSteady)) : Date.now());

/** Forgets the server's time (signed out). */
export function resetClock() {
  anchorServer = 0;
  anchorSteady = 0;
}

/**
 * How long a career was away, by trusted times. Never longer than since the
 * server last received the save (`cloudAt`), so a save can't claim it was left
 * earlier than it really was.
 */
export function awayMs(now: number, lastRealTs: number | undefined, cloudAt?: number): number {
  if (!lastRealTs || !Number.isFinite(lastRealTs)) return 0;
  const since = Math.max(lastRealTs, Number.isFinite(cloudAt) && cloudAt ? cloudAt : 0);
  return Math.max(0, now - since);
}
