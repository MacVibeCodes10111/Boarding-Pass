// Plan a route: two airports, the great circle between them on the map, and
// which of the game's aircraft can fly it (range and runway, as in the game).
import { airportCombo, bearingDeg, blockMin, distanceNm, esc, greatCircle, hm, loadAircraft, loadAirports, px, py, reduceMotion } from './shared.js';

const NS = 'http://www.w3.org/2000/svg';
const fmt = (n) => Math.round(n).toLocaleString('en');
const compass = (d) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(d / 45) % 8];

let from = null;
let to = null;
let svg = null;
let layer = null;
let viewBox = [0, 0, 1600, 800];
let anim = 0;

// ------------------------------------------------------------ the map (the hero's airport dots, copied)
function buildMap() {
  const host = document.querySelector('[data-route-map]');
  const src = document.querySelector('.worldmap svg .ap');
  if (!host) return;
  svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', viewBox.join(' '));
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  if (src) svg.appendChild(src.cloneNode(true));
  layer = document.createElementNS(NS, 'g');
  layer.setAttribute('class', 'route-layer');
  svg.appendChild(layer);
  host.appendChild(svg);
  window.addEventListener('resize', () => layer.childNodes.length && scaleMarks());
}

/** Labels, end points and the plane keep their size on screen at any zoom */
function scaleMarks() {
  const k = viewBox[2] / Math.max(1, svg.clientWidth || 800);
  layer.querySelectorAll('.route-end circle').forEach((c) => c.setAttribute('r', String(5 * k)));
  layer.querySelectorAll('.route-end text').forEach((t) => {
    t.setAttribute('font-size', String(13 * k));
    t.setAttribute('stroke-width', String(4 * k));
    t.setAttribute('y', String(Number(t.dataset.y) - 11 * k));
  });
  layer.querySelectorAll('.route-plane > g').forEach((g) => g.setAttribute('transform', `scale(${1.3 * k})`));
}

/** Glide the view to a box (keeping the 2:1 shape) */
function zoomTo([x, y, w, h]) {
  const target = [x, y, w, h];
  cancelAnimationFrame(anim);
  if (reduceMotion()) {
    viewBox = target;
    svg.setAttribute('viewBox', viewBox.join(' '));
    scaleMarks();
    return;
  }
  const startVb = [...viewBox];
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 650);
    const e = 1 - (1 - k) ** 3;
    viewBox = startVb.map((v, i) => v + (target[i] - v) * e);
    svg.setAttribute('viewBox', viewBox.map((v) => v.toFixed(1)).join(' '));
    scaleMarks();
    if (k < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}

/** Path pieces of the great circle, split where it crosses the edge of the map */
function arcPieces(a, b) {
  const pts = greatCircle(a, b).map(([lon, lat]) => [px(lon), py(lat)]);
  const pieces = [[pts[0]]];
  for (let i = 1; i < pts.length; i++) {
    if (Math.abs(pts[i][0] - pts[i - 1][0]) > 800) pieces.push([]);
    pieces[pieces.length - 1].push(pts[i]);
  }
  return pieces.filter((p) => p.length > 1);
}

function drawRoute(legs) {
  layer.innerHTML = '';
  const all = [];
  legs.forEach(([a, b], li) => {
    const pieces = arcPieces(a, b);
    pieces.forEach((pts, pi) => {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L'));
      p.setAttribute('class', 'route-arc');
      if (pieces.length === 1) p.id = `route-arc-${li}`;
      layer.appendChild(p);
      if (!reduceMotion()) {
        const len = p.getTotalLength();
        p.style.strokeDasharray = `${len}`;
        p.style.strokeDashoffset = `${len}`;
        p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 900, delay: li * 500 + pi * 200, easing: 'ease-out', fill: 'forwards' });
      }
      all.push(...pts);
    });
    // A plane flies the leg once
    if (pieces.length === 1 && !reduceMotion()) {
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'route-plane');
      g.innerHTML = `<g><path d="M7 0 L-6 -5.5 L-3.5 0 L-6 5.5 Z"/></g><animateMotion dur="2.6s" begin="${0.9 + li * 0.5}s" fill="freeze" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines=".4 0 .2 1"><mpath href="#route-arc-${li}"/></animateMotion>`;
      g.style.opacity = '0';
      g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 900 + li * 500, fill: 'forwards' });
      layer.appendChild(g);
    }
  });
  const stops = [legs[0][0], ...legs.map((l) => l[1])];
  stops.forEach((a, i) => {
    const x = px(a.lon);
    const y = py(a.lat);
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'route-end');
    g.innerHTML = `<circle cx="${x}" cy="${y}" r="4.5"/><text x="${x}" y="${y - 10}" data-y="${y}" text-anchor="middle">${esc(a.iata)}</text>`;
    if (i > 0 && i < stops.length - 1) g.classList.add('is-stop');
    layer.appendChild(g);
  });
  // Fit the view: whole world for routes over the edge, otherwise the route with room around it
  const wraps = legs.some(([a, b]) => arcPieces(a, b).length > 1);
  scaleMarks();
  if (wraps) return zoomTo([0, 0, 1600, 800]);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  let w = Math.max(...xs) - Math.min(...xs);
  let h = Math.max(...ys) - Math.min(...ys);
  w = Math.max(w * 1.5, h * 3, 260);
  h = w / 2;
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  w = Math.min(w, 1600);
  h = Math.min(h, 800);
  zoomTo([Math.min(1600 - w, Math.max(0, cx - w / 2)), Math.min(800 - h, Math.max(0, cy - h / 2)), w, h]);
}

// ------------------------------------------------------------ which aircraft can fly it
const canFly = (m, nm, a, b) => m.range >= nm && m.rwy <= Math.min(a.rwy, b.rwy);

// Where airlines really stop on the longest trips; any big airport if none of these works
const HUBS = new Set('DXB DOH AUH IST SIN HKG BKK KUL ICN NRT HND PVG PEK CAN TPE MNL DEL BOM LHR FRA CDG AMS MAD ZRH MUC FCO JFK LAX SFO ORD ATL DFW MIA YVR YYZ HNL MEX GRU SCL EZE BOG LIM PTY JNB ADD NBO CAI SYD MEL PER AKL'.split(' '));

/** A stop that makes a too-long route possible: a hub that keeps the longer leg shortest */
function bestStop(a, b, airports, maxRange) {
  return pickStop(a, b, airports.filter((s) => HUBS.has(s.iata)), maxRange) ?? pickStop(a, b, airports.filter((s) => s.large), maxRange);
}
function pickStop(a, b, candidates, maxRange) {
  let best = null;
  for (const s of candidates) {
    if (s.iata === a.iata || s.iata === b.iata) continue;
    const l1 = distanceNm(a, s);
    const l2 = distanceNm(s, b);
    const worst = Math.max(l1, l2);
    if (worst > maxRange) continue;
    const score = l1 + l2 + worst * 0.15;
    if (!best || score < best.score) best = { s, l1, l2, score };
  }
  return best;
}

async function update() {
  const out = document.querySelector('[data-readout]');
  const fit = document.querySelector('[data-fleet-fit]');
  if (!from || !to) return;
  if (from.iata === to.iata) {
    out.innerHTML = '<p class="readout-empty">That is the same airport. Pick somewhere to fly to.</p>';
    fit.innerHTML = '';
    layer.innerHTML = '';
    return;
  }
  const [fleet, airports] = await Promise.all([loadAircraft(), loadAirports()]);
  const nm = distanceNm(from, to);
  const hdg = bearingDeg(from, to);
  const able = fleet.filter((m) => canFly(m, nm, from, to)).sort((x, y) => x.range - y.range || x.seats - y.seats);
  const pax = able.filter((m) => !m.cargo);
  const shortRwy = from.rwy <= to.rwy ? from : to;
  const fastest = able.reduce((f, m) => (!f || m.cruise > f.cruise ? m : f), null);
  const maxRange = Math.max(...fleet.map((m) => m.range));
  const row = (k, v) => `<div class="ro-row"><dt>${k}</dt><dd>${v}</dd></div>`;
  let html = `<div class="ro-codes"><span>${esc(from.iata)}</span><i aria-hidden="true"></i><span>${esc(to.iata)}</span></div>
    <div class="ro-places">${esc(from.city || from.name)} to ${esc(to.city || to.name)}</div>
    <dl class="ro-list">
      ${row('Distance', `${fmt(nm)} nm <small>${fmt(nm * 1.852)} km</small>`)}
      ${row('Heading out', `${String(Math.round(hdg)).padStart(3, '0')}° <small>${compass(hdg)}</small>`)}
      ${fastest ? row('Block time', `${hm(blockMin(nm, fastest.cruise))} <small>${esc(fastest.name)}</small>`) : ''}
      ${row('Shortest runway', `${fmt(shortRwy.rwy)} ft <small>${esc(shortRwy.iata)}</small>`)}
    </dl>`;
  let legs = [[from, to]];
  if (able.length) {
    html += `<p class="ro-verdict is-yes"><b>${able.length} of ${fleet.length}</b> aircraft types can fly it nonstop${pax.length < able.length ? `, ${pax.length} of them passenger aircraft` : ''}.</p>`;
  } else {
    const tooFar = nm > maxRange;
    const stop = tooFar ? bestStop(from, to, airports, maxRange) : null;
    if (stop) {
      legs = [[from, stop.s], [stop.s, to]];
      html += `<p class="ro-verdict is-no">Too far to fly nonstop: the longest range in the game is ${fmt(maxRange)} nm. With a stop at <b>${esc(stop.s.city || stop.s.name)} (${esc(stop.s.iata)})</b> it's ${fmt(stop.l1)} nm and ${fmt(stop.l2)} nm.</p>`;
    } else if (tooFar) {
      html += `<p class="ro-verdict is-no">Too far to fly nonstop: the longest range in the game is ${fmt(maxRange)} nm.</p>`;
    } else {
      html += `<p class="ro-verdict is-no">In range, but the runway at ${esc(shortRwy.iata)} (${fmt(shortRwy.rwy)} ft) is too short for every aircraft that can fly this far.</p>`;
    }
  }
  out.innerHTML = html;
  drawRoute(legs);

  // The aircraft that can fly it: one per family, the best fit (the shortest range that still does it) first
  const seen = new Set();
  const picks = [];
  for (const m of able) {
    if (seen.has(m.family)) continue;
    seen.add(m.family);
    picks.push(m);
  }
  fit.innerHTML = picks.length
    ? `<h3>Aircraft that can fly it</h3><p class="fit-lede">One of each family, the closest fit first. Range and runway as in the game.</p><ul class="fit-list">${picks
        .slice(0, 12)
        .map(
          (m, i) =>
            `<li class="${i === 0 ? 'is-best' : ''}"><span class="sil" style="--sil:url(/fleet/${m.group}.png)" aria-hidden="true"></span><span class="fit-name">${esc(m.name)}${i === 0 ? ' <em>Best fit</em>' : ''}</span><span class="fit-meta">${fmt(m.range)} nm, ${m.cargo ? `${m.tons} t freight` : `${m.seats} seats`}</span></li>`
        )
        .join('')}</ul>${picks.length > 12 ? `<p class="fit-more">And ${picks.length - 12} more families.</p>` : ''}`
    : '';
}

// ------------------------------------------------------------ start
export function initRoute() {
  if (!document.querySelector('[data-route-map]')) return;
  buildMap();
  const comboFrom = airportCombo(document.querySelector('[data-combo=from]'), (a) => {
    from = a;
    update();
  });
  const comboTo = airportCombo(document.querySelector('[data-combo=to]'), (a) => {
    to = a;
    update();
  });
  document.querySelector('[data-swap]')?.addEventListener('click', () => {
    [from, to] = [to, from];
    comboFrom.set(from);
    comboTo.set(to);
    update();
  });
  document.querySelector('[data-surprise]')?.addEventListener('click', async () => {
    const big = (await loadAirports()).filter((a) => a.large);
    const pick = () => big[Math.floor(Math.random() * big.length)];
    from = pick();
    do to = pick();
    while (to.iata === from.iata || distanceNm(from, to) < 400);
    comboFrom.set(from);
    comboTo.set(to);
    update();
  });
  // A first route to look at, once the section comes into view
  const start = async () => {
    const aps = await loadAirports();
    const by = new Map(aps.map((a) => [a.iata, a]));
    if (from || to) return;
    from = by.get('JFK');
    to = by.get('SIN');
    comboFrom.set(from);
    comboTo.set(to);
    update();
  };
  const sec = document.getElementById('route');
  if ('IntersectionObserver' in window && sec) {
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        io.disconnect();
        start();
      }
    }, { rootMargin: '200px' });
    io.observe(sec);
  } else start();
}
