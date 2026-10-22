// ============================================================================
// ROUTE FROM BAR (v2.39+)
//
// The first airport tapped on the map is where the route starts. This small
// bar says so and asks for the destination; the planner opens on the second
// tap, so the map stays visible while you pick.
// ============================================================================
import type { Airport } from '../game/types';
import { Icon } from '../ui/icons';
import { Button, C, DISPLAY, glass } from '../ui/kit';

export function RouteFromBar(props: { airport: Airport; isHub: boolean; onDetails: () => void; onCancel: () => void }) {
  const a = props.airport;
  return (
    <div
      role="status"
      className="bp-routefrom"
      style={{
        ...glass('f0'),
        position: 'absolute',
        top: 'calc(var(--bp-top-h) + 10px)',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(560px, calc(100vw - 20px))',
        zIndex: 46,
        borderRadius: 14,
        padding: '10px 10px 10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: '0 12px 30px rgba(0,0,0,.45)',
        border: `1px solid ${C.brand}66`,
      }}
    >
      <span style={{ width: 34, height: 34, borderRadius: 10, background: C.brand, color: C.brandInk, display: 'grid', placeItems: 'center', flex: 'none' }}>
        <Icon name="fleet" size={18} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 700, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          From {a.iata_code} <span style={{ color: C.muted, fontWeight: 600 }}>{a.municipality}</span>
        </div>
        <div style={{ fontSize: 13, color: C.textSoft, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {props.isHub ? 'Your hub. ' : ''}Now tap the airport to fly to
        </div>
      </div>
      <Button size="sm" onClick={props.onDetails} title={`Weather, hub and planning for ${a.iata_code}`}>
        Details
      </Button>
      <button
        type="button"
        aria-label="Cancel route"
        onClick={props.onCancel}
        style={{ width: 34, height: 34, flex: 'none', borderRadius: 10, display: 'grid', placeItems: 'center', background: C.raised, border: `1px solid ${C.border}`, color: C.textSoft, cursor: 'pointer' }}
      >
        <Icon name="close" size={15} />
      </button>
    </div>
  );
}
