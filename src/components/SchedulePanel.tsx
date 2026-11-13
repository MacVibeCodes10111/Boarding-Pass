import { COST_LINES } from '../game/costs';
import { useMemo, useState } from 'react';
import type { FlightEconomics } from '../game/economics';
import { calcAircraftScheduleUsage, getAircraftCircuitStatus, type AircraftCircuitStatus } from '../game/scheduling';
import { daysOrAll, formatClockShort } from '../game/time';
import type { Airport, PlayerAircraft, ScheduledFlight, Subsidiary } from '../game/types';
import { BrandSection, groupByBrand, useFoldedBrands, type BrandKey } from './BrandSections';
import { Icon } from '../ui/icons';
import { Button, C, EmptyState, IconButton, Pill, SearchInput, Segmented, SidePanel, inputStyle } from '../ui/kit';
import { legLocalText } from '../game/localTime';

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
  /** Starts the search filled in (an airport code from the map, v2.58). */
  initialSearch?: string;
  /** With subsidiaries, flights are in one fold-out section for each brand. */
  airlineName?: string;
  subsidiaries?: Subsidiary[];
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
export function SchedulePanel({ schedule, fleet, hubs, primaryHub, airportByIata, econById, onEdit, onDelete, onClose, initialSearch, airlineName = '', subsidiaries = [] }: ScheduleTabProps) {
  const [isFolded, toggleBrand] = useFoldedBrands('schedule');
  const [search, setSearch] = useState(initialSearch ?? '');
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
  /** The groups again inside one section for each brand (only with subsidiaries). */
  const brandOf = (tail: string): BrandKey => {
    const b = fleetByTail.get(tail)?.brand;
    return b && subsidiaries.some((x) => x.kind === b) ? b : 'main';
  };
  const sections = subsidiaries.length
    ? groupByBrand(fleet, (a) => a, airlineName, subsidiaries)
        .map((b) => ({
          ...b,
          groups: visibleGroups.map((g) => ({ ...g, rotations: g.rotations.filter((r) => brandOf(r.outbound.tailNumber) === b.key) })).filter((g) => g.rotations.length > 0),
        }))
        .filter((b) => b.groups.length > 0)
    : null;

  const weeklyProfit = useMemo(
    () => schedule.reduce((sum, fl) => sum + (econById.get(fl.id)?.profit ?? 0) * daysOrAll(fl.daysOfWeek).filter(Boolean).length, 0),
    [schedule, econById]
  );

  const usd = (v: number) => `${v >= 0 ? '+' : '−'}$${Math.abs(Math.round(v)).toLocaleString()}`;

  return (
    <SidePanel
      title="Schedule"
      subtitle={
        schedule.length === 0 ? undefined : (
          <>
            {schedule.length} flights ·{' '}
            <span style={{ color: weeklyProfit >= 0 ? C.green : C.red, fontWeight: 600 }}>{usd(weeklyProfit)}</span> a week
          </>
        )
      }
      width={760}
      onClose={onClose}
    >
      {schedule.length === 0 ? (
        <EmptyState title="No flights yet" body="Tap an airport on the map to plan one." />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search" style={{ flex: '1 1 160px' }} />
            <select aria-label="Aircraft" value={tailFilter} onChange={(e) => setTailFilter(e.target.value)} style={{ ...inputStyle, width: 'auto', maxWidth: 190, padding: '6px 8px' }}>
              <option value="">All aircraft</option>
              {subsidiaries.length
                ? groupByBrand(scheduledFleet, (r) => r.ac, airlineName, subsidiaries).map((g) => (
                    <optgroup key={g.key} label={g.name}>
                      {g.items.map(({ ac, usage }) => (
                        <option key={ac.tailNumber} value={ac.tailNumber}>
                          {ac.tailNumber} · {ac.model.icao_code} · {usage.usedPct}%
                        </option>
                      ))}
                    </optgroup>
                  ))
                : scheduledFleet.map(({ ac, usage }) => (
                    <option key={ac.tailNumber} value={ac.tailNumber}>
                      {ac.tailNumber} · {ac.model.icao_code} · {usage.usedPct}%
                    </option>
                  ))}
            </select>
            <Segmented<GroupBy>
              size="sm"
              value={groupBy}
              onChange={setGroupBy}
              options={[
                { value: 'hub', label: 'By hub' },
                { value: 'aircraft', label: 'By aircraft' },
              ]}
            />
          </div>
          {(sections ?? [{ key: 'main' as BrandKey, name: '', items: [], groups: visibleGroups }]).map((sec) => {
            const list = sec.groups.map((group) => {
            const open = !collapsed.has(group.key) || Boolean(search.trim()) || Boolean(tailFilter);
            return (
              <section key={`${sec.key}|${group.key}`} style={{ marginBottom: open ? 18 : 4 }}>
                <button
                  type="button"
                  className="bp-group-toggle"
                  aria-expanded={open}
                  onClick={() => toggleGroup(group.key)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px', background: 'none', border: 'none', color: C.muted, cursor: 'pointer', textAlign: 'left' }}
                >
                  <Icon name="chevron" size={13} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }} />
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{group.title}</span>
                  <span className="num" style={{ fontSize: 12, color: C.faint, whiteSpace: 'nowrap' }}>
                    {groupBy === 'hub' ? group.rotations.length : group.meta}
                  </span>
                </button>
                {open && (
                  <div className="bp-list">
                    {group.rotations.slice(0, limits[group.key] ?? ROW_PAGE).map(({ outbound, returnLeg, chainSummary }) => {
                      const ac = fleetByTail.get(outbound.tailNumber);
                      const econOut = econById.get(outbound.id);
                      const econBack = returnLeg ? econById.get(returnLeg.id) : undefined;
                      const profit = (econOut?.profit ?? 0) + (econBack?.profit ?? 0);
                      const money = `Each ${returnLeg ? 'round trip' : 'departure'}: ${usd((econOut?.revenue ?? 0) + (econBack?.revenue ?? 0))} revenue, less ${COST_LINES.map((c) => `${c.label.toLowerCase()} ${usd((econOut?.costs[c.key] ?? 0) + (econBack?.costs[c.key] ?? 0))}`).join(', ')}`;
                      const local = [
                        legLocalText(outbound.depTimeMin, outbound.arrTimeMin, outbound.origin.iata_code, outbound.destination.iata_code),
                        returnLeg ? legLocalText(returnLeg.depTimeMin, returnLeg.arrTimeMin, returnLeg.origin.iata_code, returnLeg.destination.iata_code) : '',
                      ]
                        .filter(Boolean)
                        .join('; ');
                      return (
                        <div
                          key={outbound.id}
                          className="bp-row bp-sched-row"
                          role="button"
                          tabIndex={0}
                          aria-label={`${outbound.flightNumber} ${outbound.origin.iata_code} to ${outbound.destination.iata_code}: edit`}
                          onClick={() => onEdit(outbound.tailNumber, outbound.id)}
                          onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && onEdit(outbound.tailNumber, outbound.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 8px', cursor: 'pointer', borderRadius: 0 }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 650, fontSize: 14 }}>
                                {outbound.origin.iata_code} {returnLeg ? '⇄' : '→'} {outbound.destination.iata_code}
                              </span>
                              <span className="num" style={{ fontSize: 12.5, color: C.brand }}>
                                {outbound.flightNumber}
                                {returnLeg ? ` / ${returnLeg.flightNumber}` : ''}
                              </span>
                              {econOut?.isThroughFlight && <Pill color={C.accent}>+15% connecting</Pill>}
                            </div>
                            <div className="num" title={local || undefined} style={{ fontSize: 12.5, color: C.muted, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {groupBy === 'hub' ? `${outbound.tailNumber} · ${ac?.model.icao_code ?? '?'} · ` : ''}
                              {formatClockShort(outbound.depTimeMin)}–{formatClockShort(outbound.arrTimeMin)}
                              {returnLeg ? `, back ${formatClockShort(returnLeg.depTimeMin)}–${formatClockShort(returnLeg.arrTimeMin)}` : ''} UTC
                              {chainSummary ? ` · ${chainSummary.replace(/^(Open chain|Chain): /, '')}` : ''}
                            </div>
                          </div>
                          <div className="num" title={money} style={{ flex: 'none', fontSize: 14, fontWeight: 600, color: profit >= 0 ? C.green : C.red, textAlign: 'right' }}>
                            {usd(profit)}
                          </div>
                          <IconButton
                            icon="trash"
                            label={returnLeg ? 'Delete both flights' : 'Delete flight'}
                            size={32}
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(outbound.id);
                            }}
                          />
                        </div>
                      );
                    })}
                    {group.rotations.length > (limits[group.key] ?? ROW_PAGE) && (
                      <div style={{ padding: 8, display: 'flex', justifyContent: 'center' }}>
                        <Button size="sm" onClick={() => setLimits((l) => ({ ...l, [group.key]: (l[group.key] ?? ROW_PAGE) + ROW_PAGE * 2 }))}>
                          Show {(group.rotations.length - (limits[group.key] ?? ROW_PAGE)).toLocaleString()} more
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
            });
            if (!sections) return <div key="all">{list}</div>;
            const aircraft = new Set(sec.groups.flatMap((g) => g.rotations.map((r) => r.outbound.tailNumber))).size;
            return (
              <BrandSection key={sec.key} name={sec.name} count={aircraft} open={!isFolded(sec.key)} onToggle={() => toggleBrand(sec.key)}>
                {list}
              </BrandSection>
            );
          })}
          {groups.every((g) => g.rotations.length === 0) && <div style={{ color: C.muted, fontSize: 13 }}>Nothing matches.</div>}
        </>
      )}
    </SidePanel>
  );
}
