// ============================================================================
// THE ALLIANCES TAB (Update A)
//   One alliance per shared airline, up to 20 airlines, all Career or all
//   Sandbox. Two parts:
//     Our alliance: its banner, totals, a leaderboard of its airlines, the
//       network on a map (pick which airlines, and look from one hub), the
//       busiest hubs, requests to join, invites and members.
//     Find alliances: three featured alliances, picked at random each week,
//       a search, and any alliance's page, where an airline can join an open
//       alliance or ask to join one that takes requests.
//   The server decides everything (cloud/supabase/2026-11-07-alliances*.sql).
//   There are no messages of any kind, and everything from other players is
//   shown as plain text.
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MAX_ALLIANCE,
  ALLIANCE_NAME,
  allianceAnswer,
  answerAllianceInvite,
  answerAllianceRequest,
  cancelAllianceInvite,
  cancelAllianceRequest,
  cleanTag,
  createAlliance,
  disbandAlliance,
  editAlliance,
  handOverAlliance,
  inviteToAlliance,
  joinAlliance,
  leaveAlliance,
  loadAlliance,
  loadFeatured,
  removeFromAlliance,
  searchAlliances,
  setAllianceJoining,
  validTag,
  viewAlliance,
  type Alliance,
  type AllianceData,
  type AllianceForm,
  type Featured,
  type Joining,
  type PublicAlliance,
} from '../game/alliances';
import { fetchFriendSchedules, type MyAirline } from '../game/cloud';
import { departuresByAirport, friendAirlineStats, type MapRoute } from '../game/friendAirline';
import { loadFriends, type FriendCard, type Friend } from '../game/friends';
import { mergeFriendAnswer, refreshFriendsMap } from '../game/friendsMap';
import { buildSnapshot, type ScheduleSnapshot } from '../game/scheduleSnapshot';
import type { Airport, SaveGameState } from '../game/types';
import { Icon } from '../ui/icons';
import { Button, C, DISPLAY, Segmented, inputStyle } from '../ui/kit';
import { RouteMap } from './FriendAirline';
import { AirlineChip, AirlineName, AllianceTag, ConfirmButton, badgeFor } from './FriendsTab';
import { ReportButton } from './ReportButton';
import type { MapStyleId } from './LiveMap';

type Act = (label: string, fn: () => Promise<unknown>) => Promise<void>;
type Part = 'ours' | 'find' | 'start';

const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, background: C.raised, flexWrap: 'wrap' };
const headStyle: React.CSSProperties = { fontSize: 12, fontWeight: 650, color: C.muted, margin: '8px 0 0', textTransform: 'uppercase', letterSpacing: '0.06em' };
const note: React.CSSProperties = { fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.45 };
const day = (x: string) => (x ? new Date(x).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const n = (x: number) => x.toLocaleString();
const plural = (k: number, one: string, many = `${one}s`) => `${n(k)} ${k === 1 ? one : many}`;
const MEDALS = ['#f5c542', '#c7d0db', '#d08b4f'];

export function AlliancesTab(props: { me: MyAirline; busy: boolean; act: Act; career: SaveGameState | null; airports?: ReadonlyMap<string, Airport>; mapStyle?: MapStyleId }) {
  const me = props.me.id;
  const [data, setData] = useState<AllianceData | null | undefined>(undefined);
  const [answer, setAnswer] = useState('');
  const [editing, setEditing] = useState(false);
  const [part, setPart] = useState<Part | null>(null);
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
    setPart(null);
  }, [me]);
  useEffect(() => {
    void load();
  }, [load]);
  // Kept fresh while it's open: airlines join, ask and leave from their own games
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 45_000);
    return () => window.clearInterval(id);
  }, [load]);
  // Each change goes to the server, then everything is read back, so what's shown is what's true
  const change = (label: string, fn: () => Promise<unknown>) =>
    props.act(label, async () => {
      await fn();
      await load();
      void refreshFriendsMap();
    });
  /** Runs an action whose answer is a word from the server, and says what it means. */
  const ask = (label: string, fn: () => Promise<string>, after?: (r: string) => void) =>
    change(label, async () => {
      const r = await fn();
      setAnswer(allianceAnswer(r));
      if (['created', 'saved', 'sent', 'joined', 'declined', 'requested'].includes(r)) after?.(r);
    });

  if (data === undefined) return <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>Loading alliances…</p>;
  if (data === null) return <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>Alliances can’t be loaded right now. Try again in a moment.</p>;

  const said = answer && (
    <p role="status" style={{ fontSize: 12.5, margin: 0, color: C.text }}>
      {answer}
    </p>
  );
  const al = data.alliance;
  const shown: Part = part ?? (al ? 'ours' : 'find');
  const pick = (p: Part) => {
    setAnswer('');
    setEditing(false);
    setPart(p);
    void load();
  };
  const waiting = al?.role === 'leader' ? al.requests.length : 0;

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Segmented<Part>
        value={shown}
        onChange={pick}
        options={
          al
            ? [
                { value: 'ours', label: waiting ? `${al.tag} · ${waiting} asking` : `Our alliance · ${al.tag}` },
                { value: 'find', label: 'Find alliances' },
              ]
            : [
                { value: 'find', label: data.invites.length ? `Find alliances · ${data.invites.length} invite${data.invites.length === 1 ? '' : 's'}` : 'Find alliances' },
                { value: 'start', label: 'Start one' },
              ]
        }
      />
      {shown === 'start' && !al && (
        <div style={{ display: 'grid', gap: 6 }}>
          {said}
          <AllianceEditor airline={props.me.airline} mode={data.mode} busy={props.busy} submit="Start the alliance" onSubmit={(f) => void ask('Starting your alliance…', () => createWith(me, f), () => setPart('ours'))} />
        </div>
      )}
      {shown === 'find' && <FindAlliances me={me} data={data} busy={props.busy} said={said} change={change} ask={ask} onJoined={() => setPart('ours')} />}
      {shown === 'ours' && al && editing && (
        <div style={{ display: 'grid', gap: 6 }}>
          <p style={{ ...headStyle, marginTop: 0 }}>Edit {al.name}</p>
          {said}
          <AllianceEditor
            airline={props.me.airline}
            mode={data.mode}
            busy={props.busy}
            start={{ name: al.name, tag: al.tag, colours: al.colours, description: al.description, useLogo: al.logo !== null, joining: al.joining }}
            submit="Save"
            onSubmit={(f) => void ask('Saving…', () => editWith(me, f, al.joining), () => setEditing(false))}
            onCancel={() => {
              setAnswer('');
              setEditing(false);
            }}
          />
        </div>
      )}
      {shown === 'ours' && al && !editing && (
        <InAlliance al={al} data={data} me={props.me} busy={props.busy} said={said} change={change} ask={ask} onEdit={() => (setAnswer(''), setEditing(true))} career={props.career} airports={props.airports} mapStyle={props.mapStyle} />
      )}
    </div>
  );
}

/** Starts an alliance, then sets how airlines join it (two steps on the server). */
async function createWith(me: string, f: AllianceForm): Promise<string> {
  const r = await createAlliance(me, f);
  if (r === 'created' && f.joining !== 'request') await setAllianceJoining(me, f.joining);
  return r;
}
async function editWith(me: string, f: AllianceForm, was: Joining): Promise<string> {
  const r = await editAlliance(me, f);
  if ((r === 'saved' || r === 'locked') && f.joining !== was) {
    const j = await setAllianceJoining(me, f.joining);
    if (r === 'locked') return j === 'saved' ? 'saved' : r;
  }
  return r;
}

// ---------------------------------------------------------------------------
// Our alliance
// ---------------------------------------------------------------------------
function InAlliance(props: {
  al: Alliance;
  data: AllianceData;
  me: MyAirline;
  busy: boolean;
  said: React.ReactNode;
  change: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  ask: (label: string, fn: () => Promise<string>, after?: (r: string) => void) => Promise<void>;
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
  const cards = al.members.map((m) => ({ id: m.id, me: m.me, role: m.role, card: m.card }));

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <AllianceHero
        a={{ ...al, members: al.count }}
        line={[`${al.count} of ${MAX_ALLIANCE} airlines`, al.createdAt ? `since ${day(al.createdAt)}` : '', leader ? 'You lead it' : ''].filter(Boolean).join(' · ')}
        action={
          leader ? (
            <Button size="sm" disabled={props.busy} onClick={props.onEdit}>
              <Icon name="edit" size={14} />
              Edit
            </Button>
          ) : (
            <ReportButton me={me} kind="alliance" target={al.id} name={al.name} logo={al.logo} disabled={props.busy} />
          )
        }
      />
      {props.said}
      <Totals cards={cards.map((c) => c.card)} count={al.count} />

      {leader && al.requests.length > 0 && (
        <section style={{ display: 'grid', gap: 6 }}>
          <p style={headStyle}>Asking to join ({al.requests.length})</p>
          {al.requests.map((r) => (
            <div key={r.id} style={{ ...rowStyle, boxShadow: `inset 3px 0 0 ${C.brand}` }}>
              <AirlineChip card={r.card} />
              <AirlineName card={r.card} extra={r.at ? `asked ${day(r.at)}` : ''} />
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Button size="sm" variant="primary" disabled={props.busy || al.count + al.invited.length >= MAX_ALLIANCE} onClick={() => void ask('Letting them in…', () => answerAllianceRequest(me, r.id, true))}>
                  Accept
                </Button>
                <Button size="sm" disabled={props.busy} onClick={() => void ask('Declining…', () => answerAllianceRequest(me, r.id, false))}>
                  Decline
                </Button>
                {r.card && <ReportButton me={me} kind="airline" target={r.id} name={r.card.airline} logo={r.card.badge} disabled={props.busy} />}
              </span>
            </div>
          ))}
        </section>
      )}

      <Leaderboard airlines={cards} />

      {props.airports && props.airports.size > 0 && props.mapStyle && (
        <AllianceMap me={me} ownName={props.me.airline} career={props.career} airports={props.airports} mapStyle={props.mapStyle} version={memberKey} memberIds={al.members.map((m) => m.id)} />
      )}

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
          <div style={{ ...rowStyle, justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13 }}>
              <strong>{al.joining === 'open' ? 'Open' : 'Request to join'}</strong>
              <span style={{ color: C.muted }}> · {al.joining === 'open' ? 'any airline that finds it can join at once' : 'airlines ask, you accept or decline'}</span>
            </span>
            <Segmented<Joining>
              size="sm"
              value={al.joining}
              onChange={(j) => void ask('Saving…', () => setAllianceJoining(me, j))}
              options={[
                { value: 'request', label: 'Request' },
                { value: 'open', label: 'Open' },
              ]}
            />
          </div>
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
            <p style={note}>Every friend of {props.me.airline} is in an alliance or invited already. Add friends in the Friends tab, or let other airlines find you in Find alliances.</p>
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
        </>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        <ConfirmButton label="Leave the alliance" ask={leader && others.length ? 'Leave, the next airline leads' : 'Leave it'} disabled={props.busy} onConfirm={() => void change('Leaving…', () => leaveAlliance(me))} />
        {leader && others.length > 0 && <ConfirmButton label="Disband it" ask="Disband it for everyone" disabled={props.busy} onConfirm={() => void change('Disbanding…', () => disbandAlliance(me))} />}
      </div>
    </div>
  );
}

/** The alliance's banner: its logo or tag, name, description, in its own colours. */
function AllianceHero(props: { a: Pick<PublicAlliance, 'name' | 'tag' | 'colours' | 'logo' | 'description' | 'joining'> & { members: number }; line: string; action?: React.ReactNode }) {
  const { a } = props;
  return (
    <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', background: C.raised, border: `1px solid ${C.border}` }}>
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: `linear-gradient(120deg, ${a.colours.a}55 0%, ${a.colours.b}33 55%, transparent 85%)` }} />
      <div aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 4, background: `linear-gradient(90deg, ${a.colours.a} 50%, ${a.colours.b} 50%)` }} />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 14, padding: '16px 14px 14px', flexWrap: 'wrap' }}>
        <AllianceBadgeBox logo={a.logo} tag={a.tag} colours={a.colours} size={64} />
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 700, lineHeight: 1.1, overflowWrap: 'anywhere' }}>{a.name}</span>
            <AllianceTag badge={a} />
            <JoiningPill joining={a.joining} />
          </div>
          <div style={{ fontSize: 12.5, color: C.textDim, marginTop: 3 }}>{props.line}</div>
          {a.description && <p style={{ fontSize: 13.5, margin: '8px 0 0', lineHeight: 1.45, overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>{a.description}</p>}
        </div>
        {props.action}
      </div>
    </div>
  );
}

function JoiningPill(props: { joining: Joining }) {
  const open = props.joining === 'open';
  return (
    <span style={{ fontSize: 11, fontWeight: 650, padding: '1px 8px', borderRadius: 999, border: `1px solid ${open ? C.green : C.border}`, color: open ? C.green : C.muted, whiteSpace: 'nowrap' }}>
      {open ? 'Open to join' : 'Request to join'}
    </span>
  );
}

const statsOf = (c: FriendCard | null) => ({ fleet: c?.fleet ?? 0, routes: c?.stats?.routes ?? 0, airports: c?.stats?.airports ?? 0, hubs: c?.stats?.hubs ?? 0 });

/** The alliance's totals, added up from its airlines' summaries. */
function Totals(props: { cards: (FriendCard | null)[]; count: number; totals?: { fleet: number; routes: number; airports: number; hubs: number } }) {
  const t = props.totals ?? props.cards.reduce((s, c) => {
    const x = statsOf(c);
    return { fleet: s.fleet + x.fleet, routes: s.routes + x.routes, airports: s.airports + x.airports, hubs: s.hubs + x.hubs };
  }, { fleet: 0, routes: 0, airports: 0, hubs: 0 });
  const tiles: [string, number, string][] = [
    ['Airlines', props.count, `of ${MAX_ALLIANCE}`],
    ['Aircraft', t.fleet, 'flying together'],
    ['Routes', t.routes, 'between them'],
    ['Airports', t.airports, 'served'],
    ['Hubs', t.hubs, 'bases'],
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
      {tiles.map(([label, v, sub]) => (
        <div key={label} style={{ padding: '10px 12px', borderRadius: 12, background: C.raised, border: `1px solid ${C.lineSoft}` }}>
          <div style={{ fontSize: 11.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 650 }}>{label}</div>
          <div className="num" style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 700, lineHeight: 1.1 }}>
            {n(v)}
          </div>
          <div style={{ fontSize: 11, color: C.faint }}>{sub}</div>
        </div>
      ))}
    </div>
  );
}

type Metric = 'routes' | 'fleet' | 'airports' | 'hubs';
const METRIC_LABEL: Record<Metric, string> = { routes: 'routes', fleet: 'aircraft', airports: 'airports', hubs: 'hubs' };

/** The alliance's airlines, biggest first, by routes or another measure. */
function Leaderboard(props: { airlines: { id: string; me?: boolean; role: 'leader' | 'member'; card: FriendCard | null }[] }) {
  const [by, setBy] = useState<Metric>('routes');
  const ranked = [...props.airlines].filter((a) => a.card).sort((x, y) => statsOf(y.card)[by] - statsOf(x.card)[by] || (x.card!.airline < y.card!.airline ? -1 : 1));
  if (!ranked.length) return null;
  const top = Math.max(1, statsOf(ranked[0].card)[by]);
  return (
    <section style={{ display: 'grid', gap: 6, marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <p style={{ ...headStyle, margin: 0, flex: 1 }}>Biggest airlines</p>
        <Segmented<Metric>
          size="sm"
          value={by}
          onChange={setBy}
          options={[
            { value: 'routes', label: 'Routes' },
            { value: 'fleet', label: 'Fleet' },
            { value: 'airports', label: 'Airports' },
            { value: 'hubs', label: 'Hubs' },
          ]}
        />
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
        {ranked.map((a, i) => {
          const v = statsOf(a.card)[by];
          return (
            <li key={a.id} style={{ ...rowStyle, padding: '7px 10px', gap: 10, flexWrap: 'nowrap', border: a.me ? `1px solid ${C.brand}` : '1px solid transparent' }}>
              <span
                aria-label={`Number ${i + 1}`}
                style={{ width: 26, height: 26, flex: 'none', borderRadius: 999, display: 'grid', placeItems: 'center', fontFamily: DISPLAY, fontWeight: 700, fontSize: 14, background: i < 3 ? MEDALS[i] : C.bg, color: i < 3 ? '#1b1b1b' : C.muted }}
              >
                {i + 1}
              </span>
              <AirlineChip card={a.card} />
              <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 3 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{ fontWeight: 650, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.card!.airline}</span>
                  {a.role === 'leader' && <span style={{ fontSize: 11, color: C.amber }}>Leader</span>}
                  {a.me && <span style={{ fontSize: 11, color: C.brand }}>You</span>}
                </span>
                <span aria-hidden style={{ height: 5, borderRadius: 3, background: C.bg, overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${Math.max(2, (v / top) * 100)}%`, borderRadius: 3, background: `linear-gradient(90deg, ${a.card!.colours.a}, ${a.card!.colours.b})` }} />
                </span>
              </span>
              <span className="num" style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 18, minWidth: 54, textAlign: 'right' }}>
                {n(v)}
                <span style={{ display: 'block', fontFamily: 'inherit', fontSize: 10.5, fontWeight: 500, color: C.muted, lineHeight: 1 }}>{METRIC_LABEL[by]}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
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
  const box: React.CSSProperties = { width: props.size, height: props.size, flex: 'none', borderRadius: props.size / 4, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,.25)' };
  if (url) return <img src={url} alt="" draggable={false} style={{ ...box, background: '#fff', padding: 3, objectFit: 'contain' }} />;
  return (
    <span aria-hidden style={{ ...box, background: `linear-gradient(135deg, ${props.colours.a} 50%, ${props.colours.b} 50%)`, color: '#fff', fontWeight: 700, fontSize: props.size * 0.32, letterSpacing: '0.03em', textShadow: '0 1px 2px rgba(0,0,0,.55)' }}>
      {props.tag}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The network map: pick airlines, look from one hub
// ---------------------------------------------------------------------------
/** Bright enough on every map style, and far enough apart to tell airlines apart. Yours is the first. */
const LINE_COLOURS = ['#38bdf8', '#f59e0b', '#a3e635', '#f472b6', '#c084fc', '#2dd4bf', '#fb7185', '#facc15', '#60a5fa', '#fb923c', '#4ade80', '#e879f9'];
const lineColour = (i: number) => LINE_COLOURS[i % LINE_COLOURS.length];
type Network = { id: string; name: string; colour: string; routes: MapRoute[]; departures: Map<string, number> };

/** Every airline in the alliance that shows its flights to friends, on one map, each in its own colour. */
function AllianceMap(props: { me: string; ownName: string; career: SaveGameState | null; airports: ReadonlyMap<string, Airport>; mapStyle: MapStyleId; version: string; memberIds: string[] }) {
  const { me, airports } = props;
  const [allies, setAllies] = useState<Network[] | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hub, setHub] = useState<string>('');
  useEffect(() => {
    let live = true;
    void fetchFriendSchedules(me, {}).then((answer) => {
      if (!live) return;
      const members = new Set(props.memberIds);
      const list = mergeFriendAnswer([], answer).filter((f) => f.ally && members.has(f.id));
      setAllies(list.map((f, i) => network(f.id, f.airline, lineColour(i + 1), f.snapshot, airports)));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, airports, props.version]);
  // This airline's own routes, when it's the career being played. Read once: the career object is
  // made afresh on every redraw, and the map would start again each time.
  const [career] = useState(props.career);
  const own = useMemo(() => (career ? network('me', props.ownName, lineColour(0), buildSnapshot(career), airports) : null), [career, airports, props.ownName]);
  const all = useMemo(() => [...(own ? [own] : []), ...(allies ?? []).filter((a) => a.routes.length)], [own, allies]);
  const shown = all.filter((a) => !hidden.has(a.id));

  // Airports by departures a week, for the hub list
  const hubs = useMemo(() => {
    const total = new Map<string, { dep: number; airlines: number }>();
    for (const a of shown)
      for (const [iata, d] of a.departures) {
        const t = total.get(iata) ?? { dep: 0, airlines: 0 };
        total.set(iata, { dep: t.dep + d, airlines: t.airlines + 1 });
      }
    return [...total.entries()].sort((x, y) => y[1].dep - x[1].dep || x[0].localeCompare(y[0]));
  }, [shown]);
  const hubOk = hub && hubs.some(([i]) => i === hub) ? hub : '';
  const routes = useMemo(() => shown.flatMap((a) => (hubOk ? a.routes.filter((r) => r.a === hubOk || r.b === hubOk) : a.routes)), [shown, hubOk]);

  if (allies === null && !own) return <p style={note}>Loading the alliance’s network…</p>;
  const airportsServed = new Set(routes.flatMap((r) => [r.a, r.b])).size;
  const fromHub = hubOk ? hubs.find(([i]) => i === hubOk)?.[1] : null;
  const place = (iata: string) => (airports.get(iata)?.municipality || airports.get(iata)?.name || iata).replace(/\s*\(.*\)\s*$/, '');
  const longest = routes.reduce<MapRoute | null>((b, r) => (!b || r.nm > b.nm ? r : b), null);
  const hubRank = hubOk ? shown.map((a) => ({ a, dep: a.departures.get(hubOk) ?? 0 })).filter((x) => x.dep > 0).sort((x, y) => y.dep - x.dep) : [];

  return (
    <section style={{ display: 'grid', gap: 8, marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <p style={{ ...headStyle, margin: 0, flex: 1 }}>The alliance’s network</p>
        {all.length > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.muted }}>
            From
            <select value={hubOk} onChange={(e) => setHub(e.target.value)} style={{ ...inputStyle, width: 'auto', padding: '4px 8px', fontSize: 13 }}>
              <option value="">Every airport</option>
              {hubs.slice(0, 60).map(([iata, t]) => (
                <option key={iata} value={iata}>
                  {iata} · {place(iata)} ({n(t.dep)} a week)
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {all.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {all.map((a) => {
            const on = !hidden.has(a.id);
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setHidden((h) => {
                    const x = new Set(h);
                    if (x.has(a.id)) x.delete(a.id);
                    else x.add(a.id);
                    return x;
                  })
                }
                title={on ? `Hide ${a.name}’s routes` : `Show ${a.name}’s routes`}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, border: `1px solid ${on ? a.colour : C.border}`, background: on ? `${a.colour}22` : 'transparent', color: on ? C.text : C.faint, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', maxWidth: 220 }}
              >
                <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: on ? a.colour : C.border, flex: 'none' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
              </button>
            );
          })}
          {hidden.size > 0 && (
            <button type="button" onClick={() => setHidden(new Set())} style={{ border: 0, background: 'none', color: C.accent, fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline' }}>
              Show all
            </button>
          )}
        </div>
      )}
      {all.length ? <RouteMap routes={routes} airports={airports} mapStyle={props.mapStyle} hub={hubOk || null} height="min(380px, 50vh)" label="The alliance’s route map" /> : <p style={note}>No flights to show yet. Airlines appear here once they show their flights to friends.</p>}
      {all.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          <MiniStat label={hubOk ? `Flights from ${hubOk}` : 'Flights a week'} value={n(hubOk ? fromHub?.dep ?? 0 : shown.reduce((s, a) => s + [...a.departures.values()].reduce((x, y) => x + y, 0), 0))} sub={hubOk ? 'departures a week' : 'all airlines shown'} />
          <MiniStat label="Routes" value={n(routes.length)} sub={hubOk ? `from ${place(hubOk)}` : 'on the map'} />
          <MiniStat label="Airports" value={n(airportsServed)} sub="reached" />
          {hubOk ? <MiniStat label="Airlines here" value={n(fromHub?.airlines ?? 0)} sub={`fly from ${hubOk}`} /> : longest && <MiniStat label="Longest route" value={`${longest.a}–${longest.b}`} sub={`${n(longest.nm)} nm`} />}
        </div>
      )}
      {hubOk && hubRank.length > 0 && (
        <div style={{ display: 'grid', gap: 4 }}>
          {hubRank.map(({ a, dep }) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: a.colour, flex: 'none' }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
              <span className="num" style={{ color: C.textDim }}>{plural(dep, 'flight')} a week</span>
            </div>
          ))}
        </div>
      )}
      {!hubOk && hubs.length > 0 && (
        <div style={{ display: 'grid', gap: 4 }}>
          <p style={{ ...headStyle, marginTop: 4 }}>Busiest hubs</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {hubs.slice(0, 6).map(([iata, t], i) => (
              <button
                key={iata}
                type="button"
                onClick={() => setHub(iata)}
                title={`Show only routes from ${place(iata)}`}
                style={{ display: 'grid', gap: 1, textAlign: 'left', padding: '7px 11px', borderRadius: 10, border: `1px solid ${C.lineSoft}`, background: C.raised, color: C.text, cursor: 'pointer', minWidth: 110 }}
              >
                <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17 }}>
                  {i === 0 && <span aria-hidden>★ </span>}
                  {iata}
                </span>
                <span style={{ fontSize: 11.5, color: C.muted }}>{place(iata)}</span>
                <span style={{ fontSize: 11.5, color: C.textDim }}>
                  {n(t.dep)} a week · {plural(t.airlines, 'airline')}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <p style={note}>Shows the airlines that show their flights to friends{career ? ', and yours' : ''}. Tap an airline to hide or show it. Money and passengers stay private.</p>
    </section>
  );
}

function network(id: string, name: string, colour: string, snap: ScheduleSnapshot, airports: ReadonlyMap<string, Airport>): Network {
  return { id, name, colour, routes: friendAirlineStats(snap, airports).routes.map((r) => ({ ...r, colour })), departures: departuresByAirport(snap, airports) };
}

function MiniStat(props: { label: string; value: string; sub: string }) {
  return (
    <div style={{ padding: '8px 10px', borderRadius: 10, background: C.raised }}>
      <div style={{ fontSize: 11.5, color: C.muted }}>{props.label}</div>
      <div className="num" style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, lineHeight: 1.15 }}>
        {props.value}
      </div>
      <div style={{ fontSize: 11, color: C.faint }}>{props.sub}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Finding alliances
// ---------------------------------------------------------------------------
function FindAlliances(props: {
  me: string;
  data: AllianceData;
  busy: boolean;
  said: React.ReactNode;
  change: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  ask: (label: string, fn: () => Promise<string>, after?: (r: string) => void) => Promise<void>;
  onJoined: () => void;
}) {
  const { me, data } = props;
  const [featured, setFeatured] = useState<Featured | null | undefined>(undefined);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PublicAlliance[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadFeatured(me)
      .then((f) => live && setFeatured(f))
      .catch(() => live && setFeatured(null));
    return () => {
      live = false;
    };
  }, [me]);
  // Search as the player types, a moment after they stop
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => {
      searchAlliances(me, q)
        .then((r) => live && setResults(r))
        .catch(() => live && setResults([]));
    }, q ? 300 : 0);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [me, q]);

  if (open) return <AllianceView me={me} id={open} busy={props.busy} said={props.said} ask={props.ask} change={props.change} onBack={() => setOpen(null)} onJoined={props.onJoined} />;

  const daysLeft = featured?.until ? Math.max(1, Math.ceil((Date.parse(featured.until) - Date.now()) / 86_400_000)) : null;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {props.said}
      {data.invites.length > 0 && (
        <section style={{ display: 'grid', gap: 6 }}>
          <p style={{ ...headStyle, marginTop: 0 }}>Invited to join</p>
          {data.invites.map((i) => (
            <div key={i.alliance.id} style={{ ...rowStyle, boxShadow: `inset 3px 0 0 ${C.brand}` }}>
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
                <Button size="sm" variant="primary" disabled={props.busy} onClick={() => void props.ask('Joining…', () => answerAllianceInvite(me, i.alliance.id, true), props.onJoined)}>
                  Join
                </Button>
                <Button size="sm" disabled={props.busy} onClick={() => void props.ask('Declining…', () => answerAllianceInvite(me, i.alliance.id, false))}>
                  Decline
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(i.alliance.id)}>
                  Look
                </Button>
              </span>
            </div>
          ))}
          <p style={note}>Joining one turns down the others.</p>
        </section>
      )}

      <section style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <p style={{ ...headStyle, margin: 0, flex: 1 }}>
            <span aria-hidden style={{ color: C.amber }}>★ </span>Featured this week
          </p>
          {daysLeft && featured?.alliances.length ? <span style={{ fontSize: 12, color: C.muted }}>New picks in {plural(daysLeft, 'day')}</span> : null}
        </div>
        {featured === undefined ? (
          <p style={note}>Picking this week’s alliances…</p>
        ) : !featured || featured.alliances.length === 0 ? (
          <p style={note}>No alliances to feature yet. Start one and it could be picked next.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8 }}>
            {featured.alliances.map((a) => (
              <FeaturedCard key={a.id} a={a} onOpen={() => setOpen(a.id)} />
            ))}
          </div>
        )}
      </section>

      <section style={{ display: 'grid', gap: 6 }}>
        <p style={headStyle}>{q.trim() ? 'Search results' : 'Biggest alliances'}</p>
        <div style={{ position: 'relative' }}>
          <Icon name="search" size={15} color={C.muted} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={q} maxLength={40} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or tag" aria-label="Search alliances" autoComplete="off" spellCheck={false} style={{ ...inputStyle, paddingLeft: 32 }} />
        </div>
        {results === null ? (
          <p style={note}>Searching…</p>
        ) : results.length === 0 ? (
          <p style={note}>{q.trim() ? 'No alliance has that name or tag.' : `No ${data.mode === 'sandbox' ? 'Sandbox' : 'Career'} alliances yet.`}</p>
        ) : (
          results.map((a, i) => (
            <button key={a.id} type="button" onClick={() => setOpen(a.id)} style={{ ...rowStyle, border: 0, color: C.text, cursor: 'pointer', textAlign: 'left', flexWrap: 'nowrap', font: 'inherit' }}>
              {!q.trim() && (
                <span className="num" style={{ width: 22, flex: 'none', textAlign: 'center', fontFamily: DISPLAY, fontWeight: 700, fontSize: 16, color: i < 3 ? MEDALS[i] : C.muted }}>
                  {i + 1}
                </span>
              )}
              <AllianceBadgeBox logo={a.logo} tag={a.tag} colours={a.colours} size={38} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{ fontWeight: 650, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                  <AllianceTag badge={a} />
                </span>
                <span style={{ display: 'block', fontSize: 12, color: C.muted }}>
                  {plural(a.members, 'airline')} · {plural(a.totals.routes, 'route')} · {plural(a.totals.fleet, 'aircraft', 'aircraft')}
                </span>
              </span>
              <JoiningPill joining={a.joining} />
              <Icon name="chevron" size={14} color={C.muted} />
            </button>
          ))
        )}
        <p style={note}>Only {data.mode === 'sandbox' ? 'Sandbox' : 'Career'} alliances are shown, like this airline.</p>
      </section>

      {data.asked.length > 0 && (
        <section style={{ display: 'grid', gap: 6 }}>
          <p style={headStyle}>You’ve asked to join</p>
          {data.asked.map((x) => (
            <div key={x.alliance.id} style={rowStyle}>
              <AllianceBadgeBox logo={x.alliance.logo} tag={x.alliance.tag} colours={x.alliance.colours} size={32} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>
                <strong>{x.alliance.name}</strong> <span style={{ color: C.muted }}>· asked {day(x.at)}, waiting for its leader</span>
              </span>
              <Button size="sm" variant="ghost" disabled={props.busy} onClick={() => void props.change('Taking it back…', () => cancelAllianceRequest(me, x.alliance.id))}>
                Take back
              </Button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function FeaturedCard(props: { a: PublicAlliance; onOpen: () => void }) {
  const { a } = props;
  return (
    <button
      type="button"
      onClick={props.onOpen}
      style={{ position: 'relative', overflow: 'hidden', display: 'grid', gap: 8, padding: 0, borderRadius: 14, border: `1px solid ${C.border}`, background: C.raised, color: C.text, cursor: 'pointer', textAlign: 'left', font: 'inherit' }}
    >
      <span aria-hidden style={{ height: 54, background: `linear-gradient(120deg, ${a.colours.a}, ${a.colours.b})` }} />
      <span style={{ position: 'absolute', top: 24, left: 12 }}>
        <AllianceBadgeBox logo={a.logo} tag={a.tag} colours={a.colours} size={50} />
      </span>
      <span style={{ display: 'grid', gap: 4, padding: '20px 12px 12px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 18, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
          <AllianceTag badge={a} />
        </span>
        {a.description && <span style={{ fontSize: 12, color: C.textDim, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>{a.description}</span>}
        <span style={{ display: 'flex', gap: 12, fontSize: 12, color: C.muted, flexWrap: 'wrap' }}>
          <span>
            <strong style={{ color: C.text }}>{n(a.members)}</strong> airlines
          </span>
          <span>
            <strong style={{ color: C.text }}>{n(a.totals.routes)}</strong> routes
          </span>
          <span>
            <strong style={{ color: C.text }}>{n(a.totals.fleet)}</strong> aircraft
          </span>
        </span>
        <JoiningPill joining={a.joining} />
      </span>
    </button>
  );
}

/** One alliance's page, as any airline of its mode sees it, with the way in. */
function AllianceView(props: {
  me: string;
  id: string;
  busy: boolean;
  said: React.ReactNode;
  ask: (label: string, fn: () => Promise<string>, after?: (r: string) => void) => Promise<void>;
  change: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  onBack: () => void;
  onJoined: () => void;
}) {
  const { me, id } = props;
  const [a, setA] = useState<PublicAlliance | null | undefined>(undefined);
  const [v, setV] = useState(0);
  useEffect(() => {
    let live = true;
    viewAlliance(me, id)
      .then((x) => live && setA(x))
      .catch(() => live && setA(null));
    return () => {
      live = false;
    };
  }, [me, id, v]);
  const again = () => setV((x) => x + 1);
  const back = (
    <Button size="sm" variant="ghost" onClick={props.onBack} style={{ justifySelf: 'start' }}>
      <Icon name="chevron" size={14} style={{ transform: 'rotate(180deg)' }} />
      All alliances
    </Button>
  );
  if (a === undefined) return <div style={{ display: 'grid', gap: 8 }}>{back}<p style={note}>Loading…</p></div>;
  if (a === null) return <div style={{ display: 'grid', gap: 8 }}>{back}<p style={note}>This alliance can’t be seen any more.</p></div>;

  const full = a.members >= MAX_ALLIANCE;
  const join = () => void props.ask(a.joining === 'open' || a.standing === 'invited' ? 'Joining…' : 'Asking…', () => joinAlliance(me, a.id), (r) => (r === 'joined' ? props.onJoined() : again()));
  const way =
    a.standing === 'member' ? (
      <span style={{ fontSize: 13, color: C.green, fontWeight: 650 }}>You’re in it</span>
    ) : a.standing === 'other' ? (
      <span style={{ fontSize: 12.5, color: C.muted }}>Leave your alliance to join another</span>
    ) : a.standing === 'asked' ? (
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12.5, color: C.muted }}>Asked, waiting for its leader</span>
        <Button size="sm" variant="ghost" disabled={props.busy} onClick={() => void props.change('Taking it back…', () => cancelAllianceRequest(me, a.id)).then(again)}>
          Take back
        </Button>
      </span>
    ) : (
      <Button variant="primary" disabled={props.busy || (full && a.standing !== 'invited')} onClick={join}>
        {full && a.standing !== 'invited' ? 'Full' : a.standing === 'invited' ? 'Join (you’re invited)' : a.joining === 'open' ? 'Join' : 'Ask to join'}
      </Button>
    );

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {back}
      <AllianceHero a={a} line={[`${a.members} of ${MAX_ALLIANCE} airlines`, a.createdAt ? `since ${day(a.createdAt)}` : ''].filter(Boolean).join(' · ')} action={<ReportButton me={me} kind="alliance" target={a.id} name={a.name} logo={a.logo} disabled={props.busy} />} />
      <div style={{ ...rowStyle, justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12.5, color: C.muted, flex: '1 1 200px' }}>{a.joining === 'open' ? 'Any airline can join this alliance straight away.' : 'Its leader accepts or declines each airline that asks. No message is sent with it.'}</span>
        {way}
      </div>
      {props.said}
      <Totals cards={[]} count={a.members} totals={a.totals} />
      {a.airlines && <Leaderboard airlines={a.airlines} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Start or edit
// ---------------------------------------------------------------------------
/** Start or edit an alliance. Checked here first so most mistakes are caught before the server sees them. */
function AllianceEditor(props: { airline: string; mode: 'career' | 'sandbox'; busy: boolean; start?: AllianceForm; submit: string; onSubmit: (f: AllianceForm) => void; onCancel?: () => void }) {
  const [f, setF] = useState<AllianceForm>(() => props.start ?? { name: '', tag: '', colours: { a: '#0b6e4f', b: '#f5a623' }, description: '', useLogo: false, joining: 'request' });
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
      style={{ display: 'grid', gap: 12, padding: 14, borderRadius: 12, background: C.raised }}
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
      <div style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 12, color: C.muted }}>How airlines join</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
          {(
            [
              ['request', 'Request to join', 'Airlines ask; you accept or decline each one.'],
              ['open', 'Open', 'Any airline that finds it can join straight away.'],
            ] as const
          ).map(([v, t, d]) => (
            <label key={v} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '9px 10px', borderRadius: 10, border: `1px solid ${f.joining === v ? C.brand : C.border}`, background: f.joining === v ? `${C.brand}14` : 'transparent', cursor: 'pointer' }}>
              <input type="radio" name="joining" checked={f.joining === v} onChange={() => set({ joining: v })} style={{ marginTop: 2, accentColor: C.brand }} />
              <span>
                <span style={{ display: 'block', fontWeight: 650, fontSize: 13.5 }}>{t}</span>
                <span style={{ display: 'block', fontSize: 12, color: C.muted, lineHeight: 1.4 }}>{d}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
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
        Up to {MAX_ALLIANCE} airlines, all {props.mode === 'sandbox' ? 'Sandbox' : 'Career'} like this one. Every {props.mode === 'sandbox' ? 'Sandbox' : 'Career'} airline can find it and see its name, tag, colours, logo, description and airlines.
      </p>
    </form>
  );
}
