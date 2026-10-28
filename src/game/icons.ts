// ============================================================================
// CANVAS ICONS: airport tier badges, radar plane silhouettes & custom PNGs
// ============================================================================
import { BUILTIN_AIRCRAFT } from './aircraftCatalog';
import { SILHOUETTE_GROUPS, SILHOUETTE_LABELS, drawSilhouette } from './silhouettes';
import type { AircraftModel, OperationalTier, RadarIconGroup } from './types';

export const RADAR_GROUPS: RadarIconGroup[] = SILHOUETTE_GROUPS;
export const PLANE_TINT = '#f97316';
export const RADAR_GROUP_LABELS: Record<RadarIconGroup, string> = SILHOUETTE_LABELS;

/** Which silhouette a catalog aircraft uses on the map. */
export function getRadarIconGroup(model?: AircraftModel): RadarIconGroup {
  if (!model) return 'medium_jet';
  const id = model.id.toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => id.includes(k));
  if (has('a380')) return 'a380';
  if (has('il-76', 'an-124')) return 'high_quad';
  if (has('b747')) return 'b747';
  if (has('a340', 'il-96')) return 'a340';
  if (has('md-11', 'dc-10', 'l-1011')) return 'trijet';
  if (has('b777')) return 'heavy_twin';
  if (has('b757', 'tu-204', 'tu-214')) return 'long_narrow';
  if (has('md-8', 'md-9', 'b717', 'dc-9')) return 'rear_jet';
  if (has('crj', 'erj-1', 'c909', 'fokker')) return 'rj_tail';
  if (has('dhc6', 'beech', 'l-410', 'jetstream')) return 'commuter';
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

const STD_FILLS: Record<OperationalTier, string> = { 1: '#334155', 2: '#1e40af', 3: '#1d4ed8', 4: '#0369a1', 5: '#0284c7' };
const STD_RINGS: Record<OperationalTier, string> = { 1: '#94a3b8', 2: '#60a5fa', 3: '#38bdf8', 4: '#7dd3fc', 5: '#bae6fd' };
const RADIUS_BY_TIER: Record<OperationalTier, number> = { 1: 8.5, 2: 9.8, 3: 11.0, 4: 12.2, 5: 13.5 };

export function createAirportMapIconImageData(status: AirportIconStatus, tier: OperationalTier = 3): ImageData {
  const size = 44;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;

  const palette = {
    selected: { fill: '#facc15', ring: '#fef08a', glow: 'rgba(250, 204, 21, 0.35)', text: '#090d16' },
    hub: { fill: '#10b981', ring: '#6ee7b7', glow: 'rgba(16, 185, 129, 0.35)', text: '#052e16' },
    standard: { fill: STD_FILLS[tier], ring: STD_RINGS[tier], glow: 'transparent', text: '#ffffff' },
  }[status];
  const r = RADIUS_BY_TIER[tier] ?? 11;

  const circle = (radius: number) => {
    ctx.beginPath();
    ctx.arc(c, c, radius, 0, Math.PI * 2);
  };

  if (status !== 'standard') {
    circle(r + 4);
    ctx.fillStyle = palette.glow;
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = palette.ring;
    ctx.stroke();
  }

  circle(r);
  ctx.fillStyle = palette.fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#090d16';
  ctx.stroke();

  if (status === 'standard') {
    circle(r - 1.5);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = palette.ring;
    ctx.stroke();
  }

  ctx.font = `900 ${Math.round(r * 1.02)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = palette.text;
  ctx.fillText(String(tier), c, c + 0.5);
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
