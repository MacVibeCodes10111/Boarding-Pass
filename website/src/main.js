// Boarding Pass website: live download links and version from the latest GitHub
// release, "What's new" from the README on GitHub, and the aircraft on the map.
// Everything here is an extra: the page works (with plain links) without it.
const REPO = 'MacVibeCodes10111/Boarding-Pass';
const RELEASES = `https://github.com/${REPO}/releases/latest`;

// ------------------------------------------------------------ cache (per visit)
const cached = async (key, url, as) => {
  try {
    const hit = sessionStorage.getItem(key);
    if (hit) return JSON.parse(hit);
  } catch { /* storage off */ }
  const res = await fetch(url, { headers: as === 'json' ? { Accept: 'application/vnd.github+json' } : {} });
  if (!res.ok) throw new Error(`${res.status}`);
  const data = as === 'json' ? await res.json() : await res.text();
  try { sessionStorage.setItem(key, JSON.stringify(data)); } catch { /* storage full or off */ }
  return data;
};

// ------------------------------------------------------------ downloads
const ua = navigator.userAgent || '';
const plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
// Touch devices get the browser version: iPads report themselves as Macs, and no installer runs on a phone
const touchDevice = navigator.maxTouchPoints > 1 || /iPhone|iPad|Android|Mobile/i.test(ua);
const isMac = !touchDevice && (/Mac/i.test(plat) || /Macintosh|Mac OS X/.test(ua));
const isWin = !touchDevice && (/Win/i.test(plat) || /Windows NT/.test(ua));

function fillDownloads(rel) {
  const assets = rel.assets || [];
  const find = (re) => assets.find((a) => re.test(a.name));
  const mac = find(/universal\.dmg$/i) || find(/\.dmg$/i);
  const win = find(/x64-setup\.exe$/i) || find(/\.exe$/i);
  const version = String(rel.tag_name || '').replace(/^v/, '');
  const mb = (a) => `${(a.size / 1048576).toFixed(0)} MB`;
  for (const [kind, a] of [['mac', mac], ['win', win]]) {
    if (!a) continue;
    document.querySelectorAll(`[data-asset="${kind}"]`).forEach((el) => (el.href = a.browser_download_url));
    document.querySelectorAll(`[data-asset-file="${kind}"]`).forEach((el) => (el.textContent = `${kind === 'mac' ? '.dmg' : 'Installer (.exe)'}, ${mb(a)}`));
  }
  if (version) {
    const flight = `BP ${version.split('.').slice(0, 2).join('')}`;
    document.querySelectorAll('[data-version-flight]').forEach((el) => (el.textContent = flight));
    const line = document.querySelector('[data-release-line]');
    if (line) line.innerHTML = `Version ${version}, released ${new Date(rel.published_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}. Every version is on the <a href="${RELEASES.replace('/latest', '')}">Releases page</a>. The apps update themselves.`;
  }
  // The secondary hero button goes straight to this computer's download
  const os = document.querySelector('[data-os-download]');
  if (os) {
    if (isMac && mac) Object.assign(os, { href: mac.browser_download_url, textContent: 'Download for Mac' });
    else if (isWin && win) Object.assign(os, { href: win.browser_download_url, textContent: 'Download for Windows' });
  }
  return version;
}

// ------------------------------------------------------------ what's new (README)
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');

/** Versions from the README's "What's new": [{ version, items: [{ title, text }] }], newest first. */
function parseWhatsNew(md) {
  const start = md.indexOf("## What's new");
  if (start < 0) return [];
  const rest = md.slice(start + 13);
  const end = rest.search(/\n## /);
  const block = end >= 0 ? rest.slice(0, end) : rest;
  const out = [];
  let cur = null;
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    const v = line.match(/^Version (\d+\.\d+(?:\.\d+)?):$/);
    if (v) { cur = { version: v[1], items: [] }; out.push(cur); continue; }
    if (cur && line.startsWith('- ')) {
      const m = line.slice(2).match(/^\*\*(.+?)\*\*\s*(.*)$/);
      cur.items.push(m ? { title: m[1].replace(/[.:]$/, ''), text: m[2] } : { title: '', text: line.slice(2) });
    } else if (cur && cur.items.length && line && !line.startsWith('Version')) {
      cur.items[cur.items.length - 1].text += ' ' + line;
    }
  }
  return out;
}

function fillBoard(versions, released) {
  const board = document.querySelector('[data-board]');
  const notes = document.querySelector('[data-notes]');
  if (!board || !versions.length) return;
  // 2.29 and 2.29.0 are the same version
  const num = (v) => {
    const [a = 0, b = 0, c = 0] = String(v).split('.').map(Number);
    return (a * 1000 + b) * 1000 + c;
  };
  const rows = versions.slice(0, 6).map((v) => {
    const isOut = released ? num(v.version) <= num(released) : true;
    const isLatest = released ? num(v.version) === num(released) : v === versions[0];
    const status = !isOut ? ['Coming soon', 'soon'] : isLatest ? ['Boarding', 'now'] : ['Departed', 'gone'];
    const firstSentence = (t) => t.replace(/\*\*/g, '').split(/(?<=\.)\s/)[0].replace(/\.$/, '');
    const what = v.items.map((i) => i.title).filter(Boolean).slice(0, 2).join(', ') || firstSentence(v.items[0]?.text ?? '');
    return `<div class="board-row" role="row"><span role="cell" class="flight">BP ${v.version.split('.').slice(0, 2).join('')}</span><span role="cell">${inline(what)}</span><span role="cell" class="status ${status[1]}">${status[0]}</span></div>`;
  });
  board.innerHTML = rows.join('');
  const latest = versions.find((v) => (released ? num(v.version) <= num(released) : true)) || versions[0];
  if (notes && latest) {
    notes.innerHTML = `<h3>In version ${esc(latest.version)}</h3><ul>${latest.items.map((i) => `<li>${i.title ? `<strong>${inline(i.title)}.</strong> ` : ''}${inline(i.text)}</li>`).join('')}</ul>`;
  }
}

(async () => {
  let released = '';
  try {
    released = fillDownloads(await cached('bp-rel', `https://api.github.com/repos/${REPO}/releases/latest`, 'json'));
  } catch { /* offline or rate-limited: the plain links to the Releases page stay */ }
  try {
    fillBoard(parseWhatsNew(await cached('bp-readme', `https://raw.githubusercontent.com/${REPO}/main/README.md`, 'text')), released);
  } catch { /* keep the board as written in the page */ }
})();

// ------------------------------------------------------------ aircraft on the map
// One small plane flies each route, slowly; off for people who prefer less motion.
(() => {
  const svg = document.querySelector('.worldmap svg');
  if (!svg) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NS = 'http://www.w3.org/2000/svg';
  const planes = document.createElementNS(NS, 'g');
  svg.querySelectorAll('.rt path').forEach((p, i) => {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'plane');
    const shape = document.createElementNS(NS, 'path');
    shape.setAttribute('d', 'M6 0 L-5 -4.5 L-3 0 L-5 4.5 Z');
    g.appendChild(shape);
    if (reduce) {
      const len = p.getTotalLength();
      const a = p.getPointAtLength(len * 0.55);
      const b = p.getPointAtLength(len * 0.56);
      g.setAttribute('transform', `translate(${a.x} ${a.y}) rotate(${(Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI})`);
    } else {
      const m = document.createElementNS(NS, 'animateMotion');
      m.setAttribute('dur', `${38 + ((i * 7) % 23)}s`);
      m.setAttribute('begin', `-${(i * 11) % 30}s`);
      m.setAttribute('repeatCount', 'indefinite');
      m.setAttribute('rotate', 'auto');
      const mp = document.createElementNS(NS, 'mpath');
      mp.setAttribute('href', `#${p.id}`);
      m.appendChild(mp);
      g.appendChild(m);
    }
    planes.appendChild(g);
  });
  svg.appendChild(planes);
})();
