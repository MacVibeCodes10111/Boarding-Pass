import { useMemo } from 'react';
import { CABIN_PRESET_LABELS, buildCabinPreset, cabinAbreast, calculateCabinUsage, type CabinPreset } from '../game/economics';
import type { AircraftModel, CabinConfig } from '../game/types';
import { C, Segmented, Stepper } from '../ui/kit';

const PRESETS: CabinPreset[] = ['dense', 'standard', 'premium'];
const CLASSES = [
  { key: 'firstSeats', pitch: 'firstPitchIn', label: 'First', color: '#d9b26f', abreast: 'first' },
  { key: 'busSeats', pitch: 'busPitchIn', label: 'Business', color: '#8fb8de', abreast: 'bus' },
  { key: 'premSeats', pitch: 'premPitchIn', label: 'Premium economy', color: '#7fc8a9', abreast: 'prem' },
  { key: 'econSeats', pitch: 'econPitchIn', label: 'Economy', color: '#6c7a93', abreast: 'econ' },
] as const;

const sameSeats = (a: CabinConfig, b: CabinConfig) =>
  a.econSeats === b.econSeats && a.premSeats === b.premSeats && a.busSeats === b.busSeats && a.firstSeats === b.firstSeats && a.econPitchIn === b.econPitchIn;

/** Cabin layout editor: three presets plus fine-tuning per class. */
export function CabinEditor({ model, cabin, onChange }: { model: AircraftModel; cabin: CabinConfig; onChange: (c: CabinConfig) => void }) {
  const usage = calculateCabinUsage(model, cabin);
  const abreast = cabinAbreast(model);
  const presets = useMemo(() => Object.fromEntries(PRESETS.map((p) => [p, buildCabinPreset(model, p)])) as Record<CabinPreset, CabinConfig>, [model]);
  const activePreset = PRESETS.find((p) => sameSeats(presets[p], cabin)) ?? 'custom';

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
