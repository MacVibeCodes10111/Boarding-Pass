import { useMemo } from 'react';
import { airlinesOnPair } from '../game/demand';
import { calcRouteServedCapacity, getRouteDemandAndFares } from '../game/economics';
import type { Airport, PlayerAircraft, ScheduledFlight } from '../game/types';
import { C, Meter } from '../ui/kit';

export interface RouteDemandBarProps {
  origin: Airport;
  destination: Airport;
  distanceNm: number;
  playerHubs: string[];
  allSchedule: ScheduledFlight[];
  fleet: PlayerAircraft[];
  compact?: boolean;
}

/** Daily passenger + cargo demand on a route vs. the capacity you already fly on it. */
export function RouteDemandBar({ origin, destination, distanceNm, playerHubs, allSchedule, fleet, compact = false }: RouteDemandBarProps) {
  const demand = useMemo(
    () => getRouteDemandAndFares(origin, destination, distanceNm, playerHubs, allSchedule),
    [origin, destination, distanceNm, playerHubs, allSchedule]
  );
  const served = useMemo(
    () => calcRouteServedCapacity(origin.iata_code, destination.iata_code, allSchedule, fleet),
    [origin.iata_code, destination.iata_code, allSchedule, fleet]
  );

  const rivals = useMemo(() => airlinesOnPair(origin.iata_code, destination.iata_code), [origin.iata_code, destination.iata_code]);
  const totalDem = Math.max(1, demand.dailyPax.total);
  const paxPct = Math.round((served.dailySeats / totalDem) * 100);
  const cargoDem = Math.max(0.5, demand.dailyCargoTons);
  const cargoPct = Math.round((served.dailyCargoTons / cargoDem) * 100);
  const bonuses = [
    demand.isHubToHub ? `hub to hub +${demand.hubBonusPct}%` : '',
    demand.connectingBoostPct > 0 ? `connections +${demand.connectingBoostPct}%` : '',
  ].filter(Boolean);

  const row = (label: string, value: string, pct: number, color: string) => (
    <div style={{ marginBottom: 8 }}>
      <div className="num" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: C.textDim }}>{label}</span>
        <span style={{ color: pct > 100 ? C.amber : C.muted }}>{value}</span>
      </div>
      <Meter pct={pct} gradient={pct > 100 ? C.amber : color} height={5} />
    </div>
  );

  return (
    <div style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, padding: '10px 12px 4px', marginBottom: compact ? 12 : 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          Demand {origin.iata_code} → {destination.iata_code}
        </span>
        {bonuses.length > 0 && <span style={{ fontSize: 11.5, color: C.green }}>{bonuses.join(', ')}</span>}
      </div>
      {row(
        'Passengers per day',
        `you fly ${served.dailySeats.toLocaleString()} of ${totalDem.toLocaleString()} (${paxPct}%)`,
        paxPct,
        C.accent
      )}
      {demand.marketPax !== null && (
        <div className="bp-route-market" style={{ fontSize: 11.5, color: C.muted, margin: '-2px 0 8px', lineHeight: 1.45 }}>
          About {demand.marketPax.toLocaleString()} people a day travel this way.{' '}
          {rivals.length > 0
            ? `Flown today by ${rivals
                .slice(0, 4)
                .map((c) => c.name)
                .join(', ')}${rivals.length > 4 ? ` and ${rivals.length - 4} more` : ''}.`
            : 'No airline flies it today.'}
        </div>
      )}
      {!compact && (
        <div className="num" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, fontSize: 11.5, color: C.muted, margin: '-2px 0 8px' }}>
          {(
            [
              ['Economy', 'econ'],
              ['Premium', 'prem'],
              ['Business', 'bus'],
              ['First', 'first'],
            ] as const
          ).map(([label, k]) => (
            <span key={k}>
              {label} <b style={{ color: C.textDim, fontWeight: 600 }}>{served.byClass[k]}</b>/{demand.dailyPax[k]}
            </span>
          ))}
        </div>
      )}
      {row('Cargo per day', `${served.dailyCargoTons} of ${cargoDem} t (${cargoPct}%), market $${demand.refFares.cargoPerTon}/t`, cargoPct, '#c9a368')}
    </div>
  );
}
