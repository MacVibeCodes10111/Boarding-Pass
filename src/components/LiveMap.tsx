import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { FlightEconomics } from '../game/economics';
import { offsetLatLonNm } from '../game/geo';
import {
  MAP_ICON_PIXEL_RATIO,
  RADAR_GROUPS,
  createAirportMapIconImageData,
  createRadarGroupImageData,
  iconKey,
  loadMaplibre,
  mapImageName,
  getRadarIconGroup,
  resolvePlaneIconKey,
  type PlaneIcon,
} from '../game/icons';
import { aiDepartureDay, densityBucket, findAirborneAi, type AiFlight, type AiPosition, type AiTraffic } from '../game/aiTraffic';
import { AiPathModel } from '../game/aiProcedures';
import { aerowayFromGeoJson, groundPoses, taxiPath, TaxiRegistry, type GroundMove, type GroundPose, type TaxiAirportRef } from '../game/taxi';
import {
  aiArrivalMove,
  aiDepartureMove,
  aiGroundMoves,
  buildAiAirportIndex,
  GROUP_LENGTH_M,
  playerGroundMoves,
  type AiAirportIndex,
  type AiGroundInfo,
  type PlayerGroundInfo,
} from '../game/groundTraffic';
import { fetchAerowayAround } from '../game/mvt';
import { AI_3D_MAX, labelHeightM, pushPlane3d, pushRoute3d, scaleFor, thinRoute, type RoutePoint, type Scale3d } from '../game/planes3d';
import type { LonLat } from '../game/geo';
import type { UtcClock } from '../game/clock';
import {
  buildFlightProcedureGeometry,
  formatNavaidFreq,
  getActiveRunwayForAirport,
  getAirportWeather,
  getGlobalNavaidsList,
  getFlightGeometryForDeparture,
  getLiveFlightPosition,
  playerTaxiMin,
  splitFlightPath,
} from '../game/navdata';
import { CAMERA_READOUT_TITLE, isHeightDragStart } from '../game/platform';
import { TIERS, getAircraftTierInfo, getAirportMaxAircraftTier } from '../game/tiers';
import { dayIndexOf, daysOrAll, formatClockShort, formatDurationHm, MIN_PER_DAY } from '../game/time';
import type { Airport, PlayerAircraft, RadarIconGroup, ScheduledFlight } from '../game/types';
import { C } from '../ui/kit';
import { currentLayout, isTouchFirst } from '../ui/layout';

const EMPTY_FC = { type: 'FeatureCollection', features: [] as any[] };

// ---------------------------------------------------------------------------
// Ground traffic (taxiing, parked at gates) appears from this zoom level, at
// true scale, on the taxiways the basemap shows.
// ---------------------------------------------------------------------------
const GROUND_MIN_ZOOM = 12.5;
/** Icon size per zoom-0 for an aircraft of `lengthM` at `lat` (icon ~29 px long at size 1). */
const groundIconScale = (lengthM: number, lat: number) => lengthM / (29 * 78271.517 * Math.cos((lat * Math.PI) / 180));
/** Joins two paths, shifting the second by whole turns of longitude so it continues the first. */
function joinPaths(a: LonLat[], b: LonLat[]): LonLat[] {
  if (!a.length) return b.slice();
  if (!b.length) return a.slice();
  const end = a[a.length - 1][0];
  const k = Math.round((end - b[0][0]) / 360) * 360;
  return [...a, ...(k ? b.map((p): LonLat => [p[0] + k, p[1]]) : b)];
}
const groundRef_ = (ap: Airport): TaxiAirportRef => ({
  iata: ap.iata_code,
  lon: ap.longitude_deg,
  lat: ap.latitude_deg,
  radiusM: groundRadiusM(ap),
  runways: groundRunwayLines(ap),
});
const groundRunwayLines = (ap: Airport) =>
  (ap.runways ?? []).map((r) => ({ a: [r.le_lon, r.le_lat] as [number, number], b: [r.he_lon, r.he_lat] as [number, number] }));
/** How far the airport's layout reaches from its reference point, metres. */
function groundRadiusM(ap: Airport) {
  let far = 0;
  for (const r of ap.runways ?? [])
    for (const [lon, lat] of [[r.le_lon, r.le_lat], [r.he_lon, r.he_lat]]) {
      const dx = (lon - ap.longitude_deg) * 111320 * Math.cos((ap.latitude_deg * Math.PI) / 180);
      const dy = (lat - ap.latitude_deg) * 111320;
      far = Math.max(far, Math.hypot(dx, dy));
    }
  return Math.max(2500, Math.min(8000, far + 1200));
}

export type AiDensity = 'off' | 'low' | 'medium' | 'high';
/** Share of AI flights drawn: buckets 0..3 per flight, so each level is a stable subset. */
const DENSITY_BUCKETS: Record<AiDensity, number> = { off: 0, low: 1, medium: 2, high: 4 };
const AI_TINT = '#cbd5e1';

// ---------------------------------------------------------------------------
// Level of detail for other airlines' aircraft
//   budget   most AI aircraft drawn at once; a stable, evenly spread sample is
//            kept when there are more in view, so zooming in shows more detail
//   dotsBelow  zoom level under which aircraft are plain dots (cheap to draw)
//   drawMs   how often their positions are redrawn
//   Auto starts at Medium and moves the budget with the measured frame rate.
// ---------------------------------------------------------------------------
export type AiDetail = 'auto' | 'low' | 'medium' | 'high' | 'max' | 'extreme';
export const AI_DETAIL_LEVELS: Record<AiDetail, { budget: number; dotsBelow: number; drawMs: number }> = {
  auto: { budget: 1500, dotsBelow: 3, drawMs: 300 },
  low: { budget: 600, dotsBelow: 4.5, drawMs: 600 },
  medium: { budget: 1500, dotsBelow: 3, drawMs: 350 },
  high: { budget: 3000, dotsBelow: 1.5, drawMs: 250 },
  max: { budget: 5000, dotsBelow: 0, drawMs: 250 },
  // Up to 10,000 aircraft at once: heavy on the processor and graphics card
  extreme: { budget: 10_000, dotsBelow: 0, drawMs: 300 },
};

// ---------------------------------------------------------------------------
// Map styles. Every style keeps the basemap's vector "carto" source, so the
// airport layouts for taxiing are always there.
// ---------------------------------------------------------------------------
export type MapStyleId = 'dark' | 'light' | 'satellite';
const CARTO_GLYPHS = 'https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf';
// Borders and place names over the imagery (from the CARTO vector tiles, OpenMapTiles layout)
const SAT_FONT = ['Montserrat Medium', 'Open Sans Bold', 'Noto Sans Regular'];
const satText = (id: string, filter: unknown[], minzoom: number, maxzoom: number, size: unknown, field: unknown = ['coalesce', ['get', 'name_en'], ['get', 'name']]) => ({
  id,
  type: 'symbol',
  source: 'carto',
  'source-layer': 'place',
  minzoom,
  maxzoom,
  filter,
  layout: { 'text-field': field, 'text-font': SAT_FONT, 'text-size': size, 'text-max-width': 8 },
  paint: { 'text-color': '#f1f5f9', 'text-halo-color': 'rgba(10, 16, 28, 0.85)', 'text-halo-width': 1.4 },
});
const SATELLITE_LABELS = [
  { id: 'sat-boundary-state', type: 'line', source: 'carto', 'source-layer': 'boundary', minzoom: 4, filter: ['all', ['==', ['get', 'admin_level'], 4], ['==', ['get', 'maritime'], 0]], paint: { 'line-color': 'rgba(255,255,255,0.35)', 'line-width': 0.8, 'line-dasharray': [2, 2] } },
  { id: 'sat-boundary-country', type: 'line', source: 'carto', 'source-layer': 'boundary', filter: ['all', ['==', ['get', 'admin_level'], 2], ['==', ['get', 'maritime'], 0]], paint: { 'line-color': 'rgba(255,255,255,0.6)', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.8, 6, 1.4] } },
  satText('sat-place-continent', ['==', ['get', 'class'], 'continent'], 0, 2, 13, ['get', 'name_en']),
  satText('sat-place-country', ['==', ['get', 'class'], 'country'], 2, 8, ['interpolate', ['linear'], ['zoom'], 2, 10, 6, 14], ['get', 'name_en']),
  satText('sat-place-state', ['all', ['==', ['get', 'class'], 'state'], ['<=', ['get', 'rank'], 4]], 5, 9, 11, ['get', 'name_en']),
  satText('sat-place-city', ['all', ['==', ['get', 'class'], 'city'], ['<=', ['get', 'rank'], 4]], 4, 15, ['interpolate', ['linear'], ['zoom'], 4, 11, 10, 15]),
  satText('sat-place-city-small', ['all', ['==', ['get', 'class'], 'city'], ['>', ['get', 'rank'], 4]], 7, 15, ['interpolate', ['linear'], ['zoom'], 7, 10, 12, 14]),
  satText('sat-place-town', ['==', ['get', 'class'], 'town'], 9, 15, ['interpolate', ['linear'], ['zoom'], 9, 10, 13, 13]),
];

const SATELLITE_STYLE = {
  version: 8,
  glyphs: CARTO_GLYPHS,
  sources: {
    // Cloud-free Sentinel-2 mosaic (free for non-commercial use, no key; sharp to about zoom 13)
    s2cloudless: {
      type: 'raster',
      tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg'],
      tileSize: 256,
      maxzoom: 14,
      attribution:
        '<a href="https://cloudless.eox.at" target="_blank" rel="noreferrer">EOxCloudless https://cloudless.eox.at</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)',
    },
    // Place names and borders come from the basemap's own vector tiles (CARTO / OpenStreetMap)
    carto: { type: 'vector', url: 'https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json' },
  },
  layers: [
    { id: 'satellite-base', type: 'raster', source: 's2cloudless' },
    ...SATELLITE_LABELS,
    // Invisible: makes the airport layouts load, for taxiing
    { id: 'aeroway-probe', type: 'line', source: 'carto', 'source-layer': 'aeroway', minzoom: 13, paint: { 'line-opacity': 0 } },
  ],
};
const mapStyleFor = (id: MapStyleId): any =>
  id === 'light'
    ? 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
    : id === 'satellite'
    ? SATELLITE_STYLE
    : 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
/** Other airlines' aircraft: light grey on dark maps, slate on the light map. */
const aiTintFor = (id: MapStyleId) => (id === 'light' ? '#475569' : AI_TINT);

/** Recolours the game's own layers for the light map (labels and halos that read on a pale background). */
function applyMapTheme(map: any, id: MapStyleId) {
  if (id !== 'light') return;
  const set = (layer: string, prop: string, value: unknown) => {
    try {
      if (map.getLayer?.(layer)) map.setPaintProperty(layer, prop, value);
    } catch {
      /* layer without that property */
    }
  };
  for (const l of ['airports-labels', 'ai-planes-symbol', 'live-planes-symbol', 'ground-planes-symbol', 'navaids-labels']) set(l, 'text-halo-color', '#ffffff');
  set('airports-labels', 'text-color', ['case', ['==', ['get', 'is_selected'], 1], '#b45309', ['==', ['get', 'is_hub'], 1], '#047857', '#334155']);
  set('ai-planes-symbol', 'text-color', '#475569');
  set('ai-planes-dot', 'circle-color', '#475569');
  set('navaids-labels', 'text-color', '#6d28d9');
  set('navaids-points', 'circle-color', '#ffffff');
  set('routes-arc', 'line-color', C.accentStrong);
  set('track-remaining', 'line-color', '#475569');
  set('ground-planes-symbol', 'text-color', ['case', ['==', ['get', 'kind'], 'player'], '#b45309', '#475569']);
}
const AUTO_BUDGET_MIN = 400;
const AUTO_BUDGET_MAX = 5000;
/** Stable 0..1 sampling rank per flight (independent of the density buckets). */
const aiRank = (f: AiFlight) => {
  let h = Math.imul(f.id ^ 0x5bd1e995, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};
export interface AiDrawStats {
  airborne: number;
  drawn: number;
  /** Current budget (Infinity when unlimited). */
  budget: number;
}
// Silhouettes already differ in size, so AI aircraft only get a gentle extra step by class
const AI_ICON_SCALE: Record<RadarIconGroup, number> = {
  commuter: 0.52, prop: 0.54, rj_tail: 0.54, small_jet: 0.54, rear_jet: 0.56, medium_jet: 0.56, long_narrow: 0.58,
  large_jet: 0.62, heavy_twin: 0.64, trijet: 0.63, a340: 0.64, b747: 0.66, a380: 0.68, high_quad: 0.66,
};

const POPUP_CSS = `font-family:inherit;font-size:12.5px;line-height:1.45;color:${C.text};min-width:250px;`;
const muted = (t: string) => `<span style="color:${C.muted}">${t}</span>`;
const kv = (k: string, v: string) =>
  `<div><div style="font-size:11px;color:${C.faint}">${k}</div><div style="font-weight:600;font-variant-numeric:tabular-nums">${v}</div></div>`;
const progressBar = (pct: number, color: string) =>
  `<div style="height:4px;border-radius:2px;background:${C.line};overflow:hidden;margin:4px 0 2px"><div style="width:${pct}%;height:100%;background:${color}"></div></div>`;
const altLabel = (ft: number) => (ft >= 18000 ? `FL${Math.round(ft / 100)}` : ft <= 0 ? 'Ground' : `${(Math.round(ft / 100) * 100).toLocaleString()} ft`);

function buildAiPopupHtml(t: AiTraffic, f: AiFlight, pos: AiPosition): string {
  const al = t.airlines[f.airline];
  const O = t.airports[f.o];
  const D = t.airports[f.d];
  const e = escapeHtml;
  const type = t.typeNames.get(f.typeCode) ?? f.typeCode;
  const hhmm = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
  const phase =
    (pos as AiPosition & { phaseLabel?: string }).phaseLabel ||
    (pos.altitudeFt === 0 ? (pos.progress < 0.5 ? 'Taking off' : 'Landed') : pos.progress < 0.15 ? 'Climbing' : pos.progress > 0.82 ? 'Descending' : 'Cruising');
  const pct = Math.round(pos.progress * 100);
  return `<div style="${POPUP_CSS}">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px">
      <b style="font-size:15px">${e(f.flightNumber)}</b>${muted(e(al.name))}
    </div>
    <div style="margin:2px 0 8px">${muted(`${e(al.callsign)} ${e(f.flightNumber.replace(/^\D+/, ''))}, ${e(type)}`)}</div>
    <div style="display:flex;justify-content:space-between;font-weight:600"><span>${e(O.iata)} ${muted(e(O.city))}</span><span>${e(D.iata)} ${muted(e(D.city))}</span></div>
    ${progressBar(pct, C.textDim)}
    <div style="display:flex;justify-content:space-between;font-size:11.5px;color:${C.muted};font-variant-numeric:tabular-nums"><span>${hhmm(f.depUtcMin)} UTC</span><span>${formatDurationHm(pos.remainingMin)} to go</span><span>${hhmm(f.depUtcMin + f.blockMin)} UTC</span></div>
    <div style="margin:8px 0 2px;color:${C.textDim}">${e(phase)}</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px">${kv('Altitude', altLabel(pos.altitudeFt))}${kv('Speed', `${pos.groundSpeedKts} kt`)}${kv('Distance', `${f.distanceNm.toLocaleString()} nm`)}</div>
    <div style="margin-top:8px;font-size:11px;color:${C.faint}">Other airline, shown for atmosphere</div>
  </div>`;
}

/** Info box for another airline's aircraft on the ground. */
function aiGroundPopupHtml(t: AiTraffic, entry: { pose: GroundPose; info: AiGroundInfo }, clock: UtcClock): string {
  const { pose, info } = entry;
  const f = info.flight;
  const now = clock.day * MIN_PER_DAY + clock.min;
  const gateIn = info.depDay * MIN_PER_DAY + f.depUtcMin + f.blockMin;
  const pos = {
    coordinates: pose.coordinates,
    bearing: pose.bearing,
    progress: info.kind === 'dep' ? 0 : 1,
    remainingMin: info.kind === 'dep' ? Math.max(0, Math.round(gateIn - now)) : 0,
    altitudeFt: 0,
    groundSpeedKts: pose.speedKts,
    phaseLabel: pose.phaseLabel,
  };
  return buildAiPopupHtml(t, f, pos);
}

export interface LiveMapProps {
  visible: boolean;
  initialCenter: [number, number];
  airports: Airport[];
  airportByIata: Map<string, Airport>;
  hubs: string[];
  schedule: ScheduledFlight[];
  fleet: PlayerAircraft[];
  econById: Map<string, FlightEconomics>;
  /** Real-UTC map clock (refreshed about once a second). */
  mapDay: number;
  mapMin: number;
  airlineCallsign: string;
  inspectedAirport: Airport | null;
  onInspectAirport: (airport: Airport | null) => void;
  /** Origin for the dashed preview line to the inspected airport. */
  previewOrigin: Airport | null;
  showWeatherRadar: boolean;
  /** ILS approach cones on the runways in use. */
  showApproaches: boolean;
  /** Radio navigation beacons (VOR, DME…). */
  showNavaids: boolean;
  mapStyle: MapStyleId;
  /** 3D globe instead of the flat map (MapLibre 5). */
  globe: boolean;
  /** Tilted view with aircraft drawn in 3D at their altitude. */
  threeD: boolean;
  showAllRoutes: boolean;
  planeIconScale: number;
  /** Cosmetic background traffic (null until the OpenFlights files load). */
  aiTraffic: AiTraffic | null;
  aiDensity: AiDensity;
  aiDetail: AiDetail;
  /** IATA codes of real airlines left off the map (the player's airline replaces them). */
  hiddenAiAirlines: string[];
  /** Reports AI flights airborne / drawn and the current draw budget. */
  onAiStats?: (stats: AiDrawStats) => void;
  /** Current map time (real UTC or the 7× economy clock). Called every frame. */
  getClock: () => UtcClock;
  /** Map minutes per real minute (1 live, 7 at 7×, 0 when frozen). */
  mapRate: number;
  /** When false, clicks on aircraft don't open their info (an airport is being planned). */
  planeInfoEnabled: boolean;
  onBlockedPlaneClick?: () => void;
  customIcons: Record<string, PlaneIcon>;
  navaidsVersion: number;
  /** Receives the MapLibre map once ready (for flyTo from other screens). */
  mapRef: React.MutableRefObject<any>;
}

const escapeHtml = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

function buildPlanePopupHtml(raw: Record<string, any>): string {
  const p: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) p[k] = escapeHtml(v);
  const isCargo = Number(raw.isCargo) === 1;
  const load = isCargo
    ? `<div style="display:flex;justify-content:space-between"><span>Freight</span><b style="font-variant-numeric:tabular-nums">${p.soldCargoTons} of ${p.maxCargoTons} t (${p.cargoLoadPct}%)</b></div>${progressBar(Number(raw.cargoLoadPct), C.brand)}`
    : `<div style="display:flex;justify-content:space-between"><span>Passengers</span><b style="font-variant-numeric:tabular-nums">${p.totalPax} of ${p.totalCap} (${p.loadFactorPct}%)</b></div>${progressBar(Number(raw.loadFactorPct), C.brand)}
       <div style="display:flex;gap:10px;font-size:11.5px;color:${C.muted};font-variant-numeric:tabular-nums;flex-wrap:wrap">
         ${Number(raw.capFirst) ? `<span>First ${p.soldFirst}/${p.capFirst}</span>` : ''}${Number(raw.capBus) ? `<span>Business ${p.soldBus}/${p.capBus}</span>` : ''}${Number(raw.capPrem) ? `<span>Premium ${p.soldPrem}/${p.capPrem}</span>` : ''}<span>Economy ${p.soldEcon}/${p.capEcon}</span><span>Cargo ${p.soldCargoTons}/${p.maxCargoTons} t</span>
       </div>`;
  return `<div style="${POPUP_CSS}min-width:280px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px">
      <b style="font-size:15px;color:${C.brand}">${p.callsign}</b>${muted(`${p.flightNumber}, ${p.tailNumber}`)}
    </div>
    <div style="margin:2px 0 8px">${muted(p.modelName)}</div>
    <div style="display:flex;justify-content:space-between;font-weight:600"><span>${p.originIata} ${muted(p.originCity)}</span><span>${p.destIata} ${muted(p.destCity)}</span></div>
    ${progressBar(Number(raw.progressPct), C.brand)}
    <div style="display:flex;justify-content:space-between;font-size:11.5px;color:${C.muted};font-variant-numeric:tabular-nums"><span>${p.depClock} UTC</span><span>${p.etaText} to go</span><span>${p.arrClock} UTC</span></div>
    <div style="margin:8px 0 2px;color:${C.textDim}">${p.phaseLabel}</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:8px 0 10px">${kv('Altitude', p.altitudeText)}${kv('Speed', `${p.groundSpeedKts} kt`)}${kv('Runways', `${p.depRunway} → ${p.arrRunway}`)}</div>
    <div style="border-top:1px solid ${C.line};padding-top:8px">${load}</div>
    ${p.bonusSummary ? `<div style="margin-top:6px;font-size:11.5px;color:${C.green}">${p.bonusSummary}</div>` : ''}
  </div>`;
}

/** Zoom-dependent level-of-detail filter so the map isn't flooded with airports. */
const AIRPORT_LOD_FILTER = [
  'any',
  ['==', ['get', 'is_hub'], 1],
  ['==', ['get', 'is_selected'], 1],
  ['==', ['get', 'is_active'], 1],
  ['all', ['==', ['get', 'ac_tier'], 5], ['>=', ['get', 'demand_weight'], 230]],
  ['all', ['>=', ['zoom'], 3.3], ['==', ['get', 'ac_tier'], 5], ['>=', ['get', 'demand_weight'], 165]],
  ['all', ['>=', ['zoom'], 4.1], ['>=', ['get', 'ac_tier'], 4], ['>=', ['get', 'demand_weight'], 110]],
  ['all', ['>=', ['zoom'], 4.8], ['>=', ['get', 'ac_tier'], 4]],
  ['all', ['>=', ['zoom'], 4.8], ['==', ['get', 'ac_tier'], 3], ['>=', ['get', 'demand_weight'], 30]],
  ['all', ['>=', ['zoom'], 5.5], ['>=', ['get', 'ac_tier'], 2]],
  ['>=', ['zoom'], 6.3],
];

/** 3D buildings from the basemap's own vector tiles (free), when zoomed into cities. */
function addBuildings(map: any, styleId: MapStyleId) {
  if (!map.getSource?.('carto') || map.getLayer?.('buildings-3d')) return;
  try {
    map.addLayer({
      id: 'buildings-3d',
      type: 'fill-extrusion',
      source: 'carto',
      'source-layer': 'building',
      minzoom: 13.5,
      paint: {
        'fill-extrusion-color': styleId === 'light' ? '#d5dae3' : styleId === 'satellite' ? '#dfe3ea' : '#2b3649',
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 8],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
        'fill-extrusion-opacity': styleId === 'satellite' ? 0.8 : 0.9,
      },
    });
  } catch {
    /* style without a building layer */
  }
}

function addLayers(map: any) {
  const src = (id: string) => map.addSource(id, { type: 'geojson', data: EMPTY_FC });
  ['ils-cones', 'navaids-source', 'routes', 'preview-route', 'track-flown', 'track-remaining', 'airports', 'ai-planes', 'ground-planes', 'live-planes'].forEach(src);
  ['route-3d', 'route-3d-curtain', 'planes-3d', 'ai-3d', 'planes-3d-stem', 'labels-3d'].forEach(src);

  map.addLayer({
    id: 'ils-cones-fill',
    type: 'fill',
    source: 'ils-cones',
    minzoom: 5.2,
    paint: { 'fill-color': ['get', 'cone_color'], 'fill-opacity': 0.18 },
  });
  map.addLayer({
    id: 'ils-cones-line',
    type: 'line',
    source: 'ils-cones',
    minzoom: 5.2,
    paint: { 'line-color': ['get', 'cone_color'], 'line-width': 1.6, 'line-dasharray': [2, 2], 'line-opacity': 0.75 },
  });
  map.addLayer({
    id: 'navaids-points',
    type: 'circle',
    source: 'navaids-source',
    minzoom: 5.6,
    paint: { 'circle-radius': 3.5, 'circle-color': C.bg, 'circle-stroke-color': C.purple, 'circle-stroke-width': 1.6 },
  });
  map.addLayer({
    id: 'navaids-labels',
    type: 'symbol',
    source: 'navaids-source',
    minzoom: 6.0,
    layout: {
      'text-field': ['concat', ['get', 'ident'], ' ', ['get', 'freq_label']],
      'text-size': 9,
      'text-offset': [0, 0.9],
      'text-anchor': 'top',
      'text-optional': true,
    },
    paint: { 'text-color': '#d8b4fe', 'text-halo-color': C.bg, 'text-halo-width': 1.4 },
  });
  map.addLayer({
    id: 'routes-arc',
    type: 'line',
    source: 'routes',
    paint: { 'line-color': C.accent, 'line-width': 2.2, 'line-opacity': 0.88 },
  });
  map.addLayer({
    id: 'preview-route-arc',
    type: 'line',
    source: 'preview-route',
    paint: { 'line-color': C.amberStrong, 'line-width': 2.5, 'line-dasharray': [2, 2], 'line-opacity': 0.95 },
  });
  // FR24-style trail for the selected plane: solid behind it, dashed ahead
  map.addLayer({
    id: 'track-remaining',
    type: 'line',
    source: 'track-remaining',
    paint: { 'line-color': C.textDim, 'line-width': 1.6, 'line-dasharray': [2, 2], 'line-opacity': 0.75 },
  });
  map.addLayer({
    id: 'track-flown',
    type: 'line',
    source: 'track-flown',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': C.orange, 'line-width': 2.6, 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'airports-circle',
    type: 'symbol',
    source: 'airports',
    filter: AIRPORT_LOD_FILTER,
    layout: {
      'icon-image': ['get', 'ap_icon'],
      'symbol-sort-key': ['-', 10, ['get', 'ac_tier']],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.36, 4, 0.46, 6, 0.58, 8, 0.72, 10, 0.84],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    // Fades once zoomed into the airport, so it doesn't sit on the aircraft at the gates
    paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 1, 14.5, 0.25] },
  });
  // Weather: a flight-conditions tag (VFR / MVFR / IFR) above each airport
  map.addLayer({
    id: 'airports-wx',
    type: 'symbol',
    source: 'airports',
    filter: ['all', ['has', 'wx'], AIRPORT_LOD_FILTER],
    layout: {
      'icon-image': ['concat', 'wx-', ['get', 'wx']],
      'icon-anchor': 'bottom',
      'icon-size': 0.9,
      'icon-offset': ['interpolate', ['linear'], ['zoom'], 2, ['literal', [0, -8]], 4, ['literal', [0, -9.5]], 6, ['literal', [0, -12]], 8, ['literal', [0, -15.5]], 10, ['literal', [0, -18.5]]],
      // Busier airports win where tags would overlap
      'symbol-sort-key': ['-', 1000, ['get', 'demand_weight']],
      'icon-padding': 1,
    },
  });
  map.addLayer({
    id: 'airports-labels',
    type: 'symbol',
    source: 'airports',
    minzoom: 4.5,
    filter: AIRPORT_LOD_FILTER,
    layout: {
      'text-field': ['concat', ['get', 'iata'], ' • T', ['to-string', ['get', 'ac_tier']]],
      'text-size': ['interpolate', ['linear'], ['zoom'], 4.5, 9.5, 7, 11],
      'text-offset': [0, 1.05],
      'text-anchor': 'top',
      'text-optional': true,
    },
    paint: {
      'text-color': ['case', ['==', ['get', 'is_selected'], 1], C.yellow, ['==', ['get', 'is_hub'], 1], C.green, C.textDim],
      'text-halo-color': C.bg,
      'text-halo-width': 1.5,
    },
  });
  map.addLayer({
    id: 'ai-planes-symbol',
    type: 'symbol',
    source: 'ai-planes',
    minzoom: AI_DETAIL_LEVELS.auto.dotsBelow,
    layout: {
      'icon-image': ['get', 'icon_name'],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 2, ['*', ['get', 'icon_scale'], 0.42], 5, ['*', ['get', 'icon_scale'], 0.65], 8, ['*', ['get', 'icon_scale'], 0.88], 11, ['*', ['get', 'icon_scale'], 1.12]],
      'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'text-field': ['step', ['zoom'], '', 7, ['get', 'flightNumber']],
      'text-size': 9,
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-optional': true,
    },
    paint: { 'text-color': C.muted, 'text-halo-color': C.bg, 'text-halo-width': 1.4, 'icon-opacity': 0.9 },
  });
  map.addLayer({
    id: 'ai-planes-dot',
    type: 'circle',
    source: 'ai-planes',
    maxzoom: AI_DETAIL_LEVELS.auto.dotsBelow,
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 1.3, 4, 2.2], 'circle-color': AI_TINT, 'circle-opacity': 0.75 },
  });
  // Aircraft on the ground, at true scale so parked aircraft fit their stands
  map.addLayer({
    id: 'ground-planes-symbol',
    type: 'symbol',
    source: 'ground-planes',
    minzoom: GROUND_MIN_ZOOM,
    layout: {
      'icon-image': ['get', 'icon_name'],
      'icon-size': [
        'interpolate',
        ['exponential', 2],
        ['zoom'],
        12, ['max', ['*', ['get', 'gs'], 4096], 0.3],
        14, ['max', ['*', ['get', 'gs'], 16384], 0.3],
        16, ['*', ['get', 'gs'], 65536],
        22, ['*', ['get', 'gs'], 4194304],
      ],
      'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'text-field': ['step', ['zoom'], '', 15, ['get', 'flightNumber']],
      'text-size': 9,
      'text-offset': [0, 1.3],
      'text-anchor': 'top',
      'text-optional': true,
    },
    paint: {
      'text-color': ['case', ['==', ['get', 'kind'], 'player'], C.brand, C.muted],
      'text-halo-color': C.bg,
      'text-halo-width': 1.4,
      'icon-opacity': ['case', ['==', ['get', 'kind'], 'player'], 1, 0.92],
    },
  });
  map.addLayer({
    id: 'live-planes-symbol',
    type: 'symbol',
    source: 'live-planes',
    layout: {
      'icon-image': ['get', 'icon_name'],
      'icon-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        2, ['*', ['get', 'icon_scale'], 0.42],
        5, ['*', ['get', 'icon_scale'], 0.65],
        8, ['*', ['get', 'icon_scale'], 0.88],
        11, ['*', ['get', 'icon_scale'], 1.12],
      ],
      'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      // Callsigns only once zoomed in, like FR24
      'text-field': ['step', ['zoom'], '', 5.5, ['get', 'flightNumber']],
      'text-size': 10,
      'text-offset': [0, 1.15],
      'text-anchor': 'top',
      'text-optional': true,
    },
    paint: { 'text-color': C.orange, 'text-halo-color': C.bg, 'text-halo-width': 1.6 },
  });
  // 3D view: aircraft floating at their height, lines down to their shadows, and
  // the selected aircraft's route at altitude with a curtain beneath it
  const extrusion = (id: string, opacity: number) =>
    map.addLayer({
      id,
      type: 'fill-extrusion',
      source: id,
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-height': ['get', 'top'],
        'fill-extrusion-opacity': opacity,
      },
    });
  extrusion('route-3d-curtain', 0.13);
  extrusion('route-3d', 0.95);
  extrusion('planes-3d-stem', 0.5);
  extrusion('ai-3d', 1);
  extrusion('planes-3d', 1);
  // Labels and click targets of aircraft in the air: placed at the point on the
  // ground that sits under the floating aircraft on screen, so they line up with it
  map.addLayer({
    id: 'labels-3d-hit',
    type: 'circle',
    source: 'labels-3d',
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 9, 8, 15], 'circle-opacity': 0, 'circle-stroke-width': 0, 'circle-pitch-scale': 'viewport' },
  });
  map.addLayer({
    id: 'labels-3d-text',
    type: 'symbol',
    source: 'labels-3d',
    layout: {
      // Your callsigns from zoom 5.5, other airlines' from 7 (as on the flat map)
      'text-field': ['step', ['zoom'], '', 5.5, ['case', ['==', ['get', 'kind'], 'player'], ['get', 'label'], ''], 7, ['get', 'label']],
      'text-size': ['case', ['==', ['get', 'kind'], 'player'], 10, 9],
      'text-anchor': 'top',
      'text-offset': [0, 1],
      'text-optional': true,
      'text-allow-overlap': false,
      'text-pitch-alignment': 'viewport',
      'text-rotation-alignment': 'viewport',
    },
    paint: { 'text-color': ['get', 'color'], 'text-halo-color': C.bg, 'text-halo-width': 1.5 },
  });
}

const THREE_D_SOURCES = ['planes-3d', 'ai-3d', 'planes-3d-stem', 'route-3d', 'route-3d-curtain', 'labels-3d'];
/** Other airlines' aircraft with a label / click target in 3D (nearest the view centre). */
const AI_LABELS_3D_MAX = 700;

/**
 * Screen position of a point `heightM` above the ground. MapLibre's own
 * projection takes an optional terrain to read heights from; a stand-in that
 * returns our height gives the exact spot (flat map and globe).
 */
const fakeTerrain = { h: 0, getElevationForLngLat() { return this.h; }, getElevationForLngLatZoom() { return this.h; } };
function screenAt(map: any, at: LonLat, heightM: number): { x: number; y: number } | null {
  const tr = map.transform;
  const fn = tr?.locationToScreenPoint ?? tr?.locationPoint;
  if (!fn) return null;
  fakeTerrain.h = heightM;
  try {
    const p = fn.call(tr, { lng: at[0], lat: at[1] }, fakeTerrain);
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  } catch {
    return null;
  }
}
/** The point on the ground under a floating aircraft on screen (null if it's off screen or in the sky). */
function groundUnder(map: any, at: LonLat, heightM: number, w: number, h: number): LonLat | null {
  const p = screenAt(map, at, heightM);
  if (!p || p.x < -40 || p.y < -40 || p.x > w + 40 || p.y > h + 40) return null;
  try {
    if (map.transform?.isPointOnMapSurface && !map.transform.isPointOnMapSurface(p)) return null;
    const ll = map.unproject([p.x, p.y]);
    return ll && Number.isFinite(ll.lng) && Number.isFinite(ll.lat) ? [ll.lng, ll.lat] : null;
  } catch {
    return null;
  }
}
const PLANE_3D_PX = 44; // nose to tail on screen, before the icon-size setting
const PLAYER_3D_COLOR = C.brand;

type TimedPoint = RoutePoint & { t: number };
/** A floating 3D aircraft on screen. */
type Pick3d = { x: number; y: number; r: number; at: LonLat; props: Record<string, unknown> };
/** The aircraft drawn nearest a screen point (yours win ties), or null. */
function pick3dAt(picks: Pick3d[], x: number, y: number): Pick3d | null {
  let best: Pick3d | null = null;
  let bestD = Infinity;
  for (const p of picks) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d > p.r) continue;
    const score = d - (p.props.kind === 'player' ? 6 : 0);
    if (score < bestD) {
      bestD = score;
      best = p;
    }
  }
  return best;
}

/** Your flight's path in the air with its height above the ground, sampled by time. */
function samplePlayerRoute(fl: ScheduledFlight, depDay: number, cruiseKts: number): TimedPoint[] {
  const dur = Math.max(1, fl.blockTimeMin);
  const step = Math.max(0.5, dur / 700);
  const oE = fl.origin.elevation_ft || 0;
  const dE = fl.destination.elevation_ft || 0;
  const pts: TimedPoint[] = [];
  for (let e = 0; e <= dur + 1e-6; e += step) {
    const abs = depDay * MIN_PER_DAY + fl.depTimeMin + e;
    const day = Math.floor(abs / MIN_PER_DAY);
    const pos = getLiveFlightPosition(fl, abs - day * MIN_PER_DAY, day, cruiseKts);
    if (!pos) continue;
    const agl = pos.altitudeText === 'Ground' ? 0 : Math.max(0, pos.altitudeFt - (oE + (dE - oE) * pos.progress));
    pts.push({ at: pos.coordinates, aglFt: agl, t: abs });
  }
  return thinRoute(fromRunwayToRunway(pts));
}

/** Another airline's flight in the air, sampled the same way. */
function sampleAiRoute(model: AiPathModel, f: AiFlight, depDay: number): TimedPoint[] {
  const step = Math.max(0.5, f.blockMin / 700);
  const pts: TimedPoint[] = [];
  for (let e = 0; e <= f.blockMin + 1e-6; e += step) {
    const abs = depDay * MIN_PER_DAY + f.depUtcMin + e;
    const day = Math.floor(abs / MIN_PER_DAY);
    const pos = model.position(f, day, abs - day * MIN_PER_DAY, { left: 1 });
    if (!pos) continue;
    pts.push({ at: pos.coordinates, aglFt: Math.max(0, pos.altitudeFt || 0), t: abs });
  }
  return thinRoute(fromRunwayToRunway(pts));
}

/**
 * The airborne part plus one point on the runway at each end (0 ft), so the
 * route slopes down to the ground instead of stopping in mid-air.
 */
function fromRunwayToRunway(pts: TimedPoint[]): TimedPoint[] {
  const first = pts.findIndex((p) => p.aglFt > 0);
  if (first < 0) return [];
  let last = pts.length - 1;
  while (last > first && !(pts[last].aglFt > 0)) last--;
  return pts.slice(Math.max(0, first - 1), Math.min(pts.length, last + 2)).map((p, i, a) =>
    (i === 0 || i === a.length - 1) && !(p.aglFt > 0) ? { ...p, aglFt: 0 } : p
  );
}

// ---------------------------------------------------------------------------
// Camera height (middle-drag, or Option/Alt + drag)
// ---------------------------------------------------------------------------
type CameraStart = { lng: number; lat: number; zoom: number; pitch: number; bearing: number; alt: number };

/** Camera height above sea level, metres. */
function cameraAltitudeM(map: any): number {
  const v = map.transform?.getCameraAltitude?.();
  if (Number.isFinite(v)) return v;
  const c = map.getCenter?.() ?? { lat: 0 };
  const h = map.getContainer?.()?.clientHeight || 800;
  // MapLibre's camera sits 1.5 screen heights from the centre point
  return 1.5 * h * ((78_271.517 * Math.cos((c.lat * Math.PI) / 180)) / 2 ** (map.getZoom?.() ?? 4)) * Math.cos(((map.getPitch?.() ?? 0) * Math.PI) / 180);
}

function cameraStart(map: any): CameraStart {
  const c = map.getCenter();
  return { lng: c.lng, lat: c.lat, zoom: map.getZoom(), pitch: map.getPitch?.() ?? 0, bearing: map.getBearing?.() ?? 0, alt: cameraAltitudeM(map) };
}

/**
 * Raises (f > 1) or lowers (f < 1) the camera straight up or down from where
 * it started: same spot over the ground, same angle. The camera-to-centre
 * distance scales by f (a zoom step) and the centre slides along the view
 * direction so the camera itself doesn't move sideways.
 */
function setCameraHeight(map: any, s: CameraStart, f: number) {
  const minZ = map.getMinZoom?.() ?? 0;
  const maxZ = map.getMaxZoom?.() ?? 22;
  const zoom = Math.max(minZ, Math.min(maxZ, s.zoom - Math.log2(f)));
  const k = Math.pow(2, s.zoom - zoom); // the f actually possible within the zoom limits
  const ahead = s.alt * Math.tan((Math.min(s.pitch, 84) * Math.PI) / 180); // camera → centre, along the ground
  const move = (k - 1) * ahead;
  const b = (s.bearing * Math.PI) / 180;
  const lat = Math.max(-84, Math.min(84, s.lat + (move * Math.cos(b)) / 111_320));
  const lng = s.lng + (move * Math.sin(b)) / (111_320 * Math.max(0.05, Math.cos((s.lat * Math.PI) / 180)));
  map.jumpTo({ center: [lng, lat], zoom });
}

const formatCameraHeight = (m: number) => {
  const ft = m / 0.3048;
  if (ft < 100_000) return `${Math.round(ft / (ft < 10_000 ? 10 : 100)) * (ft < 10_000 ? 10 : 100)} ft`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${Math.round(m / 1852).toLocaleString()} nm`;
};

/** In 3D the flat icons of aircraft in the air become faint shadows on the ground. */
function apply3dLook(map: any, on: boolean) {
  const airborne = ['>', ['coalesce', ['get', 'agl'], 0], 0];
  const set = (layer: string, prop: string, value: unknown) => {
    try {
      if (map.getLayer?.(layer)) map.setPaintProperty(layer, prop, value);
    } catch {
      /* older map engine */
    }
  };
  set('live-planes-symbol', 'icon-opacity', on ? ['case', airborne, 0.3, 1] : 1);
  set('ai-planes-symbol', 'icon-opacity', on ? ['case', airborne, 0.22, 0.9] : 0.9);
  set('ai-planes-dot', 'circle-opacity', on ? 0.25 : 0.75);
  set('live-planes-symbol', 'text-opacity', on ? ['case', airborne, 0, 1] : 1);
  set('ai-planes-symbol', 'text-opacity', on ? ['case', airborne, 0, 1] : 1);
}

// ---------------------------------------------------------------------------
// Aircraft info box that orbits its aircraft
//   The box sits on a circle around the plane at a remembered angle. Drag it to
//   move it round (double-click to put it back on top). A thin leader line
//   joins it to the aircraft.
// ---------------------------------------------------------------------------
const ORBIT_PREF = 'bp_popup_angle_v1';
const ORBIT_GAP_PX = 26;
const DEFAULT_ANGLE = -Math.PI / 2; // straight above
let orbitAngle = (() => {
  try {
    const v = Number(localStorage.getItem(ORBIT_PREF));
    return Number.isFinite(v) && localStorage.getItem(ORBIT_PREF) !== null ? v : DEFAULT_ANGLE;
  } catch {
    return DEFAULT_ANGLE;
  }
})();

/** Offset (px) from the aircraft to the box centre so the box edge stays ORBIT_GAP_PX away. */
function orbitOffset(box: HTMLElement | null | undefined): [number, number] {
  const w = box?.offsetWidth || 290;
  const h = box?.offsetHeight || 220;
  const dx = Math.cos(orbitAngle);
  const dy = Math.sin(orbitAngle);
  const toEdge = Math.min(Math.abs(dx) > 1e-3 ? w / 2 / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-3 ? h / 2 / Math.abs(dy) : Infinity);
  const r = toEdge + ORBIT_GAP_PX;
  return [Math.round(dx * r), Math.round(dy * r)];
}

function layoutOrbit(popup: any) {
  const root: HTMLElement | undefined = popup.getElement?.();
  if (!root) return;
  const box = root.querySelector('.maplibregl-popup-content') as HTMLElement | null;
  const [ox, oy] = orbitOffset(box);
  popup.setOffset?.([ox, oy]);
  const line = root.querySelector('.bp-orbit-leader line') as SVGLineElement | null;
  if (line) {
    line.setAttribute('x2', String(-ox));
    line.setAttribute('y2', String(-oy));
  }
}

function attachOrbit(map: any, popup: any) {
  const root: HTMLElement | undefined = popup.getElement?.();
  if (!root) return;
  // Phones: no room to float the box beside the aircraft, so it sits as a sheet above the tab bar.
  // Touch tablets: a card in the corner (no mouse to drag it out from under a finger or off the edge).
  const layout = currentLayout();
  if (layout === 'phone' || isTouchFirst()) {
    root.classList.add('bp-sheet-popup');
    if (layout !== 'phone') root.classList.add('bp-sheet-side');
    popup.setOffset?.([0, 0]);
    return;
  }
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'bp-orbit-leader');
  const line = document.createElementNS(ns, 'line');
  line.setAttribute('x1', '0');
  line.setAttribute('y1', '0');
  svg.appendChild(line);
  root.prepend(svg);
  const box = root.querySelector('.maplibregl-popup-content') as HTMLElement | null;
  if (box) {
    box.title = 'Drag to move this box around the aircraft. Double-click to put it back on top.';
    box.style.touchAction = 'none'; // a finger drags the box, not the map
  }
  layoutOrbit(popup);
  (popup as any).__relayout = () => layoutOrbit(popup);

  let dragging = false;
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const rect = map.getContainer().getBoundingClientRect();
    const plane = map.project(popup.getLngLat());
    orbitAngle = Math.atan2(e.clientY - rect.top - plane.y, e.clientX - rect.left - plane.x);
    layoutOrbit(popup);
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove('bp-orbit-dragging');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    try {
      localStorage.setItem(ORBIT_PREF, String(orbitAngle));
    } catch {
      /* storage unavailable */
    }
  };
  box?.addEventListener('pointerdown', (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('.maplibregl-popup-close-button, button, a, input') || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    root.classList.add('bp-orbit-dragging');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
  box?.addEventListener('dblclick', (e: MouseEvent) => {
    e.stopPropagation();
    orbitAngle = DEFAULT_ANGLE;
    layoutOrbit(popup);
    try {
      localStorage.setItem(ORBIT_PREF, String(orbitAngle));
    } catch {
      /* storage unavailable */
    }
  });
}

/** Flight-conditions colours (as on aviation weather charts), dark enough for white text. */
export const WX_TAG_COLORS = { VFR: '#16a34a', MVFR: '#2563eb', IFR: '#dc2626' } as const;

/** A small rounded tag, e.g. "MVFR", drawn at 2× for sharpness. */
function createWxTagImageData(label: keyof typeof WX_TAG_COLORS): ImageData {
  const pr = 2;
  const font = `700 ${10 * pr}px Inter, system-ui, sans-serif`;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = font;
  const w = Math.ceil(probe.measureText(label).width + 10 * pr);
  const h = 15 * pr;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h + 4 * pr; // room for the little pointer
  const ctx = canvas.getContext('2d')!;
  const r = 4 * pr;
  ctx.fillStyle = WX_TAG_COLORS[label];
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = pr;
  ctx.beginPath();
  ctx.moveTo(r, 0.5 * pr);
  ctx.arcTo(w - 0.5 * pr, 0.5 * pr, w - 0.5 * pr, h, r);
  ctx.arcTo(w - 0.5 * pr, h, 0.5 * pr, h, r);
  ctx.lineTo(w / 2 + 3 * pr, h);
  ctx.lineTo(w / 2, h + 3.5 * pr);
  ctx.lineTo(w / 2 - 3 * pr, h);
  ctx.arcTo(0.5 * pr, h, 0.5 * pr, 0.5 * pr, r);
  ctx.arcTo(0.5 * pr, 0.5 * pr, w - 0.5 * pr, 0.5 * pr, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, w / 2, h / 2 + 0.5 * pr);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** The game's icons and layers, added to a freshly loaded map style. */
function installMapContent(map: any, styleId: MapStyleId, threeD: boolean) {
  TIERS.forEach((t) => {
    putImage(map, `ap-icon-standard-${t}`, createAirportMapIconImageData('standard', t));
    putImage(map, `ap-icon-hub-${t}`, createAirportMapIconImageData('hub', t));
    putImage(map, `ap-icon-selected-${t}`, createAirportMapIconImageData('selected', t));
  });
  RADAR_GROUPS.forEach((g) => putImage(map, mapImageName(iconKey.group(g)), createRadarGroupImageData(g), MAP_ICON_PIXEL_RATIO));
  RADAR_GROUPS.forEach((g) => putImage(map, `ai-${g}`, createRadarGroupImageData(g, aiTintFor(styleId)), MAP_ICON_PIXEL_RATIO));
  (Object.keys(WX_TAG_COLORS) as (keyof typeof WX_TAG_COLORS)[]).forEach((c) => putImage(map, `wx-${c}`, createWxTagImageData(c), 2));
  addBuildings(map, styleId); // first, so the game's layers draw over them
  addLayers(map);
  applyMapTheme(map, styleId);
  if (threeD) apply3dLook(map, true);
}

/** Globe or flat map. Needs MapLibre 5; older versions just stay flat. */
function setMapProjection(map: any, globe: boolean) {
  try {
    map.setProjection?.({ type: globe ? 'globe' : 'mercator' });
  } catch {
    /* not supported */
  }
}

function putImage(map: any, name: string, data: ImageData, pixelRatio = 1) {
  if (map.hasImage(name)) map.updateImage(name, data);
  else map.addImage(name, data, { pixelRatio });
}

export function LiveMap(props: LiveMapProps) {
  const {
    visible,
    airports,
    hubs,
    schedule,
    fleet,
    econById,
    mapDay,
    mapMin,
    airlineCallsign,
    inspectedAirport,
    previewOrigin,
    showWeatherRadar,
    showApproaches,
    showNavaids,
    mapStyle,
    globe,
    threeD,
    showAllRoutes,
    planeIconScale,
    customIcons,
    navaidsVersion,
    mapRef,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<any>(null);
  // Takeoff/departure/arrival paths for other airlines, rebuilt when the traffic or airport data changes
  const aiModelRef = useRef<{ traffic: AiTraffic; aps: Map<string, Airport>; model: AiPathModel } | null>(null);
  const aiModel = (traffic: AiTraffic): AiPathModel => {
    const aps = latest.current.airportByIata;
    const cur = aiModelRef.current;
    if (cur && cur.traffic === traffic && cur.aps === aps) return cur.model;
    const model = new AiPathModel(traffic, (iata) => aps.get(iata));
    aiModelRef.current = { traffic, aps, model };
    return model;
  };
  // Taxi networks per airport, read from the basemap tiles (kept while the app runs)
  const taxiRegRef = useRef<TaxiRegistry | null>(null);
  const taxiReg = () => (taxiRegRef.current ??= new TaxiRegistry());
  // Latest ground positions, for clicks and the selected aircraft
  const groundRef = useRef<{
    ai: Map<string, { pose: GroundPose; info: AiGroundInfo }>;
    player: Map<string, { pose: GroundPose; info: PlayerGroundInfo; props: Record<string, any> }>;
  }>({ ai: new Map(), player: new Map() });
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  // Bumped after a map style change has put the game's layers back, so their data is set again
  const [styleRev, setStyleRev] = useState(0);
  const styleRevRef = useRef(0);
  const shownStyle = useRef<MapStyleId>(props.mapStyle);
  const [trackedFlightId, setTrackedFlightId] = useState<string | null>(null);

  // Latest props for MapLibre event handlers registered once at init.
  const latest = useRef(props);
  latest.current = props;

  const closePopup = () => {
    const popup = popupRef.current;
    popupRef.current = null;
    popup?.remove();
  };

  // Opening an airport for planning closes any aircraft info that was showing
  const planeInfoEnabled = props.planeInfoEnabled;
  useEffect(() => {
    if (!planeInfoEnabled) {
      closePopup();
      setTrackedFlightId(null);
    }
  }, [planeInfoEnabled]);

  // ---------------------------------------------------------------------------
  // 1. Create the map once
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let map: any = null;

    loadMaplibre()
      .then((maplibregl) => {
        if (cancelled || !containerRef.current) return;
        map = new maplibregl.Map({
          container: containerRef.current,
          style: mapStyleFor(shownStyle.current),
          center: latest.current.initialCenter,
          zoom: 4.6,
          // Map credits (required by CARTO / OpenStreetMap, and EOX on satellite), as a small (i) in the corner
          attributionControl: {
            compact: true,
            customAttribution:
              '<a href="https://carto.com/attributions" target="_blank" rel="noreferrer">© CARTO</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>',
          },
          // No symbol cross-fade: aircraft move every frame, and fading left a
          // ghost copy of each one behind while zooming
          fadeDuration: 0,
          maxPitch: 85,
        });
        mapRef.current = map;

        map.on('load', () => {
          installMapContent(map, shownStyle.current, latest.current.threeD);
          if (latest.current.globe) setMapProjection(map, true);

          // Runs before the layer handlers below; marks the event so they stand down
          map.on('click', (e: any) => {
            if (!latest.current.threeD) return;
            const hit = pick3dAt(picks3d.current, e.point.x, e.point.y);
            if (!hit) return;
            e.picked3d = true;
            if (e.originalEvent) (e.originalEvent as any).picked3d = true;
            if (planeClickBlocked()) return;
            const p = hit.props;
            if (p.kind === 'player') openTrackedPopup([Number(p.at_lng), Number(p.at_lat)], buildPlanePopupHtml(p), String(p.flightId));
            else openAiById(Number(p.aiId));
          });
          map.on('mousemove', (e: any) => {
            if (!latest.current.threeD) return;
            const over = pick3dAt(picks3d.current, e.point.x, e.point.y);
            if (over) map.getCanvas().style.cursor = 'pointer';
            else if (map.getCanvas().style.cursor === 'pointer' && !map.queryRenderedFeatures(e.point, { layers: ['airports-circle', 'live-planes-symbol', 'ai-planes-symbol', 'ground-planes-symbol'] }).length) map.getCanvas().style.cursor = '';
          });

          map.on('click', 'airports-circle', (e: any) => {
            if (e.picked3d || e.originalEvent?.picked3d) return;
            // An aircraft parked or taxiing on top of the airport badge gets the click
            if (map.queryRenderedFeatures(e.point, { layers: ['live-planes-symbol', 'ground-planes-symbol', 'ai-planes-symbol', 'labels-3d-hit'] }).length > 0) return;
            const iata = e.features?.[0]?.properties?.iata;
            const found = latest.current.airportByIata.get(iata);
            if (found) latest.current.onInspectAirport(found);
          });

          const openTrackedPopup = (coords: [number, number], html: string, trackId: string) => {
            // Close the previous popup *before* tracking the new flight, otherwise
            // its close handler would clear the new selection.
            closePopup();
            const popup = new maplibregl.Popup({
              closeButton: true,
              closeOnClick: false,
              maxWidth: '320px',
              anchor: 'center',
              className: 'bp-orbit-popup',
              offset: [0, 0],
            })
              .setLngLat(coords)
              .setHTML(`<div class="bp-live-popup-body">${html}</div>`)
              .addTo(map);
            attachOrbit(map, popup);
            popup.on('close', () => {
              if (popupRef.current === popup) {
                popupRef.current = null;
                setTrackedFlightId(null);
              }
            });
            popupRef.current = popup;
            setTrackedFlightId(trackId);
          };

          // While an airport is open for route planning, aircraft clicks are ignored
          // (they used to pop up over the planner); a hint appears after repeated hits.
          const planeClickBlocked = () => {
            if (latest.current.planeInfoEnabled) return false;
            latest.current.onBlockedPlaneClick?.();
            return true;
          };

          map.on('click', 'live-planes-symbol', (e: any) => {
            if (e.picked3d || e.originalEvent?.picked3d) return;
            const feat = e.features?.[0];
            if (!feat || (latest.current.threeD && map.queryRenderedFeatures(e.point, { layers: ['labels-3d-hit'] }).length > 0) || planeClickBlocked()) return;
            openTrackedPopup(feat.geometry.coordinates.slice(), buildPlanePopupHtml(feat.properties), feat.properties.flightId);
          });

          const openAiById = (id: number) => {
            const traffic = latest.current.aiTraffic;
            const f = traffic?.flights[id];
            const clock = latest.current.getClock();
            const pos = f && traffic && aiModel(traffic).position(f, clock.day, clock.min, { left: 1 });
            if (f && pos && traffic) openTrackedPopup(pos.coordinates, buildAiPopupHtml(traffic, f, pos), `ai:${f.id}`);
          };
          const onAiClick = (e: any) => {
            if (!e.fromHit3d && (e.picked3d || e.originalEvent?.picked3d)) return;
            const feat = e.features?.[0];
            const traffic = latest.current.aiTraffic;
            if (!feat || !traffic) return;
            // Your own planes sit on top — don't steal their clicks (nor the 3D targets)
            if (!e.fromHit3d && map.queryRenderedFeatures(e.point, { layers: ['live-planes-symbol', 'planes-3d'] }).length > 0) return;
            if (!e.fromHit3d && latest.current.threeD && map.queryRenderedFeatures(e.point, { layers: ['labels-3d-hit'] }).length > 0) return;
            if (planeClickBlocked()) return;
            const f = traffic.flights[Number(feat.properties.aiId)];
            const clock = latest.current.getClock();
            const pos = f && aiModel(traffic).position(f, clock.day, clock.min, { left: 1 });
            if (f && pos) openTrackedPopup(pos.coordinates, buildAiPopupHtml(traffic, f, pos), `ai:${f.id}`);
          };
          map.on('click', 'ai-planes-symbol', onAiClick);
          map.on('click', 'ai-planes-dot', onAiClick);
          // 3D: the floating aircraft are picked by where they are drawn on screen
          const hit3d = (e: any) => Boolean(e.picked3d) || (latest.current.threeD && map.queryRenderedFeatures(e.point, { layers: ['labels-3d-hit'] }).length > 0);
          map.on('click', 'labels-3d-hit', (e: any) => {
            if (e.picked3d) return; // already handled by the screen picker
            // Your aircraft first, then the nearest target to the click
            const feats = (e.features ?? []) as any[];
            const p = (feats.find((f) => f.properties?.kind === 'player') ?? feats[0])?.properties;
            if (!p || planeClickBlocked()) return;
            if (p.kind === 'player') openTrackedPopup([Number(p.at_lng), Number(p.at_lat)], buildPlanePopupHtml(p), p.flightId);
            else onAiClick({ ...e, features: [{ properties: p }], fromHit3d: true });
          });
          map.on('click', 'planes-3d', (e: any) => {
            if (e.picked3d || e.originalEvent?.picked3d) return;
            const p = e.features?.[0]?.properties;
            if (!p || hit3d(e) || planeClickBlocked()) return;
            openTrackedPopup([Number(p.at_lng), Number(p.at_lat)], buildPlanePopupHtml(p), p.flightId);
          });
          map.on('click', 'ai-3d', (e: any) => {
            if (e.picked3d || e.originalEvent?.picked3d || hit3d(e) || map.queryRenderedFeatures(e.point, { layers: ['planes-3d'] }).length > 0) return;
            onAiClick(e);
          });

          map.on('click', 'ground-planes-symbol', (e: any) => {
            if (e.picked3d || e.originalEvent?.picked3d) return;
            const feat = e.features?.[0];
            if (!feat) return;
            if (map.queryRenderedFeatures(e.point, { layers: ['live-planes-symbol'] }).length > 0) return;
            if (planeClickBlocked()) return;
            const p = feat.properties;
            if (p.kind === 'player') {
              openTrackedPopup(feat.geometry.coordinates.slice(), buildPlanePopupHtml(p), p.flightId);
              return;
            }
            const entry = groundRef.current.ai.get(p.groundKey);
            const traffic = latest.current.aiTraffic;
            if (entry && traffic) openTrackedPopup(entry.pose.coordinates, aiGroundPopupHtml(traffic, entry, latest.current.getClock()), `aig:${p.groundKey}`);
          });

          map.on('click', (e: any) => {
            if (e.picked3d || e.originalEvent?.picked3d) return;
            const hits = map.queryRenderedFeatures(e.point, { layers: ['airports-circle', 'live-planes-symbol', 'ai-planes-symbol', 'ai-planes-dot', 'ground-planes-symbol', 'planes-3d', 'ai-3d', 'labels-3d-hit'] });
            if (hits.length === 0) {
              latest.current.onInspectAirport(null);
              closePopup();
              setTrackedFlightId(null);
            }
          });

          ['airports-circle', 'live-planes-symbol', 'ai-planes-symbol', 'ai-planes-dot', 'ground-planes-symbol', 'planes-3d', 'ai-3d', 'labels-3d-hit'].forEach((layer) => {
            map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
            map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
          });

          // You moving the map: camera-follow waits a moment before taking over
          const markUser = (e: any) => {
            if (e?.originalEvent) userMoveAt.current = performance.now();
          };
          map.on('movestart', markUser);
          map.on('move', markUser);
          // Raise or lower the camera: drag up to rise, down to descend (same spot
          // over the ground, same viewing angle), like Google Earth. Either the
          // middle mouse button, or Option + left-drag (Alt on Windows) for Mac
          // trackpads and mice without a middle button.
          const el: HTMLElement | undefined = map.getCanvasContainer?.() ?? map.getCanvas?.();
          const box: HTMLElement | undefined = map.getContainer?.();
          let mid: { y: number; button: number; cam: CameraStart; moved: boolean } | null = null;
          // A left-drag ends in a click; that click mustn't select or deselect anything
          let swallowClickUntil = 0;
          const onMidMove = (e: MouseEvent) => {
            if (!mid) return;
            userMoveAt.current = performance.now();
            if (Math.abs(mid.y - e.clientY) > 3) mid.moved = true;
            setCameraHeight(map, mid.cam, Math.pow(2, (mid.y - e.clientY) / 160));
          };
          const onMidUp = (e: MouseEvent) => {
            if (!mid || e.button !== mid.button) return;
            if (mid.button === 0 && mid.moved) swallowClickUntil = performance.now() + 400;
            mid = null;
            window.removeEventListener('mousemove', onMidMove);
            window.removeEventListener('mouseup', onMidUp);
            if (el) el.style.cursor = '';
          };
          const startHeightDrag = (e: MouseEvent) => {
            mid = { y: e.clientY, button: e.button, cam: cameraStart(map), moved: false };
            if (el) el.style.cursor = 'ns-resize';
            window.addEventListener('mousemove', onMidMove);
            window.addEventListener('mouseup', onMidUp);
          };
          el?.addEventListener('mousedown', (e: MouseEvent) => {
            if (e.button !== 1) return;
            e.preventDefault(); // no auto-scroll
            if (!latest.current.threeD) return; // camera height is a 3D control
            startHeightDrag(e);
          });
          el?.addEventListener('auxclick', (e: MouseEvent) => e.button === 1 && e.preventDefault());
          // Option/Alt + left-drag: caught before the map sees it, so it doesn't pan
          const overMap = (e: Event) => Boolean(el && e.target instanceof Node && el.contains(e.target));
          const altDown = (e: MouseEvent) => {
            if (!latest.current.threeD || !isHeightDragStart(e) || !overMap(e)) return;
            e.stopPropagation();
            // (no preventDefault on pointerdown: that would cancel the mousedown the drag starts from)
            if (e.type !== 'mousedown') return;
            e.preventDefault();
            if (!mid) startHeightDrag(e);
          };
          box?.addEventListener('pointerdown', altDown as (e: Event) => void, true);
          box?.addEventListener('mousedown', altDown, true);
          box?.addEventListener(
            'click',
            (e: MouseEvent) => {
              if (performance.now() > swallowClickUntil) return;
              swallowClickUntil = 0;
              e.stopPropagation();
              e.preventDefault();
            },
            true
          );

          // Camera height, bottom right
          const camEl = document.createElement('div');
          camEl.className = 'bp-camera-alt';
          camEl.title = CAMERA_READOUT_TITLE;
          camEl.style.cssText = `position:absolute;right:10px;bottom:calc(38px + var(--bp-bottom-h));z-index:2;font-size:11.5px;color:${C.textDim};background:rgba(12,19,32,0.72);padding:2px 4px 2px 8px;border-radius:8px;pointer-events:auto;font-variant-numeric:tabular-nums;display:flex;align-items:center;gap:6px;`;
          const camText = document.createElement('span');
          camEl.appendChild(camText);
          // Raise / lower buttons: the touch-screen way to change the camera height (hold to keep going)
          const camBtn = (label: string, aria: string, f: number) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'bp-cam-btn';
            b.textContent = label;
            b.setAttribute('aria-label', aria);
            b.title = aria;
            b.style.cssText = `width:30px;height:28px;border-radius:6px;border:1px solid ${C.border};background:${C.raised};color:${C.text};font-size:14px;line-height:1;cursor:pointer;padding:0;touch-action:none;`;
            let timer = 0;
            const stepCam = () => {
              userMoveAt.current = performance.now();
              setCameraHeight(map, cameraStart(map), f);
            };
            const stop = () => {
              window.clearInterval(timer);
              timer = 0;
            };
            b.addEventListener('pointerdown', (e) => {
              e.preventDefault();
              e.stopPropagation();
              stepCam();
              stop();
              timer = window.setInterval(stepCam, 90);
            });
            for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
            b.addEventListener('click', (e) => e.stopPropagation());
            return b;
          };
          camEl.appendChild(camBtn('▲', 'Raise the camera', 1.12));
          camEl.appendChild(camBtn('▼', 'Lower the camera', 1 / 1.12));
          map.getContainer?.()?.appendChild(camEl);
          const showCam = () => (camText.textContent = `Camera ${formatCameraHeight(cameraAltitudeM(map))}`);
          showCam();
          if (!latest.current.threeD) camEl.style.display = 'none';
          map.on('move', showCam);

          if (!cancelled) setMapReady(true);
        });
      })
      .catch((err: Error) => !cancelled && setMapError(err.message));

    return () => {
      cancelled = true;
      closePopup();
      map?.remove();
      if (mapRef.current === map) mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resize when the map becomes visible again (it is hidden, not unmounted, on other tabs)
  useEffect(() => {
    if (visible && mapReady) mapRef.current?.resize();
  }, [visible, mapReady, mapRef]);

  // Map style changed: load the new basemap, then put the game's layers back on it
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || shownStyle.current === mapStyle) return;
    shownStyle.current = mapStyle;
    const onStyle = () => {
      installMapContent(map, mapStyle, latest.current.threeD);
      setMapProjection(map, latest.current.globe);
      styleRevRef.current++;
      setStyleRev(styleRevRef.current);
    };
    map.once('style.load', onStyle);
    map.setStyle(mapStyleFor(mapStyle), { diff: false });
    return () => map.off?.('style.load', onStyle);
  }, [mapStyle, mapReady, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (mapReady && map) setMapProjection(map, globe);
  }, [globe, mapReady, styleRev, mapRef]);

  // 3D view: tilt the camera, turn flat icons into shadows, clear 3D data when off
  const shown3d = useRef(false);
  /** 3D: aircraft in the air where they are drawn on screen, for clicks. */
  const picks3d = useRef<Pick3d[]>([]);
  /** Last time you moved the map yourself (ms, performance clock). */
  const userMoveAt = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    apply3dLook(map, threeD);
    if (!threeD) THREE_D_SOURCES.forEach((id) => map.getSource(id)?.setData(EMPTY_FC));
    // Tilt, turn and camera height belong to the 3D view; the flat map stays flat and north-up
    const camEl = map.getContainer?.()?.querySelector?.('.bp-camera-alt') as HTMLElement | null;
    if (camEl) camEl.style.display = threeD ? 'flex' : 'none';
    const rotation = (on: boolean) => {
      try {
        if (on) {
          map.setMaxPitch?.(85);
          map.dragRotate?.enable?.();
          map.touchPitch?.enable?.();
          map.touchZoomRotate?.enableRotation?.();
          map.keyboard?.enableRotation?.();
        } else {
          map.dragRotate?.disable?.();
          map.touchPitch?.disable?.();
          map.touchZoomRotate?.disableRotation?.();
          map.keyboard?.disableRotation?.();
        }
      } catch {
        /* older map engine */
      }
    };
    const lockFlat = () => {
      try {
        map.jumpTo?.({ pitch: 0, bearing: 0 });
        map.setMaxPitch?.(0);
      } catch {
        /* older map engine */
      }
    };
    rotation(threeD);
    if (shown3d.current !== threeD) {
      shown3d.current = threeD;
      if (threeD) map.easeTo?.({ pitch: 55, duration: 900 });
      else {
        map.easeTo?.({ pitch: 0, bearing: 0, duration: 700 });
        // Then lock it flat (also if the animation gets cut short or stalls)
        const flatten = window.setTimeout(() => !latest.current.threeD && lockFlat(), 800);
        return () => window.clearTimeout(flatten);
      }
    } else if (!threeD) lockFlat();
  }, [threeD, mapReady, styleRev, mapRef]);

  // ---------------------------------------------------------------------------
  // 2. Custom plane PNGs
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    Object.entries(customIcons).forEach(([key, icon]) => putImage(map, mapImageName(key), icon.imageData));
  }, [customIcons, mapReady, styleRev, mapRef]);

  // ---------------------------------------------------------------------------
  // 3. Airports (with their weather tag when Weather is on; it changes hourly)
  // ---------------------------------------------------------------------------
  const wxHour = Math.floor(mapMin / 60);
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const active = new Set<string>();
    schedule.forEach((s) => {
      active.add(s.origin.iata_code);
      active.add(s.destination.iata_code);
    });

    const features = airports.map((a) => {
      const isHub = hubs.includes(a.iata_code);
      const isSelected = inspectedAirport?.iata_code === a.iata_code;
      const tier = getAirportMaxAircraftTier(a.max_runway_length_ft).tier;
      const status = isSelected ? 'selected' : isHub ? 'hub' : 'standard';
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [a.longitude_deg, a.latitude_deg] },
        properties: {
          iata: a.iata_code,
          name: a.name,
          is_hub: isHub ? 1 : 0,
          is_selected: isSelected ? 1 : 0,
          is_active: active.has(a.iata_code) ? 1 : 0,
          ac_tier: tier,
          demand_weight: a.demand_weight || 25,
          ap_icon: `ap-icon-${status}-${tier}`,
          ...(showWeatherRadar ? { wx: getAirportWeather(a, mapDay, wxHour * 60).flightCategory } : {}),
        },
      };
    });
    map.getSource('airports')?.setData({ type: 'FeatureCollection', features });
  }, [airports, hubs, inspectedAirport, schedule, showWeatherRadar, mapDay, showWeatherRadar ? wxHour : -1, mapReady, styleRev, mapRef]);

  // ---------------------------------------------------------------------------
  // 4. ILS cones & navaids (hourly)
  // ---------------------------------------------------------------------------
  const mapHour = Math.floor(mapMin / 60);
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const ilsSource = map.getSource('ils-cones');
    const navSource = map.getSource('navaids-source');

    if (!showApproaches) ilsSource?.setData(EMPTY_FC);
    if (!showNavaids) navSource?.setData(EMPTY_FC);
    if (!showApproaches && !showNavaids) return;

    const wxMin = mapHour * 60;
    const ilsFeatures: any[] = [];
    for (const a of airports) {
      const important = a.demand_weight >= 80 || hubs.includes(a.iata_code) || inspectedAirport?.iata_code === a.iata_code;
      const wx = getAirportWeather(a, mapDay, wxMin);
      if (showApproaches && (important || a.max_runway_length_ft >= 6000)) {
        const rwy = getActiveRunwayForAirport(a, mapDay, wxMin);
        // From the landing threshold (displaced thresholds included)
        const left = offsetLatLonNm(rwy.landLat, rwy.landLon, (rwy.reciprocalDegT - 4.5 + 360) % 360, 9.5);
        const right = offsetLatLonNm(rwy.landLat, rwy.landLon, (rwy.reciprocalDegT + 4.5) % 360, 9.5);
        const thr = [rwy.landLon, rwy.landLat];
        ilsFeatures.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[thr, left, right, thr]] },
          properties: {
            iata: a.iata_code,
            rwy: rwy.ident,
            cone_color: wx.flightCategory === 'IFR' ? C.red : wx.flightCategory === 'MVFR' ? C.accent : '#10b981',
          },
        });
      }
    }
    if (showApproaches) ilsSource?.setData({ type: 'FeatureCollection', features: ilsFeatures });
    if (!showNavaids) return;

    const navFeatures = getGlobalNavaidsList()
      .filter((n) => n.type === 'VORTAC' || n.type === 'VOR-DME' || n.type === 'VOR' || Boolean(n.associated_airport))
      .map((n) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [n.longitude_deg, n.latitude_deg] },
        properties: { ident: n.ident, name: n.name, type: n.type, freq_label: formatNavaidFreq(n.frequency_khz, n.type) },
      }));
    navSource?.setData({ type: 'FeatureCollection', features: navFeatures });
  }, [airports, hubs, inspectedAirport, showApproaches, showNavaids, mapDay, mapHour, navaidsVersion, mapReady, styleRev, mapRef]);

  // ---------------------------------------------------------------------------
  // 5. Dashed preview line (origin → inspected airport)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const source = map.getSource('preview-route');
    if (visible && inspectedAirport && previewOrigin && previewOrigin.iata_code !== inspectedAirport.iata_code) {
      const coords = buildFlightProcedureGeometry(previewOrigin, inspectedAirport, mapDay, mapHour * 60).points;
      source?.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }] });
    } else {
      source?.setData(EMPTY_FC);
    }
  }, [inspectedAirport, previewOrigin, visible, mapDay, mapHour, mapReady, styleRev, mapRef]);

  // ---------------------------------------------------------------------------
  // 6. Route lines (once a second is plenty — they don't move)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const pairKey = (fl: ScheduledFlight) => [fl.origin.iata_code, fl.destination.iata_code].sort().join('<->');
    const tracked = trackedFlightId ? schedule.find((f) => f.id === trackedFlightId) : undefined;
    const seen = new Set<string>(tracked ? [pairKey(tracked)] : []); // the trail layers draw the tracked flight
    const features: any[] = [];
    for (const fl of schedule) {
      const relevant =
        showAllRoutes ||
        (inspectedAirport && (fl.origin.iata_code === inspectedAirport.iata_code || fl.destination.iata_code === inspectedAirport.iata_code));
      if (!relevant || seen.has(pairKey(fl))) continue;
      seen.add(pairKey(fl));
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: buildFlightProcedureGeometry(fl.origin, fl.destination, mapDay, mapHour * 60).points },
        properties: { flightNumber: fl.flightNumber },
      });
    }
    map.getSource('routes')?.setData({ type: 'FeatureCollection', features });
  }, [schedule, showAllRoutes, inspectedAirport, trackedFlightId, mapDay, mapHour, mapReady, styleRev, mapRef]);

  // ---------------------------------------------------------------------------
  // 7. Live planes — FR24-style smooth movement
  //    Positions are computed straight from the real UTC clock every animation
  //    frame (throttled to ~20 fps), outside React, so planes glide instead of
  //    hopping once per second. Static per-flight info is prepared once.
  // ---------------------------------------------------------------------------
  const flightInfo = useMemo(() => {
    const byTail = new Map(fleet.map((a) => [a.tailNumber, a]));
    return schedule.map((fl) => {
      const ac = byTail.get(fl.tailNumber);
      const econ = econById.get(fl.id);
      const acTier = getAircraftTierInfo(ac?.model.tier ?? 3);
      const bonus = [
        econ?.isHubToHub ? `Hub to hub +${econ.hubBonusPct}%` : '',
        econ && econ.connectingBoostPct > 0 ? `Connections +${econ.connectingBoostPct}%` : '',
        econ?.isThroughFlight ? `Through passengers +${econ.throughBonusPct}%` : '',
      ].filter(Boolean);
      return {
        flight: fl,
        model: ac?.model,
        cruiseKts: ac?.model.cruise_speed_kts ?? 450,
        iconScale: Number((acTier.iconScale * planeIconScale).toFixed(3)),
        props: {
          flightId: fl.id,
          flightNumber: fl.flightNumber,
          callsign: `${airlineCallsign} ${fl.flightNumber.replace(/\D+/g, '') || '1'}`,
          tailNumber: fl.tailNumber,
          modelName: ac?.model.name ?? 'Commercial Jet',
          acTier: acTier.tier,
          isCargo: ac?.model.is_cargo ? 1 : 0,
          originIata: fl.origin.iata_code,
          originCity: fl.origin.municipality,
          originMaxTier: getAirportMaxAircraftTier(fl.origin.max_runway_length_ft).tier,
          destIata: fl.destination.iata_code,
          destCity: fl.destination.municipality,
          destMaxTier: getAirportMaxAircraftTier(fl.destination.max_runway_length_ft).tier,
          depClock: formatClockShort(fl.depTimeMin),
          arrClock: formatClockShort(fl.arrTimeMin),
          soldEcon: econ?.sold.econ ?? 0,
          capEcon: econ?.cap.econ ?? 0,
          soldPrem: econ?.sold.prem ?? 0,
          capPrem: econ?.cap.prem ?? 0,
          soldBus: econ?.sold.bus ?? 0,
          capBus: econ?.cap.bus ?? 0,
          soldFirst: econ?.sold.first ?? 0,
          capFirst: econ?.cap.first ?? 0,
          totalPax: econ?.totalPax ?? 0,
          totalCap: econ?.totalCap ?? 0,
          loadFactorPct: econ && econ.totalCap > 0 ? Math.round((econ.totalPax / econ.totalCap) * 100) : 0,
          soldCargoTons: econ?.soldCargoTons ?? 0,
          maxCargoTons: econ?.maxCargoTons ?? 0,
          cargoLoadPct: econ && econ.maxCargoTons > 0 ? Math.round((econ.soldCargoTons / econ.maxCargoTons) * 100) : 0,
          bonusSummary: bonus.join(', '),
        },
      };
    });
  }, [schedule, fleet, econById, airlineCallsign, planeIconScale]);

  const animState = useRef({ flightInfo, trackedFlightId, visible, aiTraffic: props.aiTraffic, aiDensity: props.aiDensity, planeIconScale });
  animState.current = { flightInfo, trackedFlightId, visible, aiTraffic: props.aiTraffic, aiDensity: props.aiDensity, planeIconScale };

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const FRAME_MS = 50; // ~20 fps
    const POPUP_MS = 1000;
    const shownBearing = new Map<string, number>();
    let lastFrame = 0;
    let lastPopup = 0;
    let lastHidden = 0;
    let raf = 0;
    // AI traffic: candidates refreshed every 10 s, drawn ~4×/s (2×/s when very busy)
    const AI_REFRESH_MS = 10_000;
    let aiCandidates: AiFlight[] = [];
    let aiKey: { traffic: AiTraffic | null; density: AiDensity; rate: number; hidden: string } = { traffic: null, density: 'off', rate: 1, hidden: '' };
    let aiLastRefresh = -Infinity;
    let aiLastDraw = 0;
    let aiHasData = false;
    let aiAirborne = 0;
    let aiDrawn = -1;
    // Level of detail
    let lodKey: AiDetail | null = null;
    let lod = AI_DETAIL_LEVELS.auto;
    // Phones start lighter; Auto then follows the frame rate as usual
    let budget = currentLayout() === 'phone' ? Math.min(lod.budget, 700) : lod.budget;
    let lastBudgetReported = budget;
    // 3D view
    let ai3dZoom = -1;
    let ai3dHasData = false;
    let aiStems: any[] = [];
    let p3dHasData = false;
    let route3d: { key: string; pts: TimedPoint[] } | null = null;
    let route3dDrawn = '';
    const cruiseById = new Map<string, number>();
    let aiLabels3d: { at: LonLat; aglFt: number; sizePx: number; props: Record<string, unknown> }[] = [];
    let labels3dKey = '';
    let labels3dHasData = false;
    let lastFollow = 0;
    let aiLabelFeats: any[] | null = null;
    let aiPicks: Pick3d[] = [];
    let route3dAt = 0;
    let lastStatsReport = -Infinity;
    let reportedDrawn = -1;
    // Frame-rate probe for Auto: average rAF interval over ~2 s windows
    let probeStart = 0;
    let probeFrames = 0;
    let prevRaf = 0;
    // Ground traffic: taxi networks from the basemap's airport layer, positions ~4×/s
    const GROUND_MS = 250;
    const INGEST_MS = 1200;
    let groundLast = 0;
    let ingestLast = -Infinity;
    let aerowayDirty = true;
    let groundHasData = false;
    let lastGroundZoom = false;
    let lastView: { coords: [number, number]; flown: LonLat[]; remaining: LonLat[]; html: () => string } | null = null;
    let lastViewAt = 0;
    let groundRefs: TaxiAirportRef[] = [];
    const aeroSource: string = (() => {
      const layers: any[] = map.getStyle?.()?.layers ?? [];
      return layers.find((l) => l['source-layer'] === 'aeroway')?.source ?? 'carto';
    })();
    const onSourceData = (e: any) => {
      if (e?.sourceId === aeroSource) aerowayDirty = true;
    };
    map.on?.('sourcedata', onSourceData);
    let aiIndex: { traffic: AiTraffic; index: AiAirportIndex; byIata: Map<string, number> } | null = null;
    let aiKeep: (f: AiFlight) => boolean = () => true;
    let infoById: { list: unknown; map: Map<string, (typeof animState.current.flightInfo)[number]> } = { list: null, map: new Map() };

    /** Airports with runways in view, nearest the centre first (at most 4). */
    const groundAirportsInView = (): TaxiAirportRef[] => {
      const raw = map.getBounds?.();
      if (!raw) return [];
      const w = raw.getWest(), e = raw.getEast(), so = raw.getSouth(), no = raw.getNorth();
      const cx = (w + e) / 2, cy = (so + no) / 2;
      const pad = 0.03;
      const found: { ap: Airport; d: number }[] = [];
      for (const ap of latest.current.airports) {
        if (!ap.runways?.length || !ap.iata_code) continue;
        const lon = ap.longitude_deg, lat = ap.latitude_deg;
        if (lat < so - pad || lat > no + pad || lon < w - pad || lon > e + pad) continue;
        found.push({ ap, d: Math.hypot(lon - cx, lat - cy) });
      }
      return found
        .sort((a, b) => a.d - b.d)
        .slice(0, 4)
        .map(({ ap }) => ({ iata: ap.iata_code, lon: ap.longitude_deg, lat: ap.latitude_deg, radiusM: groundRadiusM(ap), runways: groundRunwayLines(ap) }));
    };

    // --- Airport layouts for airports not on screen ---------------------------
    // Your aircraft on the ground and the selected flight's two airports need
    // their taxiways at any zoom level; the airport layer of the same map tiles
    // is fetched for them (two airports at a time, retried after 2 minutes).
    const layoutLoading = new Set<string>();
    const layoutFailed = new Map<string, number>();
    let tileTemplate: Promise<string | null> | null = null;
    let wanted: string[] = [];
    let wantedAt = -Infinity;
    const getTemplate = () =>
      (tileTemplate ??= (async () => {
        const src = map.getStyle?.()?.sources?.[aeroSource];
        if (src?.tiles?.[0]) return String(src.tiles[0]);
        if (src?.url) {
          const j = await (await fetch(src.url)).json();
          return j?.tiles?.[0] ? String(j.tiles[0]) : null;
        }
        return null;
      })().catch(() => {
        tileTemplate = null;
        return null;
      }));
    const ensureLayout = (iata: string) => {
      const reg = taxiReg();
      if (reg.isComplete(iata) || layoutLoading.has(iata) || layoutLoading.size >= 2) return;
      const failedAt = layoutFailed.get(iata);
      if (failedAt !== undefined && performance.now() - failedAt < 120_000) return;
      const ap = latest.current.airportByIata.get(iata);
      if (!ap?.runways?.length) return;
      layoutLoading.add(iata);
      getTemplate()
        .then((tpl) => {
          if (!tpl) throw new Error('no tile address');
          return fetchAerowayAround(tpl, ap.longitude_deg, ap.latitude_deg, groundRadiusM(ap));
        })
        .then((feats) => {
          if (!reg.addComplete(groundRef_(ap), feats)) layoutFailed.set(iata, performance.now());
          groundLast = 0;
          endsCache = null;
        })
        .catch(() => layoutFailed.set(iata, performance.now()))
        .finally(() => layoutLoading.delete(iata));
    };
    /** Airports where your aircraft are (or soon will be) on the ground, plus the selected flight's. */
    const wantedAirports = (clock: UtcClock, st: typeof animState.current): string[] => {
      const now = clock.day * MIN_PER_DAY + clock.min;
      const out = new Set<string>();
      for (const i of st.flightInfo) {
        const f = i.flight;
        const days = daysOrAll(f.daysOfWeek);
        const taxi = playerTaxiMin(f.blockTimeMin);
        for (let dd = -2; dd <= 0; dd++) {
          if (!days[dayIndexOf(clock.day + dd)]) continue;
          const D = (clock.day + dd) * MIN_PER_DAY + f.depTimeMin;
          const end = D + f.blockTimeMin;
          if (now >= D - 45 && now <= D + taxi.out + 1) out.add(f.origin.iata_code);
          if (now >= end - taxi.in - 1 && now <= end + 90) out.add(f.destination.iata_code);
        }
      }
      const id = st.trackedFlightId;
      if (id) {
        const traffic = st.aiTraffic;
        const aiId = id.startsWith('ai:') ? Number(id.slice(3)) : id.startsWith('aig:') ? Number(id.split(':')[2]) : -1;
        if (aiId >= 0 && traffic?.flights[aiId]) {
          const f = traffic.flights[aiId];
          out.add(traffic.airports[f.o].iata);
          out.add(traffic.airports[f.d].iata);
        } else {
          const fl = st.flightInfo.find((i) => i.flight.id === id)?.flight;
          if (fl) {
            out.add(fl.origin.iata_code);
            out.add(fl.destination.iata_code);
          }
        }
      }
      return [...out];
    };

    // --- Taxi paths at both ends of the selected flight (for the full route) ---
    let endsCache: { key: string; at: number; out: LonLat[] | null; inn: LonLat[] | null } | null = null;
    const routeEnds = (key: string, origin: string, dest: string, moves: () => { dep?: GroundMove; arr?: GroundMove }, now: number, t: number) => {
      const reg = taxiReg();
      const on = reg.get(origin);
      const dn = reg.get(dest);
      const fullKey = `${key}|${on?.version ?? 0}|${dn?.version ?? 0}`;
      if (endsCache && endsCache.key === fullKey && t - endsCache.at < 5000) return endsCache;
      const m = on || dn ? moves() : {};
      endsCache = {
        key: fullKey,
        at: t,
        out: on && m.dep ? taxiPath(on, m.dep, now) : null,
        inn: dn && m.arr ? taxiPath(dn, m.arr, now) : null,
      };
      return endsCache;
    };
    const playerMovesFor = (fl: ScheduledFlight, depDay: number, clock: UtcClock, st: typeof animState.current) => {
      const lengthOf = (f: ScheduledFlight) => GROUP_LENGTH_M[getRadarIconGroup(infoById.map.get(f.id)?.model)];
      const turnaroundOf = (f: ScheduledFlight) => infoById.map.get(f.id)?.model?.turnaround_min ?? 45;
      const all = playerGroundMoves(
        st.flightInfo.map((i) => i.flight),
        clock.day,
        clock.min,
        lengthOf,
        turnaroundOf,
        new Set([fl.origin.iata_code, fl.destination.iata_code]),
        undefined,
        true
      );
      return {
        dep: all.get(fl.origin.iata_code)?.find((m) => m.key === `p:${fl.id}:${depDay}:d`),
        arr: all.get(fl.destination.iata_code)?.find((m) => m.key === `p:${fl.id}:${depDay}:a`),
      };
    };

    /**
     * Works out every aircraft on the ground: other airlines' at the airports
     * in view (zoomed in), yours wherever their airport's layout is known.
     */
    const updateGround = (clock: UtcClock, st: typeof animState.current, groundZoom: boolean) => {
      const reg = taxiReg();
      const now = clock.day * MIN_PER_DAY + clock.min;
      const viewNets = groundZoom ? groundRefs.map((r) => reg.get(r.iata)).filter((n): n is NonNullable<typeof n> => Boolean(n)) : [];
      const viewSet = new Set(viewNets.map((n) => n.iata));
      // The selected AI aircraft's airport is worked out even when zoomed out
      const trackedAiKey = st.trackedFlightId?.startsWith('aig:') ? st.trackedFlightId.slice(4) : null;
      const traffic = st.aiTraffic;
      let trackedAiAirport: string | null = null;
      if (trackedAiKey && traffic) {
        const f = traffic.flights[Number(trackedAiKey.split(':')[1])];
        if (f) trackedAiAirport = traffic.airports[trackedAiKey.endsWith(':d') ? f.o : f.d].iata;
      }
      const nets = [...viewNets];
      for (const iata of [...wanted, ...(trackedAiAirport ? [trackedAiAirport] : [])]) {
        const n = reg.get(iata);
        if (n && !nets.includes(n)) nets.push(n);
      }
      const ai = new Map<string, { pose: GroundPose; info: AiGroundInfo }>();
      const player = new Map<string, { pose: GroundPose; info: PlayerGroundInfo; props: Record<string, any> }>();
      const features: any[] = [];
      if (nets.length) {
        if (infoById.list !== st.flightInfo) infoById = { list: st.flightInfo, map: new Map(st.flightInfo.map((i) => [i.flight.id, i])) };
        const lengthOf = (f: ScheduledFlight) => GROUP_LENGTH_M[getRadarIconGroup(infoById.map.get(f.id)?.model)];
        const turnaroundOf = (f: ScheduledFlight) => infoById.map.get(f.id)?.model?.turnaround_min ?? 45;
        const pinfo = new Map<string, PlayerGroundInfo>();
        const pmoves = playerGroundMoves(
          st.flightInfo.map((i) => i.flight),
          clock.day,
          clock.min,
          lengthOf,
          turnaroundOf,
          new Set(nets.map((n) => n.iata)),
          pinfo
        );
        const aiOn = traffic && st.aiDensity !== 'off';
        if (aiOn && aiIndex?.traffic !== traffic) {
          aiIndex = { traffic: traffic!, index: buildAiAirportIndex(traffic!), byIata: new Map(traffic!.airports.map((a, i) => [a.iata, i])) };
        }
        const ainfo = new Map<string, AiGroundInfo>();
        // New routes, and up to ~8 ms of taxi planning, per redraw (the rest follows next time)
        const budget = { left: 40, planMs: 8 };
        for (const net of nets) {
          let moves: GroundMove[] = pmoves.get(net.iata) ?? [];
          if (aiOn && aiIndex && (viewSet.has(net.iata) || net.iata === trackedAiAirport)) {
            const apIdx = aiIndex.byIata.get(net.iata);
            if (apIdx !== undefined) {
              const airport = aiModel(traffic!).airports[apIdx];
              moves = moves.concat(aiGroundMoves(traffic!, aiIndex.index, apIdx, airport, clock.day, clock.min, aiKeep, ainfo));
            }
          }
          if (!moves.length) continue;
          const poses = groundPoses(net, moves, now, budget);
          // One drawing per aircraft of yours: a departure wins over the arrival it follows
          const byTail = new Map<string, string>();
          for (const [key, pose] of poses) {
            if (key.startsWith('a:')) {
              const info = ainfo.get(key)!;
              ai.set(key, { pose, info });
              if (!groundZoom || !viewSet.has(net.iata)) continue;
              const f = info.flight;
              features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: pose.coordinates },
                properties: {
                  kind: 'ai',
                  groundKey: key,
                  flightNumber: f.flightNumber,
                  icon_name: `ai-${f.group}`,
                  gs: groundIconScale(GROUP_LENGTH_M[f.group], pose.coordinates[1]),
                  bearing: pose.bearing,
                },
              });
              continue;
            }
            const info = pinfo.get(key)!;
            const tail = info.flight.tailNumber;
            const prev = byTail.get(tail);
            if (prev && (prev.endsWith(':d') || !key.endsWith(':d'))) continue;
            if (prev) player.delete(prev);
            byTail.set(tail, key);
            const fi = infoById.map.get(info.flight.id);
            if (!fi) continue;
            const blockEnd = info.depDay * MIN_PER_DAY + info.flight.depTimeMin + info.flight.blockTimeMin;
            const geo = getFlightGeometryForDeparture(info.flight, info.depDay);
            const props = {
              ...fi.props,
              kind: 'player',
              icon_name: mapImageName(resolvePlaneIconKey(fi.model, (k) => map.hasImage(mapImageName(k)))),
              icon_scale: fi.iconScale,
              gs: groundIconScale(lengthOf(info.flight), pose.coordinates[1]),
              bearing: pose.bearing,
              etaText: formatDurationHm(Math.max(0, Math.round(blockEnd - now))),
              progressPct: info.kind === 'dep' ? 0 : 100,
              phaseLabel: pose.phaseLabel,
              altitudeText: 'Ground',
              groundSpeedKts: pose.speedKts,
              // Runways and procedures of this flight, as in the air
              depRunway: geo.depRwy.ident,
              arrRunway: geo.arrRwy.ident,
              sidCode: geo.sidCode,
              starCode: geo.starCode,
              navaidSummary: geo.navaidSummary,
            };
            player.set(key, { pose, info, props });
          }
        }
        // Zoomed out, your aircraft stay on the regular layer (drawn every frame)
        if (groundZoom) for (const { pose, props } of player.values()) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: pose.coordinates }, properties: props });
      }
      groundRef.current = { ai, player };
      if (features.length || groundHasData) {
        map.getSource('ground-planes')?.setData({ type: 'FeatureCollection', features });
        groundHasData = features.length > 0;
      }
    };

    const inView = (lon: number, lat: number, b: { w: number; e: number; s: number; n: number }) => {
      if (lat < b.s || lat > b.n) return false;
      if (b.e - b.w >= 360) return true;
      const x = ((((lon - b.w) % 360) + 360) % 360);
      return x <= b.e - b.w;
    };

    const easeBearing = (id: string, target: number, dtMs: number) => {
      const prev = shownBearing.get(id);
      if (prev === undefined) {
        shownBearing.set(id, target);
        return target;
      }
      const diff = ((target - prev + 540) % 360) - 180;
      const maxStep = (dtMs / 1000) * 90; // turn at most 90°/s
      const next = (prev + Math.max(-maxStep, Math.min(maxStep, diff)) + 360) % 360;
      shownBearing.set(id, next);
      return next;
    };

    let seenStyleRev = styleRevRef.current;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const st = animState.current;
      if (seenStyleRev !== styleRevRef.current) {
        // New map style: its layers are fresh, so set zoom ranges and data again
        seenStyleRev = styleRevRef.current;
        lodKey = null;
        aiLastDraw = 0;
        aiHasData = true;
        groundHasData = true;
        groundLast = 0;
        route3dDrawn = '';
        ai3dZoom = -1;
      }

      // Detail level changed: new budget and dot/icon switch-over zoom
      const detail = latest.current.aiDetail;
      if (detail !== lodKey) {
        lodKey = detail;
        lod = AI_DETAIL_LEVELS[detail];
        budget = lod.budget;
        aiLastDraw = 0;
        map.setLayerZoomRange?.('ai-planes-dot', 0, Math.max(0.01, lod.dotsBelow));
        map.setLayerZoomRange?.('ai-planes-symbol', lod.dotsBelow, 24);
        probeStart = t;
        probeFrames = 0;
      }
      // Auto: lower the budget when frames get slow, raise it when there is headroom
      if (detail === 'auto' && st.visible && !document.hidden) {
        if (prevRaf && t - prevRaf > 250) {
          probeStart = t; // tab was in the background; start a fresh window
          probeFrames = 0;
        }
        probeFrames++;
        if (t - probeStart >= 2000) {
          const avg = (t - probeStart) / Math.max(1, probeFrames);
          if (avg > 45) budget = Math.max(AUTO_BUDGET_MIN, Math.round(budget * 0.75));
          else if (avg < 22 && aiDrawn >= budget * 0.95) budget = Math.min(AUTO_BUDGET_MAX, Math.round(budget * 1.15));
          probeStart = t;
          probeFrames = 0;
        }
      }
      prevRaf = t;

      // Hidden tab: keep data fresh about once a second, skip the animation work
      if (!st.visible && t - lastHidden < 1000) return;
      if (t - lastFrame < FRAME_MS) return;
      const dt = lastFrame ? t - lastFrame : FRAME_MS;
      lastFrame = t;
      lastHidden = t;

      const clock = latest.current.getClock();
      const features: any[] = [];
      let tracked: { coords: [number, number]; props: Record<string, any>; depDay: number; progress: number; flight: ScheduledFlight; cruiseKts: number; sizePx: number } | null = null;

      // --- Ground traffic at the airports in view -----------------------------
      const zoom = map.getZoom?.() ?? 0;
      // 3D: metres per pixel and height scale for this view
      const k3: Scale3d | null = latest.current.threeD ? scaleFor(map.getCenter?.()?.lat ?? 40, zoom, map.getProjection?.()?.type === 'globe') : null;
      const playerLabels3d: { at: LonLat; aglFt: number; sizePx: number; props: Record<string, unknown> }[] = [];
      const bodies3d: any[] = [];
      const stems3d: any[] = [];
      // Zooming changes their size and height: redraw other airlines sooner
      if (k3 && Math.abs(zoom - ai3dZoom) > 0.12) aiLastDraw = 0;
      const groundZoom = zoom >= GROUND_MIN_ZOOM;
      if (groundZoom !== lastGroundZoom) {
        // Switch layers straight away when crossing the ground zoom level
        lastGroundZoom = groundZoom;
        groundLast = 0;
        aerowayDirty = true;
      }
      if (t - wantedAt > 2000) {
        wantedAt = t;
        wanted = wantedAirports(clock, st);
        wanted.forEach(ensureLayout);
      }
      if (groundZoom && st.visible) {
        if (aerowayDirty && t - ingestLast > INGEST_MS && !map.isMoving?.()) {
          ingestLast = t;
          aerowayDirty = false;
          groundRefs = groundAirportsInView();
          if (groundRefs.length && zoom >= 13) {
            const raw = map.querySourceFeatures?.(aeroSource, { sourceLayer: 'aeroway' }) ?? [];
            const rebuilt = taxiReg().ingest(groundRefs, aerowayFromGeoJson(raw));
            if (rebuilt.length) {
              groundLast = 0;
              aerowayDirty = true; // look again: more tiles may still be arriving
            }
          }
        }
      }
      if (t - groundLast >= GROUND_MS) {
        groundLast = t;
        updateGround(clock, st, groundZoom);
      }
      const groundPlayer = groundRef.current.player;
      const groundTails = new Set([...groundPlayer.values()].map((g) => g.info.flight.tailNumber));
      // The selected aircraft of yours, if it is drawn on the ground layer
      const trackedGround = st.trackedFlightId ? [...groundPlayer.values()].find((g) => g.info.flight.id === st.trackedFlightId) : undefined;

      const drawnTails = new Set<string>();
      for (const info of st.flightInfo) {
        cruiseById.set(info.flight.id, info.cruiseKts);
        const pos = getLiveFlightPosition(info.flight, clock.min, clock.day, info.cruiseKts);
        if (!pos) {
          shownBearing.delete(info.flight.id);
          continue;
        }
        // Taxiing on the real taxiways: the ground position is used at every zoom
        // level (drawn by the ground layer when zoomed in), so the aircraft never
        // jumps between the gate and the runway as you zoom
        const g = pos.ground ? groundPlayer.get(`p:${info.flight.id}:${pos.depSimDay}:${pos.ground === 'out' ? 'd' : 'a'}`) : undefined;
        if (pos.ground && (groundZoom ? groundTails.has(info.flight.tailNumber) : !g && groundTails.has(info.flight.tailNumber))) {
          shownBearing.delete(info.flight.id);
          continue;
        }
        if (g) {
          pos.coordinates = g.pose.coordinates;
          pos.bearing = g.pose.bearing;
          pos.phaseLabel = g.pose.phaseLabel;
          pos.groundSpeedKts = g.pose.speedKts;
        }
        const bearing = Math.round(easeBearing(info.flight.id, pos.bearing, dt) * 10) / 10;
        // Height above the ground (altitudes are above sea level; the ground
        // rises or falls from one airport's elevation to the other's)
        const oElev = info.flight.origin.elevation_ft || 0;
        const agl = pos.altitudeText === 'Ground' ? 0 : Math.max(0, Math.round(pos.altitudeFt - (oElev + ((info.flight.destination.elevation_ft || 0) - oElev) * pos.progress)));
        const props = {
          ...info.props,
          agl,
          icon_name: mapImageName(resolvePlaneIconKey(info.model, (k) => map.hasImage(mapImageName(k)))),
          icon_scale: info.iconScale,
          bearing,
          etaText: formatDurationHm(pos.remainingMin),
          progressPct: Math.round(pos.progress * 100),
          phaseLabel: pos.phaseLabel,
          altitudeText: pos.altitudeText,
          groundSpeedKts: pos.groundSpeedKts,
          depRunway: pos.depRunway,
          arrRunway: pos.arrRunway,
          sidCode: pos.sidCode,
          starCode: pos.starCode,
          navaidSummary: pos.navaidSummary,
        };
        features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: pos.coordinates }, properties: props });
        if (k3 && agl > 0) {
          const p3 = { ...props, kind: 'player', at_lng: pos.coordinates[0], at_lat: pos.coordinates[1] };
          pushPlane3d({ at: pos.coordinates, bearing, aglFt: agl, sizePx: PLANE_3D_PX * info.iconScale, color: PLAYER_3D_COLOR, props: p3 }, k3, bodies3d, stems3d);
          playerLabels3d.push({ at: pos.coordinates, aglFt: agl, sizePx: PLANE_3D_PX * info.iconScale, props: { ...p3, label: info.flight.flightNumber, color: C.orange } });
        }
        drawnTails.add(info.flight.tailNumber);
        if (info.flight.id === st.trackedFlightId) {
          tracked = { coords: pos.coordinates, props, depDay: pos.depSimDay, progress: pos.progress, flight: info.flight, cruiseKts: info.cruiseKts, sizePx: PLANE_3D_PX * info.iconScale };
        }
      }
      // Zoomed out: aircraft of yours moving on the ground outside their block (an
      // early pushback) are still shown; parked ones only appear zoomed in
      if (!groundZoom) {
        for (const g of groundPlayer.values()) {
          if (drawnTails.has(g.info.flight.tailNumber) || g.pose.state === 'gate' || g.pose.state === 'arrived') continue;
          drawnTails.add(g.info.flight.tailNumber);
          features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: g.pose.coordinates }, properties: g.props });
        }
      }
      map.getSource('live-planes')?.setData({ type: 'FeatureCollection', features });
      if (k3 || p3dHasData) {
        map.getSource('planes-3d')?.setData({ type: 'FeatureCollection', features: bodies3d });
        p3dHasData = bodies3d.length > 0;
      }

      // --- AI traffic -------------------------------------------------------
      let trackedAi: { coords: [number, number]; agl?: number; sizePx?: number; flown: [number, number][]; remaining: [number, number][]; html: string } | null = null;
      const traffic = st.aiTraffic;
      const aiOn = traffic && st.aiDensity !== 'off';
      if (aiOn) {
        const rate = latest.current.mapRate;
        // Refresh sooner when map time runs fast, and always cover the time until the next refresh
        const refreshMs = rate > 1 ? AI_REFRESH_MS / 2 : AI_REFRESH_MS;
        const hiddenKey = latest.current.hiddenAiAirlines.join(',');
        if (aiKey.traffic !== traffic || aiKey.density !== st.aiDensity || aiKey.rate !== rate || aiKey.hidden !== hiddenKey || t - aiLastRefresh > refreshMs) {
          const hiddenIdx = new Set(
            latest.current.hiddenAiAirlines.map((code) => traffic.airlines.findIndex((a) => a.code === code)).filter((i) => i >= 0)
          );
          const maxBucket = DENSITY_BUCKETS[st.aiDensity];
          aiKeep = (f: AiFlight) => densityBucket(f) < maxBucket && !hiddenIdx.has(f.airline);
          const windowMin = (refreshMs / 60_000) * Math.max(1, rate) + 0.5;
          // Sorted by sampling rank: drawing stops at the budget, so the same
          // evenly spread subset stays on screen instead of flickering
          aiCandidates = findAirborneAi(traffic, clock.day, clock.min, windowMin)
            .filter((f) => densityBucket(f) < maxBucket && !hiddenIdx.has(f.airline))
            .map((f) => [aiRank(f), f] as const)
            .sort((a, b) => a[0] - b[0])
            .map(([, f]) => f);
          aiKey = { traffic, density: st.aiDensity, rate, hidden: hiddenKey };
          aiLastRefresh = t;
          aiLastDraw = 0;
          aiAirborne = aiCandidates.filter((f) => aiDepartureDay(f, clock.day, clock.min) !== null).length;
          reportedDrawn = -1; // airborne count changed: report after the next draw
          lastStatsReport = -Infinity;
        }
        // Busy skies redraw a little less often
        const drawMs = aiDrawn > 3000 ? Math.max(lod.drawMs, 450) : lod.drawMs;
        if (t - aiLastDraw >= drawMs) {
          aiLastDraw = t;
          const raw = map.getBounds?.();
          const b = raw
            ? (() => {
                const w = raw.getWest(), e = raw.getEast(), so = raw.getSouth(), no = raw.getNorth();
                const padX = (e - w) * 0.15, padY = (no - so) * 0.15;
                return { w: w - padX, e: e + padX, s: so - padY, n: no + padY };
              })()
            : { w: -180, e: 180, s: -90, n: 90 };
          const aiFeatures: any[] = [];
          const ai3d: any[] = [];
          aiStems = [];
          aiLabels3d = [];
          const aiColor = aiTintFor(latest.current.mapStyle);
          // Each 3D aircraft is a few hundred vertices: fewer of them in 3D
          const aiBudget = k3 ? Math.min(budget, AI_3D_MAX) : budget;
          const trackedAiId = st.trackedFlightId?.startsWith('ai:') ? Number(st.trackedFlightId.slice(3)) : -1;
          // New takeoff/arrival procedures: at most ~6 ms of building per redraw; the rest follow next time
          const model = aiModel(traffic);
          const buildBudget = { left: 300, until: performance.now() + 6 };
          for (const f of aiCandidates) {
            if (aiFeatures.length >= aiBudget && f.id !== trackedAiId) {
              if (trackedAiId < 0) break;
              continue; // keep looking only for the selected aircraft
            }
            const pos = model.position(f, clock.day, clock.min, buildBudget);
            if (!pos || !inView(pos.coordinates[0], pos.coordinates[1], b)) continue;
            aiFeatures.push({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: pos.coordinates },
              properties: {
                aiId: f.id,
                flightNumber: f.flightNumber,
                icon_name: `ai-${f.group}`,
                icon_scale: Number(((AI_ICON_SCALE[f.group] ?? 0.56) * st.planeIconScale).toFixed(3)),
                bearing: pos.bearing,
                agl: pos.altitudeFt,
              },
            });
            if (k3 && pos.altitudeFt > 0) {
              const sizePx = PLANE_3D_PX * (AI_ICON_SCALE[f.group] ?? 0.56) * st.planeIconScale;
              pushPlane3d({ at: pos.coordinates, bearing: pos.bearing, aglFt: pos.altitudeFt, sizePx, color: aiColor, props: { kind: 'ai', aiId: f.id } }, k3, ai3d, f.id === trackedAiId ? aiStems : undefined);
              aiLabels3d.push({ at: pos.coordinates, aglFt: pos.altitudeFt, sizePx, props: { kind: 'ai', aiId: f.id, label: f.flightNumber, color: latest.current.mapStyle === 'light' ? '#475569' : C.muted } });
            }
          }
          // Zoomed out, the selected AI aircraft still shows while it is on the ground
          if (!groundZoom && st.trackedFlightId?.startsWith('aig:')) {
            const entry = groundRef.current.ai.get(st.trackedFlightId.slice(4));
            if (entry)
              aiFeatures.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: entry.pose.coordinates },
                properties: {
                  aiId: entry.info.flight.id,
                  flightNumber: entry.info.flight.flightNumber,
                  icon_name: `ai-${entry.info.flight.group}`,
                  icon_scale: Number(((AI_ICON_SCALE[entry.info.flight.group] ?? 0.56) * st.planeIconScale).toFixed(3)),
                  bearing: entry.pose.bearing,
                },
              });
          }
          map.getSource('ai-planes')?.setData({ type: 'FeatureCollection', features: aiFeatures });
          if (k3 || ai3dHasData) {
            map.getSource('ai-3d')?.setData({ type: 'FeatureCollection', features: ai3d });
            ai3dHasData = ai3d.length > 0;
            ai3dZoom = zoom;
            // Labels / click targets only for the aircraft nearest the view centre
            if (aiLabels3d.length > AI_LABELS_3D_MAX) {
              const c = map.getCenter?.() ?? { lng: 0, lat: 0 };
              const d = (q: LonLat) => (q[0] - c.lng) ** 2 + (q[1] - c.lat) ** 2;
              aiLabels3d.sort((a, b) => d(a.at) - d(b.at));
              aiLabels3d.length = AI_LABELS_3D_MAX;
            }
            labels3dKey = ''; // re-place them
          }
          aiHasData = true;
          aiDrawn = aiFeatures.length;
          const changed = aiDrawn !== reportedDrawn || aiBudget !== lastBudgetReported;
          // At most once a second, so the counter doesn't re-render the app on every draw
          if (changed && t - lastStatsReport >= 1000) {
            lastStatsReport = t;
            reportedDrawn = aiDrawn;
            lastBudgetReported = aiBudget;
            latest.current.onAiStats?.({ airborne: aiAirborne, drawn: aiDrawn, budget: aiBudget });
          }
        }
      } else if (aiHasData) {
        map.getSource('ai-planes')?.setData(EMPTY_FC);
        map.getSource('ai-3d')?.setData(EMPTY_FC);
        ai3dHasData = false;
        aiStems = [];
        aiHasData = false;
        aiDrawn = 0;
        reportedDrawn = 0;
        latest.current.onAiStats?.({ airborne: 0, drawn: 0, budget });
      }
      // Selected AI aircraft: follow it from the gate into the air and back onto the ground
      const follow = (id: string) => {
        st.trackedFlightId = id;
        animState.current.trackedFlightId = id;
        setTrackedFlightId(id);
      };
      const nowAbs = clock.day * MIN_PER_DAY + clock.min;
      // The whole route of an AI flight: taxi out, flight, taxi in (as far as the layouts are known)
      const aiEnds = (f: AiFlight, depDay: number) => {
        const model = aiModel(traffic!);
        return routeEnds(
          `a:${f.id}:${depDay}`,
          traffic!.airports[f.o].iata,
          traffic!.airports[f.d].iata,
          () => ({ dep: aiDepartureMove(traffic!, f, depDay, model.airports[f.o]), arr: aiArrivalMove(traffic!, f, depDay, model.airports[f.d]) }),
          nowAbs,
          t
        );
      };
      const aiGroundView = (entry: { pose: GroundPose; info: AiGroundInfo }) => {
        const { flight: f, depDay, kind } = entry.info;
        const tr = entry.pose.trail();
        const full = aiModel(traffic!).fullPath(f, depDay);
        const ends = aiEnds(f, depDay);
        const flown = kind === 'dep' ? tr.flown : joinPaths(joinPaths(ends.out ?? [], full), tr.flown);
        const remaining = kind === 'dep' ? joinPaths(joinPaths(tr.remaining, full), ends.inn ?? []) : tr.remaining;
        return { coords: entry.pose.coordinates, flown, remaining, html: aiGroundPopupHtml(traffic!, entry, clock) };
      };
      if (traffic && st.trackedFlightId?.startsWith('aig:')) {
        const key = st.trackedFlightId.slice(4);
        const entry = groundRef.current.ai.get(key);
        if (entry) trackedAi = aiGroundView(entry);
        else {
          const id = Number(key.split(':')[1]);
          const f = traffic.flights[id];
          if (f && aiModel(traffic).position(f, clock.day, clock.min, { left: 1 })) follow(`ai:${id}`); // took off
        }
      }
      if (traffic && st.trackedFlightId?.startsWith('ai:')) {
        const id = Number(st.trackedFlightId.slice(3));
        const f = traffic.flights[id];
        const model = aiModel(traffic);
        const pos = f && model.position(f, clock.day, clock.min, { left: 1 });
        const trail = f && pos ? model.trail(f, clock.day, clock.min) : null;
        const depDay = f ? aiDepartureDay(f, clock.day, clock.min) : null;
        if (f && pos && trail && depDay !== null) {
          const ends = aiEnds(f, depDay);
          trackedAi = {
            coords: pos.coordinates,
            agl: pos.altitudeFt,
            sizePx: PLANE_3D_PX * (AI_ICON_SCALE[f.group] ?? 0.56) * st.planeIconScale,
            flown: joinPaths(ends.out ?? [], trail.flown),
            remaining: joinPaths(trail.remaining, ends.inn ?? []),
            html: buildAiPopupHtml(traffic, f, pos),
          };
        } else if (f) {
          // Landed: carry on with it on the taxiways
          const key = [...groundRef.current.ai.keys()].find((k) => k.startsWith(`a:${id}:`) && k.endsWith(':a'));
          const entry = key ? groundRef.current.ai.get(key) : undefined;
          if (key && entry) {
            follow(`aig:${key}`);
            trackedAi = aiGroundView(entry);
          }
        }
      }

      // --- Selected plane (yours or AI): trail + popup that follows it -------
      const flownSrc = map.getSource('track-flown');
      const aheadSrc = map.getSource('track-remaining');
      // Your flights: one route from gate to gate (taxi out, flight, taxi in)
      const playerEnds = (fl: ScheduledFlight, depDay: number) =>
        routeEnds(`p:${fl.id}:${depDay}`, fl.origin.iata_code, fl.destination.iata_code, () => playerMovesFor(fl, depDay, clock, st), nowAbs, t);
      let view: { coords: [number, number]; flown: LonLat[]; remaining: LonLat[]; html: () => string } | null = trackedGround
        ? (() => {
            const g = trackedGround;
            const tr = g.pose.trail();
            const fl = g.info.flight;
            const full = splitFlightPath(fl, g.info.depDay, 0).remaining;
            const ends = playerEnds(fl, g.info.depDay);
            const flown = g.info.kind === 'dep' ? tr.flown : joinPaths(joinPaths(ends.out ?? [], full), tr.flown);
            const remaining = g.info.kind === 'dep' ? joinPaths(joinPaths(tr.remaining, full), ends.inn ?? []) : tr.remaining;
            return { coords: g.pose.coordinates, flown, remaining, html: () => buildPlanePopupHtml(g.props) };
          })()
        : tracked
        ? (() => {
            const { flown, remaining } = splitFlightPath(tracked.flight, tracked.depDay, tracked.progress);
            const ends = playerEnds(tracked.flight, tracked.depDay);
            const props = tracked.props;
            return {
              coords: tracked.coords,
              flown: joinPaths(ends.out ?? [], flown),
              remaining: joinPaths(remaining, ends.inn ?? []),
              html: () => buildPlanePopupHtml(props),
            };
          })()
        : trackedAi
        ? { ...trackedAi, html: () => trackedAi!.html }
        : null;
      // --- 3D: lines down to the shadows, and the selected route at altitude ---
      if (k3) {
        map.getSource('planes-3d-stem')?.setData({ type: 'FeatureCollection', features: aiStems.length ? stems3d.concat(aiStems) : stems3d });
        let key = '';
        let sample: (() => TimedPoint[]) | null = null;
        if (tracked && !trackedGround) {
          const { flight: fl, depDay, cruiseKts } = tracked;
          key = `p:${fl.id}:${depDay}`;
          sample = () => samplePlayerRoute(fl, depDay, cruiseKts);
        } else if (trackedGround) {
          // On the ground before or after the flight: the whole route still shows (all ahead, or all flown)
          const { flight: fl, depDay } = trackedGround.info;
          key = `p:${fl.id}:${depDay}`;
          sample = () => samplePlayerRoute(fl, depDay, cruiseById.get(fl.id) ?? 450);
        } else if (traffic && st.trackedFlightId?.startsWith('aig:')) {
          const entry = groundRef.current.ai.get(st.trackedFlightId.slice(4));
          if (entry) {
            const { flight: f, depDay } = entry.info;
            key = `a:${f.id}:${depDay}`;
            const model = aiModel(traffic);
            sample = () => sampleAiRoute(model, f, depDay);
          }
        } else if (traffic && st.trackedFlightId?.startsWith('ai:')) {
          const f = traffic.flights[Number(st.trackedFlightId.slice(3))];
          const depDay = f ? aiDepartureDay(f, clock.day, clock.min) : null;
          if (f && depDay !== null) {
            key = `a:${f.id}:${depDay}`;
            const model = aiModel(traffic);
            sample = () => sampleAiRoute(model, f, depDay);
          }
        }
        if (!key || !sample) route3d = null;
        else if (route3d?.key !== key) route3d = { key, pts: sample() };
        if (route3d && t - route3dAt > 300) {
          const nowAbs = clock.day * MIN_PER_DAY + clock.min;
          let split = route3d.pts.findIndex((p) => p.t > nowAbs);
          if (split < 0) split = route3d.pts.length;
          const drawKey = `${route3d.key}:${split}:${k3.mpp.toPrecision(3)}`;
          if (drawKey !== route3dDrawn) {
            const ribbon: any[] = [];
            const curtain: any[] = [];
            const mine = route3d.key.startsWith('p:');
            pushRoute3d(route3d.pts, split, k3, { flown: mine ? C.orange : C.accent, ahead: C.textDim }, ribbon, curtain);
            map.getSource('route-3d')?.setData({ type: 'FeatureCollection', features: ribbon });
            map.getSource('route-3d-curtain')?.setData({ type: 'FeatureCollection', features: curtain });
            route3dDrawn = drawKey;
            route3dAt = t;
          }
        } else if (!route3d && route3dDrawn) {
          map.getSource('route-3d')?.setData(EMPTY_FC);
          map.getSource('route-3d-curtain')?.setData(EMPTY_FC);
          route3dDrawn = '';
        }
      } else {
        route3d = null;
        route3dDrawn = '';
      }

      // Hand-overs (gate ↔ air, a layout still loading) can leave one redraw without
      // a position; keep the last one briefly instead of closing the info box
      if (view) {
        lastView = view;
        lastViewAt = t;
      } else if (st.trackedFlightId && lastView && t - lastViewAt < 3000) view = lastView;
      // --- 3D: labels and click targets under the floating aircraft on screen ----
      const cont = map.getContainer?.();
      const vw = cont?.clientWidth || 1400;
      const vh = cont?.clientHeight || 900;
      if (k3) {
        const camKey = `${zoom.toFixed(3)}|${map.getPitch?.()?.toFixed(2)}|${map.getBearing?.()?.toFixed(2)}|${map.getCenter?.()?.lng?.toFixed(5)}|${map.getCenter?.()?.lat?.toFixed(5)}`;
        const place = (q: { at: LonLat; aglFt: number; sizePx: number; props: Record<string, unknown> }, picks: Pick3d[]) => {
          const hM = labelHeightM(q.aglFt, q.sizePx, k3, q.at[1]);
          // Where it is on screen, for clicks (works even when it floats above the horizon)
          const sp = screenAt(map, q.at, hM);
          if (sp && sp.x > -20 && sp.y > -20 && sp.x < vw + 20 && sp.y < vh + 20) picks.push({ x: sp.x, y: sp.y, r: Math.max(12, q.sizePx * 0.55), at: q.at, props: q.props });
          const g = groundUnder(map, q.at, hM, vw, vh);
          return g ? { type: 'Feature', geometry: { type: 'Point', coordinates: g }, properties: q.props } : null;
        };
        // Yours move every frame; others only when they were redrawn or the camera moved
        if (camKey !== labels3dKey || !aiLabelFeats || playerLabels3d.length || (labels3dHasData && !aiLabelFeats.length)) {
          const feats: any[] = [];
          const playerPicks: Pick3d[] = [];
          for (const q of playerLabels3d) {
            const f = place(q, playerPicks);
            if (f) feats.push(f);
          }
          if (camKey !== labels3dKey || !aiLabelFeats) {
            aiLabelFeats = [];
            aiPicks = [];
            for (const q of aiLabels3d) {
              const f = place(q, aiPicks);
              if (f) aiLabelFeats.push(f);
            }
            labels3dKey = camKey;
          }
          picks3d.current = playerPicks.concat(aiPicks);
          const all = aiLabelFeats.length ? feats.concat(aiLabelFeats) : feats;
          map.getSource('labels-3d')?.setData({ type: 'FeatureCollection', features: all });
          labels3dHasData = all.length > 0;
        }
      } else if (labels3dHasData || picks3d.current.length) {
        map.getSource('labels-3d')?.setData(EMPTY_FC);
        picks3d.current = [];
        aiPicks = [];
        labels3dHasData = false;
        aiLabelFeats = null;
        labels3dKey = '';
      }
      // Where the selected aircraft is on screen (in 3D: the floating aircraft, not its shadow)
      const viewAgl = trackedGround ? 0 : tracked ? Number(tracked.props.agl) || 0 : trackedAi?.agl ?? 0;
      const viewSize = tracked?.sizePx ?? trackedAi?.sizePx ?? PLANE_3D_PX * 0.6;

      if (view) {
        const line = (coordinates: [number, number][]) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {} }] });
        flownSrc?.setData(line(view.flown));
        aheadSrc?.setData(line(view.remaining));
        const lifted = k3 && viewAgl > 0 ? labelHeightM(viewAgl, viewSize, k3, view.coords[1]) : 0;
        // Camera follows the selected aircraft when it goes off screen (not while you're moving the map)
        if (st.visible && t - userMoveAt.current > 2500 && t - lastFollow > 1500 && !map.isMoving?.()) {
          const sp = lifted ? screenAt(map, view.coords, lifted) : map.project?.(view.coords);
          const m = 48;
          if (sp && (sp.x < m || sp.y < 70 || sp.x > vw - m || sp.y > vh - m)) {
            lastFollow = t;
            map.easeTo?.({ center: view.coords, duration: 1100 });
          }
        }
        if (popupRef.current) {
          popupRef.current.setLngLat((lifted && groundUnder(map, view.coords, lifted, vw, vh)) || view.coords);
          if (t - lastPopup >= POPUP_MS) {
            lastPopup = t;
            const body = popupRef.current.getElement?.()?.querySelector('.bp-live-popup-body');
            if (body) {
              body.innerHTML = view.html();
              popupRef.current.__relayout?.(); // the box may have changed size
            }
          }
        }
      } else {
        flownSrc?.setData(EMPTY_FC);
        aheadSrc?.setData(EMPTY_FC);
        if (st.trackedFlightId) {
          // The plane landed (or AI traffic was switched off) — close its popup
          closePopup();
          setTrackedFlightId(null);
        }
      }
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      map.off?.('sourcedata', onSourceData);
    };
    // Everything else is read through animState; restart only when the map is (re)created
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, mapRef]);

  return (
    <>
      <div ref={containerRef} style={{ width: '100%', height: '100%', visibility: visible ? 'visible' : 'hidden' }} />
      {mapError && visible && (
        <div
          style={{
            position: 'absolute',
            top: '45%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: C.panel,
            border: `1px solid ${C.red}`,
            color: C.redSoft,
            padding: '14px 18px',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 700,
            zIndex: 5,
          }}
        >
          {mapError}
        </div>
      )}
    </>
  );
}
