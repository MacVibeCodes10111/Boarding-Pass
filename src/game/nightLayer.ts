// ============================================================================
// DAY AND NIGHT (v3.6)
//
// A MapLibre custom layer over the satellite map: the night side of the Earth
// goes dark, with a soft line of dusk where the sun is setting, and the city
// lights come out only there. The sun sits where it really is at the game's
// time (faster when time runs faster), as on other flight maps.
//
// The lights are NASA's Earth at night (Black Marble, from GIBS): 64 tiles
// (zoom 3, about 2 MB) put straight into one world texture, so the shader can
// light each point by its own sun. Projection to the flat map or the globe is
// MapLibre's own (projectTileFor3D); the globe's far side is cut away for each
// pixel (cutting whole grid cells left a lit strip at the horizon).
//
// From the window it also draws the haze of distance: the light that's lost
// along the line from your eye to the ground, through air that thins with height
// (so there's little straight down and a lot towards the horizon).
// ============================================================================

const DEG = Math.PI / 180;
const LIGHTS_Z = 3;
const TILE_PX = 256;
const WORLD_PX = TILE_PX << LIGHTS_Z;
export const NIGHT_LIGHTS_TILE = (z: number, y: number, x: number) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`;

/** Where the sun is overhead at `ms` (UTC): latitude and longitude in degrees. */
export function subsolarPoint(ms: number): { lat: number; lng: number } {
  const d = ms / 86_400_000 - 10_957.5; // days since 2000-01-01 12:00 UTC
  const g = (357.529 + 0.98560028 * d) * DEG;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.00000036 * d) * DEG;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(L), Math.cos(L)) / DEG;
  const dec = Math.asin(Math.sin(eps) * Math.sin(L)) / DEG;
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24) * 15;
  const lng = ((((ra - gmst) % 360) + 540) % 360) - 180;
  return { lat: dec, lng };
}

const VERTEX = (prelude: string, define: string) => `#version 300 es
${prelude}
${define}
layout(location = 0) in vec2 a_merc;
uniform float u_wrap;     // which copy of the world (the flat map repeats east and west)
out vec2 v_merc;
void main() {
  v_merc = a_merc + vec2(u_wrap, 0.0);
  vec4 p = projectTileFor3D(v_merc, 0.0); // (the globe's far side is cut away pixel by pixel, below)
  // Never cut at the map's far distance: the grid's big cells were cut short of the
  // horizon there, leaving a strip of daylight ground. This keeps the near cut exactly
  // where it was (z + w is only scaled, so it's still 0 at the near plane) and keeps
  // everything in front inside the far one (z <= w for any w > 0).
  p.z = 0.5 * (p.z + p.w) - p.w;
  gl_Position = p;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_lights;
uniform vec3 u_sun;       // towards the sun (x: lng 0 on the equator, y: lng 90° east, z: north)
uniform float u_shade;    // how dark the night side goes
uniform float u_glow;     // the city lights' strength (they fade as you zoom in)
uniform float u_ready;    // the lights' picture has loaded
uniform float u_globe;    // drawn on the globe (1): hide its far side
uniform vec4 u_projection_clipping_plane;
uniform vec4 u_cam;       // haze: the eye (mercator x, y), its height (m), metres per mercator unit
uniform vec4 u_haze;      // haze colour and strength (0: none)
in vec2 v_merc;
out vec4 fragColor;
const float PI = 3.141592653589793;
void main() {
  if (u_globe > 0.5) {
    // The same place on MapLibre's sphere, and the same test it uses for the horizon
    float sx = v_merc.x * PI * 2.0 + PI;
    float t = exp(PI - v_merc.y * PI * 2.0);
    float t2 = t * t;
    vec3 sp = vec3(sin(sx) * (2.0 * t) / (t2 + 1.0), (t2 - 1.0) / (t2 + 1.0), cos(sx) * (2.0 * t) / (t2 + 1.0));
    if (dot(sp, u_projection_clipping_plane.xyz) + u_projection_clipping_plane.w < -0.0005) discard;
  }
  float lng = v_merc.x * 2.0 * PI - PI;
  float lat = atan(sinh(PI * (1.0 - 2.0 * v_merc.y)));
  vec3 p = vec3(cos(lat) * cos(lng), cos(lat) * sin(lng), sin(lat));
  float el = asin(clamp(dot(p, u_sun), -1.0, 1.0)) * 57.29578; // the sun's height here, degrees
  // Dusk from the sun at +2° to −10°; the lights come on from −2° to −9°
  float dark = smoothstep(2.0, -10.0, el) * u_shade;
  float on = smoothstep(-2.0, -9.0, el) * u_glow * u_ready;
  vec3 lights = texture(u_lights, vec2(fract(v_merc.x), v_merc.y)).rgb;
  // Warm sodium glow, a little stronger than the picture so it reads on screen
  vec3 glow = pow(lights, vec3(1.15)) * vec3(1.15, 1.0, 0.78) * 1.25 * on;
  // Haze: aerosols thin out with height (scale height ~1.3 km), so the air you look
  // through is the slant distance times how much of it is low down
  float h = 0.0;
  if (u_haze.a > 0.0) {
    vec2 dm = v_merc - u_cam.xy;
    dm.x -= floor(dm.x + 0.5); // the nearest way round the world
    float d = length(dm) * u_cam.w;
    float H = max(u_cam.z, 30.0);
    float thin = 1300.0 / H * (1.0 - exp(-H / 1300.0));
    float tau = sqrt(d * d + H * H) * thin / 22000.0; // ~22 km visibility at the ground
    h = (1.0 - exp(-tau)) * u_haze.a;
  }
  // Premultiplied: the map underneath darkens by 'dark', the lights add on top, then the haze
  fragColor = vec4(glow * (1.0 - h) + u_haze.rgb * h, 1.0 - (1.0 - dark) * (1.0 - h));
}`;

export interface NightLayerHandle {
  layer: any;
  /** The sun's place (UTC ms of the game's time), how dark, and the lights' strength. */
  set: (ms: number, shade: number, glow: number) => void;
  /** The haze of distance (from the window): its colour (#rrggbb) and strength, or null for none. */
  setHaze: (color: string | null, strength?: number) => void;
  /** Where the eye is for the haze (the window's camera), each frame. */
  setEye: (lng: number, lat: number, altM: number) => void;
  /** Night here (0 day … 1 night), from the sun's height at a point. */
  nightAt: (lat: number, lng: number) => number;
}

export function createNightLayer(id: string): NightLayerHandle {
  let gl2: WebGL2RenderingContext | null = null;
  let map: any = null;
  const programs = new Map<string, { prog: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }>();
  let vao: WebGLVertexArrayObject | null = null;
  let buf: WebGLBuffer | null = null;
  let count = 0;
  // From the window: a fine grid round the eye (the world grid's 400 km cells are flat
  // on the globe and sag under the horizon, leaving a strip of ground uncovered there)
  let near: { vao: WebGLVertexArrayObject; buf: WebGLBuffer; count: number; key: string } | null = null;
  let tex: WebGLTexture | null = null;
  let loaded = 0;
  let loading = false;
  let sun: [number, number, number] = [1, 0, 0];
  let shade = 0;
  let glow = 0;
  let haze: [number, number, number, number] = [0, 0, 0, 0];
  let eye: [number, number, number, number] | null = null; // mercator x, y, height (m), metres per unit
  let eyeLngLat: [number, number] | null = null;

  const compile = (gl: WebGL2RenderingContext, type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('night shader: ' + gl.getShaderInfoLog(sh));
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
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('night program: ' + gl.getProgramInfoLog(prog));
    const u: Record<string, WebGLUniformLocation | null> = {};
    for (const name of ['u_projection_fallback_matrix', 'u_projection_matrix', 'u_projection_tile_mercator_coords', 'u_projection_clipping_plane', 'u_projection_transition', 'u_lights', 'u_sun', 'u_shade', 'u_glow', 'u_ready', 'u_globe', 'u_cam', 'u_haze', 'u_wrap'])
      u[name] = gl.getUniformLocation(prog, name);
    p = { prog, u };
    programs.set(key, p);
    return p;
  };

  // The world as a grid (fine enough to bend round the globe), mercator 0…1
  const buildGrid = (gl: WebGL2RenderingContext) => {
    const NX = 96, NY = 64;
    const MAX_Y = 0.0005; // near the mercator edge (±85°), to the poles of the flat map
    const pts: number[] = [];
    const at = (i: number, j: number) => [i / NX, MAX_Y + (j / NY) * (1 - 2 * MAX_Y)];
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NX; i++) {
        const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
        pts.push(...a, ...b, ...c, ...a, ...c, ...d);
      }
    count = pts.length / 2;
    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  };

  const NEAR_DEG = 9, NEAR_N = 96;
  const nearGrid = (gl: WebGL2RenderingContext, lng: number, lat: number) => {
    const cl = Math.round(lng * 2) / 2, ca = Math.max(-75, Math.min(75, Math.round(lat * 2) / 2));
    const key = `${cl},${ca}`;
    if (near?.key === key) return near;
    const mx = (x: number) => (x + 180) / 360;
    const my = (y: number) => {
      const la = Math.max(-85, Math.min(85, y)) * DEG;
      return (1 - Math.log(Math.tan(Math.PI / 4 + la / 2)) / Math.PI) / 2;
    };
    const span = NEAR_DEG / Math.max(0.2, Math.cos(ca * DEG)); // as wide in km as it is tall
    const pts: number[] = [];
    const at = (i: number, j: number) => [mx(cl - span + (2 * span * i) / NEAR_N), my(ca - NEAR_DEG + (2 * NEAR_DEG * j) / NEAR_N)];
    for (let j = 0; j < NEAR_N; j++)
      for (let i = 0; i < NEAR_N; i++) {
        const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
        pts.push(...a, ...b, ...c, ...a, ...c, ...d);
      }
    const b = near?.buf ?? gl.createBuffer()!;
    const v = near?.vao ?? gl.createVertexArray()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.DYNAMIC_DRAW);
    gl.bindVertexArray(v);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    near = { vao: v, buf: b, count: pts.length / 2, key };
    return near;
  };

  // The lights: each tile goes straight into its place in the texture (no canvas copies: Safari)
  const loadLights = () => {
    if (loading || !gl2) return;
    loading = true;
    const gl = gl2;
    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, WORLD_PX, WORLD_PX, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); // (round the world)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const n = 1 << LIGHTS_Z;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (gl2 !== gl || !tex) return;
          try {
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, x * TILE_PX, y * TILE_PX, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.bindTexture(gl.TEXTURE_2D, null);
            loaded++;
            map?.triggerRepaint?.();
          } catch {
            /* a tile that can't be used: that patch stays dark */
          }
        };
        img.src = NIGHT_LIGHTS_TILE(LIGHTS_Z, y, x);
      }
  };

  const layer = {
    id,
    type: 'custom',
    renderingMode: '2d',
    onAdd(m: any, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      map = m;
      if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) return;
      if (gl2 === gl && vao) return;
      gl2 = gl;
      buildGrid(gl);
      loading = false;
      loaded = 0;
      if (glow > 0) loadLights();
    },
    onRemove() {
      const gl = gl2;
      if (gl) {
        for (const p of programs.values()) gl.deleteProgram(p.prog);
        if (vao) gl.deleteVertexArray(vao);
        if (buf) gl.deleteBuffer(buf);
        if (tex) gl.deleteTexture(tex);
        if (near) {
          gl.deleteVertexArray(near.vao);
          gl.deleteBuffer(near.buf);
        }
      }
      near = null;
      programs.clear();
      vao = buf = tex = null;
      gl2 = null;
      map = null;
      loading = false;
      loaded = 0;
    },
    render(gl: WebGL2RenderingContext, args: any) {
      if (!gl2 || !vao || (shade <= 0.001 && haze[3] <= 0)) return;
      const shaderData = args?.shaderData;
      const pd = args?.defaultProjectionData;
      if (!shaderData || !pd) return;
      let built;
      try {
        built = programFor(gl, shaderData);
      } catch (e) {
        console.warn('Night layer unavailable:', e);
        shade = 0;
        return;
      }
      const { prog, u } = built;
      gl.useProgram(prog);
      gl.uniformMatrix4fv(u.u_projection_fallback_matrix, false, pd.fallbackMatrix);
      gl.uniformMatrix4fv(u.u_projection_matrix, false, pd.mainMatrix);
      gl.uniform4f(u.u_projection_tile_mercator_coords, pd.tileMercatorCoords[0], pd.tileMercatorCoords[1], pd.tileMercatorCoords[2], pd.tileMercatorCoords[3]);
      gl.uniform4f(u.u_projection_clipping_plane, pd.clippingPlane[0], pd.clippingPlane[1], pd.clippingPlane[2], pd.clippingPlane[3]);
      gl.uniform1f(u.u_projection_transition, pd.projectionTransition);
      gl.uniform3f(u.u_sun, sun[0], sun[1], sun[2]);
      gl.uniform1f(u.u_shade, shade);
      gl.uniform1f(u.u_glow, glow);
      gl.uniform1f(u.u_ready, tex && loaded > 0 ? 1 : 0);
      const onGlobe = shaderData.variantName === 'globe' && pd.projectionTransition > 0.001;
      gl.uniform1f(u.u_globe, onGlobe ? 1 : 0);
      const hz = eye ? haze : [0, 0, 0, 0];
      const cam = eye ?? [0, 0, 0, 1];
      gl.uniform4f(u.u_cam, cam[0], cam[1], cam[2], cam[3]);
      gl.uniform4f(u.u_haze, hz[0], hz[1], hz[2], hz[3]);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(u.u_lights, 0);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const grid = eye && eyeLngLat ? nearGrid(gl, eyeLngLat[0], eyeLngLat[1]) : { vao, count };
      gl.bindVertexArray(grid.vao);
      // Every copy of the world the flat map shows (across the date line), as its tiles do;
      // the globe goes round by itself
      let w0 = 0, w1 = 0;
      if (!onGlobe) {
        try {
          const b = map?.getBounds?.();
          if (b) {
            w0 = Math.max(-4, Math.floor((b.getWest() + 180) / 360));
            w1 = Math.min(4, Math.floor((b.getEast() + 180) / 360));
          }
        } catch {
          /* just the one */
        }
        // (the fine grid round the eye can reach over the date line: one more each side)
        if (eye) {
          w0 = Math.min(w0, -1);
          w1 = Math.max(w1, 1);
        }
      }
      for (let w = w0; w <= w1; w++) {
        gl.uniform1f(u.u_wrap, w);
        gl.drawArrays(gl.TRIANGLES, 0, grid.count);
      }
      gl.bindVertexArray(null);
      gl.bindTexture(gl.TEXTURE_2D, null);
    },
  };

  return {
    layer,
    set(ms, s, g) {
      const p = subsolarPoint(ms);
      const la = p.lat * DEG, lo = p.lng * DEG;
      sun = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
      shade = s;
      glow = g;
      if (g > 0 && !loading) loadLights();
      map?.triggerRepaint?.();
    },
    setHaze(color, strength = 1) {
      haze = color ? [parseInt(color.slice(1, 3), 16) / 255, parseInt(color.slice(3, 5), 16) / 255, parseInt(color.slice(5, 7), 16) / 255, strength] : [0, 0, 0, 0];
      if (!color) eye = eyeLngLat = null;
      map?.triggerRepaint?.();
    },
    setEye(lng, lat, altM) {
      const la = Math.max(-85, Math.min(85, lat)) * DEG;
      eyeLngLat = [lng, lat];
      eye = [(lng + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + la / 2)) / Math.PI) / 2, altM, 40_075_016.686 * Math.cos(la)];
    },
    nightAt(lat, lng) {
      const la = lat * DEG, lo = lng * DEG;
      const s = Math.cos(la) * Math.cos(lo) * sun[0] + Math.cos(la) * Math.sin(lo) * sun[1] + Math.sin(la) * sun[2];
      const el = Math.asin(Math.max(-1, Math.min(1, s))) / DEG;
      return Math.max(0, Math.min(1, (2 - el) / 12));
    },
  };
}
