import { describe, expect, it } from 'vitest';
import { formatMoneyM } from './time';
import { usdShort } from './career';

describe('money in billions and trillions', () => {
  it('buy buttons and prices', () => {
    expect(formatMoneyM(3.5e6)).toBe('$3.5M');
    expect(formatMoneyM(999.9e6)).toBe('$999.9M');
    expect(formatMoneyM(3827e6)).toBe('$3.83B');
    expect(formatMoneyM(1.2e12)).toBe('$1.20T');
    expect(formatMoneyM(-2.5e9)).toBe('−$2.50B');
  });
  it('letters and goals', () => {
    expect(usdShort(25e9)).toBe('$25B');
    expect(usdShort(3e12)).toBe('$3T');
    expect(usdShort(1.25e12)).toBe('$1.25T');
  });
});
