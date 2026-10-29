// ============================================================================
// AIRCRAFT PICKER (v2.58)
//   A sub-page of the route planner for choosing which aircraft flies a route.
//   Aircraft tied to the route's airports (based there, or already flying to
//   or from them) come first, then the ones with the most free time. Search,
//   and sort by free time, seats or type.
// ============================================================================
import { useMemo, useState } from 'react';
import { cabinSeatTotal } from '../game/economics';
import type { AircraftModel, PlayerAircraft } from '../game/types';
import { Icon } from '../ui/icons';
import { Button, C, Segmented, SearchInput } from '../ui/kit';

export interface PickerRow {
  ac: PlayerAircraft;
  usage: { usedPct: number; weeklyOccupiedMin: number };
  /** Where it is at departure time ("AUA", or "AUA (free)" with no flights yet). */
  from: string;
  /** Why it can't fly this route, if it can't. */
  reason: string | null;
  atOrigin: boolean;
  /** Based at, or already flying to or from, one of the route's airports. */
  attached: boolean;
}

type Sort = 'best' | 'free' | 'seats' | 'type';
const WEEK_MIN = 7 * 1440;

export const freeHours = (r: PickerRow) => Math.max(0, Math.round((WEEK_MIN - r.usage.weeklyOccupiedMin) / 60));
export const seatsOf = (ac: PlayerAircraft) => (ac.model.is_cargo ? ac.model.cargo_cap_tons ?? 0 : cabinSeatTotal(ac.cabin));

/** "12 business, 120 economy" (or "20 t of cargo") */
export function cabinText(ac: PlayerAircraft): string {
  if (ac.model.is_cargo) return `${seatsOf(ac)} t of cargo`;
  const c = ac.cabin;
  const parts = [
    c.firstSeats && `${c.firstSeats} first`,
    c.busSeats && `${c.busSeats} business`,
    c.premSeats && `${c.premSeats} premium`,
    c.econSeats && `${c.econSeats} economy`,
  ].filter(Boolean);
  return parts.join(', ') || `${cabinSeatTotal(c)} seats`;
}

export function AircraftPicker(props: {
  rows: PickerRow[];
  selected: string;
  routeLabel: string;
  originIata: string;
  iconForModel?: (m: AircraftModel) => string;
  onPick: (tail: string) => void;
  onBack: () => void;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('best');

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const shown = props.rows.filter(
      ({ ac }) => !s || ac.tailNumber.toLowerCase().includes(s) || ac.model.name.toLowerCase().includes(s) || (ac.model.icao_code ?? '').toLowerCase().includes(s)
    );
    const byFree = (a: PickerRow, b: PickerRow) => freeHours(b) - freeHours(a);
    const cmp: Record<Sort, (a: PickerRow, b: PickerRow) => number> = {
      best: (a, b) =>
        Number(Boolean(a.reason)) - Number(Boolean(b.reason)) ||
        Number(!(a.attached && a.atOrigin)) - Number(!(b.attached && b.atOrigin)) ||
        Number(!a.atOrigin) - Number(!b.atOrigin) ||
        byFree(a, b),
      free: byFree,
      seats: (a, b) => seatsOf(b.ac) - seatsOf(a.ac) || byFree(a, b),
      type: (a, b) => a.ac.model.name.localeCompare(b.ac.model.name) || byFree(a, b),
    };
    return [...shown].sort((a, b) => cmp[sort](a, b) || a.ac.tailNumber.localeCompare(b.ac.tailNumber));
  }, [props.rows, q, sort]);

  const ready = list.filter((r) => !r.reason);
  const notReady = list.filter((r) => r.reason);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Button size="sm" onClick={props.onBack}>
          ← Back
        </Button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Choose an aircraft</div>
          <div style={{ fontSize: 12, color: C.muted }}>{props.routeLabel}</div>
        </div>
      </div>
      <SearchInput value={q} onChange={setQ} placeholder="Search registration or type" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: C.muted }}>Sort</span>
        <Segmented<Sort>
          size="sm"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'best', label: 'Best fit', title: 'Aircraft already at this route’s airports first, then the most free time' },
            { value: 'free', label: 'Time left', title: 'Most free time in the week first' },
            { value: 'seats', label: 'Seats', title: 'Most seats first' },
            { value: 'type', label: 'Type', title: 'By aircraft type, A to Z' },
          ]}
        />
      </div>

      {list.length === 0 && <div style={{ fontSize: 13, color: C.muted, padding: '12px 0' }}>No aircraft match “{q}”.</div>}
      <div role="list" style={{ display: 'grid', gap: 8 }}>
        {ready.map((r) => (
          <PickerCard key={r.ac.tailNumber} row={r} {...props} />
        ))}
      </div>
      {notReady.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 650, color: C.muted, margin: '14px 0 8px' }}>Can’t fly this route</div>
          <div role="list" style={{ display: 'grid', gap: 8 }}>
            {notReady.map((r) => (
              <PickerCard key={r.ac.tailNumber} row={r} {...props} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PickerCard({ row, selected, originIata, iconForModel, onPick }: { row: PickerRow; selected: string; originIata: string; iconForModel?: (m: AircraftModel) => string; onPick: (tail: string) => void }) {
  const { ac, usage, reason } = row;
  const isSel = ac.tailNumber === selected;
  const free = 100 - usage.usedPct;
  const where = row.from.replace(' (free)', '');
  const note = reason ?? (!row.atOrigin ? `not at ${originIata} then` : row.attached ? 'already here' : null);
  return (
    <div
      role="listitem"
      style={{
        borderRadius: 12,
        border: `1px solid ${isSel ? C.brand : C.line}`,
        background: C.bg,
        padding: '10px 12px',
        opacity: reason ? 0.7 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {iconForModel ? <img src={iconForModel(ac.model)} alt="" style={{ width: 22, height: 22, flex: 'none' }} /> : <Icon name="fleet" size={18} color={C.muted} />}
        <span style={{ flex: 1, minWidth: 0, fontWeight: 650, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ac.model.name}</span>
        {ac.model.icao_code && (
          <span className="num" style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: C.panel, color: C.textDim }}>
            {ac.model.icao_code}
          </span>
        )}
        <Button size="sm" variant={isSel ? 'primary' : undefined} onClick={() => onPick(ac.tailNumber)} aria-label={`Use ${ac.tailNumber}`}>
          {isSel ? 'Selected' : 'Select'}
        </Button>
      </div>
      <div className="num" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12.5, color: C.textSoft, marginTop: 6 }}>
        <span style={{ fontWeight: 700, color: C.text }}>{ac.tailNumber}</span>
        <span>{cabinText(ac)}</span>
        <span>
          at {where}
          {ac.hubIata === where ? '' : `, based ${ac.hubIata}`}
        </span>
        <span>{ac.model.range_nm.toLocaleString()} nm range</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <div aria-hidden="true" style={{ flex: 1, height: 6, borderRadius: 3, background: C.panel, overflow: 'hidden' }}>
          <div style={{ width: `${usage.usedPct}%`, height: '100%', background: usage.usedPct >= 85 ? C.amber : C.accent }} />
        </div>
        <span className="num" style={{ fontSize: 12, color: C.muted, whiteSpace: 'nowrap' }}>
          {free}% free · {freeHours(row)} h a week
        </span>
      </div>
      {note && <div style={{ fontSize: 11.5, color: reason ? C.amber : row.atOrigin ? C.green : C.muted, marginTop: 6 }}>{note[0].toUpperCase() + note.slice(1)}</div>}
    </div>
  );
}
