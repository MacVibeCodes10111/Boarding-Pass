// ============================================================================
// DETAILED 3D AIRCRAFT LAYER (v2.46+)
//
// A MapLibre custom layer that draws the aircraft shapes of aircraftMeshes.ts
// with instancing: each icon group's shape is uploaded once, and every redraw
// only updates a few numbers per aircraft (where, how high, heading, nose up
// or down, size, colour). Projection to the flat map or the globe is done by
// MapLibre's own shader code (projectTileFor3D), so the aircraft sit where
// the rest of the map puts things, in both views.
//
// Needs WebGL2 (instanced drawing). Where it is missing the layer reports
// `supported = false` and the map keeps the simple extruded shapes.
// ============================================================================
import { AIRCRAFT_GROUPS, MESH_STRIDE, aircraftMesh } from './aircraftMeshes';
import type { RadarIconGroup } from './types';

export interface Aircraft3d {
  lng: number;
  lat: number;
  /** Height of the fuselage centreline above the ground, in metres (already exaggerated). */
  elevM: number;
  /** Half the drawn length, in metres. */
  halfLenM: number;
  headingDeg: number;
  /** Nose up (+) or down (−). */
  pitchDeg: number;
  /** 0..1 colour. */
  rgb: [number, number, number];
  /** Vertical squash (1 = true proportions). */
  vScale: number;
}

/** Floats per aircraft in the instance buffer. */
const STRIDE = 12;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
const DEG = Math.PI / 180;

const VERTEX = (prelude: string, define: string) => `#version 300 es
${prelude}
${define}
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
layout(location = 5) in float a_part;   // body, wing, fin, engine, propeller
layout(location = 2) in vec4 a_place;   // mercator x, y, centre height (m), half length (m)
layout(location = 3) in vec4 a_turn;    // heading, pitch (rad), mercator units per metre, vertical scale
layout(location = 4) in vec4 a_color;   // rgb, unused
out vec3 v_normal;
out vec3 v_color;
void main() {
  vec3 p = a_pos;
  // Squashed flatter when zoomed far out: the normals follow
  vec3 n = normalize(vec3(a_normal.xy, a_normal.z / max(a_turn.w, 0.05)));
  p.z *= a_turn.w;
  // Nose up/down about the wing axis (x), then heading about the vertical (z)
  float cp = cos(a_turn.y), sp = sin(a_turn.y);
  p = vec3(p.x, p.y * cp - p.z * sp, p.y * sp + p.z * cp);
  n = vec3(n.x, n.y * cp - n.z * sp, n.y * sp + n.z * cp);
  float ch = cos(a_turn.x), sh = sin(a_turn.x);
  // Heading is clockwise from north: x (right wing) and y (nose) to east and north
  vec3 enu = vec3(p.x * ch + p.y * sh, -p.x * sh + p.y * ch, p.z) * a_place.w;
  v_normal = vec3(n.x * ch + n.y * sh, -n.x * sh + n.y * ch, n.z);
  // Paint: the body and fin in the aircraft's colour, wings grey with a hint of it, engines dark grey, propellers darker still
  vec3 c = a_color.rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 wing = mix(c, vec3(0.6), 0.85);
  vec3 engine = mix(vec3(0.3), c, 0.2);
  vec3 prop = vec3(0.12);
  int part = int(a_part + 0.5);
  v_color = part == 1 ? wing : part == 3 ? engine : part == 4 ? prop : part == 2 ? c * (lum > 0.6 ? 0.82 : 1.0) : c;
  vec2 merc = a_place.xy + vec2(enu.x, -enu.y) * a_turn.z;
  gl_Position = projectTileFor3D(merc, a_place.z + enu.z);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
uniform vec3 u_eye;     // towards the camera (east, north, up)
in vec3 v_normal;
in vec3 v_color;
out vec4 fragColor;
void main() {
  vec3 n = normalize(v_normal);
  // Both sides of thin parts are drawn: light the side facing the camera
  if (dot(n, u_eye) < 0.0) n = -n;
  vec3 l = normalize(vec3(-0.45, 0.35, 0.72));   // sun from the north-west, fairly high
  float d = max(dot(n, l), 0.0);
  // Sky light from above, darker from below (bellies and wing undersides)
  float sky = mix(0.2, 0.42, n.z * 0.5 + 0.5);
  vec3 col = v_color * (sky + 0.56 * d);
  // Glossy highlight and darker edges, so the shape reads even from straight above
  vec3 h = normalize(l + u_eye);
  col += vec3(0.32) * pow(max(dot(n, h), 0.0), 28.0);
  float edge = 1.0 - abs(dot(n, u_eye));
  col *= 1.0 - 0.38 * edge * edge;
  fragColor = vec4(min(col, vec3(1.0)), 1.0);
}`;

interface GroupGl {
  mesh: WebGLBuffer;
  count: number;
}
interface SetGl {
  vao: Map<RadarIconGroup, WebGLVertexArrayObject>;
  inst: Map<RadarIconGroup, { buf: WebGLBuffer; n: number }>;
}

export interface AircraftLayerHandle {
  layer: any;
  /** False until added to a map with WebGL2 (or when that is missing). */
  supported: () => boolean;
  /** Replaces one set of aircraft (your fleet or other airlines') and redraws. */
  set: (which: 'player' | 'ai', aircraft: Map<RadarIconGroup, Aircraft3d[]>) => void;
  clear: () => void;
}

export function createAircraftLayer(id = 'aircraft-3d'): AircraftLayerHandle {
  let gl2: WebGL2RenderingContext | null = null;
  let map: any = null;
  let ok = false;
  const programs = new Map<string, { prog: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }>();
  const groups = new Map<RadarIconGroup, GroupGl>();
  const sets: Record<'player' | 'ai', SetGl> = { player: { vao: new Map(), inst: new Map() }, ai: { vao: new Map(), inst: new Map() } };
  const pending: Partial<Record<'player' | 'ai', Map<RadarIconGroup, Aircraft3d[]>>> = {};

  const compile = (gl: WebGL2RenderingContext, type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('aircraft shader: ' + gl.getShaderInfoLog(sh));
    return sh;
  };
  const programFor = (gl: WebGL2RenderingContext, shaderData: any) => {
    const key = shaderData?.variantName ?? 'default';
    let p = programs.get(key);
    if (p) return p;
    const prog = gl.createProgram()!;
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX(shaderData.vertexShaderPrelude, shaderData.define));
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('aircraft program: ' + gl.getProgramInfoLog(prog));
    const u: Record<string, WebGLUniformLocation | null> = {};
    for (const name of ['u_projection_fallback_matrix', 'u_projection_matrix', 'u_projection_tile_mercator_coords', 'u_projection_clipping_plane', 'u_projection_transition', 'u_eye'])
      u[name] = gl.getUniformLocation(prog, name);
    p = { prog, u };
    programs.set(key, p);
    return p;
  };

  const vaoFor = (gl: WebGL2RenderingContext, which: 'player' | 'ai', group: RadarIconGroup) => {
    const s = sets[which];
    let vao = s.vao.get(group);
    const inst = s.inst.get(group);
    const g = groups.get(group);
    if (!inst || !g) return null;
    if (vao) return vao;
    vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.mesh);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, MESH_STRIDE * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, MESH_STRIDE * 4, 12);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 1, gl.FLOAT, false, MESH_STRIDE * 4, 24);
    gl.bindBuffer(gl.ARRAY_BUFFER, inst.buf);
    for (let a = 0; a < 3; a++) {
      gl.enableVertexAttribArray(2 + a);
      gl.vertexAttribPointer(2 + a, 4, gl.FLOAT, false, STRIDE * 4, a * 16);
      gl.vertexAttribDivisor(2 + a, 1);
    }
    gl.bindVertexArray(null);
    s.vao.set(group, vao);
    return vao;
  };

  const upload = (which: 'player' | 'ai', aircraft: Map<RadarIconGroup, Aircraft3d[]>) => {
    const gl = gl2!;
    const s = sets[which];
    for (const g of AIRCRAFT_GROUPS) {
      const list = aircraft.get(g) ?? [];
      let inst = s.inst.get(g);
      if (!list.length) {
        if (inst) inst.n = 0;
        continue;
      }
      const arr = new Float32Array(list.length * STRIDE);
      list.forEach((a, i) => {
        const o = i * STRIDE;
        const lat = Math.max(-85, Math.min(85, a.lat));
        arr[o] = (a.lng + 180) / 360;
        arr[o + 1] = (1 - Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2)) / Math.PI) / 2;
        arr[o + 2] = a.elevM;
        arr[o + 3] = a.halfLenM;
        arr[o + 4] = a.headingDeg * DEG;
        arr[o + 5] = a.pitchDeg * DEG;
        arr[o + 6] = 1 / (EARTH_CIRCUMFERENCE_M * Math.max(0.02, Math.cos(lat * DEG)));
        arr[o + 7] = a.vScale;
        arr[o + 8] = a.rgb[0];
        arr[o + 9] = a.rgb[1];
        arr[o + 10] = a.rgb[2];
        arr[o + 11] = 1;
      });
      if (!inst) {
        inst = { buf: gl.createBuffer()!, n: 0 };
        s.inst.set(g, inst);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, inst.buf);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
      inst.n = list.length;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  };

  const counts = () => {
    const n = (w: 'player' | 'ai') => [...sets[w].inst.values()].reduce((a, i) => a + i.n, 0);
    return { player: n('player'), ai: n('ai'), supported: ok };
  };
  const layer = {
    id,
    /** Aircraft drawn (for tests and the debug console). */
    counts,
    type: 'custom',
    renderingMode: '3d',
    onAdd(m: any, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      map = m;
      ok = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
      if (!ok) return;
      // Added again after a basemap change on the same WebGL context: keep the shapes
      if (gl2 === gl && groups.size) return;
      gl2 = gl as WebGL2RenderingContext;
      for (const g of AIRCRAFT_GROUPS) {
        const data = aircraftMesh(g);
        const buf = gl2.createBuffer()!;
        gl2.bindBuffer(gl2.ARRAY_BUFFER, buf);
        gl2.bufferData(gl2.ARRAY_BUFFER, data, gl2.STATIC_DRAW);
        groups.set(g, { mesh: buf, count: data.length / MESH_STRIDE });
      }
      gl2.bindBuffer(gl2.ARRAY_BUFFER, null);
      for (const which of ['player', 'ai'] as const) {
        const p = pending[which];
        if (p) upload(which, p);
        delete pending[which];
      }
    },
    onRemove() {
      // Taken off the map (a basemap change): free what we put on the GPU
      const gl = gl2;
      if (gl) {
        for (const p of programs.values()) gl.deleteProgram(p.prog);
        for (const g of groups.values()) gl.deleteBuffer(g.mesh);
        for (const s of Object.values(sets)) {
          for (const v of s.vao.values()) gl.deleteVertexArray(v);
          for (const i of s.inst.values()) gl.deleteBuffer(i.buf);
        }
      }
      programs.clear();
      groups.clear();
      sets.player = { vao: new Map(), inst: new Map() };
      sets.ai = { vao: new Map(), inst: new Map() };
      gl2 = null;
      map = null;
      ok = false;
    },
    render(gl: WebGL2RenderingContext, args: any) {
      if (!ok || !gl2) return;
      let any = false;
      for (const s of Object.values(sets)) for (const i of s.inst.values()) if (i.n) any = true;
      if (!any) return;
      const shaderData = args?.shaderData;
      const pd = args?.defaultProjectionData;
      if (!shaderData || !pd) return;
      let built;
      try {
        built = programFor(gl, shaderData);
      } catch (e) {
        // Can't draw them here: the map goes back to the simple shapes
        console.warn('Detailed aircraft unavailable:', e);
        ok = false;
        return;
      }
      const { prog, u } = built;
      gl.useProgram(prog);
      // Heights go in as metres. The globe's own matrix takes metres; the flat
      // map's matrix (and the one used while the globe turns into the flat map)
      // takes world units, so scale its height axis the way the map scales
      // extrusions (metres at the centre of the view).
      const lat = Math.max(-85, Math.min(85, map?.getCenter?.().lat ?? 0));
      const k = 1 / (EARTH_CIRCUMFERENCE_M * Math.cos(lat * DEG));
      const flat = scaleZ(pd.fallbackMatrix, k);
      gl.uniformMatrix4fv(u.u_projection_fallback_matrix, false, flat);
      gl.uniformMatrix4fv(u.u_projection_matrix, false, shaderData.variantName === 'globe' ? pd.mainMatrix : scaleZ(pd.mainMatrix, k));
      gl.uniform4f(u.u_projection_tile_mercator_coords, pd.tileMercatorCoords[0], pd.tileMercatorCoords[1], pd.tileMercatorCoords[2], pd.tileMercatorCoords[3]);
      gl.uniform4f(u.u_projection_clipping_plane, pd.clippingPlane[0], pd.clippingPlane[1], pd.clippingPlane[2], pd.clippingPlane[3]);
      gl.uniform1f(u.u_projection_transition, pd.projectionTransition);
      // Direction towards the camera, for the highlights and edges
      const b = (map?.getBearing?.() ?? 0) * DEG;
      const pt = (map?.getPitch?.() ?? 0) * DEG;
      gl.uniform3f(u.u_eye, -Math.sin(b) * Math.sin(pt), -Math.cos(b) * Math.sin(pt), Math.cos(pt));
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      for (const which of ['ai', 'player'] as const)
        for (const [g, inst] of sets[which].inst) {
          if (!inst.n) continue;
          const vao = vaoFor(gl, which, g);
          const mesh = groups.get(g);
          if (!vao || !mesh) continue;
          gl.bindVertexArray(vao);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, mesh.count, inst.n);
        }
      gl.bindVertexArray(null);
    },
  };

  return {
    layer,
    supported: () => ok,
    set(which, aircraft) {
      if (!gl2) {
        pending[which] = aircraft;
        return;
      }
      upload(which, aircraft);
      map?.triggerRepaint?.();
    },
    clear() {
      for (const which of ['player', 'ai'] as const) {
        delete pending[which];
        for (const i of sets[which].inst.values()) i.n = 0;
      }
      map?.triggerRepaint?.();
    },
  };
}

/** A copy of a 4×4 column-major matrix with its height (z) input scaled by k. */
function scaleZ(m: ArrayLike<number>, k: number): Float32Array {
  const out = Float32Array.from(m as ArrayLike<number>);
  for (let i = 8; i < 12; i++) out[i] *= k;
  return out;
}

/** '#rrggbb' to 0..1 colour. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})/i.exec(hex.trim());
  if (!m) return [0.8, 0.8, 0.85];
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
