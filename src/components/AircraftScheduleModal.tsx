import { useEffect, useMemo, useState } from 'react';
import { getRouteDemandAndFares } from '../game/economics';
import { calcAircraftScheduleUsage, findScheduleConflict, flightsForTail, isFlightNumberTaken } from '../game/scheduling';
import { calcAircraftResaleUsd, getAircraftTierInfo } from '../game/tiers';
import { MIN_PER_DAY, daysOrAll, formatClockShort, formatDurationHm, formatMoneyM, snapToFiveMin } from '../game/time';
import type { Fares, PlayerAircraft, ScheduledFlight, WeekDays } from '../game/types';
import { Button, C, DayPicker, ModalShell, NumberField, inputStyle, labelStyle } from '../ui/kit';
import { Icon } from '../ui/icons';
import { RouteDemandBar } from './RouteDemandBar';
import { ScheduleTimeline } from './ScheduleTimeline';

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
}

export function AircraftScheduleModal({
  aircraft,
  allSchedule,
  playerHubs,
  fleet,
  initialSelectedFlightId,
  radarIconUrl,
  onClose,
  onUpdateFlight,
  onDeleteFlight,
  onSellOrReturnAircraft,
}: AircraftScheduleModalProps) {
  const acFlights = useMemo(() => flightsForTail(allSchedule, aircraft.tailNumber), [allSchedule, aircraft.tailNumber]);
  const [selectedFlId, setSelectedFlId] = useState<string | null>(initialSelectedFlightId ?? null);
  const selectedFlight = acFlights.find((f) => f.id === selectedFlId) ?? acFlights[0] ?? null;

  const [editFlightNum, setEditFlightNum] = useState('');
  const [editDepMin, setEditDepMin] = useState(480);
  const [editDays, setEditDays] = useState<WeekDays>(daysOrAll(null));
  const [editFares, setEditFares] = useState<Fares>({ econ: 120, prem: 220, bus: 480, first: 950, cargoPerTon: 400 });

  // Load the editor fields only when a *different* flight is selected,
  // so unrelated schedule changes don't wipe what you're typing.
  const selectedId = selectedFlight?.id;
  useEffect(() => {
    if (!selectedFlight) return;
    setEditFlightNum(selectedFlight.flightNumber);
    setEditDepMin(snapToFiveMin(selectedFlight.depTimeMin));
    setEditDays([...daysOrAll(selectedFlight.daysOfWeek)]);
    const { refFares } = getRouteDemandAndFares(selectedFlight.origin, selectedFlight.destination, selectedFlight.distanceNm, playerHubs, allSchedule);
    setEditFares({ ...selectedFlight.fares, cargoPerTon: selectedFlight.fares.cargoPerTon || refFares.cargoPerTon });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

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
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 14, borderBottom: `1px solid ${C.line}`, marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src={radarIconUrl} alt="" style={{ width: 40, height: 40 }} />
          <div>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 650 }}>
              {aircraft.tailNumber} <span style={{ color: C.muted, fontWeight: 500 }}>{aircraft.model.name}</span>
            </h2>
            <div className="num" style={{ fontSize: 12.5, color: C.muted, marginTop: 3 }}>
              {tierInfo.sizeLabel}
              {isCargo ? `, freighter ${aircraft.model.cargo_cap_tons} t` : ''}. Based at {aircraft.hubIata}, {aircraft.model.turnaround_min} min turnaround. {usage.usedPct}% booked ({usage.avgDailyHours} h a day).
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button variant="ghost" onClick={() => onSellOrReturnAircraft(aircraft.tailNumber)}>
            {aircraft.acquisition === 'owned' ? `Sell for ${formatMoneyM(calcAircraftResaleUsd(aircraft.model))}` : 'Return to lessor'}
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>

      {/* Leg selector */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          Flights <span style={{ color: C.muted, fontWeight: 500 }}>{acFlights.length ? 'Pick one to edit' : ''}</span>
        </div>
        {acFlights.length === 0 ? (
          <div style={{ padding: 16, background: C.bg, borderRadius: 8, color: C.faint, fontSize: 12, textAlign: 'center' }}>
            {aircraft.tailNumber} has no flights yet. Click an airport on the map to plan one.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {acFlights.map((fl) => {
              const isSel = selectedFlight?.id === fl.id;
              const isPartner = pairedFlight?.id === fl.id;
              return (
                <button
                  key={fl.id}
                  type="button"
                  onClick={() => setSelectedFlId(fl.id)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: `1px solid ${isSel ? C.brand : isPartner ? C.accent : C.border}`,
                    background: isSel ? C.raised : C.bg,
                    color: C.text,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    <span style={{ color: isSel ? C.brand : C.textDim }}>{fl.flightNumber}</span> {fl.origin.iata_code} → {fl.destination.iata_code}
                  </div>
                  <div className="num" style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>
                    {formatClockShort(fl.depTimeMin)}–{formatClockShort(fl.arrTimeMin)} UTC ({formatDurationHm(fl.blockTimeMin)})
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
          />

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
          <div className="bp-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, background: C.bg, padding: 14, borderRadius: 8, border: `1px solid ${C.line}` }}>
            <div>
              <label style={{ ...labelStyle }}>Flight number</label>
              <input value={editFlightNum} onChange={(e) => setEditFlightNum(e.target.value)} style={{ ...inputStyle, marginBottom: 10, fontWeight: 700 }} />
              <label style={{ ...labelStyle }}>Days</label>
              <DayPicker days={editDays} onChange={setEditDays} />
            </div>

            <div>
              <label style={{ ...labelStyle }}>{isCargo ? 'Freight rate ($ per tonne)' : 'Fares ($) and cargo rate ($ per tonne)'}</label>
              <FaresEditor fares={editFares} onChange={setEditFares} cargoOnly={isCargo} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
            <Button variant="ghost" onClick={() => onDeleteFlight(selectedFlight.id)}>
              {pairedFlight ? `Delete ${selectedFlight.flightNumber} and ${pairedFlight.flightNumber}` : `Delete ${selectedFlight.flightNumber}`}
            </Button>
            <Button variant="primary" size="lg" disabled={Boolean(conflictMsg)} onClick={handleSave}>
              Save changes
            </Button>
          </div>
        </>
      )}
    </ModalShell>
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
        background: `${C.red}18`,
        border: `1px solid ${C.red}66`,
        borderRadius: 8,
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

/** Fare inputs for the four cabins plus cargo rate. */
export function FaresEditor({ fares, onChange, cargoOnly }: { fares: Fares; onChange: (f: Fares) => void; cargoOnly: boolean }) {
  const classes = cargoOnly ? [] : (['econ', 'prem', 'bus', 'first'] as const);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: cargoOnly ? '160px' : 'repeat(5, 1fr)', gap: 8 }}>
      {classes.map((k) => (
        <label key={k} style={{ display: 'block' }}>
          <span style={{ display: 'block', fontSize: 11.5, color: C.muted, marginBottom: 3 }}>{FARE_LABELS[k]}</span>
          <NumberField value={fares[k]} min={10} onChange={(v) => onChange({ ...fares, [k]: v })} />
        </label>
      ))}
      <label style={{ display: 'block' }}>
        <span style={{ display: 'block', fontSize: 11.5, color: C.muted, marginBottom: 3 }}>Cargo $/t</span>
        <NumberField value={fares.cargoPerTon ?? 350} min={25} onChange={(v) => onChange({ ...fares, cargoPerTon: v })} />
      </label>
    </div>
  );
}
