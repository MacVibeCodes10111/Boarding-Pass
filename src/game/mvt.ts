// ============================================================================
// AIRPORT LAYOUTS STRAIGHT FROM THE MAP TILES
//   The map only loads tiles for what is on screen, but a flight's route
//   needs the taxiways at both ends. This reads the same vector tiles the map
//   uses (Mapbox Vector Tile format), decoding only the "aeroway" layer, for
//   the few airports that need it. The browser caches the tiles, and the map
//   would load the same files when you zoom in there anyway.
// ============================================================================
import type { LonLat } from './geo';
import type { AerowayFeature } from './taxi';

const D2R = Math.PI / 180;

// --- Minimal protobuf reader ---------------------------------------------------
class Pbf {
  pos = 0;
  constructor(readonly buf: Uint8Array, readonly end = buf.length) {}
  varint(): number {
    let val = 0;
    let shift = 0;
    for (;;) {
      const b = this.buf[this.pos++];
      val += (b & 0x7f) * 2 ** shift;
      if (b < 0x80) return val;
      shift += 7;
      if (shift > 63) throw new Error('bad varint');
    }
  }
  svarint(): number {
    const n = this.varint();
    return n % 2 === 1 ? (n + 1) / -2 : n / 2;
  }
  bytes(): Uint8Array {
    const len = this.varint();
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
  string(): string {
    return new TextDecoder().decode(this.bytes());
  }
  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
    else throw new Error('bad wire type ' + wire);
  }
  packed(): number[] {
    const end = this.varint() + this.pos;
    const out: number[] = [];
    while (this.pos < end) out.push(this.varint());
    return out;
  }
}

function readValue(buf: Uint8Array): string {
  const p = new Pbf(buf);
  while (p.pos < p.end) {
    const tag = p.varint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) return p.string();
    if (field === 2 && wire === 5) {
      const v = new DataView(buf.buffer, buf.byteOffset + p.pos, 4).getFloat32(0, true);
      p.pos += 4;
      return String(v);
    }
    if (field === 3 && wire === 1) {
      const v = new DataView(buf.buffer, buf.byteOffset + p.pos, 8).getFloat64(0, true);
      p.pos += 8;
      return String(v);
    }
    if ((field === 4 || field === 5) && wire === 0) return String(p.varint());
    if (field === 6 && wire === 0) return String(p.svarint());
    if (field === 7 && wire === 0) return p.varint() ? 'true' : 'false';
    p.skip(wire);
  }
  return '';
}

/** Decodes one layer (default "aeroway") of a vector tile into lon/lat features. */
export function decodeAerowayTile(data: Uint8Array, z: number, x: number, y: number, layerName = 'aeroway'): AerowayFeature[] {
  const tile = new Pbf(data);
  const out: AerowayFeature[] = [];
  while (tile.pos < tile.end) {
    const tag = tile.varint();
    if (tag >> 3 !== 3 || (tag & 7) !== 2) {
      tile.skip(tag & 7);
      continue;
    }
    const layerBuf = tile.bytes();
    // First pass: name, keys, values, extent; features kept as raw bytes
    const lp = new Pbf(layerBuf);
    let name = '';
    const keys: string[] = [];
    const values: string[] = [];
    const feats: Uint8Array[] = [];
    let extent = 4096;
    while (lp.pos < lp.end) {
      const t = lp.varint();
      const f = t >> 3;
      const w = t & 7;
      if (f === 1 && w === 2) name = lp.string();
      else if (f === 2 && w === 2) feats.push(lp.bytes());
      else if (f === 3 && w === 2) keys.push(lp.string());
      else if (f === 4 && w === 2) values.push(readValue(lp.bytes()));
      else if (f === 5 && w === 0) extent = lp.varint();
      else lp.skip(w);
    }
    if (name !== layerName) continue;
    const n = 2 ** z;
    const toLL = (px: number, py: number): LonLat => {
      const wx = (x + px / extent) / n;
      const wy = (y + py / extent) / n;
      return [wx * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) / D2R];
    };
    for (const fb of feats) {
      const fp = new Pbf(fb);
      let tags: number[] = [];
      let type = 0;
      let geom: number[] = [];
      while (fp.pos < fp.end) {
        const t = fp.varint();
        const f = t >> 3;
        const w = t & 7;
        if (f === 2 && w === 2) tags = fp.packed();
        else if (f === 3 && w === 0) type = fp.varint();
        else if (f === 4 && w === 2) geom = fp.packed();
        else fp.skip(w);
      }
      const props: Record<string, string> = {};
      for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = values[tags[i + 1]];
      const cls = props.class ?? props.aeroway ?? '';
      if (!cls) continue;
      const ref = (props.ref ?? '').trim();
      // Geometry commands: MoveTo / LineTo / ClosePath with zigzag deltas
      const parts: LonLat[][] = [];
      let cur: LonLat[] = [];
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < geom.length; ) {
        const cmd = geom[i] & 7;
        const count = geom[i] >> 3;
        i++;
        if (cmd === 7) {
          if (cur.length) cur.push(cur[0]);
          continue;
        }
        for (let k = 0; k < count && i + 1 < geom.length; k++) {
          const dx = geom[i++];
          const dy = geom[i++];
          cx += dx % 2 === 1 ? (dx + 1) / -2 : dx / 2;
          cy += dy % 2 === 1 ? (dy + 1) / -2 : dy / 2;
          if (cmd === 1) {
            if (cur.length) parts.push(cur);
            cur = [];
          }
          cur.push(toLL(cx, cy));
        }
      }
      if (cur.length) parts.push(cur);
      for (const coords of parts) {
        if (type === 1) for (const c of coords) out.push({ cls, ref, kind: 'point', coords: [c] });
        else if (type === 2 && coords.length >= 2) out.push({ cls, ref, kind: 'line', coords });
        else if (type === 3 && coords.length >= 3) out.push({ cls, ref, kind: 'polygon', coords });
      }
    }
  }
  return out;
}

/** Tiles at zoom `z` covering a circle around a point. */
export function tilesAround(lon: number, lat: number, radiusM: number, z: number): [number, number][] {
  const n = 2 ** z;
  const dLat = radiusM / 111_320;
  const dLon = dLat / Math.max(0.1, Math.cos(lat * D2R));
  const tx = (lo: number) => Math.floor(((lo + 180) / 360) * n);
  const ty = (la: number) => Math.floor(((1 - Math.log(Math.tan(la * D2R) + 1 / Math.cos(la * D2R)) / Math.PI) / 2) * n);
  const out: [number, number][] = [];
  for (let x = tx(lon - dLon); x <= tx(lon + dLon); x++)
    for (let y = ty(lat + dLat); y <= ty(lat - dLat); y++) out.push([((x % n) + n) % n, y]);
  return out;
}

async function gunzipIfNeeded(buf: Uint8Array): Promise<Uint8Array> {
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) return buf;
  const DS = (globalThis as any).DecompressionStream;
  if (!DS) throw new Error('gzip tiles not supported here');
  const stream = new Blob([buf as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DS('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Fetches the airport layer around a point from a tile URL template
 * ("…/{z}/{x}/{y}.mvt"). Uses zoom `z` (the tiles' most detailed level),
 * dropping one level when the airport would need more than `maxTiles`.
 */
export async function fetchAerowayAround(
  template: string,
  lon: number,
  lat: number,
  radiusM: number,
  z = 14,
  maxTiles = 64,
  fetchFn: typeof fetch = fetch
): Promise<AerowayFeature[]> {
  let zz = z;
  let tiles = tilesAround(lon, lat, radiusM, zz);
  while (tiles.length > maxTiles && zz > 12) tiles = tilesAround(lon, lat, radiusM, --zz);
  const out: AerowayFeature[] = [];
  let ok = 0;
  const queue = [...tiles];
  const worker = async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      const [x, y] = t;
      const url = template.replace('{z}', String(zz)).replace('{x}', String(x)).replace('{y}', String(y));
      try {
        const res = await fetchFn(url);
        if (!res.ok) continue;
        const buf = await gunzipIfNeeded(new Uint8Array(await res.arrayBuffer()));
        out.push(...decodeAerowayTile(buf, zz, x, y));
        ok++;
      } catch {
        /* one missing tile only leaves a gap */
      }
      // Let the map breathe between tiles
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (!ok) throw new Error('no tiles');
  return out;
}
