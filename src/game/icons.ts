// ============================================================================
// CANVAS ICONS: airport tier badges, radar plane silhouettes & custom PNGs
// ============================================================================
import { BUILTIN_AIRCRAFT } from './aircraftCatalog';
import { SILHOUETTE_GROUPS, SILHOUETTE_LABELS, drawSilhouette } from './silhouettes';
import type { AircraftModel, RadarIconGroup } from './types';
// MapLibre 6 keeps its background worker in a separate file: bundled here so the build includes it
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

export const RADAR_GROUPS: RadarIconGroup[] = SILHOUETTE_GROUPS;
export const PLANE_TINT = '#f97316';
export const RADAR_GROUP_LABELS: Record<RadarIconGroup, string> = SILHOUETTE_LABELS;

/** Which silhouette a catalog aircraft uses on the map. */
export function getRadarIconGroup(model?: AircraftModel): RadarIconGroup {
  if (!model) return 'medium_jet';
  const id = model.id.toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => id.includes(k));
  if (has('a380')) return 'a380';
  if (has('il-76', 'an-124', 'an-12b', 'l-382', 'bae146', 'avro-rj')) return 'high_quad';
  if (has('b747')) return 'b747';
  if (has('a340', 'il-96')) return 'a340';
  if (has('md-11', 'md-10', 'dc-10', 'l-1011')) return 'trijet';
  if (has('b777')) return 'heavy_twin';
  if (has('b757', 'tu-204', 'tu-214')) return 'long_narrow';
  if (has('md-8', 'md-9', 'b717', 'b727', 'dc-9')) return 'rear_jet';
  if (has('crj', 'erj-1', 'c909', 'fokker')) return 'rj_tail';
  if (has('dhc6', 'beech', 'l-410', 'jetstream', 'c402', 'c208', 'c408', 'tecnam', 'bn2', 'pilatus', 'do-228', 'metro', 'emb-110')) return 'commuter';
  if (has('a220', 'sj-100') || /^e1\d\d|^e2\d\d/.test(id)) return 'small_jet';
  if (model.category === 'turboprop') return 'prop';
  if (model.category === 'regional_jet') return 'small_jet';
  if (model.category === 'narrowbody') return 'medium_jet';
  return 'large_jet';
}

/** Silhouette drawn in the given colour, nose up. */
export function drawRadarSilhouetteOnCanvas(group: RadarIconGroup, fillHex = '#facc15', size = 64): HTMLCanvasElement {
  return drawSilhouette(group, fillHex, size);
}

/** Map icons are drawn at 2× and registered with pixelRatio 2, so they stay sharp. */
export const MAP_ICON_PX = 128;
export const MAP_ICON_PIXEL_RATIO = 2;

export function createRadarGroupImageData(group: RadarIconGroup, fillHex = PLANE_TINT, size = MAP_ICON_PX): ImageData {
  return drawRadarSilhouetteOnCanvas(group, fillHex, size).getContext('2d')!.getImageData(0, 0, size, size);
}

// ----------------------------------------------------------------------------
// Airport tier badges for the map
// ----------------------------------------------------------------------------
export type AirportIconStatus = 'hub' | 'selected' | 'standard';

// by ICAO gate code, 1 (A) to 6 (F)
const STD_FILLS: Record<number, string> = { 1: '#334155', 2: '#334155', 3: '#1e40af', 4: '#1d4ed8', 5: '#0369a1', 6: '#0284c7' };
/** Disc radius by level, in on-screen pixels (the badge is drawn at 2×). */
const RADIUS_BY_TIER: Record<number, number> = { 1: 8.0, 2: 8.8, 3: 9.8, 4: 11.0, 5: 12.2, 6: 13.5 };
/** Airport badges: 96 px canvases registered at pixelRatio 2 (48 px on screen before the zoom's icon size). */
export const AIRPORT_ICON_PX = 96;
export const AIRPORT_ICON_PIXEL_RATIO = 2;

const hexRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [30, 64, 175];
};
/** `hex` mixed towards white (t > 0) or black (t < 0). */
const shadeHex = (hex: string, t: number) => {
  const [r, g, b] = hexRgb(hex);
  const to = t > 0 ? 255 : 0;
  const k = Math.abs(t);
  return `rgb(${Math.round(r + (to - r) * k)}, ${Math.round(g + (to - g) * k)}, ${Math.round(b + (to - b) * k)})`;
};

/**
 * An airport's "gate badge" for the map: a disc in the level's colour with its
 * ICAO gate code letter, and a ring of six segments round it, as many lit as
 * the level (A = 1 … F = 6). A hub has the airline's accent colour, a gold ring
 * and a star; the selected airport a white halo. Drawn with paths on one canvas
 * (no canvas-to-canvas copies: Safari has drawn those blank).
 */
export function createAirportMapIconImageData(status: AirportIconStatus, tier: number = 3, opts: { light?: boolean; accent?: string } = {}): ImageData {
  const S = AIRPORT_ICON_PIXEL_RATIO;
  const size = AIRPORT_ICON_PX;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const level = Math.min(6, Math.max(1, Math.round(tier) || 3));
  const R = (RADIUS_BY_TIER[level] ?? 11) * S;
  const hub = status === 'hub';
  const base = hub ? opts.accent ?? '#8fb8de' : STD_FILLS[level];
  const GOLD = '#f5c542';

  const circle = (radius: number) => {
    ctx.beginPath();
    ctx.arc(c, c, radius, 0, Math.PI * 2);
  };

  // 1. Soft shadow under the disc, so it reads on dark and light maps
  ctx.save();
  ctx.shadowColor = opts.light ? 'rgba(15, 23, 42, 0.42)' : 'rgba(0, 0, 0, 0.25)';
  ctx.shadowBlur = 3 * S;
  ctx.shadowOffsetY = 0.75 * S;
  circle(R);
  ctx.fillStyle = base;
  ctx.fill();
  ctx.restore();

  // 2. The disc, lighter at the top and darker at the bottom
  const grad = ctx.createLinearGradient(0, c - R, 0, c + R);
  grad.addColorStop(0, shadeHex(base, 0.12));
  grad.addColorStop(1, shadeHex(base, -0.12));
  circle(R);
  ctx.fillStyle = grad;
  ctx.fill();
  if (opts.light) {
    ctx.lineWidth = 1.5 * S;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.stroke();
  }

  // 3. The level ring: six segments from 12 o'clock, clockwise, as many lit as the level
  const ringW = 1.6 * S;
  const ringR = R + 1.6 * S + ringW / 2;
  const gap = 0.24;
  const seg = (Math.PI * 2) / 6;
  ctx.lineCap = 'butt';
  for (let i = 0; i < 6; i++) {
    const a0 = -Math.PI / 2 + i * seg + gap / 2;
    ctx.beginPath();
    ctx.arc(c, c, ringR, a0, a0 + seg - gap);
    ctx.lineWidth = ringW;
    ctx.strokeStyle = i < level ? 'rgba(255, 255, 255, 0.95)' : opts.light ? 'rgba(15, 23, 42, 0.28)' : 'rgba(255, 255, 255, 0.22)';
    ctx.stroke();
  }
  let outer = ringR + ringW / 2;

  // 5. A hub: a thin gold ring outside the level ring
  if (hub) {
    const goldR = outer + 1.3 * S;
    circle(goldR);
    ctx.lineWidth = 1.1 * S;
    ctx.strokeStyle = GOLD;
    ctx.stroke();
    outer = goldR + 0.55 * S;
  }

  // 6. The selected airport: a white halo outside everything
  if (status === 'selected') {
    circle(outer + 2.2 * S);
    ctx.lineWidth = 2 * S;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.stroke();
  }

  // 4. The letter, white with a thin dark outline
  const letter = 'ABCDEF'[level - 1];
  ctx.font = `800 ${Math.round(R * 1.1)}px Barlow, Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const ty = c + R * (hub ? 0.1 : 0.04);
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.5, R * 0.13);
  ctx.strokeStyle = 'rgba(9, 13, 22, 0.7)';
  ctx.strokeText(letter, c, ty);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(letter, c, ty);

  // 5. …and a small gold star over the disc's top edge
  if (hub) {
    const sr = Math.max(3 * S, R * 0.34);
    const sy = c - R;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? sr : sr * 0.45;
      ctx.lineTo(c + Math.cos(a) * rr, sy + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = GOLD;
    ctx.fill();
    ctx.lineWidth = 0.6 * S;
    ctx.strokeStyle = 'rgba(9, 13, 22, 0.55)';
    ctx.stroke();
  }
  return ctx.getImageData(0, 0, size, size);
}

// ----------------------------------------------------------------------------
// Custom PNG plane icons from /public/icons/
// ----------------------------------------------------------------------------
export interface PlaneIcon {
  imageData: ImageData;
  dataUrl: string;
}

/**
 * Crops transparent padding, fits the silhouette into a 64×64 box, tints it
 * and adds a dark outline so it reads over any map line.
 */
export function tintAndNormalizePlaneIcon(img: HTMLImageElement, tintHex = PLANE_TINT): PlaneIcon {
  const size = 64;
  const tw = Math.max(1, img.naturalWidth || img.width || size);
  const th = Math.max(1, img.naturalHeight || img.height || size);
  const src = document.createElement('canvas');
  src.width = tw;
  src.height = th;
  const sCtx = src.getContext('2d')!;
  sCtx.drawImage(img, 0, 0);

  let [sx, sy, sw, sh] = [0, 0, tw, th];
  try {
    const raw = sCtx.getImageData(0, 0, tw, th).data;
    let minX = tw, minY = th, maxX = -1, maxY = -1;
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        if (raw[(y * tw + x) * 4 + 3] > 20) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX >= minX && maxY >= minY) [sx, sy, sw, sh] = [minX, minY, maxX - minX + 1, maxY - minY + 1];
  } catch {
    // Tainted canvas (cross-origin image) — fall back to the full image.
  }

  const tint = document.createElement('canvas');
  tint.width = size;
  tint.height = size;
  const tCtx = tint.getContext('2d')!;
  const scale = Math.min((size - 10) / sw, (size - 10) / sh);
  const drawW = sw * scale;
  const drawH = sh * scale;
  tCtx.drawImage(src, sx, sy, sw, sh, (size - drawW) / 2, (size - drawH) / 2, drawW, drawH);
  tCtx.globalCompositeOperation = 'source-in';
  tCtx.fillStyle = tintHex;
  tCtx.fillRect(0, 0, size, size);

  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const oCtx = out.getContext('2d')!;
  oCtx.shadowColor = '#090d16';
  oCtx.shadowBlur = 2.5;
  oCtx.drawImage(tint, 0, 0);
  oCtx.drawImage(tint, 0, 0);

  return { imageData: oCtx.getImageData(0, 0, size, size), dataUrl: out.toDataURL() };
}

/** Registry keys for custom icons: `group:<g>`, `model:<id>`, `icao:<code>`. */
export const iconKey = {
  group: (g: RadarIconGroup) => `group:${g}`,
  model: (m: AircraftModel) => `model:${m.id}`,
  icao: (m: AircraftModel) => `icao:${m.icao_code.toLowerCase()}`,
};
/** MapLibre image names derived from registry keys. */
export const mapImageName = (key: string) => `plane-${key.replace(':', '-')}`;

/**
 * Tries /icons/<file>.png for every aircraft group, model id, image key and
 * ICAO type code. Each icon that exists is tinted and reported via onIcon.
 * Missing files simply 404 and are ignored.
 */
export function loadCustomPlaneIcons(onIcon: (key: string, icon: PlaneIcon) => void): () => void {
  let cancelled = false;
  const attempts = new Map<string, string>(); // fileStem -> registry key

  RADAR_GROUPS.forEach((g) => attempts.set(g, iconKey.group(g)));
  for (const m of BUILTIN_AIRCRAFT) {
    attempts.set(m.id, iconKey.model(m));
    attempts.set(m.image_key, iconKey.model(m));
    attempts.set(m.icao_code.toLowerCase(), iconKey.icao(m));
    attempts.set(m.icao_code.toUpperCase(), iconKey.icao(m));
  }

  const done = new Set<string>();
  attempts.forEach((key, stem) => {
    const img = new Image();
    img.onload = () => {
      if (cancelled || done.has(`${key}|${stem.toLowerCase()}`)) return;
      done.add(`${key}|${stem.toLowerCase()}`);
      onIcon(key, tintAndNormalizePlaneIcon(img));
    };
    img.src = `/icons/${stem}.png`;
  });

  return () => {
    cancelled = true;
  };
}

/** Best icon for a model: model PNG → ICAO PNG → group PNG → built-in silhouette. */
export function resolvePlaneIconKey(model: AircraftModel | undefined, has: (key: string) => boolean): string {
  if (model) {
    if (has(iconKey.model(model))) return iconKey.model(model);
    if (has(iconKey.icao(model))) return iconKey.icao(model);
  }
  return iconKey.group(getRadarIconGroup(model));
}

// ----------------------------------------------------------------------------
// MapLibre loader (single shared promise so it is only loaded once)
// ----------------------------------------------------------------------------
// MapLibre GL JS 5.24.0 ships with the game (npm package, pinned in package.json
// and package-lock.json): nothing is fetched from a third-party code site, so the
// map engine can't be swapped by anyone else and no outside service sees players
// start the game. It is its own chunk, loaded when the map first opens.
let maplibrePromise: Promise<any> | null = null;

export function loadMaplibre(): Promise<any> {
  const w = window as any;
  if (w.maplibregl) return Promise.resolve(w.maplibregl);
  if (maplibrePromise) return maplibrePromise;
  maplibrePromise = Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')])
    .then(([mod]) => {
      const ml = (mod as any).default ?? mod;
      ml.setWorkerUrl?.(maplibreWorkerUrl);
      w.maplibregl = ml;
      return ml;
    })
    .catch((e) => {
      maplibrePromise = null;
      throw e instanceof Error ? e : new Error('Could not start the map (MapLibre GL)');
    });
  return maplibrePromise;
}

/** True when the loaded MapLibre can draw the globe (version 5 or later). */
export function maplibreHasGlobe(): boolean {
  const v = String((window as any).maplibregl?.getVersion?.() ?? (window as any).maplibregl?.version ?? '');
  return Number(v.split('.')[0]) >= 5;
}
