// ============================================================================
// LIVERY EDITOR (v2.64)
//   Choose the airline's colours and their layout: a ready-made style, then
//   the fuselage, belly, cheatline, tail design, engines and titles, with a
//   live preview on a few of your aircraft types.
// ============================================================================
import { useMemo, useState } from 'react';
import { AIRCRAFT_PHOTOS } from '../game/aircraftPhotos';
import { cloudSkyCss } from '../game/cloudSky';
import { CHEATS, DEFAULT_LIVERY, LIVERY_STYLES, TAIL_ARTS, type CheatLine, type Livery, type TailArt } from '../game/livery';
import { Button, C, DISPLAY, ModalShell, Segmented } from '../ui/kit';
import { usePaintedPhoto } from './AircraftPhoto';

const SWATCHES = ['#ffffff', '#e9edf2', '#1d4e89', '#0b2545', '#c8102e', '#7a0019', '#f5a623', '#ffd400', '#00843d', '#0098d8', '#6c2c91', '#111111'];
const CHEAT_LABEL: Record<CheatLine, string> = { none: 'None', stripe: 'Stripe', double: 'Two stripes', swoosh: 'Swoosh', tailsweep: 'Tail sweep' };
const TAIL_LABEL: Record<TailArt, string> = { solid: 'Plain', split: 'Split', band: 'Band', disc: 'Disc', letter: 'Initial', stripes: 'Stripes' };

function Preview({ id, livery, name }: { id: string; livery: Livery; name: string }) {
  const url = usePaintedPhoto(id, livery, name);
  const size = AIRCRAFT_PHOTOS[id];
  if (!size) return null;
  return (
    <div style={{ borderRadius: 10, overflow: 'hidden', background: `${cloudSkyCss(`livery-${id}`)} center / cover`, padding: '18px 6%' }}>
      <img src={url} alt="" draggable={false} style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: `${size[0]} / ${size[1]}`, filter: 'drop-shadow(0 10px 12px rgba(10,20,40,.28))' }} />
    </div>
  );
}

function Colour({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 34, height: 28, padding: 0, border: `1px solid ${C.border}`, borderRadius: 6, background: 'none', cursor: 'pointer', flex: 'none' }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {SWATCHES.map((s) => (
          <button
            key={s}
            type="button"
            aria-label={`${label} ${s}`}
            onClick={() => onChange(s)}
            style={{ width: 18, height: 18, borderRadius: 4, background: s, border: `1px solid ${s === value ? C.brand : C.line}`, outline: s === value ? `1px solid ${C.brand}` : 'none', cursor: 'pointer', padding: 0 }}
          />
        ))}
      </div>
    </div>
  );
}

export function LiveryEditor(props: { livery?: Livery; airlineName: string; models: string[]; onSave: (l: Livery | undefined) => void; onClose: () => void }) {
  const [l, setL] = useState<Livery>(props.livery ?? DEFAULT_LIVERY);
  const set = (p: Partial<Livery>) => setL((x) => ({ ...x, ...p }));
  const choices = useMemo(() => {
    const own = props.models.filter((m) => AIRCRAFT_PHOTOS[m]);
    const extra = ['a320neo', 'b787-9', 'atr-72-600', 'e175', 'b777-300er'].filter((m) => !own.includes(m));
    return [...own, ...extra].slice(0, 6);
  }, [props.models]);
  const [pick, setPick] = useState(choices[0] ?? 'a320neo');
  const section: React.CSSProperties = { display: 'grid', gap: 12, padding: 12, borderRadius: 12, border: `1px solid ${C.line}`, background: C.panel };
  const head = (t: string) => <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{t}</div>;
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 150px), 1fr))', gap: 12 };

  return (
    <ModalShell onClose={props.onClose} maxWidth={760} zIndex={260} label="Livery">
      <div style={{ display: 'grid', gap: 14 }}>
        <h2 style={{ margin: 0, fontFamily: DISPLAY, fontSize: 24 }}>Livery</h2>
        <div style={{ position: 'sticky', top: 0, zIndex: 3, borderRadius: 12, background: C.bg, padding: '14px 12px 10px', display: 'grid', gap: 10, boxShadow: '0 8px 16px rgba(0,0,0,.35)' }}>
          <Preview id={pick} livery={l} name={props.airlineName} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
            {choices.map((m) => (
              <Button key={m} size="sm" variant={m === pick ? 'primary' : undefined} onClick={() => setPick(m)}>
                {m.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>

        <div style={section}>
          {head('Start from a style')}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {LIVERY_STYLES.map((s) => (
              <Button key={s.id} size="sm" onClick={() => set(s.make(l.tail === '#ffffff' ? l.cheat1 : l.tail, l.tail2))}>
                {s.label}
              </Button>
            ))}
          </div>
        </div>

        <div style={section}>
          {head('Fuselage')}
          <div style={grid}>
            <Colour label="Fuselage" value={l.body} onChange={(v) => set({ body: v })} />
            <Colour label="Belly" value={l.belly} onChange={(v) => set({ belly: v })} />
            <Colour label="Engines" value={l.engines} onChange={(v) => set({ engines: v })} />
          </div>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            <span>
              Belly colour up to <b>{Math.round(l.bellyTo * 100)}%</b> of the fuselage
            </span>
            <input type="range" min={0} max={0.7} step={0.01} value={l.bellyTo} onChange={(e) => set({ bellyTo: Number(e.target.value) })} />
          </label>
        </div>

        <div style={section}>
          {head('Cheatline')}
          <Segmented<CheatLine> size="sm" value={l.cheat} onChange={(v) => set({ cheat: v })} options={CHEATS.map((c) => ({ value: c, label: CHEAT_LABEL[c] }))} />
          {l.cheat !== 'none' && (
            <div style={grid}>
              <Colour label="Main colour" value={l.cheat1} onChange={(v) => set({ cheat1: v })} />
              <Colour label="Second colour" value={l.cheat2} onChange={(v) => set({ cheat2: v })} />
            </div>
          )}
        </div>

        <div style={section}>
          {head('Tail')}
          <Segmented<TailArt> size="sm" value={l.tailArt} onChange={(v) => set({ tailArt: v })} options={TAIL_ARTS.map((t) => ({ value: t, label: TAIL_LABEL[t] }))} />
          <div style={grid}>
            <Colour label="Tail" value={l.tail} onChange={(v) => set({ tail: v })} />
            {l.tailArt !== 'solid' && <Colour label="Design colour" value={l.tail2} onChange={(v) => set({ tail2: v })} />}
          </div>
        </div>

        <div style={section}>
          {head('Titles')}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
            <input type="checkbox" checked={l.titles} onChange={(e) => set({ titles: e.target.checked })} />
            Airline name on the fuselage
          </label>
          {l.titles && (
            <>
              <Segmented<Livery['titleFont']> size="sm" value={l.titleFont} onChange={(v) => set({ titleFont: v })} options={[{ value: 'sans', label: 'Modern' }, { value: 'italic', label: 'Italic' }, { value: 'serif', label: 'Classic' }]} />
              <div style={grid}>
                <Colour label="Titles" value={l.titleColour} onChange={(v) => set({ titleColour: v })} />
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
          <Button
            onClick={() => {
              props.onSave(undefined);
              props.onClose();
            }}
          >
            Plain white
          </Button>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={props.onClose}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                props.onSave(l);
                props.onClose();
              }}
            >
              Save livery
            </Button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
