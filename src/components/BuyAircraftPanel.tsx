// ============================================================================
// BUY OR LEASE AIRCRAFT (reworked v2.58, calmer in v3.1)
//   Two simple steps instead of one long page:
//     1. Browse: search, passenger or cargo, a row of makers, and families
//        that open into cards (range, seats, price).
//     2. The model: its key numbers, buying or leasing straight under them,
//        and the cabin and full specs folded away until wanted.
//   Works the same on phones (one column, everything a tap away).
// ============================================================================
import { WINGSPAN_M, aircraftGateCode } from '../game/gateCode';
import { AircraftPhoto, hasAircraftPhoto, useBuyLivery } from './AircraftPhoto';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BRAND_ORDER } from '../game/aircraftCatalog';
import { holdTakes } from '../game/cargo';
import { cabinSeatTotal, calculateCabinUsage, getDefaultCabinForModel } from '../game/economics';
import { getAircraftTierInfo } from '../game/tiers';
import { formatMoneyM } from '../game/time';
import type { AircraftModel, CabinConfig, GameMode } from '../game/types';
import { DEFAULT_LEASE_WEEKS, LEASE_OPTIONS, leaseQuote } from '../game/leasing';
import { Icon } from '../ui/icons';
import { Button, C, Chip, DISPLAY, Field, IconButton, SearchInput, Segmented, SidePanel, Stepper, inputStyle, well } from '../ui/kit';
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
    <SidePanel title={view === 'browse' ? 'Aircraft' : shortName(props.selectedModel)} width={820} onClose={props.onClose}>
      {view === 'browse' ? <Browse {...props} onOpen={open} /> : <ModelView {...props} onBack={() => setView('browse')} />}
    </SidePanel>
  );
}

// ---------------------------------------------------------------------------
// Step 1: browse
// ---------------------------------------------------------------------------
function Browse(props: BuyAircraftPanelProps & { onOpen: (m: AircraftModel) => void }) {
  const [showLivery] = useBuyLivery();
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

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search" style={{ flex: '1 1 200px' }} />
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
        <Chip active={maker === 'all'} onClick={() => setMaker('all')} style={{ flex: 'none', whiteSpace: 'nowrap' }}>
          All
        </Chip>
        {makers.map((b) => (
          <Chip key={b} active={maker === b} onClick={() => setMaker(b)} style={{ flex: 'none', whiteSpace: 'nowrap' }}>
            {b}
          </Chip>
        ))}
      </div>

      {groups.length === 0 && <div style={{ padding: 16, fontSize: 13, color: C.muted }}>Nothing matches.</div>}

      <div className="bp-list">
        {groups.map((g) => {
          const isOpen = allOpen || openFamilies.has(g.key);
          const from = Math.min(...g.models.map((x) => x.base_price_usd));
          const seats = g.models.map((x) => (x.is_cargo ? x.cargo_cap_tons : x.typical_seats));
          const span = Math.min(...seats) === Math.max(...seats) ? `${Math.min(...seats)}` : `${Math.min(...seats)}–${Math.max(...seats)}`;
          return (
            <section key={g.key}>
              <button
                type="button"
                className="bp-row"
                aria-expanded={isOpen}
                onClick={() => !allOpen && toggle(g.key)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 8px', background: 'transparent', border: 'none', color: C.text, cursor: allOpen ? 'default' : 'pointer', textAlign: 'left', borderRadius: 0 }}
              >
                <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {maker === 'all' && <span style={{ color: C.muted, fontWeight: 500 }}>{g.maker} </span>}
                  {g.family}
                </span>
                <span className="num" style={{ fontSize: 12.5, color: C.muted, whiteSpace: 'nowrap' }}>
                  {span} {role === 'cargo' ? 't' : 'seats'} · from {formatMoneyM(from)}
                </span>
                {!allOpen && <Icon name="chevron" size={15} color={C.faint} style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />}
              </button>
              {isOpen && (
                <div className="bp-model-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(210px, 100%), 1fr))', gap: 8, padding: '2px 0 14px' }}>
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
                        borderRadius: 12,
                        textAlign: 'left',
                        cursor: 'pointer',
                        color: C.text,
                        background: well(),
                        border: 'none',
                      }}
                    >
                      {hasAircraftPhoto(x) && <AircraftPhoto model={x} width="100%" paintWidth={220} plain={!showLivery} style={{ height: 58 }} />}
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                        {!hasAircraftPhoto(x) && <img src={props.iconForModel(x)} alt="" style={{ width: 22, height: 22, flex: 'none', alignSelf: 'center' }} />}
                        <span style={{ flex: 1, minWidth: 0, fontWeight: 650, fontSize: 14, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{shortName(x)}</span>
                        <span className="num" style={{ flex: 'none', fontSize: 13, fontWeight: 650 }}>
                          {formatMoneyM(x.base_price_usd)}
                        </span>
                      </span>
                      <span className="num" style={{ fontSize: 12.5, color: C.muted }}>
                        {seatsOrLoad(x)}
                        {x.is_cargo ? '' : ' seats'} · {x.range_nm.toLocaleString()} nm
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
function ModelView(props: BuyAircraftPanelProps & { onBack: () => void }) {
  const [showLivery, setShowLivery] = useBuyLivery();
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
    cabinDraft.premSeats && `${cabinDraft.premSeats} premium`,
    cabinDraft.econSeats && `${cabinDraft.econSeats} economy`,
  ]
    .filter(Boolean)
    .join(', ');

  const stat = (label: string, value: string) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, color: C.muted }}>{label}</div>
      <div className="num" style={{ fontSize: 18, fontWeight: 700 }}>
        {value}
      </div>
    </div>
  );
  const box: React.CSSProperties = { padding: 14, borderRadius: 14, background: well() };
  const fold: React.CSSProperties = { padding: '12px 8px', borderTop: `1px solid ${C.line}` };

  return (
    <div ref={top} style={{ display: 'grid', gap: 14, scrollMarginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <IconButton icon="chevron" label="All aircraft" onClick={props.onBack} style={{ transform: 'rotate(180deg)' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontFamily: DISPLAY, fontSize: 24, fontWeight: 700, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortName(m)}</h3>
          <div style={{ fontSize: 12.5, color: C.muted }}>
            {m.manufacturer} · {tier.sizeLabel}
            {m.is_cargo ? ' freighter' : ''} · {m.icao_code}
          </div>
        </div>
        {hasAircraftPhoto(m) && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.textSoft, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={showLivery} onChange={(e) => setShowLivery(e.target.checked)} />
            My livery
          </label>
        )}
      </div>

      {hasAircraftPhoto(m) ? (
        <AircraftPhoto model={m} width="100%" paintWidth={560} plain={!showLivery} style={{ maxWidth: 560, margin: '0 auto' }} />
      ) : (
        <img src={props.iconForModel(m)} alt="" style={{ width: 44, height: 44 }} />
      )}

      {/* Key numbers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, padding: '0 8px' }}>
        {stat('Range', `${m.range_nm.toLocaleString()} nm`)}
        {stat(m.is_cargo ? 'Payload' : 'Seats', m.is_cargo ? `${m.cargo_cap_tons} t` : `${seats}`)}
        {stat('Cruise', `${m.cruise_speed_kts} kt`)}
        {stat('Turnaround', `${m.turnaround_min} min`)}
      </div>

      {/* Order */}
      <div style={{ ...box, display: 'grid', gap: 12 }}>
        <div className="bp-stack" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'end' }}>
          <Field label={count > 1 ? 'First registration' : 'Registration'}>
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
            {!canBuy && <div style={{ fontSize: 12, color: C.red }}>Not enough cash</div>}
          </div>
          <div style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
            <Button size="lg" block disabled={!usage.isValid || !canLease} onClick={() => props.onAcquire('leased', weeks, count)}>
              Lease · ${quote.dailyRate.toLocaleString()}/day{count > 1 ? ' each' : ''}
            </Button>
            <label className="num" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: canLease ? C.muted : C.red }}>
              <select value={String(weeks)} onChange={(e) => setWeeks(Number(e.target.value))} aria-label="Lease term" style={{ ...inputStyle, width: 'auto', padding: '2px 6px', fontSize: 12 }}>
                {LEASE_OPTIONS.map((o) => (
                  <option key={o.weeks} value={o.weeks}>
                    {o.label}
                  </option>
                ))}
              </select>
              {canLease ? `${formatMoneyM(quote.deposit * count, 2)} deposit` : 'Not enough for the deposit'}
            </label>
          </div>
        </div>
        {!usage.isValid && <div style={{ fontSize: 12.5, color: C.red }}>The cabin doesn’t fit.</div>}
      </div>

      <div>
        {/* Cabin, folded */}
        {!m.is_cargo && (
          <details style={fold} open={!usage.isValid || undefined}>
            <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, listStyle: 'none' }}>
              <span style={{ fontWeight: 650, fontSize: 14 }}>Cabin</span>
              <span className="num" style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cabinText || 'No seats'}</span>
              <Icon name="chevron" size={14} color={C.faint} />
            </summary>
            <div style={{ marginTop: 12 }}>
              <CabinEditor model={m} cabin={cabinDraft} onChange={props.onCabinDraftChange} />
            </div>
          </details>
        )}

        {/* Everything else */}
        <details style={fold}>
          <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, listStyle: 'none' }}>
            <span style={{ flex: 1, fontWeight: 650, fontSize: 14 }}>Specifications</span>
            <Icon name="chevron" size={14} color={C.faint} />
          </summary>
          <dl className="num" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px 24px', margin: '12px 0 0', fontSize: 13 }}>
            {[
              ['Size', `Code ${aircraftGateCode(m)}`],
              ['Wingspan', WINGSPAN_M[m.id] ? `${WINGSPAN_M[m.id]} m` : '—'],
              ['Fuel burn', `${m.fuel_burn_kg_hr.toLocaleString()} kg/h`],
              ['Max takeoff', `${Math.round(m.mtow_kg / 1000)} t`],
              ['Typical seats', m.is_cargo ? '—' : String(m.typical_seats)],
              ['Seat limit', m.is_cargo ? '—' : String(m.max_exit_limit)],
              [m.is_cargo ? 'Payload' : 'Hold', `${m.cargo_cap_tons} t`],
              ['Carries', holdTakes(m)],
              ['Resale', '75%'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <dt style={{ color: C.muted }}>{k}</dt>
                <dd style={{ margin: 0, fontWeight: 600 }}>{v}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
    </div>
  );
}
