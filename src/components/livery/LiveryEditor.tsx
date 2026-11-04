// ============================================================================
// LIVERY EDITOR (v2.66)
//   An image editor for the airline's livery: the aircraft on a sky in the
//   middle, tools down the side (move, hand, brush, eraser, line, fill,
//   shapes, text, logo), layers and the selected layer's settings on the
//   right (below on a phone). Everything is placed in the aircraft's own
//   frames (see livery.ts), so a design made on one type fits the others:
//   the type picker at the top switches the preview.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AIRCRAFT_PHOTOS } from '../../game/aircraftPhotos';
import { cloudSkyCss } from '../../game/cloudSky';
import {
  FONT_LABEL,
  LIVERY_STYLES,
  MAX_LAYERS,
  MAX_LOGOS,
  MAX_STROKES,
  REGION_LABEL,
  REGIONS,
  MAX_LIVERIES,
  MAX_POINTS,
  registrationLayer,
  fillLayer,
  layerText,
  newId,
  normaliseLivery,
  shapeLayer,
  type FontId,
  type Frame,
  type Layer,
  type Livery,
  type Region,
  type ShapeKind,
  DEFAULT_LIVERY,
} from '../../game/livery';
import { aircraftGeometry, freeCanvas, fromPx, layerOutline, loadLogos, renderLivery, titlesPosition, unitPx, type Geometry } from '../../game/liveryPaint';
import { Button, C, DISPLAY, Segmented } from '../../ui/kit';
import { useLayout } from '../../ui/layout';
import { ColourPicker } from './ColourPicker';
import { moderate } from '../../game/moderation';
import { LOGO_TYPES, makeLogo } from './logoUpload';
import { PRESET_LOGOS, presetLogo } from './presetLogos';

type Tool = 'move' | 'hand' | 'brush' | 'eraser' | 'line' | 'fill' | 'shape' | 'text' | 'logo';
const TOOL_LABEL: Record<Tool, string> = {
  move: 'Move (V)',
  hand: 'Hand: drag to look around (H)',
  brush: 'Brush (B)',
  eraser: 'Eraser (E)',
  line: 'Line (L)',
  fill: 'Fill a part of the aircraft (G)',
  shape: 'Shape: drag to draw (U)',
  text: 'Text (T)',
  logo: 'Logo (O)',
};
const TOOL_KEYS: Record<string, Tool> = { v: 'move', h: 'hand', b: 'brush', e: 'eraser', l: 'line', g: 'fill', u: 'shape', t: 'text', o: 'logo' };
const SHAPE_LABEL: Record<ShapeKind, string> = { rect: 'Rectangle', ellipse: 'Circle', triangle: 'Triangle', star: 'Star', chevron: 'Chevron' };
const KIND_LABEL: Record<Layer['kind'], string> = { fill: 'Fill', band: 'Band', shape: 'Shape', path: 'Curve', text: 'Text', paint: 'Paint', logo: 'Logo' };

// ----------------------------------------------------------------------------
// Small pieces
// ----------------------------------------------------------------------------
function ToolIcon({ tool }: { tool: Tool }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const d: Record<Tool, React.ReactNode> = {
    move: <path {...p} d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />,
    hand: <path {...p} d="M8 12V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6 7-2.6 0-4-1.4-5.6-3.6L3.8 14a1.5 1.5 0 0 1 2.4-1.8L8 14" />,
    brush: <path {...p} d="M14.5 4.5l5 5L11 18l-5-5zM6 13c-2 0-3 1.5-3 3.5 0 1.6-.6 2.6-1 3.5 3.2 0 7-1 7-4" />,
    eraser: <path {...p} d="M4 15l9-9a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L12 19H7zM9 10l5 5M7 19h13" />,
    line: <path {...p} d="M5 19L19 5" />,
    fill: <path {...p} d="M5 11l7-7 7 7-7 7zM19 15s2 2.4 2 3.6a2 2 0 0 1-4 0c0-1.2 2-3.6 2-3.6zM5 11h14" />,
    shape: <path {...p} d="M4 4h9v9H4zM15 11a5 5 0 1 1-4 8" />,
    text: <path {...p} d="M5 6V4h14v2M12 4v16M9 20h6" />,
    logo: <path {...p} d="M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9.5a1.5 1.5 0 1 0 0-.01" />,
  };
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      {d[tool]}
    </svg>
  );
}

function Slider(props: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; onDone?: () => void; fmt?: (v: number) => string }) {
  return (
    <label style={{ display: 'grid', gap: 3, fontSize: 12.5, color: C.textSoft }}>
      <span style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{props.label}</span>
        <span className="num" style={{ color: C.muted }}>
          {props.fmt ? props.fmt(props.value) : props.value.toFixed(2)}
        </span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 0.01}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        onPointerUp={props.onDone}
        onKeyUp={props.onDone}
        style={{ width: '100%' }}
      />
    </label>
  );
}

/** Wrapping choice chips (a long list fits a narrow panel). */
function Choice<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          style={{ padding: '4px 9px', borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: `1px solid ${o.value === value ? C.brand : C.border}`, background: o.value === value ? `${C.brand}26` : C.raised, color: o.value === value ? C.brand : C.textSoft }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const iconBtn = (active: boolean): React.CSSProperties => ({
  width: 40,
  height: 40,
  display: 'grid',
  placeItems: 'center',
  borderRadius: 9,
  border: `1px solid ${active ? C.brand : C.border}`,
  background: active ? `${C.brand}26` : C.raised,
  color: active ? C.brand : C.textSoft,
  cursor: 'pointer',
  padding: 0,
  flex: 'none',
});

const smallBtn: React.CSSProperties = { background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: '2px 4px', fontSize: 13, lineHeight: 1 };

// ----------------------------------------------------------------------------
// Helpers on the document
// ----------------------------------------------------------------------------
const regionAt = (g: Geometry, px: number, py: number): Region | null => {
  const x = Math.round(px), y = Math.round(py);
  if (x < 0 || y < 0 || x >= g.w || y >= g.h) return null;
  const i = (y * g.w + x) * 4;
  const v: [Region, number][] = [
    ['tail', g.M[i]],
    ['fuselage', g.M[i + 1]],
    ['engines', g.M[i + 2]],
    ['wings', g.M2[i]],
    ['winglets', g.M2[i + 1]],
    ['stabiliser', g.M2[i + 2]],
  ];
  let best: [Region, number] = v[0];
  for (const x of v) if (x[1] > best[1]) best = x;
  return best[1] < 100 ? null : best[0];
};
const frameFor = (r: Region | null): Frame => (r === 'tail' ? 'fin' : 'body');
/** A layer drawn on the wings or tailplane still uses the body frame. */
const inPoly = (pts: [number, number][], x: number, y: number) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
};
/** Fewer points for a stroke (Ramer–Douglas–Peucker), in frame units. */
function simplify(pts: number[], tol: number): number[] {
  const n = pts.length / 2;
  if (n <= 2) return pts;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = pts[a * 2], ay = pts[a * 2 + 1], bx = pts[b * 2], by = pts[b * 2 + 1];
    const len = Math.hypot(bx - ax, by - ay) || 1e-9;
    let far = -1, fd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i * 2 + 1]) - (ax - pts[i * 2]) * (by - ay)) / len;
      if (d > fd) {
        fd = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(Math.round(pts[i * 2] * 1e4) / 1e4, Math.round(pts[i * 2 + 1] * 1e4) / 1e4);
  return out;
}
const docColours = (d: Livery) => {
  const out: string[] = [];
  for (const l of [...d.layers].reverse()) {
    const c = 'colour' in l ? l.colour : l.kind === 'paint' ? l.strokes[l.strokes.length - 1]?.colour : undefined;
    if (c && !out.includes(c)) out.push(c);
  }
  return out.slice(0, 8);
};
const countStrokes = (d: Livery) => d.layers.reduce((n, l) => n + (l.kind === 'paint' ? l.strokes.length : 0), 0);

// ----------------------------------------------------------------------------
// The editor
// ----------------------------------------------------------------------------
export function LiveryEditor(props: {
  liveries: Livery[];
  airlineName: string;
  models: string[];
  /** A registration to show on the preview (one of the player's, or a made-up one). */
  sampleReg?: string;
  /** Which livery to open (0 or 1). */
  start?: number;
  /** The airline's colours: where the ready-made styles and logos start. */
  airlineColours?: { a: string; b: string };
  /** The airline's logo (from Airline details), ready to place. */
  airlineLogo?: string;
  onSave: (l: Livery[]) => void;
  onClose: () => void;
}) {
  const layout = useLayout();
  const phone = layout === 'phone';
  const name = props.airlineName;
  const reg = props.sampleReg || 'P4-ABC';
  const [docs, setDocs] = useState<Livery[]>(() => {
    const l = props.liveries.map((x) => normaliseLivery(x)).filter((x): x is Livery => Boolean(x));
    return l.length ? l : [{ ...normaliseLivery(DEFAULT_LIVERY)!, name: 'Main' }];
  });
  const [active, setActiveState] = useState(() => Math.min(props.start ?? 0, Math.max(0, docs.length - 1)));
  const activeRef = useRef(active);
  activeRef.current = active;
  const docsRef = useRef(docs);
  docsRef.current = docs;
  const doc = docs[active] ?? docs[0];
  const docRef = useRef(doc);
  docRef.current = doc;
  /** Undo and redo, one history for each livery. */
  const pasts = useRef<Livery[][]>([[], []]);
  const futures = useRef<Livery[][]>([[], []]);
  const past = { get current() { return pasts.current[activeRef.current]; } };
  const future = {
    get current() {
      return futures.current[activeRef.current];
    },
    set current(v: Livery[]) {
      futures.current[activeRef.current] = v;
    },
  };
  const setDocState = (next: Livery) => {
    docsRef.current = docsRef.current.map((d, i) => (i === activeRef.current ? next : d));
    setDocs(docsRef.current);
  };
  const [, bump] = useState(0);
  const dirty = useRef(false);
  /** A change that can be undone. `from` is the state before a drag. */
  const commit = useCallback((next: Livery, from: Livery = docRef.current) => {
    past.current.push(from);
    if (past.current.length > 80) past.current.shift();
    future.current = [];
    dirty.current = true;
    docRef.current = next;
    setDocState(next);
    bump((n) => n + 1);
  }, []);
  /** A change while dragging (committed when the drag ends). */
  const live = useCallback((next: Livery) => {
    docRef.current = next;
    setDocState(next);
  }, []);
  const undo = () => {
    const p = past.current.pop();
    if (!p) return;
    future.current.push(docRef.current);
    docRef.current = p;
    setDocState(p);
    bump((n) => n + 1);
  };
  const redo = () => {
    const f = future.current.pop();
    if (!f) return;
    past.current.push(docRef.current);
    docRef.current = f;
    setDocState(f);
    bump((n) => n + 1);
  };

  const [sel, setSel] = useState<string | null>(() => doc.layers[doc.layers.length - 1]?.id ?? null);
  const setActive = (i: number) => {
    activeRef.current = i;
    setActiveState(i);
    const d = docsRef.current[i];
    docRef.current = d;
    setSel(d?.layers[d.layers.length - 1]?.id ?? null);
  };
  const selLayer = doc.layers.find((l) => l.id === sel) ?? null;
  const [tool, setTool] = useState<Tool>('move');
  const [colour, setColour] = useState('#c8102e');
  const [brushSize, setBrushSize] = useState(0.06);
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');
  const [logoPick, setLogoPick] = useState<string | null>(() => Object.keys(doc.logos)[0] ?? null);
  const [note, setNote] = useState<string | null>(null);
  const [tab, setTab] = useState<'layers' | 'props' | 'styles'>('layers');
  const [stylesOpen, setStylesOpen] = useState(false);
  const [styleA, setStyleA] = useState(props.airlineColours?.a ?? '#1d4e89');
  const [styleB, setStyleB] = useState(props.airlineColours?.b ?? '#f5a623');
  const [zoom, setZoom] = useState(1);
  const [colourOpen, setColourOpen] = useState(false);

  // aircraft to preview on: your types first, then the common ones
  const choices = useMemo(() => {
    const own = props.models.filter((m) => AIRCRAFT_PHOTOS[m]);
    const extra = ['a320neo', 'b737-max8', 'b787-9', 'a350-900', 'b777-300er', 'a380-800', 'e175', 'crj-900', 'atr-72-600', 'dash8-q400', 'b747-400'].filter((m) => !own.includes(m) && AIRCRAFT_PHOTOS[m]);
    return [...own, ...extra];
  }, [props.models]);
  const [model, setModel] = useState(choices[0] ?? 'a320neo');
  const [geo, setGeo] = useState<Geometry | null>(null);
  useEffect(() => {
    let ok = true;
    setGeo(null);
    aircraftGeometry(model).then((g) => ok && setGeo(g));
    return () => {
      ok = false;
    };
  }, [model]);

  // the picture, redrawn when anything changes
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [logoImgs, setLogoImgs] = useState<Map<string, HTMLImageElement>>(new Map());
  useEffect(() => {
    let ok = true;
    loadLogos(doc).then((m) => ok && setLogoImgs(m));
    return () => {
      ok = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.logos]);
  useEffect(() => {
    if (!geo || !canvasRef.current) return;
    const raf = requestAnimationFrame(() => {
      const c = canvasRef.current?.getContext('2d');
      if (!c) return;
      try {
        renderLivery(geo, doc, name, logoImgs, c, reg);
      } catch (e) {
        // never leave the aircraft blank: at worst the plain picture
        console.error('livery preview', e);
        c.canvas.width = geo.w;
        c.canvas.height = geo.h;
        c.drawImage(geo.base, 0, 0, geo.w, geo.h);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [geo, doc, name, logoImgs, reg]);

  const flash = (t: string) => {
    setNote(t);
    window.setTimeout(() => setNote((n) => (n === t ? null : n)), 3200);
  };

  // ---------------------------------------------------------------- layers
  const setLayers = (layers: Layer[], from?: Livery) => commit({ ...docRef.current, layers }, from);
  const patch = (id: string, p: Partial<Layer>, isLive = false) => {
    const next = { ...docRef.current, layers: docRef.current.layers.map((l) => (l.id === id ? ({ ...l, ...p } as Layer) : l)) };
    if (isLive) live(next);
    else commit(next);
  };
  /** Before a slider drag: the state to undo back to. */
  const sliderFrom = useRef<Livery | null>(null);
  const patchSlider = (id: string, p: Partial<Layer>) => {
    if (!sliderFrom.current) sliderFrom.current = docRef.current;
    patch(id, p, true);
  };
  const sliderDone = () => {
    if (sliderFrom.current) {
      const from = sliderFrom.current;
      sliderFrom.current = null;
      commit(docRef.current, from);
    }
  };
  const addLayer = (l: Layer) => {
    const d = docRef.current;
    if (d.layers.length >= MAX_LAYERS) {
      flash(`A livery can have up to ${MAX_LAYERS} layers.`);
      return null;
    }
    const at = sel ? d.layers.findIndex((x) => x.id === sel) + 1 : d.layers.length;
    const layers = [...d.layers];
    layers.splice(at || layers.length, 0, l);
    setLayers(layers);
    setSel(l.id);
    return l;
  };
  const removeLayer = (id: string) => {
    const d = docRef.current;
    const i = d.layers.findIndex((l) => l.id === id);
    if (i < 0) return;
    const layers = d.layers.filter((l) => l.id !== id);
    setLayers(layers);
    setSel(layers[Math.max(0, i - 1)]?.id ?? null);
  };
  const moveLayer = (id: string, by: number) => {
    const layers = [...docRef.current.layers];
    const i = layers.findIndex((l) => l.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= layers.length) return;
    [layers[i], layers[j]] = [layers[j], layers[i]];
    setLayers(layers);
  };
  const duplicate = (id: string) => {
    const l = docRef.current.layers.find((x) => x.id === id);
    if (!l) return;
    const copy = JSON.parse(JSON.stringify(l)) as Layer;
    copy.id = newId();
    copy.name = `${l.name} copy`;
    copy.locked = undefined;
    addLayer(copy);
  };

  // ---------------------------------------------------------------- pointer
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<null | {
    kind: 'move' | 'stroke' | 'line' | 'shape' | 'pan';
    from: Livery;
    id?: string;
    start: [number, number];
    startLayer?: Layer;
    sx?: number;
    sy?: number;
  }>(null);
  const [shapeBox, setShapeBox] = useState<null | [number, number, number, number]>(null);

  const toPic = (e: React.PointerEvent): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * geo!.w, ((e.clientY - r.top) / r.height) * geo!.h];
  };

  const hit = (px: number, py: number): Layer | null => {
    if (!geo) return null;
    const L = docRef.current.layers;
    for (let i = L.length - 1; i >= 0; i--) {
      const l = L[i];
      if (l.hidden || l.kind === 'fill') continue;
      const o = layerOutline(geo, l, name, reg);
      if (o && inPoly(o, px, py)) return l;
    }
    return null;
  };

  /** The paint layer to draw on: the selected one, or a new one for the part of the aircraft clicked. */
  const paintTarget = (px: number, py: number, erase: boolean): Extract<Layer, { kind: 'paint' }> | null => {
    const s = docRef.current.layers.find((l) => l.id === sel);
    if (s && s.kind === 'paint' && !s.locked) return s;
    if (erase) {
      flash('Pick a paint layer to erase from (the eraser works on brush strokes).');
      return null;
    }
    const region = regionAt(geo!, px, py) ?? 'fuselage';
    const n = docRef.current.layers.filter((l) => l.kind === 'paint').length + 1;
    const l: Layer = { id: newId(), name: `Paint ${n}`, opacity: 1, region, kind: 'paint', frame: frameFor(region), strokes: [] };
    return addLayer(l) as Extract<Layer, { kind: 'paint' }> | null;
  };

  const onDown = (e: React.PointerEvent) => {
    if (!geo || e.button > 0) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const [px, py] = toPic(e);
    const from = docRef.current;
    if (tool === 'hand') {
      drag.current = { kind: 'pan', from, start: [e.clientX, e.clientY], sx: stageRef.current?.scrollLeft, sy: stageRef.current?.scrollTop };
      return;
    }
    if (tool === 'move') {
      const h = hit(px, py);
      const target = h ?? selLayer;
      if (h) setSel(h.id);
      if (!target || target.kind === 'fill') return;
      if (target.locked) {
        flash(`${target.name} is locked. Unlock it in the layers to move it.`);
        return;
      }
      let startLayer = target;
      // auto-placed titles become a normal text layer once moved
      if (target.kind === 'text' && target.auto) {
        const t = titlesPosition(geo, target, name, reg);
        startLayer = { ...target, auto: undefined, x: t.x, y: t.y, size: t.size };
      }
      drag.current = { kind: 'move', from, id: target.id, start: [px, py], startLayer };
      return;
    }
    if (tool === 'brush' || tool === 'eraser' || tool === 'line') {
      const t = paintTarget(px, py, tool === 'eraser');
      if (!t) return;
      const used = docRef.current.layers.reduce((n, l) => n + (l.kind === 'paint' ? l.strokes.reduce((m, s) => m + s.pts.length, 0) : 0), 0);
      if (docRef.current.layers.reduce((n, l) => n + (l.kind === 'paint' ? l.strokes.length : 0), 0) >= MAX_STROKES || used >= MAX_POINTS) {
        flash('That’s as much brushwork as a livery can keep. Clear or delete a paint layer to draw more.');
        return;
      }
      const [fx, fy] = fromPx(geo, t.frame, px, py);
      const stroke = { colour, width: brushSize * (t.frame === 'fin' ? 0.5 : 1), pts: tool === 'line' ? [fx, fy, fx, fy] : [fx, fy], erase: tool === 'eraser' || undefined };
      const before = docRef.current;
      const next = { ...before, layers: before.layers.map((l) => (l.id === t.id && l.kind === 'paint' ? { ...l, strokes: [...l.strokes, stroke] } : l)) };
      live(next);
      drag.current = { kind: tool === 'line' ? 'line' : 'stroke', from: before, id: t.id, start: [px, py] };
      return;
    }
    if (tool === 'fill') {
      const region = regionAt(geo, px, py);
      if (!region) return;
      addLayer(fillLayer(`${REGION_LABEL[region]} colour`, region, colour));
      return;
    }
    if (tool === 'shape') {
      drag.current = { kind: 'shape', from, start: [px, py] };
      setShapeBox([px, py, px, py]);
      return;
    }
    if (tool === 'text') {
      const region = regionAt(geo, px, py) ?? 'fuselage';
      const frame = frameFor(region);
      const [x, y] = fromPx(geo, frame, px, py);
      const l = addLayer({ id: newId(), name: 'Text', opacity: 1, region, kind: 'text', frame, text: 'Text', font: 'sans', colour, x, y, size: frame === 'fin' ? 0.2 : 0.2, rot: 0 });
      if (l) {
        setTab('props');
        setTool('move');
        window.setTimeout(() => document.getElementById('livery-text-input')?.focus(), 50);
      }
      return;
    }
    if (tool === 'logo') {
      if (!logoPick || !doc.logos[logoPick]) {
        setTab('props');
        flash('Upload a logo first (in the settings).');
        return;
      }
      const region = regionAt(geo, px, py) ?? 'tail';
      const frame = frameFor(region);
      const [x, y] = fromPx(geo, frame, px, py);
      addLayer({ id: newId(), name: 'Logo', opacity: 1, region, kind: 'logo', frame, logo: logoPick, x, y, size: frame === 'fin' ? 0.4 : 0.5, rot: 0 });
      setTool('move');
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !geo) return;
    if (d.kind === 'pan') {
      const st = stageRef.current;
      if (st) {
        st.scrollLeft = (d.sx ?? 0) - (e.clientX - d.start[0]);
        st.scrollTop = (d.sy ?? 0) - (e.clientY - d.start[1]);
      }
      return;
    }
    const [px, py] = toPic(e);
    if (d.kind === 'shape') {
      setShapeBox([d.start[0], d.start[1], px, py]);
      return;
    }
    const cur = docRef.current;
    if (d.kind === 'move' && d.startLayer) {
      const l0 = d.startLayer;
      const frame: Frame = l0.kind === 'fill' || l0.kind === 'band' ? 'body' : l0.frame;
      const [ax, ay] = fromPx(geo, frame, d.start[0], d.start[1]);
      const [bx, by] = fromPx(geo, frame, px, py);
      const dx = bx - ax, dy = by - ay;
      let n: Layer = l0;
      if (l0.kind === 'shape' || l0.kind === 'text' || l0.kind === 'logo') n = { ...l0, x: l0.x + dx, y: l0.y + dy };
      else if (l0.kind === 'path') n = { ...l0, dx: l0.dx + dx, dy: l0.dy + dy };
      else if (l0.kind === 'band') n = { ...l0, v0: l0.v0 + dy, v1: l0.v1 + dy };
      else if (l0.kind === 'paint') n = { ...l0, strokes: l0.strokes.map((s) => ({ ...s, pts: s.pts.map((v, i) => v + (i % 2 ? dy : dx)) })) };
      live({ ...cur, layers: cur.layers.map((l) => (l.id === d.id ? n : l)) });
      return;
    }
    if (d.kind === 'stroke' || d.kind === 'line') {
      const l = cur.layers.find((x) => x.id === d.id);
      if (!l || l.kind !== 'paint') return;
      const [fx, fy] = fromPx(geo, l.frame, px, py);
      const strokes = [...l.strokes];
      const s = { ...strokes[strokes.length - 1] };
      if (d.kind === 'line') s.pts = [s.pts[0], s.pts[1], fx, fy];
      else {
        const u = unitPx(geo, l.frame);
        const lx = s.pts[s.pts.length - 2], ly = s.pts[s.pts.length - 1];
        const [lpx, lpy] = [lx * (l.frame === 'body' ? geo.body.len : 1), ly * u];
        const [cpx, cpy] = [fx * (l.frame === 'body' ? geo.body.len : 1), fy * u];
        if (Math.hypot(cpx - lpx, cpy - lpy) < 1.5 || s.pts.length > 1200) return;
        s.pts = [...s.pts, fx, fy];
      }
      strokes[strokes.length - 1] = s;
      live({ ...cur, layers: cur.layers.map((x) => (x.id === l.id ? { ...l, strokes } : x)) });
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !geo) return;
    if (d.kind === 'pan') return;
    if (d.kind === 'shape') {
      const box = shapeBox;
      setShapeBox(null);
      if (!box) return;
      const [x0, y0, x1, y1] = box;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const region = regionAt(geo, x0, y0) ?? regionAt(geo, cx, cy) ?? 'fuselage';
      const frame = frameFor(region);
      const u = unitPx(geo, frame);
      const big = Math.abs(x1 - x0) > 6 || Math.abs(y1 - y0) > 6;
      const [fx, fy] = fromPx(geo, frame, big ? cx : x0, big ? cy : y0);
      const w = big ? Math.abs(x1 - x0) / u : frame === 'fin' ? 0.3 : 0.4;
      const h = big ? Math.abs(y1 - y0) / u : w;
      const l = shapeLayer(SHAPE_LABEL[shapeKind], frame, shapeKind, colour, fx, fy, Math.max(0.02, w), Math.max(0.02, h));
      l.region = region;
      addLayer(l);
      return;
    }
    if (d.kind === 'stroke' || d.kind === 'line') {
      const cur = docRef.current;
      const l = cur.layers.find((x) => x.id === d.id);
      if (l && l.kind === 'paint') {
        const strokes = [...l.strokes];
        const s = strokes[strokes.length - 1];
        const tol = 0.6 / Math.max(geo.body.len, unitPx(geo, l.frame));
        if (s) strokes[strokes.length - 1] = { ...s, pts: d.kind === 'line' ? s.pts.map((v) => Math.round(v * 1e4) / 1e4) : simplify(s.pts, tol) };
        commit({ ...cur, layers: cur.layers.map((x) => (x.id === l.id ? { ...l, strokes } : x)) }, d.from);
      }
      return;
    }
    if (d.kind === 'move') {
      if (docRef.current !== d.from) commit(docRef.current, d.from);
    }
  };

  // ---------------------------------------------------------------- keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select');
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (typing || mod || e.altKey) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        e.preventDefault();
        removeLayer(sel);
        return;
      }
      const t = TOOL_KEYS[e.key.toLowerCase()];
      if (t) setTool(t);
      if (e.key === 'Escape' && !dirty.current) props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------------------------------------------------------------- logos
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoFit, setLogoFit] = useState<'contain' | 'cover'>('contain');
  const [logoWhite, setLogoWhite] = useState(false);
  const onLogoFile = async (f: File | undefined) => {
    if (!f) return;
    if (Object.keys(docRef.current.logos).length >= MAX_LOGOS) {
      flash(`You can keep up to ${MAX_LOGOS} logos. Delete one first.`);
      return;
    }
    const r = await makeLogo(f, { fit: logoFit, removeWhite: logoWhite });
    if ('error' in r) {
      flash(r.error);
      return;
    }
    if (addLogo(r.url)) flash('Logo added. Click the aircraft to place it.');
  };
  const deleteLogo = (id: string) => {
    const d = docRef.current;
    const logos = { ...d.logos };
    delete logos[id];
    commit({ ...d, logos, badge: d.badge === id ? undefined : d.badge, layers: d.layers.filter((l) => !(l.kind === 'logo' && l.logo === id)) });
    if (logoPick === id) setLogoPick(Object.keys(logos)[0] ?? null);
  };
  /** A logo added to this livery (uploaded or a preset); the first one also becomes the airline's logo. */
  const addLogo = (url: string) => {
    const d = docRef.current;
    if (Object.keys(d.logos).length >= MAX_LOGOS) {
      flash(`A livery can have up to ${MAX_LOGOS} logos. Delete one first.`);
      return null;
    }
    const id = `logo${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    commit({ ...d, logos: { ...d.logos, [id]: url } });
    setLogoPick(id);
    setTool('logo');
    return id;
  };
  const [presetA, setPresetA] = useState(props.airlineColours?.a ?? '#1d4e89');
  const [presetB, setPresetB] = useState(props.airlineColours?.b ?? '#f5a623');
  const presets = useMemo(() => PRESET_LOGOS.map((p) => ({ ...p, url: presetLogo(p.id, presetA, presetB, name) })), [presetA, presetB, name]);

  // ---------------------------------------------------------------- parts of the screen
  // the airline's colours first, then the ones this livery uses
  const recent = [...new Set([...(props.airlineColours ? [props.airlineColours.a, props.airlineColours.b] : []), ...docColours(doc)])];
  const outline = geo && selLayer && !selLayer.hidden ? layerOutline(geo, selLayer, name, reg) : null;

  const stage = (
    <div
      ref={stageRef}
      style={{ position: 'relative', overflow: 'auto', borderRadius: 12, background: `${cloudSkyCss(`livery-${model}`)} center / cover`, minHeight: phone ? 170 : 320, flex: 1, border: `1px solid ${C.line}` }}
      onWheel={(e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        setZoom((z) => Math.min(4, Math.max(1, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
      }}
    >
      <div style={{ width: `${zoom * 100}%`, minHeight: '100%', display: 'grid', placeItems: 'center', padding: phone ? '14px 4%' : '28px 5%', boxSizing: 'border-box' }}>
        <div style={{ position: 'relative', width: '100%', aspectRatio: geo ? `${geo.w} / ${geo.h}` : AIRCRAFT_PHOTOS[model] ? `${AIRCRAFT_PHOTOS[model][0]} / ${AIRCRAFT_PHOTOS[model][1]}` : '10 / 3' }}>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', filter: 'drop-shadow(0 10px 12px rgba(10,20,40,.28))' }} />
          {geo && (
            <svg
              ref={svgRef}
              aria-label="Livery canvas"
              viewBox={`0 0 ${geo.w} ${geo.h}`}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none', cursor: tool === 'hand' ? 'grab' : tool === 'move' ? 'move' : 'crosshair' }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            >
              {outline && <polygon points={outline.map((p) => p.join(',')).join(' ')} fill="none" stroke="#ffffff" strokeWidth={geo.w / 500} strokeDasharray={`${geo.w / 120} ${geo.w / 200}`} style={{ mixBlendMode: 'difference' }} />}
              {shapeBox && <rect x={Math.min(shapeBox[0], shapeBox[2])} y={Math.min(shapeBox[1], shapeBox[3])} width={Math.abs(shapeBox[2] - shapeBox[0])} height={Math.abs(shapeBox[3] - shapeBox[1])} fill={`${colour}66`} stroke="#fff" strokeWidth={geo.w / 600} />}
            </svg>
          )}
        </div>
      </div>
      {!geo && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 13, textShadow: '0 1px 3px rgba(0,0,0,.5)' }}>Loading the aircraft…</div>}
    </div>
  );

  const tools = (
    <div style={{ display: 'flex', flexDirection: phone ? 'row' : 'column', gap: 6, overflowX: phone ? 'auto' : undefined, paddingBottom: phone ? 2 : 0, alignItems: 'center' }}>
      {(Object.keys(TOOL_LABEL) as Tool[]).map((t) => (
        <button key={t} type="button" title={TOOL_LABEL[t]} aria-label={TOOL_LABEL[t]} aria-pressed={tool === t} onClick={() => setTool(t)} style={iconBtn(tool === t)}>
          <ToolIcon tool={t} />
        </button>
      ))}
      <span style={{ position: 'relative' }}>
        <button type="button" title="Colour for new strokes, fills, shapes and text" aria-label="Colour" aria-expanded={colourOpen} onClick={() => setColourOpen((v) => !v)} style={iconBtn(colourOpen)}>
          <span style={{ width: 22, height: 22, borderRadius: 6, background: colour, border: '2px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,.4)' }} />
        </button>
        {colourOpen && (
          <div style={{ position: phone ? 'fixed' : 'absolute', zIndex: 20, ...(phone ? { left: 10, right: 10, top: 120 } : { left: 50, top: 0, width: 260 }), background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, boxShadow: '0 14px 30px rgba(0,0,0,.5)', display: 'grid', gap: 8 }}>
            <ColourPicker label="Colour" value={colour} onChange={setColour} recent={recent} open />
            <Button size="sm" onClick={() => setColourOpen(false)}>
              Done
            </Button>
          </div>
        )}
      </span>
    </div>
  );

  // settings for the tool in use
  const toolSettings =
    tool === 'brush' || tool === 'eraser' || tool === 'line' ? (
      <div style={{ display: 'grid', gap: 8 }}>
        <Slider label={tool === 'eraser' ? 'Eraser size' : 'Brush size'} value={brushSize} min={0.01} max={0.4} onChange={setBrushSize} fmt={(v) => `${Math.round(v * 100)}`} />
        {tool !== 'eraser' && <ColourPicker label="Colour" value={colour} onChange={setColour} recent={recent} />}
        <div style={{ fontSize: 12, color: C.muted }}>{tool === 'eraser' ? 'Rubs out brush strokes on the selected paint layer.' : 'Draws on the selected paint layer, or a new one for the part you start on.'}</div>
      </div>
    ) : tool === 'shape' ? (
      <div style={{ display: 'grid', gap: 8 }}>
        <Choice<ShapeKind> label="Shape" value={shapeKind} onChange={setShapeKind} options={(Object.keys(SHAPE_LABEL) as ShapeKind[]).map((k) => ({ value: k, label: SHAPE_LABEL[k] }))} />
        <ColourPicker label="Colour" value={colour} onChange={setColour} recent={recent} />
      </div>
    ) : tool === 'fill' || tool === 'text' ? (
      <div style={{ display: 'grid', gap: 8 }}>
        <ColourPicker label="Colour" value={colour} onChange={setColour} recent={recent} />
        <div style={{ fontSize: 12, color: C.muted }}>{tool === 'fill' ? 'Click the fuselage, tail or an engine to colour all of it.' : 'Click where the text goes.'}</div>
      </div>
    ) : null;

  const logosPanel = (
    <div style={{ display: 'grid', gap: 8 }}>
      {props.airlineLogo && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            title="Your airline logo: add it to this livery to place it"
            onClick={() => {
              const have = Object.entries(docRef.current.logos).find(([, v]) => v === props.airlineLogo);
              if (have) {
                setLogoPick(have[0]);
                setTool('logo');
                flash('Click the aircraft to place your airline logo.');
              } else if (addLogo(props.airlineLogo!)) flash('Airline logo added. Click the aircraft to place it.');
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px 4px 4px', borderRadius: 9, border: `1px solid ${C.brand}88`, background: `${C.brand}14`, color: C.text, cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}
          >
            <img src={props.airlineLogo} alt="" style={{ width: 34, height: 34, borderRadius: 7, background: '#fff', objectFit: 'contain', padding: 2 }} />
            Use my airline logo
          </button>
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {Object.entries(doc.logos).map(([id, src]) => (
          <div key={id} style={{ position: 'relative' }}>
            <button
              type="button"
              aria-label="Use this logo"
              onClick={() => {
                setLogoPick(id);
                setTool('logo');
              }}
              style={{ width: 56, height: 56, borderRadius: 8, border: `2px solid ${logoPick === id ? C.brand : C.line}`, background: `repeating-conic-gradient(#ffffff22 0 25%, transparent 0 50%) 0 0 / 12px 12px, ${C.bg}`, padding: 4, cursor: 'pointer' }}
            >
              <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </button>
            <button type="button" aria-label="Delete this logo" title="Delete this logo (and its layers)" onClick={() => deleteLogo(id)} style={{ ...smallBtn, position: 'absolute', top: -6, right: -6, background: C.raised, borderRadius: 99, border: `1px solid ${C.border}`, width: 20, height: 20, padding: 0 }}>
              ×
            </button>

          </div>
        ))}
        {Object.keys(doc.logos).length < MAX_LOGOS && (
          <button type="button" onClick={() => fileRef.current?.click()} style={{ width: 56, height: 56, borderRadius: 8, border: `1px dashed ${C.border}`, background: 'none', color: C.textSoft, cursor: 'pointer', fontSize: 11.5 }}>
            + Upload
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept={LOGO_TYPES} style={{ display: 'none' }} onChange={(e) => {
        onLogoFile(e.target.files?.[0]);
        e.target.value = '';
      }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', fontSize: 12.5 }}>
        <Segmented<'contain' | 'cover'> size="sm" value={logoFit} onChange={setLogoFit} options={[{ value: 'contain', label: 'Fit' }, { value: 'cover', label: 'Fill square' }]} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={logoWhite} onChange={(e) => setLogoWhite(e.target.checked)} />
          Take out a white background
        </label>
      </div>
      <div style={{ fontSize: 11.5, color: C.muted }}>PNG, JPG or WebP, made into a 128×128 logo. Only upload pictures you own or have the right to use. Up to {MAX_LOGOS}. Your airline logo is set in Menu → Airline details.</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 650, color: C.textSoft }}>Ready-made logos</span>
        <input type="color" aria-label="Preset main colour" value={presetA} onChange={(e) => setPresetA(e.target.value)} style={{ width: 26, height: 22, padding: 0, border: `1px solid ${C.border}`, borderRadius: 5 }} />
        <input type="color" aria-label="Preset second colour" value={presetB} onChange={(e) => setPresetB(e.target.value)} style={{ width: 26, height: 22, padding: 0, border: `1px solid ${C.border}`, borderRadius: 5 }} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {presets.map((p) =>
          p.url ? (
            <button
              key={p.id}
              type="button"
              title={`${p.label}: add it to this livery`}
              aria-label={`Add the ${p.label} logo`}
              onClick={() => {
                if (addLogo(p.url!)) flash(`${p.label} logo added. Click the aircraft to place it.`);
              }}
              style={{ width: 44, height: 44, borderRadius: 8, border: `1px solid ${C.line}`, background: C.bg, padding: 3, cursor: 'pointer' }}
            >
              <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </button>
          ) : null
        )}
      </div>
    </div>
  );

  const section: React.CSSProperties = { display: 'grid', gap: 10, padding: 12, borderRadius: 10, border: `1px solid ${C.line}`, background: C.panel };
  const head = (t: string, right?: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{t}</div>
      {right}
    </div>
  );

  const props_ = selLayer ? <LayerProps layer={selLayer} name={name} recent={recent} patch={(p) => patch(selLayer.id, p)} slide={(p) => patchSlider(selLayer.id, p)} done={sliderDone} logos={doc.logos} geo={geo} reg={reg} /> : null;

  const settingsPanel = (
    <div style={{ display: 'grid', gap: 10 }}>
      {toolSettings && (
        <div style={section}>
          {head(TOOL_LABEL[tool].replace(/ \(.\)$/, '').replace(/:.*$/, ''))}
          {toolSettings}
        </div>
      )}
      {(

        <div style={section}>
          {head('Logos')}
          {logosPanel}
        </div>
      )}
      <div style={section}>
        {head(selLayer ? `${KIND_LABEL[selLayer.kind]}: ${selLayer.name}` : 'Layer')}
        {props_ ?? <div style={{ fontSize: 12.5, color: C.muted }}>Pick a layer to change it.</div>}
      </div>
    </div>
  );

  const layersPanel = (
    <div style={{ ...section, gap: 6 }}>
      {head(
        `Layers ${doc.layers.length}/${MAX_LAYERS}`,
        <AddLayerMenu
          onAdd={(k) => {
            const region: Region = selLayer?.region ?? 'fuselage';
            const frame = frameFor(region);
            if (k === 'fill') addLayer(fillLayer('Fill', region === 'all' ? 'fuselage' : region, colour));
            else if (k === 'band') addLayer({ id: newId(), name: 'Band', opacity: 1, region: 'fuselage', kind: 'band', colour, v0: 0.55, v1: 0.63 });
            else if (k === 'shape') addLayer(shapeLayer('Shape', frame, 'rect', colour, frame === 'fin' ? 0.5 : 0.5, 0.5, 0.4));
            else if (k === 'text') addLayer({ id: newId(), name: 'Text', opacity: 1, region, kind: 'text', frame, text: 'Text', font: 'sans', colour, x: 0.5, y: frame === 'fin' ? 0.5 : 0.3, size: 0.2, rot: 0 });
            else if (k === 'titles') addLayer({ id: newId(), name: 'Titles', opacity: 1, region: 'fuselage', kind: 'text', frame: 'body', text: '', airlineName: true, font: 'sans', colour, x: 0.2, y: 0.25, size: 0.16, rot: 0, auto: 'titles' });
            else if (k === 'registration') {
              const r = registrationLayer('#3a3f45');
              if (r.kind === 'text') r.colour = colour;
              addLayer(r);
            } else if (k === 'paint') addLayer({ id: newId(), name: 'Paint', opacity: 1, region, kind: 'paint', frame, strokes: [] });
          }}
        />
      )}
      <div role="listbox" aria-label="Layers" style={{ display: 'grid', gap: 2, maxHeight: phone ? undefined : 300, overflowY: 'auto' }}>
        {[...doc.layers].reverse().map((l) => (
          <div
            key={l.id}
            role="option"
            aria-selected={l.id === sel}
            onClick={() => setSel(l.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px', borderRadius: 7, background: l.id === sel ? `${C.brand}22` : 'transparent', border: `1px solid ${l.id === sel ? `${C.brand}88` : 'transparent'}`, cursor: 'pointer', opacity: l.hidden ? 0.55 : 1 }}
          >
            <button type="button" aria-label={l.hidden ? `Show ${l.name}` : `Hide ${l.name}`} title={l.hidden ? 'Show' : 'Hide'} onClick={(e) => { e.stopPropagation(); patch(l.id, { hidden: l.hidden ? undefined : true }); }} style={smallBtn}>
              {l.hidden ? '◌' : '●'}
            </button>
            <span style={{ width: 16, height: 16, borderRadius: 4, flex: 'none', background: 'colour' in l ? l.colour : l.kind === 'paint' ? l.strokes[0]?.colour ?? C.raised : C.raised, border: `1px solid ${C.line}`, display: 'grid', placeItems: 'center', fontSize: 9, color: C.muted }}>
              {l.kind === 'logo' ? 'L' : l.kind === 'text' ? 'T' : ''}
            </span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {l.name}
              <span style={{ color: C.faint, fontSize: 11.5 }}> · {REGION_LABEL[l.region]}</span>
            </span>
            <button type="button" aria-label={l.locked ? `Unlock ${l.name}` : `Lock ${l.name}`} title={l.locked ? 'Unlock' : 'Lock'} onClick={(e) => { e.stopPropagation(); patch(l.id, { locked: l.locked ? undefined : true }); }} style={{ ...smallBtn, color: l.locked ? C.brand : C.faint }}>
              {l.locked ? '🔒' : '🔓'}
            </button>
          </div>
        ))}
        {doc.layers.length === 0 && <div style={{ fontSize: 12.5, color: C.muted, padding: 6 }}>No layers: the aircraft is plain white.</div>}
      </div>
      {selLayer && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <Button size="sm" onClick={() => moveLayer(selLayer.id, 1)} title="Move up (in front)">
            Up
          </Button>
          <Button size="sm" onClick={() => moveLayer(selLayer.id, -1)} title="Move down (behind)">
            Down
          </Button>
          <Button size="sm" onClick={() => duplicate(selLayer.id)}>
            Duplicate
          </Button>
          <Button size="sm" onClick={() => removeLayer(selLayer.id)}>
            Delete
          </Button>
        </div>
      )}
    </div>
  );

  // previews of the ready-made styles on the aircraft being shown, in the chosen colours
  const stylesShown = phone ? tab === 'styles' : stylesOpen;
  const [stylePics, setStylePics] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!geo || !stylesShown) return;
    let ok = true;
    const t = window.setTimeout(() => {
      const small = document.createElement('canvas');
      const sctx = small.getContext('2d')!;
      const out: Record<string, string> = {};
      for (const st of LIVERY_STYLES) {
        if (!ok) return;
        renderLivery(geo, { v: 2, layers: st.make(styleA, styleB), logos: {} }, name, new Map(), sctx, reg, 320);
        out[st.id] = small.toDataURL('image/webp', 0.85);
      }
      freeCanvas(small);
      if (ok) setStylePics(out);
    }, 150);
    return () => {
      ok = false;
      window.clearTimeout(t);
    };
  }, [geo, stylesShown, styleA, styleB, name, reg]);

  const stylesPanel = (
    <div style={section}>
      {head('Start from a style')}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
          <input type="color" value={styleA} onChange={(e) => setStyleA(e.target.value)} aria-label="Main colour" style={{ width: 30, height: 24, padding: 0, border: `1px solid ${C.border}`, borderRadius: 5 }} /> Main
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
          <input type="color" value={styleB} onChange={(e) => setStyleB(e.target.value)} aria-label="Second colour" style={{ width: 30, height: 24, padding: 0, border: `1px solid ${C.border}`, borderRadius: 5 }} /> Second
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
        {LIVERY_STYLES.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-label={s.label}
            onClick={() => {
              const layers = s.make(styleA, styleB);
              setLayers(layers);
              setSel(layers[layers.length - 1]?.id ?? null);
              setStylesOpen(false);
              flash(`${s.label}: every part is a layer you can change. Undo brings back what you had.`);
            }}
            style={{ display: 'grid', gap: 4, padding: 6, borderRadius: 9, border: `1px solid ${C.border}`, background: `${cloudSkyCss(`style-${s.id}`)} center / cover`, cursor: 'pointer', textAlign: 'left' }}
          >
            <span style={{ display: 'block', aspectRatio: geo ? `${geo.w} / ${geo.h}` : '10 / 3', background: stylePics[s.id] ? `url(${stylePics[s.id]}) center / contain no-repeat` : 'none' }} />
            <span style={{ fontSize: 12, fontWeight: 650, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,.6)' }}>{s.label}</span>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: C.muted }}>Replaces your layers (logos stay). Undo to go back.</div>
    </div>
  );

  const topBar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: phone ? '10px 12px' : '10px 16px', borderBottom: `1px solid ${C.line}`, background: C.panel }}>
      <h2 style={{ margin: 0, fontFamily: DISPLAY, fontSize: 22, marginRight: 6 }}>Livery</h2>
      <span role="tablist" aria-label="Liveries" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        {docs.map((d, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
            <Button size="sm" role="tab" aria-selected={i === active} variant={i === active ? 'primary' : undefined} onClick={() => setActive(i)} onDoubleClick={() => {
              const n = window.prompt('Name this livery', d.name ?? (i ? 'Second' : 'Main'));
              if (n != null && moderate(n)) {
                flash(moderate(n)!);
                return;
              }
              if (n != null) {
                docsRef.current = docsRef.current.map((x, k) => (k === i ? { ...x, name: n.trim().slice(0, 30) || undefined } : x));
                setDocs(docsRef.current);
                dirty.current = true;
              }
            }} title="Double-click to rename">
              {d.name || (i ? 'Second livery' : 'Main livery')}
            </Button>
            {i > 0 && (
              <button
                type="button"
                aria-label={`Delete ${d.name || 'the second livery'}`}
                title="Delete this livery (its aircraft go back to the main one)"
                onClick={() => {
                  if (!window.confirm(`Delete ${d.name || 'the second livery'}? Its aircraft will wear the main livery.`)) return;
                  docsRef.current = docsRef.current.filter((_, k) => k !== i);
                  setDocs(docsRef.current);
                  pasts.current[i] = [];
                  futures.current[i] = [];
                  dirty.current = true;
                  setActive(0);
                }}
                style={{ ...smallBtn, marginLeft: 2 }}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {docs.length < MAX_LIVERIES && (
          <Button
            size="sm"
            title="A second livery (a copy of this one to start from): pick which aircraft wear it in each aircraft's window"
            onClick={() => {
              const copy: Livery = JSON.parse(JSON.stringify(docRef.current));
              copy.name = 'Second';
              copy.layers.forEach((l) => (l.id = newId()));
              docsRef.current = [...docsRef.current, copy];
              setDocs(docsRef.current);
              dirty.current = true;
              setActive(docsRef.current.length - 1);
              flash('Second livery made from a copy of the first. Change it, then choose which aircraft wear it in their window.');
            }}
          >
            + Second livery
          </Button>
        )}
      </span>
      <select aria-label="Aircraft to preview" value={model} onChange={(e) => setModel(e.target.value)} style={{ background: C.raised, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 8px', fontSize: 13, maxWidth: phone ? 150 : 220 }}>
        {choices.map((m) => (
          <option key={m} value={m}>
            {m.toUpperCase()}
            {props.models.includes(m) ? ' (yours)' : ''}
          </option>
        ))}
      </select>
      <Button size="sm" onClick={undo} disabled={!past.current.length} title="Undo (Ctrl/Cmd+Z)">
        Undo
      </Button>
      <Button size="sm" onClick={redo} disabled={!future.current.length} title="Redo (Ctrl/Cmd+Shift+Z)">
        Redo
      </Button>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Button size="sm" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(1, z / 1.25))}>
          −
        </Button>
        <span className="num" style={{ fontSize: 12, color: C.muted, minWidth: 38, textAlign: 'center' }}>
          {Math.round(zoom * 100)}%
        </span>
        <Button size="sm" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z * 1.25))}>
          +
        </Button>
      </span>
      {!phone && (
        <Button size="sm" onClick={() => setStylesOpen((v) => !v)} variant={stylesOpen ? 'primary' : undefined}>
          Styles
        </Button>
      )}
      <span style={{ flex: 1 }} />
      <Button
        size="sm"
        onClick={() => {
          setLayers([]);
          setSel(null);
          flash('All layers gone: this livery is plain white. Undo brings them back.');
        }}
        title="Take every layer off this livery (plain white aircraft)"
      >
        Plain white
      </Button>
      <Button size="sm" onClick={props.onClose}>
        Cancel
      </Button>
      <Button
        size="sm"
        variant="primary"
        onClick={() => {
          props.onSave(docsRef.current);
          props.onClose();
        }}
      >
        Save {docs.length > 1 ? 'liveries' : 'livery'}
      </Button>
    </div>
  );

  const status = (
    <div style={{ fontSize: 12, color: note ? C.text : C.muted, minHeight: 18, padding: '0 2px' }}>
      {note ?? `${TOOL_LABEL[tool].replace(/ \(.\)$/, '')}. ${countStrokes(doc)} brush strokes. ${phone ? 'Zoom with + and −, then the hand to look around.' : 'Ctrl/Cmd+scroll to zoom.'}`}
    </div>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label="Livery editor" style={{ position: 'fixed', inset: 0, zIndex: 260, background: C.bg, display: 'flex', flexDirection: 'column', color: C.text }}>
      {topBar}
      {phone ? (
        <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gap: 10, padding: 10, alignContent: 'start' }}>
          <div style={{ position: 'sticky', top: 0, zIndex: 2, display: 'grid', gap: 8, background: C.bg, paddingBottom: 6 }}>
            <div style={{ height: 190, display: 'flex' }}>{stage}</div>
            {tools}
            {status}
          </div>
          <Segmented<'layers' | 'props' | 'styles'> value={tab} onChange={setTab} options={[{ value: 'layers', label: 'Layers' }, { value: 'props', label: 'Settings' }, { value: 'styles', label: 'Styles' }]} />
          {tab === 'layers' ? layersPanel : tab === 'props' ? settingsPanel : stylesPanel}
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '56px minmax(0, 1fr) 320px', gap: 12, padding: 12 }}>
          <div style={{ display: 'grid', alignContent: 'start', justifyItems: 'center' }}>{tools}</div>
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
            {stage}
            {status}
            {stylesOpen && <div style={{ position: 'absolute', top: 10, left: 10, width: 'min(560px, 94%)', maxHeight: '90%', overflowY: 'auto', zIndex: 3, boxShadow: '0 12px 30px rgba(0,0,0,.45)', borderRadius: 10 }}>{stylesPanel}</div>}
          </div>
          <div style={{ minHeight: 0, minWidth: 0, overflowY: 'auto', overflowX: 'hidden', display: 'grid', gap: 10, alignContent: 'start' }}>
            {layersPanel}
            {settingsPanel}
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Adding layers
// ----------------------------------------------------------------------------
function AddLayerMenu({ onAdd }: { onAdd: (k: 'fill' | 'band' | 'shape' | 'text' | 'titles' | 'registration' | 'paint') => void }) {
  const [open, setOpen] = useState(false);
  const items: [Parameters<typeof onAdd>[0], string][] = [
    ['fill', 'Fill'],
    ['band', 'Band along the fuselage'],
    ['shape', 'Shape'],
    ['text', 'Text'],
    ['titles', 'Airline name (titles)'],
    ['registration', 'Registration'],
    ['paint', 'Empty paint layer'],
  ];
  return (
    <span style={{ position: 'relative' }}>
      <Button size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        + Add
      </Button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 5, background: C.raised, border: `1px solid ${C.border}`, borderRadius: 8, padding: 4, display: 'grid', minWidth: 190, boxShadow: '0 10px 24px rgba(0,0,0,.4)' }}>
          {items.map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                onAdd(k);
                setOpen(false);
              }}
              style={{ textAlign: 'left', background: 'none', border: 'none', color: C.text, padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/** Text for the aircraft: a word we don't allow isn't painted (the reason shows under the box). */
function ModeratedText({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const problem = moderate(draft);
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <input
        id="livery-text-input"
        aria-label="Text"
        aria-invalid={Boolean(problem)}
        value={draft}
        maxLength={40}
        onChange={(e) => {
          setDraft(e.target.value);
          if (!moderate(e.target.value)) onChange(e.target.value);
        }}
        style={{ background: C.bg, color: C.text, border: `1px solid ${problem ? C.red : C.border}`, borderRadius: 7, padding: '6px 8px', fontSize: 14 }}
      />
      {problem && <span style={{ fontSize: 12, color: C.red }}>{problem}</span>}
    </div>
  );
}

// ----------------------------------------------------------------------------
// The selected layer's settings
// ----------------------------------------------------------------------------
function LayerProps(p: {
  layer: Layer;
  name: string;
  recent: string[];
  patch: (x: Partial<Layer>) => void;
  slide: (x: Partial<Layer>) => void;
  done: () => void;
  logos: Record<string, string>;
  geo: Geometry | null;
  reg: string;
}) {
  const l = p.layer;
  // the parts this aircraft has, and the layer's own part even if this type lacks it
  const have = p.geo ? [...p.geo.parts, 'all' as Region] : REGIONS;
  const regions = REGIONS.filter((r) => have.includes(r) || r === l.region);
  const deg = (v: number) => `${Math.round(v)}°`;
  const pct = (v: number) => `${Math.round(v * 100)}`;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <input aria-label="Layer name" value={l.name} maxLength={40} onChange={(e) => p.patch({ name: e.target.value })} style={{ background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 7, padding: '6px 8px', fontSize: 13 }} />
      {l.kind !== 'band' && (
        <div style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: C.muted }}>Paints only on</span>
          <Choice<Region> label="Paints only on" value={l.region} onChange={(v) => p.patch({ region: v })} options={regions.map((r) => ({ value: r, label: REGION_LABEL[r] }))} />
        </div>
      )}
      {'colour' in l && <ColourPicker label="Colour" value={l.colour} onChange={(v) => p.patch({ colour: v } as Partial<Layer>)} recent={p.recent} />}
      {l.kind === 'band' && (
        <>
          <Slider label="Top edge" value={Math.min(l.v0, l.v1)} min={-0.1} max={1.1} onChange={(v) => p.slide({ v0: v } as Partial<Layer>)} onDone={p.done} fmt={pct} />
          <Slider label="Bottom edge" value={Math.min(1.3, Math.max(l.v0, l.v1))} min={-0.1} max={1.3} onChange={(v) => p.slide({ v1: v >= 1.29 ? 3 : v } as Partial<Layer>)} onDone={p.done} fmt={(v) => (v >= 1.29 ? 'belly' : pct(v))} />
        </>
      )}
      {l.kind === 'shape' && (
        <>
          <Choice<ShapeKind> label="Shape" value={l.shape} onChange={(v) => p.patch({ shape: v } as Partial<Layer>)} options={(Object.keys(SHAPE_LABEL) as ShapeKind[]).map((k) => ({ value: k, label: SHAPE_LABEL[k] }))} />
          <Slider label="Width" value={l.w} min={0.02} max={l.frame === 'fin' ? 2 : 6} onChange={(v) => p.slide({ w: v } as Partial<Layer>)} onDone={p.done} />
          <Slider label="Height" value={l.h} min={0.02} max={l.frame === 'fin' ? 2 : 3} onChange={(v) => p.slide({ h: v } as Partial<Layer>)} onDone={p.done} />
          <Slider label="Rotation" value={l.rot} min={-180} max={180} step={1} onChange={(v) => p.slide({ rot: v } as Partial<Layer>)} onDone={p.done} fmt={deg} />
        </>
      )}
      {l.kind === 'path' && (
        <>
          <Slider label="Move along" value={l.dx} min={-1} max={1} onChange={(v) => p.slide({ dx: v } as Partial<Layer>)} onDone={p.done} />
          <Slider label="Move up and down" value={l.dy} min={-1} max={1} onChange={(v) => p.slide({ dy: v } as Partial<Layer>)} onDone={p.done} />
        </>
      )}
      {l.kind === 'text' && (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={Boolean(l.registration)} onChange={(e) => p.patch({ registration: e.target.checked || undefined, airlineName: undefined } as Partial<Layer>)} />
            Each aircraft’s registration {l.registration && <span style={{ color: C.muted }}>({p.reg})</span>}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={Boolean(l.airlineName)} onChange={(e) => p.patch({ airlineName: e.target.checked || undefined, registration: undefined } as Partial<Layer>)} />
            {l.frame === 'fin' ? 'Airline’s initial' : 'Airline’s name'}
            {l.airlineName && <span style={{ color: C.muted }}>({layerText(l, p.name, p.reg) || 'no name yet'})</span>}
          </label>
          {!l.airlineName && !l.registration && <ModeratedText key={l.id} value={l.text} onChange={(v) => p.patch({ text: v } as Partial<Layer>)} />}
          <Choice<FontId> label="Font" value={l.font} onChange={(v) => p.patch({ font: v } as Partial<Layer>)} options={(Object.keys(FONT_LABEL) as FontId[]).map((k) => ({ value: k, label: FONT_LABEL[k] }))} />
          <Slider label="Size" value={l.size} min={0.04} max={l.frame === 'fin' ? 0.9 : 0.9} onChange={(v) => p.slide({ size: v } as Partial<Layer>)} onDone={p.done} fmt={pct} />
          {l.auto ? (
            <div style={{ fontSize: 12, color: C.muted }}>{l.auto === 'titles' ? 'Placed above the windows on each aircraft.' : 'Placed on the rear fuselage, ahead of the tail, on each aircraft.'} Drag it with Move to place it yourself.</div>
          ) : (
            <>
              <Slider label="Rotation" value={l.rot} min={-90} max={90} step={1} onChange={(v) => p.slide({ rot: v } as Partial<Layer>)} onDone={p.done} fmt={deg} />
              {l.frame === 'body' && (
                <Button size="sm" onClick={() => p.patch(l.registration ? ({ auto: 'registration' } as Partial<Layer>) : ({ auto: 'titles', x: 0.2 } as Partial<Layer>))}>
                  {l.registration ? 'Put it back by the tail' : 'Put it above the windows'}
                </Button>
              )}
            </>
          )}
        </>
      )}
      {l.kind === 'paint' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: C.muted }}>
          {l.strokes.length} strokes
          {l.strokes.length > 0 && (
            <Button size="sm" onClick={() => p.patch({ strokes: [] } as Partial<Layer>)}>
              Clear
            </Button>
          )}
        </div>
      )}
      {l.kind === 'logo' && (
        <>
          {!p.logos[l.logo] && <div style={{ fontSize: 12, color: C.amber }}>This logo was deleted.</div>}
          <Slider label="Size" value={l.size} min={0.05} max={l.frame === 'fin' ? 1.2 : 2} onChange={(v) => p.slide({ size: v } as Partial<Layer>)} onDone={p.done} fmt={pct} />
          <Slider label="Rotation" value={l.rot} min={-180} max={180} step={1} onChange={(v) => p.slide({ rot: v } as Partial<Layer>)} onDone={p.done} fmt={deg} />
        </>
      )}
      <Slider label="Opacity" value={l.opacity} min={0} max={1} onChange={(v) => p.slide({ opacity: v })} onDone={p.done} fmt={pct} />
    </div>
  );
}
