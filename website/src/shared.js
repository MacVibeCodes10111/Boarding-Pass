// Shared by the pass printer and the route planner: the game's airports and
// aircraft (public/data, made from the game's own data), great-circle maths,
// the map projection, colours and an airport search box.

// ------------------------------------------------------------ data (loaded once, when first needed)
let airportsP = null;
let aircraftP = null;
/** [{ iata, name, city, cc, lat, lon, rwy, large }] */
export const loadAirports = () =>
  (airportsP ??= fetch('/data/airports.json')
    .then((r) => r.json())
    .then((rows) => rows.map(([iata, name, city, cc, lat, lon, rwy, large]) => ({ iata, name, city, cc, lat, lon, rwy, large: !!large }))));
/** [{ name, family, range, cruise, rwy, seats, cargo, group, tons }] */
export const loadAircraft = () =>
  (aircraftP ??= fetch('/data/aircraft.json')
    .then((r) => r.json())
    .then((rows) => rows.map(([name, family, range, cruise, rwy, seats, cargo, group, tons]) => ({ name, family, range, cruise, rwy, seats, cargo: !!cargo, group, tons }))));

export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ------------------------------------------------------------ storage (a convenience; the page works without it)
export const store = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      return null;
    }
  },
  set(key, v) {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* private window or storage off */
    }
  },
};

// ------------------------------------------------------------ geography (same rules as the game)
const R = Math.PI / 180;
/** Great-circle distance in nautical miles */
export function distanceNm(a, b) {
  const dLat = (b.lat - a.lat) * R;
  const dLon = (b.lon - a.lon) * R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin(dLon / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function bearingDeg(a, b) {
  const y = Math.sin((b.lon - a.lon) * R) * Math.cos(b.lat * R);
  const x = Math.cos(a.lat * R) * Math.sin(b.lat * R) - Math.sin(a.lat * R) * Math.cos(b.lat * R) * Math.cos((b.lon - a.lon) * R);
  return (Math.atan2(y, x) / R + 360) % 360;
}
/** The game's scheduled block time: airborne time plus 20 minutes of taxiing, in 5-minute steps */
export const blockMin = (nm, kts) => Math.max(25, Math.ceil(Math.ceil((nm / Math.max(120, kts)) * 60 + 20) / 5) * 5);
export const hm = (min) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
/** Points along the great circle, [lon, lat] */
export function greatCircle(a, b, n = 96) {
  const v = (p) => [Math.cos(p.lat * R) * Math.cos(p.lon * R), Math.cos(p.lat * R) * Math.sin(p.lon * R), Math.sin(p.lat * R)];
  const p = v(a);
  const q = v(b);
  const d = Math.acos(Math.min(1, Math.max(-1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])));
  if (d < 1e-9) return [[a.lon, a.lat]];
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s1 = Math.sin((1 - t) * d) / Math.sin(d);
    const s2 = Math.sin(t * d) / Math.sin(d);
    const x = s1 * p[0] + s2 * q[0];
    const y = s1 * p[1] + s2 * q[1];
    const z = s1 * p[2] + s2 * q[2];
    out.push([Math.atan2(y, x) / R, Math.asin(z) / R]);
  }
  return out;
}
// The map: equirectangular, 1600 x 800 (as src/worldmap.svg)
export const px = (lon) => ((lon + 180) / 360) * 1600;
export const py = (lat) => ((90 - lat) / 180) * 800;

// ------------------------------------------------------------ colours
export const normHex = (h) => {
  const m = String(h).trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(m)) return '#' + [...m].map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/.test(m) ? '#' + m : null;
};
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export function luminance(h) {
  const [r, g, b] = rgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** Black or white text, whichever reads better on this colour */
export const inkOn = (h) => (contrast(h, '#ffffff') >= contrast(h, '#101010') ? '#ffffff' : '#101010');
export function hexToHsv(h) {
  const [r, g, b] = rgb(h).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let hue = 0;
  if (d) hue = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return [hue, max ? d / max : 0, max];
}
export function hsvToHex(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return '#' + [f(5), f(3), f(1)].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
}

/** The game's theme presets (keep in step with src/ui/theme.ts in the game) */
export const LIVERIES = [
  { id: 'night', name: 'Night shift', bg: '#0c1320', hl: '#f5a524' },
  { id: 'studio-black', name: 'Studio black', bg: '#000000', hl: '#ff4f1f' },
  { id: 'studio-white', name: 'Studio white', bg: '#ffffff', hl: '#2f54ff' },
  { id: 'tarmac', name: 'Tarmac', bg: '#16171a', hl: '#ffd21f' },
  { id: 'cockpit', name: 'Cockpit', bg: '#0b1210', hl: '#3ee08f' },
];
export const POPS = ['#ff3b30', '#ff4f1f', '#ff9500', '#ffd21f', '#34c759', '#00c7be', '#0a84ff', '#2f54ff', '#5e5ce6', '#bf5af2', '#ff2d92', '#ffffff', '#000000'];

// ------------------------------------------------------------ airport search box (ARIA combobox)
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function searchAirports(list, q, limit = 8) {
  const t = fold(q.trim());
  if (!t) return [];
  const scored = [];
  for (const a of list) {
    let s = -1;
    if (a.iata.toLowerCase() === t) s = 100;
    else if (fold(a.city).startsWith(t)) s = 60 + (a.large ? 10 : 0);
    else if (a.iata.toLowerCase().startsWith(t)) s = 50;
    else if (fold(a.name).includes(t)) s = 30 + (a.large ? 10 : 0);
    else if (fold(a.city).includes(t)) s = 20;
    if (s >= 0) scored.push([s, a]);
  }
  return scored
    .sort((x, y) => y[0] - x[0] || y[1].rwy - x[1].rwy)
    .slice(0, limit)
    .map((x) => x[1]);
}
export const airportLabel = (a) => `${a.city || a.name} (${a.iata})`;

/**
 * Turns a .combo field into an airport search: typing lists matches, arrows
 * move, Enter or a tap picks. onPick(airport) is called with the choice.
 */
export function airportCombo(root, onPick) {
  const input = root.querySelector('input');
  const list = root.querySelector('[role=listbox]');
  let items = [];
  let active = -1;
  let airports = [];
  loadAirports().then((a) => (airports = a));
  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const render = () => {
    list.innerHTML = items
      .map(
        (a, i) =>
          `<li id="${list.id}-${i}" role="option" aria-selected="${i === active}" data-i="${i}"><b>${esc(a.iata)}</b><span>${esc(a.city || a.name)}<small>${esc(a.name)}, ${esc(a.cc)}</small></span></li>`
      )
      .join('');
    list.hidden = !items.length;
    input.setAttribute('aria-expanded', String(!!items.length));
    if (active >= 0) input.setAttribute('aria-activedescendant', `${list.id}-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };
  const pick = (a) => {
    input.value = airportLabel(a);
    close();
    onPick(a);
  };
  input.addEventListener('focus', () => loadAirports());
  input.addEventListener('input', async () => {
    if (!airports.length) airports = await loadAirports();
    items = searchAirports(airports, input.value);
    active = items.length ? 0 : -1;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && items.length) {
      e.preventDefault();
      active = (active + 1) % items.length;
      render();
    } else if (e.key === 'ArrowUp' && items.length) {
      e.preventDefault();
      active = (active - 1 + items.length) % items.length;
      render();
    } else if (e.key === 'Enter') {
      if (!list.hidden && items[active]) {
        e.preventDefault();
        pick(items[active]);
      }
    } else if (e.key === 'Escape') close();
  });
  list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the box
  list.addEventListener('click', (e) => {
    const li = e.target.closest('[data-i]');
    if (li) pick(items[Number(li.dataset.i)]);
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  return { set: (a) => (input.value = a ? airportLabel(a) : ''), input };
}
