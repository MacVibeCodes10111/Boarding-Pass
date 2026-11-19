import { describe, expect, it } from 'vitest';
import { movePairedLeg } from './scheduling';
import type { WeekDays } from './types';

const ALL: WeekDays = [true, true, true, true, true, true, true];
const MWF: WeekDays = [true, false, true, false, true, false, false];
const TTS: WeekDays = [false, true, false, true, false, true, false];

describe('moving a round trip together', () => {
  it('moves the return by the same time', () => {
    // out 12:05, back 23:15; out moves an hour later
    expect(movePairedLeg({ depTimeMin: 725, daysOfWeek: ALL }, { depTimeMin: 1395, daysOfWeek: ALL }, 785, ALL)).toEqual({ depTimeMin: 15, daysOfWeek: ALL });
  });
  it('a return pushed past midnight flies the next day', () => {
    // out Mon/Wed/Fri 08:00, back same days 20:00; out moves 5 h later: back 01:00 the day after
    const r = movePairedLeg({ depTimeMin: 480, daysOfWeek: MWF }, { depTimeMin: 1200, daysOfWeek: MWF }, 780, MWF);
    expect(r).toEqual({ depTimeMin: 60, daysOfWeek: TTS });
  });
  it('a return the day after stays the day after, and follows new days', () => {
    // out Mon/Wed/Fri 22:00, back Tue/Thu/Sat 06:00; out now flies daily
    const r = movePairedLeg({ depTimeMin: 1320, daysOfWeek: MWF }, { depTimeMin: 360, daysOfWeek: TTS }, 1320, ALL);
    expect(r).toEqual({ depTimeMin: 360, daysOfWeek: ALL });
  });
  it('a leg set to a time that wraps round the day keeps the gap to its partner', () => {
    // the return (Tue/Thu/Sat 01:00) set to 23:00 on the same days is 22 h later,
    // so the out leg (Mon/Wed/Fri 18:00) moves 22 h later too: 16:00 on Tue/Thu/Sat
    const r = movePairedLeg({ depTimeMin: 60, daysOfWeek: TTS }, { depTimeMin: 1080, daysOfWeek: MWF }, 1380, TTS);
    expect(r.depTimeMin).toBe(960);
    expect(r.daysOfWeek).toEqual(TTS);
  });
});
