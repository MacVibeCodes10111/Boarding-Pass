import { describe, expect, it } from 'vitest';
import { nextRegistrations } from './registrations';
import { MAX_FLIGHTS, MAX_REGS, MAX_SNAPSHOT_BYTES, buildSnapshot, checkSnapshot, type ScheduleSnapshot, type SnapshotFlight, type SnapshotSource } from './scheduleSnapshot';

const flight = (over: Partial<SnapshotSource['schedule'][number]> = {}): SnapshotSource['schedule'][number] => ({
  tailNumber: 'G-ABCD',
  flightNumber: 'BP123',
  origin: { iata_code: 'LHR' },
  destination: { iata_code: 'JFK' },
  depTimeMin: 600,
  blockTimeMin: 480,
  daysOfWeek: [true, false, true, false, false, false, false],
  ...over,
});
const fleet = [{ tailNumber: 'G-ABCD', model: { id: 'a320-200' } }];
const good = (): ScheduleSnapshot => ({ v: 1, models: ['a320-200'], regs: ['G-ABCD'], flights: [['LHR', 'JFK', 600, 480, 5, 0, 0, 'BP123', 0]] });

describe('building a snapshot', () => {
  it('holds only the weekly pattern, and passes its own check', () => {
    const s = buildSnapshot({ fleet, schedule: [flight()] });
    expect(s).toEqual(good());
    expect(checkSnapshot(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('never picks up anything else from a career', () => {
    const career = { fleet: fleet.map((a) => ({ ...a, cabin: { secret: 1 }, lease: 99 })), schedule: [{ ...flight(), fares: { econ: 12345 } }], cash: 987654, airlineName: 'Private' } as unknown as SnapshotSource;
    const text = JSON.stringify(buildSnapshot(career));
    for (const word of ['12345', '987654', 'Private', 'secret', 'lease']) expect(text).not.toContain(word);
  });

  it('marks the special livery', () => {
    expect(buildSnapshot({ fleet: [{ ...fleet[0], livery: 1 }], schedule: [flight()] }).flights[0][8]).toBe(1);
  });

  it('treats missing days as every day', () => {
    expect(buildSnapshot({ fleet, schedule: [flight({ daysOfWeek: undefined })] }).flights[0][4]).toBe(127);
  });

  it('wraps departures into the day', () => {
    expect(buildSnapshot({ fleet, schedule: [flight({ depTimeMin: 1500 })] }).flights[0][2]).toBe(60);
    expect(buildSnapshot({ fleet, schedule: [flight({ depTimeMin: -30 })] }).flights[0][2]).toBe(1410);
  });

  it('leaves out what it can’t describe', () => {
    const bad = [flight({ tailNumber: 'NOT-IN-FLEET' }), flight({ blockTimeMin: 0 }), flight({ blockTimeMin: NaN }), flight({ origin: { iata_code: '' } }), flight({ daysOfWeek: Array(7).fill(false) })];
    expect(buildSnapshot({ fleet, schedule: bad }).flights).toEqual([]);
  });

  it('leaves out a registration with a blocked word, and blanks such a flight number', () => {
    const rude = 'G-FUCK';
    expect(buildSnapshot({ fleet: [{ ...fleet[0], tailNumber: rude }], schedule: [flight({ tailNumber: rude })] }).flights).toEqual([]);
    expect(buildSnapshot({ fleet, schedule: [flight({ flightNumber: 'ASS1' })] }).flights[0][7]).toBe('');
    expect(buildSnapshot({ fleet, schedule: [flight({ flightNumber: 'not a number!' })] }).flights[0][7]).toBe('');
  });

  it('keeps to every limit, however big the airline', () => {
    const many = Array.from({ length: 4000 }, (_, i) => `R-${i.toString(36).toUpperCase().padStart(5, 'B')}`);
    const big = buildSnapshot({
      fleet: many.map((tailNumber) => ({ tailNumber, model: { id: 'a320-200' } })),
      schedule: many.flatMap((tailNumber, i) => [flight({ tailNumber, flightNumber: `BP${i}` }), flight({ tailNumber, flightNumber: `BP${i + 4000}` })]),
    });
    expect(big.flights.length).toBeLessThanOrEqual(MAX_FLIGHTS);
    expect(big.regs.length).toBeLessThanOrEqual(MAX_REGS);
    expect(JSON.stringify(big).length).toBeLessThanOrEqual(MAX_SNAPSHOT_BYTES);
    expect(checkSnapshot(big)).not.toBeNull();
  });
});

describe('the game’s own registrations', () => {
  it('nearly all pass the word filter, in any country, and what passes the build passes the check', () => {
    let tried = 0;
    let kept = 0;
    for (const country of ['US', 'GB', 'DE', 'FR', 'CN', 'JP', 'AE', 'AU', 'BR', 'IN', 'RU', 'ZA', 'KE', 'NG', 'TR', 'CA', 'MX', 'KR', 'SG', 'IT']) {
      const tails = nextRegistrations([], 'BP', country, 400);
      tried += tails.length;
      const snap = buildSnapshot({
        fleet: tails.map((tailNumber) => ({ tailNumber, model: { id: 'a320-200' } })),
        schedule: tails.map((tailNumber) => flight({ tailNumber })),
      });
      kept += snap.regs.length;
      expect(checkSnapshot(snap)).not.toBeNull();
    }
    expect(tried).toBeGreaterThan(5000);
    // The odd one really does spell something: its flights just don't show on friends' maps
    expect(kept / tried).toBeGreaterThan(0.99);
  });
});

describe('checking a snapshot', () => {
  const withFlight = (f: unknown) => ({ ...good(), flights: [f as SnapshotFlight] });
  it.each([
    ['nothing', null],
    ['text', 'hello'],
    ['another version', { ...good(), v: 2 }],
    ['too many flights', { ...good(), flights: Array(MAX_FLIGHTS + 1).fill(good().flights[0]) }],
    ['too many registrations', { ...good(), regs: Array(MAX_REGS + 1).fill('G-ABCD') }],
    ['a blocked word in a registration', { ...good(), regs: ['G-FUCK'] }],
    ['HTML in a registration', { ...good(), regs: ['<img src=x>'] }],
    ['a script in a model', { ...good(), models: ['<script>'] }],
    ['a short row', withFlight(['LHR', 'JFK', 600])],
    ['a long row', withFlight(['LHR', 'JFK', 600, 480, 5, 0, 0, 'BP1', 0, 'extra'])],
    ['text for an airport', withFlight(['<b>x', 'JFK', 600, 480, 5, 0, 0, 'BP1', 0])],
    ['a time past midnight', withFlight(['LHR', 'JFK', 1440, 480, 5, 0, 0, 'BP1', 0])],
    ['a fractional time', withFlight(['LHR', 'JFK', 1.5, 480, 5, 0, 0, 'BP1', 0])],
    ['no days', withFlight(['LHR', 'JFK', 600, 480, 0, 0, 0, 'BP1', 0])],
    ['an endless flight', withFlight(['LHR', 'JFK', 600, 9000, 5, 0, 0, 'BP1', 0])],
    ['a model that isn’t listed', withFlight(['LHR', 'JFK', 600, 480, 5, 7, 0, 'BP1', 0])],
    ['a registration that isn’t listed', withFlight(['LHR', 'JFK', 600, 480, 5, 0, 7, 'BP1', 0])],
    ['a third livery', withFlight(['LHR', 'JFK', 600, 480, 5, 0, 0, 'BP1', 2])],
    ['words as a flight number', withFlight(['LHR', 'JFK', 600, 480, 5, 0, 0, 'hello there', 0])],
    ['a blocked word as a flight code', withFlight(['LHR', 'JFK', 600, 480, 5, 0, 0, 'ASS123', 0])],
  ])('refuses %s', (_name, x) => {
    expect(checkSnapshot(x)).toBeNull();
  });

  it('looks at the letters of a registration, not digits that look like letters', () => {
    expect(checkSnapshot({ ...good(), regs: ['HB-455'] })).not.toBeNull();
    expect(checkSnapshot({ ...good(), regs: ['G-FU1CK'] })).toBeNull();
  });

  it('leaves the words to the Worker when a viewer reads one', () => {
    expect(checkSnapshot({ ...good(), regs: ['G-FUCK'] }, false)).not.toBeNull();
    expect(checkSnapshot({ ...good(), regs: ['<b>'] }, false)).toBeNull();
  });

  it('drops any field it doesn’t know', () => {
    expect(checkSnapshot({ ...good(), cash: 5, note: 'hi' })).toEqual(good());
  });

  it('allows an airline with no flights, and a flight with no number', () => {
    expect(checkSnapshot({ v: 1, models: [], regs: [], flights: [] })).not.toBeNull();
    expect(checkSnapshot(withFlight(['LHR', 'JFK', 600, 480, 5, 0, 0, '', 0]))).not.toBeNull();
  });
});
