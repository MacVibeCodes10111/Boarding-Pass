import { useEffect, useMemo, useRef, useState } from 'react';
import { AIRCRAFT_BY_ID } from '../game/aircraftCatalog';
import { AIRCRAFT_PHOTOS } from '../game/aircraftPhotos';
import { normaliseAirlineColours, normaliseLiveries, normaliseLogo, standardLivery } from '../game/livery';
import { moderate } from '../game/moderation';
import { formatMoneyM } from '../game/time';
import type { Airport, GameMode, SaveGameState } from '../game/types';
import { AircraftHero, LiveryContext } from './AircraftPhoto';
import { CHANGED_EVENT, SaveLocation, ago } from './CloudPanel';
import { cloudOverview, cloudPicks, importDaysLeft, isOnlineCareer, mightBeSignedIn, prepareOnlineCareer, type CloudOverview } from '../game/cloud';
import { Icon } from '../ui/icons';
import { Button, C, DISPLAY, Field, IconButton, SearchInput, faceHi, inputStyle, glass } from '../ui/kit';
import { useLayout } from '../ui/layout';
import { APP_VERSION } from '../version';
import { CreditsModal } from './Credits';
import { openAppearance } from './Appearance';
import { DevTag } from './DashboardChrome';
import { inDesktopApp } from './UpdateBanner';

/** The Boarding Pass website (the game itself is on play.boardingpass.my). */
const WEBSITE = 'https://boardingpass.my';
const NEW = 'new';

export interface HomeScreenProps {
  airlineName: string;
  airlineIata: string;
  airlineCallsign: string;
  hubIata: string;
  gameMode: GameMode;
  onChange: (patch: Partial<{ airlineName: string; airlineIata: string; airlineCallsign: string; hubIata: string; gameMode: GameMode }>) => void;
  airports: Airport[];
  airportByIata: Map<string, Airport>;
  savedGames: SaveGameState[];
  onLaunch: () => void;
  onResume: (save: SaveGameState) => void;
  onDeleteSave: (saveId: string) => void;
  /** Only while importing is open (90 days after online careers). */
  onImportFile: (file: File) => void;
  /** Opens the account: sign in, and the player's airlines. */
  onAccount: () => void;
  /** Downloads a career kept in the account and opens it. */
  onPlayCloud: (saveId: string) => Promise<void>;
  toast: (message: string) => void;
}

/** One of the player's airlines: its aircraft in its livery, a few figures, and Play. */
function AirlineCard({ sv, onPlay, onDelete }: { sv: SaveGameState; onPlay: () => void; onDelete: () => void }) {
  // Straight from a save: everything goes through its normaliser before it's drawn
  const livery = useMemo(() => {
    try {
      const liveries = sv.liveries === undefined && !sv.livery ? [standardLivery(normaliseAirlineColours(sv.airlineColours))] : normaliseLiveries(sv.liveries, sv.livery);
      return { liveries, name: sv.airlineName, logo: normaliseLogo(sv.airlineLogo) };
    } catch {
      return null;
    }
  }, [sv]);
  // Its most common aircraft type that has a picture
  const pick = useMemo(() => {
    const n = new Map<string, { tail: string; livery?: number; k: number }>();
    for (const a of sv.fleet ?? []) {
      const id = a?.model?.id;
      if (id && AIRCRAFT_PHOTOS[id] && AIRCRAFT_BY_ID.has(id)) n.set(id, { tail: a.tailNumber, livery: a.livery, k: (n.get(id)?.k ?? 0) + 1 });
    }
    const [best] = [...n.entries()].sort((a, b) => b[1].k - a[1].k);
    return best ? { model: AIRCRAFT_BY_ID.get(best[0])!, tail: best[1].tail, livery: best[1].livery } : null;
  }, [sv]);
  const model = pick?.model ?? AIRCRAFT_BY_ID.get('a320neo');
  const hubs = sv.hubs ?? [sv.hubIata];
  const sandbox = sv.gameMode === 'sandbox';
  const stat = (label: string, value: string) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, color: C.muted }}>{label}</div>
      <div className="num" style={{ fontFamily: DISPLAY, fontSize: 21, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value}
      </div>
    </div>
  );
  return (
    <div>
      {model && livery && (
        <LiveryContext.Provider value={livery}>
          <AircraftHero model={model} tailNumber={pick?.tail ?? ''} liveryIndex={pick?.livery} style={{ borderRadius: 14, marginBottom: 18 }} />
        </LiveryContext.Provider>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 700, lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sv.airlineName}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.muted, marginTop: 3 }}>
            <span>
              {sv.airlineIata} · {sandbox ? 'Sandbox' : 'Career'}
              {sv.econPaused ? ' · Paused' : ''}
            </span>
            <SaveLocation save={sv} />
          </div>
        </div>
        <IconButton icon="trash" label={`Delete ${sv.airlineName}`} color={C.faint} onClick={onDelete} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 20 }}>
        {stat('Aircraft', (sv.fleet?.length ?? 0).toLocaleString())}
        {stat(hubs.length === 1 ? 'Hub' : 'Hubs', hubs.length <= 3 ? hubs.join(' ') : `${hubs.length}`)}
        {stat('Cash', sandbox ? '∞' : formatMoneyM(sv.cash))}
      </div>
      <Button variant="primary" size="lg" block onClick={onPlay}>
        <Icon name="play" size={18} />
        Play
      </Button>
    </div>
  );
}

type Category = 'career' | 'sandbox';
type CloudCareer = CloudOverview['saves'][number];

/** A Career kept in the account but not on this device yet: Play downloads it. */
function CloudOnlyCard({ c, busy, onPlay }: { c: CloudCareer; busy: boolean; onPlay: () => void }) {
  return (
    <div>
      <div style={{ borderRadius: 14, marginBottom: 18, aspectRatio: '3 / 1', background: `linear-gradient(135deg, ${C.raised}, ${C.bg})`, display: 'grid', placeItems: 'center' }}>
        <Icon name="globe" size={42} color={C.faint} />
      </div>
      <h2 style={{ margin: 0, fontSize: 28, fontWeight: 700, lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.airline || 'Your airline'}</h2>
      <div style={{ fontSize: 13, color: C.muted, marginTop: 3, marginBottom: 20 }}>
        Career · last played {c.fromThisDevice ? 'here' : `on ${c.fromName || 'another device'}`} · {ago(Date.parse(c.updatedAt))}
      </div>
      <Button variant="primary" size="lg" block disabled={busy} onClick={onPlay}>
        <Icon name="play" size={18} />
        {busy ? 'Opening…' : 'Play'}
      </Button>
    </div>
  );
}

export function HomeScreen(props: HomeScreenProps) {
  const link: React.CSSProperties = { font: 'inherit', fontSize: 13, fontWeight: 500, background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: '6px 0', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', minHeight: 32 };
  const { airlineName, airlineIata, airlineCallsign, hubIata, onChange, airports, airportByIata, savedGames } = props;
  const [hubSearch, setHubSearch] = useState('');
  const [showCredits, setShowCredits] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(mightBeSignedIn);
  // The account's careers, from the server (null until it answers, or offline)
  const [overview, setOverview] = useState<CloudOverview | null>(null);
  const phone = useLayout() === 'phone';
  const importRef = useRef<HTMLInputElement | null>(null);
  const currentHub = airportByIata.get(hubIata);
  const nameProblem = moderate(airlineName) ?? moderate(airlineCallsign) ?? moderate(airlineIata);
  const canLaunch = Boolean(currentHub) && airlineName.trim() !== '' && /^[A-Z0-9]{2,3}$/.test(airlineIata) && !nameProblem;

  // Signed in or out (here or in the Account window), and the server's list of careers
  useEffect(() => {
    let alive = true;
    let last = 0;
    const load = async (force = false) => {
      const on = mightBeSignedIn();
      setSignedIn(on);
      if (!on) return setOverview(null);
      // Never more than one call every 20 seconds, whatever asks
      if (!force && Date.now() - last < 20_000) return;
      last = Date.now();
      try {
        const o = await cloudOverview();
        if (alive) setOverview(o);
      } catch {
        /* offline: the careers on this device still show */
      }
    };
    void load(true);
    const again = () => void load();
    // Not onCloudChange: loading the list announces a change itself, so that would loop
    window.addEventListener(CHANGED_EVENT, again);
    window.addEventListener('focus', again);
    const t = window.setInterval(() => {
      if (mightBeSignedIn() !== signedInRef.current) void load(true);
    }, 1500);
    return () => {
      alive = false;
      window.removeEventListener(CHANGED_EVENT, again);
      window.removeEventListener('focus', again);
      window.clearInterval(t);
    };
  }, []);
  const signedInRef = useRef(signedIn);
  signedInRef.current = signedIn;

  // Careers: what the server has (newest first), with this device's copy when there is one
  const careers = useMemo(() => {
    const local = new Map(savedGames.filter(isOnlineCareer).map((s) => [s.saveId, s]));
    if (!signedIn) return [];
    if (!overview) {
      // Offline: the careers this device knows are online
      const picks = cloudPicks();
      return savedGames.filter((s) => isOnlineCareer(s) && (picks === null || picks.has(s.saveId))).map((s) => ({ id: s.saveId, sv: s as SaveGameState | undefined, cloud: undefined as CloudCareer | undefined }));
    }
    const server = [...overview.saves].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const picked = new Set(overview.picks.map((p) => p.saveId));
    const rows = server.map((c) => ({ id: c.saveId, sv: local.get(c.saveId), cloud: c as CloudCareer | undefined }));
    // Picked but not uploaded yet (it goes up when it's played)
    for (const s of local.values()) if (picked.has(s.saveId) && !rows.some((r) => r.id === s.saveId)) rows.push({ id: s.saveId, sv: s, cloud: undefined });
    return rows;
  }, [savedGames, overview, signedIn]);
  const onlineIds = new Set(careers.map((c) => c.id));
  // Careers made before online careers, still only on this device
  const deviceOnly = signedIn && overview ? savedGames.filter((s) => isOnlineCareer(s) && !onlineIds.has(s.saveId)) : [];
  const sandboxes = savedGames.filter((s) => !isOnlineCareer(s));
  const daysLeft = importDaysLeft(overview?.importUntil);
  const importOpen = daysLeft === null || daysLeft > 0;

  // Opens on the airline played last: the newest career when signed in, else the newest sandbox
  const cat: Category = category ?? (signedIn && careers.length ? 'career' : sandboxes.length && !signedIn ? 'sandbox' : 'career');
  const list = cat === 'career' ? careers.map((c) => c.id) : sandboxes.map((s) => s.saveId);
  const tab = picked === NEW ? NEW : list.find((id) => id === picked) ?? list[0] ?? NEW;
  const mode: GameMode = cat === 'career' ? 'standard' : 'sandbox';
  useEffect(() => {
    if (props.gameMode !== mode) onChange({ gameMode: mode });
  }, [mode, props.gameMode, onChange]);

  const matches = useMemo(() => {
    const q = hubSearch.trim().toLowerCase();
    const pool = q
      ? airports.filter((a) => [a.iata_code, a.municipality, a.name, a.iso_country].some((s) => (s || '').toLowerCase().includes(q)))
      : airports;
    // The exact code first when searching; the airport already picked first when not
    const first = q || hubIata.toLowerCase();
    return [...pool]
      .sort((a, b) => Number(b.iata_code.toLowerCase() === first) - Number(a.iata_code.toLowerCase() === first) || b.demand_weight - a.demand_weight)
      .slice(0, 5);
  }, [airports, hubSearch, hubIata]);

  // Behind everything: every airport in the game as a faint dot, like a departures map
  const dots = useMemo(
    () => airports.map((a) => `M${(((a.longitude_deg + 180) / 360) * 1600).toFixed(1)} ${(((90 - a.latitude_deg) / 180) * 800).toFixed(1)}h0`).join(''),
    [airports]
  );

  const tabButton = (id: string, label: React.ReactNode, title: string) => {
    const on = tab === id;
    return (
      <button
        key={id}
        type="button"
        className="bp-tab"
        role="tab"
        aria-selected={on}
        aria-current={on ? 'page' : undefined}
        title={title}
        onClick={() => setPicked(id)}
        style={{ flex: 'none', height: 38, padding: '0 14px', borderRadius: 10, whiteSpace: 'nowrap', cursor: 'pointer', fontFamily: DISPLAY, fontSize: 17, fontWeight: on ? 700 : 600, color: on ? C.text : C.muted, background: on ? faceHi() : 'transparent', border: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 220 }}
      >
        {label}
      </button>
    );
  };
  const airlineTab = (id: string, iata: string, name: string) =>
    tabButton(
      id,
      <>
        {iata && <span style={{ color: tab === id ? C.brand : C.faint }}>{iata}</span>}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
      </>,
      name
    );

  const bringOnline = async (sv: SaveGameState) => {
    setBusy(sv.saveId);
    try {
      const g = await prepareOnlineCareer(sv);
      if (g.kind === 'ok') {
        props.toast(`${sv.airlineName} is now in your account`);
        setOverview(await cloudOverview().catch(() => overview));
        setCategory('career');
        setPicked(sv.saveId);
        setShowImport(false);
      } else if (g.kind === 'refused' || g.kind === 'error') props.toast(g.message);
      else if (g.kind === 'offline') props.toast('You’re offline. Connect to the internet and try again.');
      else if (g.kind === 'signin') props.onAccount();
      else props.toast('Open it with Play to choose which copy to keep.');
    } finally {
      setBusy(null);
    }
  };

  const playCloud = async (saveId: string) => {
    setBusy(saveId);
    try {
      await props.onPlayCloud(saveId);
    } catch (e) {
      props.toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const newAirline = (
    <div>
      <div className="bp-home-names" style={{ display: 'grid', gridTemplateColumns: phone ? '1fr 80px' : '1fr 84px 1fr', gap: 12, marginBottom: 16 }}>
        <Field label="Name">
          <input value={airlineName} onChange={(e) => onChange({ airlineName: e.target.value })} style={{ ...inputStyle, fontWeight: 600 }} />
        </Field>
        <Field label="Code">
          <input
            maxLength={3}
            value={airlineIata}
            onChange={(e) => onChange({ airlineIata: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
            style={{ ...inputStyle, fontWeight: 650, color: C.brand, textAlign: 'center' }}
          />
        </Field>
        <Field label="Callsign">
          <input value={airlineCallsign} onChange={(e) => onChange({ airlineCallsign: e.target.value.toUpperCase() })} style={{ ...inputStyle }} />
        </Field>
      </div>

      <Field label="Home airport" style={{ marginBottom: 16 }}>
        <SearchInput value={hubSearch} onChange={setHubSearch} placeholder="City or code" />
        <div style={{ marginTop: 6 }}>
          {matches.map((ap) => {
            const sel = ap.iata_code === hubIata;
            return (
              <button
                key={ap.iata_code}
                type="button"
                className="bp-row"
                aria-pressed={sel}
                onClick={() => onChange({ hubIata: ap.iata_code })}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', textAlign: 'left', border: 'none', background: sel ? `${C.brand}24` : 'transparent', color: C.text, cursor: 'pointer' }}
              >
                <span style={{ width: 40, fontFamily: DISPLAY, fontSize: 17, fontWeight: 700, color: sel ? C.brand : C.text }}>{ap.iata_code}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {ap.municipality}, {ap.iso_country} <span style={{ color: C.faint }}>{ap.name}</span>
                </span>
                {sel && <Icon name="check" size={16} color={C.brand} />}
              </button>
            );
          })}
          {matches.length === 0 && <div style={{ padding: 10, fontSize: 13, color: C.muted }}>No airport found.</div>}
        </div>
      </Field>

      <div style={{ fontSize: 13, color: C.muted, marginBottom: 14 }}>
        {cat === 'career' ? 'Career: start with $150M. Kept in your account and played online.' : 'Sandbox: unlimited money. Kept on this device and plays offline.'}
      </div>

      <Button variant="primary" size="lg" block disabled={!canLaunch} onClick={props.onLaunch}>
        {currentHub ? `Start at ${currentHub.iata_code}` : 'Pick a home airport'}
      </Button>
      {!canLaunch && currentHub && <div style={{ fontSize: 12.5, color: C.amber, marginTop: 8 }}>{nameProblem ?? 'Add a name and a 2 or 3 character code.'}</div>}
    </div>
  );

  // Signed out, Career: careers live in the account
  const careerSignedOut = (
    <div style={{ textAlign: 'center', padding: phone ? '24px 4px' : '36px 12px' }}>
      <Icon name="globe" size={40} color={C.brand} />
      <h2 style={{ margin: '12px 0 6px', fontSize: 26, fontWeight: 700 }}>Your careers live in your account</h2>
      <p style={{ margin: '0 auto', maxWidth: 360, fontSize: 14, color: C.muted, lineHeight: 1.5 }}>Log in to play them on any device. Sandbox airlines stay on this device and play offline.</p>
    </div>
  );

  const importPanel = (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 700 }}>Import</h2>
      <p style={{ margin: '0 0 16px', fontSize: 13.5, color: C.muted, lineHeight: 1.5 }}>
        {daysLeft === null ? 'Bring careers from before online play into your account.' : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left to bring careers from before online play into your account.`} Each career can come
        online once. After that, careers still only on a device play as Sandbox.
      </p>
      {deviceOnly.length === 0 && <div style={{ fontSize: 13.5, color: C.muted, marginBottom: 14 }}>No careers on this device are waiting to come online.</div>}
      <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
        {deviceOnly.map((sv) => (
          <div key={sv.saveId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, background: C.raised }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ color: C.brand }}>{sv.airlineIata}</span> {sv.airlineName}
              </div>
              <div className="num" style={{ fontSize: 12, color: C.muted }}>
                {(sv.fleet?.length ?? 0).toLocaleString()} aircraft · {formatMoneyM(sv.cash)}
              </div>
            </div>
            <Button variant="primary" disabled={busy !== null} onClick={() => void bringOnline(sv)}>
              {busy === sv.saveId ? 'Importing…' : 'Import'}
            </Button>
          </div>
        ))}
      </div>
      <Button block onClick={() => importRef.current?.click()}>
        Open a save file (plays as Sandbox)
      </Button>
      <input
        ref={importRef}
        type="file"
        accept=".boardingpass,.json,application/json,application/octet-stream"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) props.onImportFile(file);
          e.target.value = ''; // allow re-importing the same file
        }}
        style={{ display: 'none' }}
      />
    </div>
  );

  const careerRow = careers.find((c) => c.id === tab);
  const sandbox = sandboxes.find((s) => s.saveId === tab);
  let body: React.ReactNode;
  if (cat === 'career' && !signedIn) body = careerSignedOut;
  else if (cat === 'career' && showImport && importOpen) body = importPanel;
  else if (cat === 'career' && careerRow?.sv) body = <AirlineCard key={careerRow.id} sv={careerRow.sv} onPlay={() => props.onResume(careerRow.sv!)} onDelete={() => props.onDeleteSave(careerRow.id)} />;
  else if (cat === 'career' && careerRow?.cloud) body = <CloudOnlyCard key={careerRow.id} c={careerRow.cloud} busy={busy === careerRow.id} onPlay={() => void playCloud(careerRow.id)} />;
  else if (cat === 'sandbox' && sandbox) body = <AirlineCard key={sandbox.saveId} sv={sandbox} onPlay={() => props.onResume(sandbox)} onDelete={() => props.onDeleteSave(sandbox.saveId)} />;
  else body = newAirline;

  const catButton = (c: Category, label: string, count: number) => {
    const on = cat === c;
    return (
      <button
        type="button"
        role="tab"
        aria-selected={on}
        onClick={() => {
          setCategory(c);
          setPicked(null);
          setShowImport(false);
        }}
        style={{ flex: 1, height: 46, borderRadius: 12, border: 'none', cursor: 'pointer', fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, color: on ? C.brandInk : C.muted, background: on ? C.brand : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
      >
        {label}
        {count > 0 && <span className="num" style={{ fontSize: 14, opacity: 0.7 }}>{count}</span>}
      </button>
    );
  };

  return (
    <div
      style={{
        width: '100vw',
        height: '100dvh',
        overflowY: 'auto',
        color: C.text,
        position: 'relative',
        background: `radial-gradient(1200px 700px at 25% -10%, ${C.raised} 0%, transparent 65%), ${C.bg}`,
        display: 'flex',
        justifyContent: 'center',
        padding: phone ? 'calc(20px + var(--bp-safe-t)) calc(14px + var(--bp-safe-r)) calc(28px + var(--bp-safe-b)) calc(14px + var(--bp-safe-l))' : 'calc(32px + var(--bp-safe-t)) 32px calc(32px + var(--bp-safe-b))',
        alignItems: phone ? 'flex-start' : 'center',
      }}
    >
      <svg aria-hidden viewBox="0 0 1600 800" preserveAspectRatio="xMidYMid slice" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        <path d={dots} stroke={C.border} strokeWidth={2.4} strokeLinecap="round" opacity={0.75} />
      </svg>
      <div style={{ position: 'relative', width: '100%', maxWidth: 580, margin: 'auto 0' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: phone ? 16 : 22 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: C.brand, color: C.brandInk, display: 'grid', placeItems: 'center', flex: 'none' }}>
            <Icon name="fleet" size={26} />
          </div>
          <h1 style={{ flex: 1, minWidth: 0, margin: 0, fontSize: phone ? 28 : 34, fontWeight: 700, lineHeight: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
            Boarding Pass <DevTag big />
          </h1>
          {signedIn && (
            <Button onClick={props.onAccount}>
              <Icon name="globe" size={16} />
              Account
            </Button>
          )}
        </header>

        {!signedIn && (
          <Button variant="primary" size="lg" block onClick={props.onAccount}>
            <Icon name="globe" size={18} />
            Log in
          </Button>
        )}

        <section aria-label="Your airlines" style={{ ...glass('e8'), borderRadius: 20, overflow: 'hidden', marginTop: signedIn ? 0 : 12 }}>
          {/* Two kinds of airline: Careers (online, in the account) and Sandbox (this device) */}
          <div role="tablist" aria-label="Kind of airline" style={{ display: 'flex', gap: 6, padding: 10, paddingBottom: 0 }}>
            {catButton('career', 'Career', signedIn ? careers.length : 0)}
            {catButton('sandbox', 'Sandbox', sandboxes.length)}
          </div>
          {!(cat === 'career' && !signedIn) && (
            <div role="tablist" aria-label="Airlines" className="bp-scroll-x" style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 10, overflowX: 'auto', borderBottom: `1px solid ${C.line}` }}>
              {cat === 'career'
                ? careers.map((c) => airlineTab(c.id, c.sv?.airlineIata ?? '', c.sv?.airlineName ?? c.cloud?.airline ?? 'Airline'))
                : sandboxes.map((s) => airlineTab(s.saveId, s.airlineIata, s.airlineName))}
              {tabButton(
                NEW,
                <>
                  <Icon name="plus" size={15} />
                  New
                </>,
                cat === 'career' ? 'New career' : 'New sandbox airline'
              )}
              {cat === 'career' && importOpen && (
                <>
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    aria-pressed={showImport}
                    onClick={() => setShowImport((v) => !v)}
                    title="Bring careers from before online play into your account"
                    style={{ flex: 'none', height: 38, padding: '0 12px', borderRadius: 10, whiteSpace: 'nowrap', cursor: 'pointer', fontFamily: DISPLAY, fontSize: 16, fontWeight: 700, color: C.amber, background: showImport ? faceHi() : `${C.amber}1c`, border: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <Icon name="download" size={15} />
                    Import
                    {daysLeft !== null && <span className="num" style={{ fontWeight: 600, opacity: 0.85 }}>· {daysLeft}d left</span>}
                    {deviceOnly.length > 0 && (
                      <span className="num" style={{ minWidth: 18, height: 18, borderRadius: 9, background: C.amber, color: C.bg, fontSize: 12, display: 'grid', placeItems: 'center', padding: '0 5px' }}>
                        {deviceOnly.length}
                      </span>
                    )}
                  </button>
                </>
              )}
            </div>
          )}
          <div role="tabpanel" style={{ padding: phone ? 16 : 24 }}>
            {body}
          </div>
        </section>

        <footer className="bp-home-links" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 18, marginTop: 12, padding: '0 4px' }}>
          <button type="button" onClick={openAppearance} style={link}>
            Appearance
          </button>
          <button type="button" onClick={() => setShowCredits(true)} style={link}>
            Credits
          </button>
          {!inDesktopApp() && (
            <>
              <a href={WEBSITE} style={link}>
                Website
              </a>
              <a href={`${WEBSITE}/#download`} style={link}>
                Get the app
              </a>
            </>
          )}
          <span style={{ flex: 1 }} />
          <span className="num" style={{ fontSize: 12.5, color: C.faint }}>
            {APP_VERSION}
          </span>
        </footer>
      </div>
      {showCredits && <CreditsModal onClose={() => setShowCredits(false)} />}
    </div>
  );
}
