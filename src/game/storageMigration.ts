// ============================================================================
// The game used to be called "The Airline Simulator" and kept its careers and
// settings under names starting with "tas_". Under its new name, Boarding
// Pass, they live under "bp_". This copies each old entry across once, before
// anything reads them, so nobody loses a career. (The old entries are left in
// place, so an older version of the game still finds them.)
// Imported first by App.tsx.
// ============================================================================
const RENAMED = ['pc_saves_list_v2', 'pc_custom_airports_v3', 'pc_custom_airports_v2', 'pc_prefs_v1', 'fleet_view_v1', 'popup_angle_v1'];

try {
  for (const k of RENAMED) {
    const old = localStorage.getItem(`tas_${k}`);
    if (old !== null && localStorage.getItem(`bp_${k}`) === null) localStorage.setItem(`bp_${k}`, old);
  }
} catch {
  /* storage unavailable: nothing to carry over */
}

export {};
