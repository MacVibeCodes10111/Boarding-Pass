import { useMemo, useState } from 'react';
import { UNIFIED_TIER_CONFIG, calcHubPurchasePriceUsd, calcHubSaleRefundUsd, tierForRunwayFt } from '../game/tiers';
import { formatMoneyM } from '../game/time';
import type { Airport, OperationalTier } from '../game/types';
import { Button, C, SearchInput, Segmented, SidePanel } from '../ui/kit';

const TIERS_DESC: OperationalTier[] = [5, 4, 3, 2, 1];

/** Filters airports by a free-text query and buckets them by max aircraft size. */
export function groupAirportsByTier(airports: Airport[], query: string) {
  const q = query.trim().toLowerCase();
  const groups = new Map<OperationalTier, Airport[]>(TIERS_DESC.map((t) => [t, []]));
  for (const a of airports) {
    if (q && ![a.iata_code, a.municipality, a.name, a.iso_country].some((s) => (s || '').toLowerCase().includes(q))) continue;
    groups.get(tierForRunwayFt(a.max_runway_length_ft || 7000))!.push(a);
  }
  return TIERS_DESC.map((t) => ({ tier: t, info: UNIFIED_TIER_CONFIG[t], list: groups.get(t)! })).filter((g) => g.list.length > 0);
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
    <SidePanel
      title="Airports"
      subtitle={`${airports.length.toLocaleString()} airports with scheduled service. Sized by the largest aircraft their runway takes.`}
      width={720}
      onClose={onClose}
    >
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search code, city, name or country" style={{ flex: 1 }} />
        <Segmented<'all' | 'hubs'>
          value={show}
          onChange={setShow}
          options={[
            { value: 'all', label: 'All' },
            { value: 'hubs', label: `Your hubs (${hubs.length})` },
          ]}
        />
      </div>

      {groups.length === 0 && <div style={{ color: C.muted, fontSize: 12.5 }}>No airports match “{search}”.</div>}

      {groups.map(({ tier, info, list }) => (
        <section key={tier} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 650, color: C.textSoft, marginBottom: 6 }}>
            Takes up to {info.sizeLabel.toLowerCase()} aircraft <span style={{ color: C.faint, fontWeight: 500 }}>{list.length}</span>
          </div>
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden' }}>
            {list.slice(0, PER_GROUP).map((ap, i) => {
              const owned = hubs.includes(ap.iata_code);
              return (
                <div
                  key={ap.iata_code}
                  className="bp-row"
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderTop: i ? `1px solid ${C.line}` : 'none' }}
                >
                  <span style={{ width: 40, fontWeight: 650, color: owned ? C.brand : C.text }}>{ap.iata_code}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {ap.municipality}, {ap.iso_country}
                      {owned && <span style={{ color: C.brand, fontSize: 12 }}> your hub</span>}
                    </span>
                    <span className="num" style={{ display: 'block', fontSize: 11.5, color: C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {ap.name}, {ap.max_runway_length_ft.toLocaleString()} ft runway
                    </span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => onInspect(ap)}>
                    Show on map
                  </Button>
                  {!owned ? (
                    <Button size="sm" onClick={() => onBuy(ap)} style={{ minWidth: 118 }}>
                      Buy hub {formatMoneyM(calcHubPurchasePriceUsd(ap))}
                    </Button>
                  ) : hubs.length > 1 ? (
                    <Button size="sm" variant="ghost" onClick={() => onSell(ap)} style={{ minWidth: 118 }}>
                      Sell +{formatMoneyM(calcHubSaleRefundUsd(ap))}
                    </Button>
                  ) : (
                    <span style={{ minWidth: 118, fontSize: 12, color: C.faint, textAlign: 'center' }}>Home hub</span>
                  )}
                </div>
              );
            })}
          </div>
          {list.length > PER_GROUP && (
            <div style={{ fontSize: 12, color: C.faint, padding: '6px 2px' }}>{list.length - PER_GROUP} more. Search to narrow the list.</div>
          )}
        </section>
      ))}
    </SidePanel>
  );
}
