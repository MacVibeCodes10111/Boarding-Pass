// ============================================================================
// CLOUD SKY (v2.65)
//   A sky with soft clouds, drawn as vector art (SVG), behind the picture of
//   one of the player's aircraft. The tail number picks the sky, so each
//   aircraft keeps its own: clear noon, morning, sunset, blue hour, overcast
//   or high altitude, with its own clouds.
// ============================================================================

/** A small seeded random number generator (mulberry32). */
function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Sky {
  /** Top, middle and bottom of the sky. */
  sky: [string, string, string];
  /** Lit top and shaded bottom of the clouds. */
  lit: string;
  shade: string;
  /** A glow low in the sky (the sun), or none. */
  glow?: string;
  /** How much of the sky the clouds cover, 0 to 1. */
  cover: number;
}

const SKIES: Sky[] = [
  { sky: ['#2f6fc4', '#5d9de0', '#a9d2f3'], lit: '#ffffff', shade: '#b9cde3', cover: 0.45 }, // clear noon
  { sky: ['#4c86c9', '#9cc0e4', '#f6dcc0'], lit: '#fff8f0', shade: '#c9b6b4', glow: '#ffe2b0', cover: 0.5 }, // morning
  { sky: ['#283a6e', '#c0607a', '#f6a86a'], lit: '#ffd2a8', shade: '#6d4a72', glow: '#ffc27a', cover: 0.55 }, // sunset
  { sky: ['#0e1a3a', '#25386e', '#5a6ea8'], lit: '#93a6d6', shade: '#2b3766', glow: '#7f93d8', cover: 0.5 }, // blue hour
  { sky: ['#7387a0', '#9eafc2', '#cdd7e2'], lit: '#f2f5f8', shade: '#8f9eb1', cover: 0.85 }, // overcast
  { sky: ['#0a3a8c', '#2f72cf', '#7fb6ee'], lit: '#ffffff', shade: '#a6c2e6', cover: 0.3 }, // high altitude
];

const W = 400;
const H = 170;
const n = (v: number) => Math.round(v * 10) / 10;

/** One cumulus cloud: overlapping puffs on a flat base. */
function cloud(r: () => number, cx: number, base: number, size: number): string {
  const puffs: string[] = [];
  const count = 6 + Math.floor(r() * 5);
  const width = size * (2.2 + r() * 1.6);
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const x = cx - width / 2 + t * width;
    // tallest in the middle
    const rad = size * (0.3 + 0.7 * Math.sin(Math.PI * t) * (0.6 + r() * 0.6));
    puffs.push(`<circle cx="${n(x + (r() - 0.5) * size * 0.4)}" cy="${n(base - rad * (0.45 + r() * 0.25))}" r="${n(rad)}"/>`);
  }
  puffs.push(`<ellipse cx="${n(cx)}" cy="${n(base - size * 0.12)}" rx="${n(width / 2 + size * 0.35)}" ry="${n(size * 0.3)}"/>`);
  return puffs.join('');
}

/** The SVG of a sky for this seed (a tail number). */
export function cloudSkySvg(seed: string): string {
  const r = rng(seed || 'sky');
  const s = SKIES[Math.floor(r() * SKIES.length)];
  const glowX = n(40 + r() * 320);
  const layers: string[] = [];
  const grads: string[] = [];
  // far, middle and near clouds: higher, smaller and softer the further away
  const bands = [
    { y: 0.42, size: 9, blur: 3.4, op: 0.5, k: 7 },
    { y: 0.66, size: 15, blur: 2.6, op: 0.75, k: 5 },
    { y: 0.98, size: 26, blur: 1.8, op: 0.92, k: 4 },
  ];
  bands.forEach((b, li) => {
    const k = Math.max(1, Math.round(b.k * (0.35 + s.cover)));
    const parts: string[] = [];
    for (let i = 0; i < k; i++) {
      const cx = ((i + 0.2 + r() * 0.6) / k) * (W + 80) - 40;
      const base = H * b.y + (r() - 0.5) * H * 0.12;
      parts.push(cloud(r, cx, base, b.size * (0.7 + r() * 0.7)));
    }
    grads.push(`<linearGradient id="c${li}" gradientUnits="userSpaceOnUse" x1="0" y1="${n(H * b.y - b.size * 2.4)}" x2="0" y2="${n(H * b.y + b.size * 0.2)}"><stop offset="0" stop-color="${s.lit}"/><stop offset=".55" stop-color="${s.lit}"/><stop offset="1" stop-color="${s.shade}"/></linearGradient>`);
    layers.push(`<g filter="url(#b${li})" fill="url(#c${li})" opacity="${b.op}">${parts.join('')}</g>`);
  });
  // thin high streaks
  const streaks: string[] = [];
  const sk = 2 + Math.floor(r() * 3);
  for (let i = 0; i < sk; i++) {
    streaks.push(`<ellipse cx="${n(r() * W)}" cy="${n(H * (0.08 + r() * 0.25))}" rx="${n(60 + r() * 90)}" ry="${n(1.5 + r() * 2.5)}" transform="rotate(${n((r() - 0.5) * 6)})"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.sky[0]}"/><stop offset=".55" stop-color="${s.sky[1]}"/><stop offset="1" stop-color="${s.sky[2]}"/></linearGradient>
${grads.join('')}
${s.glow ? `<radialGradient id="g" cx="${glowX}" cy="${H}" r="${H * 1.1}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${s.glow}" stop-opacity=".85"/><stop offset="1" stop-color="${s.glow}" stop-opacity="0"/></radialGradient>` : ''}
<filter id="b0" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="${bands[0].blur}"/></filter>
<filter id="b1" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="${bands[1].blur}"/></filter>
<filter id="b2" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="${bands[2].blur}"/></filter>
<filter id="bs" x="-10%" y="-200%" width="120%" height="500%"><feGaussianBlur stdDeviation="1.6"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#s)"/>
${s.glow ? `<rect width="${W}" height="${H}" fill="url(#g)"/>` : ''}
<g fill="${s.lit}" opacity=".45" filter="url(#bs)">${streaks.join('')}</g>
${layers.join('\n')}
</svg>`;
}

const urls = new Map<string, string>();

/** A CSS background-image value with the sky for this seed. */
export function cloudSkyCss(seed: string): string {
  let u = urls.get(seed);
  if (!u) {
    u = `url("data:image/svg+xml,${encodeURIComponent(cloudSkySvg(seed))}")`;
    if (urls.size > 300) urls.clear();
    urls.set(seed, u);
  }
  return u;
}
