// ============================================================================
// STATS: your airline in numbers
//   Headline figures for one scheduled week, the weekly results so far, and
//   breakdowns of the fleet, network and routes. Charts are plain SVG.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { WeekLedger } from '../game/clock';
import type { FlightEconomics } from '../game/economics';
import { computeAirlineStats, type AirlineStats, type RouteStat, type Slice } from '../game/stats';
import type { Airport, PlayerAircraft, ScheduledFlight } from '../game/types';
import { Button, C, EmptyState, SidePanel } from '../ui/kit';

// Categorical colours, in a fixed order (checked for colour-blind separation on
// the panel background); "Other" is always grey.
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const OTHER = '#5f6b82';
const BAR = '#3987e5';
const sliceColor = (s: Slice, i: number) => (s.label === 'Other' ? OTHER : SERIES[i % SERIES.length]);

const num = (n: number) => Math.round(n).toLocaleString();
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
/** Money in one consistent short form: $840, $12.5k, $646k, $3.2M, $1.05B. */
function usd(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  const fix = (n: number, d: number) => n.toFixed(d).replace(/\.0+$/, '');
  if (a >= 1e9) return `${sign}$${fix(a / 1e9, a >= 1e10 ? 1 : 2)}B`;
  if (a >= 1e6) return `${sign}$${fix(a / 1e6, a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e4) return `${sign}$${fix(a / 1e3, a >= 1e5 ? 0 : 1)}k`;
  return `${sign}$${Math.round(a).toLocaleString()}`;
}
const signedUsd = (v: number) => (v > 0 ? `+${usd(v)}` : usd(v));
/** Big counts: 14,419,000 → 14.4M. */
const big = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : num(n));

/** Width of an element in CSS pixels, so charts draw at 1:1 (text never scales). */
function useWidth<T extends HTMLElement>(): [React.MutableRefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(Math.round(el.getBoundingClientRect().width));
    measure();
    const RO = (window as any).ResizeObserver;
    if (!RO) {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new RO(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ----------------------------------------------------------------------------
// Building blocks
// ----------------------------------------------------------------------------
function Card({ title, note, children, table, wide }: { title: string; note?: string; children: React.ReactNode; table?: React.ReactNode; wide?: boolean }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section
      aria-label={title}
      style={{ gridColumn: wide ? '1 / -1' : undefined, background: C.panelAlt, border: `1px solid ${C.line}`, borderRadius: 10, padding: '12px 14px 14px', minWidth: 0 }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 650, color: C.text }}>{title}</h3>
        {note && <span style={{ fontSize: 11.5, color: C.muted }}>{note}</span>}
        <span style={{ flex: 1 }} />
        {table && (
          <button
            type="button"
            onClick={() => setAsTable((v) => !v)}
            style={{ background: 'none', border: 'none', color: C.muted, fontSize: 11.5, cursor: 'pointer', padding: 0 }}
          >
            {asTable ? 'Chart' : 'Table'}
          </button>
        )}
      </div>
      {asTable && table ? table : children}
    </section>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={h} style={{ textAlign: i ? 'right' : 'left', color: C.muted, fontWeight: 600, padding: '4px 6px', borderBottom: `1px solid ${C.line}` }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, k) => (
          <tr key={k}>
            {r.map((c, i) => (
              <td key={i} className="num" style={{ textAlign: i ? 'right' : 'left', color: i ? C.textSoft : C.text, padding: '4px 6px', borderBottom: `1px solid ${C.lineSoft}` }}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Floating readout for the bar or slice under the pointer. */
function Hover({ at, children }: { at: { x: string; y: string } | null; children: React.ReactNode }) {
  if (!at) return null;
  return (
    <div
      role="status"
      style={{
        position: 'absolute',
        left: at.x,
        top: at.y,
        transform: 'translate(-50%, calc(-100% - 8px))',
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: 7,
        padding: '5px 9px',
        fontSize: 12,
        color: C.text,
        whiteSpace: 'nowrap',
        lineHeight: 1.4,
        pointerEvents: 'none',
        boxShadow: '0 8px 20px rgba(0,0,0,.4)',
        zIndex: 2,
      }}
    >
      {children}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div style={{ background: C.panelAlt, border: `1px solid ${C.line}`, borderRadius: 10, padding: '10px 12px', minWidth: 0 }}>
      <div style={{ fontSize: 11.5, color: C.muted }}>{label}</div>
      <div className="num" style={{ fontSize: 19, fontWeight: 650, color: C.text, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: C.faint, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

/** Bar with a rounded end away from the baseline (square on the baseline). */
function barPath(x: number, base: number, end: number, w: number, r = 4) {
  const h = Math.abs(end - base);
  const rr = Math.min(r, h, w / 2);
  if (h < 0.5) return '';
  if (end < base)
    return `M${x},${base}V${end + rr}Q${x},${end} ${x + rr},${end}H${x + w - rr}Q${x + w},${end} ${x + w},${end + rr}V${base}Z`;
  return `M${x},${base}V${end - rr}Q${x},${end} ${x + rr},${end}H${x + w - rr}Q${x + w},${end} ${x + w},${end - rr}V${base}Z`;
}

// ----------------------------------------------------------------------------
// Weekly results: one bar per week, above or below zero
// ----------------------------------------------------------------------------
function WeeklyChart({ weeks }: { weeks: AirlineStats['weekly'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [box, boxW] = useWidth<HTMLDivElement>();
  const W = Math.max(320, boxW || 640);
  const H = 190;
  const padL = 58;
  const padB = 22;
  const padT = 10;
  const maxV = Math.max(1, ...weeks.map((w) => w.net));
  const minV = Math.min(0, ...weeks.map((w) => w.net));
  const span = maxV - minV || 1;
  const y = (v: number) => padT + ((maxV - v) / span) * (H - padT - padB);
  const slot = (W - padL) / Math.max(1, weeks.length);
  const bw = Math.min(44, Math.max(6, slot * 0.6));
  const base = y(0);
  const hovered = hover !== null ? weeks[hover] : null;
  return (
    <div ref={box} style={{ position: 'relative', lineHeight: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Net result per week" style={{ display: 'block' }}>
        {/* Recessive grid: zero line and the top value */}
        <line x1={padL} x2={W} y1={base} y2={base} stroke={C.border} strokeWidth={1} />
        <line x1={padL} x2={W} y1={y(maxV)} y2={y(maxV)} stroke={C.line} strokeWidth={1} strokeDasharray="2 4" />
        <text x={padL - 8} y={y(maxV) + 4} textAnchor="end" fontSize={11} fill={C.muted}>
          {usd(maxV)}
        </text>
        <text x={padL - 8} y={base + 4} textAnchor="end" fontSize={11} fill={C.muted}>
          $0
        </text>
        {minV < 0 && (
          <>
            <line x1={padL} x2={W} y1={y(minV)} y2={y(minV)} stroke={C.line} strokeWidth={1} strokeDasharray="2 4" />
            <text x={padL - 8} y={y(minV) + 4} textAnchor="end" fontSize={11} fill={C.muted}>
              {usd(minV)}
            </text>
          </>
        )}
        {weeks.map((w, i) => {
          const x = padL + i * slot + (slot - bw) / 2;
          const color = w.net >= 0 ? C.green : C.red;
          const d = barPath(x, base, y(w.net), bw);
          return (
            <g key={w.week}>
              {w.partial ? (
                <path d={d} fill={color} fillOpacity={0.25} stroke={color} strokeWidth={1.5} strokeDasharray="3 3" />
              ) : (
                <path d={d} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />
              )}
              <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize={11} fill={w.partial ? C.textDim : C.muted}>
                {w.partial ? `W${w.week}*` : `W${w.week}`}
              </text>
              {/* Hit area: the whole column */}
              <rect x={padL + i * slot} y={0} width={slot} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            </g>
          );
        })}
      </svg>
      <Hover at={hovered && hover !== null ? { x: `${padL + hover * slot + slot / 2}px`, y: `${y(Math.max(0, hovered.net))}px` } : null}>
        {hovered && (
          <>
            <b>Week {hovered.week}</b>
            {hovered.partial ? ' so far' : ''}: {signedUsd(hovered.net)}
          </>
        )}
      </Hover>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Donut with a legend that carries labels and values
// ----------------------------------------------------------------------------
function Donut({ slices, unit, centre }: { slices: Slice[]; unit: string; centre: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0);
  const R = 52;
  const SW = 18;
  const CX = 64;
  let acc = 0;
  const arcs = slices.map((s, i) => {
    const a0 = (acc / total) * Math.PI * 2;
    acc += s.value;
    const a1 = (acc / total) * Math.PI * 2;
    return { s, i, a0, a1 };
  });
  const pt = (a: number) => [CX + R * Math.sin(a), CX - R * Math.cos(a)];
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
      <svg viewBox="0 0 128 128" width={128} height={128} role="img" aria-label={centre} style={{ flex: 'none' }}>
        {slices.length === 1 ? (
          <circle cx={CX} cy={CX} r={R} fill="none" stroke={sliceColor(slices[0], 0)} strokeWidth={SW} />
        ) : (
          arcs.map(({ s, i, a0, a1 }) => {
            const [x0, y0] = pt(a0);
            const [x1, y1] = pt(a1);
            const large = a1 - a0 > Math.PI ? 1 : 0;
            return (
              <path
                key={s.label}
                d={`M${x0},${y0}A${R},${R} 0 ${large} 1 ${x1},${y1}`}
                fill="none"
                stroke={sliceColor(s, i)}
                strokeWidth={hover === i ? SW + 4 : SW}
                // A 2 px gap of panel colour between slices
                strokeDasharray={`${Math.max(0, R * (a1 - a0) - 2)} 1000`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: 'default' }}
              >
                <title>{`${s.label}: ${num(s.value)} ${unit} (${pct(s.value, total)}%)`}</title>
              </path>
            );
          })
        )}
        <text x={CX} y={CX - 2} textAnchor="middle" fontSize={20} fontWeight={650} fill={C.text}>
          {hover !== null ? `${pct(slices[hover].value, total)}%` : num(total)}
        </text>
        <text x={CX} y={CX + 15} textAnchor="middle" fontSize={10.5} fill={C.muted}>
          {hover !== null ? slices[hover].label.slice(0, 16) : centre}
        </text>
      </svg>
      <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 4 }}>
        {slices.map((s, i) => (
          <div
            key={s.label}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            style={{ display: 'grid', gridTemplateColumns: '10px 1fr auto auto', gap: 8, alignItems: 'center', fontSize: 12, color: hover === null || hover === i ? C.textSoft : C.muted }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 3, background: sliceColor(s, i) }} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
            <span className="num" style={{ color: C.text }}>
              {num(s.value)}
            </span>
            <span className="num" style={{ color: C.muted, width: 34, textAlign: 'right' }}>
              {pct(s.value, total)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const sliceTable = (slices: Slice[], unit: string) => {
  const total = slices.reduce((s, x) => s + x.value, 0);
  return <DataTable head={['', unit, 'Share']} rows={slices.map((s) => [s.label, num(s.value), `${pct(s.value, total)}%`])} />;
};

// ----------------------------------------------------------------------------
// Horizontal bars (routes, utilisation)
// ----------------------------------------------------------------------------
function RouteBars({ routes }: { routes: RouteStat[] }) {
  const max = Math.max(1, ...routes.map((r) => Math.abs(r.profit)));
  const anyLoss = routes.some((r) => r.profit < 0);
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {routes.map((r) => {
        const w = (Math.abs(r.profit) / max) * (anyLoss ? 50 : 100);
        const loss = r.profit < 0;
        return (
          <div key={r.label} title={`${r.label}: ${signedUsd(r.profit)} a week, ${num(r.pax)} passengers, ${pct(r.pax, r.seats)}% full`} style={{ display: 'grid', gridTemplateColumns: '96px 1fr 76px', gap: 10, alignItems: 'center', fontSize: 12 }}>
            <span style={{ color: C.text, fontWeight: 600 }}>{r.label}</span>
            <div style={{ position: 'relative', height: 14 }}>
              {anyLoss && <div style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: C.border }} />}
              <div
                style={{
                  position: 'absolute',
                  top: 1,
                  height: 12,
                  width: `${w}%`,
                  left: anyLoss ? (loss ? `${50 - w}%` : '50%') : 0,
                  background: loss ? C.red : C.green,
                  borderRadius: loss ? '4px 0 0 4px' : '0 4px 4px 0',
                }}
              />
            </div>
            <span className="num" style={{ textAlign: 'right', color: C.textSoft }}>
              {signedUsd(r.profit)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function UtilisationBars({ rows }: { rows: AirlineStats['utilisation'] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 12);
  return (
    <div>
      <div style={{ display: 'grid', gap: 6 }}>
        {shown.map((u) => (
          <div key={u.tail} title={`${u.tail}, ${u.model}: ${u.usedPct}% of the week in use, ${u.hoursPerDay} h a day`} style={{ display: 'grid', gridTemplateColumns: '170px 1fr 110px', gap: 10, alignItems: 'center', fontSize: 12 }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <span style={{ color: C.text, fontWeight: 600 }}>{u.tail}</span> <span style={{ color: C.muted }}>{u.model}</span>
            </span>
            <div style={{ height: 12, background: C.bg, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${u.usedPct}%`, height: '100%', background: BAR, borderRadius: '0 4px 4px 0' }} />
            </div>
            <span className="num" style={{ textAlign: 'right', color: C.textSoft }}>
              {u.usedPct}%, {u.hoursPerDay} h/day
            </span>
          </div>
        ))}
      </div>
      {rows.length > 12 && (
        <div style={{ marginTop: 8 }}>
          <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>
            {all ? 'Show the busiest 12' : `Show all ${rows.length} aircraft`}
          </Button>
        </div>
      )}
    </div>
  );
}

/** One bar split into parts (e.g. passenger and cargo revenue). */
function SplitBar({ parts }: { parts: Slice[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div>
      <div style={{ display: 'flex', gap: 2, height: 12, borderRadius: 4, overflow: 'hidden' }}>
        {parts.map((p, i) => (
          <div key={p.label} title={`${p.label}: ${pct(p.value, total)}%`} style={{ width: `${(p.value / total) * 100}%`, background: sliceColor(p, i) }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 11.5, color: C.muted, flexWrap: 'wrap' }}>
        {parts.map((p, i) => (
          <span key={p.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: sliceColor(p, i) }} />
            {p.label} <span className="num" style={{ color: C.textSoft }}>{pct(p.value, total)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Record({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11.5, color: C.muted }}>{label}</div>
      <div className="num" style={{ fontSize: 14.5, fontWeight: 650, color: C.text, marginTop: 2 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: C.faint }}>{sub}</div>}
    </div>
  );
}

// ----------------------------------------------------------------------------
// The panel
// ----------------------------------------------------------------------------
export function StatsPanel(props: {
  airlineName: string;
  fleet: PlayerAircraft[];
  schedule: ScheduledFlight[];
  econById: Map<string, FlightEconomics>;
  hubs: string[];
  airportByIata: Map<string, Airport>;
  ledgerHistory: WeekLedger[];
  current: WeekLedger | null;
  cash: number;
  /** Sandbox careers have unlimited cash. */
  sandbox: boolean;
  onClose: () => void;
  onOpenAirports: () => void;
}) {
  const st = useMemo(
    () =>
      computeAirlineStats({
        fleet: props.fleet,
        schedule: props.schedule,
        econById: props.econById,
        hubs: props.hubs,
        airportByIata: props.airportByIata,
        ledgerHistory: props.ledgerHistory,
        current: props.current,
      }),
    [props.fleet, props.schedule, props.econById, props.hubs, props.airportByIata, props.ledgerHistory, props.current]
  );
  const ap = (iata: string) => props.airportByIata.get(iata)?.municipality ?? '';

  return (
    <SidePanel title={`${props.airlineName} in numbers`} subtitle="A scheduled week, and how the weeks have gone" width={900} onClose={props.onClose}>
      {st.departures === 0 ? (
        <EmptyState
          title="Nothing to count yet"
          body="Schedule your first flights and this page fills with your passengers, profits, fleet and network."
          action={
            <Button variant="primary" onClick={props.onOpenAirports}>
              Find an airport to fly to
            </Button>
          }
        />
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {/* Headline */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(210px, 1.25fr) repeat(3, minmax(0, 1fr))', gap: 10 }}>
            <div style={{ gridRow: 'span 2', background: C.panelAlt, border: `1px solid ${C.line}`, borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ fontSize: 12, color: C.muted }}>Profit a week, as scheduled</div>
              <div className="num" style={{ fontSize: 34, fontWeight: 700, color: st.profit >= 0 ? C.green : C.red, letterSpacing: -0.5, marginTop: 2 }}>
                {signedUsd(st.profit)}
              </div>
              <div className="num" style={{ fontSize: 12, color: C.textDim, marginTop: 6, lineHeight: 1.55 }}>
                {usd(st.revenue)} revenue, {usd(st.cost)} costs
                <br />
                {props.sandbox ? 'Unlimited cash (sandbox)' : `${usd(props.cash)} in the bank`}
              </div>
            </div>
            <Tile label="Passengers a week" value={num(st.pax)} sub={`${num(st.seats)} seats`} />
            <Tile label="Load factor" value={`${st.loadFactorPct}%`} sub={`${big(st.paxNm)} of ${big(st.seatNm)} seat-nm filled`} />
            <Tile label="Departures a week" value={num(st.departures)} sub={`${num(st.blockHours)} block hours`} />
            <Tile label="Fleet" value={num(st.fleet)} sub={`${st.owned} owned, ${st.leased} leased`} />
            <Tile label="Network" value={`${st.routes} routes`} sub={`${st.destinations} airports, ${st.countries} countries`} />
            <Tile label="Distance flown a week" value={`${num(st.nmFlown)} nm`} sub={`${(st.nmFlown / 21_639).toFixed(1)}× around the world`} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Card
              title="Weekly results"
              note={st.weekly.length <= 1 ? 'Bars build up as weeks close' : undefined}
              wide
              table={<DataTable head={['Week', 'Net result']} rows={st.weekly.map((w) => [`Week ${w.week}${w.partial ? ' (so far)' : ''}`, signedUsd(w.net)])} />}
            >
              <WeeklyChart weeks={st.weekly} />
              <div style={{ fontSize: 11.5, color: C.faint, marginTop: 6 }}>Net result after leases and loan instalments. * this week so far.</div>
            </Card>

            <Card title="Fleet by aircraft family" table={sliceTable(st.fleetByFamily, 'Aircraft')}>
              <Donut slices={st.fleetByFamily} unit="aircraft" centre="aircraft" />
            </Card>
            <Card title="Departures by hub" note="a week" table={sliceTable(st.departuresByHub, 'Departures')}>
              <Donut slices={st.departuresByHub} unit="departures" centre="departures" />
            </Card>
            <Card title="Seats by cabin" note="a week" table={sliceTable(st.seatsByCabin, 'Seats')}>
              <Donut slices={st.seatsByCabin} unit="seats" centre="seats" />
            </Card>
            <Card title="Routes by length" table={sliceTable(st.routesByLength, 'Routes')}>
              <Donut slices={st.routesByLength} unit="routes" centre="routes" />
            </Card>

            <Card
              title="Most profitable routes"
              note="profit a week, both directions"
              table={<DataTable head={['Route', 'Profit a week', 'Passengers', 'Full']} rows={st.topRoutes.map((r) => [r.label, signedUsd(r.profit), num(r.pax), `${pct(r.pax, r.seats)}%`])} />}
            >
              <RouteBars routes={st.topRoutes} />
              {st.worstRoutes.length > 0 && (
                <>
                  <div style={{ fontSize: 12, color: C.muted, margin: '14px 0 6px' }}>Losing money</div>
                  <RouteBars routes={st.worstRoutes} />
                </>
              )}
            </Card>

            <Card title="Records">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Record
                  label="Longest route"
                  value={st.longestRoute ? st.longestRoute.label : '–'}
                  sub={st.longestRoute ? `${num(st.longestRoute.distanceNm)} nm, ${ap(st.longestRoute.a)} to ${ap(st.longestRoute.b)}` : undefined}
                />
                <Record label="Busiest route" value={st.busiestRoute ? st.busiestRoute.label : '–'} sub={st.busiestRoute ? `${num(st.busiestRoute.pax)} passengers a week` : undefined} />
                <Record
                  label="Busiest airport"
                  value={st.busiestAirport ? `${st.busiestAirport.iata} ${st.busiestAirport.city}` : '–'}
                  sub={st.busiestAirport ? `${num(st.busiestAirport.departures)} departures a week` : undefined}
                />
                <Record label="Biggest aircraft" value={st.biggestAircraft ? st.biggestAircraft.tail : '–'} sub={st.biggestAircraft ? `${st.biggestAircraft.model}, ${st.biggestAircraft.seats} seats` : undefined} />
                <Record label="Best week" value={st.bestWeek ? signedUsd(st.bestWeek.net) : '–'} sub={st.bestWeek ? `week ${st.bestWeek.week}` : 'after your first full week'} />
                <Record label="Reach" value={`${st.continents} continent${st.continents === 1 ? '' : 's'}`} sub={`${st.countries} countries`} />
              </div>
              <div style={{ fontSize: 12, color: C.muted, margin: '16px 0 6px' }}>Where the money comes from</div>
              <SplitBar
                parts={[
                  { label: 'Passengers', value: st.paxRevenue },
                  { label: 'Cargo', value: st.cargoRevenue },
                ].filter((p) => p.value > 0)}
              />
              <div className="num" style={{ fontSize: 11.5, color: C.faint, marginTop: 6 }}>
                {num(st.cargoTons)} t of cargo a week
              </div>
            </Card>

            <Card
              title="Aircraft utilisation"
              note={`fleet average ${st.avgUtilisationPct}% of the week`}
              wide
              table={<DataTable head={['Aircraft', 'Type', 'In use', 'Hours a day']} rows={st.utilisation.map((u) => [u.tail, u.model, `${u.usedPct}%`, u.hoursPerDay])} />}
            >
              <UtilisationBars rows={st.utilisation} />
            </Card>
          </div>
        </div>
      )}
    </SidePanel>
  );
}
