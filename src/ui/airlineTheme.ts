// ============================================================================
// AIRLINE THEME (v2.67)
//   When a player chooses it, the game takes its highlight colours from the
//   airline's colours while that career is open: the one that reads better on
//   the panels becomes the highlight, the other the fleet colour. It's only a
//   preview of the theme, so the look picked in Appearance stays saved on the
//   device and comes back when the option is off or the career is closed.
// ============================================================================
import type { AirlineColours } from '../game/livery';
import { buildPalette, highlightWarning, loadThemeSpec, type ThemeSpec } from './theme';
import { setTheme } from './kit';

let applied = false;

export function applyAirlineTheme(c: AirlineColours | undefined) {
  if (!c?.theme) {
    if (applied) {
      applied = false;
      setTheme(loadThemeSpec(), { preview: true });
    }
    return;
  }
  const device = loadThemeSpec();
  const tryWith = (accent: string, fleet: string): ThemeSpec => ({ preset: 'airline', base: device.base, accent, fleet, finish: device.finish });
  let spec = tryWith(c.a, c.b);
  if (highlightWarning(buildPalette(spec))) {
    const other = tryWith(c.b, c.a);
    if (!highlightWarning(buildPalette(other))) spec = other;
  }
  applied = true;
  setTheme(spec, { preview: true });
}
