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
  /** The aircraft being scheduled: a passenger aircraft can't take big parcels, so that row is greyed. */
  aircraft?: PlayerAircraft | null;
}

/** Daily passenger + cargo demand on a route vs. the capacity you already fly on it. */
export function RouteDemandBar({ origin, destination, distanceNm, playerHubs, allSchedule, fleet, compact = false, aircraft }: RouteDemandBarProps) {
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
  // Small parcels fill any hold; big parcels only what freighters fly
  const smallDem = demand.cargo.parcels;
  const bigDem = demand.cargo.freight;
  const smallPct = smallDem > 0 ? Math.round((served.dailyCargoTons / smallDem) * 100) : 0;
  const bigPct = bigDem > 0 ? Math.round((served.dailyFreightTons / bigDem) * 100) : 0;
  const paxPlane = aircraft ? !aircraft.model.is_cargo : false;
  const who = demand.kind === 'business' ? ', many on business' : demand.kind === 'leisure' ? ', mostly on holiday' : '';
  const oneWay = demand.cargo.direction >= 1.2 ? 'heavier this way' : demand.cargo.direction <= 0.83 ? 'lighter this way' : '';
  const bonuses = [
    demand.isHubToHub ? `hub to hub +${demand.hubBonusPct}%` : '',
    demand.connectingBoostPct > 0 ? `connections +${demand.connectingBoostPct}%` : '',
  ].filter(Boolean);

  const row = (label: string, value: string, pct: number, color: string, dim = false, title?: string) => (
    <div style={{ marginBottom: 8, opacity: dim ? 0.45 : 1 }} title={title}>
      <div className="num" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: C.textDim }}>{label}</span>
        <span style={{ color: pct > 100 ? C.amber : C.muted }}>{value}</span>
      </div>
      <Meter pct={pct} gradient={pct > 100 ? C.amber : color} height={5} />
    </div>
  );

  return (
    <div style={{ borderTop: `1px solid ${C.line}`, padding: '10px 0 0', marginBottom: compact ? 4 : 14 }}>
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
          {demand.marketPax.toLocaleString()} travellers a day{who}.{' '}
          {rivals.length > 0
            ? `Flown by ${rivals
                .slice(0, 4)
                .map((c) => c.name)
                .join(', ')}${rivals.length > 4 ? ` and ${rivals.length - 4} more` : ''}.`
            : 'No airline flies it.'}
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
      {row(
        'Small parcels per day',
        smallDem > 0 ? `${smallDem} t at $${demand.refFares.parcelPerTon.toLocaleString()}/t · you fly ${served.dailyCargoTons} t` : 'none on this route',
        smallPct,
        '#c9a368',
        false,
        'Mail, express and loose cargo. Any aircraft carries them; they sell best on overnight flights.'
      )}
      {row(
        'Big parcels per day',
        bigDem > 0
          ? `${bigDem} t at $${demand.refFares.cargoPerTon.toLocaleString()}/t · freighters only${!compact && oneWay ? ` · ${oneWay}` : ''}${paxPlane ? '' : ` · you fly ${served.dailyFreightTons} t`}`
          : 'none on this route',
        bigPct,
        '#b98a52',
        paxPlane,
        'Pallets and containers. Only freighters carry them; they fill whatever room small parcels leave.'
      )}
    </div>
  );
}
