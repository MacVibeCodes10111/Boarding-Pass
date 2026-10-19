import { useEffect, useMemo, useRef, useState } from 'react';
import { CABIN_PRESET_LABELS, buildCabinPreset, cabinAbreast, calculateCabinUsage, type CabinPreset } from '../game/economics';
import type { AircraftModel, CabinConfig } from '../game/types';
import { Button, C, Segmented, Stepper, inputStyle } from '../ui/kit';
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
const CLASSES = [
  { key: 'firstSeats', pitch: 'firstPitchIn', label: 'First', color: '#d9b26f', abreast: 'first' },
  { key: 'busSeats', pitch: 'busPitchIn', label: 'Business', color: '#8fb8de', abreast: 'bus' },
  { key: 'premSeats', pitch: 'premPitchIn', label: 'Premium economy', color: '#7fc8a9', abreast: 'prem' },
  { key: 'econSeats', pitch: 'econPitchIn', label: 'Economy', color: '#6c7a93', abreast: 'econ' },
] as const;

const seatTotal = (c: CabinConfig) => c.firstSeats + c.busSeats + c.premSeats + c.econSeats;
/** "12 J, 150 Y": the classes a layout has, by their usual letters. */
const classMix = (c: CabinConfig) =>
  [
    [c.firstSeats, 'F'],
    [c.busSeats, 'J'],
    [c.premSeats, 'W'],
    [c.econSeats, 'Y'],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, l]) => `${n} ${l}`)
    .join(', ');

const sameSeats = (a: CabinConfig, b: CabinConfig) =>
  a.econSeats === b.econSeats && a.premSeats === b.premSeats && a.busSeats === b.busSeats && a.firstSeats === b.firstSeats && a.econPitchIn === b.econPitchIn;

/** Cabin layout editor: three presets plus fine-tuning per class. */
export function CabinEditor({ model, cabin, onChange }: { model: AircraftModel; cabin: CabinConfig; onChange: (c: CabinConfig) => void }) {
  const usage = calculateCabinUsage(model, cabin);
  const abreast = cabinAbreast(model);
  const presets = useMemo(() => Object.fromEntries(PRESETS.map((p) => [p, buildCabinPreset(model, p)])) as Record<CabinPreset, CabinConfig>, [model]);
  const activePreset = PRESETS.find((p) => sameSeats(presets[p], cabin)) ?? 'custom';
  const [saved, setSaved] = useState<SavedCabin[]>(readSavedCabins);
  const mine = saved.filter((s) => s.modelId === model.id);
  const activeSaved = mine.find((s) => sameSeats(s.cabin, cabin) && s.cabin.busPitchIn === cabin.busPitchIn && s.cabin.firstPitchIn === cabin.firstPitchIn);
  const [naming, setNaming] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
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
  }, [model.id]);
  // Bring the open list into view when it opens near the bottom of a panel (phones)
  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector('.bp-saved-menu')?.scrollIntoView({ block: 'nearest' });
  }, [menuOpen]);
  const valid = calculateCabinUsage(model, cabin).isValid;
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

  const lengthPct = Math.min(100, (usage.usedMeters / usage.maxMeters) * 100);
  const over = usage.usedMeters > usage.maxMeters;
  const overExit = usage.totalSeats > usage.maxExitLimit;

  // Share of the cabin length each class uses, for the strip diagram
  const rowsLen = (seats: number, ab: number, pitch: number) => Math.ceil(seats / ab) * pitch * 0.0254;
  const segments = CLASSES.map((cl) => ({
    ...cl,
    len: rowsLen(cabin[cl.key], abreast[cl.abreast], cabin[cl.pitch]),
  }));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <Segmented
          value={activePreset as CabinPreset}
          onChange={(p) => onChange(presets[p])}
          options={PRESETS.map((p) => ({ value: p, label: CABIN_PRESET_LABELS[p].label, title: CABIN_PRESET_LABELS[p].hint }))}
        />
        <span style={{ fontSize: 12, color: C.muted }}>{activePreset === 'custom' ? 'Custom layout' : CABIN_PRESET_LABELS[activePreset].hint}</span>
      </div>

      {/* Your saved layouts for this aircraft type: a drop-down list with a search box */}
      <div className="bp-saved-cabins" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '-4px 0 12px' }}>
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
                boxShadow: '0 10px 28px rgba(0,0,0,0.45)',
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
                      onChange({ ...shown[0].cabin });
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
                          onChange({ ...s.cabin });
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
            Save this layout
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

      {/* Strip diagram of the cabin, nose on the left */}
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: C.bg, border: `1px solid ${over ? C.red : C.border}` }}>
        {segments.map((s) =>
          s.len > 0 ? <div key={s.key} title={s.label} style={{ width: `${(s.len / usage.maxMeters) * 100}%`, background: s.color }} /> : null
        )}
      </div>
      <div className="num" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 6, color: over || overExit ? C.red : C.muted }}>
        <span>
          Cabin length {usage.usedMeters.toFixed(1)} of {usage.maxMeters} m ({Math.round(lengthPct)}%)
        </span>
        <span>
          {usage.totalSeats} seats, limit {usage.maxExitLimit}
        </span>
      </div>

      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        {CLASSES.map((cl) => (
          <div key={cl.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: cl.color }} />
            <span style={{ flex: 1, fontSize: 13, color: C.text }}>
              {cl.label}
              <span style={{ color: C.faint, fontSize: 12 }}>
                {' '}
                {cabin[cl.pitch]}" pitch, {abreast[cl.abreast]} across
              </span>
            </span>
            <Stepper
              value={cabin[cl.key]}
              min={0}
              max={model.max_exit_limit}
              step={cl.key === 'econSeats' ? abreast.econ : 1}
              onChange={(v) => onChange({ ...cabin, [cl.key]: Math.round(v) })}
            />
          </div>
        ))}
      </div>

      {(over || overExit || usage.totalSeats === 0) && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: C.red }}>
          {usage.totalSeats === 0
            ? 'Add at least one seat.'
            : over
            ? 'These seats don’t fit in the cabin. Remove some, or switch to a preset.'
            : `Too many seats for the emergency exits (limit ${usage.maxExitLimit}).`}
        </div>
      )}
    </div>
  );
}
