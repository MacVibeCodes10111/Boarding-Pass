// ============================================================================
// DEV BUILDS
//   Test versions from the dev branch: "Boarding Pass Dev" (the desktop app
//   from the Dev build pre-release) and dev.boardingpass.my. Their build sets
//   VITE_BP_CHANNEL=dev (and the build number in VITE_BP_BUILD); the test
//   site is also recognised by its address. The game then shows a DEV badge.
// ============================================================================
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const IS_DEV = env.VITE_BP_CHANNEL === 'dev' || (typeof location !== 'undefined' && /^dev\./i.test(location.hostname));
/** The dev build's number (empty outside dev builds or when built locally) */
export const DEV_BUILD = IS_DEV ? env.VITE_BP_BUILD || '' : '';

if (IS_DEV && typeof document !== 'undefined') document.title = DEV_BUILD ? `Boarding Pass Dev (build ${DEV_BUILD})` : 'Boarding Pass Dev';
