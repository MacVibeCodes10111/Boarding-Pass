import { useMemo, useState } from 'react';
import type { CabinPreset } from '../game/economics';
import { leaseStatus, weeksText } from '../game/leasing';
import { calcAircraftScheduleUsage, flightsForTail, getAircraftCircuitStatus } from '../game/scheduling';
import type { AircraftModel, CabinConfig, PlayerAircraft, ScheduledFlight } from '../game/types';
import { Button, C, EmptyState, SearchInput, Segmented, SidePanel, inputStyle } from '../ui/kit';
import { BulkCabinModal, ManageAircraftModal, ReRegisterModal, ReplaceAircraftModal } from './FleetActions';

/** Rows drawn per group before "Show more". */
const ROW_PAGE = 40;

export interface FleetPanelProps {
  fleet: PlayerAircraft[];
  schedule: ScheduledFlight[];
  catalog: AircraftModel[];
  econMin: number;
  cash: number;
  sandbox: boolean;
  onOpenSchedule: (tailNumber: string) => void;
  /** Schedule several aircraft on one route together (picks the route on the map next). */
  onScheduleTogether: (tails: string[]) => void;
  onSellOrReturn: (tails: string[]) => void;
  onBuyOut: (tail: string) => void;
  onRename: (tail: string, reg: string) => string | null;
  /** New registrations for several aircraft, counting on from the one given. */
  onReRegister: (tails: string[], start: string) => string | null;
  onRefit: (tails: string[], fit: { cabin: CabinConfig } | { preset: CabinPreset }) => void;
  onReplace: (tails: string[], model: AircraftModel, mode: 'owned' | 'leased', leaseWeeks: number, dropClashing: boolean) => void;
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Big fleets: each group draws its first rows, with "Show more" for the rest
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [dialog, setDialog] = useState<{ kind: 'manage' | 'cabin' | 'replace' | 'reregister'; tails: string[] } | null>(null);
  const toggle = (tail: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(tail)) n.delete(tail);
      else n.add(tail);
      return n;
    });

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
  const shownTails = groups.flatMap(([, rows]) => rows.map((r) => r.ac.tailNumber));
  // Selected aircraft that still exist (sold ones drop out)
  const picked = fleet.filter((a) => selected.has(a.tailNumber));
  const pickedTails = picked.map((a) => a.tailNumber);
  const dialogAc = dialog ? fleet.filter((a) => dialog.tails.includes(a.tailNumber)) : [];
  const allShownPicked = shownTails.length > 0 && shownTails.every((t) => selected.has(t));

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
          <div
            className="bp-fleet-select"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              padding: '8px 10px',
              marginBottom: 12,
              borderRadius: 10,
              border: `1px solid ${picked.length ? C.brand + '66' : C.line}`,
              // Solid, so the list never shows through it as it scrolls under
              background: picked.length ? `linear-gradient(${C.brand}14, ${C.brand}14), ${C.panel}` : C.panel,
              position: 'sticky',
              top: 0,
              zIndex: 2,
              boxShadow: picked.length ? '0 6px 14px rgba(0,0,0,.35)' : 'none',
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.textDim, cursor: 'pointer' }}>
              <input
                type="checkbox"
                aria-label="Select all shown"
                checked={allShownPicked}
                onChange={() => setSelected(allShownPicked ? new Set([...selected].filter((t) => !shownTails.includes(t))) : new Set([...selected, ...shownTails]))}
              />
              {picked.length ? `${picked.length} selected` : 'Select to act on several'}
            </label>
            <span style={{ flex: 1 }} />
            {picked.length > 0 && (
              <>
                <Button size="sm" onClick={() => props.onScheduleTogether(pickedTails)}>
                  Schedule together
                </Button>
                <Button size="sm" disabled={picked.every((a) => a.model.is_cargo)} onClick={() => setDialog({ kind: 'cabin', tails: pickedTails })}>
                  Cabin
                </Button>
                <Button size="sm" onClick={() => setDialog({ kind: 'replace', tails: pickedTails })}>
                  Replace
                </Button>
                <Button size="sm" onClick={() => setDialog({ kind: 'reregister', tails: pickedTails })}>
                  Re-register
                </Button>
                <Button size="sm" variant="ghost" onClick={() => props.onSellOrReturn(pickedTails)}>
                  Sell or return
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </>
            )}
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
            {rows.slice(0, limits[groupKey] ?? ROW_PAGE).map(({ ac, usage, circuit }, i) => (
              <div
                key={ac.tailNumber}
                className="bp-row bp-fleet-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '22px 28px minmax(150px, 1.4fr) minmax(110px, 1fr) 120px auto',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  borderTop: i ? `1px solid ${C.line}` : 'none',
                }}
              >
                <input type="checkbox" aria-label={`Select ${ac.tailNumber}`} checked={selected.has(ac.tailNumber)} onChange={() => toggle(ac.tailNumber)} />
                <img src={iconForModel(ac.model)} alt="" style={{ width: 24, height: 24 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 650 }}>
                    {ac.tailNumber}
                    {ac.acquisition === 'leased' && (
                      <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 500 }}>
                        {' '}
                        leased{ac.lease ? `, ${weeksText(leaseStatus(ac, props.econMin).weeksLeft)}` : ''}
                      </span>
                    )}
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
                  <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'manage', tails: [ac.tailNumber] })}>
                    Manage
                  </Button>
                </div>
              </div>
            ))}
            {rows.length > (limits[groupKey] ?? ROW_PAGE) && (
              <div style={{ padding: 8, borderTop: `1px solid ${C.line}`, display: 'flex', justifyContent: 'center' }}>
                <Button size="sm" onClick={() => setLimits((l) => ({ ...l, [groupKey]: (l[groupKey] ?? ROW_PAGE) + ROW_PAGE * 2 }))}>
                  Show more ({(rows.length - (limits[groupKey] ?? ROW_PAGE)).toLocaleString()} left)
                </Button>
              </div>
            )}
          </div>
          </section>
          ))}
        </>
      )}

      {dialog?.kind === 'manage' && dialogAc[0] && (
        <ManageAircraftModal
          aircraft={dialogAc[0]}
          econMin={props.econMin}
          flights={flightsForTail(schedule, dialogAc[0].tailNumber).length}
          onRename={(reg) => {
            const err = props.onRename(dialogAc[0].tailNumber, reg);
            if (!err) setDialog({ kind: 'manage', tails: [reg.trim().toUpperCase()] });
            return err;
          }}
          onSellOrReturn={() => {
            props.onSellOrReturn([dialogAc[0].tailNumber]);
            setDialog(null);
          }}
          onBuyOut={() => props.onBuyOut(dialogAc[0].tailNumber)}
          onCabin={() => setDialog({ kind: 'cabin', tails: [dialogAc[0].tailNumber] })}
          onReplace={() => setDialog({ kind: 'replace', tails: [dialogAc[0].tailNumber] })}
          onSchedule={() => {
            setDialog(null);
            props.onOpenSchedule(dialogAc[0].tailNumber);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'cabin' && dialogAc.length > 0 && (
        <BulkCabinModal
          aircraft={dialogAc}
          onRefit={(fit) => {
            props.onRefit(dialog.tails, fit);
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'reregister' && dialogAc.length > 0 && (
        <ReRegisterModal
          aircraft={dialogAc}
          fleet={fleet.map((f) => f.tailNumber)}
          onApply={(start) => {
            const err = props.onReRegister(dialog.tails, start);
            if (!err) {
              setDialog(null);
              setSelected(new Set());
            }
            return err;
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'replace' && dialogAc.length > 0 && (
        <ReplaceAircraftModal
          aircraft={dialogAc}
          schedule={schedule}
          catalog={props.catalog}
          econMin={props.econMin}
          cash={props.cash}
          sandbox={props.sandbox}
          onReplace={(model, mode, weeks, drop) => {
            props.onReplace(dialog.tails, model, mode, weeks, drop);
            setDialog(null);
            setSelected(new Set());
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </SidePanel>
  );
}
