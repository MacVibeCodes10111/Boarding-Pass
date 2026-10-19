// ============================================================================
// LAYOUT: PHONE, TABLET OR DESKTOP
//   One switch for the whole interface, from the window size and whether the
//   screen is touch-first. It is written to <html data-layout="..."> (the CSS
//   in kit.tsx keys off it, along with the --bp-* size variables) and is
//   available to components through useLayout().
//     phone   — narrow screens, or a short landscape phone: bottom tab bar,
//               full-screen panels, compact top bar
//     tablet  — up to ~1100 px wide: desktop layout, narrower panels
//     desktop — everything else
// ============================================================================
import { useEffect, useState } from 'react';

export type LayoutMode = 'phone' | 'tablet' | 'desktop';

/** True on touch-first devices (phones, tablets): no hover, no mouse buttons. */
export const isTouchFirst = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

export function currentLayout(): LayoutMode {
  if (typeof window === 'undefined') return 'desktop';
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w <= 720 || (h <= 500 && w <= 1000 && isTouchFirst())) return 'phone';
  if (w <= 1100) return 'tablet';
  return 'desktop';
}

function apply(mode: LayoutMode) {
  const el = document.documentElement;
  if (el.dataset.layout !== mode) el.dataset.layout = mode;
  const touch = isTouchFirst() ? 'touch' : 'mouse';
  if (el.dataset.input !== touch) el.dataset.input = touch;
}

let mode: LayoutMode = 'desktop';
const listeners = new Set<(m: LayoutMode) => void>();
let started = false;

function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  mode = currentLayout();
  apply(mode);
  const update = () => {
    const next = currentLayout();
    apply(next);
    if (next === mode) return;
    mode = next;
    listeners.forEach((f) => f(next));
  };
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
}

/** The current layout; re-renders when it changes (rotate the phone, resize the window). */
export function useLayout(): LayoutMode {
  start();
  const [m, setM] = useState<LayoutMode>(mode);
  useEffect(() => {
    listeners.add(setM);
    setM(mode);
    return () => {
      listeners.delete(setM);
    };
  }, []);
  return m;
}

/** Sets the layout attributes straight away (before the first render). */
export function initLayout() {
  start();
}
