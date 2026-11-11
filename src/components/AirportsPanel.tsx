import { useMemo, useState } from 'react';
import { calcHubPurchasePriceUsd, calcHubSaleRefundUsd } from '../game/tiers';
import { GATE_CODE_INFO, GATE_CODES, airportGateCode, type GateCode } from '../game/gateCode';
import { formatMoneyM } from '../game/time';
import type { Airport } from '../game/types';
import { Button, C, DISPLAY, Pill, SearchInput, SectionTitle, Segmented, SidePanel } from '../ui/kit';

const CODES_DESC: GateCode[] = [...GATE_CODES].reverse();

/** Filters airports by a free-text query and buckets them by the ICAO size code of their gates. */
export function groupAirportsByTier(airports: Airport[], query: string) {
  const q = query.trim().toLowerCase();
  const groups = new Map<GateCode, Airport[]>(CODES_DESC.map((t) => [t, []]));
  for (const a of airports) {
    if (q && ![a.iata_code, a.municipality, a.name, a.iso_country].some((s) => (s || '').toLowerCase().includes(q))) continue;
    groups.get(airportGateCode(a))!.push(a);
  }
  return CODES_DESC.map((t) => ({ tier: t, info: GATE_CODE_INFO[t], list: groups.get(t)! })).filter((g) => g.list.length > 0);
}

const PER_GROUP = 40;

export function AirportsPanel({
  airports,
  hubs,
  onInspect,
  onBuy,
  onSell,
  onClose,
}: {
  airports: Airport[];
  hubs: string[];
  onInspect: (ap: Airport) => void;
  onBuy: (ap: Airport) => void;
  onSell: (ap: Airport) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<'all' | 'hubs'>('all');
  const groups = useMemo(() => {
    const base = show === 'hubs' ? airports.filter((a) => hubs.includes(a.iata_code)) : airports;
    return groupAirportsByTier(base, search).map((g) => ({ ...g, list: [...g.list].sort((a, b) => b.demand_weight - a.demand_weight) }));
  }, [airports, hubs, search, show]);

  return (
    <SidePanel title="Airports" width={720} onClose={onClose}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search" style={{ flex: '1 1 180px' }} />
        <Segmented<'all' | 'hubs'>
          value={show}
          onChange={setShow}
          options={[
            { value: 'all', label: 'All' },
            { value: 'hubs', label: `My hubs ${hubs.length}` },
          ]}
        />
      </div>

      {groups.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>Nothing matches.</div>}

      {groups.map(({ tier, info, list }) => (
        <section key={tier} style={{ marginBottom: 18 }}>
          <SectionTitle right={<span className="num" style={{ fontSize: 12, color: C.faint }}>{list.length}</span>}>
            {info.label} · Code {tier}
          </SectionTitle>
          <div className="bp-list">
            {list.slice(0, PER_GROUP).map((ap) => {
              const owned = hubs.includes(ap.iata_code);
              return (
                <div
                  key={ap.iata_code}
                  className="bp-row"
                  role="button"
                  tabIndex={0}
                  aria-label={`${ap.iata_code} ${ap.municipality}: show on the map`}
                  onClick={() => onInspect(ap)}
                  onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && onInspect(ap)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px', cursor: 'pointer', borderRadius: 0 }}
                >
                  <span style={{ width: 44, flex: 'none', fontFamily: DISPLAY, fontSize: 17, fontWeight: 700, color: owned ? C.brand : C.text }}>{ap.iata_code}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 550, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {ap.municipality}, {ap.iso_country}
                    </span>
                    <span style={{ display: 'block', fontSize: 12, color: C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ap.name}</span>
                  </span>
                  {!owned ? (
                    <Button
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onBuy(ap);
                      }}
                    >
                      Buy {formatMoneyM(calcHubPurchasePriceUsd(ap))}
                    </Button>
                  ) : hubs.length > 1 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSell(ap);
                      }}
                    >
                      Sell +{formatMoneyM(calcHubSaleRefundUsd(ap))}
                    </Button>
                  ) : (
                    <Pill color={C.brand}>Hub</Pill>
                  )}
                </div>
              );
            })}
          </div>
          {list.length > PER_GROUP && <div style={{ fontSize: 12, color: C.faint, padding: '8px' }}>+{list.length - PER_GROUP} more</div>}
        </section>
      ))}
    </SidePanel>
  );
}
