// Print your boarding pass: the airline's name, code, hub and livery. Every
// ticket on the page (data-ticket) shows it, every Play link carries it into
// the game (which fills in its new-airline form and applies the colours), and
// it can be saved as a picture to share.
import { LIVERIES, POPS, airportCombo, esc, hexToHsv, hsvToHex, inkOn, loadAirports, normHex, reduceMotion, store } from './shared.js';

const PLAY = 'https://play.boardingpass.my';
const KEY = 'bp-web-pass';
const DEFAULT = { airline: '', code: '', hub: null, livery: 'night', bg: '#0c1320', hl: '#f5a524' };

let pass = { ...DEFAULT, ...(store.get(KEY) || {}) };
const isSet = () => !!(pass.airline || pass.code || pass.hub || pass.livery !== 'night');

// ------------------------------------------------------------ helpers
const codeOf = (p) => (p.code || (p.airline ? p.airline.replace(/[^A-Za-z]/g, '').slice(0, 2) : '') || 'BP').toUpperCase();
const callsignOf = (p) => (p.airline ? p.airline.split(/\s+/)[0].toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) : '');
/** Flight number from the airline code and its hub, so it stays the same for the same pass */
const flightNo = (p) => {
  let h = 7;
  for (const c of `${p.code}${p.hub?.iata ?? ''}${p.airline}`) h = (h * 31 + c.charCodeAt(0)) % 9000;
  return `${codeOf(p)} ${100 + (h % 900)}`;
};

/** The address that starts the game with this pass */
export function playUrl(p = pass) {
  const q = new URLSearchParams();
  if (p.airline) q.set('airline', p.airline);
  if (p.code) q.set('code', codeOf(p));
  const cs = callsignOf(p);
  if (cs.length >= 2) q.set('callsign', cs);
  if (p.hub) q.set('hub', p.hub.iata);
  const preset = LIVERIES.find((l) => l.id === p.livery && l.bg === p.bg && l.hl === p.hl);
  if (preset && preset.id !== 'night') q.set('theme', preset.id);
  else if (!preset) {
    q.set('bg', p.bg.slice(1));
    q.set('hl', p.hl.slice(1));
  }
  const s = q.toString();
  return s ? `${PLAY}/?${s}` : PLAY;
}

// A barcode that is the same for the same pass (it encodes nothing; it looks the part)
function barcodeSvg(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rnd = () => ((h = Math.imul(h ^ (h >>> 13), 1274126177)) >>> 0) / 4294967296;
  let x = 0;
  let out = '';
  while (x < 140) {
    const w = 1 + Math.floor(rnd() * 3);
    out += `<rect x="${x}" y="0" width="${w}" height="40"/>`;
    x += w + 1 + Math.floor(rnd() * 3);
  }
  return out;
}

// ------------------------------------------------------------ tickets on the page
function renderTickets() {
  const personal = isSet();
  const ink = inkOn(pass.hl);
  document.querySelectorAll('[data-ticket]').forEach((t) => {
    const set = (sel, v) => t.querySelectorAll(sel).forEach((el) => (el.textContent = v));
    t.style.setProperty('--stub', pass.hl);
    t.style.setProperty('--stub-ink', ink);
    t.style.setProperty('--livery-bg', pass.bg);
    t.classList.toggle('is-personal', personal);
    set('[data-t-airline]', pass.airline || 'Boarding Pass');
    set('[data-t-from]', pass.hub ? pass.hub.iata : 'HUB');
    set('[data-t-from-city]', pass.hub ? pass.hub.city || pass.hub.name : 'Your hub');
    const fl = t.querySelector('[data-t-flight]');
    if (fl) {
      if (personal && (pass.code || pass.airline)) {
        fl.textContent = flightNo(pass);
        fl.dataset.personal = '1';
      } else delete fl.dataset.personal;
    }
    const logo = t.querySelector('[data-t-logo]');
    if (logo) {
      // Keep the page's own icon (its built address) to put back when the pass is cleared
      if (logo.dataset.icon === undefined) logo.dataset.icon = logo.innerHTML;
      logo.innerHTML = personal && (pass.code || pass.airline) ? `<span class="ticket-badge" style="background:${pass.hl};color:${ink}">${esc(codeOf(pass))}</span>` : logo.dataset.icon;
    }
    const bc = t.querySelector('[data-t-barcode]');
    if (bc) bc.innerHTML = barcodeSvg(`${pass.airline}|${pass.code}|${pass.hub?.iata ?? ''}`);
    if (t.matches('a')) t.href = playUrl();
  });
  // Every Play link starts the game with this airline
  document.querySelectorAll('[data-play], [data-board-link]').forEach((a) => (a.href = playUrl()));
}

// ------------------------------------------------------------ the form
function setupForm() {
  const form = document.querySelector('[data-pass-form]');
  if (!form) return;
  const name = form.elements.airline;
  const code = form.elements.code;
  name.value = pass.airline;
  code.value = pass.code;
  const save = () => {
    store.set(KEY, pass);
    renderTickets();
    renderLiveries();
  };
  name.addEventListener('input', () => {
    pass.airline = name.value.replace(/[^\p{L}\p{N} .,'&-]/gu, '').slice(0, 40);
    save();
  });
  code.addEventListener('input', () => {
    code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
    pass.code = code.value;
    save();
  });
  const hub = airportCombo(form.querySelector('[data-combo=hub]'), (a) => {
    pass.hub = { iata: a.iata, city: a.city, name: a.name };
    save();
  });
  if (pass.hub) hub.set(pass.hub);

  // Liveries: the game's presets
  const box = form.querySelector('[data-liveries]');
  function renderLiveries() {
    box.innerHTML = LIVERIES.map((l) => {
      const on = pass.livery === l.id && pass.bg === l.bg && pass.hl === l.hl;
      return `<button type="button" role="radio" aria-checked="${on}" data-livery="${l.id}" class="livery"><span class="livery-sw" style="background:${l.bg}"><i style="background:${l.hl}"></i></span>${esc(l.name)}</button>`;
    }).join('') + (LIVERIES.some((l) => pass.livery === l.id && pass.bg === l.bg && pass.hl === l.hl) ? '' : `<span class="livery is-custom" role="radio" aria-checked="true"><span class="livery-sw" style="background:${pass.bg}"><i style="background:${pass.hl}"></i></span>Your own</span>`);
    form.querySelectorAll('[data-well]').forEach((w) => {
      const k = w.dataset.well;
      w.querySelector('.well-swatch').style.background = pass[k];
      form.querySelector(`[data-well-hex=${k}]`).textContent = pass[k].toUpperCase();
    });
  }
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-livery]');
    if (!b) return;
    const l = LIVERIES.find((x) => x.id === b.dataset.livery);
    Object.assign(pass, { livery: l.id, bg: l.bg, hl: l.hl });
    picker.sync();
    save();
  });
  renderLiveries();
  const picker = setupPicker(form, (k, hex) => {
    pass[k] = hex;
    pass.livery = 'custom';
    save();
  });
}

// ------------------------------------------------------------ colour picker (saturation/brightness square, hue strip)
function setupPicker(form, onColour) {
  const el = form.querySelector('[data-picker]');
  const sv = el.querySelector('.pk-sv');
  const hue = el.querySelector('.pk-hue');
  const hex = el.querySelector('.pk-hex');
  const pops = el.querySelector('[data-pops]');
  let target = null;
  let hsv = [0, 0, 0];
  pops.innerHTML = POPS.map((c) => `<button type="button" class="pop" style="background:${c}" data-pop="${c}" aria-label="Use ${c.toUpperCase()}"></button>`).join('');
  const show = () => {
    const [h, s, v] = hsv;
    sv.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), ${hsvToHex(h, 1, 1)}`;
    const k1 = sv.querySelector('.pk-knob');
    k1.style.left = `${s * 100}%`;
    k1.style.top = `${(1 - v) * 100}%`;
    k1.style.background = hsvToHex(h, s, v);
    const k2 = hue.querySelector('.pk-knob');
    k2.style.left = `${(h / 360) * 100}%`;
    k2.style.background = hsvToHex(h, 1, 1);
    hue.setAttribute('aria-valuenow', String(Math.round(h)));
    sv.setAttribute('aria-valuetext', `saturation ${Math.round(s * 100)}%, brightness ${Math.round(v * 100)}%`);
  };
  const commit = () => {
    const c = hsvToHex(...hsv);
    hex.value = c.toUpperCase();
    show();
    onColour(target, c);
  };
  const load = (c) => {
    const [h, s, v] = hexToHsv(c);
    hsv = [s === 0 || v === 0 ? hsv[0] : h, s, v];
    hex.value = c.toUpperCase();
    show();
  };
  const drag = (node, at) => {
    node.addEventListener('pointerdown', (e) => {
      node.setPointerCapture?.(e.pointerId);
      const go = (ev) => {
        const r = node.getBoundingClientRect();
        at(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
        commit();
      };
      go(e);
      const up = () => {
        node.removeEventListener('pointermove', go);
        node.removeEventListener('pointerup', up);
        node.removeEventListener('pointercancel', up);
      };
      node.addEventListener('pointermove', go);
      node.addEventListener('pointerup', up);
      node.addEventListener('pointercancel', up);
    });
  };
  drag(sv, (x, y) => (hsv = [hsv[0], x, 1 - y]));
  drag(hue, (x) => (hsv = [x * 359.9, hsv[1], hsv[2]]));
  const keys = (node, f) =>
    node.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
      if (!d) return;
      e.preventDefault();
      f(d[0] * (e.shiftKey ? 5 : 1), d[1] * (e.shiftKey ? 5 : 1));
      commit();
    });
  keys(sv, (dx, dy) => (hsv = [hsv[0], Math.min(1, Math.max(0, hsv[1] + dx * 0.02)), Math.min(1, Math.max(0, hsv[2] + dy * 0.02))]));
  keys(hue, (dx, dy) => (hsv = [(hsv[0] + (dx || dy) * 3 + 360) % 360, hsv[1], hsv[2]]));
  hex.addEventListener('change', () => {
    const c = normHex(hex.value);
    if (c) {
      load(c);
      onColour(target, c);
    } else hex.value = hsvToHex(...hsv).toUpperCase();
  });
  hex.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), hex.blur()));
  pops.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pop]');
    if (!b) return;
    load(b.dataset.pop);
    onColour(target, b.dataset.pop);
  });
  form.querySelectorAll('[data-well]').forEach((w) =>
    w.addEventListener('click', () => {
      const k = w.dataset.well;
      const open = !(target === k && !el.hidden);
      form.querySelectorAll('[data-well]').forEach((x) => x.setAttribute('aria-expanded', String(open && x === w)));
      target = open ? k : null;
      el.hidden = !open;
      if (open) load(pass[k]);
    })
  );
  return { sync: () => target && load(pass[target]) };
}

// ------------------------------------------------------------ save as image (drawn on a canvas, to share)
async function savePng() {
  try {
    await Promise.all(['800 64px Archivo', '700 24px Archivo', '500 20px Archivo'].map((f) => document.fonts?.load(f)));
  } catch {
    /* system font */
  }
  const W = 1500;
  const H = 640;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  // Night sky with the airports, for a background
  g.fillStyle = '#0c1320';
  g.fillRect(0, 0, W, H);
  try {
    const aps = await loadAirports();
    g.fillStyle = '#22314f';
    for (const a of aps) g.fillRect(((a.lon + 180) / 360) * W, ((90 - a.lat) / 180) * H * 1.1 - 40, a.large ? 3 : 2, a.large ? 3 : 2);
  } catch {
    /* plain background */
  }
  const x0 = 90;
  const y0 = 110;
  const mainW = 960;
  const stubW = 360;
  const th = 420;
  const r = 34;
  const notch = 26;
  // Ticket body with the two notches where it tears
  const ticketPath = (x, w, notchLeft, notchRight) => {
    const p = new Path2D();
    p.moveTo(x + (notchLeft ? 0 : r), y0);
    p.lineTo(x + w - (notchRight ? 0 : r), y0);
    if (notchRight) p.arc(x + w, y0, notch, Math.PI, Math.PI / 2, true);
    else p.arcTo(x + w, y0, x + w, y0 + r, r);
    p.lineTo(x + w, y0 + th - (notchRight ? notch : r));
    if (notchRight) p.arc(x + w, y0 + th, notch, -Math.PI / 2, Math.PI, true);
    else p.arcTo(x + w, y0 + th, x + w - r, y0 + th, r);
    p.lineTo(x + (notchLeft ? notch : r), y0 + th);
    if (notchLeft) p.arc(x, y0 + th, notch, 0, -Math.PI / 2, true);
    else p.arcTo(x, y0 + th, x, y0 + th - r, r);
    p.lineTo(x, y0 + (notchLeft ? notch : r));
    if (notchLeft) p.arc(x, y0, notch, Math.PI / 2, 0, true);
    else p.arcTo(x, y0, x + r, y0, r);
    p.closePath();
    return p;
  };
  g.save();
  g.shadowColor = 'rgba(0,0,0,.45)';
  g.shadowBlur = 50;
  g.shadowOffsetY = 24;
  g.fillStyle = '#f4f6f9';
  g.fill(ticketPath(x0, mainW, false, true));
  g.fillStyle = pass.hl;
  g.fill(ticketPath(x0 + mainW, stubW, true, false));
  g.restore();
  // Livery band
  g.save();
  g.clip(ticketPath(x0, mainW, false, true));
  g.fillStyle = pass.bg;
  g.fillRect(x0, y0, mainW, 14);
  g.fillStyle = pass.hl;
  g.fillRect(x0, y0 + 14, mainW, 5);
  g.restore();
  const ink = '#131c2e';
  const soft = '#5a6680';
  const font = (w, s) => `${w} ${s}px Archivo, system-ui, sans-serif`;
  // Airline
  const code = codeOf(pass);
  g.fillStyle = pass.hl;
  g.beginPath();
  g.roundRect?.(x0 + 50, y0 + 52, 52, 52, 12);
  if (!g.roundRect) g.rect(x0 + 50, y0 + 52, 52, 52);
  g.fill();
  g.fillStyle = inkOn(pass.hl);
  g.font = font(800, 22);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(code, x0 + 76, y0 + 79);
  g.textAlign = 'left';
  g.fillStyle = ink;
  g.font = font(800, 30);
  g.fillText(pass.airline || 'Boarding Pass', x0 + 120, y0 + 79);
  // Route
  g.textBaseline = 'alphabetic';
  g.font = font(800, 104);
  g.fillText(pass.hub ? pass.hub.iata : 'HUB', x0 + 50, y0 + 236);
  g.textAlign = 'right';
  g.fillText('ANY', x0 + mainW - 60, y0 + 236);
  g.textAlign = 'left';
  g.strokeStyle = '#9aa6bb';
  g.lineWidth = 4;
  g.setLineDash([12, 12]);
  g.beginPath();
  g.moveTo(x0 + 330, y0 + 200);
  g.lineTo(x0 + mainW - 290, y0 + 200);
  g.stroke();
  g.setLineDash([]);
  g.save();
  g.translate(x0 + (330 + mainW - 290) / 2, y0 + 200);
  g.fillStyle = ink;
  g.beginPath();
  g.moveTo(26, 0);
  g.lineTo(-20, -20);
  g.lineTo(-12, 0);
  g.lineTo(-20, 20);
  g.closePath();
  g.fill();
  g.restore();
  g.fillStyle = soft;
  g.font = font(500, 22);
  g.fillText(pass.hub ? pass.hub.city || pass.hub.name : 'Your hub', x0 + 52, y0 + 276);
  g.textAlign = 'right';
  g.fillText('Anywhere', x0 + mainW - 60, y0 + 276);
  g.textAlign = 'left';
  g.strokeStyle = '#d7dce5';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(x0 + 50, y0 + 312);
  g.lineTo(x0 + mainW - 60, y0 + 312);
  g.stroke();
  const fields = [['Passenger', 'You'], ['Flight', pass.code || pass.airline ? flightNo(pass) : 'BP'], ['Fare', 'Free'], ['Seat', 'Any device']];
  fields.forEach(([k, v], i) => {
    const fx = x0 + 50 + i * 225;
    g.fillStyle = soft;
    g.font = font(500, 19);
    g.fillText(k, fx, y0 + 352);
    g.fillStyle = ink;
    g.font = font(700, 26);
    g.fillText(v, fx, y0 + 386);
  });
  // Stub
  const sx = x0 + mainW + 46;
  const sInk = inkOn(pass.hl);
  g.fillStyle = sInk;
  g.globalAlpha = 0.65;
  g.font = font(600, 19);
  g.fillText('Gate', sx, y0 + 70);
  g.globalAlpha = 1;
  g.font = font(700, 22);
  g.fillText('play.boardingpass.my', sx, y0 + 102);
  g.font = font(800, 50);
  g.fillText('Board now', sx, y0 + 180);
  g.strokeStyle = sInk;
  g.globalAlpha = 0.35;
  g.setLineDash([10, 10]);
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(x0 + mainW + 2, y0 + 40);
  g.lineTo(x0 + mainW + 2, y0 + th - 40);
  g.stroke();
  g.setLineDash([]);
  g.globalAlpha = 1;
  // Barcode
  let h = 2166136261;
  for (const ch of `${pass.airline}|${pass.code}|${pass.hub?.iata ?? ''}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rnd = () => ((h = Math.imul(h ^ (h >>> 13), 1274126177)) >>> 0) / 4294967296;
  let bx = sx;
  while (bx < x0 + mainW + stubW - 46) {
    const w = 2 + Math.floor(rnd() * 5);
    g.fillRect(bx, y0 + th - 130, w, 90);
    bx += w + 2 + Math.floor(rnd() * 5);
  }
  // Signature line
  g.fillStyle = '#8d99ae';
  g.font = font(500, 20);
  g.fillText('Boarding Pass, the free airline manager game. boardingpass.my', x0, H - 40);
  const a = document.createElement('a');
  a.download = `${(pass.airline || 'boarding-pass').replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}-boarding-pass.png`;
  a.href = c.toDataURL('image/png');
  document.body.appendChild(a);
  a.click();
  a.remove();
  note('Saved. Share it on the Discord.');
}

const note = (t) => {
  const el = document.querySelector('[data-pass-note]');
  if (el) el.textContent = t;
};

// ------------------------------------------------------------ the ticket comes out of the slot, once
function printOnView() {
  const t = document.querySelector('.ticket-print');
  if (!t || reduceMotion() || !('IntersectionObserver' in window)) return;
  t.classList.add('is-waiting');
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      t.classList.remove('is-waiting');
      t.classList.add('is-printing');
      t.addEventListener('animationend', () => t.classList.remove('is-printing'), { once: true });
    },
    { threshold: 0.35 }
  );
  io.observe(t.closest('.kiosk-out'));
}

// ------------------------------------------------------------ clear for takeoff (the little plane on the tickets)
function takeoffs() {
  document.addEventListener('click', (e) => {
    const p = e.target.closest('[data-takeoff]');
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    if (p.classList.contains('is-gone')) return;
    const r = p.getBoundingClientRect();
    const fly = document.createElement('span');
    fly.className = 'takeoff-plane';
    fly.style.left = `${r.left}px`;
    fly.style.top = `${r.top}px`;
    fly.style.background = getComputedStyle(p).backgroundColor;
    document.body.appendChild(fly);
    p.classList.add('is-gone');
    const n = (store.get('bp-web-takeoffs') || 0) + 1;
    store.set('bp-web-takeoffs', n);
    p.title = n === 1 ? 'Cleared for takeoff' : `${n} takeoffs so far`;
    if (reduceMotion()) {
      fly.remove();
      setTimeout(() => p.classList.remove('is-gone'), 600);
      return;
    }
    const dx = window.innerWidth - r.left + 80;
    const anim = fly.animate(
      [
        { transform: 'translate(0, 0) rotate(0deg) scale(1)' },
        { transform: `translate(${dx * 0.25}px, -10px) rotate(-6deg) scale(1.15)`, offset: 0.25 },
        { transform: `translate(${dx}px, -${Math.min(420, r.top + 60)}px) rotate(-22deg) scale(2.2)` },
      ],
      { duration: 1700, easing: 'cubic-bezier(.55,0,.35,1)', fill: 'forwards' }
    );
    anim.onfinish = () => {
      fly.remove();
      setTimeout(() => p.classList.remove('is-gone'), 1400);
    };
  }, true);
}

// ------------------------------------------------------------ start
export function initPass() {
  renderTickets();
  setupForm();
  printOnView();
  takeoffs();
  document.querySelector('[data-save-png]')?.addEventListener('click', () => savePng().catch(() => note('The picture could not be made in this browser.')));
  document.querySelector('[data-copy-link]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(playUrl());
      note('Link copied. Anyone who opens it starts with your airline.');
    } catch {
      note(playUrl());
    }
  });
}
