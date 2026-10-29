// ============================================================================
// CLOUD SAVES WINDOW + BACKGROUND SYNC (v2.49+)
//   <CloudHost> sits on the home screen and in the game: it finishes a
//   Google/Discord sign-in that came back to the game, keeps careers in step
//   (at start, every 3 minutes, when the window is hidden or shown again) and
//   shows the Cloud saves window when openCloud() is called.
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import {
  PASSWORD_MIN,
  USERNAME_RULE,
  ageStatus,
  cloudOverview,
  currentUser,
  deleteAccount,
  finishDesktopSignIn,
  finishWebSignIn,
  inDesktopApp,
  MAX_CLOUD_CAREERS,
  autoDownload,
  cloudPicks,
  cloudStatus,
  downloadCareer,
  onCloudChange,
  setCloudPick,
  cloudDeleteSave,
  lastSyncMs,
  mightBeSignedIn,
  setAutoDownload,
  uploadCareer,
  recordAge,
  signInWith,
  signInWithUsername,
  signOut,
  syncNow,
  validUsername,
  type AgeStatus,
  type CloudOverview,
  type CloudUser,
  type SyncReport,
} from '../game/cloud';
import { readSaveSlots } from '../game/saves';
import type { SaveGameState } from '../game/types';
import { Icon } from '../ui/icons';
import { Button, C, DISPLAY, ModalShell, Segmented, inputStyle, labelStyle } from '../ui/kit';

const SYNC_EVERY_MS = 3 * 60_000;
const OPEN_EVENT = 'bp-open-cloud';
const CHANGED_EVENT = 'bp-cloud-changed';
const SITE = 'https://boardingpass.my';

/** Opens the Cloud saves window from anywhere (Menu, home screen). */
export const openCloud = () => window.dispatchEvent(new Event(OPEN_EVENT));
const announceChange = () => window.dispatchEvent(new Event(CHANGED_EVENT));

let startupDone = false;

export function CloudHost(props: {
  /** The career being played on this device (never replaced while open), or null on the home screen. */
  openSaveId: string | null;
  /** Careers on this device changed (a career arrived): re-read the save slots. */
  onSlotsChanged: () => void;
  toast: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const run = async (quiet = true) => {
      if (!mightBeSignedIn()) return;
      const r = await syncNow(latest.current.openSaveId);
      report(r, quiet);
    };
    const report = (r: SyncReport, quiet: boolean) => {
      if (r.received.length) {
        latest.current.onSlotsChanged();
        latest.current.toast(r.received.length === 1 ? `${r.received[0]} arrived from your other device` : `${r.received.length} careers arrived from your other devices`);
      }
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

    const timer = window.setInterval(() => void run(), SYNC_EVERY_MS);
    const onVis = () => void run();
    document.addEventListener('visibilitychange', onVis);
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener(OPEN_EVENT, onOpen);
      unlisten?.();
    };
  }, []);

  return open ? <CloudModal onClose={() => setOpen(false)} openSaveId={props.openSaveId} onSlotsChanged={props.onSlotsChanged} /> : null;
}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ago(ms: number): string {
  if (!ms) return 'not yet';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

function CloudModal(props: { onClose: () => void; openSaveId: string | null; onSlotsChanged: () => void }) {
  const [user, setUser] = useState<CloudUser | null | undefined>(undefined);
  const [age, setAge] = useState<AgeStatus>(ageStatus());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [overview, setOverview] = useState<CloudOverview | null>(null);
  const [lastSync, setLastSync] = useState(lastSyncMs());

  const refresh = async () => {
    try {
      const u = await currentUser();
      setUser(u);
      setLastSync(lastSyncMs());
      setOverview(u ? await cloudOverview() : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener(CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CHANGED_EVENT, onChange);
  }, []);

  const act = async (label: string, fn: () => Promise<unknown>) => {
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

  const sync = () =>
    act('Syncing…', async () => {
      const r = await syncNow(props.openSaveId);
      if (r.received.length) props.onSlotsChanged();
      announceChange();
      const parts = [
        r.received.length ? `${r.received.length} career${r.received.length > 1 ? 's' : ''} arrived` : '',
        r.sent ? `${r.sent} sent` : '',
        r.waiting.length ? `a newer copy of ${r.waiting[0]} is waiting for the home screen` : '',
      ].filter(Boolean);
      if (r.problem) throw new Error(r.problem);
      setTimeout(() => setStatus(parts.length ? `Done: ${parts.join(', ')}.` : 'Everything is up to date.'), 0);
    });

  return (
    <ModalShell onClose={props.onClose} maxWidth={460} label="Cloud saves">
      <div style={{ padding: '4px 4px 2px' }}>
        <h2 style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 700, margin: '0 0 4px' }}>Cloud saves</h2>
        <p style={{ fontSize: 13.5, color: C.muted, margin: '0 0 14px', lineHeight: 1.45 }}>
          Sign in to carry your careers between your computers, phone and the browser game. It’s optional: the game works fully without an account.
        </p>

        {user === undefined ? (
          <p style={{ color: C.muted, fontSize: 13 }}>Checking…</p>
        ) : user ? (
          <SignedIn user={user} overview={overview} lastSync={lastSync} busy={busy} onSync={sync} act={act} openSaveId={props.openSaveId} onSlotsChanged={props.onSlotsChanged} />
        ) : age === 'unknown' ? (
          <AgeCheck onDone={setAge} />
        ) : age === 'under13' ? (
          <p style={{ fontSize: 13.5, lineHeight: 1.5 }}>
            Cloud saves are for players 13 and over. Your careers still save on this device, and <b>Menu → Export save file</b> can move one to another computer.
          </p>
        ) : (
          <SignInForm busy={busy} act={act} />
        )}

        <div role="status" aria-live="polite" style={{ minHeight: 18, marginTop: 10, fontSize: 13, color: error ? C.red : C.muted }}>
          {error || status}
        </div>
      </div>
    </ModalShell>
  );
}

function AgeCheck(props: { onDone: (a: AgeStatus) => void }) {
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

function SignInForm(props: { busy: boolean; act: (label: string, fn: () => Promise<unknown>) => Promise<void> }) {
  const [agree, setAgree] = useState(false);
  const [mode, setMode] = useState<'signin' | 'create'>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const disabled = props.busy || !agree;
  const desktop = inDesktopApp();
  const viaBrowser = desktop ? ' Your browser opens to sign in, then brings you back here.' : '';
  return (
    <div>
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
        or with a username
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
            {USERNAME_RULE}. Don’t use your real name.
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
            At least {PASSWORD_MIN} characters.{mode === 'create' ? ' There’s no email, so a forgotten password can’t be reset: keep it somewhere safe.' : ''}
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

function SignedIn(props: {
  user: CloudUser;
  overview: CloudOverview | null;
  lastSync: number;
  busy: boolean;
  onSync: () => void;
  act: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  openSaveId: string | null;
  onSlotsChanged: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [auto, setAuto] = useState(autoDownload());
  const [local, setLocal] = useState<SaveGameState[]>(() => readSaveSlots());
  useEffect(() => setLocal(readSaveSlots()), [props.overview, props.lastSync]);
  const via = props.user.provider === 'google' ? 'Google' : props.user.provider === 'discord' ? 'Discord' : 'a username';
  const cloud = props.overview?.saves ?? [];
  const devices = props.overview?.devices ?? [];
  const localIds = new Set(local.map((l) => l.saveId));
  useCloudVersion();
  const pickCount = cloudPicks()?.size ?? props.overview?.picks?.length ?? 0;
  const changed = () => {
    props.onSlotsChanged();
    setLocal(readSaveSlots());
    announceChange();
  };
  const sectionTitle = (id: string, text: string) => (
    <h3 id={id} style={{ fontSize: 14, margin: '6px 0 6px' }}>
      {text}
    </h3>
  );
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, background: C.raised, border: `1px solid ${C.line}` };
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={row}>
        <Icon name="check" size={18} color={C.green} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis' }}>Signed in as {props.user.name}</div>
          <div style={{ fontSize: 12, color: C.muted }}>
            With {via}. Last synced {ago(props.lastSync)}.
          </div>
        </div>
        <Button size="sm" variant="primary" disabled={props.busy} onClick={props.onSync}>
          <Icon name="swap" size={15} />
          Sync now
        </Button>
      </div>

      <section aria-labelledby="bp-cloud-in">
        {sectionTitle('bp-cloud-in', 'In the cloud')}
        {cloud.length === 0 ? (
          <p style={{ fontSize: 12.5, color: C.muted, margin: 0 }}>Nothing here right now. Careers you save are uploaded, and leave the cloud once all your other devices have them.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
            {cloud.map((c) => {
              const here = localIds.has(c.saveId);
              return (
                <li key={c.saveId} style={row}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.airline || 'A career'}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>
                      From {c.fromThisDevice ? 'this device' : c.fromName || 'another device'}, {ago(Date.parse(c.updatedAt))}
                      {c.waitingHere ? (here ? '. Newer than yours.' : '. Not on this device yet.') : '. You have this one.'}
                    </div>
                  </div>
                  {c.waitingHere && (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={props.busy}
                      aria-label={`Download ${c.airline || 'career'}`}
                      onClick={() =>
                        props.act(`Downloading ${c.airline}…`, async () => {
                          await downloadCareer(c.saveId, props.openSaveId);
                          changed();
                        })
                      }
                    >
                      <Icon name="download" size={15} />
                      Download
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={props.busy}
                    aria-label={`Remove ${c.airline || 'career'} from the cloud`}
                    title="Remove from the cloud (careers on your devices stay)"
                    onClick={() => props.act('Removing…', () => cloudDeleteSave(c.saveId))}
                  >
                    <Icon name="trash" size={15} />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, marginTop: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              setAuto(e.target.checked);
              setAutoDownload(e.target.checked);
            }}
            style={{ width: 18, height: 18, marginTop: 1, flex: 'none' }}
          />
          <span>
            Download careers from my other devices by themselves
            <span style={{ display: 'block', fontSize: 12, color: C.muted }}>Turn off to pick which ones to download here or on the home screen.</span>
          </span>
        </label>
      </section>

      <section aria-labelledby="bp-cloud-here">
        {sectionTitle('bp-cloud-here', `On this device (${pickCount} of ${MAX_CLOUD_CAREERS} kept in the cloud)`)}
        {local.length === 0 ? (
          <p style={{ fontSize: 12.5, color: C.muted, margin: 0 }}>No careers saved on this device yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
            {local.map((l) => {
              const st = cloudStatus(l);
              const on = st === 'cloud' || st === 'pending';
              return (
                <li key={l.saveId} style={row}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.airlineName}</div>
                    <SaveLocation save={l} />
                  </div>
                  {st === 'pending' && (
                    <Button
                      size="sm"
                      disabled={props.busy}
                      aria-label={`Upload ${l.airlineName} now`}
                      onClick={() =>
                        props.act(`Uploading ${l.airlineName}…`, async () => {
                          await uploadCareer(l.saveId);
                          setLocal(readSaveSlots());
                        })
                      }
                    >
                      <Icon name="upload" size={15} />
                      Upload
                    </Button>
                  )}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-checked={on}
                      checked={on}
                      disabled={props.busy || (!on && pickCount >= MAX_CLOUD_CAREERS)}
                      onChange={(e) => {
                        const want = e.target.checked;
                        void props.act(want ? `Putting ${l.airlineName} in the cloud…` : `Taking ${l.airlineName} out of the cloud…`, () => setCloudPick(l, want));
                      }}
                      style={{ width: 18, height: 18 }}
                    />
                    Keep in the cloud
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <p style={{ fontSize: 12, color: C.muted, margin: '8px 0 0' }}>
          Up to {MAX_CLOUD_CAREERS} careers can be kept in the cloud. To swap, turn one off, then turn another on. Turning one off removes only the cloud copy: it stays on this device.
        </p>
      </section>

      {devices.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: C.textDim }}>Your devices ({devices.length})</summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
            {devices.map((d, i) => (
              <li key={i}>
                {d.name || 'Device'}
                {d.thisDevice ? ' (this one)' : ''} <span style={{ color: C.muted }}>seen {ago(Date.parse(d.lastSeen))}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div style={{ height: 1, background: C.line, margin: '2px 0' }} />
      {!confirmDelete ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button disabled={props.busy} onClick={() => props.act('Signing out…', signOut)}>
            <Icon name="exit" size={16} />
            Sign out
          </Button>
          <Button variant="ghost" disabled={props.busy} onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" size={16} />
            Delete account
          </Button>
        </div>
      ) : (
        <div role="alertdialog" aria-labelledby="bp-del-title" style={{ background: C.raised, border: `1px solid ${C.red}`, borderRadius: 10, padding: 12 }}>
          <div id="bp-del-title" style={{ fontWeight: 650, marginBottom: 4 }}>
            Delete your account?
          </div>
          <p style={{ fontSize: 12.5, color: C.muted, margin: '0 0 10px' }}>
            Your account and every career copy in the cloud are deleted for good. Careers saved on your devices stay there.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="danger" disabled={props.busy} onClick={() => props.act('Deleting your account…', deleteAccount)}>
              Delete account
            </Button>
            <Button autoFocus onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
          </div>
        </div>
      )}
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
        <div key={c.saveId} style={{ background: C.panel, border: `1px dashed ${C.brand}88`, borderRadius: 10, padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Icon name="download" size={20} color={C.brand} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.airline || 'A career'}</div>
            <div style={{ fontSize: 12, color: C.muted }}>
              In the cloud from {c.fromName || 'another device'}, {ago(Date.parse(c.updatedAt))}
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
  const chip = (text: string, color: string, title: string) => (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600, color, whiteSpace: 'nowrap' }}>
      {text}
    </span>
  );
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {chip('● This device', C.textDim, 'Saved on this device')}
      {st === 'cloud' && chip('● Cloud, up to date', C.green, 'Kept in the cloud, with the latest save')}
      {st === 'pending' && chip('● Cloud, uploading soon', C.amber, 'Kept in the cloud; the latest changes upload at the next sync')}
      {st === 'local' && chip('○ Not in the cloud', C.muted, 'Only on this device. Turn on “Keep in the cloud” in Cloud saves.')}
    </span>
  );
}
