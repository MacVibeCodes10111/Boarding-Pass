import { describe, expect, it } from 'vitest';
import { fillBetween, pickGroups, rangeBetween, takeShare } from './fleetSelect';

const order = ['A', 'B', 'C', 'D', 'E'];

describe('picking aircraft', () => {
  it('a shift-click run, either way round', () => {
    expect(rangeBetween(order, 'B', 'D')).toEqual(['B', 'C', 'D']);
    expect(rangeBetween(order, 'E', 'C')).toEqual(['C', 'D', 'E']);
    expect(rangeBetween(order, 'X', 'C')).toEqual(['C']);
  });
  it('in between the first and last picked', () => {
    expect(fillBetween(order, new Set(['D', 'B']))).toEqual(['B', 'C', 'D']);
    expect(fillBetween(order, new Set())).toEqual([]);
  });
  it('all, half or a quarter, rounded up', () => {
    expect(takeShare(order, 1)).toHaveLength(5);
    expect(takeShare(order, 0.5)).toEqual(['A', 'B', 'C']);
    expect(takeShare(order, 0.25)).toEqual(['A', 'B']);
    expect(takeShare(['A'], 0.25)).toEqual(['A']);
    expect(takeShare([], 0.5)).toEqual([]);
  });
  it('groups by type, base, route and airport, in the list’s order', () => {
    const row = (tail: string, type: string, path: string[]) => ({ tail, type, base: 'BOS', path, idle: !path.length, busy: false, leased: false });
    const g = pickGroups([row('N1', '737', ['CVG', 'LAX', 'CVG']), row('N2', 'A320', ['LAX', 'CVG', 'SAN', 'CVG']), row('N3', '737', [])]);
    const find = (id: string) => g.find((x) => x.id === id)?.tails;
    expect(find('Type:737')).toEqual(['N1', 'N3']);
    expect(find('Route:CVG–LAX')).toEqual(['N1', 'N2']);
    expect(find('Route:CVG–SAN')).toEqual(['N2']);
    expect(find('Airport:LAX')).toEqual(['N1', 'N2']);
    expect(find('Shown:Idle')).toEqual(['N3']);
    expect(find('Base:BOS')).toEqual(['N1', 'N2', 'N3']);
  });
});
