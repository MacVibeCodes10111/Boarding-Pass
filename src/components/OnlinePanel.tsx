// ============================================================================
// THE ONLINE WINDOW (Update A)
//   Everything shared with other players, apart from cloud saves. To get in, a
//   player has to be 13 or over, open the legal documents, agree to them, and be
//   signed in. Nothing is sent anywhere until they sign in. New documents
//   (LEGAL_VERSION in features.ts) bring the legal step back.
//   Each tab shows what's coming while its feature flag is off.
//   In a career it's a side panel like the others (OnlineSidePanel); on the
//   main menu, a window (OnlineHost).
//
//   Everything is per airline. Inside a career, it's about that career: share it,
//   its friends, its map. On the main menu, the player picks one of the airlines
//   they've shared; sharing a new one happens inside it.
// ============================================================================
import { useEffect, useState } from 'react';
import { MAX_SHARED_AIRLINES, ageStatus, airlineFor, currentUser, inDesktopApp, logoReview, myAirlines, onCloudChange, openExternal, refreshFeatures, refreshLogoReview, setMapSharing, shareCareer, stopSharing, type AgeStatus, type CloudUser, type MyAirline } from '../game/cloud';
import { LEGAL_DOCS, acceptLegal, featureOn, legalAccepted, onFeaturesChange } from '../game/features';
import { onlineModeOf, type OnlineMode } from '../game/profile';
import { readSaveSlots } from '../game/saves';
import type { SaveGameState } from '../game/types';
import { Icon } from '../ui/icons';
import { Button, C, DISPLAY, ModalShell, Segmented, SidePanel, inputStyle } from '../ui/kit';
import { AgeCheck, CHANGED_EVENT, SignInForm, openCloud } from './CloudPanel';
import { AlliancesTab } from './AlliancesTab';
import { ConfirmButton, FriendsTab } from './FriendsTab';
import { MarketTab, type MarketHooks } from './MarketTab';
import { checkNotices } from './ReportButton';
import type { MapStyleId } from './LiveMap';
import type { Airport } from '../game/types';

const OPEN_EVENT = 'bp-open-online';
type Act = (label: string, fn: () => Promise<unknown>) => Promise<void>;
export type OnlineTab = 'airline' | 'friends' | 'alliances' | 'market';
type Tab = OnlineTab;

/** Opens Online from anywhere: the window on the main menu, the panel in a career. */
export const openOnline = () => window.dispatchEvent(new Event(OPEN_EVENT));
/** Listens for openOnline() (the career's panel uses this). */
export function onOpenOnline(fn: () => void): () => void {
  window.addEventListener(OPEN_EVENT, fn);
  return () => window.removeEventListener(OPEN_EVENT, fn);
}

type Where = { career?: () => SaveGameState; airports?: ReadonlyMap<string, Airport>; mapStyle?: MapStyleId; market?: MarketHooks; startTab?: Tab };

/** The main menu's Online window. */
export function OnlineHost(props: Where) {
  const [open, setOpen] = useState(false);
  useEffect(() => onOpenOnline(() => setOpen(true)), []);
  if (!open) return null;
  const close = () => setOpen(false);
  return (
    <ModalShell onClose={close} maxWidth={620} label="Online">
      <div style={{ padding: '4px 4px 2px' }}>
        <h2 style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 700, margin: '0 0 4px' }}>Online</h2>
        <p style={{ fontSize: 13.5, color: C.muted, margin: '0 0 14px', lineHeight: 1.45 }}>Share your airline with other players. It’s optional: the game works fully without it.</p>
        <OnlineContent {...props} onClose={close} />
      </div>
    </ModalShell>
  );
}

/** Online in a career: a side panel like Bank or Fleet. */
export function OnlineSidePanel(props: Where & { airlineName: string; onClose: () => void }) {
  const [, redraw] = useState(0);
  useEffect(() => onCloudChange(() => redraw((n) => n + 1)), []);
  const shared = airlineFor(props.career?.().saveId);
  return (
    <SidePanel
      title="Online"
      width={880}
      onClose={props.onClose}
      subtitle={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>{props.airlineName}</span>
          <span style={{ fontSize: 12, fontWeight: 650, padding: '1px 8px', borderRadius: 999, border: `1px solid ${shared ? C.green : C.border}`, color: shared ? C.green : C.muted }}>{shared ? `Shared · ${modeLabel(shared.mode)}` : 'Not shared'}</span>
        </span>
      }
    >
      <OnlineContent {...props} />
    </SidePanel>
  );
}

function OnlineContent(props: Where & { onClose: () => void }) {
  const [user, setUser] = useState<CloudUser | null | undefined>(undefined);
  const [age, setAge] = useState<AgeStatus>(ageStatus());
  const [agreed, setAgreed] = useState(legalAccepted);
  const [flagsRead, setFlagsRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [, redraw] = useState(0);

  const refresh = async () => {
    try {
      const u = await currentUser();
      setUser(u);
      setAgreed(legalAccepted());
      if (u) await refreshFeatures();
      setFlagsRead(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setUser(null);
    }
  };
  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener(CHANGED_EVENT, onChange);
    const stopFeatures = onFeaturesChange(() => redraw((n) => n + 1));
    const stopCloud = onCloudChange(() => redraw((n) => n + 1));
    return () => {
      window.removeEventListener(CHANGED_EVENT, onChange);
      stopFeatures();
      stopCloud();
    };
  }, []);

  const act: Act = async (label, fn) => {
    setBusy(true);
    setError('');
    setStatus(label);
    try {
      await fn();
      setStatus('');
    } catch (e) {
      setStatus('');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const body = () => {
    if (user === undefined) return <p style={{ color: C.muted, fontSize: 13 }}>Checking…</p>;
    if (!user && age === 'unknown') return <AgeCheck onDone={setAge} />;
    if (!user && age === 'under13') return <p style={{ fontSize: 13.5, lineHeight: 1.5 }}>Online features are for players 13 and over. Everything else in the game works the same without them.</p>;
    if (!agreed) return <LegalGate onDone={() => setAgreed(true)} />;
    if (!user) return <SignInForm busy={busy} act={act} agreed />;
    if (!flagsRead) return <p style={{ color: C.muted, fontSize: 13 }}>Checking…</p>;
    if (!featureOn('online')) return <p style={{ fontSize: 13.5, lineHeight: 1.5 }}>Online features aren’t open yet. They’ll appear here when they’re ready.</p>;
    return <OnlineArea user={user} busy={busy} act={act} onClose={props.onClose} career={props.career} airports={props.airports} mapStyle={props.mapStyle} market={props.market} startTab={props.startTab} />;
  };

  return (
    <div>
      {body()}
      <div role="status" aria-live="polite" style={{ minHeight: 18, marginTop: 10, fontSize: 13, color: error ? C.red : C.muted }}>
        {error || status}
      </div>
    </div>
  );
}

/** Each document has to be opened before the player can agree to them. */
function LegalGate(props: { onDone: () => void }) {
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [agree, setAgree] = useState(false);
  const allOpened = LEGAL_DOCS.every((d) => opened.has(d.url));
  const desktop = inDesktopApp();
  return (
    <div>
      <p style={{ fontWeight: 650, fontSize: 14.5, margin: '0 0 4px' }}>First, please read these</p>
      <p style={{ fontSize: 13, color: C.muted, margin: '0 0 12px', lineHeight: 1.45 }}>They say what other players can see, what we keep, and the rules for what you share. Open each one to continue.</p>
      <div style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
        {LEGAL_DOCS.map((d) => {
          const seen = opened.has(d.url);
          return (
            <a
              key={d.url}
              href={d.url}
              target={desktop ? undefined : '_blank'}
              rel="noreferrer"
              onClick={(e) => {
                if (desktop) {
                  e.preventDefault();
                  void openExternal(d.url);
                }
                setOpened((s) => new Set(s).add(d.url));
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 10, background: C.raised, border: `1px solid ${seen ? C.green : C.border}`, color: C.text, textDecoration: 'none', fontWeight: 650, fontSize: 14 }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>{d.label}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 600, color: seen ? C.green : C.accent }}>
                {seen && <Icon name="check" size={14} />}
                {seen ? 'Opened' : 'Open'}
              </span>
            </a>
          );
        })}
      </div>
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13.5, lineHeight: 1.45, marginBottom: 12, cursor: allOpened ? 'pointer' : 'default', color: allOpened ? C.text : C.muted }}>
        <input type="checkbox" checked={agree} disabled={!allOpened} onChange={(e) => setAgree(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1, flex: 'none' }} />
        <span>I’ve read these and agree to the Terms of use and Privacy policy.</span>
      </label>
      <Button
        variant="primary"
        size="lg"
        block
        disabled={!allOpened || !agree}
        onClick={() => {
          acceptLegal();
          props.onDone();
        }}
      >
        Continue
      </Button>
    </div>
  );
}

function OnlineArea(props: Where & { user: CloudUser; busy: boolean; act: Act; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>(props.startTab ?? 'airline');
  useEffect(() => {
    if (props.startTab) setTab(props.startTab);
  }, [props.startTab, props.market?.sellTail]);
  const inGame = props.career !== undefined;
  const current = props.career?.() ?? null;
  const airlines = myAirlines();
  // On the main menu the player picks which of their shared airlines to look at; in a game it's the one being played
  const [pick, setPick] = useState<string | null>(null);
  const selected = inGame ? airlineFor(current?.saveId) : airlines.find((a) => a.id === pick) ?? airlines[0] ?? null;
  const selectedId = selected?.id ?? null;
  useEffect(() => {
    if (selectedId) void refreshLogoReview(selectedId);
  }, [selectedId]);
  // Anything a moderator changed shows straight away
  useEffect(() => {
    checkNotices();
  }, []);

  return (
    <div>
      {inGame ? null : (
        airlines.length > 0 && (
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: C.muted, marginBottom: 10 }}>
            Which airline
            <select value={selected?.id ?? ''} disabled={props.busy} onChange={(e) => setPick(e.target.value)} style={inputStyle}>
              {airlines.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.airline || a.code} · {modeLabel(a.mode)}
                </option>
              ))}
            </select>
          </label>
        )
      )}
      <Segmented<Tab>
        block
        value={tab}
        onChange={setTab}
        options={[
          { value: 'airline', label: inGame ? 'This airline' : 'My airlines' },
          { value: 'friends', label: 'Friends' },
          { value: 'alliances', label: 'Alliances' },
          { value: 'market', label: 'Marketplace' },
        ]}
      />
      <div style={{ marginTop: 12 }}>
        {tab === 'airline' && <AirlineTab busy={props.busy} act={props.act} current={inGame ? current : null} selected={selected} />}
        {tab === 'friends' &&
          (!featureOn('friends') ? (
            <ComingSoon icon="flag" title="Friends are on the way" lines={['Add friends with a private friend code.', 'Choose who can see your airline.', 'Block anyone you don’t want to hear from.']} />
          ) : selected ? (
            <FriendsTab me={selected} busy={props.busy} act={props.act} />
          ) : (
            <NotShared inGame={inGame} onShare={() => setTab('airline')} what="Friends belong to an airline" />
          ))}
        {tab === 'alliances' &&
          (!featureOn('alliances') || !featureOn('friends') ? (
            <ComingSoon icon="globe" title="Alliances are on the way" lines={['Start an alliance or join one, one at a time.', 'Up to 20 airlines in each.', 'See your alliance’s airlines together.']} />
          ) : selected ? (
            <AlliancesTab me={selected} busy={props.busy} act={props.act} career={inGame ? current : null} airports={props.airports} mapStyle={props.mapStyle} />
          ) : (
            <NotShared inGame={inGame} onShare={() => setTab('airline')} what="Alliances are made of airlines" />
          ))}
        {tab === 'market' &&
          (!featureOn('marketplace') ? (
            <ComingSoon icon="buy" title="The marketplace is on the way" lines={['Sell aircraft you own to other airlines.', 'Buy used aircraft for less than new.', 'Game money only.']} />
          ) : selected ? (
            <MarketTab me={selected} busy={props.busy} act={props.act} market={inGame ? props.market : undefined} />
          ) : (
            <NotShared inGame={inGame} onShare={() => setTab('airline')} what="The marketplace is for shared airlines" />
          ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.line}`, fontSize: 12.5, color: C.muted }}>
        <span style={{ flex: 1, minWidth: 0 }}>Signed in as {props.user.name}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            props.onClose();
            openCloud();
          }}
        >
          <Icon name="swap" size={14} />
          Account and cloud saves
        </Button>
      </div>
    </div>
  );
}

const modeLabel = (m: OnlineMode) => (m === 'sandbox' ? 'Sandbox' : 'Career');

/** Where to go when the airline being looked at isn't shared. */
function NotShared(props: { inGame: boolean; what: string; onShare: () => void }) {
  return (
    <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.5 }}>
      {props.what}, so share one first.{' '}
      {props.inGame ? (
        <button type="button" onClick={props.onShare} style={{ border: 0, padding: 0, background: 'none', color: C.accent, font: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}>
          Share this airline
        </button>
      ) : (
        'Open a career, then share it from Online there.'
      )}
    </p>
  );
}

function ComingSoon(props: { icon: 'flag' | 'globe' | 'buy'; title: string; lines: string[] }) {
  return (
    <div style={{ padding: '22px 16px', borderRadius: 12, background: C.raised, textAlign: 'center' }}>
      <Icon name={props.icon} size={28} color={C.muted} style={{ display: 'block', margin: '0 auto' }} />
      <p style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, margin: '8px 0 8px' }}>{props.title}</p>
      {props.lines.map((l) => (
        <p key={l} style={{ fontSize: 13, color: C.muted, margin: '0 0 3px', lineHeight: 1.45 }}>
          {l}
        </p>
      ))}
    </div>
  );
}

/**
 * In a game: share this career, or manage it once it's shared. On the main menu: the chosen shared
 * airline, which can be managed or stopped but not shared from here (sharing happens inside a career).
 */
function AirlineTab(props: { busy: boolean; act: Act; current: SaveGameState | null; selected: MyAirline | null }) {
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: C.raised };
  const sub: React.CSSProperties = { display: 'block', fontSize: 12, color: C.muted, lineHeight: 1.45 };
  const { current, selected } = props;
  if (!featureOn('profiles')) return <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>Nothing is shared with other players. Sharing options will appear here when they’re ready, all off until you turn them on.</p>;
  const unlocks = [
    featureOn('friends') && 'Add friends with a private friend code, and see their airlines.',
    featureOn('friends') && featureOn('friends_map') && 'Show your flights on friends’ maps, if you choose to.',
    featureOn('alliances') && 'Start or join an alliance of up to 20 airlines.',
    featureOn('marketplace') && 'Buy and sell used aircraft with other airlines, for game money only.',
    featureOn('reports') && 'Report anything that breaks the rules; a moderator checks it.',
  ].filter((x): x is string => !!x);
  const shown = `Friends can see its name, code, callsign, colours, liveries${featureOn('logos') ? ', logos (checked before other players see them)' : ''} and a summary such as fleet size. Never your money or your account.`;

  if (!selected) {
    if (!current)
      return (
        <div style={{ display: 'grid', gap: 6 }}>
          <p style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>You haven’t shared an airline yet.</p>
          <p style={{ fontSize: 12.5, color: C.muted, margin: 0, lineHeight: 1.5 }}>Open a career and choose Online there to share it. Each airline you share gets its own friend code and its own friends, up to {MAX_SHARED_AIRLINES} airlines.</p>
        </div>
      );
    const mode = onlineModeOf(current);
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        <p style={{ fontSize: 12.5, color: C.muted, margin: 0, lineHeight: 1.5 }}>Nothing is shared with other players unless you turn it on here.</p>
        {unlocks.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: C.textDim, lineHeight: 1.6 }}>
            {unlocks.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        )}
        <div style={{ ...row, display: 'grid', gap: 10 }}>
          <span>
            <span style={{ display: 'block', fontWeight: 650 }}>Share {current.airlineName}</span>
            <span style={sub}>
              It gets its own friend code and friends. {shown} As a {modeLabel(mode)} airline, it can only be friends with {modeLabel(mode)} airlines.
            </span>
          </span>
          <Button variant="primary" block disabled={props.busy} onClick={() => void props.act(`Sharing ${current.airlineName}…`, () => shareCareer(current))}>
            Share this airline
          </Button>
        </div>
      </div>
    );
  }

  const review = logoReview(selected.id);
  const career = current?.saveId === selected.saveId ? current : readSaveSlots().find((c) => c.saveId === selected.saveId);
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ ...row, display: 'grid', gap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 200px', minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 650 }}>{selected.airline} is shared</span>
            <span style={sub}>
              {modeLabel(selected.mode)} airline. {shown}
            </span>
          </span>
          <ConfirmButton label="Stop sharing" ask="Stop and delete" disabled={props.busy} onConfirm={() => void props.act('Stopping sharing…', () => stopSharing(selected.saveId))} />
        </span>
        <span style={sub}>Stopping deletes it from the server, with its friend code and its friends.</span>
        {review.waiting > 0 && (
          <span style={sub}>
            {review.waiting === 1 ? '1 logo is' : `${review.waiting} logos are`} waiting for review. Other players see your liveries without {review.waiting === 1 ? 'it' : 'them'} until then.
          </span>
        )}
        {review.refused > 0 && (
          <span style={sub}>
            {review.refused === 1 ? '1 logo wasn’t' : `${review.refused} logos weren’t`} approved, so other players won’t see {review.refused === 1 ? 'it' : 'them'}. You still will.
          </span>
        )}
      </div>
      {featureOn('friends') && featureOn('friends_map') && (
        <label style={{ ...row, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={selected.mapOn}
            disabled={props.busy}
            onChange={(e) => {
              const on = e.target.checked;
              void props.act(on ? 'Showing your flights…' : 'Stopping…', () => setMapSharing(selected.id, on, career));
            }}
            style={{ width: 18, height: 18, flex: 'none', accentColor: C.brand }}
          />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 650 }}>Show its aircraft on friends’ maps</span>
            <span style={sub}>Its weekly schedule: routes, flight numbers, times, aircraft types and registrations. Turning this off removes it. Friends see the flights on their own game’s clock.</span>
          </span>
        </label>
      )}
    </div>
  );
}
