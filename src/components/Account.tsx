// ============================================================================
// ACCOUNT (v3.1): one place for the player's account and its airlines
//   Replaces the separate "Cloud saves" and "Online" windows. Each airline has
//   two switches: Cloud (kept in the cloud, so it's on every device) and Online
//   (other players can see it: friends, alliances, the marketplace).
//   The server side is unchanged: the switches call the same functions the old
//   windows did (setCloudPick, shareCareer, stopSharing, setMapSharing).
// ============================================================================
import { useEffect, useState } from 'react';
import {
  MAX_CLOUD_CAREERS,
  MAX_SHARED_AIRLINES,
  airlineFor,
  autoDownload,
  cloudDeleteSave,
  cloudOverview,
  cloudPicks,
  cloudStatus,
  deleteAccount,
  downloadCareer,
  lastSyncMs,
  logoReview,
  myAirlines,
  onCloudChange,
  refreshLogoReview,
  setAutoDownload,
  setCloudPick,
  setMapSharing,
  shareCareer,
  signOut,
  stopSharing,
  syncNow,
  type CloudOverview,
  type CloudUser,
  type MyAirline,
} from '../game/cloud';
import { acceptLegal, featureOn, legalAccepted, LEGAL_DOCS } from '../game/features';
import { inDesktopApp, openExternal } from '../game/cloud';
import { readSaveSlots } from '../game/saves';
import type { SaveGameState } from '../game/types';
import { Icon } from '../ui/icons';
import { Button, C, DISPLAY, IconButton, Pill, SectionTitle, Toggle, well } from '../ui/kit';
import { useLayout } from '../ui/layout';
import { CHANGED_EVENT, ago, announceChange } from './CloudPanel';

export type Act = (label: string, fn: () => Promise<unknown>) => Promise<void>;

/** Each document has to be opened before the player can agree to them. */
export function LegalGate(props: { onDone: () => void; onCancel?: () => void }) {
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [agree, setAgree] = useState(false);
  const allOpened = LEGAL_DOCS.every((d) => opened.has(d.url));
  const desktop = inDesktopApp();
  return (
    <div>
      <p style={{ fontWeight: 650, fontSize: 15, margin: '0 0 4px' }}>Before going online</p>
      <p style={{ fontSize: 13, color: C.muted, margin: '0 0 12px', lineHeight: 1.45 }}>They say what other players can see, what we keep, and the rules for what you share. Open each one to continue.</p>
      <div className="bp-list" style={{ marginBottom: 14 }}>
        {LEGAL_DOCS.map((d) => {
          const seen = opened.has(d.url);
          return (
            <a
              key={d.url}
              href={d.url}
              target={desktop ? undefined : '_blank'}
              rel="noreferrer"
              className="bp-row"
              onClick={(e) => {
                if (desktop) {
                  e.preventDefault();
                  void openExternal(d.url);
                }
                setOpened((s) => new Set(s).add(d.url));
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 8px', color: C.text, textDecoration: 'none', fontWeight: 600, fontSize: 14, borderRadius: 0 }}
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
      <div style={{ display: 'flex', gap: 8 }}>
        {props.onCancel && (
          <Button size="lg" onClick={props.onCancel}>
            Back
          </Button>
        )}
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
    </div>
  );
}

const modeLabel = (m: string | undefined) => (m === 'sandbox' ? 'Sandbox' : 'Career');

type Row = {
  saveId: string;
  name: string;
  code: string;
  sub: string;
  /** On this device. */
  local?: SaveGameState;
  /** A copy in the cloud that this device doesn't have, or that is newer than its own. */
  waiting?: CloudOverview['saves'][number];
  air: MyAirline | null;
};

/**
 * The signed-in account: who it is, and its airlines.
 * `current` is the airline being played (its live state), when there is one.
 */
export function AccountView(props: { user: CloudUser; busy: boolean; act: Act; openSaveId: string | null; current?: SaveGameState | null; onSlotsChanged: () => void; /** In a career: open another of the airlines instead. */ onPlay?: (s: SaveGameState) => void }) {
  const [overview, setOverview] = useState<CloudOverview | null>(null);
  const [local, setLocal] = useState<SaveGameState[]>(() => readSaveSlots());
  const [lastSync, setLastSync] = useState(lastSyncMs());
  const [auto, setAuto] = useState(autoDownload());
  const [agreed, setAgreed] = useState(legalAccepted);
  /** The airline waiting to go online once the documents are agreed to. */
  const [wantOnline, setWantOnline] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [, redraw] = useState(0);
  const phone = useLayout() === 'phone';

  const load = async () => {
    setLocal(readSaveSlots());
    setLastSync(lastSyncMs());
    try {
      setOverview(await cloudOverview());
    } catch {
      /* offline: what's on this device still shows */
    }
  };
  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener(CHANGED_EVENT, onChange);
    const stop = onCloudChange(() => redraw((n) => n + 1));
    return () => {
      window.removeEventListener(CHANGED_EVENT, onChange);
      stop();
    };
  }, []);
  const shared = myAirlines();
  const sharedIds = shared.map((a) => a.id).join(',');
  useEffect(() => {
    for (const id of sharedIds.split(',').filter(Boolean)) void refreshLogoReview(id);
  }, [sharedIds]);

  const run: Act = (label, fn) =>
    props.act(label, async () => {
      await fn();
      await load();
    });
  const changed = () => {
    props.onSlotsChanged();
    announceChange();
  };

  const sync = () =>
    run('Syncing…', async () => {
      const r = await syncNow(props.openSaveId);
      if (r.received.length) props.onSlotsChanged();
      announceChange();
      if (r.problem) throw new Error(r.problem);
    });

  /** The live state of the airline being played, or the saved one. */
  const stateOf = (l: SaveGameState) => (props.current && props.current.saveId === l.saveId ? props.current : l);
  const goOnline = (l: SaveGameState) => run(`Putting ${l.airlineName} online…`, () => shareCareer(stateOf(l)));

  const profiles = featureOn('online') && featureOn('profiles');
  const mapSwitch = profiles && featureOn('friends') && featureOn('friends_map');
  const picks = cloudPicks()?.size ?? overview?.picks?.length ?? 0;

  // One row per airline: the ones on this device, then the ones only in the cloud, then any that are only online
  const waiting = new Map((overview?.saves ?? []).filter((c) => c.waitingHere).map((c) => [c.saveId, c]));
  const rows: Row[] = [...local]
    .sort((a, b) => Number(b.saveId === props.openSaveId) - Number(a.saveId === props.openSaveId))
    .map((l) => ({
      saveId: l.saveId,
      name: l.airlineName,
      code: l.airlineIata,
      sub: `${modeLabel(l.gameMode)} · ${(l.hubs ?? [l.hubIata]).join(', ')}`,
      local: l,
      waiting: waiting.get(l.saveId),
      air: airlineFor(l.saveId),
    }));
  const have = new Set(rows.map((r) => r.saveId));
  for (const c of waiting.values()) {
    if (have.has(c.saveId)) continue;
    have.add(c.saveId);
    rows.push({ saveId: c.saveId, name: c.airline || 'An airline', code: airlineFor(c.saveId)?.code ?? '', sub: `On ${c.fromName || 'another device'} · ${ago(Date.parse(c.updatedAt))}`, waiting: c, air: airlineFor(c.saveId) });
  }
  for (const a of shared) {
    if (have.has(a.saveId)) continue;
    rows.push({ saveId: a.saveId, name: a.airline || a.code, code: a.code, sub: `${modeLabel(a.mode)} · not on this device`, air: a });
  }

  if (wantOnline && !agreed) {
    const l = local.find((x) => x.saveId === wantOnline);
    return (
      <LegalGate
        onCancel={() => setWantOnline(null)}
        onDone={() => {
          setAgreed(true);
          setWantOnline(null);
          if (l) void goOnline(l);
        }}
      />
    );
  }

  const via = props.user.provider === 'google' ? 'Google' : props.user.provider === 'discord' ? 'Discord' : 'Username';
  const devices = overview?.devices ?? [];
  const head: React.CSSProperties = { width: 52, textAlign: 'center', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.muted, flex: 'none' };
  const cell: React.CSSProperties = phone ? { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: C.muted, flex: 'none' } : { width: 52, display: 'grid', placeItems: 'center', flex: 'none' };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span aria-hidden style={{ width: 44, height: 44, borderRadius: 999, background: C.brand, color: C.brandInk, display: 'grid', placeItems: 'center', fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, flex: 'none' }}>
          {props.user.name.slice(0, 1).toUpperCase()}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 650, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props.user.name}</div>
          <div style={{ fontSize: 12.5, color: C.muted }}>
            {via} · synced {ago(lastSync)}
          </div>
        </div>
        <Button size="sm" disabled={props.busy} onClick={sync}>
          <Icon name="swap" size={15} />
          Sync
        </Button>
      </div>

      <section aria-label="Airlines">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 2 }}>
          <div style={{ flex: 1 }}>
            <SectionTitle>Airlines</SectionTitle>
          </div>
          {!phone && <span style={{ ...head, marginBottom: 8 }} title={`Kept in the cloud, so it’s on all your devices (${picks} of ${MAX_CLOUD_CAREERS})`}>
            Cloud
          </span>}
          {!phone && profiles && (
            <span style={{ ...head, marginBottom: 8 }} title={`Other players can see it (up to ${MAX_SHARED_AIRLINES})`}>
              Online
            </span>
          )}
          {!phone && mapSwitch && (
            <span style={{ ...head, marginBottom: 8 }} title="Its aircraft show on friends’ maps">
              Map
            </span>
          )}
        </div>
        {rows.length === 0 && <div style={{ borderRadius: 14, background: well(), padding: '22px 16px', textAlign: 'center', color: C.muted, fontSize: 13.5 }}>No airlines yet.</div>}
        <div className="bp-list">
          {rows.map((r) => {
            const st = r.local ? cloudStatus(r.local) : 'unknown';
            const inCloud = st === 'cloud' || st === 'pending';
            const review = r.air ? logoReview(r.air.id) : { waiting: 0, refused: 0 };
            const l = r.local;
            const switches = (
              <>
                  <span style={cell}>
                    {phone && (l || r.waiting) && 'Cloud'}
                    {l ? (
                      <Toggle
                        label={`Keep ${r.name} in the cloud`}
                        on={inCloud}
                        disabled={props.busy || st === 'unknown' || (!inCloud && picks >= MAX_CLOUD_CAREERS)}
                        onChange={(want) => void run(want ? `Putting ${r.name} in the cloud…` : `Taking ${r.name} out of the cloud…`, () => setCloudPick(l, want))}
                      />
                    ) : r.waiting ? (
                      <Icon name="check" size={16} color={C.green} />
                    ) : null}
                  </span>
                  {profiles && (
                    <span style={cell}>
                      {phone && (l || r.air) && 'Online'}
                      {(l || r.air) && (
                        <Toggle
                          label={`${r.name} online`}
                          on={Boolean(r.air)}
                          disabled={props.busy || (!r.air && shared.length >= MAX_SHARED_AIRLINES)}
                          onChange={(want) => {
                            if (!want) return setConfirmOff(r.saveId);
                            if (!l) return;
                            if (!agreed) return setWantOnline(r.saveId);
                            void goOnline(l);
                          }}
                        />
                      )}
                    </span>
                  )}
                  {mapSwitch && (
                    <span style={cell}>
                      {phone && r.air && 'Map'}
                      {r.air && <Toggle label={`Show ${r.name} on friends’ maps`} on={r.air.mapOn} disabled={props.busy} onChange={(on) => void run(on ? 'Showing your flights…' : 'Stopping…', () => setMapSharing(r.air!.id, on, l ? stateOf(l) : undefined))} />}
                    </span>
                  )}
              </>
            );
            return (
              <div key={r.saveId} style={{ padding: '10px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 40, height: 40, flex: 'none', borderRadius: 10, background: well(), display: 'grid', placeItems: 'center', fontFamily: DISPLAY, fontWeight: 700, fontSize: 15, color: C.textSoft }}>{r.code || '··'}</span>
                  <div style={{ flex: 1, minWidth: 0, marginLeft: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ fontWeight: 650, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                      {r.saveId === props.openSaveId && <Pill color={C.brand}>Playing</Pill>}
                    </div>
                    <div className="num" style={{ fontSize: 12.5, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l && r.waiting ? `Newer on ${r.waiting.fromName || 'another device'}` : r.sub}
                      {st === 'pending' && !r.waiting && <span style={{ color: C.amber }}> · uploads at the next sync</span>}
                    </div>
                  </div>
                  {l && !r.waiting && props.onPlay && r.saveId !== props.openSaveId && (
                    <Button size="sm" variant="ghost" disabled={props.busy} aria-label={`Play ${r.name}`} onClick={() => props.onPlay!(l)}>
                      Play
                    </Button>
                  )}
                  {r.waiting && (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={props.busy}
                      aria-label={`Download ${r.name}`}
                      onClick={() =>
                        run(`Downloading ${r.name}…`, async () => {
                          await downloadCareer(r.saveId, props.openSaveId);
                          changed();
                        })
                      }
                    >
                      <Icon name="download" size={15} />
                      {l ? 'Update' : 'Download'}
                    </Button>
                  )}
                  {r.waiting && !l && <IconButton icon="trash" label={`Remove ${r.name} from the cloud`} disabled={props.busy} onClick={() => run('Removing…', () => cloudDeleteSave(r.saveId))} />}
                  {!phone && switches}
                </div>
                {phone && <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', margin: '8px 0 0 52px' }}>{switches}</div>}
                {confirmOff === r.saveId && (
                  <div role="alertdialog" aria-label={`Take ${r.name} offline`} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8, padding: '10px 12px', borderRadius: 12, background: `${C.red}1c`, fontSize: 13 }}>
                    <span style={{ flex: '1 1 200px' }}>Going offline deletes it from the server, with its friend code and its friends.</span>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={props.busy}
                      onClick={() => {
                        setConfirmOff(null);
                        void run('Going offline…', () => stopSharing(r.saveId));
                      }}
                    >
                      Go offline
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmOff(null)}>
                      Cancel
                    </Button>
                  </div>
                )}
                {review.waiting > 0 && <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{review.waiting === 1 ? '1 logo is' : `${review.waiting} logos are`} waiting for review. Other players don’t see {review.waiting === 1 ? 'it' : 'them'} until then.</div>}
                {review.refused > 0 && <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{review.refused === 1 ? '1 logo wasn’t' : `${review.refused} logos weren’t`} approved, so other players won’t see {review.refused === 1 ? 'it' : 'them'}.</div>}
              </div>
            );
          })}
        </div>
        {profiles && (
          <p style={{ fontSize: 12, color: C.faint, margin: '8px 0 0', lineHeight: 1.45 }}>
            Online airlines show their name, code, callsign, colours, liveries{featureOn('logos') ? ', logos' : ''} and a summary such as fleet size{mapSwitch ? ', and their schedule when Map is on' : ''}. Never your money or your account.
          </p>
        )}
      </section>

      <section aria-label="Account settings" style={{ display: 'grid', gap: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, cursor: 'pointer' }}>
          <span style={{ flex: 1 }}>Download airlines from my other devices</span>
          <Toggle
            label="Download airlines from my other devices"
            on={auto}
            onChange={(on) => {
              setAuto(on);
              setAutoDownload(on);
            }}
          />
        </label>
        {devices.length > 1 && (
          <div style={{ fontSize: 12.5, color: C.muted }}>
            {devices.map((d) => `${d.name || 'Device'}${d.thisDevice ? ' (this one)' : ''}`).join(' · ')}
          </div>
        )}
        {!confirmDelete ? (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginLeft: -10 }}>
            <Button variant="ghost" disabled={props.busy} onClick={() => props.act('Signing out…', signOut)}>
              <Icon name="exit" size={16} />
              Sign out
            </Button>
            <Button variant="ghost" disabled={props.busy} onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" size={16} />
              Delete account
            </Button>
          </div>
        ) : (
          <div role="alertdialog" aria-labelledby="bp-del-title" style={{ background: `${C.red}1c`, borderRadius: 12, padding: 12 }}>
            <div id="bp-del-title" style={{ fontWeight: 650, marginBottom: 4 }}>
              Delete your account?
            </div>
            <p style={{ fontSize: 12.5, color: C.muted, margin: '0 0 10px' }}>Your account and every copy in the cloud are deleted for good. Airlines on your devices stay there.</p>
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
      </section>
    </div>
  );
}
