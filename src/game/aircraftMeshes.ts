// ============================================================================
// 3D AIRCRAFT SHAPES (v2.46+)
//
// Low-poly aircraft built from parts in code (no model files): a lofted
// fuselage, wings, tailplane, fin, engines and, for turboprops, propeller
// discs. One shape per icon group (twin jets, quads, rear-engined T-tails,
// high-wing turboprops, commuters…), with the real types' proportions.
//
// Units: half the aircraft's length is 1. x = right wing, y = nose, z = up;
// the fuselage centreline is z = 0. Triangles only, with normals and the part
// each belongs to (for its paint), packed as [x, y, z, nx, ny, nz, part] per
// vertex (no index buffer).
// ============================================================================
import type { RadarIconGroup } from './types';

type V3 = [number, number, number];

/** Which part a triangle belongs to: the layer paints each differently. */
export const PART = { body: 0, wing: 1, fin: 2, engine: 3, prop: 4 } as const;
/** Floats per vertex. */
export const MESH_STRIDE = 7;

class MeshBuilder {
  readonly data: number[] = [];
  /** Centre of the part being built: flat faces get the normal that points away from it. */
  center: V3 | null = null;
  part: number = PART.body;
  tri(a: V3, b: V3, c: V3, na?: V3, nb?: V3, nc?: V3) {
    let n = na ?? faceNormal(a, b, c);
    if (!na && this.center) {
      const g: V3 = [(a[0] + b[0] + c[0]) / 3 - this.center[0], (a[1] + b[1] + c[1]) / 3 - this.center[1], (a[2] + b[2] + c[2]) / 3 - this.center[2]];
      if (g[0] * n[0] + g[1] * n[1] + g[2] * n[2] < 0) n = [-n[0], -n[1], -n[2]];
    }
    const p = this.part;
    this.data.push(...a, ...n, p, ...b, ...(nb ?? n), p, ...c, ...(nc ?? n), p);
  }
  quad(a: V3, b: V3, c: V3, d: V3) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
}

function faceNormal(a: V3, b: V3, c: V3): V3 {
  const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

/**
 * A body of revolution along y (fuselage, nacelle, hump): stations of
 * [y, half-width, half-height, z-offset], joined around by `sides` facets with
 * smooth normals; the ends are closed.
 */
function loft(m: MeshBuilder, stations: [number, number, number, number][], sides: number, at: V3 = [0, 0, 0]) {
  const ring = (s: [number, number, number, number]) =>
    Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      const p: V3 = [at[0] + c * s[1], at[1] + s[0], at[2] + s[3] + sn * s[2]];
      const n0: V3 = [c / Math.max(1e-4, s[1]), 0, sn / Math.max(1e-4, s[2])];
      const l = Math.hypot(n0[0], n0[2]) || 1;
      return { p, n: [n0[0] / l, 0, n0[2] / l] as V3 };
    });
  const rings = stations.map(ring);
  for (let k = 0; k + 1 < rings.length; k++) {
    const A = rings[k], B = rings[k + 1];
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      m.tri(A[i].p, B[i].p, B[j].p, A[i].n, B[i].n, B[j].n);
      m.tri(A[i].p, B[j].p, A[j].p, A[i].n, B[j].n, A[j].n);
    }
  }
  // Caps (flat)
  for (const [k, dir] of [[0, -1], [rings.length - 1, 1]] as const) {
    const R = rings[k];
    const s = stations[k];
    const c: V3 = [at[0], at[1] + s[0], at[2] + s[3]];
    const n: V3 = [0, dir, 0];
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      if (dir < 0) m.tri(c, R[j].p, R[i].p, n, n, n);
      else m.tri(c, R[i].p, R[j].p, n, n, n);
    }
  }
}

/**
 * A flat surface with a little thickness (wing, tailplane): root at `root`
 * (leading edge y), extending to ±x (both sides when `mirror`), swept back,
 * with dihedral. Chords run back (−y) from the leading edge.
 */
function surface(
  m: MeshBuilder,
  o: { rootX: number; rootY: number; z: number; span: number; rootChord: number; tipChord: number; sweepDeg: number; dihedralDeg: number; thick: number; mirror?: boolean }
) {
  const sweep = Math.tan((o.sweepDeg * Math.PI) / 180) * o.span;
  const lift = Math.tan((o.dihedralDeg * Math.PI) / 180) * o.span;
  const sides = o.mirror === false ? [1] : [1, -1];
  for (const s of sides) {
    const x0 = s * o.rootX, x1 = s * (o.rootX + o.span);
    const le0: V3 = [x0, o.rootY, o.z], te0: V3 = [x0, o.rootY - o.rootChord, o.z];
    const le1: V3 = [x1, o.rootY - sweep, o.z + lift], te1: V3 = [x1, o.rootY - sweep - o.tipChord, o.z + lift];
    const up = (p: V3, h: number): V3 => [p[0], p[1], p[2] + h];
    const t0 = o.thick, t1 = o.thick * 0.5;
    m.center = [(x0 + x1) / 2, o.rootY - (sweep + (o.rootChord + o.tipChord) / 2) / 2, o.z + lift / 2];
    const A = up(le0, t0), B = up(le1, t1), C = up(te1, t1 * 0.4), D = up(te0, t0 * 0.4);
    const a = up(le0, -t0), b = up(le1, -t1), c = up(te1, -t1 * 0.4), d = up(te0, -t0 * 0.4);
    if (s > 0) {
      m.quad(A, D, C, B); // top
      m.quad(a, b, c, d); // bottom
      m.quad(A, B, b, a); // leading edge
      m.quad(D, d, c, C); // trailing edge
      m.quad(B, C, c, b); // tip
    } else {
      m.quad(A, B, C, D);
      m.quad(a, d, c, b);
      m.quad(A, a, b, B);
      m.quad(D, C, c, d);
      m.quad(B, b, c, C);
    }
  }
  m.center = null;
}

/** Vertical fin: from the root at the fuselage top (z0) up `height`, swept back. */
function fin(m: MeshBuilder, o: { rootY: number; z0: number; height: number; rootChord: number; tipChord: number; sweepDeg: number; thick: number }) {
  const sweep = Math.tan((o.sweepDeg * Math.PI) / 180) * o.height;
  const le0: [number, number] = [o.rootY, o.z0], te0: [number, number] = [o.rootY - o.rootChord, o.z0];
  const le1: [number, number] = [o.rootY - sweep, o.z0 + o.height], te1: [number, number] = [o.rootY - sweep - o.tipChord, o.z0 + o.height];
  const P = (q: [number, number], x: number): V3 => [x, q[0], q[1]];
  const t = o.thick;
  m.center = [0, o.rootY - (sweep + (o.rootChord + o.tipChord) / 2) / 2, o.z0 + o.height / 2];
  m.quad(P(le0, t), P(te0, t), P(te1, t * 0.5), P(le1, t * 0.5)); // right side
  m.quad(P(le0, -t), P(le1, -t * 0.5), P(te1, -t * 0.5), P(te0, -t)); // left side
  m.quad(P(le0, t), P(le1, t * 0.5), P(le1, -t * 0.5), P(le0, -t)); // leading edge
  m.quad(P(le1, t * 0.5), P(te1, t * 0.5), P(te1, -t * 0.5), P(le1, -t * 0.5)); // top
  m.quad(P(te0, t), P(te0, -t), P(te1, -t * 0.5), P(te1, t * 0.5)); // trailing edge
  m.center = null;
}

/** Engine nacelle: a short body of revolution with its front at `front`. */
function nacelle(m: MeshBuilder, at: V3, len: number, r: number, sides = 8) {
  loft(
    m,
    [
      [0, r * 0.82, r * 0.82, 0],
      [-len * 0.15, r, r, 0],
      [-len * 0.7, r * 0.92, r * 0.92, 0],
      [-len, r * 0.55, r * 0.55, 0],
    ],
    sides,
    at
  );
}

/** Propeller disc in front of a nacelle (a thin round plate). */
function propDisc(m: MeshBuilder, at: V3, r: number) {
  loft(m, [[0.004, r, r, 0], [-0.004, r, r, 0]], 10, at);
}

interface Spec {
  /** Fuselage half-width and half-height (half-length = 1). */
  r: number;
  rz?: number;
  /** Wing: semi-span, root/tip chords, sweep, dihedral, root leading-edge y, height of the wing (low −, high +). */
  span: number;
  rootChord: number;
  tipChord: number;
  sweep: number;
  dihedral: number;
  wingY: number;
  wingZ: number;
  /** Engines on the wings: their spanwise positions (fraction of the semi-span); rear engines on the fuselage. */
  wingEngines?: number[];
  rearEngines?: boolean;
  tailEngine?: boolean;
  engineR: number;
  engineLen: number;
  props?: boolean;
  tTail?: boolean;
  /** Upper deck hump (747) or a taller fuselage (A380 via rz). */
  hump?: boolean;
  finH: number;
  stabSpan: number;
}

const SPECS: Record<RadarIconGroup, Spec> = {
  // Twin Otter / Caravan class: straight high wing, two small props, fixed tail
  commuter: { r: 0.085, rz: 0.1, span: 1.22, rootChord: 0.22, tipChord: 0.2, sweep: 0, dihedral: 2, wingY: 0.38, wingZ: 0.09, wingEngines: [0.3], engineR: 0.045, engineLen: 0.28, props: true, finH: 0.32, stabSpan: 0.42 },
  // ATR / Dash 8: high wing, two turboprops, T-tail
  prop: { r: 0.094, span: 0.99, rootChord: 0.17, tipChord: 0.1, sweep: 2, dihedral: 2, wingY: 0.12, wingZ: 0.085, wingEngines: [0.3], engineR: 0.045, engineLen: 0.34, props: true, tTail: true, finH: 0.33, stabSpan: 0.3 },
  // CRJ / ERJ: low swept wing, engines on the rear fuselage, T-tail
  rj_tail: { r: 0.075, span: 0.72, rootChord: 0.2, tipChord: 0.07, sweep: 27, dihedral: 4, wingY: 0.08, wingZ: -0.05, rearEngines: true, engineR: 0.045, engineLen: 0.2, tTail: true, finH: 0.3, stabSpan: 0.26 },
  // E-jets / A220: low wing, two underwing engines
  small_jet: { r: 0.085, span: 0.84, rootChord: 0.24, tipChord: 0.08, sweep: 26, dihedral: 5, wingY: 0.1, wingZ: -0.05, wingEngines: [0.33], engineR: 0.05, engineLen: 0.17, finH: 0.3, stabSpan: 0.3 },
  // MD-80 / 717: low wing, rear engines, T-tail
  rear_jet: { r: 0.072, span: 0.72, rootChord: 0.22, tipChord: 0.07, sweep: 24, dihedral: 4, wingY: 0.05, wingZ: -0.05, rearEngines: true, engineR: 0.045, engineLen: 0.18, tTail: true, finH: 0.26, stabSpan: 0.26 },
  // A320 / 737
  medium_jet: { r: 0.105, span: 0.95, rootChord: 0.27, tipChord: 0.08, sweep: 25, dihedral: 5, wingY: 0.12, wingZ: -0.06, wingEngines: [0.34], engineR: 0.06, engineLen: 0.17, finH: 0.32, stabSpan: 0.33 },
  // 757: long narrow body
  long_narrow: { r: 0.083, span: 0.81, rootChord: 0.24, tipChord: 0.07, sweep: 25, dihedral: 5, wingY: 0.1, wingZ: -0.05, wingEngines: [0.34], engineR: 0.055, engineLen: 0.15, finH: 0.29, stabSpan: 0.3 },
  // A330 / 787 / 767
  large_jet: { r: 0.09, span: 0.95, rootChord: 0.27, tipChord: 0.07, sweep: 30, dihedral: 5, wingY: 0.12, wingZ: -0.05, wingEngines: [0.32], engineR: 0.065, engineLen: 0.16, finH: 0.28, stabSpan: 0.31 },
  // 777
  heavy_twin: { r: 0.084, span: 0.88, rootChord: 0.27, tipChord: 0.06, sweep: 31, dihedral: 5, wingY: 0.12, wingZ: -0.05, wingEngines: [0.32], engineR: 0.075, engineLen: 0.16, finH: 0.27, stabSpan: 0.3 },
  // MD-11 / DC-10: two wing engines and one at the base of the fin
  trijet: { r: 0.098, span: 0.84, rootChord: 0.27, tipChord: 0.07, sweep: 35, dihedral: 5, wingY: 0.12, wingZ: -0.06, wingEngines: [0.33], tailEngine: true, engineR: 0.062, engineLen: 0.15, finH: 0.26, stabSpan: 0.3 },
  // A340: four engines
  a340: { r: 0.083, span: 0.88, rootChord: 0.25, tipChord: 0.06, sweep: 30, dihedral: 5, wingY: 0.12, wingZ: -0.05, wingEngines: [0.3, 0.6], engineR: 0.05, engineLen: 0.14, finH: 0.25, stabSpan: 0.29 },
  // 747: four engines and the upper deck
  b747: { r: 0.092, span: 0.91, rootChord: 0.3, tipChord: 0.07, sweep: 37, dihedral: 6, wingY: 0.13, wingZ: -0.06, wingEngines: [0.3, 0.6], hump: true, engineR: 0.058, engineLen: 0.14, finH: 0.27, stabSpan: 0.3 },
  // A380: four engines, double deck
  a380: { r: 0.098, rz: 0.116, span: 1.1, rootChord: 0.34, tipChord: 0.08, sweep: 33, dihedral: 5, wingY: 0.14, wingZ: -0.07, wingEngines: [0.3, 0.55], engineR: 0.062, engineLen: 0.14, finH: 0.3, stabSpan: 0.36 },
  // Il-76 / An-124: high wing, four engines, T-tail
  high_quad: { r: 0.095, rz: 0.1, span: 1.05, rootChord: 0.26, tipChord: 0.08, sweep: 25, dihedral: -3, wingY: 0.12, wingZ: 0.08, wingEngines: [0.3, 0.55], engineR: 0.05, engineLen: 0.15, tTail: true, finH: 0.32, stabSpan: 0.32 },
};

function build(spec: Spec): Float32Array {
  const m = new MeshBuilder();
  const r = spec.r;
  const rz = spec.rz ?? r;
  // Fuselage: rounded nose, straight cabin, tail cone sweeping up
  loft(
    m,
    [
      [1, 0.001, 0.001, -rz * 0.25],
      [0.97, r * 0.42, rz * 0.4, -rz * 0.18],
      [0.9, r * 0.78, rz * 0.76, -rz * 0.08],
      [0.78, r * 0.97, rz * 0.97, 0],
      [0.5, r, rz, 0],
      [-0.45, r, rz, 0],
      [-0.7, r * 0.82, rz * 0.82, rz * 0.12],
      [-0.9, r * 0.45, rz * 0.45, rz * 0.45],
      [-1, r * 0.12, rz * 0.12, rz * 0.62],
    ],
    10
  );
  m.part = PART.body;
  if (spec.hump) loft(m, [[0.82, r * 0.3, rz * 0.2, rz * 0.75], [0.7, r * 0.62, rz * 0.45, rz * 0.62], [0.42, r * 0.62, rz * 0.42, rz * 0.62], [0.28, r * 0.25, rz * 0.12, rz * 0.82]], 8);
  // Wings
  m.part = PART.wing;
  surface(m, { rootX: r * 0.8, rootY: spec.wingY, z: spec.wingZ * (rz / r), span: spec.span - r * 0.8, rootChord: spec.rootChord, tipChord: spec.tipChord, sweepDeg: spec.sweep, dihedralDeg: spec.dihedral, thick: rz * 0.13 });
  // Tail: fin, then the tailplane at its foot or (T-tail) its top
  const finRoot = -0.62, finZ0 = rz * 0.55;
  m.part = PART.fin;
  fin(m, { rootY: finRoot, z0: finZ0, height: spec.finH, rootChord: 0.28, tipChord: 0.14, sweepDeg: 35, thick: r * 0.1 });
  const stabZ = spec.tTail ? finZ0 + spec.finH * 0.95 : rz * 0.25;
  const stabY = spec.tTail ? finRoot - Math.tan((35 * Math.PI) / 180) * spec.finH * 0.95 + 0.02 : -0.72;
  m.part = PART.wing;
  surface(m, { rootX: spec.tTail ? 0.005 : r * 0.5, rootY: stabY, z: stabZ, span: spec.stabSpan, rootChord: 0.15, tipChord: 0.07, sweepDeg: spec.tTail ? 25 : 30, dihedralDeg: spec.tTail ? 0 : 5, thick: rz * 0.06 });
  // Engines
  const sweepTan = Math.tan((spec.sweep * Math.PI) / 180);
  const dihedralTan = Math.tan((spec.dihedral * Math.PI) / 180);
  for (const f of spec.wingEngines ?? []) {
    const x = r * 0.8 + (spec.span - r * 0.8) * f;
    const yLe = spec.wingY - sweepTan * (x - r * 0.8);
    const zWing = spec.wingZ * (rz / r) + dihedralTan * (x - r * 0.8);
    // Jets hang under and ahead of the wing; turboprops sit on it with the prop in front
    const z = spec.props ? zWing : zWing - spec.engineR * 1.25;
    const front = spec.props ? yLe + spec.engineLen * 0.35 : yLe + spec.engineLen * 0.55;
    for (const s of [1, -1]) {
      m.part = PART.engine;
      nacelle(m, [s * x, front, z], spec.engineLen, spec.engineR);
      m.part = PART.prop;
      if (spec.props) propDisc(m, [s * x, front + 0.012, z], spec.engineR * 2.6);
    }
  }
  m.part = PART.engine;
  if (spec.rearEngines)
    for (const s of [1, -1]) nacelle(m, [s * (r + spec.engineR * 1.3), -0.38, rz * 0.35], spec.engineLen, spec.engineR);
  if (spec.tailEngine) nacelle(m, [0, -0.5, finZ0 + spec.engineR * 0.9], spec.engineLen * 1.2, spec.engineR);
  return new Float32Array(m.data);
}

const cache = new Map<RadarIconGroup, Float32Array>();

/** The shape for an icon group: interleaved [x, y, z, nx, ny, nz, part] per vertex, triangles. */
export function aircraftMesh(group: RadarIconGroup): Float32Array {
  let mesh = cache.get(group);
  if (!mesh) {
    mesh = build(SPECS[group] ?? SPECS.medium_jet);
    cache.set(group, mesh);
  }
  return mesh;
}

export const AIRCRAFT_GROUPS = Object.keys(SPECS) as RadarIconGroup[];

const bounds = new Map<RadarIconGroup, { minZ: number; maxZ: number }>();

/** Lowest and highest point of a group's shape (half-length units, centreline at 0). */
export function aircraftMeshBounds(group: RadarIconGroup): { minZ: number; maxZ: number } {
  let b = bounds.get(group);
  if (!b) {
    const d = aircraftMesh(group);
    let minZ = 0;
    let maxZ = 0;
    for (let i = 2; i < d.length; i += MESH_STRIDE) {
      minZ = Math.min(minZ, d[i]);
      maxZ = Math.max(maxZ, d[i]);
    }
    b = { minZ, maxZ };
    bounds.set(group, b);
  }
  return b;
}
