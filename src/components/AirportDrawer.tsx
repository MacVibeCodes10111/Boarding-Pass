import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../ui/icons';
import { calcBlockTimeMin, calcDistanceNm } from '../game/geo';
import { formatNavaidFreq, getActiveRunwayForAirport, getAirportRunways, getAirportWeather } from '../game/navdata';
import {
  buildDispatchLegs,
  calcAircraftScheduleUsage,
  findScheduleConflict,
  flightsForTail,
  getAircraftLocationAtTime,
  getAircraftCircuitStatus,
  planCloseLoop,
  planPingPong,
  planRouteDispatch,
  type PlanResult,
  type RoutingMode,
} from '../game/scheduling';
import { airportRestrictionFor, calcHubPurchasePriceUsd, calcHubSaleRefundUsd, getAirportMaxAircraftTier } from '../game/tiers';
import { formatClockShort, formatMoneyM } from '../game/time';
import type { Airport, Fares, PlayerAircraft, ScheduledFlight, WeekDays } from '../game/types';
import { Button, C, DayPicker, Field, Pill, SectionTitle, Segmented, inputStyle, glass } from '../ui/kit';
import { ErrorBanner, FaresEditor } from './AircraftScheduleModal';
import { RouteDemandBar } from './RouteDemandBar';
import { ScheduleTimeline } from './ScheduleTimeline';

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
  onClose,
}: AirportDrawerProps) {
  const [acSearch, setAcSearch] = useState('');
  const [showWx, setShowWx] = useState(false);
  const isHub = hubs.includes(airport.iata_code);
  const tierInfo = getAirportMaxAircraftTier(airport.max_runway_length_ft);

  const origin = airportByIata.get(draft.originIata) ?? null;
  const aircraft = fleet.find((f) => f.tailNumber === draft.tailNumber) ?? null;
  const routeValid = Boolean(origin && origin.iata_code !== airport.iata_code);
  const distanceNm = origin && routeValid ? calcDistanceNm(origin, airport) : 0;
  const blockMin = distanceNm > 0 ? calcBlockTimeMin(distanceNm, aircraft?.model.cruise_speed_kts ?? 450) : 0;

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
  const runways = getAirportRunways(airport);

  const originOptions = Array.from(new Set([...hubs, draft.originIata, ...schedule.map((s) => s.destination.iata_code)]));
  const attachedRoutes = schedule.filter((s) => s.origin.iata_code === airport.iata_code || s.destination.iata_code === airport.iata_code);
  const loopArgs = aircraft ? { aircraft, schedule, hubs, airlineIata, airportByIata } : null;
  const dispatchDisabled = !dispatchRequest || Boolean(liveConflict);

  const lastOf = (ac: PlayerAircraft) => getAircraftCircuitStatus(ac, schedule).currentEndIata;

  // Aircraft ranked for this route (from the departure airport you chose):
  // ones that can fly it, are parked there at departure time and still have
  // time in their day come first, least used at the top.
  const ranked = useMemo(() => {
    return fleet
      .map((ac) => {
        const usage = calcAircraftScheduleUsage(ac, schedule);
        const hasFlights = flightsForTail(schedule, ac.tailNumber).length > 0;
        // Aircraft without flights can start anywhere; others are where their last leg before departure ended
        const where = hasFlights ? getAircraftLocationAtTime(ac, schedule, draft.depMin) : null;
        const atOrigin = !hasFlights || where === draft.originIata;
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
        return { ac, usage, from: hasFlights ? location : `${ac.hubIata} (free)`, reason, atOrigin };
      })
      .sort(
        (a, b) =>
          Number(Boolean(a.reason)) - Number(Boolean(b.reason)) ||
          Number(!a.atOrigin) - Number(!b.atOrigin) ||
          a.usage.usedPct - b.usage.usedPct ||
          a.ac.tailNumber.localeCompare(b.ac.tailNumber)
      );
  }, [fleet, schedule, airport, airportByIata, origin, draft.mode, draft.originIata, draft.depMin]);

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

  const filteredFleet = ranked.filter(({ ac }) => {
    const q = acSearch.trim().toLowerCase();
    return !q || ac.tailNumber === draft.tailNumber || ac.tailNumber.toLowerCase().includes(q) || ac.model.name.toLowerCase().includes(q);
  });

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
          <button type="button" aria-label="Close" onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: 4 }}>
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
            {wx.conditionLabel}, {wx.tempC}°C. Wind {String(wx.windDirDeg).padStart(3, '0')}° {wx.windSpeedKts} kt{wx.gustKts ? ` gusting ${wx.gustKts}` : ''}. Landing {actRwy.ident}.
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

      {/* Route planner */}
      <div style={{ padding: '14px 18px 18px' }}>
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 12 }}>
          {routeValid ? `New route to ${airport.iata_code}` : `Plan a route from ${airport.iata_code}`}
          {routeValid && distanceNm > 0 && (
            <span className="num" style={{ fontSize: 12.5, color: C.muted, fontWeight: 500 }}>
              {' '}
              {distanceNm.toLocaleString()} nm
            </span>
          )}
        </div>

        {fleet.length === 0 ? (
          <div style={{ fontSize: 12.5, color: C.muted, padding: '12px', border: `1px dashed ${C.border}`, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ flex: 1 }}>You need an aircraft before you can schedule flights.</span>
            <Button size="sm" variant="primary" onClick={onBuyAircraft}>
              Buy aircraft
            </Button>
          </div>
        ) : (
          <>
            <Field label="Aircraft" hint="Least used first. Aircraft that can't fly this route are listed last." style={{ marginBottom: 10 }}>
              {fleet.length > 5 && (
                <input
                  placeholder="Search tail number or aircraft type"
                  value={acSearch}
                  onChange={(e) => setAcSearch(e.target.value)}
                  style={{ ...inputStyle, marginBottom: 6 }}
                />
              )}
              <select value={draft.tailNumber} onChange={(e) => onPickAircraft(e.target.value)} style={{ ...inputStyle, fontWeight: 600 }}>
                {filteredFleet.map(({ ac, usage, from, reason, atOrigin }) => (
                  <option key={ac.tailNumber} value={ac.tailNumber}>
                    {ac.tailNumber}, {ac.model.name}, at {from}, {usage.usedPct}% used{reason ? ` (${reason})` : !atOrigin ? ` (not at ${draft.originIata})` : ''}
                  </option>
                ))}
              </select>
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 10, marginBottom: 10 }}>
              <Field label="From" hint={aircraft && acFlights.length > 0 ? `${aircraft.tailNumber} is at ${lastOf(aircraft)} at the end of its day` : undefined}>
                <select value={draft.originIata} onChange={(e) => updateDraft({ originIata: e.target.value })} style={{ ...inputStyle }}>
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
              </Field>
              <Field label="Flight number">
                <input
                  value={draft.flightNumber}
                  onChange={(e) => updateDraft({ flightNumber: e.target.value.toUpperCase() })}
                  style={{ ...inputStyle, fontWeight: 600, color: C.brand }}
                />
              </Field>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <Segmented<RoutingMode>
                value={draft.mode}
                onChange={(mode) => updateDraft({ mode })}
                options={[
                  { value: 'roundtrip', label: 'Round trip', title: 'Fly out and straight back' },
                  { value: 'chain', label: 'One way', title: 'Fly one leg and continue from the destination next' },
                ]}
              />
              <span style={{ fontSize: 12, color: C.muted }}>
                {draft.mode === 'roundtrip' ? `${draft.originIata} → ${airport.iata_code} → ${draft.originIata}` : `Continue from ${airport.iata_code} next (+15% passengers on A→B→C chains)`}
              </span>
            </div>

            {origin && routeValid && (
              <RouteDemandBar origin={origin} destination={airport} distanceNm={distanceNm} playerHubs={hubs} allSchedule={schedule} fleet={fleet} compact />
            )}

            <Field label="Days" style={{ marginBottom: 12 }}>
              <DayPicker days={draft.days} onChange={(days) => updateDraft({ days })} />
            </Field>

            {aircraft && circuit && !circuit.isClosedLoop && loopArgs && (
              <div style={{ padding: '10px 12px', borderRadius: 8, border: `1px solid ${C.amber}55`, background: `${C.amber}12`, marginBottom: 12 }}>
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

            {aircraft && (
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
              />
            )}

            {liveConflict && <ErrorBanner message={liveConflict} />}
            {!liveConflict && liveWarning && (
              <div style={{ display: 'flex', gap: 6, fontSize: 12.5, color: C.amber, marginBottom: 10 }}>
                <Icon name="warning" size={15} />
                {liveWarning}
              </div>
            )}

            <details style={{ marginBottom: 14 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13, color: C.textSoft, padding: '4px 0' }}>
                Fares{' '}
                <span className="num" style={{ color: C.muted, fontSize: 12 }}>
                  {aircraft?.model.is_cargo ? `$${draft.fares.cargoPerTon}/t` : `economy $${draft.fares.econ}, business $${draft.fares.bus}`}
                </span>
              </summary>
              <div style={{ paddingTop: 8 }}>
                <FaresEditor fares={draft.fares} onChange={(fares) => updateDraft({ fares })} cargoOnly={Boolean(aircraft?.model.is_cargo)} />
                <div style={{ fontSize: 11.5, color: C.faint, marginTop: 6 }}>Set to the market rate for this route. Higher fares sell fewer seats.</div>
              </div>
            </details>

            <Button
              variant="primary"
              size="lg"
              block
              disabled={dispatchDisabled}
              onClick={() => dispatchRequest && onPlanResult(planRouteDispatch(dispatchRequest))}
            >
              {draft.mode === 'roundtrip' ? `Schedule round trip ${draft.originIata}–${airport.iata_code}` : `Schedule ${draft.originIata} → ${airport.iata_code}`}
            </Button>
          </>
        )}

        {attachedRoutes.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <SectionTitle>Your flights here ({attachedRoutes.length})</SectionTitle>
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden' }}>
              {attachedRoutes.map((fl, i) => (
                <button
                  key={fl.id}
                  type="button"
                  className="bp-row"
                  onClick={() => onOpenSchedule(fl.tailNumber, fl.id)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    gap: 10,
                    alignItems: 'center',
                    padding: '7px 10px',
                    textAlign: 'left',
                    border: 'none',
                    borderTop: i ? `1px solid ${C.line}` : 'none',
                    background: 'transparent',
                    color: C.text,
                    cursor: 'pointer',
                    fontSize: 12.5,
                  }}
                >
                  <span className="num" style={{ color: C.brand, width: 64 }}>
                    {fl.flightNumber}
                  </span>
                  <span style={{ flex: 1 }}>
                    {fl.origin.iata_code} → {fl.destination.iata_code}
                  </span>
                  <span className="num" style={{ color: C.muted }}>
                    {formatClockShort(fl.depTimeMin)} {fl.tailNumber}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
