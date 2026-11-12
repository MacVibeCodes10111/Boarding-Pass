import { useEffect, useMemo, useRef, useState } from 'react';
import { CABIN_PRESET_LABELS, buildCabinPreset, cabinAbreast, calculateCabinUsage, seatComfort, type CabinClass, type CabinPreset } from '../game/economics';
import type { AircraftModel, CabinConfig } from '../game/types';
import { Button, C, Stepper, floatShadow, inputStyle, well } from '../ui/kit';
import { Icon } from '../ui/icons';

// ---------------------------------------------------------------------------
// Saved layouts: your own presets per aircraft type, kept on this device (all
// careers share them). Each one stores the seats and pitches of a layout.
// ---------------------------------------------------------------------------
export interface SavedCabin {
  id: string;
  name: string;
  modelId: string;
  cabin: CabinConfig;
}
const SAVED_KEY = 'bp_pc_cabin_presets_v1';
export function readSavedCabins(): SavedCabin[] {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.name === 'string' && typeof x.modelId === 'string' && x.cabin) : [];
  } catch {
    return [];
  }
}
function writeSavedCabins(list: SavedCabin[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch {
    /* storage full or off: the layouts just aren't remembered */
  }
}

const PRESETS: CabinPreset[] = ['dense', 'standard', 'premium'];
/** The classes, front of the cabin first, with the seats each can have (pitch in inches). */
const CLASSES = [
  { id: 'first', key: 'firstSeats', pitch: 'firstPitchIn', label: 'First', short: 'first', color: '#d9a441', seats: [[62, 'Sleeper seat'], [82, 'Suite']] },
  { id: 'bus', key: 'busSeats', pitch: 'busPitchIn', label: 'Business', short: 'business', color: '#5b9bd5', seats: [[40, 'Recliner'], [48, 'Deep recliner'], [62, 'Angled bed'], [78, 'Flat bed']] },
  { id: 'prem', key: 'premSeats', pitch: 'premPitchIn', label: 'Premium economy', short: 'premium', color: '#4fb08c', seats: [[36, 'Standard'], [38, 'Roomy'], [41, 'Extra room']] },
  { id: 'econ', key: 'econSeats', pitch: 'econPitchIn', label: 'Economy', short: 'economy', color: '#7d8ba5', seats: [[28, 'Tight'], [29, 'Snug'], [30, 'Standard'], [31, 'A little more'], [32, 'Roomy'], [34, 'Extra legroom']] },
] as const satisfies readonly { id: CabinClass; key: keyof CabinConfig; pitch: keyof CabinConfig; label: string; short: string; color: string; seats: readonly (readonly [number, string])[] }[];

const seatTotal = (c: CabinConfig) => c.firstSeats + c.busSeats + c.premSeats + c.econSeats;
/** "12 business · 150 economy": the classes a layout has. */
const classMix = (c: CabinConfig) =>
  CLASSES.filter((cl) => c[cl.key] > 0)
    .map((cl) => `${c[cl.key]} ${cl.short}`)
    .join(' · ');

const sameCabin = (a: CabinConfig, b: CabinConfig) =>
  a.econSeats === b.econSeats && a.premSeats === b.premSeats && a.busSeats === b.busSeats && a.firstSeats === b.firstSeats &&
  a.econPitchIn === b.econPitchIn && a.premPitchIn === b.premPitchIn && a.busPitchIn === b.busPitchIn && a.firstPitchIn === b.firstPitchIn;

/** Seats across a row, in the blocks between the aisles: 3-3, 2-4-2, 3-4-3… */
function rowBlocks(abreast: number, twinAisle: boolean): number[] {
  if (abreast <= 1) return [1];
  if (!twinAisle || abreast < 3) return [Math.ceil(abreast / 2), Math.floor(abreast / 2)];
  const side = Math.max(1, Math.floor(abreast / 3));
  return [side, abreast - side * 2, side];
}

/** The cabin from above, nose on the left: one column of seats per row. */
function SeatMap({ model, cabin, bad }: { model: AircraftModel; cabin: CabinConfig; bad: boolean }) {
  const abreast = cabinAbreast(model);
  const twin = model.max_abreast >= 7;
  const rows: { color: string; pitch: number; blocks: number[]; seats: number; label: string }[] = [];
  for (const cl of CLASSES) {
    const ab = abreast[cl.id];
    for (let left = cabin[cl.key]; left > 0; left -= ab) rows.push({ color: cl.color, pitch: cabin[cl.pitch], blocks: rowBlocks(ab, twin), seats: Math.min(ab, left), label: cl.label });
  }
  const usedIn = rows.reduce((s, r) => s + r.pitch, 0);
  const freeIn = Math.max(0, (model.usable_cabin_length_m - 1.8) / 0.0254 - usedIn);
  const height = Math.max(34, model.max_abreast * 6 + (twin ? 12 : 6) + 14);
  return (
    <div
      role="img"
      aria-label={`Seat map: ${classMix(cabin) || 'no seats'}`}
      style={{ display: 'flex', alignItems: 'stretch', height, padding: '7px 12px 7px 30px', borderRadius: `${height / 2}px 12px 12px ${height / 2}px`, background: well(), border: `1px solid ${bad ? C.red : C.border}`, overflow: 'hidden' }}
    >
      {rows.map((r, i) => {
        let left = r.seats;
        return (
          <div key={i} title={r.label} style={{ flex: `${r.pitch} 1 0`, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, padding: '0 0.5px' }}>
            {r.blocks.map((n, b) => (
              <div key={b} style={{ flex: n, display: 'flex', flexDirection: 'column', gap: 1, marginTop: b ? 4 : 0 }}>
                {Array.from({ length: n }, (_, s) => (
                  <span key={s} style={{ flex: 1, borderRadius: 1.5, background: left-- > 0 ? r.color : 'transparent' }} />
                ))}
              </div>
            ))}
          </div>
        );
      })}
      {freeIn > 0 && <div style={{ flex: `${freeIn} 1 0` }} />}
    </div>
  );
}

/** Cabin layout editor: a seat map, three quick layouts, your saved ones, and rows and seat type per class. */
export function CabinEditor({ model, cabin, onChange }: { model: AircraftModel; cabin: CabinConfig; onChange: (c: CabinConfig) => void }) {
  const usage = calculateCabinUsage(model, cabin);
  const abreast = cabinAbreast(model);
  const presets = useMemo(() => Object.fromEntries(PRESETS.map((p) => [p, buildCabinPreset(model, p)])) as Record<CabinPreset, CabinConfig>, [model]);
  const activePreset = PRESETS.find((p) => sameCabin(presets[p], cabin)) ?? 'custom';
  const [saved, setSaved] = useState<SavedCabin[]>(readSavedCabins);
  const mine = saved.filter((s) => s.modelId === model.id);
  const activeSaved = mine.find((s) => sameCabin(s.cabin, cabin));
  const [naming, setNaming] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');
  const menuRef = useRef<HTMLDivElement | null>(null);
  const q = query.trim().toLowerCase();
  const shown = q ? mine.filter((s) => s.name.toLowerCase().includes(q)) : mine;
  // The menu closes on a click outside it or on Escape, like a drop-down list
  useEffect(() => {
    if (!menuOpen) return;
    const down = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('touchstart', down);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('touchstart', down);
      document.removeEventListener('keydown', key, true);
    };
  }, [menuOpen]);
  useEffect(() => {
    setMenuOpen(false);
    setQuery('');
    setNote('');
  }, [model.id]);
  // Bring the open list into view when it opens near the bottom of a panel (phones)
  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector('.bp-saved-menu')?.scrollIntoView({ block: 'nearest' });
  }, [menuOpen]);
  const valid = usage.isValid;
  const saveLayout = () => {
    const name = (naming ?? '').trim();
    if (!name) return;
    const next = [{ id: `C${Date.now().toString(36)}`, name: name.slice(0, 32), modelId: model.id, cabin: { ...cabin } }, ...saved.filter((s) => !(s.modelId === model.id && s.name === name))];
    setSaved(next);
    writeSavedCabins(next);
    setNaming(null);
  };
  const removeLayout = (id: string) => {
    const next = saved.filter((s) => s.id !== id);
    setSaved(next);
    writeSavedCabins(next);
  };

  const over = usage.usedMeters > usage.maxMeters;
  const overExit = usage.totalSeats > usage.maxExitLimit;
  // Small commuter aircraft have odd seat counts (9, 19): they step seat by seat
  const tiny = model.typical_seats < 40;
  const fits = (c: CabinConfig) => {
    const u = calculateCabinUsage(model, c);
    return u.usedMeters <= u.maxMeters && u.totalSeats <= u.maxExitLimit;
  };
  /** Economy rows that still fit behind the other cabins. */
  const roomFor = (c: CabinConfig) => {
    let n = 0;
    while (n < 200 && fits({ ...c, econSeats: c.econSeats + (n + 1) * abreast.econ })) n++;
    return n;
  };
  const spareRows = roomFor(cabin);
  const pick = (c: CabinConfig) => {
    setNote('');
    onChange(c);
  };
  /** A change to one class. More room at the front comes out of economy, so the layout always fits. */
  const change = (cl: (typeof CLASSES)[number], patch: Partial<CabinConfig>) => {
    let next = { ...cabin, ...patch };
    let removed = 0;
    if (cl.id === 'econ') {
      while (!fits(next) && next.econSeats > cabin.econSeats) next = { ...next, econSeats: Math.max(cabin.econSeats, next.econSeats - (tiny ? 1 : abreast.econ)) };
    } else {
      while (!fits(next) && next.econSeats > 0) {
        next = { ...next, econSeats: Math.max(0, next.econSeats - abreast.econ) };
        removed++;
      }
    }
    setNote(removed ? `Took out ${removed} economy row${removed === 1 ? '' : 's'} to make room.` : '');
    onChange(next);
  };
  const fill = () => {
    let next = { ...cabin, econSeats: cabin.econSeats + spareRows * abreast.econ };
    if (tiny) while (fits({ ...next, econSeats: next.econSeats + 1 })) next = { ...next, econSeats: next.econSeats + 1 };
    pick(next);
  };

  return (
    <div>
      <SeatMap model={model} cabin={cabin} bad={over || overExit} />
      <div className="num" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', fontSize: 12, marginTop: 6, color: over || overExit ? C.red : C.muted }}>
        <span>
          <b style={{ color: over || overExit ? C.red : C.text, fontWeight: 650 }}>{usage.totalSeats} seats</b>
          {usage.totalSeats > 0 && activePreset === 'custom' ? ` · ${classMix(cabin)}` : ''}
        </span>
        <span>
          {usage.usedMeters.toFixed(1)} of {usage.maxMeters} m · up to {usage.maxExitLimit} seats
        </span>
      </div>

      {/* Quick layouts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, margin: '12px 0' }}>
        {PRESETS.map((p) => {
          const on = activePreset === p;
          return (
            <button
              key={p}
              type="button"
              aria-pressed={on}
              title={CABIN_PRESET_LABELS[p].hint}
              onClick={() => pick(presets[p])}
              style={{ textAlign: 'left', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', background: on ? `${C.brand}1f` : well(), border: `1px solid ${on ? C.brand : C.border}`, color: C.text, minWidth: 0 }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 650, color: on ? C.brand : C.text }}>{CABIN_PRESET_LABELS[p].label}</div>
              <div className="num" style={{ fontSize: 11.5, color: C.muted, marginTop: 2, lineHeight: 1.35 }}>
                {seatTotal(presets[p])} seats
                <br />
                {classMix(presets[p])}
              </div>
            </button>
          );
        })}
      </div>

      {/* Your saved layouts for this aircraft type: a drop-down list with a search box */}
      <div className="bp-saved-cabins" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '0 0 12px' }}>
        <span style={{ fontSize: 12, color: C.muted }}>My layouts</span>
        <div ref={menuRef} style={{ position: 'relative', flex: '1 1 200px', maxWidth: 300, minWidth: 0 }}>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            aria-label="Saved layouts"
            disabled={!mine.length}
            onClick={() => setMenuOpen((o) => !o)}
            style={{
              ...inputStyle,
              padding: '5px 8px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              textAlign: 'left',
              cursor: mine.length ? 'pointer' : 'default',
              color: activeSaved ? C.text : C.muted,
              opacity: mine.length ? 1 : 0.7,
            }}
          >
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeSaved ? activeSaved.name : mine.length ? `Choose a saved layout (${mine.length})` : 'None saved for this aircraft yet'}
            </span>
            <Icon name="chevron" size={14} color={C.muted} style={{ transform: menuOpen ? 'rotate(-90deg)' : 'rotate(90deg)', flexShrink: 0 }} />
          </button>
          {menuOpen && (
            <div
              className="bp-saved-menu"
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                left: 0,
                right: 0,
                minWidth: 240,
                zIndex: 30,
                background: C.panel,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                boxShadow: floatShadow(),
                overflow: 'hidden',
              }}
            >
              <div style={{ position: 'relative', padding: 6, borderBottom: `1px solid ${C.line}` }}>
                <Icon name="search" size={14} color={C.faint} style={{ position: 'absolute', left: 14, top: 14, pointerEvents: 'none' }} />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && shown.length) {
                      pick({ ...shown[0].cabin });
                      setMenuOpen(false);
                    }
                  }}
                  placeholder={`Search ${mine.length} layout${mine.length === 1 ? '' : 's'}`}
                  aria-label="Search saved layouts"
                  style={{ ...inputStyle, padding: '5px 8px 5px 28px', fontSize: 12.5 }}
                />
              </div>
              <div role="listbox" aria-label="Saved layouts" style={{ maxHeight: 248, overflowY: 'auto', padding: 4 }}>
                {shown.map((s) => {
                  const on = activeSaved?.id === s.id;
                  return (
                    <div key={s.id} className="bp-saved-item" style={{ display: 'flex', alignItems: 'center', borderRadius: 5, background: on ? C.raised : undefined }}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={on}
                        onClick={() => {
                          pick({ ...s.cabin });
                          setMenuOpen(false);
                        }}
                        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8, background: 'none', border: 'none', color: C.text, padding: '7px 8px', cursor: 'pointer', textAlign: 'left' }}
                      >
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: on ? C.brand : C.text }}>{s.name}</span>
                        <span className="num" style={{ fontSize: 11.5, color: C.muted, whiteSpace: 'nowrap' }}>
                          {seatTotal(s.cabin)} seats · {classMix(s.cabin)}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete layout ${s.name}`}
                        title="Delete this layout"
                        onClick={() => removeLayout(s.id)}
                        style={{ background: 'none', border: 'none', color: C.faint, fontSize: 15, padding: '4px 9px', cursor: 'pointer', lineHeight: 1 }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
                {!shown.length && <div style={{ padding: '10px 8px', fontSize: 12.5, color: C.muted }}>No layouts match “{query.trim()}”.</div>}
              </div>
            </div>
          )}
        </div>
        {naming === null ? (
          <Button size="sm" variant="ghost" disabled={!valid} title={valid ? `Save this layout for the ${model.name}` : 'Fix the layout before saving it'} onClick={() => setNaming(activePreset === 'custom' ? '' : `${CABIN_PRESET_LABELS[activePreset as CabinPreset].label} copy`)}>
            Save layout
          </Button>
        ) : (
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              autoFocus
              value={naming}
              maxLength={32}
              placeholder="Name, e.g. Long-haul"
              aria-label="Layout name"
              onChange={(e) => setNaming(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveLayout();
                if (e.key === 'Escape') setNaming(null);
              }}
              style={{ ...inputStyle, width: 170, padding: '4px 8px', fontSize: 12.5 }}
            />
            <Button size="sm" variant="primary" disabled={!naming.trim()} onClick={saveLayout}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNaming(null)}>
              Cancel
            </Button>
          </span>
        )}
      </div>

      {/* Rows and seat type, class by class */}
      <div style={{ display: 'grid', gap: 8 }}>
        {CLASSES.map((cl) => {
          const seats = cabin[cl.key];
          const ab = abreast[cl.id];
          const pitch = cabin[cl.pitch];
          const rows = Math.ceil(seats / ab);
          const worth = Math.round((seatComfort(cabin, cl.id, 480) - 1) * 100);
          const options: readonly (readonly [number, string])[] = cl.seats.some(([p]) => p === pitch) ? cl.seats : [...cl.seats, [pitch, 'Custom'] as const].sort((a, b) => a[0] - b[0]);
          return (
            <div key={cl.key} style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 10px', alignItems: 'center', padding: '8px 10px', borderRadius: 10, background: well(), opacity: seats > 0 ? 1 : 0.78 }}>
              <div style={{ flex: '1 1 150px', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: cl.color, flexShrink: 0 }} />
                  {cl.label}
                </div>
                <div className="num" style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>
                  {seats > 0 ? `${rows} row${rows === 1 ? '' : 's'} of ${ab}` : `${ab} across`}
                  {seats > 0 && worth !== 0 && (
                    <span title="What travellers will pay compared with the usual seat. It counts most on long flights." style={{ color: worth > 0 ? C.green : C.amber }}>
                      {' '}
                      · fares {worth > 0 ? `+${worth}` : `−${-worth}`}% on long flights
                    </span>
                  )}
                </div>
              </div>
              <select
                aria-label={`${cl.label} seat`}
                value={String(pitch)}
                onChange={(e) => change(cl, { [cl.pitch]: Number(e.target.value) })}
                style={{ ...inputStyle, flex: '1 1 150px', width: 'auto', minWidth: 0, padding: '5px 8px', fontSize: 12.5 }}
              >
                {options.map(([p, name]) => (
                  <option key={p} value={p}>
                    {name} · {p}" pitch
                  </option>
                ))}
              </select>
              <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>
                <Stepper value={seats} min={0} max={model.max_exit_limit} step={tiny ? 1 : ab} onChange={(v) => change(cl, { [cl.key]: Math.max(0, Math.round(v)) })} />
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, minHeight: 30, fontSize: 12.5 }}>
        {usage.totalSeats === 0 ? (
          <span style={{ flex: 1, color: C.red }}>Add at least one seat.</span>
        ) : over ? (
          <span style={{ flex: 1, color: C.red }}>These seats don’t fit. Take some out, or pick a layout above.</span>
        ) : overExit ? (
          <span style={{ flex: 1, color: C.red }}>Too many seats for the emergency exits (up to {usage.maxExitLimit}).</span>
        ) : (
          <span style={{ flex: 1, color: C.muted }}>{note || (spareRows > 0 ? `Room for ${spareRows} more economy row${spareRows === 1 ? '' : 's'}.` : 'The cabin is full.')}</span>
        )}
        {spareRows > 0 && !over && !overExit && (
          <Button size="sm" onClick={fill}>
            Fill with economy
          </Button>
        )}
      </div>
    </div>
  );
}
