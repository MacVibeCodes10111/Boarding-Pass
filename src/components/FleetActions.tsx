// ============================================================================
// FLEET ACTIONS (v2.38+): manage one aircraft (registration, lease, sell),
// replace aircraft with another type, refit several cabins at once.
// ============================================================================
import { useMemo, useState } from 'react';
import { CABIN_PRESET_LABELS, calculateCabinUsage, cabinSeatTotal, type CabinPreset } from '../game/economics';
import { checkReplacement, replacementSummary } from '../game/fleetOps';
import { DEFAULT_LEASE_WEEKS, LEASE_OPTIONS, buyoutPrice, leaseQuote, leaseStatus, returnTerms, weeksText } from '../game/leasing';
import { calcAircraftResaleUsd } from '../game/tiers';
import { formatMoneyM } from '../game/time';
import type { AircraftModel, CabinConfig, PlayerAircraft, ScheduledFlight } from '../game/types';
import { Button, C, Field, ModalShell, Segmented, inputStyle } from '../ui/kit';
import { CabinEditor } from './CabinEditor';

const money = (v: number) => formatMoneyM(v, 2);

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, padding: '3px 0', color: strong ? C.text : C.textDim }}>
      <span style={{ color: C.muted }}>{k}</span>
      <span className="num" style={{ fontWeight: strong ? 650 : 500 }}>
        {v}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One aircraft
// ---------------------------------------------------------------------------
export function ManageAircraftModal(props: {
  aircraft: PlayerAircraft;
  econMin: number;
  flights: number;
  onRename: (reg: string) => string | null;
  onSellOrReturn: () => void;
  onBuyOut: () => void;
  onCabin: () => void;
  onReplace: () => void;
  onSchedule: () => void;
  onClose: () => void;
}) {
  const { aircraft: ac, econMin } = props;
  const [reg, setReg] = useState(ac.tailNumber);
  const [err, setErr] = useState<string | null>(null);
  const leased = ac.acquisition === 'leased';
  const st = leaseStatus(ac, econMin);
  const rt = returnTerms(ac, econMin);
  return (
    <ModalShell onClose={props.onClose} maxWidth={520}>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{ac.tailNumber}</div>
      <div style={{ fontSize: 12.5, color: C.muted, margin: '2px 0 16px' }}>
        {ac.model.name}, based at {ac.hubIata}. {props.flights ? `${props.flights} flights scheduled.` : 'No flights yet.'}
      </div>

      <Field label="Registration" hint="Letters, digits and dashes. Its flights keep their numbers." style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            aria-label="Registration"
            value={reg}
            maxLength={10}
            onChange={(e) => {
              setReg(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''));
              setErr(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && setErr(props.onRename(reg))}
            style={{ ...inputStyle, fontWeight: 650, flex: 1 }}
          />
          <Button disabled={reg === ac.tailNumber} onClick={() => setErr(props.onRename(reg))}>
            Rename
          </Button>
        </div>
        {err && <div style={{ color: C.red, fontSize: 12, marginTop: 6 }}>{err}</div>}
      </Field>

      <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 4 }}>{leased ? 'Lease' : 'Owned'}</div>
        {leased ? (
          ac.lease ? (
            <>
              <Row k="Lease payment" v={`$${ac.lease.dailyRate.toLocaleString()} a day`} />
              <Row k="Term" v={`${ac.lease.termWeeks} weeks, ${weeksText(st.weeksLeft)}`} />
              <Row k="Deposit paid" v={money(ac.lease.deposit)} />
              <Row k={rt.early ? 'Returned now, you get back' : 'Returned now, deposit back'} v={money(rt.refund)} strong />
              {rt.early && <Row k="Kept by the lessor for ending early" v={money(rt.forfeit)} />}
              <Row k="Buy-out price (deposit refunded too)" v={money(buyoutPrice(ac, econMin))} strong />
            </>
          ) : (
            <>
              <Row k="Lease payment" v={`$${ac.model.daily_lease_usd.toLocaleString()} a day, week to week`} />
              <Row k="Buy-out price" v={money(buyoutPrice(ac, econMin))} strong />
            </>
          )
        ) : (
          <Row k="Resale value (75% of list)" v={money(calcAircraftResaleUsd(ac.model))} strong />
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Button onClick={props.onSchedule}>Schedule</Button>
        {!ac.model.is_cargo && <Button onClick={props.onCabin}>Cabin</Button>}
        <Button onClick={props.onReplace}>Replace with another type</Button>
        {leased && (
          <Button variant="primary" onClick={props.onBuyOut}>
            Buy out
          </Button>
        )}
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={props.onSellOrReturn}>
          {leased ? (rt.early ? 'Return early' : 'Return') : 'Sell'}
        </Button>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Replace aircraft (one or many) with another type
// ---------------------------------------------------------------------------
export function ReplaceAircraftModal(props: {
  aircraft: PlayerAircraft[];
  schedule: ScheduledFlight[];
  catalog: AircraftModel[];
  econMin: number;
  cash: number;
  sandbox: boolean;
  onReplace: (model: AircraftModel, mode: 'owned' | 'leased', leaseWeeks: number, dropClashing: boolean) => void;
  onClose: () => void;
}) {
  const { aircraft: list, schedule, econMin } = props;
  const sameType = list.every((a) => a.model.id === list[0].model.id);
  const cargo = list.some((a) => a.model.is_cargo);
  const choices = useMemo(() => props.catalog.filter((m) => m.is_cargo === cargo).sort((a, b) => a.name.localeCompare(b.name)), [props.catalog, cargo]);
  const [modelId, setModelId] = useState(() => (choices.find((m) => m.id !== list[0].model.id) ?? choices[0]).id);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'owned' | 'leased'>(list[0].acquisition);
  const [weeks, setWeeks] = useState(DEFAULT_LEASE_WEEKS);
  const [drop, setDrop] = useState(false);
  const model = choices.find((m) => m.id === modelId) ?? choices[0];
  const checks = useMemo(() => list.map((a) => ({ ac: a, c: checkReplacement(a, model, schedule) })), [list, model, schedule]);
  const quote = leaseQuote(model, weeks, econMin);
  const each = mode === 'owned' ? model.base_price_usd : quote.deposit;
  const incoming = list.reduce((s, a) => s + (a.acquisition === 'owned' ? calcAircraftResaleUsd(a.model) : returnTerms(a, econMin).refund), 0);
  const forfeit = list.reduce((s, a) => s + (a.acquisition === 'leased' ? returnTerms(a, econMin).forfeit : 0), 0);
  const anyClash = checks.some((x) => x.c.clashes.length);
  const blocked = checks.filter((x) => x.c.clashes.length && !drop).length;
  const net = each * (list.length - blocked) - incoming;
  const shown = choices.filter((m) => !search.trim() || m.name.toLowerCase().includes(search.trim().toLowerCase()));
  const affordable = props.sandbox || props.cash >= net;
  return (
    <ModalShell onClose={props.onClose} maxWidth={640}>
      <div style={{ fontSize: 18, fontWeight: 700 }}>Replace {list.length === 1 ? list[0].tailNumber : `${list.length} aircraft`}</div>
      <div style={{ fontSize: 12.5, color: C.muted, margin: '2px 0 14px', lineHeight: 1.45 }}>
        {sameType ? `${list[0].model.name}. ` : ''}Each new aircraft takes over its flights, re-timed for the new type's speed and turnaround. Flights it can't fly are dropped. The old
        aircraft {list.every((a) => a.acquisition === 'owned') ? 'are sold' : 'are sold or returned'}.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, marginBottom: 12 }}>
        <input aria-label="Search aircraft types" placeholder="Search aircraft types" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle }} />
        <select aria-label="New aircraft type" value={model.id} onChange={(e) => setModelId(e.target.value)} style={{ ...inputStyle, fontWeight: 600 }} size={Math.min(7, Math.max(3, shown.length))}>
          {shown.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}, {m.typical_seats || `${m.cargo_cap_tons} t`} {m.is_cargo ? '' : 'seats'}, {m.range_nm.toLocaleString()} nm
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <Segmented<'owned' | 'leased'>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'owned', label: `Buy, ${money(model.base_price_usd)}` },
            { value: 'leased', label: 'Lease' },
          ]}
        />
        {mode === 'leased' && (
          <Segmented<string>
            size="sm"
            value={String(weeks)}
            onChange={(w) => setWeeks(Number(w))}
            options={LEASE_OPTIONS.map((o) => ({ value: String(o.weeks), label: o.label }))}
          />
        )}
      </div>
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, overflow: 'hidden', marginBottom: 12, maxHeight: 220, overflowY: 'auto' }}>
        {checks.map(({ ac, c }, i) => (
          <details key={ac.tailNumber} style={{ borderTop: i ? `1px solid ${C.line}` : 'none', padding: '8px 12px' }}>
            <summary style={{ cursor: 'pointer', fontSize: 12.5, display: 'flex', gap: 8 }}>
              <b>{ac.tailNumber}</b>
              <span style={{ flex: 1, color: c.clashes.length ? C.amber : c.dropped.length ? C.amber : C.muted }}>{replacementSummary(c)}</span>
            </summary>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
              {c.dropped.map((d) => (
                <div key={d.flight.id}>
                  {d.flight.flightNumber} {d.flight.origin.iata_code}→{d.flight.destination.iata_code}: {d.reason}
                </div>
              ))}
              {c.clashes.map((x) => (
                <div key={x}>{x}</div>
              ))}
              {!c.dropped.length && !c.clashes.length && <div>Every flight fits.</div>}
            </div>
          </details>
        ))}
      </div>
      {anyClash && (
        <label style={{ display: 'flex', gap: 8, fontSize: 12.5, color: C.textDim, marginBottom: 12, alignItems: 'center' }}>
          <input type="checkbox" checked={drop} onChange={(e) => setDrop(e.target.checked)} />
          Drop flights that no longer fit{blocked ? ` (otherwise ${blocked} ${blocked === 1 ? 'aircraft is' : 'aircraft are'} left as they are)` : ''}
        </label>
      )}
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: '8px 12px', marginBottom: 14 }}>
        <Row k={`${list.length - blocked} new ${model.name}`} v={money(each * (list.length - blocked))} />
        <Row k="The old aircraft bring in" v={money(incoming)} />
        {forfeit > 0 && <Row k="Deposit kept for ending leases early" v={money(forfeit)} />}
        <Row k={net >= 0 ? 'You pay' : 'You get'} v={money(Math.abs(net))} strong />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button variant="primary" disabled={!affordable || blocked === list.length} onClick={() => props.onReplace(model, mode, weeks, drop)}>
          {affordable ? `Replace ${list.length - blocked === 1 ? 'aircraft' : `${list.length - blocked} aircraft`}` : 'Not enough cash'}
        </Button>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Refit several cabins
// ---------------------------------------------------------------------------
export function BulkCabinModal(props: { aircraft: PlayerAircraft[]; onRefit: (fit: { cabin: CabinConfig } | { preset: CabinPreset }) => void; onClose: () => void }) {
  const list = props.aircraft.filter((a) => !a.model.is_cargo);
  const sameType = list.length > 0 && list.every((a) => a.model.id === list[0].model.id);
  const [cabin, setCabin] = useState<CabinConfig>(() => ({ ...(list[0]?.cabin ?? props.aircraft[0].cabin) }));
  return (
    <ModalShell onClose={props.onClose} maxWidth={560}>
      <div style={{ fontSize: 17, fontWeight: 650 }}>Cabins for {list.length === 1 ? list[0].tailNumber : `${list.length} aircraft`}</div>
      <div style={{ fontSize: 12.5, color: C.muted, margin: '2px 0 16px' }}>
        {sameType
          ? `${list[0].model.name}. The same cabin goes into every one, and applies to their flights straight away.`
          : 'These are different types, so pick a layout style: each aircraft gets that style sized for its own cabin.'}
      </div>
      {list.length === 0 ? (
        <div style={{ fontSize: 12.5, color: C.muted }}>Freighters have no cabin.</div>
      ) : sameType ? (
        <>
          <CabinEditor model={list[0].model} cabin={cabin} onChange={setCabin} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <Button onClick={props.onClose}>Cancel</Button>
            <Button variant="primary" disabled={!calculateCabinUsage(list[0].model, cabin).isValid} onClick={() => props.onRefit({ cabin })}>
              Fit to {list.length === 1 ? 'it' : `all ${list.length}`} ({cabinSeatTotal(cabin)} seats)
            </Button>
          </div>
        </>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {(Object.keys(CABIN_PRESET_LABELS) as CabinPreset[]).map((p) => (
            <Button key={p} block onClick={() => props.onRefit({ preset: p })}>
              {CABIN_PRESET_LABELS[p].label}: {CABIN_PRESET_LABELS[p].hint}
            </Button>
          ))}
        </div>
      )}
    </ModalShell>
  );
}
