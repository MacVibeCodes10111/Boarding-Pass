import { AircraftPhoto, SpecialTag } from './AircraftPhoto';
import { useMemo, useState } from 'react';
import type { CabinPreset } from '../game/economics';
import { leaseStatus, weeksText } from '../game/leasing';
import { calcAircraftScheduleUsage, flightsForTail, getAircraftCircuitStatus } from '../game/scheduling';
import { brandAllows } from '../game/subsidiaries';
import type { AircraftModel, BrandKind, CabinConfig, PlayerAircraft, ScheduledFlight, Subsidiary } from '../game/types';
import { Button, C, EmptyState, IconButton, SearchInput, Segmented, SidePanel, inputStyle } from '../ui/kit';
import { useLayout } from '../ui/layout';
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
  /** Opens the livery editor. */
  onLivery?: () => void;
  /** The airline's liveries by name: with two, aircraft can wear the second (special) one. */
  liveryNames?: string[];
  onSetLivery?: (tails: string[], index: number) => void;
  /** The airline's name, and its regional and cargo brands: aircraft can fly for one of them. */
  airlineName: string;
  subsidiaries: Subsidiary[];
  onSetBrand: (tails: string[], kind: BrandKind | null) => void;
  onReplace: (tails: string[], model: AircraftModel, mode: 'owned' | 'leased', leaseWeeks: number, dropClashing: boolean) => void;
  onBuy: () => void;
  iconForModel: (m: AircraftModel) => string;
  onClose: () => void;
}

type GroupBy = 'type' | 'base' | 'brand' | 'none';
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
  const { fleet, schedule, iconForModel, subsidiaries } = props;
  const brandName = (ac: PlayerAircraft) => (ac.brand && subsidiaries.find((b) => b.kind === ac.brand)?.name) || props.airlineName;
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
  const phone = useLayout() === "phone";
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
      return [ac.tailNumber, ac.model.name, ac.model.family, ac.model.icao_code, ac.hubIata, circuit.chainPath.join(' '), ac.brand ? brandName(ac) : ''].some((s) => s.toLowerCase().includes(q));
    });
    const cmp: Record<SortBy, (a: (typeof rows)[number], b: (typeof rows)[number]) => number> = {
      least: (a, b) => a.usage.usedPct - b.usage.usedPct || a.ac.tailNumber.localeCompare(b.ac.tailNumber),
      most: (a, b) => b.usage.usedPct - a.usage.usedPct || a.ac.tailNumber.localeCompare(b.ac.tailNumber),
      reg: (a, b) => a.ac.tailNumber.localeCompare(b.ac.tailNumber),
      type: (a, b) => a.ac.model.name.localeCompare(b.ac.model.name) || a.ac.tailNumber.localeCompare(b.ac.tailNumber),
    };
    rows.sort(cmp[view.sortBy]);
    const keyOf = (r: (typeof rows)[number]) => (view.groupBy === 'type' ? r.ac.model.name : view.groupBy === 'base' ? r.ac.hubIata : view.groupBy === 'brand' ? brandName(r.ac) : '');
    const map = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = keyOf(r);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, search, show, view, subsidiaries, props.airlineName]);

  const idle = all.filter((r) => r.usage.flightCount === 0).length;
  const busy = all.filter((r) => r.usage.usedPct >= 85).length;
  const leased = all.filter((r) => r.ac.acquisition === 'leased').length;
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
      width={760}
      onClose={props.onClose}
      actions={
        <Button variant="primary" onClick={props.onBuy}>
          Buy aircraft
        </Button>
      }
    >
      {fleet.length === 0 ? (
        <EmptyState
          title="No aircraft yet"
          action={
            <Button variant="primary" onClick={props.onBuy}>
              Buy aircraft
            </Button>
          }
        />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search" style={{ flex: 1 }} />
            <select aria-label="Sort" value={view.sortBy} onChange={(e) => setView({ sortBy: e.target.value as SortBy })} style={{ ...inputStyle, width: 'auto', padding: '6px 8px' }}>
              <option value="least">Least used</option>
              <option value="most">Most used</option>
              <option value="reg">Registration</option>
              <option value="type">Type</option>
            </select>
            <select aria-label="Group" value={view.groupBy} onChange={(e) => setView({ groupBy: e.target.value as GroupBy })} style={{ ...inputStyle, width: 'auto', padding: '6px 8px' }}>
              <option value="type">By type</option>
              <option value="base">By base</option>
              {subsidiaries.length > 0 && <option value="brand">By brand</option>}
              <option value="none">One list</option>
            </select>
          </div>
          <div className="bp-scroll-x" style={{ marginBottom: 12 }}>
            <Segmented<Show>
              size="sm"
              value={show}
              onChange={setShow}
              options={[
                { value: 'all', label: `All ${all.length}` },
                { value: 'idle', label: `Idle ${idle}`, title: 'No flights' },
                { value: 'busy', label: `Busy ${busy}`, title: '85% used or more' },
                { value: 'leased', label: `Leased ${leased}` },
              ]}
            />
          </div>
          {picked.length > 0 && (
            <div
              className="bp-fleet-select"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexWrap: 'wrap',
                padding: '8px 10px',
                marginBottom: 10,
                borderRadius: 12,
                // Solid, so the list never shows through it as it scrolls under
                background: `linear-gradient(${C.brand}24, ${C.brand}24), ${C.panel}`,
                position: 'sticky',
                top: 0,
                zIndex: 2,
                boxShadow: '0 6px 14px rgba(0,0,0,.3)',
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: C.text, cursor: 'pointer', marginRight: 4 }}>
                <input
                  type="checkbox"
                  aria-label="Select all shown"
                  checked={allShownPicked}
                  onChange={() => setSelected(allShownPicked ? new Set([...selected].filter((t) => !shownTails.includes(t))) : new Set([...selected, ...shownTails]))}
                />
                {picked.length} selected
              </label>
              <span style={{ flex: 1 }} />
              <Button size="sm" onClick={() => props.onScheduleTogether(pickedTails)}>
                Schedule
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
              {props.onSetLivery && (props.liveryNames?.length ?? 0) > 1 && (
                <Button size="sm" onClick={() => props.onSetLivery!(pickedTails, picked.every((a) => a.livery === 1) ? 0 : 1)}>
                  {picked.every((a) => a.livery === 1) ? 'Main livery' : 'Special livery'}
                </Button>
              )}
              {subsidiaries.length > 0 && (
                <select
                  aria-label="Flies for"
                  title="Which brand the selected aircraft fly for"
                  value=""
                  onChange={(e) => e.target.value && props.onSetBrand(pickedTails, e.target.value === 'main' ? null : (e.target.value as BrandKind))}
                  style={{ ...inputStyle, width: 'auto', padding: '4px 8px', fontSize: 13 }}
                >
                  <option value="">Flies for…</option>
                  <option value="main">{props.airlineName}</option>
                  {subsidiaries.map((b) => (
                    <option key={b.kind} value={b.kind} disabled={!picked.some((a) => brandAllows(b.kind, a.model))}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
              <Button size="sm" variant="danger" onClick={() => props.onSellOrReturn(pickedTails)}>
                Sell
              </Button>
              <IconButton icon="close" label="Clear selection" size={30} iconSize={14} onClick={() => setSelected(new Set())} />
            </div>
          )}
          {shown === 0 && <div style={{ padding: '4px 2px', fontSize: 13, color: C.muted }}>Nothing matches.</div>}
          {groups.map(([groupKey, rows]) => (
            <section key={groupKey || 'all'} style={{ marginBottom: 18 }}>
              {groupKey && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '0 2px 4px' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.muted }}>{groupKey}</span>
                  <span className="num" style={{ fontSize: 12, color: C.faint }}>
                    {rows.length}
                  </span>
                </div>
              )}
              <div className="bp-list">
                {rows.slice(0, limits[groupKey] ?? ROW_PAGE).map(({ ac, usage, circuit }) => (
                  <div
                    key={ac.tailNumber}
                    className="bp-row bp-fleet-row"
                    role="button"
                    tabIndex={0}
                    aria-label={`${ac.tailNumber}: open`}
                    onClick={() => props.onOpenSchedule(ac.tailNumber)}
                    onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && props.onOpenSchedule(ac.tailNumber)}
                    style={{ display: 'flex', alignItems: 'center', gap: phone ? 10 : 14, padding: phone ? '10px 4px' : '9px 8px', cursor: 'pointer', borderRadius: 0 }}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${ac.tailNumber}`}
                      checked={selected.has(ac.tailNumber)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggle(ac.tailNumber)}
                      style={{ flex: 'none' }}
                    />
                    <AircraftPhoto model={ac.model} width={phone ? 58 : 72} fallback={iconForModel(ac.model)} tailNumber={ac.tailNumber} liveryIndex={ac.livery} brand={ac.brand} style={{ flex: 'none' }} />
                    <div style={{ flex: '1 1 0', minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, fontSize: 14, fontWeight: 650, whiteSpace: 'nowrap' }}>
                        <span style={{ flex: 'none' }}>{ac.tailNumber}</span>
                        {ac.brand && view.groupBy !== 'brand' && (
                          <span title={`Flies for ${brandName(ac)}`} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', marginLeft: 6, padding: '1px 7px', borderRadius: 99, background: `${C.brand}1f`, color: C.brand, fontSize: 10.5, fontWeight: 700 }}>
                            {brandName(ac)}
                          </span>
                        )}
                        {!ac.brand && ac.livery === 1 && (props.liveryNames?.length ?? 0) > 1 && (
                          <span style={{ minWidth: 0, overflow: 'hidden' }}>
                            <SpecialTag name={props.liveryNames![1]} />
                          </span>
                        )}
                      </div>
                      <div className="num" style={{ fontSize: 12.5, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {view.groupBy === 'type' ? ac.hubIata : `${ac.model.icao_code} · ${ac.hubIata}`}
                        {ac.acquisition === 'leased' ? ` · leased${ac.lease ? `, ${weeksText(leaseStatus(ac, props.econMin).weeksLeft)}` : ''}` : ''}
                        {phone && usage.flightCount > 0 ? ` · ${usage.usedPct}%` : ''}
                      </div>
                    </div>
                    <div className="num" style={{ flex: '1.2 1 0', minWidth: 0, fontSize: 13, color: usage.flightCount ? C.textDim : C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {usage.flightCount === 0 ? 'Idle' : circuit.chainPath.join(' – ')}
                    </div>
                    <div className="bp-hide-phone" title={`${usage.avgDailyHours} h a day, ${usage.flightCount} flights`} style={{ flex: 'none', width: 92, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 4, borderRadius: 2, background: C.line, overflow: 'hidden' }}>
                        <div style={{ width: `${usage.usedPct}%`, height: '100%', background: usage.usedPct >= 85 ? C.amber : C.accent }} />
                      </div>
                      <span className="num" style={{ width: 32, textAlign: 'right', fontSize: 12.5, color: usage.flightCount ? C.textDim : C.faint }}>
                        {usage.usedPct}%
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDialog({ kind: 'manage', tails: [ac.tailNumber] });
                      }}
                    >
                      Manage
                    </Button>
                  </div>
                ))}
              </div>
              {rows.length > (limits[groupKey] ?? ROW_PAGE) && (
                <div style={{ padding: 8, display: 'flex', justifyContent: 'center' }}>
                  <Button size="sm" onClick={() => setLimits((l) => ({ ...l, [groupKey]: (l[groupKey] ?? ROW_PAGE) + ROW_PAGE * 2 }))}>
                    Show {(rows.length - (limits[groupKey] ?? ROW_PAGE)).toLocaleString()} more
                  </Button>
                </div>
              )}
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
          airlineName={props.airlineName}
          subsidiaries={subsidiaries}
          onSetBrand={(kind) => props.onSetBrand([dialogAc[0].tailNumber], kind)}
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
