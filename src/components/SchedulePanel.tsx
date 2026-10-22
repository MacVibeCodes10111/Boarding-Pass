import { useMemo, useState } from 'react';
import type { FlightEconomics } from '../game/economics';
import { calcAircraftScheduleUsage, getAircraftCircuitStatus, type AircraftCircuitStatus } from '../game/scheduling';
import { daysOrAll, formatClockShort } from '../game/time';
import type { Airport, PlayerAircraft, ScheduledFlight } from '../game/types';
import { Icon } from '../ui/icons';
import { Button, C, EmptyState, Pill, SearchInput, Segmented, SidePanel, inputStyle } from '../ui/kit';

export interface ScheduleTabProps {
  schedule: ScheduledFlight[];
  fleet: PlayerAircraft[];
  hubs: string[];
  primaryHub: string;
  airportByIata: Map<string, Airport>;
  econById: Map<string, FlightEconomics>;
  onEdit: (tailNumber: string, flightId: string) => void;
  onDelete: (flightId: string) => void;
  onClose: () => void;
}

interface Rotation {
  outbound: ScheduledFlight;
  returnLeg: ScheduledFlight | null;
  chainSummary?: string;
}

type GroupBy = 'hub' | 'aircraft';
const COLLAPSE_KEY = 'bp_schedule_collapsed_v1';
/** Rows drawn per group before "Show more". */
const ROW_PAGE = 40;
interface Group {
  key: string;
  title: string;
  meta: string;
  rotations: Rotation[];
}

/** System schedule grouped by the owned hub each rotation starts from. */
export function SchedulePanel({ schedule, fleet, hubs, primaryHub, airportByIata, econById, onEdit, onDelete, onClose }: ScheduleTabProps) {
  const [search, setSearch] = useState('');
  const [tailFilter, setTailFilter] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('hub');
  // Collapsed groups (hubs or aircraft), remembered on this device
  const [collapsed, setCollapsedState] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]'));
    } catch {
      return new Set();
    }
  });
  const setCollapsed = (next: Set<string>) => {
    setCollapsedState(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
    } catch {
      /* storage unavailable */
    }
  };
  // Big airlines: each group draws its first rows, with "Show more" for the rest
  const [limits, setLimits] = useState<Record<string, number>>({});
  const fleetByTail = useMemo(() => new Map(fleet.map((f) => [f.tailNumber, f])), [fleet]);
  const toggleGroup = (key: string) => {
    const n = new Set(collapsed);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    setCollapsed(n);
  };

  // Aircraft with flights, least used first, for the filter menu
  const scheduledFleet = useMemo(
    () =>
      fleet
        .map((ac) => ({ ac, usage: calcAircraftScheduleUsage(ac, schedule) }))
        .filter((r) => r.usage.flightCount > 0)
        .sort((a, b) => a.usage.usedPct - b.usage.usedPct || a.ac.tailNumber.localeCompare(b.ac.tailNumber)),
    [fleet, schedule]
  );

  const groups: Group[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byTail = new Map(fleet.map((a) => [a.tailNumber, a]));
    const circuits = new Map<string, AircraftCircuitStatus>();
    fleet.forEach((ac) => circuits.set(ac.tailNumber, getAircraftCircuitStatus(ac, schedule)));

    const hubGroups = new Map<string, { hub: Airport; rotations: Rotation[] }>();
    hubs.forEach((h) => {
      const ap = airportByIata.get(h);
      if (ap) hubGroups.set(h, { hub: ap, rotations: [] });
    });

    const tailGroups = new Map<string, Rotation[]>();
    const visited = new Set<string>();
    for (const fl of [...schedule].sort((a, b) => a.depTimeMin - b.depTimeMin)) {
      if (visited.has(fl.id)) continue;
      if (tailFilter && fl.tailNumber !== tailFilter) continue;
      const ac = byTail.get(fl.tailNumber);
      const circuit = circuits.get(fl.tailNumber);

      if (q) {
        const haystack = [fl.tailNumber, fl.flightNumber, ac?.model.name, ac?.model.icao_code, fl.origin.iata_code, fl.destination.iata_code, circuit?.chainPath.join(' ')]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) continue;
      }

      const partner = fl.pairId ? schedule.find((o) => o.pairId === fl.pairId && o.id !== fl.id) ?? null : null;

      const hubKey =
        (circuit && hubs.includes(circuit.startIata) && circuit.startIata) ||
        (ac && hubs.includes(ac.hubIata) && ac.hubIata) ||
        (hubs.includes(fl.origin.iata_code) && fl.origin.iata_code) ||
        (hubs.includes(fl.destination.iata_code) && fl.destination.iata_code) ||
        primaryHub;

      // Show the leg that leaves the hub first
      const [outbound, returnLeg] =
        partner && partner.origin.iata_code === hubKey && fl.origin.iata_code !== hubKey ? [partner, fl] : [fl, partner];
      visited.add(outbound.id);
      if (returnLeg) visited.add(returnLeg.id);

      const chainSummary =
        circuit && circuit.sortedFlights.length > 1 && !returnLeg
          ? `${circuit.isClosedLoop ? 'Chain' : 'Open chain'}: ${circuit.chainPath.join(' → ')}`
          : undefined;

      if (groupBy === 'hub') {
        if (!hubGroups.has(hubKey)) hubGroups.set(hubKey, { hub: airportByIata.get(hubKey) ?? outbound.origin, rotations: [] });
        hubGroups.get(hubKey)!.rotations.push({ outbound, returnLeg, chainSummary });
      } else {
        if (!tailGroups.has(fl.tailNumber)) tailGroups.set(fl.tailNumber, []);
        tailGroups.get(fl.tailNumber)!.push({ outbound, returnLeg, chainSummary: undefined });
      }
    }
    const plural = (n: number) => `${n} ${n === 1 ? 'rotation' : 'rotations'}`;
    if (groupBy === 'hub') {
      return [...hubGroups.entries()].map(([code, g]) => ({ key: code, title: `${code} ${g.hub.municipality}`, meta: `${new Set(g.rotations.map((r) => r.outbound.tailNumber)).size} aircraft`, rotations: g.rotations }));
    }
    return [...tailGroups.entries()]
      .map(([tail, rotations]) => {
        const ac = byTail.get(tail);
        const usage = ac ? calcAircraftScheduleUsage(ac, schedule) : null;
        const circuit = circuits.get(tail);
        return {
          key: tail,
          title: `${tail}, ${ac?.model.name ?? 'unknown aircraft'}`,
          meta: `${usage ? `${usage.usedPct}% used, ` : ''}${circuit ? circuit.chainPath.join(' – ') : plural(rotations.length)}`,
          rotations,
          used: usage?.usedPct ?? 0,
        };
      })
      .sort((a, b) => a.used - b.used || a.key.localeCompare(b.key));
  }, [schedule, fleet, hubs, primaryHub, airportByIata, search, tailFilter, groupBy]);
  const visibleGroups = groups.filter((g) => g.rotations.length > 0);
  const allCollapsed = visibleGroups.length > 0 && visibleGroups.every((g) => collapsed.has(g.key));

  const weeklyProfit = useMemo(
    () => schedule.reduce((sum, fl) => sum + (econById.get(fl.id)?.profit ?? 0) * daysOrAll(fl.daysOfWeek).filter(Boolean).length, 0),
    [schedule, econById]
  );

  return (
    <SidePanel
      title="Schedule"
      subtitle={
        schedule.length === 0 ? (
          'Nothing scheduled yet'
        ) : (
          <>
            {schedule.length} flights. Estimated{' '}
            <span className="num" style={{ color: weeklyProfit >= 0 ? C.green : C.red }}>
              {weeklyProfit >= 0 ? '+' : '−'}${Math.abs(weeklyProfit).toLocaleString()}
            </span>{' '}
            per week before leases
          </>
        )
      }
      width={860}
      onClose={onClose}
    >
      {schedule.length === 0 ? (
        <EmptyState title="No flights yet" body="Click any airport on the map to open the route planner, pick an aircraft and dispatch your first route." />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search tail number, aircraft type, flight or airport" style={{ flex: 1 }} />
            <select
              aria-label="Aircraft"
              value={tailFilter}
              onChange={(e) => setTailFilter(e.target.value)}
              style={{ ...inputStyle, width: 250, padding: '6px 8px' }}
            >
              <option value="">All aircraft ({scheduledFleet.length})</option>
              {scheduledFleet.map(({ ac, usage }) => (
                <option key={ac.tailNumber} value={ac.tailNumber}>
                  {ac.tailNumber}, {ac.model.name}, {usage.usedPct}% used
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.muted, marginBottom: 14 }}>
            Group by
            <Segmented<GroupBy>
              size="sm"
              value={groupBy}
              onChange={setGroupBy}
              options={[
                { value: 'hub', label: 'Hub' },
                { value: 'aircraft', label: 'Aircraft' },
              ]}
            />
            {tailFilter && (
              <Button size="sm" variant="ghost" onClick={() => setTailFilter('')}>
                Show all aircraft
              </Button>
            )}
            <span style={{ flex: 1 }} />
            {visibleGroups.length > 1 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCollapsed(allCollapsed ? new Set([...collapsed].filter((k) => !visibleGroups.some((g) => g.key === k))) : new Set([...collapsed, ...visibleGroups.map((g) => g.key)]))}
              >
                {allCollapsed ? 'Expand all' : 'Collapse all'}
              </Button>
            )}
          </div>
          {visibleGroups.map((group) => {
            const open = !collapsed.has(group.key) || Boolean(search.trim()) || Boolean(tailFilter);
            return (
              <section key={group.key} style={{ marginBottom: open ? 20 : 8 }}>
                <button
                  type="button"
                  className="bp-group-toggle"
                  aria-expanded={open}
                  onClick={() => toggleGroup(group.key)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px', background: 'none', border: 'none', color: C.textSoft, cursor: 'pointer', textAlign: 'left' }}
                >
                  <Icon name="chevron" size={14} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s', color: C.muted }} />
                  <span style={{ fontSize: 14, fontWeight: 650, flex: 1 }}>{group.title}</span>
                  <span className="num" style={{ fontSize: 12, color: C.muted }}>
                    {group.rotations.length} {group.rotations.length === 1 ? 'route' : 'routes'}, {group.meta}
                  </span>
                </button>
                {open && (
                <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden' }}>
                  {group.rotations.slice(0, limits[group.key] ?? ROW_PAGE).map(({ outbound, returnLeg, chainSummary }, i) => {
                    const ac = fleetByTail.get(outbound.tailNumber);
                    const econOut = econById.get(outbound.id);
                    const profit = (econOut?.profit ?? 0) + (returnLeg ? econById.get(returnLeg.id)?.profit ?? 0 : 0);
                    return (
                      <div
                        key={outbound.id}
                        className="bp-row"
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr auto auto',
                          alignItems: 'center',
                          gap: 14,
                          padding: '10px 12px',
                          borderTop: i ? `1px solid ${C.line}` : 'none',
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 650, fontSize: 13.5 }}>
                              {outbound.origin.iata_code} {returnLeg ? '⇄' : '→'} {outbound.destination.iata_code}
                            </span>
                            <span className="num" style={{ fontSize: 12.5, color: C.brand }}>
                              {outbound.flightNumber}
                              {returnLeg ? ` / ${returnLeg.flightNumber}` : ''}
                            </span>
                            {econOut?.isThroughFlight && <Pill color={C.accent}>Through passengers +15%</Pill>}
                          </div>
                          <div className="num" style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                            {outbound.tailNumber}, {ac?.model.name ?? 'unknown aircraft'}. Out {formatClockShort(outbound.depTimeMin)}–{formatClockShort(outbound.arrTimeMin)}
                            {returnLeg ? `, back ${formatClockShort(returnLeg.depTimeMin)}–${formatClockShort(returnLeg.arrTimeMin)}` : ''} UTC
                            {chainSummary ? `. ${chainSummary}` : ''}
                          </div>
                        </div>
                        <div className="num" style={{ fontSize: 13, fontWeight: 600, color: profit >= 0 ? C.green : C.red, textAlign: 'right' }}>
                          {profit >= 0 ? '+' : '−'}${Math.abs(profit).toLocaleString()}
                          <div style={{ fontSize: 11, color: C.faint, fontWeight: 500 }}>per {returnLeg ? 'round trip' : 'flight'}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Button size="sm" onClick={() => onEdit(outbound.tailNumber, outbound.id)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => onDelete(outbound.id)} title={returnLeg ? 'Delete both legs' : 'Delete this flight'}>
                            Delete
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  {group.rotations.length > (limits[group.key] ?? ROW_PAGE) && (
                    <div style={{ padding: 8, borderTop: `1px solid ${C.line}`, display: 'flex', justifyContent: 'center' }}>
                      <Button size="sm" onClick={() => setLimits((l) => ({ ...l, [group.key]: (l[group.key] ?? ROW_PAGE) + ROW_PAGE * 2 }))}>
                        Show more ({(group.rotations.length - (limits[group.key] ?? ROW_PAGE)).toLocaleString()} left)
                      </Button>
                    </div>
                  )}
                </div>
                )}
              </section>
            );
          })}
          {groups.every((g) => g.rotations.length === 0) && <div style={{ color: C.muted, fontSize: 12.5 }}>No flights match these filters.</div>}
        </>
      )}
    </SidePanel>
  );
}
