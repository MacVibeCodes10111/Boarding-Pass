import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { AircraftScheduleModal } from './AircraftScheduleModal';
import { BUILTIN_AIRCRAFT } from '../game/aircraftCatalog';
import { BUILTIN_AIRPORTS } from '../game/builtinData';
import type { PlayerAircraft, ScheduledFlight } from '../game/types';

describe('aircraft schedule window (smoke)', () => {
  it('shows a round trip with the move choice and the clear button', () => {
    const model = BUILTIN_AIRCRAFT.find((m) => !m.is_cargo)!;
    const [a, b] = BUILTIN_AIRPORTS;
    const ac = { tailNumber: 'N1TS', model, acquisition: 'owned', hubIata: a.iata_code, cabin: { econ: 150, prem: 0, bus: 12, first: 0 } } as unknown as PlayerAircraft;
    const fares = { econ: 100, prem: 200, bus: 400, first: 800, cargoPerTon: 300, parcelPerTon: 800 };
    const leg = (id: string, fn: string, o: typeof a, d: typeof a, dep: number): ScheduledFlight => ({
      id, pairId: 'P1', flightNumber: fn, tailNumber: ac.tailNumber, origin: o, destination: d, depTimeMin: dep, arrTimeMin: dep + 120, distanceNm: 500, blockTimeMin: 120, daysOfWeek: [true, true, true, true, true, true, true], fares,
    });
    const schedule = [leg('f1', 'TS1', a, b, 480), leg('f2', 'TS2', b, a, 720)];
    const html = renderToString(
      <AircraftScheduleModal
        aircraft={ac} allSchedule={schedule} playerHubs={[a.iata_code]} fleet={[ac]} initialSelectedFlightId="f1" radarIconUrl=""
        onClose={() => undefined} onUpdateFlight={() => undefined} onDeleteFlight={() => undefined} onDeleteFlights={() => undefined} onSellOrReturnAircraft={() => undefined}
      />
    );
    expect(html).toContain('Round trip with');
    expect(html).toContain('Move both');
    expect(html).toContain('Clear schedule');
    expect(html).toContain('Save both');
  });
});
