// ============================================================================
// ONLINE FEATURES AND SHARING (v2.8x)
//   Feature flags: which online features are switched on, per channel, from the
//   `features` table in Supabase. Only read once someone is signed in (a player
//   who never signs in sends nothing anywhere), and anything unknown, missing or
//   unreachable counts as off. The server functions behind each feature check
//   the same table, so these flags only decide what the game shows.
//
//   What a player shares is kept on the server, so every device agrees (see cloud.ts).
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

/** Sharing choices used to be kept on this device. Removed on sign-out so nothing is left behind. */
const OLD_SHARING_KEY = 'bp_online_sharing_v1';

// ---------------------------------------------------------------------------
// The legal documents, opened and agreed to before the Online area opens.
// Change LEGAL_VERSION when they change in a way players should see again.
// ---------------------------------------------------------------------------
export const LEGAL_KEY = 'bp_online_legal_v1';
export const LEGAL_VERSION = '2026-11-07d';
export const LEGAL_DOCS = [
  { label: 'Terms of use', url: 'https://boardingpass.my/terms.html' },
  { label: 'Privacy policy', url: 'https://boardingpass.my/privacy.html' },
  { label: 'Cookies and storage', url: 'https://boardingpass.my/cookies.html' },
] as const;

export function legalAccepted(): boolean {
  try {
    return localStorage.getItem(LEGAL_KEY) === LEGAL_VERSION;
  } catch {
    return false;
  }
}

export function acceptLegal() {
  try {
    localStorage.setItem(LEGAL_KEY, LEGAL_VERSION);
  } catch {
    /* storage unavailable: it'll ask again next time */
  }
}

/** Signing out: nothing carries over to whoever signs in next. */
export function clearOnlineState() {
  try {
    localStorage.removeItem(OLD_SHARING_KEY);
    localStorage.removeItem(LEGAL_KEY);
  } catch {
    /* storage unavailable */
  }
  setFeatures(null);
}
