import { useEffect, useMemo, useState } from 'react';
import { MAX_FARE_MULT, getRouteDemandAndFares, simulateFlightEconomics } from '../game/economics';
import { COST_LINES, ageFactor } from '../game/costs';
import { calcAircraftScheduleUsage, findScheduleConflict, flightsForTail, isFlightNumberTaken } from '../game/scheduling';
import { airportRestrictionFor, calcAircraftResaleUsd, getAircraftTierInfo } from '../game/tiers';
import { MIN_PER_DAY, daysOrAll, formatClockShort, formatDurationHm, formatMoneyM, snapToFiveMin } from '../game/time';
import type { Fares, PlayerAircraft, ScheduledFlight, WeekDays } from '../game/types';
import { Button, C, DayPicker, ModalShell, NumberField, SectionTitle, face, inputStyle, labelStyle, well } from '../ui/kit';
import { Icon } from '../ui/icons';
import { AircraftHero } from './AircraftPhoto';
import { aircraftGateCode } from '../game/gateCode';
import { RouteDemandBar } from './RouteDemandBar';
import { ScheduleTimeline } from './ScheduleTimeline';
import { legLocalText } from '../game/localTime';

export interface AircraftScheduleModalProps {
  aircraft: PlayerAircraft;
  allSchedule: ScheduledFlight[];
  playerHubs: string[];
  fleet: PlayerAircraft[];
  initialSelectedFlightId?: string | null;
  radarIconUrl: string;
  onClose: () => void;
  onUpdateFlight: (updated: ScheduledFlight) => void;
  onDeleteFlight: (flightId: string) => void;
  onSellOrReturnAircraft: (tailNumber: string) => void;
  /** Sell it to another airline on the marketplace (only when that's possible). */
  onMarketSell?: (tailNumber: string) => void;
  /** The airline's liveries by name (v2.66): with two, the aircraft can wear either. */
  liveryNames?: string[];
  onSetLivery?: (tailNumber: string, index: number) => void;
  /** Opens the livery editor on this aircraft's livery. */
  onEditLivery?: (index: number) => void;
  /** The subsidiary it flies for, if any: it wears that brand's livery. */
  brandName?: string;
  /** The airline's logo, shown beside the registration. */
  airlineLogo?: string;
}

export function AircraftScheduleModal({
  aircraft,
  allSchedule,
  playerHubs,
  fleet,
  initialSelectedFlightId,
  onClose,
  onUpdateFlight,
  onDeleteFlight,
  onSellOrReturnAircraft,
  onMarketSell,
  liveryNames = [],
  onSetLivery,
  onEditLivery,
  brandName,
  airlineLogo,
}: AircraftScheduleModalProps) {
  const acFlights = useMemo(() => flightsForTail(allSchedule, aircraft.tailNumber), [allSchedule, aircraft.tailNumber]);
  const [selectedFlId, setSelectedFlId] = useState<string | null>(initialSelectedFlightId ?? null);
  const selectedFlight = acFlights.find((f) => f.id === selectedFlId) ?? acFlights[0] ?? null;

  const [editFlightNum, setEditFlightNum] = useState('');
  const [editDepMin, setEditDepMin] = useState(480);
  const [editDays, setEditDays] = useState<WeekDays>(daysOrAll(null));
  const [editFares, setEditFares] = useState<Fares>({ econ: 120, prem: 220, bus: 480, first: 950, cargoPerTon: 400, parcelPerTon: 850 });

  // Load the editor fields only when a *different* flight is selected,
  // so unrelated schedule changes don't wipe what you're typing.
  const selectedId = selectedFlight?.id;
  useEffect(() => {
    if (!selectedFlight) return;
    setEditFlightNum(selectedFlight.flightNumber);
    setEditDepMin(snapToFiveMin(selectedFlight.depTimeMin));
    setEditDays([...daysOrAll(selectedFlight.daysOfWeek)]);
    const { refFares } = getRouteDemandAndFares(selectedFlight.origin, selectedFlight.destination, selectedFlight.distanceNm, playerHubs, allSchedule);
    setEditFares({ ...selectedFlight.fares, cargoPerTon: selectedFlight.fares.cargoPerTon || refFares.cargoPerTon, parcelPerTon: selectedFlight.fares.parcelPerTon || refFares.parcelPerTon });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const refFares = useMemo(
    () => (selectedFlight ? getRouteDemandAndFares(selectedFlight.origin, selectedFlight.destination, selectedFlight.distanceNm).refFares : undefined),
    [selectedFlight]
  );

  const pairedFlight = useMemo(() => {
    if (!selectedFlight?.pairId) return null;
    return acFlights.find((f) => f.pairId === selectedFlight.pairId && f.id !== selectedFlight.id) ?? null;
  }, [acFlights, selectedFlight]);

  const conflictMsg = useMemo(() => {
    if (!selectedFlight) return null;
    if (!editDays.some(Boolean)) return 'Select at least 1 operating day.';
    const fn = editFlightNum.trim().toUpperCase();
    if (!fn) return 'Flight number cannot be empty.';
    if (isFlightNumberTaken(allSchedule, fn, selectedFlight.id)) return `${fn} is already used by another flight.`;
    return findScheduleConflict(
      acFlights,
      [
        {
          flightNumber: fn,
          depTimeMin: editDepMin,
          blockTimeMin: selectedFlight.blockTimeMin,
          daysOfWeek: editDays,
          originIata: selectedFlight.origin.iata_code,
          destIata: selectedFlight.destination.iata_code,
        },
      ],
      aircraft.model.turnaround_min,
      [selectedFlight.id]
    );
  }, [selectedFlight, acFlights, allSchedule, editFlightNum, editDepMin, editDays, aircraft]);

  const handleSave = () => {
    if (!selectedFlight || conflictMsg) return;
    onUpdateFlight({
      ...selectedFlight,
      flightNumber: editFlightNum.trim().toUpperCase(),
      depTimeMin: editDepMin,
      arrTimeMin: (editDepMin + selectedFlight.blockTimeMin) % MIN_PER_DAY,
      daysOfWeek: [...editDays],
      fares: { ...editFares },
    });
  };

  const tierInfo = getAircraftTierInfo(aircraft.model.tier);
  const usage = calcAircraftScheduleUsage(aircraft, acFlights);
  const isCargo = aircraft.model.is_cargo;

  return (
    <ModalShell onClose={onClose}>
      <AircraftHero model={aircraft.model} tailNumber={aircraft.tailNumber} liveryIndex={aircraft.livery} brand={aircraft.brand} style={{ marginBottom: 14 }} />
      {/* Header: what it is, then the few things you can do with it */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: '10px 12px' }}>
        {airlineLogo && <img src={airlineLogo} alt="" style={{ width: 40, height: 40, borderRadius: 10, background: '#fff', padding: 3, objectFit: 'contain', boxSizing: 'border-box' }} />}
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, lineHeight: 1.15 }}>
            {aircraft.tailNumber} <span style={{ color: C.muted, fontWeight: 600 }}>{aircraft.model.name}</span>
          </h2>
          <div className="num" title={`${tierInfo.sizeLabel}, ICAO Code ${aircraftGateCode(aircraft.model)}, ${aircraft.model.turnaround_min} min turnaround`} style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
            {brandName ? `${brandName} · ` : ''}
            {aircraft.hubIata} · {usage.usedPct}% used · {usage.avgDailyHours} h a day
            {isCargo ? ` · ${aircraft.model.cargo_cap_tons} t` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {liveryNames.length > 1 && onSetLivery && !brandName && (
            <select
              aria-label="Livery this aircraft wears"
              value={Math.min(aircraft.livery ?? 0, liveryNames.length - 1)}
              onChange={(e) => onSetLivery(aircraft.tailNumber, Number(e.target.value))}
              style={{ ...inputStyle, width: 'auto', padding: '6px 8px', fontSize: 13 }}
            >
              {liveryNames.map((n, i) => (
                <option key={i} value={i}>
                  {n}
                </option>
              ))}
            </select>
          )}
          {onEditLivery && (
            <Button variant="ghost" onClick={() => onEditLivery(Math.min(aircraft.livery ?? 0, Math.max(0, liveryNames.length - 1)))}>
              Livery
            </Button>
          )}
          {onMarketSell && (
            <Button variant="ghost" disabled={acFlights.length > 0} onClick={() => onMarketSell(aircraft.tailNumber)} title={acFlights.length ? 'Remove its flights first' : 'Sell it to another airline'}>
              Market
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={aircraft.acquisition === 'owned' && acFlights.length > 0}
            title={aircraft.acquisition === 'owned' && acFlights.length > 0 ? 'Remove its flights first' : undefined}
            onClick={() => onSellOrReturnAircraft(aircraft.tailNumber)}
          >
            {aircraft.acquisition === 'owned' ? `Sell · ${formatMoneyM(calcAircraftResaleUsd(aircraft.model))}` : 'Return'}
          </Button>
        </div>
      </div>

      {/* Leg selector */}
      <div style={{ marginBottom: 14 }}>
        <SectionTitle>Flights</SectionTitle>
        {acFlights.length === 0 ? (
          <div style={{ padding: 18, background: well(), borderRadius: 14, color: C.muted, fontSize: 13, textAlign: 'center' }}>
            No flights yet. Tap an airport on the map.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {acFlights.map((fl) => {
              const isSel = selectedFlight?.id === fl.id;
              const isPartner = pairedFlight?.id === fl.id;
              // scheduled before the ICAO size codes (v2.65): it keeps flying, but can't be added again
              const tooBig = airportRestrictionFor(aircraft.model, fl.origin) ?? airportRestrictionFor(aircraft.model, fl.destination);
              return (
                <button
                  key={fl.id}
                  type="button"
                  onClick={() => setSelectedFlId(fl.id)}
                  aria-pressed={isSel}
                  title={legLocalText(fl.depTimeMin, fl.arrTimeMin, fl.origin.iata_code, fl.destination.iata_code) || undefined}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: `1px solid ${isSel ? C.brand : 'transparent'}`,
                    background: isSel ? `${C.brand}1c` : isPartner ? face() : well(),
                    color: C.text,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    <span style={{ color: isSel ? C.brand : C.textDim }}>{fl.flightNumber}</span> {fl.origin.iata_code} → {fl.destination.iata_code}
                  </div>
                  {tooBig && (
                    <div title={`${tooBig}. It keeps flying, but a new flight like it can't be scheduled.`} style={{ fontSize: 11.5, color: C.amber, marginTop: 2 }}>
                      Too big for the airport
                    </div>
                  )}
                  <div className="num" style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>
                    {formatClockShort(fl.depTimeMin)}–{formatClockShort(fl.arrTimeMin)} UTC · {formatDurationHm(fl.blockTimeMin)}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selectedFlight && (
        <>
          <RouteDemandBar
            origin={selectedFlight.origin}
            destination={selectedFlight.destination}
            distanceNm={selectedFlight.distanceNm}
            playerHubs={playerHubs}
            allSchedule={allSchedule}
            fleet={fleet}
            aircraft={aircraft}
          />
          <FlightMoney flight={selectedFlight} aircraft={aircraft} allSchedule={allSchedule} fleet={fleet} playerHubs={playerHubs} />

          <ScheduleTimeline
            aircraft={aircraft}
            existingFlights={acFlights}
            selectedDepMin={editDepMin}
            onChangeDepMin={setEditDepMin}
            candidateBlockMin={selectedFlight.blockTimeMin}
            candidateDays={editDays}
            editingFlightId={selectedFlight.id}
            onSelectExistingFlight={(fl) => setSelectedFlId(fl.id)}
            conflictMessage={conflictMsg}
            originIata={selectedFlight.origin.iata_code}
            destIata={selectedFlight.destination.iata_code}
          />

          {conflictMsg && <ErrorBanner message={conflictMsg} />}

          {/* Edit form */}
          <div className="bp-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, background: well(), padding: 14, borderRadius: 14 }}>
            <div>
              <label style={{ ...labelStyle }}>Flight number</label>
              <input value={editFlightNum} onChange={(e) => setEditFlightNum(e.target.value)} style={{ ...inputStyle, marginBottom: 10, fontWeight: 700 }} />
              <label style={{ ...labelStyle }}>Days</label>
              <DayPicker days={editDays} onChange={setEditDays} />
            </div>

            <div>
              <label style={{ ...labelStyle }}>{isCargo ? 'Cargo rates' : 'Fares'}</label>
              <FaresEditor fares={editFares} onChange={setEditFares} cargoOnly={isCargo} refFares={refFares} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
            <Button variant="ghost" onClick={() => onDeleteFlight(selectedFlight.id)}>
              {pairedFlight ? `Delete ${selectedFlight.flightNumber} and ${pairedFlight.flightNumber}` : `Delete ${selectedFlight.flightNumber}`}
            </Button>
            <Button variant="primary" size="lg" disabled={Boolean(conflictMsg)} onClick={handleSave}>
              Save
            </Button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

/** What one departure of the flight earns and costs, with the five cost lines. */
function FlightMoney({ flight, aircraft, allSchedule, fleet, playerHubs }: { flight: ScheduledFlight; aircraft: PlayerAircraft; allSchedule: ScheduledFlight[]; fleet: PlayerAircraft[]; playerHubs: string[] }) {
  const e = useMemo(() => simulateFlightEconomics(flight, aircraft, { hubs: playerHubs, schedule: allSchedule, fleet }), [flight, aircraft, allSchedule, fleet, playerHubs]);
  const usd = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString()}`;
  const older = ageFactor(aircraft.model) > 1.3;
  const line = (k: string, v: string, opts: { strong?: boolean; color?: string; note?: string } = {}) => (
    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, padding: '2px 0', fontWeight: opts.strong ? 650 : 400 }}>
      <span style={{ color: opts.strong ? C.text : C.textDim }}>
        {k}
        {opts.note && <span style={{ color: C.amber, fontSize: 11.5 }}> · {opts.note}</span>}
      </span>
      <span className="num" style={{ color: opts.color ?? (opts.strong ? C.text : C.muted) }}>{v}</span>
    </div>
  );
  return (
    <div style={{ borderTop: `1px solid ${C.line}`, padding: '10px 0 0', marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
        Each {flight.flightNumber} departure
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', columnGap: 24 }}>
        <div>
          {!aircraft.model.is_cargo && line('Tickets', usd(e.paxRevenue))}
          {line('Small parcels', usd(e.parcelRevenue))}
          {aircraft.model.is_cargo && line('Big parcels', usd(e.freightRevenue))}
          {line('Revenue', usd(e.revenue), { strong: true })}
        </div>
        <div>
          {COST_LINES.filter((c) => !(c.key === 'service' && aircraft.model.is_cargo)).map((c) =>
            line(c.label, usd(-e.costs[c.key]), c.key === 'maintenance' && older ? { note: 'Older design: costs more to maintain.' } : {})
          )}
          {line('Costs', usd(-e.cost), { strong: true })}
        </div>
      </div>
      <div style={{ marginTop: 4 }}>{line('Profit before lease rent', usd(e.profit), { strong: true, color: e.profit >= 0 ? C.green : C.red })}</div>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        gap: 8,
        padding: '8px 12px',
        background: `${C.red}1c`,
        borderRadius: 10,
        color: C.redSoft,
        fontSize: 12.5,
        marginBottom: 12,
      }}
    >
      <Icon name="warning" size={15} style={{ marginTop: 1 }} />
      <span>{message}</span>
    </div>
  );
}

const FARE_LABELS = { econ: 'Economy', prem: 'Premium', bus: 'Business', first: 'First' } as const;

/** Fare inputs for the four cabins plus the small-parcel rate (and the big-parcel rate on a freighter). */
export function FaresEditor({ fares, onChange, cargoOnly, refFares }: { fares: Fares; onChange: (f: Fares) => void; cargoOnly: boolean; refFares?: Fares }) {
  const classes = cargoOnly ? [] : (['econ', 'prem', 'bus', 'first'] as const);
  // Nobody buys at three times the market fare; the box stops at five times it
  const cap = (ref: number | undefined) => (ref ? Math.round(ref * MAX_FARE_MULT) : undefined);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: cargoOnly ? 'repeat(2, minmax(0, 160px))' : 'repeat(auto-fit, minmax(92px, 1fr))', gap: 8 }}>
      {classes.map((k) => (
        <label key={k} style={{ display: 'block' }}>
          <span style={{ display: 'block', fontSize: 11.5, color: C.muted, marginBottom: 3 }}>{FARE_LABELS[k]}</span>
          <NumberField value={fares[k]} min={10} max={cap(refFares?.[k])} onChange={(v) => onChange({ ...fares, [k]: v })} />
        </label>
      ))}
      <label style={{ display: 'block' }}>
        <span style={{ display: 'block', fontSize: 11.5, color: C.muted, marginBottom: 3 }}>Small parcels $/t</span>
        <NumberField value={fares.parcelPerTon ?? refFares?.parcelPerTon ?? 800} min={25} max={cap(refFares?.parcelPerTon)} onChange={(v) => onChange({ ...fares, parcelPerTon: v })} />
      </label>
      {cargoOnly && (
        <label style={{ display: 'block' }}>
          <span style={{ display: 'block', fontSize: 11.5, color: C.muted, marginBottom: 3 }}>Big parcels $/t</span>
          <NumberField value={fares.cargoPerTon ?? refFares?.cargoPerTon ?? 350} min={25} max={cap(refFares?.cargoPerTon)} onChange={(v) => onChange({ ...fares, cargoPerTon: v })} />
        </label>
      )}
    </div>
  );
}
