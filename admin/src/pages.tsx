// ============================================================================
// THE ADMIN PAGES (Update A, phase A6)
//   Only what players share, and reports. Never saves, emails or sign-in
//   details. Every change asks for a reason, and the server logs it.
//   Everything here was written by players, so it's only ever shown as text.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { liveryFromProfile } from '../../src/game/profile';
import { AIRCRAFT_BY_ID } from '../../src/game/aircraftCatalog';
import { paintedPhoto } from '../../src/game/liveryPaint';
import { Button, C, DISPLAY, inputStyle } from '../../src/ui/kit';
import { act, actOnLogo, forgetPicture, listLogos, logoPicture, rpc, storageUsage, type Channel, type LogoRow, type Me } from './api';

export interface Route {
  page: 'dashboard' | 'reports' | 'airlines' | 'alliances' | 'market' | 'logos' | 'log' | 'team';
  id: string;
}
interface Ctx {
  route: Route;
  channel: Channel;
  me: Me;
}
type J = Record<string, any>;

export function Page(props: Ctx) {
  const { page, id } = props.route;
  if (page === 'reports') return <Reports {...props} />;
  if (page === 'airlines') return id ? <Airline {...props} id={id} /> : <Airlines {...props} />;
  if (page === 'alliances') return id ? <Alliance {...props} id={id} /> : <Alliances {...props} />;
  if (page === 'market') return <Market {...props} />;
  if (page === 'logos') return <Logos {...props} />;
  if (page === 'log') return <Log {...props} />;
  if (page === 'team') return <Team {...props} />;
  return <Dashboard {...props} />;
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------
function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(fn, deps);
  const reload = useCallback(() => {
    setError('');
    load()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [load]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

const when = (x: unknown) => (x ? new Date(typeof x === 'number' ? x : String(x)).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const day = (x: unknown) => (x ? new Date(String(x)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const mb = (b: number) => `${(b / 1048576).toLocaleString(undefined, { maximumFractionDigits: b < 1048576 * 10 ? 2 : 0 })} MB`;
const REASONS: Record<string, string> = { name: 'Offensive name or text', logo: 'Offensive logo or livery', impersonation: 'Pretends to be a real airline', other: 'Something else' };

function H1(props: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '0 0 16px' }}>
      <h1 style={{ fontFamily: DISPLAY, fontSize: 28, margin: 0, flex: 1, overflowWrap: 'anywhere' }}>{props.children}</h1>
      {props.right}
    </div>
  );
}
function Box(props: { title?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section style={{ padding: 14, borderRadius: 12, background: C.panel, border: `1px solid ${C.line}`, minWidth: 0 }}>
      {props.title && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, flex: 1 }}>{props.title}</h2>
          {props.right}
        </div>
      )}
      {props.children}
    </section>
  );
}
const Muted = (props: { children: React.ReactNode }) => <p style={{ fontSize: 12.5, color: C.muted, margin: 0, lineHeight: 1.45 }}>{props.children}</p>;
const Err = (props: { e: string }) => (props.e ? <p style={{ fontSize: 13, color: C.red, margin: '0 0 10px' }}>{props.e}</p> : null);
function Tile(props: { label: string; value: React.ReactNode; warn?: boolean; href?: string }) {
  const body = (
    <div style={{ padding: '12px 14px', borderRadius: 12, background: C.panel, border: `1px solid ${props.warn ? C.amber : C.line}`, height: '100%' }}>
      <div style={{ fontSize: 12, color: C.muted }}>{props.label}</div>
      <div className="num" style={{ fontSize: 24, fontWeight: 700, marginTop: 2, color: props.warn ? C.amber : C.text }}>
        {props.value}
      </div>
    </div>
  );
  return props.href ? (
    <a href={props.href} style={{ textDecoration: 'none', color: 'inherit' }}>
      {body}
    </a>
  ) : (
    body
  );
}
const grid = (min: number): React.CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: 10 });
function Bar(props: { label: string; used: number; cap: number }) {
  const pct = props.cap ? (props.used / props.cap) * 100 : 0;
  const warn = pct >= 70;
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', fontSize: 13 }}>
        <span style={{ flex: 1 }}>{props.label}</span>
        <span className="num" style={{ color: warn ? C.amber : C.textDim }}>
          {mb(props.used)} of {mb(props.cap)} ({pct.toFixed(pct < 1 ? 2 : 0)}%)
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: C.raised, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: warn ? C.amber : C.green }} />
      </div>
      {warn && <span style={{ fontSize: 12, color: C.amber }}>Over 70%: time to look at the limits or the plan.</span>}
    </div>
  );
}

/** A logo for review (shown even before it's approved), or a stand-in in the colours. */
function Logo(props: { hash?: string | null; colours?: { a: string; b: string }; text?: string; size?: number; bg?: string; onOpen?: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const s = props.size ?? 40;
  useEffect(() => {
    let live = true;
    setUrl(null);
    void logoPicture(props.hash).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [props.hash]);
  const box: React.CSSProperties = { width: s, height: s, flex: 'none', borderRadius: s / 4, overflow: 'hidden', display: 'grid', placeItems: 'center' };
  if (url)
    return (
      <img
        src={url}
        alt=""
        onClick={props.onOpen}
        title={props.onOpen ? 'Click to enlarge' : undefined}
        style={{ ...box, background: props.bg ?? '#fff', padding: 3, objectFit: 'contain', cursor: props.onOpen ? 'zoom-in' : undefined }}
      />
    );
  const a = props.colours?.a ?? '#475569', b = props.colours?.b ?? '#94a3b8';
  return (
    <span style={{ ...box, background: `linear-gradient(135deg, ${a} 50%, ${b} 50%)`, color: '#fff', fontWeight: 700, fontSize: s * 0.3, textShadow: '0 1px 2px rgba(0,0,0,.6)' }}>
      {props.text ?? ''}
    </span>
  );
}
/** Backgrounds to check a logo against, so white-on-white or hidden pale details show up. */
const CHECKER = 'repeating-conic-gradient(#9ca3af 0 25%, #f3f4f6 0 50%) 50% / 16px 16px';
const BG_PRESETS: { label: string; value: string; swatch: string }[] = [
  { label: 'White', value: '#ffffff', swatch: '#ffffff' },
  { label: 'Black', value: '#000000', swatch: '#000000' },
  { label: 'Grey', value: '#808080', swatch: '#808080' },
  { label: 'Checkerboard', value: CHECKER, swatch: CHECKER },
];
function LogoBackground(props: { value: string; onChange: (v: string) => void }) {
  const hex = /^#[0-9a-f]{6}$/i.test(props.value) ? props.value : '#ff00ff';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12.5, color: C.muted }}>
      Background
      {BG_PRESETS.map((p) => (
        <button
          key={p.label}
          type="button"
          title={p.label}
          aria-label={`${p.label} background`}
          onClick={() => props.onChange(p.value)}
          style={{ width: 24, height: 24, borderRadius: 6, background: p.swatch, cursor: 'pointer', border: `2px solid ${props.value === p.value ? C.brand : C.border}` }}
        />
      ))}
      <label title="Any colour" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
        <input type="color" value={hex} onChange={(e) => props.onChange(e.target.value)} aria-label="Pick any background colour" style={{ width: 32, height: 26, padding: 0, border: `1px solid ${C.border}`, borderRadius: 6, background: 'transparent', cursor: 'pointer' }} />
        Any colour
      </label>
    </div>
  );
}
/** One logo, as big as the screen allows, on the chosen background. */
function LogoZoom(props: { hash: string; bg: string; onBg: (v: string) => void; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [px, setPx] = useState<{ w: number; h: number } | null>(null);
  const [actual, setActual] = useState(false);
  const close = useRef(props.onClose);
  close.current = props.onClose;
  useEffect(() => {
    void logoPicture(props.hash).then(setUrl);
  }, [props.hash]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  return (
    <div role="dialog" aria-label="Logo, enlarged" onClick={props.onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,.75)', display: 'grid', placeItems: 'center', padding: 18 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ display: 'grid', gap: 10, padding: 16, borderRadius: 14, background: C.panel, border: `1px solid ${C.line}`, maxWidth: '100%', maxHeight: '100%', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <LogoBackground value={props.bg} onChange={props.onBg} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {px && (
              <span style={{ fontSize: 12, color: C.muted }}>
                {px.w} × {px.h} px
              </span>
            )}
            <Button size="sm" onClick={() => setActual((x) => !x)}>
              {actual ? 'Fit to screen' : 'Real pixels'}
            </Button>
            <Button size="sm" variant="ghost" onClick={props.onClose}>
              Close
            </Button>
          </div>
        </div>
        <div style={{ background: props.bg, borderRadius: 10, display: 'grid', placeItems: 'center', overflow: 'auto' }}>
          {url ? (
            <img
              src={url}
              alt="The logo, enlarged"
              onLoad={(e) => setPx({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              style={actual ? { display: 'block', imageRendering: 'pixelated' } : { display: 'block', width: 'min(80vw, 75vh, 1024px)', height: 'min(80vw, 75vh, 1024px)', objectFit: 'contain', imageRendering: 'pixelated' }}
            />
          ) : (
            <div style={{ width: 200, height: 200, display: 'grid', placeItems: 'center', color: C.muted }}>Loading…</div>
          )}
        </div>
      </div>
    </div>
  );
}
function Swatches(props: { colours?: { a: string; b: string } }) {
  if (!props.colours) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 4, verticalAlign: 'middle' }}>
      {[props.colours.a, props.colours.b].map((c, i) => (
        <span key={i} title={c} style={{ width: 14, height: 14, borderRadius: 4, background: c, border: `1px solid ${C.border}` }} />
      ))}
    </span>
  );
}
function Pill(props: { children: React.ReactNode; tone?: 'red' | 'amber' | 'green' | 'muted' }) {
  const col = props.tone === 'red' ? C.red : props.tone === 'amber' ? C.amber : props.tone === 'green' ? C.green : C.muted;
  return <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 6, fontSize: 11.5, fontWeight: 700, color: col, border: `1px solid ${col}`, whiteSpace: 'nowrap' }}>{props.children}</span>;
}
function Row(props: { children: React.ReactNode; href?: string }) {
  const st: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, background: C.raised, flexWrap: 'wrap', color: 'inherit', textDecoration: 'none' };
  return props.href ? (
    <a href={props.href} style={st}>
      {props.children}
    </a>
  ) : (
    <div style={st}>{props.children}</div>
  );
}
function AirlineRow(props: { a: J; extra?: React.ReactNode }) {
  const a = props.a;
  return (
    <Row href={`#/airlines/${a.id}`}>
      <Logo hash={a.badge} colours={a.colours} text={a.code} size={34} />
      <span style={{ flex: '1 1 200px', minWidth: 0 }}>
        <b style={{ fontSize: 14 }}>{a.airline}</b> <span style={{ fontSize: 12, color: C.muted }}>{[a.code, a.callsign, a.mode === 'sandbox' ? 'Sandbox' : 'Career', a.fleet != null ? `${a.fleet} aircraft` : ''].filter(Boolean).join(' · ')}</span>
        <span style={{ display: 'block', fontSize: 12, color: C.muted }}>
          {a.alliance ? `${a.alliance.tag} ${a.alliance.name} · ` : ''}shared {day(a.sharedAt)}
          {a.username ? ` · @${a.username}` : ''}
        </span>
      </span>
      {a.suspended && <Pill tone="red">Suspended</Pill>}
      {a.openReports > 0 && <Pill tone="amber">{a.openReports} open report{a.openReports === 1 ? '' : 's'}</Pill>}
      {props.extra}
    </Row>
  );
}

/**
 * A change: the button opens a small form asking why (and how long, or which parts),
 * then runs it. The server logs it with the reason.
 */
function Change(props: {
  label: string;
  danger?: boolean;
  days?: 'required' | 'optional';
  fields?: { value: string; label: string }[];
  note?: string;
  run: (reason: string, extra: { days: number | null; fields: string[] }) => Promise<unknown>;
  onDone: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [days, setDays] = useState(props.days === 'required' ? '7' : '');
  const [fields, setFields] = useState<string[]>(props.fields?.map((f) => f.value).slice(0, 1) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!open)
    return (
      <Button size="sm" variant={props.danger ? 'danger' : 'subtle'} disabled={props.disabled} onClick={() => setOpen(true)}>
        {props.label}
      </Button>
    );
  const n = days.trim() ? Math.floor(Number(days)) : null;
  const ok = reason.trim().length >= 3 && (props.days !== 'required' || (n !== null && n >= 1)) && (!props.fields || fields.length > 0) && (n === null || n >= 1);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        setBusy(true);
        setError('');
        props
          .run(reason.trim(), { days: n, fields })
          .then(() => {
            setOpen(false);
            setReason('');
            props.onDone();
          })
          .catch((x) => setError(x instanceof Error ? x.message : String(x)))
          .finally(() => setBusy(false));
      }}
      style={{ display: 'grid', gap: 8, padding: 10, borderRadius: 10, background: C.raised, border: `1px solid ${props.danger ? C.red : C.border}`, flexBasis: '100%' }}
    >
      <b style={{ fontSize: 13 }}>{props.label}</b>
      {props.note && <Muted>{props.note}</Muted>}
      {props.fields && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
          {props.fields.map((f) => (
            <label key={f.value} style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={fields.includes(f.value)} onChange={(e) => setFields((x) => (e.target.checked ? [...x, f.value] : x.filter((y) => y !== f.value)))} />
              {f.label}
            </label>
          ))}
        </div>
      )}
      {props.days && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          For
          <input value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder={props.days === 'optional' ? 'ever' : ''} style={{ ...inputStyle, width: 80 }} aria-label="Days" />
          {props.days === 'optional' ? 'days (empty: for good)' : 'days'}
        </label>
      )}
      <textarea value={reason} onChange={(e) => setReason(e.target.value.slice(0, 300))} rows={2} placeholder="Why (kept in the admin log; the player isn’t shown it)" aria-label="Reason" style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} />
      <Err e={error} />
      <div style={{ display: 'flex', gap: 6 }}>
        <Button size="sm" type="submit" variant={props.danger ? 'danger' : 'primary'} disabled={!ok || busy}>
          {busy ? 'Working…' : 'Confirm'}
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Admin log actions in plain words. */
const ACTIONS: Record<string, string> = {
  airline_reset: 'Reset name',
  liveries_hide: 'Hid liveries',
  suspend: 'Suspended',
  unsuspend: 'Lifted suspension',
  alliance_reset: 'Reset alliance',
  alliance_remove: 'Removed from alliance',
  alliance_lead: 'Changed leader',
  alliance_disband: 'Disbanded alliance',
  market_reverse: 'Reversed a trade',
  market_remove: 'Took a listing down',
  report_resolved: 'Resolved report',
  report_dismissed: 'Dismissed report',
  logo_approve: 'Approved logo',
  logo_remove: 'Removed logo',
  team_add: 'Added to team',
  team_remove: 'Removed from team',
};
const actionLabel = (a: string) => ACTIONS[a] ?? a;

function History(props: { items: J[] }) {
  if (!props.items?.length) return <Muted>Nothing yet.</Muted>;
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {props.items.map((x, i) => (
        <div key={i} style={{ fontSize: 12.5, padding: '6px 0', borderBottom: `1px solid ${C.line}` }}>
          <span style={{ color: C.muted }}>{when(x.at)}</span> · <b>{x.action ? actionLabel(x.action) : x.kind}</b>
          {x.by ? ` by ${typeof x.by === 'string' ? x.by : x.by.airline}` : ''}
          {x.reason ? <span style={{ color: C.textDim }}> · {x.reason}</span> : null}
          {x.actor || x.target ? <span style={{ color: C.textDim }}> · {[x.actor, x.target].filter(Boolean).join(' → ')}</span> : null}
          {x.detail?.from && x.detail?.to ? <span style={{ color: C.textDim }}> · {JSON.stringify(x.detail.from)} → {JSON.stringify(x.detail.to)}</span> : null}
          {x.status ? <span style={{ color: C.textDim }}> · {REASONS[x.reason] ?? ''} {x.note ? `“${x.note}”` : ''} ({x.status})</span> : null}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function Dashboard({ channel }: Ctx) {
  const d = useLoad(() => rpc<J>('admin_dashboard', { p_channel: channel }), [channel]);
  const u = useLoad(() => storageUsage(), []);
  const pending = useLoad(async () => (await listLogos('pending')).logos.length, []);
  const s = useLoad(() => rpc<J[]>('admin_suspensions'), []);
  const x = d.data;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <H1>{channel === 'main' ? 'Live game' : 'Test builds'}</H1>
      <Err e={d.error || u.error} />
      <div style={grid(160)}>
        <Tile label="Open reports" value={x?.openReports ?? '…'} warn={(x?.openReports ?? 0) > 0} href="#/reports" />
        <Tile label="Logos waiting" value={pending.data ?? '…'} warn={(pending.data ?? 0) > 0} href="#/logos" />
        <Tile label="New airlines today" value={x?.airlinesToday ?? '…'} href="#/airlines" />
        <Tile label="New alliances today" value={x?.alliancesToday ?? '…'} href="#/alliances" />
        <Tile label="Removals this week" value={x?.removalsWeek ?? '…'} href="#/log" />
        <Tile label="Shared airlines" value={x?.airlines ?? '…'} />
        <Tile label="Players sharing" value={x?.players ?? '…'} />
        <Tile label="Alliances" value={x?.alliances ?? '…'} />
      </div>
      <Box title="Server use">
        <div style={{ display: 'grid', gap: 12 }}>
          {u.data && <Bar label={`Logos and schedules (R2): ${u.data.objects.toLocaleString()} files`} used={u.data.bytes} cap={u.data.cap} />}
          {x && <Bar label="Database (Supabase)" used={x.dbBytes} cap={x.dbCap} />}
          <Muted>Worker requests (100,000 a day free) and Supabase egress are on the Cloudflare and Supabase dashboards.</Muted>
        </div>
      </Box>
      <Box title={`Suspended players (${s.data?.length ?? 0})`}>
        <div style={{ display: 'grid', gap: 6 }}>
          {s.data?.length ? (
            s.data.map((p) => (
              <Row key={p.user}>
                <span style={{ flex: '1 1 260px', fontSize: 13 }}>
                  <b>{p.label || 'A player'}</b> <span style={{ color: C.muted }}>· {p.until ? `until ${day(p.until)}` : 'for good'} · {p.reason}</span>
                </span>
                <Change label="Lift" run={(reason) => act('admin_unsuspend', { p_user: p.user, p_reason: reason })} onDone={s.reload} />
              </Row>
            ))
          ) : (
            <Muted>Nobody.</Muted>
          )}
        </div>
      </Box>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
function Reports({ channel }: Ctx) {
  const [status, setStatus] = useState('open');
  const r = useLoad(() => rpc<J[]>('admin_reports', { p_channel: channel, p_status: status }), [channel, status]);
  return (
    <div>
      <H1
        right={
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputStyle, width: 'auto' }} aria-label="Which reports">
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
            <option value="all">All</option>
          </select>
        }
      >
        Reports
      </H1>
      <Err e={r.error} />
      <div style={{ display: 'grid', gap: 10 }}>
        {r.data?.length === 0 && <Muted>No reports here.</Muted>}
        {r.data?.map((x) => (
          <Report key={x.id} x={x} onDone={r.reload} />
        ))}
      </div>
    </div>
  );
}

function Report({ x, onDone }: { x: J; onDone: () => void }) {
  const snap = x.snapshot ?? {};
  const now = x.now;
  const isAlliance = x.kind === 'alliance' || (snap.tag && !snap.code);
  const link = `#/${isAlliance ? 'alliances' : 'airlines'}/${x.target}`;
  return (
    <Box>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Logo hash={x.kind === 'logo' ? x.logo : (snap.badge ?? snap.logo)} colours={snap.colours} text={snap.code ?? snap.tag} size={56} />
        <div style={{ flex: '1 1 320px', minWidth: 0, display: 'grid', gap: 4 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Pill tone={x.status === 'open' ? 'amber' : 'muted'}>{x.status}</Pill>
            <b style={{ fontSize: 15 }}>{x.kind === 'logo' ? 'A logo on ' : x.kind === 'alliance' ? 'Alliance ' : 'Airline '}{snap.airline ?? snap.name}</b>
            <span style={{ fontSize: 12.5, color: C.muted }}>{REASONS[x.reason] ?? x.reason}</span>
          </div>
          {x.note && <p style={{ fontSize: 13.5, margin: 0, overflowWrap: 'anywhere' }}>“{x.note}”</p>}
          <Muted>
            Reported {when(x.at)} by {x.by?.airline || 'an airline'}
            {snap.code ? ` · as reported: ${[snap.airline, snap.code, snap.callsign].filter(Boolean).join(' · ')}` : snap.tag ? ` · as reported: ${snap.tag} ${snap.name}${snap.description ? `: “${snap.description}”` : ''}` : ''}
          </Muted>
          <Muted>{now ? `Now: ${[now.airline ?? now.name, now.code ?? now.tag, now.callsign].filter(Boolean).join(' · ')}` : 'It isn’t shared any more.'}</Muted>
          {x.handledNote && <Muted>Closed {when(x.handledAt)}: {x.handledNote}</Muted>}
          {snap.liveries && <LiveryText liveries={snap.liveries} />}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {now && (
            <a href={link} style={{ textDecoration: 'none' }}>
              <Button size="sm">Open {isAlliance ? 'alliance' : 'airline'}</Button>
            </a>
          )}
          {x.status === 'open' && (
            <>
              <Change label="Resolve" run={(reason) => act('admin_report_close', { p_id: x.id, p_status: 'resolved', p_reason: reason })} onDone={onDone} note="Use this once you’ve acted on it." />
              <Change label="Dismiss" run={(reason) => act('admin_report_close', { p_id: x.id, p_status: 'dismissed', p_reason: reason })} onDone={onDone} note="Nothing breaks the rules." />
            </>
          )}
        </div>
      </div>
    </Box>
  );
}

/** Every word on the liveries, as plain text, so hidden words are easy to spot. */
function LiveryText({ liveries }: { liveries: unknown }) {
  const lvs = Array.isArray(liveries) ? (liveries as J[]) : [];
  const words = lvs.flatMap((lv, i) => [
    ...(lv?.name ? [`Livery ${i + 1} name: ${lv.name}`] : []),
    ...(Array.isArray(lv?.layers) ? lv.layers : []).filter((l: J) => l?.kind === 'text').map((l: J) => `Livery ${i + 1} text: ${l.airlineName ? '(airline name)' : l.registration ? '(registration)' : l.text ?? ''}`),
  ]);
  const logos = new Set(lvs.flatMap((lv) => [lv?.badge, ...(Array.isArray(lv?.layers) ? lv.layers.map((l: J) => l?.logo) : [])]).filter((h): h is string => typeof h === 'string'));
  return (
    <div style={{ fontSize: 12.5, color: C.textDim, display: 'grid', gap: 2 }}>
      {words.length ? words.map((w, i) => <span key={i} style={{ overflowWrap: 'anywhere' }}>{w}</span>) : <span style={{ color: C.muted }}>No text on the liveries.</span>}
      {logos.size > 0 && (
        <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
          Logos:
          {[...logos].map((h) => (
            <a key={h} href="#/logos" title={h}>
              <Logo hash={h} size={28} />
            </a>
          ))}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Airlines
// ---------------------------------------------------------------------------
function Airlines({ channel, me }: Ctx) {
  const [q, setQ] = useState('');
  const [typed, setTyped] = useState('');
  const r = useLoad(() => rpc<J[]>('admin_airlines', { p_channel: channel, p_q: q, p_limit: 100 }), [channel, q]);
  return (
    <div>
      <H1>Airlines</H1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setQ(typed);
        }}
        style={{ display: 'flex', gap: 6, marginBottom: 12 }}
      >
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`Name, code, callsign or friend code${me.role === 'owner' ? ', or @username' : ''}`} aria-label="Search" style={{ ...inputStyle, flex: 1 }} />
        <Button type="submit" variant="primary">
          Search
        </Button>
      </form>
      <Err e={r.error} />
      <div style={{ display: 'grid', gap: 6 }}>
        {r.data?.length === 0 && <Muted>None found.</Muted>}
        {r.data?.map((a) => <AirlineRow key={a.id} a={a} />)}
      </div>
    </div>
  );
}

const PAINT_ON = ['a320-200', 'b737-800', 'a350-900'];

function Painted({ liveries, name }: { liveries: unknown; name: string }) {
  const [pics, setPics] = useState<{ label: string; url: string | null }[] | null>(null);
  useEffect(() => {
    let live = true;
    const lvs = Array.isArray(liveries) ? (liveries as J[]) : [];
    void (async () => {
      const hashes = new Set<string>();
      for (const lv of lvs) {
        if (typeof lv?.badge === 'string') hashes.add(lv.badge);
        for (const l of Array.isArray(lv?.layers) ? lv.layers : []) if (typeof l?.logo === 'string') hashes.add(l.logo);
      }
      const art: Record<string, string> = {};
      await Promise.all([...hashes].slice(0, 10).map(async (h) => {
        const u = await logoPicture(h);
        if (u) art[h] = u;
      }));
      const out: { label: string; url: string | null }[] = [];
      for (const [i, raw] of lvs.slice(0, 2).entries()) {
        const lv = liveryFromProfile(raw, art);
        if (!lv) continue;
        for (const m of PAINT_ON) out.push({ label: `${i === 0 ? 'Main' : raw?.name || 'Special'} · ${m.toUpperCase()}`, url: await paintedPhoto(m, lv, name, 'G-ADMN', 640).catch(() => null) });
      }
      if (live) setPics(out);
    })();
    return () => {
      live = false;
    };
  }, [liveries, name]);
  if (!pics) return <Muted>Painting the liveries…</Muted>;
  if (!pics.length) return <Muted>No liveries shared (or hidden by a moderator).</Muted>;
  return (
    <div style={grid(220)}>
      {pics.map((p, i) => (
        <figure key={i} style={{ margin: 0 }}>
          <div style={{ aspectRatio: '2.8', borderRadius: 10, background: 'linear-gradient(#9cc3e6, #dcebf7)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
            {p.url ? <img src={p.url} alt={p.label} style={{ width: '90%' }} /> : <span style={{ fontSize: 12, color: '#334155' }}>Couldn’t paint</span>}
          </div>
          <figcaption style={{ fontSize: 11.5, color: C.muted, marginTop: 3 }}>{p.label}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function Airline({ channel, id }: Ctx & { id: string }) {
  const r = useLoad(() => rpc<J | null>('admin_airline', { p_channel: channel, p_id: id }), [channel, id]);
  const a = r.data;
  if (r.error) return <Err e={r.error} />;
  if (a === undefined) return <Muted>Loading…</Muted>;
  if (a === null) return <Muted>This airline isn’t shared in {channel === 'main' ? 'the live game' : 'the test builds'} (any more).</Muted>;
  const base = { p_channel: channel, p_id: id };
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <Logo hash={a.badge} colours={a.colours} text={a.code} size={64} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <H1>{a.airline}</H1>
          <div style={{ fontSize: 13, color: C.muted, marginTop: -10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {[a.code, a.callsign || '(no callsign)', a.mode === 'sandbox' ? 'Sandbox' : 'Career'].join(' · ')} <Swatches colours={a.colours} />
            {a.suspended && <Pill tone="red">Suspended</Pill>}
            {a.lockedUntil && new Date(a.lockedUntil) > new Date() && <Pill tone="amber">Reset until {day(a.lockedUntil)}</Pill>}
            {a.liveriesHidden && <Pill tone="amber">Liveries hidden</Pill>}
          </div>
        </div>
      </div>
      <div style={grid(150)}>
        <Tile label="Fleet" value={a.fleet ?? '?'} />
        <Tile label="Friends" value={a.friends} />
        <Tile label="Shared since" value={<span style={{ fontSize: 16 }}>{day(a.sharedAt)}</span>} />
        <Tile label="Account since" value={<span style={{ fontSize: 16 }}>{day(a.accountSince)}</span>} />
        <Tile label="Their other airlines" value={a.otherAirlines} />
        <Tile label="Times reported" value={a.timesReported} warn={a.timesReported > 0} />
        <Tile label="Times actioned" value={a.timesActioned} warn={a.timesActioned > 0} />
      </div>
      <Box title="Liveries">
        <div style={{ display: 'grid', gap: 12 }}>
          <Painted liveries={a.liveries} name={a.airline} />
          <LiveryText liveries={a.liveries} />
        </div>
      </Box>
      <div style={grid(320)}>
        <Box title="About">
          <div style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            <span>Alliance: {a.alliance ? <a href={`#/alliances/${a.alliance.id}`} style={{ color: C.accent }}>{a.alliance.tag} {a.alliance.name}</a> : 'none'}</span>
            <span>Friend code: <span className="num">{a.friendCode}</span></span>
            <span>Flights on friends’ maps: {a.mapOn ? 'on' : 'off'}</span>
            <span>Last updated: {when(a.updatedAt)}</span>
            {a.username && <span>Username (owner only): @{a.username}</span>}
            {a.suspension && <span style={{ color: C.red }}>Suspended {a.suspension.until ? `until ${day(a.suspension.until)}` : 'for good'}: {a.suspension.reason}</span>}
            {a.stats && <span style={{ color: C.muted }}>Summary: {Object.entries(a.stats).map(([k, v]) => `${k} ${v}`).join(', ')}</span>}
          </div>
        </Box>
        <Box title="Actions">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Change
              label="Reset name"
              days="required"
              fields={[
                { value: 'airline', label: 'Name' },
                { value: 'code', label: 'Code' },
                { value: 'callsign', label: 'Callsign' },
              ]}
              note="Other players see a safe stand-in (such as “Airline 4821”) for that many days, whatever the game sends. The player gets a notice."
              run={(reason, x) => act('admin_airline_reset', { ...base, p_fields: x.fields, p_days: x.days, p_reason: reason })}
              onDone={r.reload}
            />
            <Change label="Hide liveries" disabled={a.liveriesHidden} note="Other players see the standard livery until the player changes theirs." run={(reason) => act('admin_airline_hide_liveries', { ...base, p_reason: reason })} onDone={r.reload} />
            <Change
              label="Suspend from sharing"
              danger
              days="optional"
              note="Every airline this player shares stops being shared now, in both the live game and the test builds, and they can’t share again until it ends. Their careers keep working."
              run={(reason, x) => act('admin_suspend', { p_channel: channel, p_airline: id, p_days: x.days, p_reason: reason })}
              onDone={r.reload}
            />
          </div>
        </Box>
      </div>
      <Box title="Reports about it">
        <History items={a.reports} />
      </Box>
      <Box title="What moderators did">
        <History items={a.actions} />
      </Box>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alliances
// ---------------------------------------------------------------------------
function Alliances({ channel }: Ctx) {
  const [q, setQ] = useState('');
  const [typed, setTyped] = useState('');
  const r = useLoad(() => rpc<J[]>('admin_alliances', { p_channel: channel, p_q: q }), [channel, q]);
  return (
    <div>
      <H1>Alliances</H1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setQ(typed);
        }}
        style={{ display: 'flex', gap: 6, marginBottom: 12 }}
      >
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Name or tag" aria-label="Search" style={{ ...inputStyle, flex: 1 }} />
        <Button type="submit" variant="primary">
          Search
        </Button>
      </form>
      <Err e={r.error} />
      <div style={{ display: 'grid', gap: 6 }}>
        {r.data?.length === 0 && <Muted>None found.</Muted>}
        {r.data?.map((a) => (
          <Row key={a.id} href={`#/alliances/${a.id}`}>
            <Logo hash={a.logo} colours={a.colours} text={a.tag} size={34} />
            <span style={{ flex: '1 1 200px', minWidth: 0 }}>
              <b style={{ fontSize: 14 }}>{a.name}</b> <span style={{ fontSize: 12, color: C.muted }}>{a.tag} · {a.members} airlines · led by {a.leader ?? '?'} · since {day(a.createdAt)}</span>
            </span>
            {a.openReports > 0 && <Pill tone="amber">{a.openReports} open report{a.openReports === 1 ? '' : 's'}</Pill>}
          </Row>
        ))}
      </div>
    </div>
  );
}

function Alliance({ channel, id }: Ctx & { id: string }) {
  const r = useLoad(() => rpc<J | null>('admin_alliance', { p_channel: channel, p_id: id }), [channel, id]);
  const a = r.data;
  if (r.error) return <Err e={r.error} />;
  if (a === undefined) return <Muted>Loading…</Muted>;
  if (a === null) return <Muted>This alliance isn’t there (any more).</Muted>;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <Logo hash={a.logo} colours={a.colours} text={a.tag} size={64} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <H1>{a.name}</H1>
          <div style={{ fontSize: 13, color: C.muted, marginTop: -10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {a.tag} · {a.mode === 'sandbox' ? 'Sandbox' : 'Career'} · {a.members} of 20 airlines · since {day(a.createdAt)} <Swatches colours={a.colours} />
            {a.lockedUntil && new Date(a.lockedUntil) > new Date() && <Pill tone="amber">Locked until {day(a.lockedUntil)}</Pill>}
          </div>
        </div>
      </div>
      <Box title="Description">{a.description ? <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{a.description}</p> : <Muted>None.</Muted>}</Box>
      <Box title="Actions">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Change
            label="Reset"
            days="required"
            fields={[
              { value: 'name', label: 'Name' },
              { value: 'tag', label: 'Tag' },
              { value: 'description', label: 'Description' },
              { value: 'logo', label: 'Logo' },
            ]}
            note="A safe stand-in (such as “Alliance 4821”), and the leader can’t edit it for that many days. The leader gets a notice."
            run={(reason, x) => act('admin_alliance_reset', { p_channel: channel, p_id: id, p_fields: x.fields, p_days: x.days, p_reason: reason })}
            onDone={r.reload}
          />
          <Change label="Disband" danger note="Ends the alliance for everyone in it. Each airline gets a notice." run={(reason) => act('admin_alliance_disband', { p_channel: channel, p_alliance: id, p_reason: reason })} onDone={() => (location.hash = '/alliances')} />
        </div>
      </Box>
      <Box title={`Airlines (${a.memberList.length})`}>
        <div style={{ display: 'grid', gap: 6 }}>
          {a.memberList.map((m: J) => (
            <div key={m.id} style={{ display: 'grid', gap: 4 }}>
              <AirlineRow a={m} extra={<span style={{ fontSize: 12, color: C.muted }}>{m.role === 'leader' ? 'Leader · ' : ''}joined {day(m.joinedAt)}</span>} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: 10 }}>
                {m.role !== 'leader' && <Change label="Make leader" run={(reason) => act('admin_alliance_lead', { p_channel: channel, p_alliance: id, p_airline: m.id, p_reason: reason })} onDone={r.reload} />}
                <Change label="Remove from alliance" danger run={(reason) => act('admin_alliance_kick', { p_channel: channel, p_alliance: id, p_airline: m.id, p_reason: reason })} onDone={r.reload} />
              </div>
            </div>
          ))}
        </div>
      </Box>
      <Box title={`Invited (${a.invites.length})`}>
        <div style={{ display: 'grid', gap: 6 }}>{a.invites.length ? a.invites.map((m: J) => <AirlineRow key={m.id} a={m} extra={<span style={{ fontSize: 12, color: C.muted }}>invited {day(m.invitedAt)}</span>} />) : <Muted>Nobody.</Muted>}</div>
      </Box>
      <Box title="History">
        <History items={a.history} />
      </Box>
      <Box title="Reports about it">
        <History items={a.reports} />
      </Box>
      <Box title="What moderators did">
        <History items={a.actions} />
      </Box>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Marketplace: open listings and recent trades. Flags: the same two airlines
// trading again and again, or prices right at the edge of the allowed band.
// ---------------------------------------------------------------------------
const money = (n: number) => `${(n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })}M`;
const modelName = (id: string) => AIRCRAFT_BY_ID.get(id)?.name ?? id;

function Market({ channel }: Ctx) {
  const r = useLoad(() => rpc<J>('admin_market', { p_channel: channel }), [channel]);
  const [only, setOnly] = useState(false);
  const m = r.data;
  if (r.error) return <Err e={r.error} />;
  if (!m) return <Muted>Loading…</Muted>;
  const trades = (m.trades as J[]).filter((t) => !only || t.pair || t.edge);
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <H1 right={<Button size="sm" variant="subtle" onClick={r.reload}>Refresh</Button>}>Marketplace</H1>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Tile label="Open listings" value={m.open} />
        <Tile label="Trades in the last day" value={m.tradesToday} />
        <Tile label="Flagged (recent)" value={(m.trades as J[]).filter((t) => (t.pair || t.edge) && !t.reversedAt).length} warn={(m.trades as J[]).some((t) => (t.pair || t.edge) && !t.reversedAt)} />
      </div>
      <Box
        title="Recent trades"
        right={
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Only flagged
          </label>
        }
      >
        <div style={{ display: 'grid', gap: 8 }}>
          {trades.length === 0 && <Muted>None.</Muted>}
          {trades.map((t) => (
            <div key={t.id} style={{ display: 'grid', gap: 6, padding: '8px 10px', borderRadius: 10, background: C.raised }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
                <b>{modelName(t.model)}</b>
                <span style={{ color: C.muted }}>{t.tail}</span>
                <b>{money(t.price)}</b>
                {t.lo != null && <span style={{ color: C.muted }}>(allowed {money(t.lo)}–{money(t.hi)})</span>}
                <span style={{ color: C.muted }}>· {t.mode === 'sandbox' ? 'Sandbox' : 'Career'} · {when(t.at)}</span>
                {t.pair && <Pill tone="amber">Same two airlines, 3+ trades</Pill>}
                {t.edge && <Pill tone="amber">Price at the edge</Pill>}
                {t.reversedAt && <Pill tone="muted">Reversed {day(t.reversedAt)}</Pill>}
              </div>
              <div style={{ fontSize: 13 }}>
                {t.seller ? <a href={`#/airlines/${t.seller}`}>{t.sellerLabel}</a> : t.sellerLabel} sold to {t.buyer ? <a href={`#/airlines/${t.buyer}`}>{t.buyerLabel}</a> : t.buyerLabel}
                {t.reversedReason && <span style={{ color: C.muted }}> · reversed: {t.reversedReason}</span>}
              </div>
              {!t.reversedAt && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <Change label="Reverse" danger note="The aircraft goes back to the seller and the buyer gets their money back, next time each game is open. Both get a notice." run={(reason) => act('admin_market_reverse', { p_channel: channel, p_trade: t.id, p_reason: reason })} onDone={r.reload} />
                </div>
              )}
            </div>
          ))}
        </div>
      </Box>
      <Box title={`Open listings (${(m.listings as J[]).length})`}>
        <div style={{ display: 'grid', gap: 8 }}>
          {(m.listings as J[]).length === 0 && <Muted>None.</Muted>}
          {(m.listings as J[]).map((l) => (
            <div key={l.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '8px 10px', borderRadius: 10, background: C.raised, fontSize: 13 }}>
              <b>{modelName(l.model)}</b>
              <span style={{ color: C.muted }}>{l.tail}</span>
              <b>{money(l.price)}</b>
              <span style={{ color: C.muted }}>
                · <a href={`#/airlines/${l.seller}`}>{l.sellerLabel}</a> · {l.mode === 'sandbox' ? 'Sandbox' : 'Career'} · listed {day(l.createdAt)}
              </span>
              <span style={{ flex: 1 }} />
              <Change label="Take down" danger note="The aircraft goes back to the seller's fleet. They get a notice." run={(reason) => act('admin_market_remove', { p_channel: channel, p_listing: l.id, p_reason: reason })} onDone={r.reload} />
            </div>
          ))}
        </div>
      </Box>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Logos
// ---------------------------------------------------------------------------
function Logos({ channel }: Ctx) {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState<LogoRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [cards, setCards] = useState<Record<string, J>>({});
  const [alliances, setAlliances] = useState<J[]>([]);
  const [bg, setBgState] = useState(() => { try { return localStorage.getItem('bp_admin_logo_bg') || '#ffffff'; } catch { return '#ffffff'; } });
  const setBg = (v: string) => { setBgState(v); try { localStorage.setItem('bp_admin_logo_bg', v); } catch { /* fine */ } };
  const [zoom, setZoom] = useState<string | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async (before?: number) => {
    setError('');
    try {
      const got = await listLogos(status, before);
      // Logos from before 7 Nov 2026 may not know their airline yet (blank)
      const ids = [...new Set(got.logos.flatMap((l) => l.owners.map((o) => o.airline)))].filter((x) => /^[0-9a-f-]{36}$/i.test(x));
      const [c, al] = await Promise.all([ids.length ? rpc<Record<string, J>>('admin_cards', { p_ids: ids }) : Promise.resolve({}), got.logos.length ? rpc<J[]>('admin_logo_alliances', { p_hashes: got.logos.map((l) => l.hash) }) : Promise.resolve([])]);
      setCards((x) => ({ ...x, ...c }));
      setAlliances((x) => [...(before ? x : []), ...al]);
      setRows((x) => [...(before ? x ?? [] : []), ...got.logos]);
      setMore(got.more);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [status]);
  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);
  const decide = async (hash: string, action: 'approve' | 'remove', reason: string) => {
    await actOnLogo(hash, action, reason);
    if (action === 'remove') forgetPicture(hash);
    setRows((x) => (x ?? []).map((r) => (r.hash === hash ? { ...r, status: action === 'approve' ? 'approved' : 'rejected', reviewedAt: Date.now() } : r)));
  };
  return (
    <div>
      <H1
        right={
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputStyle, width: 'auto' }} aria-label="Which logos">
            <option value="pending">Waiting for review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Removed</option>
            <option value="all">All</option>
          </select>
        }
      >
        Logos
      </H1>
      <Muted>Newest first. Both the live game and the test builds share one store. Removing a logo deletes the file, hides it everywhere, and stops the same picture being uploaded again.</Muted>
      <div style={{ height: 12 }} />
      <LogoBackground value={bg} onChange={setBg} />
      <div style={{ height: 12 }} />
      <Err e={error} />
      {rows?.length === 0 && <Muted>None.</Muted>}
      <div style={grid(250)}>
        {rows?.map((l) => (
          <Box key={l.hash}>
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                {l.status === 'rejected' ? <span style={{ width: 96, height: 96, borderRadius: 14, background: C.raised, display: 'grid', placeItems: 'center', fontSize: 12, color: C.muted }}>Removed</span> : <Logo hash={l.hash} size={96} bg={bg} onOpen={() => setZoom(l.hash)} />}
                <div style={{ fontSize: 12, color: C.muted, display: 'grid', gap: 2, minWidth: 0 }}>
                  <Pill tone={l.status === 'pending' ? 'amber' : l.status === 'approved' ? 'green' : 'red'}>{l.status === 'pending' ? 'Waiting' : l.status === 'approved' ? 'Approved' : 'Removed'}</Pill>
                  <span>Uploaded {when(l.createdAt)}</span>
                  <span>{(l.bytes / 1024).toFixed(1)} KB · {l.players} player{l.players === 1 ? '' : 's'}</span>
                </div>
              </div>
              <div style={{ display: 'grid', gap: 3, fontSize: 12.5 }}>
                <span style={{ color: C.muted }}>Used by</span>
                {l.owners.length === 0 && <span style={{ color: C.muted }}>No airline now</span>}
                {l.owners.map((o) => {
                  const c = cards[o.airline];
                  return c ? (
                    <a key={o.channel + o.airline} href={`#/airlines/${o.airline}`} onClick={(e) => o.channel !== channel && e.preventDefault()} style={{ color: C.accent, overflowWrap: 'anywhere' }}>
                      {c.airline} ({c.code}){o.channel !== channel ? ` · ${o.channel === 'dev' ? 'test builds' : 'live game'}` : ''}
                    </a>
                  ) : (
                    <span key={o.channel + o.airline} style={{ color: C.muted }}>{o.airline ? 'An airline no longer shared' : 'An older upload, airline not known'} ({o.channel === 'dev' ? 'test builds' : 'live game'})</span>
                  );
                })}
                {alliances.filter((a) => a.logo === l.hash).map((a) => (
                  <a key={a.id} href={`#/alliances/${a.id}`} style={{ color: C.accent }}>
                    Alliance {a.tag} {a.name}
                  </a>
                ))}
              </div>
              {l.status !== 'rejected' && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {l.status === 'pending' && (
                    <Button size="sm" variant="primary" onClick={() => void decide(l.hash, 'approve', 'Approved in review').catch((e) => setError(e.message))}>
                      Approve
                    </Button>
                  )}
                  <Change label="Remove" danger note="For good: the file is deleted and the picture is blocked. Each airline using it gets a notice." run={(reason) => decide(l.hash, 'remove', reason)} onDone={() => undefined} />
                </div>
              )}
            </div>
          </Box>
        ))}
      </div>
      {zoom && <LogoZoom hash={zoom} bg={bg} onBg={setBg} onClose={() => setZoom(null)} />}
      {more && rows && (
        <div style={{ marginTop: 12 }}>
          <Button onClick={() => void load(rows[rows.length - 1].createdAt)}>More</Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin log and team
// ---------------------------------------------------------------------------
function Log({ me }: Ctx) {
  const [rows, setRows] = useState<J[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const more = useCallback(async (before: number | null) => {
    try {
      const got = await rpc<J[]>('admin_log_list', { p_before: before, p_limit: 100 });
      setRows((x) => [...(before ? x : []), ...got]);
      setDone(got.length < 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void more(null);
  }, [more]);
  const exportAll = async () => {
    const all: J[] = [];
    let before: number | null = null;
    for (;;) {
      const got: J[] = await rpc<J[]>('admin_log_list', { p_before: before, p_limit: 1000 });
      all.push(...got);
      if (got.length < 1000) break;
      before = got[got.length - 1].id;
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `boarding-pass-admin-log-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div>
      <H1 right={me.role === 'owner' ? <Button onClick={() => void exportAll().catch((e) => setError(e.message))}>Export all</Button> : undefined}>Admin log</H1>
      <Muted>Every change by anyone, kept 12 months. It can’t be edited or deleted from here.</Muted>
      <div style={{ height: 10 }} />
      <Err e={error} />
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: C.muted }}>
              {['When', 'Who', 'What', 'Where', 'Item', 'Why', 'Before → after'].map((h) => (
                <th key={h} style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line}`, fontWeight: 650 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ verticalAlign: 'top' }}>
                <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap' }}>{when(r.at)}</td>
                <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line}` }}>{r.by}</td>
                <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line}` }}>{actionLabel(r.action)}</td>
                <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line}` }}>{r.channel === 'dev' ? 'Test' : r.channel === 'main' ? 'Live' : 'All'}</td>
                <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line}`, maxWidth: 160, overflowWrap: 'anywhere' }}>
                  {r.kind === 'airline' ? <a href={`#/airlines/${r.target}`} style={{ color: C.accent }}>airline</a> : r.kind === 'alliance' ? <a href={`#/alliances/${r.target}`} style={{ color: C.accent }}>alliance</a> : `${r.kind} ${String(r.target).slice(0, 10)}…`}
                </td>
                <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line}`, maxWidth: 220, overflowWrap: 'anywhere' }}>{r.reason}</td>
                <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line}`, maxWidth: 320, overflowWrap: 'anywhere', color: C.textDim, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                  {r.before ? JSON.stringify(r.before).slice(0, 200) : '–'} → {r.after ? JSON.stringify(r.after).slice(0, 200) : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && !error && <Muted>Nothing yet.</Muted>}
      {!done && rows.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <Button onClick={() => void more(rows[rows.length - 1].id)}>Older</Button>
        </div>
      )}
    </div>
  );
}

function Team({ me }: Ctx) {
  const t = useLoad(() => rpc<J[]>('admin_team'), []);
  const [name, setName] = useState('');
  const [role, setRole] = useState<'moderator' | 'owner'>('moderator');
  const owner = me.role === 'owner';
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <H1>Team</H1>
      <Muted>Each admin also needs their email added in Cloudflare Access, and two-factor on their account.</Muted>
      <Err e={t.error} />
      <div style={{ display: 'grid', gap: 6 }}>
        {t.data?.map((a) => (
          <Row key={a.id}>
            <span style={{ flex: '1 1 240px', fontSize: 14 }}>
              <b>{a.name}</b> <span style={{ color: C.muted, fontSize: 12.5 }}>· {a.role === 'owner' ? 'Owner' : 'Moderator'} · since {day(a.since)}{a.id === me.id ? ' · you' : ''}</span>
            </span>
            {owner && a.id !== me.id && <Change label="Remove" danger run={(reason) => act('admin_team_remove', { p_user: a.id, p_reason: reason })} onDone={t.reload} />}
          </Row>
        ))}
      </div>
      {owner && (
        <Box title="Add someone">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Their Boarding Pass username" aria-label="Username" style={{ ...inputStyle, flex: '1 1 220px' }} />
            <select value={role} onChange={(e) => setRole(e.target.value as 'moderator' | 'owner')} style={{ ...inputStyle, width: 'auto' }} aria-label="Role">
              <option value="moderator">Moderator</option>
              <option value="owner">Owner</option>
            </select>
            <Change label="Add" disabled={!name.trim()} run={(reason) => act('admin_team_add', { p_username: name.trim(), p_role: role, p_reason: reason })} onDone={() => (setName(''), t.reload())} />
          </div>
        </Box>
      )}
    </div>
  );
}
