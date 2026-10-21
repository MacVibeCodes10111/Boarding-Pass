import { useMemo, useRef, useState } from 'react';
import { getAirportMaxAircraftTier } from '../game/tiers';
import type { Airport, GameMode, SaveGameState } from '../game/types';
import { Icon } from '../ui/icons';
import { Button, C, Field, SearchInput, Segmented, inputStyle, glass } from '../ui/kit';
import { useLayout } from '../ui/layout';
import { APP_VERSION } from '../version';
import { CreditsModal } from './Credits';
import { openAppearance } from './Appearance';
import { inDesktopApp } from './UpdateBanner';

/** The Boarding Pass website (the game itself is on play.boardingpass.my). */
const WEBSITE = 'https://boardingpass.my';

export interface HomeScreenProps {
  airlineName: string;
  airlineIata: string;
  airlineCallsign: string;
  hubIata: string;
  gameMode: GameMode;
  onChange: (patch: Partial<{ airlineName: string; airlineIata: string; airlineCallsign: string; hubIata: string; gameMode: GameMode }>) => void;
  airports: Airport[];
  airportByIata: Map<string, Airport>;
  navaidsCount: number;
  aircraftCount: number;
  dataStatus: string;
  savedGames: SaveGameState[];
  onLaunch: () => void;
  onResume: (save: SaveGameState) => void;
  onDeleteSave: (saveId: string) => void;
  onImportFile: (file: File) => void;
}

export function HomeScreen(props: HomeScreenProps) {
  const { airlineName, airlineIata, airlineCallsign, hubIata, gameMode, onChange, airports, airportByIata, savedGames } = props;
  const [hubSearch, setHubSearch] = useState('');
  const [showCredits, setShowCredits] = useState(false);
  const phone = useLayout() === 'phone';
  const importRef = useRef<HTMLInputElement | null>(null);
  const currentHub = airportByIata.get(hubIata);
  const canLaunch = Boolean(currentHub) && airlineName.trim() !== '' && /^[A-Z0-9]{2,3}$/.test(airlineIata);

  const matches = useMemo(() => {
    const q = hubSearch.trim().toLowerCase();
    const pool = q
      ? airports.filter((a) => [a.iata_code, a.municipality, a.name, a.iso_country].some((s) => (s || '').toLowerCase().includes(q)))
      : airports;
    return [...pool]
      .sort((a, b) => Number(b.iata_code.toLowerCase() === q) - Number(a.iata_code.toLowerCase() === q) || b.demand_weight - a.demand_weight)
      .slice(0, 6);
  }, [airports, hubSearch]);

  // Behind everything: every airport in the game as a faint dot, like a departures map
  const dots = useMemo(
    () => airports.map((a) => `M${(((a.longitude_deg + 180) / 360) * 1600).toFixed(1)} ${(((90 - a.latitude_deg) / 180) * 800).toFixed(1)}h0`).join(''),
    [airports]
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
      <div className="bp-stack" style={{ position: 'relative', width: '100%', maxWidth: 1040, display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 28, margin: 'auto 0' }}>
        {/* New career */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 26 }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: C.brand, color: C.brandInk, display: 'grid', placeItems: 'center', flex: 'none', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.3), 0 3px 0 rgba(0,0,0,.3)' }}>
              <Icon name="fleet" size={32} />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 44, fontWeight: 700, lineHeight: 1 }}>Boarding Pass</h1>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
                Version {APP_VERSION}. {airports.length.toLocaleString()} airports, {props.aircraftCount} aircraft types.{' '}
                <button type="button" onClick={() => setShowCredits(true)} style={{ background: 'none', border: 'none', color: C.accent, fontSize: 13, cursor: 'pointer', padding: 0 }}>
                  Credits and licences
                </button>
                {' · '}
                <button type="button" onClick={openAppearance} style={{ background: 'none', border: 'none', color: C.accent, fontSize: 13, cursor: 'pointer', padding: 0 }}>
                  Appearance
                </button>
                {!inDesktopApp() && (
                  <>
                    {' · '}
                    <a href={WEBSITE} style={{ color: C.accent, textDecoration: 'none' }}>
                      boardingpass.my
                    </a>
                    {' · '}
                    <a href={`${WEBSITE}/#download`} style={{ color: C.accent, textDecoration: 'none' }}>
                      Get the app
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>

          <div style={{ ...glass('e8'), borderRadius: 16, padding: 22 }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 24, fontWeight: 700 }}>Start a new airline</h2>

            <div className="bp-home-names" style={{ display: 'grid', gridTemplateColumns: phone ? '1fr 80px' : '1fr 90px 1fr', gap: 12, marginBottom: 16 }}>
              <Field label="Airline name">
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
              <Field label="Radio callsign">
                <input value={airlineCallsign} onChange={(e) => onChange({ airlineCallsign: e.target.value.toUpperCase() })} style={{ ...inputStyle }} />
              </Field>
            </div>

            <Field label="Home hub" style={{ marginBottom: 16 }}>
              <SearchInput value={hubSearch} onChange={setHubSearch} placeholder="Search by airport code or city, e.g. BOS or Boston" />
              <div style={{ marginTop: 8, border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden' }}>
                {matches.map((ap, i) => {
                  const sel = ap.iata_code === hubIata;
                  return (
                    <button
                      key={ap.iata_code}
                      type="button"
                      className="bp-row"
                      onClick={() => onChange({ hubIata: ap.iata_code })}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '8px 12px',
                        textAlign: 'left',
                        border: 'none',
                        borderTop: i ? `1px solid ${C.line}` : 'none',
                        borderLeft: `3px solid ${sel ? C.brand : 'transparent'}`,
                        background: sel ? C.raised : 'transparent',
                        color: C.text,
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ width: 38, fontWeight: 650, color: sel ? C.brand : C.text }}>{ap.iata_code}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13 }}>
                          {ap.municipality}, {ap.iso_country}
                        </span>
                        <span style={{ display: 'block', fontSize: 11.5, color: C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ap.name}</span>
                      </span>
                      <span style={{ fontSize: 12, color: C.muted }}>up to {getAirportMaxAircraftTier(ap.max_runway_length_ft).sizeLabel.toLowerCase()}</span>
                    </button>
                  );
                })}
                {matches.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: C.muted }}>No airport matches “{hubSearch}”.</div>}
              </div>
            </Field>

            <Field label="Mode" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Segmented<GameMode>
                  value={gameMode}
                  onChange={(m) => onChange({ gameMode: m })}
                  options={[
                    { value: 'standard', label: 'Career' },
                    { value: 'sandbox', label: 'Sandbox' },
                  ]}
                />
                <span style={{ fontSize: 12.5, color: C.muted }}>
                  {gameMode === 'standard' ? 'Start with $150M and grow from there.' : 'Unlimited money to try anything.'}
                </span>
              </div>
            </Field>

            <Button variant="primary" size="lg" block disabled={!canLaunch} onClick={props.onLaunch}>
              {currentHub ? `Start at ${currentHub.iata_code}, ${currentHub.municipality}` : 'Pick a home hub'}
            </Button>
            {!canLaunch && currentHub && <div style={{ fontSize: 12, color: C.amber, marginTop: 8 }}>Enter an airline name and a 2–3 character code.</div>}
          </div>
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 12, whiteSpace: 'pre-line' }}>{props.dataStatus}</div>
        </div>

        {/* Saved careers */}
        <div style={{ ...glass('e0'), borderRadius: 16, padding: 22, marginTop: phone ? 0 : 82, alignSelf: 'start' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Continue</h2>
            <Button size="sm" variant="ghost" onClick={() => importRef.current?.click()}>
              <Icon name="upload" size={14} />
              Import save file
            </Button>
            <input
              ref={importRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) props.onImportFile(file);
                e.target.value = ''; // allow re-importing the same file
              }}
              style={{ display: 'none' }}
            />
          </div>

          {savedGames.length === 0 ? (
            <div style={{ border: `1px dashed ${C.border}`, borderRadius: 12, padding: '30px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
              No saved airlines yet. Your career saves itself every minute once you start.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10, maxHeight: 520, overflowY: 'auto' }}>
              {savedGames.map((sv) => (
                <div key={sv.saveId} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 8,
                      background: C.raised,
                      color: C.brand,
                      display: 'grid',
                      placeItems: 'center',
                      fontWeight: 750,
                      fontSize: 13,
                    }}
                  >
                    {sv.airlineIata}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 650, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sv.airlineName}</div>
                    <div className="num" style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                      {(sv.hubs ?? [sv.hubIata]).join(', ')}. {sv.fleet?.length ?? 0} aircraft, {sv.schedule?.length ?? 0} flights
                      {sv.econPaused ? ', paused' : ''}
                    </div>
                    <div style={{ fontSize: 11.5, color: C.faint }}>
                      {sv.isAutosave ? 'Autosaved' : 'Saved'} {sv.savedAt}
                    </div>
                  </div>
                  <Button variant="primary" onClick={() => props.onResume(sv)}>
                    Continue
                  </Button>
                  <button
                    type="button"
                    aria-label={`Delete ${sv.airlineName}`}
                    title="Delete save"
                    onClick={() => props.onDeleteSave(sv.saveId)}
                    style={{ background: 'none', border: 'none', color: C.faint, cursor: 'pointer', padding: 6 }}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {showCredits && <CreditsModal onClose={() => setShowCredits(false)} />}
    </div>
  );
}
