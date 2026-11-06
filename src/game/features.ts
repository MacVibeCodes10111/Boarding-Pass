// ============================================================================
// ONLINE FEATURES AND SHARING (v2.8x)
//   Feature flags: which online features are switched on, per channel, from the
//   `features` table in Supabase. Only read once someone is signed in (a player
//   who never signs in sends nothing anywhere), and anything unknown, missing or
//   unreachable counts as off. The server functions behind each feature check
//   the same table, so these flags only decide what the game shows.
//
//   Sharing choices kept on this device: all off until they're turned on, and
//   forgotten on sign-out. Whether the airline itself is shared is kept on the
//   server, so every device agrees (see cloud.ts).
//
//   How the online parts fit together: cloud/README.md.
// ============================================================================
export const FEATURES = ['online', 'profiles', 'logos', 'friends', 'friends_map', 'alliances', 'reports', 'marketplace'] as const;
export type Feature = (typeof FEATURES)[number];

let on = new Set<Feature>();
const listeners = new Set<() => void>();

export const featureOn = (f: Feature) => on.has(f);
export function onFeaturesChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Sets the flags from the server's rows. Anything unexpected in them is ignored, so it stays off. */
export function setFeatures(rows: unknown) {
  const next = new Set<Feature>();
  if (Array.isArray(rows)) {
    for (const r of rows as { feature?: unknown; enabled?: unknown }[]) {
      if (r?.enabled === true && FEATURES.includes(r.feature as Feature)) next.add(r.feature as Feature);
    }
  }
  const same = next.size === on.size && [...next].every((f) => on.has(f));
  on = next;
  if (!same) listeners.forEach((fn) => fn());
}

// ---------------------------------------------------------------------------
// Sharing choices
// ---------------------------------------------------------------------------
export const SHARING_KEY = 'bp_online_sharing_v1';
export const SHARING = [
  { id: 'map', feature: 'friends_map', label: 'Show my aircraft on friends’ maps', hint: 'Your schedule, so friends and alliance members can watch your flights.' },
] as const satisfies readonly { id: string; feature: Feature; label: string; hint: string }[];
export type SharingId = (typeof SHARING)[number]['id'];

/** Any saved value that isn't exactly `true` counts as off. */
export function readSharing(): Record<SharingId, boolean> {
  let saved: Record<string, unknown> = {};
  try {
    const v: unknown = JSON.parse(localStorage.getItem(SHARING_KEY) ?? '{}');
    if (v && typeof v === 'object') saved = v as Record<string, unknown>;
  } catch {
    /* storage unavailable or damaged: everything stays off */
  }
  return Object.fromEntries(SHARING.map((s) => [s.id, saved[s.id] === true])) as Record<SharingId, boolean>;
}

export function setSharing(id: SharingId, value: boolean) {
  try {
    localStorage.setItem(SHARING_KEY, JSON.stringify({ ...readSharing(), [id]: value }));
  } catch {
    /* storage unavailable */
  }
}

/** Signing out: nothing carries over to whoever signs in next. */
export function clearOnlineState() {
  try {
    localStorage.removeItem(SHARING_KEY);
  } catch {
    /* storage unavailable */
  }
  setFeatures(null);
}
