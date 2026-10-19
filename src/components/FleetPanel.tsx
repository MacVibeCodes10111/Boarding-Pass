import { useMemo, useState } from 'react';
import { calculateCabinUsage, cabinSeatTotal } from '../game/economics';
import { calcAircraftScheduleUsage, getAircraftCircuitStatus } from '../game/scheduling';
import { calcAircraftResaleUsd } from '../game/tiers';
import { formatMoneyM } from '../game/time';
import type { AircraftModel, CabinConfig, PlayerAircraft, ScheduledFlight } from '../game/types';
import { Button, C, EmptyState, ModalShell, SearchInput, Segmented, SidePanel, inputStyle } from '../ui/kit';
import { CabinEditor } from './CabinEditor';

export interface FleetPanelProps {
  fleet: PlayerAircraft[];
  schedule: ScheduledFlight[];
  onOpenSchedule: (tailNumber: string) => void;
  onSellOrReturn: (tailNumber: string) => void;
  onUpdateCabin: (tailNumber: string, cabin: CabinConfig) => void;
  onBuy: () => void;
  iconForModel: (m: AircraftModel) => string;
  onClose: () => void;
}

const cabinSummary = (c: CabinConfig) =>
  [
    c.firstSeats && `${c.firstSeats} first`,
    c.busSeats && `${c.busSeats} business`,
    c.premSeats && `${c.premSeats} premium`,
    c.econSeats && `${c.econSeats} economy`,
  ]
    .filter(Boolean)
    .join(', ');

type GroupBy = 'type' | 'base' | 'none';
type SortBy = 'least' | 'most' | 'reg' | 'type';
type Show = 'all' | 'idle' | 'busy' | 'leased';

const PREFS_KEY = 'bp_fleet_view_v1';
function readView(): { groupBy: GroupBy; sortBy: SortBy } {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return { groupBy: v.groupBy ?? 'type', sortBy: v.sortBy ?? 'least' };
  } catch {
    return { groupBy: 'type', sortBy: 'least' };
  }
}

export function FleetPanel(props: FleetPanelProps) {
  const { fleet, schedule, iconForModel } = props;
  const [search, setSearch] = useState('');
  const [view, setViewState] = useState(readView);
  const setView = (patch: Partial<typeof view>) => {
    const next = { ...view, ...patch };
    setViewState(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };
  const [show, setShow] = useState<Show>('all');
  const [editing, setEditing] = useState<{ tail: string; cabin: CabinConfig } | null>(null);

  const all = useMemo(
    () => fleet.map((ac) => ({ ac, usage: calcAircraftScheduleUsage(ac, schedule), circuit: getAircraftCircuitStatus(ac, schedule) })),
    [fleet, schedule]
  );

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = all.filter(({ ac, usage, circuit }) => {
      if (show === 'idle' && usage.flightCount > 0) return false;
      if (show === 'busy' && usage.usedPct < 85) return false;
      if (show === 'leased' && ac.acquisition !== 'leased') return false;
      if (!q) return true;
      return [ac.tailNumber, ac.model.name, ac.model.family, ac.model.icao_code, ac.hubIata, circuit.chainPath.join(' ')].some((s) => s.toLowerCase().includes(q));
    });
    const cmp: Record<SortBy, (a: (typeof rows)[number], b: (typeof rows)[number]) => number> = {
      least: (a, b) => a.usage.usedPct - b.usage.usedPct || a.ac.tailNumber.localeCompare(b.ac.tailNumber),
      most: (a, b) => b.usage.usedPct - a.usage.usedPct || a.ac.tailNumber.localeCompare(b.ac.tailNumber),
      reg: (a, b) => a.ac.tailNumber.localeCompare(b.ac.tailNumber),
      type: (a, b) => a.ac.model.name.localeCompare(b.ac.model.name) || a.ac.tailNumber.localeCompare(b.ac.tailNumber),
    };
    rows.sort(cmp[view.sortBy]);
    const keyOf = (r: (typeof rows)[number]) => (view.groupBy === 'type' ? r.ac.model.name : view.groupBy === 'base' ? r.ac.hubIata : '');
    const map = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = keyOf(r);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [all, search, show, view]);

  const idle = all.filter((r) => r.usage.flightCount === 0).length;
  const busy = all.filter((r) => r.usage.usedPct >= 85).length;
  const leased = all.filter((r) => r.ac.acquisition === 'leased').length;
  const avgUse = all.length ? Math.round(all.reduce((s, r) => s + r.usage.usedPct, 0) / all.length) : 0;
  const shown = groups.reduce((n, [, rows]) => n + rows.length, 0);
  const editingAc = editing ? fleet.find((a) => a.tailNumber === editing.tail) : null;

  return (
    <SidePanel
      title="Fleet"
      subtitle={fleet.length === 0 ? 'No aircraft yet' : `${fleet.length} aircraft, ${avgUse}% average utilisation${idle ? `, ${idle} not scheduled` : ''}`}
      width={820}
      onClose={props.onClose}
      actions={
        <Button variant="primary" onClick={props.onBuy}>
          Buy aircraft
        </Button>
      }
    >
      {fleet.length === 0 ? (
        <EmptyState
          title="Your fleet is empty"
          body="Buy or lease your first aircraft, then click an airport on the map to schedule its first route."
          action={
            <Button variant="primary" onClick={props.onBuy}>
              Buy aircraft
            </Button>
          }
        />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search registration, type, base or route" style={{ flex: 1 }} />
            <select
              aria-label="Sort"
              value={view.sortBy}
              onChange={(e) => setView({ sortBy: e.target.value as SortBy })}
              style={{ ...inputStyle, width: 'auto', padding: '6px 8px' }}
            >
              <option value="least">Least used first</option>
              <option value="most">Most used first</option>
              <option value="reg">Registration</option>
              <option value="type">Aircraft type</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <Segmented<Show>
              size="sm"
              value={show}
              onChange={setShow}
              options={[
                { value: 'all', label: `All ${all.length}` },
                { value: 'idle', label: `Not scheduled ${idle}` },
                { value: 'busy', label: `Nearly full ${busy}`, title: '85% used or more' },
                { value: 'leased', label: `Leased ${leased}` },
              ]}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.muted }}>
              Group by
              <Segmented<GroupBy>
                size="sm"
                value={view.groupBy}
                onChange={(g) => setView({ groupBy: g })}
                options={[
                  { value: 'type', label: 'Type' },
                  { value: 'base', label: 'Base' },
                  { value: 'none', label: 'None' },
                ]}
              />
            </div>
          </div>
          {shown === 0 && <div style={{ padding: '4px 2px', fontSize: 12.5, color: C.muted }}>No aircraft match these filters.</div>}
          {groups.map(([groupKey, rows]) => (
          <section key={groupKey || 'all'} style={{ marginBottom: 16 }}>
            {groupKey && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '0 2px 6px' }}>
                <span style={{ fontSize: 13, fontWeight: 650, color: C.textSoft }}>
                  {view.groupBy === 'base' ? `Based at ${groupKey}` : groupKey}
                </span>
                <span className="num" style={{ fontSize: 12, color: C.muted }}>
                  {rows.length} aircraft, {Math.round(rows.reduce((s, r) => s + r.usage.usedPct, 0) / rows.length)}% average use
                </span>
              </div>
            )}
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden' }}>
            {rows.map(({ ac, usage, circuit }, i) => (
              <div
                key={ac.tailNumber}
                className="bp-row bp-fleet-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '28px minmax(150px, 1.4fr) minmax(110px, 1fr) 120px auto',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  borderTop: i ? `1px solid ${C.line}` : 'none',
                }}
              >
                <img src={iconForModel(ac.model)} alt="" style={{ width: 24, height: 24 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 650 }}>
                    {ac.tailNumber}
                    {ac.acquisition === 'leased' && <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 500 }}> leased</span>}
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {view.groupBy === 'type' ? `${ac.model.icao_code}, based at ${ac.hubIata}` : ac.model.name}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: C.textDim, minWidth: 0 }}>
                  <div className="num" title={ac.model.is_cargo ? undefined : cabinSummary(ac.cabin)} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ac.model.is_cargo ? `${ac.model.cargo_cap_tons} t cargo` : cabinSummary(ac.cabin) || 'No seats'}</div>
                  <div style={{ color: C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {usage.flightCount === 0 ? `Parked at ${ac.hubIata}` : circuit.chainPath.join(' – ')}
                  </div>
                </div>
                <div title={`${usage.avgDailyHours} h per day, ${usage.flightCount} flights`}>
                  <div className="num" style={{ fontSize: 12, color: usage.flightCount ? C.textDim : C.faint, marginBottom: 4 }}>
                    {usage.flightCount ? `${usage.usedPct}% used, ${usage.flightCount} flights` : 'Not scheduled'}
                  </div>
                  <div style={{ height: 4, borderRadius: 2, background: C.line, overflow: 'hidden' }}>
                    <div style={{ width: `${usage.usedPct}%`, height: '100%', background: usage.usedPct >= 85 ? C.amber : C.accent }} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <Button size="sm" onClick={() => props.onOpenSchedule(ac.tailNumber)}>
                    Schedule
                  </Button>
                  {!ac.model.is_cargo && (
                    <Button size="sm" onClick={() => setEditing({ tail: ac.tailNumber, cabin: { ...ac.cabin } })}>
                      Cabin
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    title={ac.acquisition === 'owned' ? `Sell for ${formatMoneyM(calcAircraftResaleUsd(ac.model))}` : 'Return to the lessor'}
                    onClick={() => props.onSellOrReturn(ac.tailNumber)}
                  >
                    {ac.acquisition === 'owned' ? 'Sell' : 'Return'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          </section>
          ))}
        </>
      )}

      {editing && editingAc && (
        <ModalShell onClose={() => setEditing(null)} maxWidth={560}>
          <div style={{ fontSize: 17, fontWeight: 650 }}>Cabin for {editingAc.tailNumber}</div>
          <div style={{ fontSize: 12.5, color: C.muted, margin: '2px 0 16px' }}>
            {editingAc.model.name}. Changes apply to all its flights straight away.
          </div>
          <CabinEditor model={editingAc.model} cabin={editing.cabin} onChange={(cabin) => setEditing({ ...editing, cabin })} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!calculateCabinUsage(editingAc.model, editing.cabin).isValid}
              onClick={() => {
                props.onUpdateCabin(editing.tail, editing.cabin);
                setEditing(null);
              }}
            >
              Save cabin ({cabinSeatTotal(editing.cabin)} seats)
            </Button>
          </div>
        </ModalShell>
      )}
    </SidePanel>
  );
}
