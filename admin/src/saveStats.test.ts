import { describe, expect, it } from 'vitest';
import { protectSave } from '../../src/game/saveCrypt';
import { MIN_PER_WEEK } from '../../src/game/time';
import { saveStats } from './saveStats';

const save = {
  saveId: 'SAVE-1763251200000',
  gameMode: 'career',
  cash: 12_500_000,
  econMin: MIN_PER_WEEK * 9 + 5,
  fleet: [{}, {}, {}],
  hubs: ['LHR', 'JFK'],
  schedule: [
    { origin: { iata_code: 'LHR' }, destination: { iata_code: 'JFK' } },
    { origin: { iata_code: 'JFK' }, destination: { iata_code: 'LHR' } },
    { origin: { iata_code: 'LHR' }, destination: { iata_code: 'CDG' } },
  ],
  career: { loans: [{ termWeeks: 52, paid: 50, weeklyPayment: 1000 }] },
};

describe('rich list stats', () => {
  it('reads a cloud save', () => {
    expect(saveStats(protectSave(save), save.saveId)).toEqual({
      cash: 12_500_000,
      debt: 2000,
      mode: 'career',
      weeks: 10,
      fleet: 3,
      routes: 2,
      hubs: 2,
      startedAt: 1763251200000,
    });
  });

  it('flags a save edited outside the game, and still reads it', () => {
    const real = protectSave(save);
    const [salt, , body] = real.slice(4).split('.');
    const edited = `BP2.${salt}.00000000000000000000000000000000.${body}`;
    const st = saveStats(edited, save.saveId);
    expect(st.tampered).toBe(true);
    expect(st.cash).toBe(12_500_000);
  });

  it('copes with junk', () => {
    expect(saveStats('nope', 'x')).toEqual({ unreadable: true });
    expect(saveStats(null, 'x')).toEqual({ unreadable: true });
    expect(saveStats(protectSave({ gameMode: 'sandbox' }), 'x')).toMatchObject({ mode: 'sandbox', fleet: 0, routes: 0, weeks: 1 });
  });
});
