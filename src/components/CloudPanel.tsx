// ============================================================================
// BACKGROUND SYNC + SIGNING IN (v2.49+, the window moved to Account in v3.1)
//   <CloudHost> sits on the home screen and in the game: it finishes a
//   Google/Discord sign-in that came back to the game and keeps airlines in
//   step (at start, every 3 minutes, when the window is hidden or shown again).
//   The account itself is shown by Account.tsx, inside Online.
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import {
  PASSWORD_MIN,
  USERNAME_RULE,
  cloudOverview,
  cloudConflicts,
  onSignedOutElsewhere,
  resolveConflict,
  finishDesktopSignIn,
  finishWebSignIn,
  inDesktopApp,
  cloudStatus,
  downloadCareer,
  onCloudChange,
  mightBeSignedIn,
  refreshFeatures,
  recordAge,
  signInWith,
  signInWithUsername,
  syncNow,
  validUsername,
  type AgeStatus,
  type CloudConflict,
  type CloudOverview,
  type CloudUser,
  type SyncReport,
} from '../game/cloud';
import { formatMoneyM } from '../game/time';
import type { SaveGameState } from '../game/types';
import { Icon } from '../ui/icons';
import { Button, C, DISPLAY, ModalShell, Segmented, inputStyle, labelStyle, well } from '../ui/kit';

const SYNC_EVERY_MS = 3 * 60_000;
export const CHANGED_EVENT = 'bp-cloud-changed';
const SITE = 'https://boardingpass.my';

/** Opens the account from anywhere (Menu, home screen): it lives in Online. */
export const openCloud = () => window.dispatchEvent(new CustomEvent('bp-open-online', { detail: 'account' }));
export const announceChange = () => window.dispatchEvent(new Event(CHANGED_EVENT));

let startupDone = false;

export function CloudHost(props: {
  /** The career being played on this device (never replaced while open), or null on the home screen. */
  openSaveId: string | null;
  /** Careers on this device changed (a career arrived): re-read the save slots. */
  onSlotsChanged: () => void;
  toast: (message: string) => void;
}) {
  const [conflict, setConflict] = useState<CloudConflict | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const run = async (quiet = true) => {
      if (!mightBeSignedIn()) return;
      void refreshFeatures();
      const r = await syncNow(latest.current.openSaveId);
      report(r, quiet);
    };
    const report = (r: SyncReport, quiet: boolean) => {
      if (r.received.length) {
        latest.current.onSlotsChanged();
        latest.current.toast(r.received.length === 1 ? `${r.received[0]} arrived from your other device` : `${r.received.length} airlines arrived from your other devices`);
      }
      setConflict(cloudConflicts()[0] ?? null);
      if (r.waiting.length && latest.current.openSaveId)
        latest.current.toast(`A newer copy of ${r.waiting[0]} was saved on another device. Go to the home screen to load it.`);
      if (r.problem && !quiet) latest.current.toast(r.problem);
      announceChange();
    };
    const afterSignIn = (u: CloudUser | null) => {
      if (!u) return;
      latest.current.toast(`Signed in as ${u.name}`);
      announceChange();
      void run(false);
    };
    const signInFailed = (e: unknown) => latest.current.toast(`Sign-in didn’t finish: ${e instanceof Error ? e.message : String(e)}`);

    // Once per launch: finish a sign-in that came back to the game, then sync
    if (!startupDone) {
      startupDone = true;
      finishWebSignIn()
        .then((u) => (u ? afterSignIn(u) : run()))
        .catch(signInFailed);
    } else {
      void run(); // back on the home screen (or into a career): catch up
    }

    // Desktop apps: sign-in comes back as a boardingpass:// link
    let unlisten: (() => void) | undefined;
    if (inDesktopApp()) {
      import('@tauri-apps/plugin-deep-link')
        .then(async ({ onOpenUrl }) => {
          const handle = (urls: string[] | null) => {
            for (const u of urls ?? []) finishDesktopSignIn(u).then(afterSignIn).catch(signInFailed);
          };
          unlisten = await onOpenUrl(handle);
        })
        .catch(() => {
          /* plugin missing (browser build) */
        });
    }

    const offElsewhere = onSignedOutElsewhere(() => {
      setConflict(null);
      latest.current.toast('You signed in on another device, so you were signed out here. Your airlines stay on this device.');
      announceChange();
    });

    const timer = window.setInterval(() => void run(), SYNC_EVERY_MS);
    const onVis = () => void run();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
      unlisten?.();
      offElsewhere();
    };
  }, []);

  const settled = () => {
    latest.current.onSlotsChanged();
    setConflict(cloudConflicts()[0] ?? null);
    void syncNow(latest.current.openSaveId).then(() => announceChange());
  };

  return conflict && conflict.saveId !== props.openSaveId ? <ConflictModal conflict={conflict} onDone={settled} onLater={() => setConflict(null)} /> : null;
}

/** Which version of a career to keep, when it changed on two devices (v3.0.2). */
function ConflictModal(props: { conflict: CloudConflict; onDone: () => void; onLater: () => void }) {
  const k = props.conflict;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pick = (keep: 'here' | 'cloud') => {
    setBusy(true);
    setError('');
    resolveConflict(k.saveId, keep)
      .then(props.onDone)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  const card = (title: string, s: SaveGameState, rev: number, keep: 'here' | 'cloud') => (
    <div style={{ display: 'grid', gap: 6, padding: 14, borderRadius: 14, background: well() }}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.45 }}>
        Saved {ago(rev)} · Day {s.simDay} · {formatMoneyM(s.cash)} · {s.fleet.length} aircraft
      </div>
      <Button variant={keep === 'cloud' ? 'primary' : undefined} disabled={busy} onClick={() => pick(keep)}>
        Keep this one
      </Button>
    </div>
  );
  return (
    <ModalShell onClose={props.onLater} maxWidth={440} label="Pick which version to keep">
      <div style={{ display: 'grid', gap: 10, padding: '4px 4px 2px' }}>
        <h2 style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 700, margin: 0 }}>Which {k.name}?</h2>
        <p style={{ fontSize: 13.5, color: C.muted, margin: 0, lineHeight: 1.45 }}>
          It was played here and on another device. Pick one to keep; the other is removed.
        </p>
        {card(`From ${k.fromName || 'your other device'}`, k.cloud, k.cloudRev, 'cloud')}
        {card('On this device', k.here, Number(k.here.rev ?? 0), 'here')}
        {error && <div style={{ fontSize: 13, color: C.red }}>{error}</div>}
        <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>It won’t sync until you pick.</p>
      </div>
    </ModalShell>
  );
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function ago(ms: number): string {
  if (!ms) return 'not yet';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

export function AgeCheck(props: { onDone: (a: AgeStatus) => void }) {
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 100 }, (_, i) => thisYear - i);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (month && year) props.onDone(recordAge(Number(year), Number(month)));
      }}
    >
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 650, fontSize: 14.5, marginBottom: 8 }}>When were you born?</legend>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label>
            <span style={labelStyle}>Month</span>
            <select value={month} onChange={(e) => setMonth(e.target.value)} style={inputStyle} required>
              <option value="">Month</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span style={labelStyle}>Year</span>
            <select value={year} onChange={(e) => setYear(e.target.value)} style={inputStyle} required>
              <option value="">Year</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>
      <p style={{ fontSize: 12, color: C.muted, margin: '8px 0 12px' }}>The game keeps only whether you’re 13 or over, not your birthday.</p>
      <Button type="submit" variant="primary" block disabled={!month || !year}>
        Continue
      </Button>
    </form>
  );
}

export function SignInForm(props: {
  busy: boolean;
  act: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  /** They've already agreed to the legal documents (the Online window asks first). */
  agreed?: boolean;
}) {
  const [ticked, setAgree] = useState(false);
  const agree = ticked || props.agreed === true;
  const [mode, setMode] = useState<'signin' | 'create'>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const disabled = props.busy || !agree;
  const desktop = inDesktopApp();
  const viaBrowser = desktop ? ' Your browser opens to sign in.' : '';
  return (
    <div>
      {!props.agreed && (
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13.5, lineHeight: 1.45, marginBottom: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1, flex: 'none' }} />
        <span>
          I agree to the{' '}
          <a href={`${SITE}/terms.html`} target="_blank" rel="noreferrer" style={{ color: C.accent }}>
            Terms of use
          </a>{' '}
          and{' '}
          <a href={`${SITE}/privacy.html`} target="_blank" rel="noreferrer" style={{ color: C.accent }}>
            Privacy policy
          </a>
          .
        </span>
      </label>
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        <Button block size="lg" disabled={disabled} onClick={() => props.act(desktop ? 'Opening Google in your browser…' : 'Opening Google…', () => signInWith('google'))}>
          Continue with Google
        </Button>
        <Button block size="lg" disabled={disabled} onClick={() => props.act(desktop ? 'Opening Discord in your browser…' : 'Opening Discord…', () => signInWith('discord'))}>
          Continue with Discord
        </Button>
      </div>
      {viaBrowser && <p style={{ fontSize: 12, color: C.muted, margin: '6px 0 0' }}>{viaBrowser.trim()}</p>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 12px', color: C.faint, fontSize: 12 }}>
        <span style={{ flex: 1, height: 1, background: C.line }} />
        or
        <span style={{ flex: 1, height: 1, background: C.line }} />
      </div>

      <Segmented<'signin' | 'create'>
        block
        value={mode}
        onChange={setMode}
        options={[
          { value: 'signin', label: 'Sign in' },
          { value: 'create', label: 'Create account' },
        ]}
      />
      <form
        style={{ display: 'grid', gap: 10, marginTop: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (disabled) return;
          void props.act(mode === 'create' ? 'Creating your account…' : 'Signing in…', () => signInWithUsername(username, password, mode === 'create'));
        }}
      >
        <label>
          <span style={labelStyle}>Username</span>
          <input
            style={inputStyle}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            aria-describedby="bp-username-rule"
            aria-invalid={username !== '' && !validUsername(username)}
          />
          <span id="bp-username-rule" style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 4 }}>
            {USERNAME_RULE}. Not your real name.
          </span>
        </label>
        <label>
          <span style={labelStyle}>Password</span>
          <input
            style={inputStyle}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
            minLength={PASSWORD_MIN}
            required
            aria-describedby="bp-password-rule"
          />
          <span id="bp-password-rule" style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 4 }}>
            At least {PASSWORD_MIN} characters.{mode === 'create' ? ' It can’t be reset, so keep it safe.' : ''}
          </span>
        </label>
        <Button type="submit" variant="primary" size="lg" block disabled={disabled}>
          {mode === 'create' ? 'Create account' : 'Sign in'}
        </Button>
        {!agree && <span style={{ fontSize: 12, color: C.muted }}>Tick the box above to continue.</span>}
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Home screen: careers waiting in the cloud for this device (v2.52)
// ---------------------------------------------------------------------------
export function CloudCareersOnHome(props: { onDownloaded: () => void; toast: (m: string) => void }) {
  const [items, setItems] = useState<CloudOverview['saves']>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!mightBeSignedIn()) return setItems([]);
      try {
        const o = await cloudOverview();
        if (alive) setItems((o?.saves ?? []).filter((s) => s.waitingHere));
      } catch {
        /* offline: nothing to show */
      }
    };
    void load();
    const onChange = () => void load();
    window.addEventListener(CHANGED_EVENT, onChange);
    return () => {
      alive = false;
      window.removeEventListener(CHANGED_EVENT, onChange);
    };
  }, []);
  if (items.length === 0) return null;
  return (
    <div role="region" aria-label="Careers in the cloud" style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
      {items.map((c) => (
        <div key={c.saveId} style={{ background: `${C.brand}1c`, borderRadius: 14, padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Icon name="download" size={20} color={C.brand} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.airline || 'An airline'}</div>
            <div style={{ fontSize: 12, color: C.muted }}>
              On {c.fromName || 'another device'} · {ago(Date.parse(c.updatedAt))}
            </div>
          </div>
          <Button
            variant="primary"
            disabled={busy !== null}
            aria-label={`Download ${c.airline || 'career'}`}
            onClick={async () => {
              setBusy(c.saveId);
              try {
                const name = await downloadCareer(c.saveId);
                props.onDownloaded();
                props.toast(`${name} downloaded`);
                announceChange();
              } catch (e) {
                props.toast(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === c.saveId ? 'Downloading…' : 'Download'}
          </Button>
        </div>
      ))}
    </div>
  );
}

/** Re-renders when the cloud picks or sync state change. */
function useCloudVersion() {
  const [, setV] = useState(0);
  useEffect(() => onCloudChange(() => setV((v) => v + 1)), []);
}

/** Where a save lives: this device, and the cloud when it's kept there (v2.52). */
export function SaveLocation({ save }: { save: SaveGameState }) {
  useCloudVersion();
  const st = cloudStatus(save);
  if (st === 'cloud') return <span title="In the cloud, up to date" style={{ fontSize: 12, fontWeight: 600, color: C.green, whiteSpace: 'nowrap' }}>Synced</span>;
  if (st === 'pending') return <span title="Uploads at the next sync" style={{ fontSize: 12, fontWeight: 600, color: C.amber, whiteSpace: 'nowrap' }}>Syncing</span>;
  return null;
}
