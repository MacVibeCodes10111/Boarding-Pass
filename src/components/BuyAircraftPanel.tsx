// ============================================================================
// BUY OR LEASE AIRCRAFT (reworked v2.58)
//   Two simple steps instead of one long page:
//     1. Browse: search, passenger or cargo, a row of makers, and families
//        that open into cards (range, seats, price).
//     2. The model: its key numbers, buying or leasing straight under them,
//        and the cabin and full specs folded away until wanted.
//   Works the same on phones (one column, everything a tap away).
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { BRAND_ORDER } from '../game/aircraftCatalog';
import { cabinSeatTotal, calculateCabinUsage, getDefaultCabinForModel } from '../game/economics';
import { getAircraftTierInfo } from '../game/tiers';
import { formatMoneyM } from '../game/time';
import type { AircraftModel, CabinConfig, GameMode } from '../game/types';
import { DEFAULT_LEASE_WEEKS, DEPOSIT_WEEKS, LEASE_OPTIONS, leaseQuote } from '../game/leasing';
import { Icon } from '../ui/icons';
import { Button, C, Field, SearchInput, Segmented, SidePanel, Stepper, inputStyle } from '../ui/kit';
import { CabinEditor } from './CabinEditor';

type Role = 'pax' | 'cargo';

export interface BuyAircraftPanelProps {
  catalog: AircraftModel[];
  cash: number;
  gameMode: GameMode;
  hubIata: string;
  selectedModel: AircraftModel;
  onSelectModel: (m: AircraftModel) => void;
  cabinDraft: CabinConfig;
  onCabinDraftChange: (c: CabinConfig) => void;
  tailInput: string;
  onTailInputChange: (t: string) => void;
  /** Buy or lease `count` of the type; leases run `leaseWeeks`. */
  onAcquire: (mode: 'owned' | 'leased', leaseWeeks: number, count: number) => void;
  econMin: number;
  iconForModel: (m: AircraftModel) => string;
  onClose: () => void;
}

const shortName = (m: AircraftModel) => m.name.replace(/\s*\(Cargo\)$/, '');
const familyLabel = (maker: string, family: string) => family.replace(new RegExp(`^${maker}\\s*`), '');
const seatsOrLoad = (m: AircraftModel) => (m.is_cargo ? `${m.cargo_cap_tons} t` : `${m.typical_seats}`);

export function BuyAircraftPanel(props: BuyAircraftPanelProps) {
  const [view, setView] = useState<'browse' | 'model'>('browse');
  const open = (x: AircraftModel) => {
    props.onSelectModel(x);
    props.onCabinDraftChange(getDefaultCabinForModel(x));
    setView('model');
  };
  return (
    <SidePanel
      title={view === 'browse' ? 'Buy or lease aircraft' : shortName(props.selectedModel)}
      subtitle={view === 'browse' ? `Delivered to ${props.hubIata}` : `${props.selectedModel.manufacturer}, ${familyLabel(props.selectedModel.manufacturer, props.selectedModel.family)}`}
      width={820}
      onClose={props.onClose}
      actions={
        view === 'model' ? (
          <Button onClick={() => setView('browse')}>
            <span aria-hidden="true">←</span> All aircraft
          </Button>
        ) : undefined
      }
    >
      {view === 'browse' ? <Browse {...props} onOpen={open} /> : <ModelView {...props} />}
    </SidePanel>
  );
}

// ---------------------------------------------------------------------------
// Step 1: browse
// ---------------------------------------------------------------------------
function Browse(props: BuyAircraftPanelProps & { onOpen: (m: AircraftModel) => void }) {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<Role>(props.selectedModel.is_cargo ? 'cargo' : 'pax');
  const [maker, setMaker] = useState('all');
  const [openFamilies, setOpenFamilies] = useState<Set<string>>(() => new Set([`${props.selectedModel.manufacturer}|${props.selectedModel.family}`]));

  const makers = useMemo(() => BRAND_ORDER.filter((b) => props.catalog.some((x) => x.manufacturer === b && (role === 'cargo') === x.is_cargo)), [props.catalog, role]);
  useEffect(() => {
    if (maker !== 'all' && !makers.includes(maker)) setMaker('all');
  }, [makers, maker]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = props.catalog
      .filter(
        (x) =>
          (role === 'cargo') === x.is_cargo &&
          (maker === 'all' || x.manufacturer === maker) &&
          (!q || [x.name, x.family, x.manufacturer, x.icao_code].some((s) => s.toLowerCase().includes(q))),
      )
      .sort(
        (a, b) =>
          BRAND_ORDER.indexOf(a.manufacturer) - BRAND_ORDER.indexOf(b.manufacturer) ||
          a.family.localeCompare(b.family) ||
          // smallest to largest within a family, so A318 → A319 → A320 → A321 reads in order
          (a.is_cargo ? a.cargo_cap_tons - b.cargo_cap_tons : a.typical_seats - b.typical_seats) ||
          a.range_nm - b.range_nm ||
          a.base_price_usd - b.base_price_usd
      );
    const byFamily = new Map<string, AircraftModel[]>();
    for (const x of list) {
      const k = `${x.manufacturer}|${x.family}`;
      byFamily.set(k, [...(byFamily.get(k) ?? []), x]);
    }
    return [...byFamily.entries()].map(([key, models]) => ({ key, maker: models[0].manufacturer, family: familyLabel(models[0].manufacturer, models[0].family), models }));
  }, [props.catalog, search, role, maker]);

  // Searching, or a short list: show every family open
  const allOpen = search.trim() !== '' || groups.length <= 3;
  const toggle = (k: string) => setOpenFamilies((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])));

  const chip = (value: string, label: string) => (
    <button
      key={value}
      type="button"
      aria-pressed={maker === value}
      onClick={() => setMaker(value)}
      style={{
        flex: 'none',
        padding: '6px 12px',
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        border: `1px solid ${maker === value ? C.brand : C.border}`,
        background: maker === value ? C.brand : C.raised,
        color: maker === value ? C.brandInk : C.textSoft,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Search, e.g. A320 or 787" />
        </div>
        <Segmented<Role>
          value={role}
          onChange={setRole}
          options={[
            { value: 'pax', label: 'Passenger' },
            { value: 'cargo', label: 'Cargo' },
          ]}
        />
      </div>

      <div role="group" aria-label="Manufacturer" className="bp-chips" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'thin' }}>
        {chip('all', 'All makers')}
        {makers.map((b) => chip(b, b))}
      </div>

      {groups.length === 0 && <div style={{ padding: 16, fontSize: 13, color: C.muted }}>No aircraft match. Clear the search or pick another maker.</div>}

      <div style={{ display: 'grid', gap: 8 }}>
        {groups.map((g) => {
          const isOpen = allOpen || openFamilies.has(g.key);
          const from = Math.min(...g.models.map((x) => x.base_price_usd));
          const seats = g.models.map((x) => (x.is_cargo ? x.cargo_cap_tons : x.typical_seats));
          const span = Math.min(...seats) === Math.max(...seats) ? `${Math.min(...seats)}` : `${Math.min(...seats)}–${Math.max(...seats)}`;
          return (
            <section key={g.key} style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden', background: C.panel }}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => !allOpen && toggle(g.key)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', background: 'transparent', border: 'none', color: C.text, cursor: allOpen ? 'default' : 'pointer', textAlign: 'left' }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14.5, fontWeight: 650 }}>
                    {maker === 'all' && <span style={{ color: C.muted, fontWeight: 500 }}>{g.maker} </span>}
                    {g.family}
                  </span>
                  <span className="num" style={{ display: 'block', fontSize: 12, color: C.muted }}>
                    {g.models.length} model{g.models.length > 1 ? 's' : ''} · {span} {role === 'cargo' ? 't' : 'seats'} · from {formatMoneyM(from)}
                  </span>
                </span>
                {!allOpen && <Icon name="chevron" size={16} color={C.muted} style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />}
              </button>
              {isOpen && (
                <div className="bp-model-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(210px, 100%), 1fr))', gap: 8, padding: '0 10px 10px' }}>
                  {g.models.map((x) => (
                    <button
                      key={x.id}
                      type="button"
                      className="bp-row"
                      onClick={() => props.onOpen(x)}
                      aria-label={`${shortName(x)}, ${formatMoneyM(x.base_price_usd)}`}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr)',
                        alignContent: 'start',
                        gap: 6,
                        minWidth: 0,
                        padding: '10px 12px',
                        borderRadius: 10,
                        textAlign: 'left',
                        cursor: 'pointer',
                        color: C.text,
                        background: C.raised,
                        border: `1px solid ${x.id === props.selectedModel.id ? C.brand : C.line}`,
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
                        <img src={props.iconForModel(x)} alt="" style={{ width: 22, height: 22, flex: 'none' }} />
                        <span style={{ flex: 1, minWidth: 0, fontWeight: 650, fontSize: 13.5, lineHeight: 1.3, overflowWrap: 'anywhere', paddingTop: 2 }}>{shortName(x)}</span>
                        <span className="num" style={{ flex: 'none', marginTop: 2, fontSize: 10.5, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: C.bg, color: C.textDim }}>
                          {x.icao_code}
                        </span>
                      </span>
                      <span className="num" style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 12, color: C.muted }}>
                        <span>{x.range_nm.toLocaleString()} nm</span>
                        <span>
                          {seatsOrLoad(x)}
                          {x.is_cargo ? '' : ' seats'}
                        </span>
                        <span style={{ color: C.textSoft, fontWeight: 600 }}>{formatMoneyM(x.base_price_usd)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: the model, and buying or leasing it
// ---------------------------------------------------------------------------
function ModelView(props: BuyAircraftPanelProps) {
  const { selectedModel: m, cabinDraft } = props;
  const tier = getAircraftTierInfo(m.tier);
  const usage = calculateCabinUsage(m, cabinDraft);
  const sandbox = props.gameMode === 'sandbox';
  const [count, setCount] = useState(1);
  const [weeks, setWeeks] = useState(DEFAULT_LEASE_WEEKS);
  const quote = leaseQuote(m, weeks, props.econMin);
  const canBuy = sandbox || props.cash >= m.base_price_usd * count;
  const canLease = sandbox || props.cash >= quote.deposit * count;
  const top = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    top.current?.scrollIntoView({ block: 'start' });
  }, [m.id]);

  const seats = cabinSeatTotal(cabinDraft);
  const cabinText = [
    cabinDraft.firstSeats && `${cabinDraft.firstSeats} first`,
    cabinDraft.busSeats && `${cabinDraft.busSeats} business`,
    cabinDraft.premSeats && `${cabinDraft.premSeats} premium economy`,
    cabinDraft.econSeats && `${cabinDraft.econSeats} economy`,
  ]
    .filter(Boolean)
    .join(', ');

  const stat = (label: string, value: string) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11.5, color: C.muted }}>{label}</div>
      <div className="num" style={{ fontSize: 18, fontWeight: 700 }}>
        {value}
      </div>
    </div>
  );
  const box: React.CSSProperties = { padding: 14, border: `1px solid ${C.line}`, borderRadius: 12, background: C.panel };

  return (
    <div ref={top} style={{ display: 'grid', gap: 14, scrollMarginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <img src={props.iconForModel(m)} alt="" style={{ width: 44, height: 44 }} />
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.4 }}>
          {tier.sizeLabel}
          {m.is_cargo ? ' freighter' : ''}, type code <b style={{ color: C.textSoft }}>{m.icao_code}</b>. Needs {m.min_runway_ft.toLocaleString()} ft of runway.
        </div>
      </div>

      {/* Key numbers */}
      <div style={{ ...box, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        {stat('Range', `${m.range_nm.toLocaleString()} nm`)}
        {stat(m.is_cargo ? 'Payload' : 'Seats', m.is_cargo ? `${m.cargo_cap_tons} t` : `${seats} of ${m.max_exit_limit}`)}
        {stat('Cruise', `${m.cruise_speed_kts} kt`)}
        {stat('Turnaround', `${m.turnaround_min} min`)}
      </div>

      {/* Order */}
      <div style={{ ...box, display: 'grid', gap: 12 }}>
        <div className="bp-stack" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'end' }}>
          <Field label={count > 1 ? 'First registration' : 'Registration'} hint={count > 1 ? 'The others count on from it' : undefined}>
            <input
              value={props.tailInput}
              maxLength={10}
              onChange={(e) => props.onTailInputChange(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
              style={{ ...inputStyle, fontWeight: 650 }}
            />
          </Field>
          <Field label="How many">
            <Stepper value={count} min={1} max={50} onChange={setCount} />
          </Field>
        </div>
        <div className="bp-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
            <Button variant="primary" size="lg" block disabled={!usage.isValid || !canBuy} onClick={() => props.onAcquire('owned', weeks, count)}>
              Buy{count > 1 ? ` ${count}` : ''} · {formatMoneyM(m.base_price_usd * count)}
            </Button>
            <div style={{ fontSize: 11.5, color: canBuy ? C.faint : C.red }}>{canBuy ? 'Sells later for 75% of the price.' : 'Not enough cash.'}</div>
          </div>
          <div style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
            <Button size="lg" block disabled={!usage.isValid || !canLease} onClick={() => props.onAcquire('leased', weeks, count)}>
              Lease · ${quote.dailyRate.toLocaleString()}/day{count > 1 ? ' each' : ''}
            </Button>
            <label className="num" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: canLease ? C.faint : C.red }}>
              <select value={String(weeks)} onChange={(e) => setWeeks(Number(e.target.value))} aria-label="Lease term" style={{ ...inputStyle, width: 'auto', padding: '2px 6px', fontSize: 12 }}>
                {LEASE_OPTIONS.map((o) => (
                  <option key={o.weeks} value={o.weeks}>
                    {o.label}
                  </option>
                ))}
              </select>
              {canLease ? `${formatMoneyM(quote.deposit * count, 2)} deposit (${DEPOSIT_WEEKS} weeks), returned at the end` : 'Not enough cash for the deposit.'}
            </label>
          </div>
        </div>
        {!usage.isValid && <div style={{ fontSize: 12, color: C.red }}>The cabin doesn’t fit. Open Cabin below to fix it.</div>}
      </div>

      {/* Cabin, folded */}
      {m.is_cargo ? (
        <div style={{ fontSize: 13, color: C.textDim }}>Dedicated freighter: {m.cargo_cap_tons} t on the main deck, earning from freight demand between cities.</div>
      ) : (
        <details style={box}>
          <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, listStyle: 'none' }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 650, fontSize: 14 }}>Cabin</span>
              <span className="num" style={{ display: 'block', fontSize: 12.5, color: C.muted }}>
                {cabinText || 'No seats'} ({seats} seats)
              </span>
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.accent }}>Change</span>
          </summary>
          <div style={{ marginTop: 12 }}>
            <CabinEditor model={m} cabin={cabinDraft} onChange={props.onCabinDraftChange} />
          </div>
        </details>
      )}

      {/* Everything else */}
      <details style={box}>
        <summary style={{ cursor: 'pointer', fontWeight: 650, fontSize: 14, listStyle: 'none' }}>All specifications</summary>
        <dl className="num" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px 16px', margin: '12px 0 0', fontSize: 13 }}>
          {[
            ['Fuel burn', `${m.fuel_burn_kg_hr.toLocaleString()} kg/h`],
            ['Max takeoff', `${Math.round(m.mtow_kg / 1000)} t`],
            ['Typical seats', m.is_cargo ? '—' : String(m.typical_seats)],
            ['Seat limit', m.is_cargo ? '—' : String(m.max_exit_limit)],
            ['Belly cargo', `${m.cargo_cap_tons} t`],
            ['Lease, standard', `$${leaseQuote(m, DEFAULT_LEASE_WEEKS, props.econMin).dailyRate.toLocaleString()}/day`],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, borderBottom: `1px solid ${C.line}`, paddingBottom: 6 }}>
              <dt style={{ color: C.muted }}>{k}</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>{v}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
