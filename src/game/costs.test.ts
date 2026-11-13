// The five cost lines of a flight.
import { describe, expect, it } from 'vitest';
import { AIRCRAFT_BY_ID } from './aircraftCatalog';
import { COST, ageFactor, flightCosts, isCommuter } from './costs';

const m = (id: string) => AIRCRAFT_BY_ID.get(id)!;
const flight = { blockMin: 120, seatsFitted: 180, cargoTons: 2, ticketRevenue: 30_000 };

describe('flight costs', () => {
  it('has five positive lines that add up to the total', () => {
    for (const id of ['a320neo', 'b787-9', 'atr-72-600', 'b737-200', 'a380-800']) {
      const c = flightCosts(m(id), flight);
      for (const k of ['fuel', 'crew', 'maintenance', 'airport', 'service'] as const) expect(c[k]).toBeGreaterThan(0);
      expect(c.total).toBe(c.fuel + c.crew + c.maintenance + c.airport + c.service);
    }
  });

  it('gives a commuter no cabin crew and no age factor', () => {
    const c208 = m('c208b-ex');
    expect(isCommuter(c208)).toBe(true);
    expect(ageFactor(c208)).toBe(1);
    const nine = flightCosts(c208, { ...flight, seatsFitted: 9 });
    const many = flightCosts(c208, { ...flight, seatsFitted: 300 });
    expect(many.crew).toBe(nine.crew);
  });

  it('gives a freighter no cabin crew and no passenger service', () => {
    const f = m('b777f');
    const c = flightCosts(f, { ...flight, seatsFitted: 0, ticketRevenue: 0 });
    expect(c.service).toBe(0);
    expect(flightCosts(f, { ...flight, seatsFitted: 400, ticketRevenue: 0 }).crew).toBe(c.crew);
  });

  it('keeps the age factor inside its limits', () => {
    const all = [...AIRCRAFT_BY_ID.values()].map(ageFactor);
    expect(Math.min(...all)).toBeGreaterThanOrEqual(COST.ageMin);
    expect(Math.max(...all)).toBeLessThanOrEqual(COST.ageMax);
    expect(all).toContain(COST.ageMin);
    expect(all).toContain(COST.ageMax);
  });

  it('costs an old design more to maintain than its modern successor', () => {
    expect(ageFactor(m('b737-200'))).toBeGreaterThan(ageFactor(m('b737-800')));
  });
});
