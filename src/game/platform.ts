// ============================================================================
// Which computer the game is running on, and the map controls to describe.
//   Macs often have no middle mouse button (trackpads, Magic Mouse), so the
//   camera can also be raised and lowered with Option (Alt on Windows) + drag.
// ============================================================================

/** True on macOS (also inside the Tauri app, which reports a Mac WebKit view). */
export const IS_MAC: boolean = (() => {
  try {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    return [nav.platform, nav.userAgentData?.platform, nav.userAgent].some((v) => /mac|iphone|ipad/i.test(v || ''));
  } catch {
    return false;
  }
})();

/** Phones and tablets: a touch screen with no mouse. */
export const IS_TOUCH: boolean = (() => {
  try {
    return window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;
  } catch {
    return false;
  }
})();

/** How to tilt and turn the 3D view. */
export const TILT_HINT = IS_TOUCH
  ? 'Drag two fingers up or down to tilt, twist them to turn'
  : IS_MAC
    ? 'Two-finger click and drag (or Control-drag) to tilt and turn'
    : 'Right-drag to tilt and turn';

/** How to raise or lower the camera. */
export const HEIGHT_HINT = IS_TOUCH
  ? 'the ▲ and ▼ buttons by the camera height raise and lower the camera'
  : IS_MAC
    ? 'hold Option (⌥) and drag up or down to raise or lower the camera (a mouse with a middle button works too), or use the ▲ and ▼ buttons'
    : 'hold the middle mouse button (or Alt) and drag up or down to raise or lower the camera, or use the ▲ and ▼ buttons';

/** Tooltip for the camera height readout. */
export const CAMERA_READOUT_TITLE = `Camera height. ${HEIGHT_HINT.charAt(0).toUpperCase()}${HEIGHT_HINT.slice(1)}.`;

/** True when a left-button press should raise/lower the camera instead of panning. */
export const isHeightDragStart = (e: { button: number; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) =>
  e.button === 0 && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
