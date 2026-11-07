// ============================================================================
// THE ONLINE WINDOW (Update A)
//   Everything shared with other players, apart from cloud saves. To get in, a
//   player has to be 13 or over, open the legal documents, agree to them, and be
//   signed in. Nothing is sent anywhere until they sign in. New documents
//   (LEGAL_VERSION in features.ts) bring the legal step back.
//   Alliances show what's coming until their servers exist.
// ============================================================================
import { useEffect, useState } from 'react';
import { ageStatus, currentUser, inDesktopApp, logoReview, mapSharingOn, onCloudChange, openExternal, refreshFeatures, setMapSharing, shareCareer, sharedCareerId, stopSharing, type AgeStatus, type CloudUser } from '../game/cloud';
import { LEGAL_DOCS, acceptLegal, featureOn, legalAccepted, onFeaturesChange } from '../game/features';
import { readSaveSlots } from '../game/saves';
import type { SaveGameState } from '../game/types';
import { Icon } from '../ui/icons';
import { Button, C, DISPLAY, ModalShell, Segmented, inputStyle } from '../ui/kit';
import { AgeCheck, CHANGED_EVENT, SignInForm, openCloud } from './CloudPanel';
import { FriendsTab } from './FriendsTab';

const OPEN_EVENT = 'bp-open-online';
type Act = (label: string, fn: () => Promise<unknown>) => Promise<void>;
type Tab = 'airline' | 'friends' | 'alliances';

/** Opens the Online window from anywhere (the bottom bar, the home screen). */
export const openOnline = () => window.dispatchEvent(new Event(OPEN_EVENT));

export function OnlineHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);
  return open ? <OnlineModal onClose={() => setOpen(false)} /> : null;
}

function OnlineModal(props: { onClose: () => void }) {
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
    return <OnlineArea user={user} busy={busy} act={act} onClose={props.onClose} />;
  };

  return (
    <ModalShell onClose={props.onClose} maxWidth={500} label="Online">
      <div style={{ padding: '4px 4px 2px' }}>
        <h2 style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 700, margin: '0 0 4px' }}>Online</h2>
        <p style={{ fontSize: 13.5, color: C.muted, margin: '0 0 14px', lineHeight: 1.45 }}>Share your airline with other players. It’s optional: the game works fully without it.</p>
        {body()}
        <div role="status" aria-live="polite" style={{ minHeight: 18, marginTop: 10, fontSize: 13, color: error ? C.red : C.muted }}>
          {error || status}
        </div>
      </div>
    </ModalShell>
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

function OnlineArea(props: { user: CloudUser; busy: boolean; act: Act; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('airline');
  return (
    <div>
      <Segmented<Tab>
        block
        value={tab}
        onChange={setTab}
        options={[
          { value: 'airline', label: 'My airline' },
          { value: 'friends', label: 'Friends' },
          { value: 'alliances', label: 'Alliances' },
        ]}
      />
      <div style={{ marginTop: 12 }}>
        {tab === 'airline' && <AirlineTab busy={props.busy} act={props.act} />}
        {tab === 'friends' &&
          (featureOn('friends') ? (
            <FriendsTab busy={props.busy} act={props.act} onShareFirst={() => setTab('airline')} />
          ) : (
            <ComingSoon icon="flag" title="Friends are on the way" lines={['Add friends with a private friend code.', 'Choose who can see your airline.', 'Block anyone you don’t want to hear from.']} />
          ))}
        {tab === 'alliances' && (
          <ComingSoon icon="globe" title="Alliances are on the way" lines={['Start an alliance or join one, one at a time.', 'Up to 20 airlines in each.', 'See your alliance’s airlines together.']} />
        )}
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

function ComingSoon(props: { icon: 'flag' | 'globe'; title: string; lines: string[] }) {
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

function AirlineTab(props: { busy: boolean; act: Act }) {
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: C.raised };
  const profiles = featureOn('profiles');
  const careers = profiles ? readSaveSlots() : [];
  const shared = sharedCareerId();
  const share = (s: SaveGameState | undefined) => s && void props.act(`Sharing ${s.airlineName}…`, () => shareCareer(s));
  const review = logoReview();
  if (!profiles) return <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>Nothing is shared with other players. Sharing options will appear here when they’re ready, all off until you turn them on.</p>;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <p style={{ fontSize: 12.5, color: C.muted, margin: '0 0 2px' }}>Nothing is shared with other players unless you turn it on here.</p>
      {profiles && (
        <div style={{ ...row, display: 'grid', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={shared !== null}
              disabled={props.busy || (shared === null && careers.length === 0)}
              onChange={(e) => {
                if (e.target.checked) share(careers[0]);
                else void props.act('Stopping sharing…', stopSharing);
              }}
              style={{ width: 18, height: 18, flex: 'none', accentColor: C.brand }}
            />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 650 }}>Share my airline</span>
              <span style={{ display: 'block', fontSize: 12, color: C.muted }}>
                {careers.length === 0 && shared === null
                  ? 'Start a career first.'
                  : `Friends can see its name, code, callsign, colours, liveries${featureOn('logos') ? ', logos (checked before other players see them)' : ''} and a summary such as fleet size. Never your money or your account. Turning this off deletes it.`}
              </span>
            </span>
          </label>
          {shared !== null && careers.length > 0 && (
            <label style={{ display: 'grid', gap: 4, fontSize: 12, color: C.muted }}>
              Which career
              <select value={careers.some((c) => c.saveId === shared) ? shared : ''} disabled={props.busy} onChange={(e) => share(careers.find((c) => c.saveId === e.target.value))} style={inputStyle}>
                {!careers.some((c) => c.saveId === shared) && <option value="">A career on another device</option>}
                {careers.map((c) => (
                  <option key={c.saveId} value={c.saveId}>
                    {c.airlineName}
                  </option>
                ))}
              </select>
            </label>
          )}
          {shared !== null && review.waiting > 0 && (
            <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>
              {review.waiting === 1 ? '1 logo is' : `${review.waiting} logos are`} waiting for review. Other players see your liveries without {review.waiting === 1 ? 'it' : 'them'} until then.
            </p>
          )}
          {shared !== null && review.refused > 0 && (
            <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>
              {review.refused === 1 ? '1 logo wasn’t' : `${review.refused} logos weren’t`} approved, so other players won’t see {review.refused === 1 ? 'it' : 'them'}. You still will.
            </p>
          )}
        </div>
      )}
      {profiles && shared !== null && featureOn('friends') && featureOn('friends_map') && (
        <label style={{ ...row, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={mapSharingOn()}
            disabled={props.busy}
            onChange={(e) => {
              const on = e.target.checked;
              void props.act(on ? 'Showing your flights…' : 'Stopping…', () => setMapSharing(on, careers.find((c) => c.saveId === shared)));
            }}
            style={{ width: 18, height: 18, flex: 'none', accentColor: C.brand }}
          />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 650 }}>Show my aircraft on friends’ maps</span>
            <span style={{ display: 'block', fontSize: 12, color: C.muted }}>Your weekly schedule: routes, flight numbers, times, aircraft types and registrations. Turning this off removes it. Friends see your flights on their own game’s clock.</span>
          </span>
        </label>
      )}
    </div>
  );
}
