// ============================================================================
// Great-circle geometry helpers (all distances in nautical miles)
// ============================================================================
import type { Airport } from './types';

export type LonLat = [number, number];

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const EARTH_RADIUS_NM = 3440.065;

export function calcCoordDistanceNm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * sinDLon * sinDLon;
  return EARTH_RADIUS_NM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

/** Whole-nm airport-to-airport distance (min 1). */
export function calcDistanceNm(a: Airport, b: Airport): number {
  return Math.max(
    1,
    Math.round(calcCoordDistanceNm(a.longitude_deg, a.latitude_deg, b.longitude_deg, b.latitude_deg))
  );
}

/** Scheduled block time: airborne time + 20 min taxi, rounded up to 5 min. */
export function calcBlockTimeMin(distanceNm: number, cruiseSpeedKts: number): number {
  const rawMin = Math.ceil((distanceNm / Math.max(120, cruiseSpeedKts)) * 60 + 20);
  return Math.max(25, Math.ceil(rawMin / 5) * 5);
}

export function calcBearingDeg(from: LonLat, to: LonLat): number {
  const lon1 = from[0] * DEG2RAD;
  const lat1 = from[1] * DEG2RAD;
  const lon2 = to[0] * DEG2RAD;
  const lat2 = to[1] * DEG2RAD;
  const dLon = lon2 - lon1;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * RAD2DEG + 360) % 360;
}

/** Smallest absolute difference between two headings (0..180). */
export function headingDiffDeg(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

/** Spherical linear interpolation between two points (t in 0..1). */
export function interpolateCoordPair(from: LonLat, to: LonLat, t: number): LonLat {
  const lat1 = from[1] * DEG2RAD;
  const lon1 = from[0] * DEG2RAD;
  const lat2 = to[1] * DEG2RAD;
  const lon2 = to[0] * DEG2RAD;

  const x1 = Math.cos(lat1) * Math.cos(lon1);
  const y1 = Math.cos(lat1) * Math.sin(lon1);
  const z1 = Math.sin(lat1);
  const x2 = Math.cos(lat2) * Math.cos(lon2);
  const y2 = Math.cos(lat2) * Math.sin(lon2);
  const z2 = Math.sin(lat2);

  const omega = Math.acos(Math.max(-1, Math.min(1, x1 * x2 + y1 * y2 + z1 * z2)));
  if (omega < 1e-6) return [from[0], from[1]];

  const sinOmega = Math.sin(omega);
  const f1 = Math.sin((1 - t) * omega) / sinOmega;
  const f2 = Math.sin(t * omega) / sinOmega;
  const x = f1 * x1 + f2 * x2;
  const y = f1 * y1 + f2 * y2;
  const z = f1 * z1 + f2 * z2;
  return [Math.atan2(y, x) * RAD2DEG, Math.atan2(z, Math.sqrt(x * x + y * y)) * RAD2DEG];
}

/** Destination point given a start, true bearing and distance. Returns [lon, lat]. */
export function offsetLatLonNm(latDeg: number, lonDeg: number, bearingDeg: number, distNm: number): LonLat {
  const angDist = distNm / EARTH_RADIUS_NM;
  const brng = ((((bearingDeg % 360) + 360) % 360) * DEG2RAD);
  const lat1 = latDeg * DEG2RAD;
  const lon1 = lonDeg * DEG2RAD;

  const sinLat2 =
    Math.sin(lat1) * Math.cos(angDist) + Math.cos(lat1) * Math.sin(angDist) * Math.cos(brng);
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
  const y = Math.sin(brng) * Math.sin(angDist) * Math.cos(lat1);
  const x = Math.cos(angDist) - Math.sin(lat1) * sinLat2;
  const lon2 = lon1 + Math.atan2(y, x);

  const round5 = (v: number) => Math.round(v * 100000) / 100000;
  return [round5(normalizeLon(lon2 * RAD2DEG)), round5(lat2 * RAD2DEG)];
}

export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}
