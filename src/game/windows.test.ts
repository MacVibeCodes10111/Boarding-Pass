import { describe, expect, it } from 'vitest';
import { findWindows } from './liveryPaint';

/** A white fuselage 200×40 with a row of 3×4 dark windows, and one stray dark spot. */
function picture(windows: number) {
  const w = 200, h = 40;
  const B = new Uint8ClampedArray(w * h * 4).fill(255);
  const M = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) M[p * 4 + 1] = 255;
  const dot = (x0: number, y0: number, bw: number, bh: number) => {
    for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) B.fill(60, (y * w + x) * 4, (y * w + x) * 4 + 3);
  };
  for (let k = 0; k < windows; k++) dot(10 + k * 8, 10, 3, 4);
  dot(150, 30, 3, 3);
  return { B, M, w, h };
}

describe('cabin windows', () => {
  it('finds a row of windows, but not a stray spot', () => {
    const { B, M, w, h } = picture(10);
    const g = findWindows(B, M, w, h);
    expect(g[11 * w + 11]).toBe(255);
    expect(g[31 * w + 151]).toBe(0);
    expect(g[30 * w + 100]).toBe(0);
  });
  it('a few spots alone are not windows', () => {
    const { B, M, w, h } = picture(3);
    expect(findWindows(B, M, w, h)[11 * w + 11]).toBe(0);
  });
});
