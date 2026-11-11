import { useMemo, useRef, useState } from 'react';
import { AIRCRAFT_BY_ID } from '../game/aircraftCatalog';
import { AIRCRAFT_PHOTOS } from '../game/aircraftPhotos';
import { normaliseAirlineColours, normaliseLiveries, normaliseLogo, standardLivery } from '../game/livery';
import { moderate } from '../game/moderation';
import { formatMoneyM } from '../game/time';
import type { Airport, GameMode, SaveGameState } from '../game/types';
import { AircraftHero, LiveryContext } from './AircraftPhoto';
import { CloudCareersOnHome, SaveLocation } from './CloudPanel';
import { Icon } from '../ui/icons';
import { Button, C, DISPLAY, Field, IconButton, SearchInput, Segmented, faceHi, inputStyle, glass } from '../ui/kit';
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
  onImportFile: (file: File) => void;
  /** Opens the account: sign in, and the player's airlines. */
  onAccount: () => void;
  /** An airline was downloaded from the cloud: re-read the save slots. */
  onCloudDownloaded: () => void;
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

export function HomeScreen(props: HomeScreenProps) {
  const link: React.CSSProperties = { font: 'inherit', fontSize: 13, fontWeight: 500, background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: '6px 0', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', minHeight: 32 };
  const { airlineName, airlineIata, airlineCallsign, hubIata, gameMode, onChange, airports, airportByIata, savedGames } = props;
  const [hubSearch, setHubSearch] = useState('');
  const [showCredits, setShowCredits] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const phone = useLayout() === 'phone';
  const importRef = useRef<HTMLInputElement | null>(null);
  const currentHub = airportByIata.get(hubIata);
  const nameProblem = moderate(airlineName) ?? moderate(airlineCallsign) ?? moderate(airlineIata);
  const canLaunch = Boolean(currentHub) && airlineName.trim() !== '' && /^[A-Z0-9]{2,3}$/.test(airlineIata) && !nameProblem;

  // The tab: the airline picked, or the one played last, or the new-airline form when there are none
  const tab = picked === NEW ? NEW : savedGames.find((s) => s.saveId === picked)?.saveId ?? savedGames[0]?.saveId ?? NEW;
  const airline = savedGames.find((s) => s.saveId === tab);

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

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <Segmented<GameMode>
          value={gameMode}
          onChange={(m) => onChange({ gameMode: m })}
          options={[
            { value: 'standard', label: 'Career' },
            { value: 'sandbox', label: 'Sandbox' },
          ]}
        />
        <span style={{ fontSize: 13, color: C.muted }}>{gameMode === 'standard' ? 'Start with $150M' : 'Unlimited money'}</span>
      </div>

      <Button variant="primary" size="lg" block disabled={!canLaunch} onClick={props.onLaunch}>
        {currentHub ? `Start at ${currentHub.iata_code}` : 'Pick a home airport'}
      </Button>
      {!canLaunch && currentHub && <div style={{ fontSize: 12.5, color: C.amber, marginTop: 8 }}>{nameProblem ?? 'Add a name and a 2 or 3 character code.'}</div>}
      <div style={{ textAlign: 'center', marginTop: 10 }}>
        <button type="button" onClick={() => importRef.current?.click()} style={{ ...link, fontSize: 12.5 }}>
          Open a save file
        </button>
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
    </div>
  );

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
        padding: phone ? '20px 14px calc(28px + env(safe-area-inset-bottom, 0px))' : 32,
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
          <Button onClick={props.onAccount}>
            <Icon name="globe" size={16} />
            Account
          </Button>
        </header>

        <CloudCareersOnHome onDownloaded={props.onCloudDownloaded} toast={props.toast} />

        <section aria-label="Your airlines" style={{ ...glass('e8'), borderRadius: 20, overflow: 'hidden' }}>
          {/* One tab per airline, then a new one */}
          <div role="tablist" aria-label="Airlines" className="bp-scroll-x" style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 10, overflowX: 'auto', borderBottom: `1px solid ${C.line}` }}>
            {savedGames.map((sv) =>
              tabButton(
                sv.saveId,
                <>
                  <span style={{ color: tab === sv.saveId ? C.brand : C.faint }}>{sv.airlineIata}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{sv.airlineName}</span>
                </>,
                sv.airlineName
              )
            )}
            {tabButton(
              NEW,
              <>
                <Icon name="plus" size={15} />
                New
              </>,
              'New airline'
            )}
          </div>
          <div role="tabpanel" style={{ padding: phone ? 16 : 24 }}>
            {airline ? <AirlineCard key={airline.saveId} sv={airline} onPlay={() => props.onResume(airline)} onDelete={() => props.onDeleteSave(airline.saveId)} /> : newAirline}
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
