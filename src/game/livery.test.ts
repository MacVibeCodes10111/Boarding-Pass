import { describe, expect, it } from 'vitest';
import { LOGO_SIZE_MAX, LOGO_SIZE_MIN, layerFor, liveryKey, normaliseLivery } from './livery';

const logo = (size: number, adj?: number) => ({
  v: 2,
  logos: { a: 'data:image/png;base64,AAAA' },
  layers: [{ id: 'l1', name: 'Logo', opacity: 1, region: 'tail', kind: 'logo', frame: 'fin', logo: 'a', x: 0.5, y: 0.5, size, rot: 0, ...(adj ? { adj: { 'a320-200': { size: adj } } } : {}) }],
});
const sizeOf = (x: unknown, model = 'b737-800') => {
  const l = normaliseLivery(x)?.layers[0];
  const on = l && layerFor(l, model);
  return on && on.kind === 'logo' ? on.size : null;
};

describe('logo sizes', () => {
  it('keeps very small and very big logos, as saved', () => {
    expect(sizeOf(logo(0.003))).toBe(0.003);
    expect(sizeOf(logo(25))).toBe(25);
    expect(sizeOf(logo(1e6))).toBe(LOGO_SIZE_MAX);
    expect(sizeOf(logo(0))).toBe(LOGO_SIZE_MIN);
  });

  it('a size for one aircraft type gets the same range', () => {
    expect(sizeOf(logo(0.5, 30), 'a320-200')).toBe(30);
  });
});

describe('neo mask', () => {
  it('is kept when on, left out otherwise, and changes the painted picture', () => {
    const on = normaliseLivery({ ...logo(0.5), neoMask: true })!;
    expect(on.neoMask).toBe(true);
    const off = normaliseLivery({ ...logo(0.5), neoMask: 'yes' })!;
    expect('neoMask' in off).toBe(false);
    expect(liveryKey(on, 'Air')).not.toBe(liveryKey(off, 'Air'));
  });
});
