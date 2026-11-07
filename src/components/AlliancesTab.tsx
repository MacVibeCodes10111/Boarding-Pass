// ============================================================================
// THE ALLIANCES TAB (Update A, phase A5)
//   One alliance per shared airline, up to 20 airlines, all Career or all
//   Sandbox. Start one, answer invites, invite friends, see the alliance's
//   network together. The server decides everything
//   (cloud/supabase/2026-11-07-alliances.sql). There are no messages of any kind,
//   and everything from other players is shown as plain text.
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MAX_ALLIANCE, ALLIANCE_NAME, allianceAnswer, answerAllianceInvite, cancelAllianceInvite, cleanTag, createAlliance, disbandAlliance, editAlliance, handOverAlliance, inviteToAlliance, leaveAlliance, loadAlliance, removeFromAlliance, validTag, type Alliance, type AllianceData, type AllianceForm } from '../game/alliances';
import { fetchFriendSchedules, type MyAirline } from '../game/cloud';
import { friendAirlineStats, type MapRoute } from '../game/friendAirline';
import { loadFriends, type Friend } from '../game/friends';
import { mergeFriendAnswer, refreshFriendsMap } from '../game/friendsMap';
import { buildSnapshot } from '../game/scheduleSnapshot';
import type { Airport, SaveGameState } from '../game/types';
import { Icon } from '../ui/icons';
import { Button, C, DISPLAY, inputStyle } from '../ui/kit';
import { RouteMap } from './FriendAirline';
import { AirlineChip, AirlineName, AllianceTag, ConfirmButton, badgeFor } from './FriendsTab';
import { ReportButton } from './ReportButton';
import type { MapStyleId } from './LiveMap';

type Act = (label: string, fn: () => Promise<unknown>) => Promise<void>;

const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, background: C.raised, flexWrap: 'wrap' };
const headStyle: React.CSSProperties = { fontSize: 12, fontWeight: 650, color: C.muted, margin: '8px 0 0' };
const note: React.CSSProperties = { fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.45 };
const day = (x: string) => (x ? new Date(x).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export function AlliancesTab(props: { me: MyAirline; busy: boolean; act: Act; career: SaveGameState | null; airports?: ReadonlyMap<string, Airport>; mapStyle?: MapStyleId }) {
  const me = props.me.id;
  const [data, setData] = useState<AllianceData | null | undefined>(undefined);
  const [answer, setAnswer] = useState('');
  const [editing, setEditing] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await loadAlliance(me));
    } catch {
      setData((d) => d ?? null);
    }
  }, [me]);
  useEffect(() => {
    setData(undefined);
    setAnswer('');
    setEditing(false);
  }, [me]);
  useEffect(() => {
    void load();
  }, [load]);
  // Each change goes to the server, then everything is read back, so what's shown is what's true
  const change = (label: string, fn: () => Promise<unknown>) =>
    props.act(label, async () => {
      await fn();
      await load();
      void refreshFriendsMap();
    });
  /** Runs an action whose answer is a word from the server, and says what it means. */
  const ask = (label: string, fn: () => Promise<string>, after?: () => void) =>
    change(label, async () => {
      const r = await fn();
      setAnswer(allianceAnswer(r));
      if (['created', 'saved', 'sent', 'joined', 'declined'].includes(r)) after?.();
    });

  if (data === undefined) return <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>Loading your alliance…</p>;
  if (data === null) return <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>Your alliance can’t be loaded right now. Try again in a moment.</p>;

  const said = answer && (
    <p role="status" style={{ fontSize: 12.5, margin: 0, color: C.text }}>
      {answer}
    </p>
  );
  const al = data.alliance;

  if (!al)
    return (
      <div style={{ display: 'grid', gap: 6 }}>
        {data.invites.length > 0 && <p style={{ ...headStyle, marginTop: 0 }}>Invited to join</p>}
        {data.invites.map((i) => (
          <div key={i.alliance.id} style={rowStyle}>
            <AllianceBadgeBox logo={i.alliance.logo} tag={i.alliance.tag} colours={i.alliance.colours} size={36} />
            <span style={{ flex: '1 1 150px', minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={{ fontWeight: 650, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.alliance.name}</span>
                <AllianceTag badge={i.alliance} />
              </span>
              <span style={{ display: 'block', fontSize: 12, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {[`${i.alliance.members} of ${MAX_ALLIANCE} airlines`, i.from ? `invited by ${i.from.airline}` : ''].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Button size="sm" variant="primary" disabled={props.busy} onClick={() => void ask('Joining…', () => answerAllianceInvite(me, i.alliance.id, true))}>
                Join
              </Button>
              <Button size="sm" disabled={props.busy} onClick={() => void ask('Declining…', () => answerAllianceInvite(me, i.alliance.id, false))}>
                Decline
              </Button>
              <ReportButton me={me} kind="alliance" target={i.alliance.id} name={i.alliance.name} logo={i.alliance.logo} disabled={props.busy} />
            </span>
          </div>
        ))}
        {data.invites.length > 0 && <p style={note}>Joining one turns down the others.</p>}

        <p style={{ ...headStyle, marginTop: data.invites.length ? 12 : 0 }}>Start an alliance</p>
        {said}
        <AllianceEditor
          airline={props.me.airline}
          mode={data.mode}
          busy={props.busy}
          submit="Start the alliance"
          onSubmit={(f) => void ask('Starting your alliance…', () => createAlliance(me, f))}
        />
      </div>
    );

  if (editing)
    return (
      <div style={{ display: 'grid', gap: 6 }}>
        <p style={{ ...headStyle, marginTop: 0 }}>Edit {al.name}</p>
        {said}
        <AllianceEditor
          airline={props.me.airline}
          mode={data.mode}
          busy={props.busy}
          start={{ name: al.name, tag: al.tag, colours: al.colours, description: al.description, useLogo: al.logo !== null }}
          submit="Save"
          onSubmit={(f) => void ask('Saving…', () => editAlliance(me, f), () => setEditing(false))}
          onCancel={() => {
            setAnswer('');
            setEditing(false);
          }}
        />
      </div>
    );

  return <InAlliance al={al} data={data} me={props.me} busy={props.busy} said={said} change={change} ask={ask} onEdit={() => (setAnswer(''), setEditing(true))} career={props.career} airports={props.airports} mapStyle={props.mapStyle} />;
}

function InAlliance(props: {
  al: Alliance;
  data: AllianceData;
  me: MyAirline;
  busy: boolean;
  said: React.ReactNode;
  change: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  ask: (label: string, fn: () => Promise<string>, after?: () => void) => Promise<void>;
  onEdit: () => void;
  career: SaveGameState | null;
  airports?: ReadonlyMap<string, Airport>;
  mapStyle?: MapStyleId;
}) {
  const { al, change, ask } = props;
  const me = props.me.id;
  const leader = al.role === 'leader';
  const others = al.members.filter((m) => !m.me);

  // The leader invites from this airline's friends who aren't in an alliance yet
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const memberKey = al.members.map((m) => m.id).join() + al.invited.map((i) => i.id).join();
  useEffect(() => {
    if (!leader) return;
    let live = true;
    loadFriends(me)
      .then((d) => live && setFriends(d?.friends ?? []))
      .catch(() => live && setFriends([]));
    return () => {
      live = false;
    };
  }, [leader, me, memberKey]);
  const taken = new Set([...al.members.map((m) => m.id), ...al.invited.map((i) => i.id)]);
  const canInvite = (friends ?? []).filter((f) => f.card && !f.card.alliance && !taken.has(f.id));
  const room = MAX_ALLIANCE - al.members.length - al.invited.length;

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ ...rowStyle, alignItems: 'flex-start', padding: '12px 12px', gap: 12 }}>
        <AllianceBadgeBox logo={al.logo} tag={al.tag} colours={al.colours} size={52} />
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, lineHeight: 1.15, overflowWrap: 'anywhere' }}>{al.name}</span>
            <AllianceTag badge={al} />
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{[`${al.count} of ${MAX_ALLIANCE} airlines`, al.createdAt ? `since ${day(al.createdAt)}` : '', leader ? 'You lead it' : ''].filter(Boolean).join(' · ')}</div>
          {al.description && <p style={{ fontSize: 13, margin: '6px 0 0', lineHeight: 1.45, overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>{al.description}</p>}
        </div>
        {leader ? (
          <Button size="sm" variant="ghost" disabled={props.busy} onClick={props.onEdit}>
            Edit
          </Button>
        ) : (
          <ReportButton me={me} kind="alliance" target={al.id} name={al.name} logo={al.logo} disabled={props.busy} />
        )}
      </div>
      {props.said}

      {props.airports && props.airports.size > 0 && props.mapStyle && <AllianceMap me={me} ownName={props.me.airline} career={props.career} airports={props.airports} mapStyle={props.mapStyle} version={memberKey} />}

      <p style={headStyle}>Airlines ({al.count})</p>
      {al.members.map((m) => (
        <div key={m.id} style={rowStyle}>
          <AirlineChip card={m.card} />
          <AirlineName card={m.card ? { ...m.card, alliance: null } : null} extra={[m.role === 'leader' ? 'Leader' : '', m.me ? 'You' : '', m.joinedAt ? `joined ${day(m.joinedAt)}` : ''].filter(Boolean).join(' · ')} />
          {!m.me && (
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {leader && <ConfirmButton label="Make leader" ask="Hand it over" disabled={props.busy} onConfirm={() => void change('Handing over…', () => handOverAlliance(me, m.id))} />}
              {leader && <ConfirmButton label="Remove" ask="Remove them" disabled={props.busy} onConfirm={() => void change('Removing…', () => removeFromAlliance(me, m.id))} />}
              {m.card && <ReportButton me={me} kind="airline" target={m.id} name={m.card.airline} logo={m.card.badge} disabled={props.busy} />}
            </span>
          )}
        </div>
      ))}
      {al.count > al.members.length && <p style={note}>{al.count - al.members.length === 1 ? 'One airline isn’t shown because' : `${al.count - al.members.length} airlines aren’t shown because`} you’ve blocked them or they’ve blocked you.</p>}

      {leader && (
        <>
          {al.invited.length > 0 && <p style={headStyle}>Invited, not answered yet</p>}
          {al.invited.map((i) => (
            <div key={i.id} style={rowStyle}>
              <AirlineChip card={i.card} />
              <AirlineName card={i.card} extra={i.at ? `invited ${day(i.at)}` : ''} />
              <Button size="sm" variant="ghost" disabled={props.busy} onClick={() => void change('Cancelling…', () => cancelAllianceInvite(me, i.id))}>
                Cancel
              </Button>
            </div>
          ))}
          <p style={headStyle}>Invite friends</p>
          {friends === null ? (
            <p style={note}>Loading this airline’s friends…</p>
          ) : room <= 0 ? (
            <p style={note}>The alliance is full: {MAX_ALLIANCE} airlines, counting the ones invited.</p>
          ) : canInvite.length === 0 ? (
            <p style={note}>Every friend of {props.me.airline} is in an alliance or invited already. Add friends in the Friends tab.</p>
          ) : (
            canInvite.map((f) => (
              <div key={f.id} style={rowStyle}>
                <AirlineChip card={f.card} />
                <AirlineName card={f.card} />
                <Button size="sm" disabled={props.busy} onClick={() => void ask('Inviting…', () => inviteToAlliance(me, f.id))}>
                  <Icon name="plus" size={14} />
                  Invite
                </Button>
              </div>
            ))
          )}
          <p style={note}>Only this airline’s friends can be invited, and only {props.data.mode === 'sandbox' ? 'Sandbox' : 'Career'} airlines.</p>
        </>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        <ConfirmButton
          label="Leave the alliance"
          ask={leader && others.length ? 'Leave, the next airline leads' : 'Leave it'}
          disabled={props.busy}
          onConfirm={() => void change('Leaving…', () => leaveAlliance(me))}
        />
        {leader && others.length > 0 && <ConfirmButton label="Disband it" ask="Disband it for everyone" disabled={props.busy} onConfirm={() => void change('Disbanding…', () => disbandAlliance(me))} />}
      </div>
    </div>
  );
}

/** The alliance's logo once it's approved, else its tag in its colours. */
function AllianceBadgeBox(props: { logo: string | null; tag: string; colours: { a: string; b: string }; size: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (props.logo) void badgeFor(props.logo).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [props.logo]);
  const box: React.CSSProperties = { width: props.size, height: props.size, flex: 'none', borderRadius: props.size / 4, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' };
  if (url) return <img src={url} alt="" draggable={false} style={{ ...box, background: '#fff', padding: 3, objectFit: 'contain' }} />;
  return (
    <span aria-hidden style={{ ...box, background: `linear-gradient(135deg, ${props.colours.a} 50%, ${props.colours.b} 50%)`, color: '#fff', fontWeight: 700, fontSize: props.size * 0.32, letterSpacing: '0.03em', textShadow: '0 1px 2px rgba(0,0,0,.55)' }}>
      {props.tag}
    </span>
  );
}

/** Start or edit an alliance. Checked here first so most mistakes are caught before the server sees them. */
function AllianceEditor(props: { airline: string; mode: 'career' | 'sandbox'; busy: boolean; start?: AllianceForm; submit: string; onSubmit: (f: AllianceForm) => void; onCancel?: () => void }) {
  const [f, setF] = useState<AllianceForm>(() => props.start ?? { name: '', tag: '', colours: { a: '#0b6e4f', b: '#f5a623' }, description: '', useLogo: false });
  const [problem, setProblem] = useState('');
  const set = (p: Partial<AllianceForm>) => {
    setProblem('');
    setF((x) => ({ ...x, ...p }));
  };
  const label: React.CSSProperties = { display: 'grid', gap: 4, fontSize: 12, color: C.muted };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!ALLIANCE_NAME.test(f.name.trim())) return setProblem('Names have 3 to 40 letters, numbers, spaces, &, ’, . or -.');
        if (!validTag(cleanTag(f.tag))) return setProblem('Tags have 2 to 4 capital letters or numbers.');
        props.onSubmit(f);
      }}
      style={{ display: 'grid', gap: 10, padding: 12, borderRadius: 12, background: C.raised }}
    >
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ ...label, flex: '3 1 200px' }}>
          Name
          <input value={f.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} placeholder="Sky Union" autoComplete="off" style={inputStyle} />
        </label>
        <label style={{ ...label, flex: '1 1 90px' }}>
          Tag
          <input value={f.tag} onChange={(e) => set({ tag: cleanTag(e.target.value) })} placeholder="SKY" autoCapitalize="characters" autoComplete="off" spellCheck={false} style={{ ...inputStyle, letterSpacing: '0.08em' }} />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['a', 'b'] as const).map((k) => (
          <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
            <input type="color" value={f.colours[k]} onChange={(e) => set({ colours: { ...f.colours, [k]: e.target.value } })} style={{ width: 34, height: 28, padding: 0, border: `1px solid ${C.border}`, borderRadius: 6, background: 'none', cursor: 'pointer' }} />
            {k === 'a' ? 'Main colour' : 'Second colour'}
          </label>
        ))}
        {validTag(f.tag) && <AllianceTag badge={{ tag: f.tag, name: f.name, colours: f.colours }} title="How the tag looks" />}
      </div>
      <label style={label}>
        About it (optional)
        <textarea value={f.description} maxLength={300} rows={2} onChange={(e) => set({ description: e.target.value })} placeholder="What the alliance is about" style={{ ...inputStyle, resize: 'vertical', minHeight: 54, fontFamily: 'inherit' }} />
      </label>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, cursor: 'pointer', lineHeight: 1.4 }}>
        <input type="checkbox" checked={f.useLogo} onChange={(e) => set({ useLogo: e.target.checked })} style={{ width: 16, height: 16, marginTop: 1, accentColor: C.brand }} />
        <span>Use {props.airline}’s logo as the alliance’s logo. Other players see it once it’s been checked.</span>
      </label>
      {problem && <p style={{ fontSize: 12.5, margin: 0, color: C.red }}>{problem}</p>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Button variant="primary" type="submit" disabled={props.busy || !f.name.trim() || !f.tag}>
          {props.submit}
        </Button>
        {props.onCancel && (
          <Button variant="ghost" type="button" onClick={props.onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <p style={note}>
        Up to {MAX_ALLIANCE} airlines, all {props.mode === 'sandbox' ? 'Sandbox' : 'Career'} like this one. Its name, tag, colours, logo and description are seen by the airlines in it and their friends.
      </p>
    </form>
  );
}

/** Bright enough on every map style, and far enough apart to tell airlines apart. Yours is the first. */
const LINE_COLOURS = ['#38bdf8', '#f59e0b', '#a3e635', '#f472b6', '#c084fc', '#2dd4bf', '#fb7185', '#facc15', '#60a5fa', '#fb923c', '#4ade80', '#e879f9'];
const lineColour = (i: number) => LINE_COLOURS[i % LINE_COLOURS.length];

/** Every airline in the alliance that shows its flights to friends, on one map, each in its own colour. */
function AllianceMap(props: { me: string; ownName: string; career: SaveGameState | null; airports: ReadonlyMap<string, Airport>; mapStyle: MapStyleId; version: string }) {
  const { me, airports } = props;
  const [allies, setAllies] = useState<{ id: string; name: string; colour: string; routes: MapRoute[] }[] | null>(null);
  useEffect(() => {
    let live = true;
    void fetchFriendSchedules(me, {}).then((answer) => {
      if (!live) return;
      const list = mergeFriendAnswer([], answer).filter((f) => f.ally);
      setAllies(
        list.map((f, i) => {
          const colour = lineColour(i + 1);
          return { id: f.id, name: f.airline, colour, routes: friendAirlineStats(f.snapshot, airports).routes.map((r) => ({ ...r, colour })) };
        })
      );
    });
    return () => {
      live = false;
    };
  }, [me, airports, props.version]);
  // This airline's own routes, when it's the career being played. Read once: the career object is
  // made afresh on every redraw, and the map would start again each time.
  const [career] = useState(props.career);
  const own = useMemo(() => (career ? friendAirlineStats(buildSnapshot(career), airports).routes.map((r) => ({ ...r, colour: lineColour(0) })) : []), [career, airports]);
  const routes = useMemo(() => [...own, ...(allies ?? []).flatMap((a) => a.routes)], [own, allies]);
  if (allies === null) return <p style={note}>Loading the alliance’s network…</p>;
  const airportsServed = new Set(routes.flatMap((r) => [r.a, r.b])).size;
  const key = [...(career ? [{ id: 'me', name: props.ownName, colour: lineColour(0) }] : []), ...allies.filter((a) => a.routes.length)];
  return (
    <section style={{ display: 'grid', gap: 6, marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <p style={{ ...headStyle, margin: 0, flex: 1 }}>The alliance’s network</p>
        {routes.length > 0 && (
          <span style={{ fontSize: 12, color: C.muted }}>
            {routes.length.toLocaleString()} routes · {airportsServed.toLocaleString()} airports
          </span>
        )}
      </div>
      {routes.length ? <RouteMap routes={routes} airports={airports} mapStyle={props.mapStyle} label="The alliance’s route map" /> : <p style={note}>No flights to show yet.</p>}
      {key.length > 0 && (
        <div style={{ display: 'flex', gap: '4px 12px', flexWrap: 'wrap', fontSize: 12, color: C.textDim }}>
          {key.map((k) => (
            <span key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
              <span aria-hidden style={{ width: 12, height: 3, borderRadius: 2, background: k.colour, flex: 'none' }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{k.name}</span>
            </span>
          ))}
        </div>
      )}
      <p style={note}>Shows the airlines that show their flights to friends{career ? ', and yours' : ''}. Money and passengers stay private.</p>
    </section>
  );
}
