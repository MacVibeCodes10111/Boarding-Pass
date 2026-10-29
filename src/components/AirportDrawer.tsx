import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../ui/icons';
import { calcBlockTimeMin, calcDistanceNm } from '../game/geo';
import { formatNavaidFreq, getActiveRunwayForAirport, getAirportRunways, getAirportWeather, runwayLanes } from '../game/navdata';
import {
  buildDispatchLegs,
  calcAircraftScheduleUsage,
  findScheduleConflict,
  flightsForTail,
  aircraftAwayOnDays,
  getAircraftCircuitStatus,
  nextFreeFlightNumber,
  returnFlightNumber,
  planCloseLoop,
  planPingPong,
  planRouteDispatch,
  type PlanResult,
  type RoutingMode,
} from '../game/scheduling';
import { airportRestrictionFor, calcHubPurchasePriceUsd, calcHubSaleRefundUsd, getAirportMaxAircraftTier } from '../game/tiers';
import { formatClockShort, formatDurationHm, formatMoneyM } from '../game/time';
import type { AircraftModel, Airport, Fares, PlayerAircraft, ScheduledFlight, WeekDays } from '../game/types';
import { Button, C, DayPicker, Pill, Segmented, Stepper, inputStyle, glass } from '../ui/kit';
import { ErrorBanner, FaresEditor } from './AircraftScheduleModal';
import { RouteDemandBar } from './RouteDemandBar';
import { getRouteDemandAndFares } from '../game/economics';
import { planBulkDispatch, type BulkScheduleResult } from '../game/fleetOps';
import { ClockInput, ScheduleTimeline } from './ScheduleTimeline';
import { airportLocalClock } from '../game/localTime';
import { AircraftPicker, cabinText, freeHours, type PickerRow } from './AircraftPicker';

/** Everything the player is currently composing in the route builder. */
export interface RouteDraft {
  originIata: string;
  tailNumber: string;
  flightNumber: string;
  depMin: number;
  days: WeekDays;
  mode: RoutingMode;
  fares: Fares;
}

export interface AirportDrawerProps {
  airport: Airport;
  airportByIata: Map<string, Airport>;
  hubs: string[];
  fleet: PlayerAircraft[];
  schedule: ScheduledFlight[];
  /** Real-UTC map clock (weather & active runway follow real time). */
  simDay: number;
  simMin: number;
  dayOfMonth?: number;
  airlineIata: string;
  draft: RouteDraft;
  updateDraft: (patch: Partial<RouteDraft>) => void;
  onPlanResult: (result: PlanResult) => void;
  onBuyHub: (airport: Airport) => void;
  onSellHub: (airport: Airport) => void;
  onOpenSchedule: (tailNumber: string, flightId: string | null) => void;
  /** You picked an aircraft: it also moves the departure airport to where that aircraft is. */
  onPickAircraft: (tailNumber: string) => void;
  onBuyAircraft: () => void;
  /** Several aircraft scheduled together on this route (from Fleet). */
  bulkTails?: string[] | null;
  onBulkPlan?: (r: BulkScheduleResult) => void;
  onEndBulk?: () => void;
  /** Opens the Schedule page showing this airport's flights (v2.58). */
  onShowFlightsHere?: (iata: string) => void;
  iconForModel?: (m: AircraftModel) => string;
  onClose: () => void;
}

export function AirportDrawer({
  airport,
  airportByIata,
  hubs,
  fleet,
  schedule,
  simDay,
  simMin,
  dayOfMonth,
  airlineIata,
  draft,
  updateDraft,
  onPlanResult,
  onBuyHub,
  onSellHub,
  onOpenSchedule,
  onPickAircraft,
  onBuyAircraft,
  bulkTails,
  onBulkPlan,
  onEndBulk,
  onShowFlightsHere,
  iconForModel,
  onClose,
}: AirportDrawerProps) {
  const bulk = useMemo(() => (bulkTails ? fleet.filter((a) => bulkTails.includes(a.tailNumber)) : []), [bulkTails, fleet]);
  const [spacing, setSpacing] = useState(60);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    setPicking(false);
  }, [airport.iata_code]);
  const [showWx, setShowWx] = useState(false);
  const isHub = hubs.includes(airport.iata_code);
  const tierInfo = getAirportMaxAircraftTier(airport.max_runway_length_ft);

  const origin = airportByIata.get(draft.originIata) ?? null;
  const aircraft = fleet.find((f) => f.tailNumber === draft.tailNumber) ?? null;
  const routeValid = Boolean(origin && origin.iata_code !== airport.iata_code);
  const distanceNm = origin && routeValid ? calcDistanceNm(origin, airport) : 0;
  const blockMin = distanceNm > 0 ? calcBlockTimeMin(distanceNm, aircraft?.model.cruise_speed_kts ?? 450) : 0;
  const refFares = useMemo(() => (origin && routeValid ? getRouteDemandAndFares(origin, airport, distanceNm).refFares : null), [origin, airport, distanceNm, routeValid]);

  // Long-haul gets the low numbers, short hops four digits (see registrations.ts)
  const suggestedNumber = useMemo(
    () => nextFreeFlightNumber(schedule, airlineIata, [], distanceNm || undefined, draft.mode === 'roundtrip'),
    [schedule, airlineIata, distanceNm, draft.mode]
  );
  const acFlights = useMemo(() => (aircraft ? flightsForTail(schedule, aircraft.tailNumber) : []), [schedule, aircraft]);
  const circuit = useMemo(() => (aircraft ? getAircraftCircuitStatus(aircraft, schedule) : null), [aircraft, schedule]);

  const dispatchRequest = aircraft && origin && routeValid
    ? {
        aircraft,
        schedule,
        hubs,
        origin,
        destination: airport,
        depMin: draft.depMin,
        days: draft.days,
        mode: draft.mode,
        flightNumber: draft.flightNumber,
        airlineIata,
        fares: draft.fares,
      }
    : null;

  const liveConflict = useMemo(() => {
    if (!dispatchRequest || !draft.days.some(Boolean)) return null;
    const { legs } = buildDispatchLegs(dispatchRequest);
    return findScheduleConflict(acFlights, legs, dispatchRequest.aircraft.model.turnaround_min);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aircraft, origin, airport, draft.depMin, draft.days, draft.mode, acFlights]);

  const liveWarning = useMemo(() => {
    if (!aircraft || !origin || !routeValid) return null;
    if (distanceNm > aircraft.model.range_nm) return `Out of range: ${distanceNm.toLocaleString()} nm > ${aircraft.model.range_nm.toLocaleString()} nm`;
    return airportRestrictionFor(aircraft.model, origin) ?? airportRestrictionFor(aircraft.model, airport);
  }, [aircraft, origin, airport, routeValid, distanceNm]);

  const wx = getAirportWeather(airport, simDay, simMin, dayOfMonth);
  const actRwy = getActiveRunwayForAirport(airport, simDay, simMin);
  // Runways in use: landings, and takeoffs (busy airports use several of each)
  const inUse = (purpose: 'arrival' | 'departure', n: number) =>
    [...new Set(Array.from({ length: n }, (_, l) => getActiveRunwayForAirport(airport, simDay, simMin, purpose, l).ident))].join(', ');
  const lanes = runwayLanes(airport);
  const landingRwys = inUse('arrival', lanes.arr);
  const takeoffRwys = inUse('departure', lanes.dep);
  const runways = getAirportRunways(airport);

  const originOptions = Array.from(new Set([...hubs, draft.originIata, ...schedule.map((s) => s.destination.iata_code)]));
  const attachedRoutes = schedule.filter((s) => s.origin.iata_code === airport.iata_code || s.destination.iata_code === airport.iata_code);
  const loopArgs = aircraft ? { aircraft, schedule, hubs, airlineIata, airportByIata } : null;
  const dispatchDisabled = !dispatchRequest || Boolean(liveConflict);

  // Aircraft ranked for this route (from the departure airport you chose):
  // ones that can fly it, are parked there at departure time and still have
  // time in their day come first, least used at the top.
  const ranked = useMemo(() => {
    return fleet
      .map((ac) => {
        const usage = calcAircraftScheduleUsage(ac, schedule);
        const hasFlights = flightsForTail(schedule, ac.tailNumber).length > 0;
        // Aircraft without flights can start anywhere; others are where their last leg before departure ended
        // Week-aware: it must be at the departure airport on every day picked
        const away = hasFlights ? aircraftAwayOnDays(ac, schedule, draft.depMin, draft.days, draft.originIata) : null;
        const where = hasFlights ? (away?.at ?? draft.originIata) : null;
        const atOrigin = !hasFlights || !away;
        const routeFrom = origin ?? airportByIata.get(ac.hubIata) ?? null;
        const from = routeFrom;
        const dist = from && from.iata_code !== airport.iata_code ? calcDistanceNm(from, airport) : 0;
        const legMin = dist > 0 ? calcBlockTimeMin(dist, ac.model.cruise_speed_kts) + ac.model.turnaround_min : 0;
        const neededMin = draft.mode === 'roundtrip' ? legMin * 2 : legMin;
        const freeMin = Math.max(0, 1440 - usage.weeklyOccupiedMin / 7);
        const reason =
          dist > ac.model.range_nm
            ? 'out of range'
            : (from && airportRestrictionFor(ac.model, from)) || airportRestrictionFor(ac.model, airport)
            ? 'runway too short'
            : neededMin > freeMin
            ? 'no time left'
            : null;
        const location = where ?? ac.hubIata;
        const ends = [draft.originIata, airport.iata_code];
        const attached =
          ends.includes(ac.hubIata) ||
          flightsForTail(schedule, ac.tailNumber).some((f) => ends.includes(f.origin.iata_code) || ends.includes(f.destination.iata_code));
        return { ac, usage, from: hasFlights ? location : `${ac.hubIata} (free)`, reason, atOrigin, attached } as PickerRow;
      })
      .sort(
        (a, b) =>
          Number(Boolean(a.reason)) - Number(Boolean(b.reason)) ||
          Number(!a.atOrigin) - Number(!b.atOrigin) ||
          a.usage.usedPct - b.usage.usedPct ||
          a.ac.tailNumber.localeCompare(b.ac.tailNumber)
      );
  }, [fleet, schedule, airport, airportByIata, origin, draft.mode, draft.originIata, draft.depMin, draft.days]);

  // Keep the aircraft you were scheduling if it can still fly this route from
  // here; otherwise switch to the least-used one that can and is parked at your
  // departure airport. This only changes the aircraft, never the airport you
  // chose to fly from.
  useEffect(() => {
    if (ranked.length === 0) return;
    const current = ranked.find((r) => r.ac.tailNumber === draft.tailNumber);
    if (current && !current.reason && current.atOrigin) return;
    const best = ranked.find((r) => !r.reason && r.atOrigin);
    if (best && best.ac.tailNumber !== draft.tailNumber) updateDraft({ tailNumber: best.ac.tailNumber });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airport.iata_code, draft.originIata, schedule.length, fleet.length]);

  // Times for the flights table
  const legTimes = useMemo(() => {
    const turnMin = aircraft?.model.turnaround_min ?? 45;
    const outArr = (draft.depMin + blockMin) % 1440;
    const retAbs = Math.ceil((draft.depMin + blockMin + turnMin) / 5) * 5;
    const retDep = retAbs % 1440;
    return { turnMin, outArr, retDep, retArr: (retDep + blockMin) % 1440 };
  }, [aircraft, draft.depMin, blockMin]);
  const returnNumber = useMemo(
    () => returnFlightNumber(schedule, airlineIata, draft.flightNumber.trim().toUpperCase() || suggestedNumber, distanceNm || undefined),
    [schedule, airlineIata, draft.flightNumber, suggestedNumber, distanceNm]
  );
  const card: React.CSSProperties = { padding: 12, borderRadius: 12, border: `1px solid ${C.line}`, background: C.bg };
  const summaryStyle: React.CSSProperties = { cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 650, listStyle: 'none' };

  const pickedRow = ranked.find((r) => r.ac.tailNumber === draft.tailNumber);

  return (
    <aside
      aria-label={`${airport.iata_code} airport`}
      className="bp-drawer"
      style={{
        position: 'absolute',
        top: 'var(--bp-top-h)',
        right: 'var(--bp-gap)',
        bottom: 'var(--bp-bottom-h)',
        width: 'min(440px, calc(100vw - 2 * var(--bp-gap) - 24px))',
        overscrollBehavior: 'contain',
        ...glass('ee'),
        borderRadius: 16,
        overflowY: 'auto',
        zIndex: 35,
        animation: 'bp-fade-in .14s ease-out',
      }}
    >
      {/* Header */}
      <div style={{ padding: '16px 18px 12px', borderBottom: `1px solid ${C.line}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em', color: isHub ? C.brand : C.text }}>{airport.iata_code}</span>
              <span style={{ fontSize: 13, color: C.muted }}>{airport.icao_code}</span>
              {isHub && <Pill color={C.brand}>Your hub</Pill>}
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 2 }}>
              {airport.municipality}, {airport.iso_country}
            </div>
            <div style={{ fontSize: 12, color: C.muted }}>
              {airport.name}. Up to {tierInfo.sizeLabel.toLowerCase()} aircraft ({airport.max_runway_length_ft.toLocaleString()} ft runway).
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ background: C.raised, border: `1px solid ${C.border}`, color: C.textSoft, cursor: 'pointer', width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', padding: 0, flex: 'none' }}>
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* Weather, one line; details on demand */}
        <button
          type="button"
          onClick={() => setShowWx((v) => !v)}
          aria-expanded={showWx}
          style={{
            marginTop: 10,
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 10px',
            borderRadius: 8,
            background: C.bg,
            border: `1px solid ${C.line}`,
            color: C.textDim,
            fontSize: 12.5,
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <span style={{ fontWeight: 650, color: wx.categoryColor }}>{wx.categoryBadge}</span>
          <span style={{ flex: 1 }} className="num">
            {wx.conditionLabel}, {wx.tempC}°C. Wind {String(wx.windDirDeg).padStart(3, '0')}° {wx.windSpeedKts} kt{wx.gustKts ? ` gusting ${wx.gustKts}` : ''}. Landing {landingRwys}
            {takeoffRwys !== landingRwys ? `, taking off ${takeoffRwys}` : ''}.
          </span>
          <Icon name="chevron" size={14} style={{ transform: showWx ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }} />
        </button>
        {showWx && (
          <div style={{ fontSize: 12, color: C.muted, padding: '8px 2px 0', lineHeight: 1.55 }}>
            <div>
              Approach: {actRwy.approachType}
              {actRwy.associatedNavaid
                ? ` via ${actRwy.associatedNavaid.ident} ${actRwy.associatedNavaid.type} ${formatNavaidFreq(actRwy.associatedNavaid.frequency_khz, actRwy.associatedNavaid.type)}`
                : ''}
            </div>
            <div className="num">Runways {runways.map((p) => `${p.le_ident}/${p.he_ident} ${p.length_ft.toLocaleString()} ft`).join(', ')}</div>
            <div className="num" style={{ marginTop: 4, color: C.faint, wordBreak: 'break-word' }}>
              {wx.metarRaw}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {!isHub ? (
            <Button size="sm" onClick={() => onBuyHub(airport)}>
              Buy as hub, {formatMoneyM(calcHubPurchasePriceUsd(airport))}
            </Button>
          ) : (
            <>
              {draft.originIata !== airport.iata_code && (
                <Button size="sm" onClick={() => updateDraft({ originIata: airport.iata_code })}>
                  Plan routes from here
                </Button>
              )}
              {hubs.length > 1 && (
                <Button size="sm" variant="ghost" onClick={() => onSellHub(airport)}>
                  Sell hub, +{formatMoneyM(calcHubSaleRefundUsd(airport))}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Route planner (reworked v2.58): route card, a flights table, the aircraft, extras folded, the button pinned */}
      <div style={{ padding: '14px 16px 0' }}>
        {picking && bulk.length === 0 && fleet.length > 0 ? (
          <div style={{ paddingBottom: 16 }}>
            <AircraftPicker
              rows={ranked}
              selected={draft.tailNumber}
              originIata={draft.originIata}
              routeLabel={`${draft.originIata} ${draft.mode === 'roundtrip' ? '⇄' : '→'} ${airport.iata_code}${routeValid ? `, ${formatDurationHm(blockMin)} each way` : ''}`}
              iconForModel={iconForModel}
              onPick={(tail) => {
                onPickAircraft(tail);
                setPicking(false);
              }}
              onBack={() => setPicking(false)}
            />
          </div>
        ) : fleet.length === 0 ? (
          <div style={{ fontSize: 13, color: C.muted, padding: 12, border: `1px dashed ${C.border}`, borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <span style={{ flex: 1 }}>Buy an aircraft to start flying routes.</span>
            <Button size="sm" variant="primary" onClick={onBuyAircraft}>
              Buy aircraft
            </Button>
          </div>
        ) : (
          <>
            {/* Route card */}
            <section aria-label="Route" style={{ ...card, marginBottom: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', alignItems: 'end', gap: 8 }}>
                <label style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 3 }}>From</span>
                  <select value={draft.originIata} onChange={(e) => updateDraft({ originIata: e.target.value })} style={{ ...inputStyle, fontWeight: 700, fontSize: 15, padding: '6px 8px' }}>
                    {originOptions.map((code) => {
                      const ap = airportByIata.get(code);
                      return ap ? (
                        <option key={code} value={code}>
                          {code} {ap.municipality}
                          {hubs.includes(code) ? ' (hub)' : ''}
                        </option>
                      ) : null;
                    })}
                  </select>
                </label>
                <span aria-hidden="true" style={{ color: C.muted, fontSize: 18, paddingBottom: 6 }}>
                  {draft.mode === 'roundtrip' ? '⇄' : '→'}
                </span>
                <div style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 3 }}>To</span>
                  <div style={{ fontWeight: 700, fontSize: 15, padding: '6px 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {airport.iata_code} <span style={{ fontWeight: 500, color: C.textDim }}>{airport.municipality}</span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                <Segmented<RoutingMode>
                  size="sm"
                  value={draft.mode}
                  onChange={(mode) => updateDraft({ mode })}
                  options={[
                    { value: 'roundtrip', label: 'Round trip', title: 'Fly out and straight back' },
                    { value: 'chain', label: 'One way', title: 'Fly one leg and continue from the destination next' },
                  ]}
                />
                {routeValid && (
                  <span className="num" style={{ fontSize: 12.5, color: C.muted }}>
                    {distanceNm.toLocaleString()} nm · {formatDurationHm(blockMin)} each way
                  </span>
                )}
              </div>
              {draft.mode === 'chain' && <div style={{ fontSize: 11.5, color: C.faint, marginTop: 6 }}>Continue from {airport.iata_code} next: +15% passengers on A→B→C chains.</div>}
              {origin && routeValid && (
                <div style={{ marginTop: 10 }}>
                  <RouteDemandBar origin={origin} destination={airport} distanceNm={distanceNm} playerHubs={hubs} allSchedule={schedule} fleet={fleet} compact />
                </div>
              )}
              {!routeValid && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 8 }}>Pick where to fly from, or tap another airport on the map.</div>}
            </section>

            {/* Flights table */}
            {routeValid && (
              <section aria-label="Flights" style={{ ...card, marginBottom: 10, padding: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: `1px solid ${C.line}`, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 650, flex: 1 }}>Flights</span>
                  <div style={{ flex: '0 1 252px', minWidth: 196 }}>
                    <DayPicker days={draft.days} onChange={(days) => updateDraft({ days })} />
                  </div>
                </div>
                <LegRow
                  number={
                    <input
                      value={draft.flightNumber}
                      placeholder={suggestedNumber}
                      aria-label={`Flight number, ${suggestedNumber} if left empty`}
                      onChange={(e) => updateDraft({ flightNumber: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                      style={{ ...inputStyle, width: 82, padding: '4px 6px', fontWeight: 700, color: C.brand }}
                    />
                  }
                  from={draft.originIata}
                  to={airport.iata_code}
                  dep={<ClockInput value={draft.depMin} onChange={(depMin) => updateDraft({ depMin })} label="Departure time" />}
                  depMin={draft.depMin}
                  arrMin={legTimes.outArr}
                  blockMin={blockMin}
                />
                {draft.mode === 'roundtrip' && (
                  <>
                    <div className="num" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 12px', fontSize: 12, color: C.muted, background: C.bg }}>
                      <span>Turnaround at {airport.iata_code}</span>
                      <span>{legTimes.turnMin} min</span>
                    </div>
                    <LegRow
                      number={
                        <span className="num" style={{ display: 'inline-block', width: 82, padding: '4px 6px', fontWeight: 700, color: C.brand }}>
                          {returnNumber}
                        </span>
                      }
                      from={airport.iata_code}
                      to={draft.originIata}
                      dep={<span className="num" style={{ fontWeight: 700, fontSize: 15 }}>{formatClockShort(legTimes.retDep)}</span>}
                      depMin={legTimes.retDep}
                      arrMin={legTimes.retArr}
                      blockMin={blockMin}
                    />
                  </>
                )}
                <div style={{ fontSize: 11, color: C.faint, padding: '6px 12px 10px' }}>Times are UTC, local time underneath.</div>
              </section>
            )}

            {/* Aircraft */}
            <section aria-label="Aircraft" style={{ ...card, marginBottom: 10 }}>
              {bulk.length > 0 ? (
                <div className="bp-bulk-box">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, fontSize: 13.5, fontWeight: 650 }}>{bulk.length} aircraft together</div>
                    <Button size="sm" variant="ghost" onClick={onEndBulk}>
                      Back to one
                    </Button>
                  </div>
                  <div className="num" style={{ fontSize: 12, color: C.muted, margin: '2px 0 8px' }}>
                    {bulk.map((a) => a.tailNumber).join(', ')}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: C.textDim, flexWrap: 'wrap' }}>
                    Each departs
                    <Stepper value={spacing} min={0} max={720} step={5} onChange={setSpacing} />
                    min after the one before
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 650, flex: 1 }}>Aircraft</span>
                    {aircraft && (
                      <button type="button" onClick={() => onOpenSchedule(aircraft.tailNumber, null)} style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: 0 }}>
                        Its week
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    className="bp-row"
                    aria-label={`Aircraft: ${aircraft ? `${aircraft.tailNumber}, ${aircraft.model.name}` : 'none'}. Change`}
                    onClick={(e) => {
                      setPicking(true);
                      (e.currentTarget.closest('aside') as HTMLElement | null)?.scrollTo({ top: 0 });
                    }}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.panel, color: C.text, cursor: 'pointer', textAlign: 'left' }}
                  >
                    {aircraft && iconForModel && <img src={iconForModel(aircraft.model)} alt="" style={{ width: 24, height: 24, flex: 'none' }} />}
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 650, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {aircraft ? `${aircraft.tailNumber} · ${aircraft.model.name}` : 'Choose an aircraft'}
                      </span>
                      {aircraft && pickedRow && (
                        <span className="num" style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 2 }}>
                          {cabinText(aircraft)} · {100 - pickedRow.usage.usedPct}% free ({freeHours(pickedRow)} h a week) · at {pickedRow.from.replace(' (free)', '')}
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: 12.5, color: C.accent, fontWeight: 600, whiteSpace: 'nowrap' }}>Change</span>
                    <Icon name="chevron" size={14} color={C.accent} />
                  </button>
                  {pickedRow?.reason && <div style={{ fontSize: 12, color: C.amber, marginTop: 6 }}>This one can’t fly the route: {pickedRow.reason}.</div>}
                </>
              )}
            </section>

            {aircraft && circuit && !circuit.isClosedLoop && loopArgs && (
              <div style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${C.amber}55`, background: `${C.amber}12`, marginBottom: 10 }}>
                <div style={{ fontSize: 12.5, color: C.amber, fontWeight: 600 }}>
                  {aircraft.tailNumber} ends its day at {circuit.currentEndIata}, not where it started ({circuit.startIata}).
                </div>
                <div style={{ fontSize: 12, color: C.muted, margin: '2px 0 8px' }}>{circuit.chainPath.join(' → ')}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Button size="sm" onClick={() => onPlanResult(planCloseLoop(loopArgs))}>
                    Fly straight back to {circuit.startIata}
                  </Button>
                  <Button size="sm" onClick={() => onPlanResult(planPingPong(loopArgs))}>
                    Retrace every stop
                  </Button>
                </div>
              </div>
            )}

            {liveConflict && <ErrorBanner message={liveConflict} />}
            {!liveConflict && liveWarning && (
              <div style={{ display: 'flex', gap: 6, fontSize: 12.5, color: C.amber, marginBottom: 10 }}>
                <Icon name="warning" size={15} />
                {liveWarning}
              </div>
            )}

            {/* Extras, folded */}
            {aircraft && routeValid && (
              <details style={{ ...card, marginBottom: 10 }}>
                <summary style={summaryStyle}>
                  <span style={{ flex: 1 }}>Week view</span>
                  <span className="num" style={{ fontSize: 12, color: liveConflict ? C.red : C.muted }}>
                    {liveConflict ? 'clashes' : `${aircraft.tailNumber} ${calcAircraftScheduleUsage(aircraft, schedule).usedPct}% booked`}
                  </span>
                </summary>
                <div style={{ marginTop: 10 }}>
                  <ScheduleTimeline
                    aircraft={aircraft}
                    existingFlights={acFlights}
                    selectedDepMin={draft.depMin}
                    onChangeDepMin={(depMin) => updateDraft({ depMin })}
                    candidateBlockMin={blockMin}
                    candidateDays={draft.days}
                    autoRoundtrip={draft.mode === 'roundtrip'}
                    onSelectExistingFlight={(fl) => onOpenSchedule(fl.tailNumber, fl.id)}
                    conflictMessage={liveConflict}
                    originIata={draft.originIata}
                    destIata={airport.iata_code}
                    chartOnly
                  />
                </div>
              </details>
            )}
            {routeValid && (
              <details style={{ ...card, marginBottom: 10 }}>
                <summary style={summaryStyle}>
                  <span style={{ flex: 1 }}>Fares</span>
                  <span className="num" style={{ fontSize: 12, color: C.muted }}>
                    {aircraft?.model.is_cargo ? `$${draft.fares.cargoPerTon}/t` : `economy $${draft.fares.econ}, business $${draft.fares.bus}`}
                  </span>
                </summary>
                <div style={{ paddingTop: 10 }}>
                  <FaresEditor fares={draft.fares} onChange={(fares) => updateDraft({ fares })} cargoOnly={Boolean(aircraft?.model.is_cargo)} refFares={refFares ?? undefined} />
                  <div style={{ fontSize: 11.5, color: C.faint, marginTop: 6 }}>Set to the market rate. Higher fares sell fewer seats; at three times the market rate nobody buys.</div>
                </div>
              </details>
            )}
          </>
        )}

        {!picking && attachedRoutes.length > 0 && onShowFlightsHere && (
          <button
            type="button"
            onClick={() => onShowFlightsHere(airport.iata_code)}
            style={{ ...card, width: '100%', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', color: C.text, textAlign: 'left', marginBottom: 12 }}
          >
            <Icon name="schedule" size={16} color={C.accent} />
            <span style={{ flex: 1, fontSize: 13 }}>
              {attachedRoutes.length} flight{attachedRoutes.length > 1 ? 's' : ''} at {airport.iata_code}
            </span>
            <span style={{ fontSize: 12.5, color: C.accent, fontWeight: 600 }}>Open in Schedule</span>
          </button>
        )}
      </div>

      {/* The button stays in reach at the bottom */}
      {fleet.length > 0 && !(picking && bulk.length === 0) && (
        <div style={{ position: 'sticky', bottom: 0, padding: '10px 16px calc(12px + env(safe-area-inset-bottom, 0px))', background: `linear-gradient(to top, ${C.panel} 80%, ${C.panel}00)`, zIndex: 30 }}>
          {bulk.length > 0 ? (
            <Button
              variant="primary"
              size="lg"
              block
              disabled={!dispatchRequest}
              onClick={() => {
                if (!dispatchRequest || !onBulkPlan) return;
                const { aircraft: _first, ...base } = dispatchRequest;
                onBulkPlan(planBulkDispatch(base, bulk, spacing));
              }}
            >
              Schedule {bulk.length} aircraft {draft.originIata}
              {draft.mode === 'roundtrip' ? '–' : ' → '}
              {airport.iata_code}
            </Button>
          ) : (
            <Button variant="primary" size="lg" block disabled={dispatchDisabled} onClick={() => dispatchRequest && onPlanResult(planRouteDispatch(dispatchRequest))}>
              {routeValid ? (draft.mode === 'roundtrip' ? `Schedule ${draft.originIata} ⇄ ${airport.iata_code}` : `Schedule ${draft.originIata} → ${airport.iata_code}`) : 'Pick where to fly from'}
            </Button>
          )}
        </div>
      )}
    </aside>
  );
}

/** One flight in the planner's table: number, route and time in the air, then departure and arrival. */
function LegRow(props: { number: React.ReactNode; from: string; to: string; dep: React.ReactNode; depMin: number; arrMin: number; blockMin: number }) {
  const depLocal = airportLocalClock(props.depMin, props.from);
  const arrLocal = airportLocalClock(props.arrMin, props.to);
  const label: React.CSSProperties = { display: 'block', fontSize: 11, color: C.muted, marginBottom: 3 };
  const small: React.CSSProperties = { display: 'block', fontSize: 11, color: C.muted, marginTop: 3 };
  return (
    <div className="bp-leg" style={{ padding: '10px 12px', borderTop: `1px solid ${C.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {props.number}
        <span style={{ fontWeight: 650, fontSize: 13.5, whiteSpace: 'nowrap', flex: 1 }}>
          {props.from} → {props.to}
        </span>
        <span className="num" style={{ fontSize: 12, color: C.muted }}>
          {formatDurationHm(props.blockMin)}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, auto) 1fr', gap: 16, alignItems: 'start' }}>
        <div>
          <span style={label}>Departs {props.from}</span>
          <div style={{ minHeight: 30, display: 'flex', alignItems: 'center' }}>{props.dep}</div>
          {depLocal && <span className="num" style={small}>{depLocal} local</span>}
        </div>
        <div>
          <span style={label}>Arrives {props.to}</span>
          <div className="num" style={{ minHeight: 30, display: 'flex', alignItems: 'center', fontWeight: 700, fontSize: 15, color: C.textSoft }}>
            {formatClockShort(props.arrMin)}
          </div>
          {arrLocal && <span className="num" style={small}>{arrLocal} local</span>}
        </div>
      </div>
    </div>
  );
}
