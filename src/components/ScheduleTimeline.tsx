import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { calcAircraftScheduleUsage, getAircraftCircuitStatus } from '../game/scheduling';
import { DAY_NAMES_SHORT, MIN_PER_DAY, daysOrAll, formatClockShort, formatDurationHm, shiftDays, snapToFiveMin } from '../game/time';
import type { PlayerAircraft, ScheduledFlight, WeekDays } from '../game/types';
import { C } from '../ui/kit';
import { Icon } from '../ui/icons';
import { airportLocalClock } from '../game/localTime';

export interface ScheduleTimelineProps {
  aircraft: PlayerAircraft;
  /** Flights already assigned to this aircraft. */
  existingFlights: ScheduledFlight[];
  selectedDepMin: number;
  onChangeDepMin: (newDepMin: number) => void;
  candidateBlockMin: number;
  candidateDays: WeekDays;
  autoRoundtrip?: boolean;
  editingFlightId?: string | null;
  onSelectExistingFlight?: (flight: ScheduledFlight) => void;
  conflictMessage?: string | null;
  originIata?: string;
  destIata?: string;
  /**
   * The aircraft's other flights as thin bars along the bottom, not clickable,
   * so the whole week stays easy to drag on (the route planner). The detailed
   * view (the aircraft's schedule window) shows them full size.
   */
  othersCompact?: boolean;
  /** Shows a "Detailed view" button (opens the aircraft's schedule). */
  onDetailedView?: () => void;
  /** Just the week chart: the time controls and flight times live elsewhere (route planner, v2.58). */
  chartOnly?: boolean;
}

interface Piece {
  dayIdx: number;
  start: number;
  end: number;
  kind: 'flight' | 'turn';
}

/** Splits an absolute interval (minutes from 00:00 of `dayIdx`) into per-day pieces. */
function splitAcrossDays(dayIdx: number, start: number, end: number, kind: Piece['kind']): Piece[] {
  const pieces: Piece[] = [];
  for (let k = Math.floor(start / MIN_PER_DAY); k * MIN_PER_DAY < end; k++) {
    const s = Math.max(start, k * MIN_PER_DAY) - k * MIN_PER_DAY;
    const e = Math.min(end, (k + 1) * MIN_PER_DAY) - k * MIN_PER_DAY;
    if (e > s) pieces.push({ dayIdx: (dayIdx + k) % 7, start: s, end: e, kind });
  }
  return pieces;
}

function legPieces(depMin: number, blockMin: number, turnMin: number, days: WeekDays): Piece[] {
  return days.flatMap((active, d) =>
    active
      ? [
          ...splitAcrossDays(d, depMin, depMin + blockMin, 'flight'),
          ...splitAcrossDays(d, depMin + blockMin, depMin + blockMin + turnMin, 'turn'),
        ]
      : []
  );
}

const pct = (min: number) => `${(min / MIN_PER_DAY) * 100}%`;

function StepButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="num"
      style={{ padding: '4px 7px', background: C.raised, color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 5, fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
    >
      {label}
    </button>
  );
}

/** 7-day × 24h block chart with a draggable departure playhead (5-minute snapping). */
export function ScheduleTimeline({
  aircraft,
  existingFlights,
  selectedDepMin,
  onChangeDepMin,
  candidateBlockMin,
  candidateDays,
  autoRoundtrip = false,
  editingFlightId = null,
  onSelectExistingFlight,
  conflictMessage = null,
  originIata = '???',
  destIata = '???',
  othersCompact = false,
  onDetailedView,
  chartOnly = false,
}: ScheduleTimelineProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  // Track width, so labels only go on blocks wide enough to read
  const [trackW, setTrackW] = useState(600);
  useEffect(() => {
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setTrackW(Math.max(100, el.getBoundingClientRect().width - 42)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fits = (min: number, label: string) => (min / MIN_PER_DAY) * trackW >= label.length * 6.2 + 8;
  const turnMin = aircraft.model.turnaround_min;
  const hh = Math.floor(selectedDepMin / 60);
  const mm = selectedDepMin % 60;

  const circuit = useMemo(() => getAircraftCircuitStatus(aircraft, existingFlights), [aircraft, existingFlights]);
  const usage = useMemo(() => calcAircraftScheduleUsage(aircraft, existingFlights), [aircraft, existingFlights]);

  // --- Candidate legs ------------------------------------------------------
  const outArrMin = (selectedDepMin + candidateBlockMin) % MIN_PER_DAY;
  const retAbs = Math.ceil((selectedDepMin + candidateBlockMin + turnMin) / 5) * 5;
  const retDepMin = retAbs % MIN_PER_DAY;
  const retArrMin = (retDepMin + candidateBlockMin) % MIN_PER_DAY;
  const readyMin = autoRoundtrip ? (retArrMin + turnMin) % MIN_PER_DAY : (outArrMin + turnMin) % MIN_PER_DAY;

  const candidatePieces = useMemo(() => {
    if (candidateBlockMin <= 0) return [];
    const out = legPieces(selectedDepMin, candidateBlockMin, turnMin, candidateDays).map((p) => ({ ...p, isReturn: false }));
    if (!autoRoundtrip) return out;
    const retDays = shiftDays(candidateDays, Math.floor(retAbs / MIN_PER_DAY));
    const ret = legPieces(retDepMin, candidateBlockMin, turnMin, retDays).map((p) => ({ ...p, isReturn: true }));
    return [...out, ...ret];
  }, [selectedDepMin, candidateBlockMin, turnMin, candidateDays, autoRoundtrip, retAbs, retDepMin]);

  const occupiedPieces = useMemo(
    () =>
      existingFlights
        .filter((fl) => fl.id !== editingFlightId)
        .flatMap((fl) => {
          const isOpenChainEnd = !circuit.isClosedLoop && circuit.lastFlight?.id === fl.id;
          return legPieces(fl.depTimeMin, fl.blockTimeMin, turnMin, daysOrAll(fl.daysOfWeek)).map((p) => ({ ...p, flight: fl, isOpenChainEnd }));
        }),
    [existingFlights, editingFlightId, turnMin, circuit]
  );

  // --- Dragging (pointer capture keeps the drag alive outside the track) ------
  const setFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const relX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    onChangeDepMin(snapToFiveMin((relX / rect.width) * MIN_PER_DAY));
  };

  const hasConflict = Boolean(conflictMessage);
  const outLabel = `${originIata}→${destIata}`;
  // Local times at each end (v2.55)
  const depLocal = airportLocalClock(selectedDepMin, originIata);
  const retLabel = `${destIata}→${originIata}`;

  return (
    <div
      style={{
        background: C.bg,
        border: `1px solid ${C.line}`,
        borderRadius: 8,
        padding: chartOnly ? '8px 8px 10px' : 12,
        marginBottom: chartOnly ? 0 : 12,
        userSelect: 'none',
      }}
    >
      {!chartOnly && (
      <>
      {/* Header: title and how booked the aircraft is, the detailed view in the corner (v2.56: tidier) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 650 }}>Departure time</div>
          <div className="num" style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>
            {aircraft.tailNumber}: {usage.usedPct}% booked, {usage.avgDailyHours} h a day
          </div>
        </div>
        {onDetailedView && (
          <button
            type="button"
            className="bp-detail-btn"
            onClick={onDetailedView}
            title={`${aircraft.tailNumber}'s whole week: every flight, its demand and fares`}
            style={{
              flex: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              borderRadius: 9,
              cursor: 'pointer',
              fontSize: 12.5,
              fontWeight: 600,
              color: C.text,
              background: C.raised,
              border: `1px solid ${C.accent}88`,
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08), 0 2px 0 rgba(0,0,0,.3)',
              whiteSpace: 'nowrap',
            }}
          >
            <Icon name="schedule" size={14} color={C.accent} />
            Detailed view
          </button>
        )}
      </div>

      {/* Time picker, with the local departure time underneath */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginBottom: 12 }}>
        <StepButton label="−1h" onClick={() => onChangeDepMin(snapToFiveMin(selectedDepMin - 60))} />
        <StepButton label="−5m" onClick={() => onChangeDepMin(snapToFiveMin(selectedDepMin - 5))} />
        <div style={{ display: 'grid', justifyItems: 'center', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', background: C.bg, border: `1px solid ${C.brand}88`, borderRadius: 6, padding: '3px 8px' }}>
            <TimePart value={hh} max={23} onCommit={(h) => onChangeDepMin(snapToFiveMin(h * 60 + mm))} />
            <span style={{ color: C.brand, fontWeight: 700 }}>:</span>
            <TimePart value={mm} max={59} step={5} onCommit={(m) => onChangeDepMin(snapToFiveMin(hh * 60 + m))} />
            <span style={{ fontSize: 11, color: C.faint, marginLeft: 4 }}>UTC</span>
          </div>
          {depLocal && (
            <span className="num" style={{ fontSize: 11, color: C.muted }} title={`Local time at ${originIata}`}>
              {depLocal} local at {originIata}
            </span>
          )}
        </div>
        <StepButton label="+5m" onClick={() => onChangeDepMin(snapToFiveMin(selectedDepMin + 5))} />
        <StepButton label="+1h" onClick={() => onChangeDepMin(snapToFiveMin(selectedDepMin + 60))} />
      </div>

      {/* The new flight(s) as a small table: route, UTC, local */}
      {candidateBlockMin > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div
            className="num"
            style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr', columnGap: 14, rowGap: 3, fontSize: 12.5, alignItems: 'baseline' }}
          >
            <span />
            <span style={{ fontSize: 10.5, color: C.faint, textTransform: 'uppercase', letterSpacing: '.05em' }}>UTC</span>
            <span style={{ fontSize: 10.5, color: C.faint, textTransform: 'uppercase', letterSpacing: '.05em' }}>Local</span>
            {[
              { label: outLabel, dep: selectedDepMin, arr: outArrMin, from: originIata, to: destIata },
              ...(autoRoundtrip ? [{ label: retLabel, dep: retDepMin, arr: retArrMin, from: destIata, to: originIata }] : []),
            ].map((l) => {
              const d = airportLocalClock(l.dep, l.from);
              const a = airportLocalClock(l.arr, l.to);
              return (
                <Fragment key={l.label}>
                  <b style={{ color: C.brand, fontWeight: 650 }}>{l.label}</b>
                  <span style={{ color: C.text }}>
                    {formatClockShort(l.dep)}–{formatClockShort(l.arr)}
                  </span>
                  <span style={{ color: C.textDim }} title={`Departs ${d ?? '?'} at ${l.from}, arrives ${a ?? '?'} at ${l.to}, local times`}>
                    {d || a ? `${d ?? '–'}–${a ?? '–'}` : '–'}
                  </span>
                </Fragment>
              );
            })}
          </div>
          <div className="num" style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>
            {formatDurationHm(candidateBlockMin)} each way · {turnMin} min turnaround · free again {formatClockShort(readyMin)} UTC
          </div>
        </div>
      )}

      </>
      )}

      {/* Hour scale */}
      <div style={{ display: 'grid', gridTemplateColumns: '42px 1fr', alignItems: 'center', marginBottom: 4 }}>
        <div />
        <div className="num" style={{ position: 'relative', height: 14, fontSize: 10.5, color: C.faint }}>
          {[0, 6, 12, 18, 24].map((h) => (
            <span
              key={h}
              style={{
                position: 'absolute',
                left: `${(h / 24) * 100}%`,
                transform: h === 0 ? 'none' : h === 24 ? 'translateX(-100%)' : 'translateX(-50%)',
              }}
            >
              {String(h).padStart(2, '0')}:00
            </span>
          ))}
        </div>
      </div>

      {/* 7-day track matrix */}
      <div
        ref={trackRef}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          setFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if ((e.currentTarget as HTMLDivElement).hasPointerCapture(e.pointerId)) setFromClientX(e.clientX);
        }}
        style={{ position: 'relative', cursor: 'ew-resize', display: 'flex', flexDirection: 'column', gap: 4, touchAction: 'none' }}
      >
        {DAY_NAMES_SHORT.map((dayName, dIdx) => (
          <div key={dayName} style={{ display: 'grid', gridTemplateColumns: '42px 1fr', alignItems: 'center', height: othersCompact || chartOnly ? 26 : 22 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: candidateDays[dIdx] ? C.textSoft : C.faint }}>{dayName}</div>
            <div style={{ position: 'relative', height: '100%', background: C.panel, border: `1px solid ${C.line}`, borderRadius: 4, overflow: 'hidden' }}>
              {[3, 6, 9, 12, 15, 18, 21].map((h) => (
                <div key={h} style={{ position: 'absolute', left: `${(h / 24) * 100}%`, top: 0, bottom: 0, width: 1, background: `${C.border}80`, pointerEvents: 'none' }} />
              ))}

              {occupiedPieces
                .filter((p) => p.dayIdx === dIdx)
                .map((p, i) => {
                  const label = `${p.flight.origin.iata_code}→${p.flight.destination.iata_code}`;
                  const title = `${p.flight.flightNumber}: ${label} (${formatClockShort(p.flight.depTimeMin)}–${formatClockShort(p.flight.arrTimeMin)} UTC)${p.isOpenChainEnd ? ', the aircraft ends its day here' : ''}`;
                  if (othersCompact)
                    return (
                      <div
                        key={`occ-${p.flight.id}-${i}`}
                        title={title}
                        style={{
                          position: 'absolute',
                          left: pct(p.start),
                          width: pct(p.end - p.start),
                          bottom: 2,
                          height: p.kind === 'flight' ? 5 : 3,
                          borderRadius: 2,
                          background: p.kind === 'flight' ? OTHER_FLIGHT : OTHER_TURN,
                          zIndex: 1,
                          pointerEvents: 'none',
                        }}
                      />
                    );
                  return p.kind === 'flight' ? (
                    <div
                      key={`occ-${p.flight.id}-${i}`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => onSelectExistingFlight?.(p.flight)}
                      title={title}
                      style={{
                        ...blockStyle(p.start, p.end, 2),
                        background: OTHER_FLIGHT,
                        boxShadow: p.isOpenChainEnd ? `inset 0 0 0 1px ${C.amber}` : undefined,
                        color: C.text,
                        zIndex: 2,
                        cursor: onSelectExistingFlight ? 'pointer' : 'default',
                      }}
                    >
                      {fits(p.end - p.start, label) ? label : ''}
                    </div>
                  ) : (
                    <div key={`occt-${p.flight.id}-${i}`} style={{ ...blockStyle(p.start, p.end, 2), background: OTHER_TURN, zIndex: 1, pointerEvents: 'none' }} />
                  );
                })}

              {candidatePieces
                .filter((p) => p.dayIdx === dIdx)
                .map((p, i) => {
                  const label = p.isReturn ? retLabel : outLabel;
                  const base = hasConflict ? C.red : C.brand;
                  return p.kind === 'flight' ? (
                    <div
                      key={`cand-${i}`}
                      style={{
                        ...blockStyle(p.start, p.end, othersCompact ? 1 : 1),
                        bottom: othersCompact ? 9 : 1,
                        background: base,
                        color: hasConflict ? '#fff' : C.brandInk,
                        zIndex: 4,
                        pointerEvents: 'none',
                      }}
                    >
                      {fits(p.end - p.start, label) ? label : ''}
                    </div>
                  ) : (
                    <div
                      key={`candt-${i}`}
                      style={{ ...blockStyle(p.start, p.end, 1), bottom: othersCompact ? 9 : 1, background: `${base}55`, zIndex: 3, pointerEvents: 'none' }}
                    />
                  );
                })}

              <div style={{ position: 'absolute', left: pct(selectedDepMin), top: 0, bottom: 0, width: 2, background: C.text, zIndex: 6, pointerEvents: 'none' }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>
        {othersCompact ? 'Drag across the week or type a time. Grey bars are its other flights.' : 'Drag across the week or type a time. Click a grey flight to edit it.'}
      </div>
    </div>
  );
}

/** The aircraft's other flights: one grey, lighter for the turnaround after each. */
const OTHER_FLIGHT = 'rgba(148, 163, 184, 0.55)';
const OTHER_TURN = 'rgba(148, 163, 184, 0.2)';

function blockStyle(start: number, end: number, inset: number): React.CSSProperties {
  return {
    position: 'absolute',
    left: pct(start),
    width: pct(end - start),
    top: inset,
    bottom: inset,
    borderRadius: 3,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 9.5,
    fontWeight: 600,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
  };
}

/** Two-digit hour/minute box that accepts free typing and commits on blur/Enter. */
function TimePart({ value, max, step, onCommit }: { value: number; max: number; step?: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value).padStart(2, '0'));
  useEffect(() => setDraft(String(value).padStart(2, '0')), [value]);
  const commit = () => {
    const v = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(v)) setDraft(String(value).padStart(2, '0'));
    else {
      const clamped = Math.max(0, Math.min(max, Math.round(v)));
      setDraft(String(clamped).padStart(2, '0'));
      onCommit(clamped);
    }
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      maxLength={2}
      value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'ArrowUp') onCommit(Math.min(max, value + (step ?? 1)));
        if (e.key === 'ArrowDown') onCommit(Math.max(0, value - (step ?? 1)));
      }}
      style={{ width: 24, background: 'transparent', color: C.text, border: 'none', textAlign: 'center', fontWeight: 650, fontSize: 14, padding: 0, outline: 'none' }}
    />
  );
}

/** A UTC time of day as HH:MM with 5-minute steps (route planner, v2.58). */
export function ClockInput({ value, onChange, label }: { value: number; onChange: (min: number) => void; label: string }) {
  const hh = Math.floor(value / 60);
  const mm = value % 60;
  const step = (d: number) => onChange(snapToFiveMin(value + d));
  const btn = (text: string, d: number, aria: string) => (
    <button
      type="button"
      aria-label={aria}
      onClick={() => step(d)}
      style={{ width: 26, height: 30, borderRadius: 6, border: `1px solid ${C.border}`, background: C.raised, color: C.textSoft, cursor: 'pointer', fontSize: 14, padding: 0, flex: 'none' }}
    >
      {text}
    </button>
  );
  return (
    <span role="group" aria-label={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      {btn('−', -5, `${label}, 5 minutes earlier`)}
      <span style={{ display: 'inline-flex', alignItems: 'center', background: C.bg, border: `1px solid ${C.brand}88`, borderRadius: 6, padding: '3px 6px', height: 30, boxSizing: 'border-box' }}>
        <TimePart value={hh} max={23} onCommit={(h) => onChange(snapToFiveMin(h * 60 + mm))} />
        <span style={{ color: C.brand, fontWeight: 700 }}>:</span>
        <TimePart value={mm} max={59} step={5} onCommit={(m) => onChange(snapToFiveMin(hh * 60 + m))} />
      </span>
      {btn('+', 5, `${label}, 5 minutes later`)}
    </span>
  );
}
