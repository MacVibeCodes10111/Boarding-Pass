import { useMemo, useState } from 'react';
import { BRAND_ORDER } from '../game/aircraftCatalog';
import { calculateCabinUsage, getDefaultCabinForModel } from '../game/economics';
import { TIERS, getAircraftTierInfo } from '../game/tiers';
import { formatMoneyM } from '../game/time';
import type { AircraftModel, CabinConfig, GameMode, OperationalTier } from '../game/types';
import { Button, C, Field, Segmented, SearchInput, SidePanel, Stat, inputStyle } from '../ui/kit';
import { CabinEditor } from './CabinEditor';

type Role = 'all' | 'pax' | 'cargo';

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
  onAcquire: (mode: 'owned' | 'leased') => void;
  iconForModel: (m: AircraftModel) => string;
  onClose: () => void;
}

export function BuyAircraftPanel(props: BuyAircraftPanelProps) {
  const { catalog, selectedModel: m, cabinDraft, iconForModel } = props;
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<Role>('pax');
  const [maker, setMaker] = useState('all');
  const [size, setSize] = useState<'all' | OperationalTier>('all');

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = catalog
      .filter(
        (x) =>
          (role === 'all' || (role === 'cargo') === x.is_cargo) &&
          (maker === 'all' || x.manufacturer === maker) &&
          (size === 'all' || x.tier === size) &&
          (!q || [x.name, x.family, x.manufacturer, x.icao_code].some((s) => s.toLowerCase().includes(q)))
      )
      .sort(
        (a, b) =>
          BRAND_ORDER.indexOf(a.manufacturer) - BRAND_ORDER.indexOf(b.manufacturer) ||
          a.family.localeCompare(b.family) ||
          a.base_price_usd - b.base_price_usd
      );
    const byFamily = new Map<string, AircraftModel[]>();
    list.forEach((x) => byFamily.set(`${x.manufacturer}|${x.family}`, [...(byFamily.get(`${x.manufacturer}|${x.family}`) ?? []), x]));
    return [...byFamily.entries()].map(([key, models]) => ({ key, family: models[0].family, maker: models[0].manufacturer, models }));
  }, [catalog, search, role, maker, size]);

  const usage = calculateCabinUsage(m, cabinDraft);
  const tier = getAircraftTierInfo(m.tier);
  const sandbox = props.gameMode === 'sandbox';
  const leaseDeposit = m.daily_lease_usd * 7;
  const canBuy = sandbox || props.cash >= m.base_price_usd;
  const canLease = sandbox || props.cash >= leaseDeposit;

  const select = (x: AircraftModel) => {
    props.onSelectModel(x);
    props.onCabinDraftChange(getDefaultCabinForModel(x));
  };

  return (
    <SidePanel title="Buy or lease aircraft" subtitle={`New aircraft are delivered to ${props.hubIata}`} width={1060} onClose={props.onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 380px) 1fr', gap: 20, height: '100%', minHeight: 0 }}>
        {/* Catalogue */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Search model or type code" />
          <div style={{ display: 'flex', gap: 8, margin: '10px 0', flexWrap: 'wrap' }}>
            <Segmented<Role>
              size="sm"
              value={role}
              onChange={setRole}
              options={[
                { value: 'pax', label: 'Passenger' },
                { value: 'cargo', label: 'Cargo' },
                { value: 'all', label: 'All' },
              ]}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <select value={maker} onChange={(e) => setMaker(e.target.value)} style={{ ...inputStyle, padding: '5px 8px' }} aria-label="Manufacturer">
              <option value="all">All manufacturers</option>
              {BRAND_ORDER.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <select
              value={String(size)}
              onChange={(e) => setSize(e.target.value === 'all' ? 'all' : (Number(e.target.value) as OperationalTier))}
              style={{ ...inputStyle, padding: '5px 8px' }}
              aria-label="Size"
            >
              <option value="all">All sizes</option>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {getAircraftTierInfo(t).sizeLabel}
                </option>
              ))}
            </select>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', border: `1px solid ${C.line}`, borderRadius: 8 }}>
            {groups.length === 0 && <div style={{ padding: 16, fontSize: 12.5, color: C.muted }}>No aircraft match. Clear the search or filters.</div>}
            {groups.map((g) => (
              <div key={g.key}>
                <div style={{ padding: '8px 12px 4px', fontSize: 11.5, color: C.faint, background: C.panel, position: 'sticky', top: 0 }}>
                  {g.maker} {g.family.replace(new RegExp(`^${g.maker}\\s*`), '')}
                </div>
                {g.models.map((x) => {
                  const sel = x.id === m.id;
                  return (
                    <button
                      key={x.id}
                      type="button"
                      className="bp-row"
                      onClick={() => select(x)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 12px',
                        textAlign: 'left',
                        border: 'none',
                        borderLeft: `3px solid ${sel ? C.brand : 'transparent'}`,
                        background: sel ? C.raised : 'transparent',
                        color: C.text,
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13, fontWeight: sel ? 650 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {x.name.replace(/\s*\(Cargo\)$/, '')}
                        </span>
                        <span className="num" style={{ display: 'block', fontSize: 11.5, color: C.muted }}>
                          {x.is_cargo ? `${x.cargo_cap_tons} t cargo` : `${x.typical_seats} seats`}, {x.range_nm.toLocaleString()} nm
                        </span>
                      </span>
                      <span className="num" style={{ fontSize: 12.5, color: C.textDim }}>
                        {formatMoneyM(x.base_price_usd)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Details */}
        <div style={{ minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <img src={iconForModel(m)} alt="" style={{ width: 52, height: 52 }} />
            <div>
              <div style={{ fontSize: 20, fontWeight: 650, letterSpacing: '-0.01em' }}>{m.name}</div>
              <div style={{ fontSize: 12.5, color: C.muted }}>
                {tier.sizeLabel}
                {m.is_cargo ? ' freighter' : ''}, needs {m.min_runway_ft.toLocaleString()} ft of runway
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, margin: '18px 0', padding: '14px 16px', background: C.bg, borderRadius: 8, border: `1px solid ${C.line}` }}>
            <Stat label="Range" value={`${m.range_nm.toLocaleString()} nm`} />
            <Stat label="Cruise" value={`${m.cruise_speed_kts} kt`} />
            {m.is_cargo ? <Stat label="Payload" value={`${m.cargo_cap_tons} t`} /> : <Stat label="Typical seats" value={m.typical_seats} sub={`belly cargo ${m.cargo_cap_tons} t`} />}
            <Stat label="Turnaround" value={`${m.turnaround_min} min`} />
            <Stat label="Fuel burn" value={`${m.fuel_burn_kg_hr.toLocaleString()} kg/h`} />
            <Stat label="Max takeoff" value={`${Math.round(m.mtow_kg / 1000)} t`} />
            <Stat label="Type code" value={m.icao_code} />
            <Stat label="Max seats" value={m.is_cargo ? '—' : m.max_exit_limit} />
          </div>

          {!m.is_cargo ? (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 14, fontWeight: 650, marginBottom: 10 }}>Cabin layout</div>
              <CabinEditor model={m} cabin={cabinDraft} onChange={props.onCabinDraftChange} />
            </div>
          ) : (
            <div style={{ marginBottom: 18, fontSize: 13, color: C.textDim }}>
              Dedicated freighter. Carries {m.cargo_cap_tons} t on the main deck and earns from city-pair freight demand.
            </div>
          )}

          <Field label="Registration" hint="Leave as suggested, or type your own" style={{ maxWidth: 260, marginBottom: 18 }}>
            <input value={props.tailInput} onChange={(e) => props.onTailInputChange(e.target.value.toUpperCase())} style={{ ...inputStyle, fontWeight: 600 }} />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ padding: 14, border: `1px solid ${C.line}`, borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: C.muted }}>Buy outright</div>
              <div className="num" style={{ fontSize: 20, fontWeight: 650, margin: '2px 0 10px' }}>
                {formatMoneyM(m.base_price_usd)}
              </div>
              <Button variant="primary" block disabled={!usage.isValid || !canBuy} onClick={() => props.onAcquire('owned')}>
                Buy aircraft
              </Button>
              <div style={{ fontSize: 11.5, color: canBuy ? C.faint : C.red, marginTop: 6 }}>
                {canBuy ? 'Resale value is 75% of the list price' : 'Not enough cash'}
              </div>
            </div>
            <div style={{ padding: 14, border: `1px solid ${C.line}`, borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: C.muted }}>Lease</div>
              <div className="num" style={{ fontSize: 20, fontWeight: 650, margin: '2px 0 10px' }}>
                ${m.daily_lease_usd.toLocaleString()}
                <span style={{ fontSize: 13, color: C.muted, fontWeight: 500 }}> per day</span>
              </div>
              <Button variant="subtle" block disabled={!usage.isValid || !canLease} onClick={() => props.onAcquire('leased')}>
                Lease aircraft
              </Button>
              <div className="num" style={{ fontSize: 11.5, color: canLease ? C.faint : C.red, marginTop: 6 }}>
                {canLease ? `$${leaseDeposit.toLocaleString()} deposit now, then daily` : 'Not enough cash for the deposit'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </SidePanel>
  );
}
