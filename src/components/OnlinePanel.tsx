// ============================================================================
// ONLINE (Update A; one account in v3.1)
//   One account covers everything: the player's airlines (kept in the cloud,
//   and online or not) and what an online airline does with other players:
//   friends, an alliance, the marketplace.
//   To sign in a player has to be 13 or over and agree to the terms. Before an
//   airline goes online they open the legal documents and agree to them
//   (LEGAL_VERSION in features.ts brings that step back for new documents).
//   Nothing is sent anywhere until they sign in.
//   In a career it's a side panel like the others (OnlineSidePanel), about the
//   airline being played. On the home screen it's the Account window
//   (OnlineHost): sign in, and the airlines.
// ============================================================================
import { useEffect, useState } from 'react';
import { ageStatus, airlineFor, currentUser, onCloudChange, refreshFeatures, shareCareer, type AgeStatus, type CloudUser } from '../game/cloud';
import { featureOn, legalAccepted, onFeaturesChange } from '../game/features';
import type { SaveGameState } from '../game/types';
import { Button, C, DISPLAY, EmptyState, ModalShell, SidePanel, type PanelTab } from '../ui/kit';
import { AccountView, LegalGate, type Act } from './Account';
import { AgeCheck, CHANGED_EVENT, SignInForm } from './CloudPanel';
import { AlliancesTab } from './AlliancesTab';
import { FriendsTab } from './FriendsTab';
import { MarketTab, type MarketHooks } from './MarketTab';
import { checkNotices } from './ReportButton';
import type { MapStyleId } from './LiveMap';
import type { Airport } from '../game/types';

const OPEN_EVENT = 'bp-open-online';
export type OnlineTab = 'friends' | 'alliances' | 'market' | 'account';
type Tab = OnlineTab;

/** Opens Online from anywhere: the Account window on the home screen, the panel in a career. */
export const openOnline = (tab?: OnlineTab) => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: tab }));
/** Listens for openOnline() (and openCloud(), which asks for the account). */
export function onOpenOnline(fn: (tab?: OnlineTab) => void): () => void {
  const on = (e: Event) => {
    const d = (e as CustomEvent).detail;
    fn(d === 'friends' || d === 'alliances' || d === 'market' || d === 'account' ? d : undefined);
  };
  window.addEventListener(OPEN_EVENT, on);
  return () => window.removeEventListener(OPEN_EVENT, on);
}

type Where = {
  career?: () => SaveGameState;
  airports?: ReadonlyMap<string, Airport>;
  mapStyle?: MapStyleId;
  market?: MarketHooks;
  startTab?: Tab;
  /** Airlines on this device changed (one arrived from the cloud): re-read the save slots. */
  onSlotsChanged: () => void;
};

/** Who is signed in, and running things against the server with a status line. */
function useAccount() {
  const [user, setUser] = useState<CloudUser | null | undefined>(undefined);
  const [age, setAge] = useState<AgeStatus>(ageStatus());
  const [flagsRead, setFlagsRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [, redraw] = useState(0);

  const refresh = async () => {
    try {
      const u = await currentUser();
      setUser(u);
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
  return { user, age, setAge, flagsRead, busy, status, error, act };
}
type Account = ReturnType<typeof useAccount>;

/** Signing in: the age question, then the form. */
function SignIn({ acc }: { acc: Account }) {
  if (acc.age === 'unknown') return <AgeCheck onDone={acc.setAge} />;
  if (acc.age === 'under13') return <p style={{ fontSize: 13.5, lineHeight: 1.5, margin: 0 }}>Accounts are for players 13 and over. Your airlines still save on this device.</p>;
  return <SignInForm busy={acc.busy} act={acc.act} />;
}

function StatusLine({ acc }: { acc: Account }) {
  if (!acc.error && !acc.status) return null;
  return (
    <div role="status" aria-live="polite" style={{ marginTop: 12, fontSize: 13, color: acc.error ? C.red : C.muted }}>
      {acc.error || acc.status}
    </div>
  );
}

/** The home screen's Account window. */
export function OnlineHost(props: Where) {
  const [open, setOpen] = useState(false);
  useEffect(() => onOpenOnline(() => setOpen(true)), []);
  if (!open) return null;
  return <AccountWindow {...props} onClose={() => setOpen(false)} />;
}

function AccountWindow(props: Where & { onClose: () => void }) {
  const acc = useAccount();
  return (
    <ModalShell onClose={props.onClose} maxWidth={acc.user ? 560 : 420} label="Account">
      <h2 style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 700, margin: '0 0 14px' }}>{acc.user ? 'Account' : 'Sign in'}</h2>
      {acc.user === undefined ? (
        <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>Checking…</p>
      ) : acc.user ? (
        <AccountView user={acc.user} busy={acc.busy} act={acc.act} openSaveId={null} onSlotsChanged={props.onSlotsChanged} />
      ) : (
        <SignIn acc={acc} />
      )}
      <StatusLine acc={acc} />
    </ModalShell>
  );
}

/** Online in a career: a side panel like Bank or Fleet, about the airline being played. */
export function OnlineSidePanel(props: Where & { airlineName: string; onClose: () => void; onPlay: (s: SaveGameState) => void }) {
  const acc = useAccount();
  const current = props.career?.() ?? null;
  const air = airlineFor(current?.saveId);
  const [agreed, setAgreed] = useState(legalAccepted);
  const [picked, setPicked] = useState<Tab | null>(props.startTab ?? null);
  useEffect(() => {
    if (props.startTab) setPicked(props.startTab);
  }, [props.startTab, props.market?.sellTail]);
  // Anything a moderator changed shows straight away
  useEffect(() => {
    checkNotices();
  }, []);

  const social = Boolean(acc.user) && acc.flagsRead && featureOn('online') && featureOn('profiles');
  const tabs: PanelTab[] = !acc.user
    ? []
    : [
        ...(social && featureOn('friends') ? [{ id: 'friends', label: 'Friends' }] : []),
        ...(social && featureOn('friends') && featureOn('alliances') ? [{ id: 'alliances', label: 'Alliance' }] : []),
        ...(social && featureOn('marketplace') ? [{ id: 'market', label: 'Market' }] : []),
        { id: 'account', label: 'Account' },
      ];
  // Until a tab is picked: an online airline opens on its first page, anything else on the account
  const tab: Tab = picked && tabs.some((t) => t.id === picked) ? picked : air && tabs.length > 1 ? (tabs[0].id as Tab) : 'account';

  const body = () => {
    if (acc.user === undefined) return <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>Checking…</p>;
    if (!acc.user)
      return (
        <div style={{ maxWidth: 400 }}>
          <SignIn acc={acc} />
        </div>
      );
    if (tab === 'account') return <AccountView user={acc.user} busy={acc.busy} act={acc.act} openSaveId={current?.saveId ?? null} current={current} onSlotsChanged={props.onSlotsChanged} onPlay={props.onPlay} />;
    if (!air) {
      if (!current) return null;
      if (!agreed) return <LegalGate onDone={() => setAgreed(true)} />;
      return (
        <EmptyState
          title={`${props.airlineName} is offline`}
          action={
            <Button variant="primary" disabled={acc.busy} onClick={() => void acc.act(`Putting ${props.airlineName} online…`, () => shareCareer(current))}>
              Go online
            </Button>
          }
        />
      );
    }
    if (tab === 'friends') return <FriendsTab me={air} busy={acc.busy} act={acc.act} />;
    if (tab === 'alliances') return <AlliancesTab me={air} busy={acc.busy} act={acc.act} career={current} airports={props.airports} mapStyle={props.mapStyle} />;
    return <MarketTab me={air} busy={acc.busy} act={acc.act} market={props.market} onAlliances={featureOn('alliances') ? () => setPicked('alliances') : undefined} />;
  };

  return (
    <SidePanel
      title={acc.user ? 'Account' : 'Sign in'}
      width={acc.user ? 880 : 460}
      onClose={props.onClose}
      tabs={tabs.length > 1 ? { group: 'Online', tabs, active: tab, onPick: (id) => setPicked(id as Tab) } : undefined}
    >
      {body()}
      <StatusLine acc={acc} />
    </SidePanel>
  );
}
