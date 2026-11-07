// ============================================================================
// THE FRIENDS TAB (Update A, phase A3)
//   One shared airline's code, adding by code, requests, friends and blocks. The
//   server decides everything (cloud/supabase/2026-11-07-airlines.sql). All names
//   here came from other players, so they only ever appear as plain text.
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import { fetchSharedLogo, type MyAirline } from '../game/cloud';
import { featureOn } from '../game/features';
import { blockFriend, cleanFriendCode, formatFriendCode, loadFriends, newFriendCode, removeFriend, respondToFriend, sendFriendRequest, setFriendOnMap, unblockFriend, type FriendCard, type FriendsData } from '../game/friends';
import { refreshFriendsMap } from '../game/friendsMap';
import { Icon } from '../ui/icons';
import { Button, C, inputStyle } from '../ui/kit';

type Act = (label: string, fn: () => Promise<unknown>) => Promise<void>;

const rowStyle: () => React.CSSProperties = () => ({ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, background: C.raised, flexWrap: 'wrap' });
const headStyle: () => React.CSSProperties = () => ({ fontSize: 12, fontWeight: 650, color: C.muted, margin: '6px 0 0' });

const badges = new Map<string, Promise<string | null>>();
function badgeFor(hash: string) {
  let p = badges.get(hash);
  if (!p) {
    p = fetchSharedLogo(hash);
    badges.set(hash, p);
  }
  return p;
}

/** The airline's badge once it's approved, else its code in its colours. */
function AirlineChip({ card }: { card: FriendCard | null }) {
  const [badge, setBadge] = useState<string | null>(null);
  const hash = card?.badge ?? null;
  useEffect(() => {
    let live = true;
    setBadge(null);
    if (hash) void badgeFor(hash).then((u) => live && setBadge(u));
    return () => {
      live = false;
    };
  }, [hash]);
  const box: React.CSSProperties = { width: 36, height: 36, flex: 'none', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' };
  if (badge) return <img src={badge} alt="" draggable={false} style={{ ...box, background: '#fff', padding: 3, objectFit: 'contain' }} />;
  return (
    <span aria-hidden style={{ ...box, background: card ? `linear-gradient(135deg, ${card.colours.a} 50%, ${card.colours.b} 50%)` : C.line, color: '#fff', fontWeight: 700, fontSize: 12.5, textShadow: '0 1px 2px rgba(0,0,0,.55)' }}>
      {card?.code ?? '?'}
    </span>
  );
}

function AirlineName({ card }: { card: FriendCard | null }) {
  const details = card ? [card.code, card.callsign, card.fleet === null ? '' : `${card.fleet} aircraft`].filter(Boolean).join(' · ') : 'Not sharing an airline right now';
  return (
    <span style={{ flex: '1 1 150px', minWidth: 0 }}>
      <span style={{ display: 'block', fontWeight: 650, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card?.airline ?? 'An airline'}</span>
      <span style={{ display: 'block', fontSize: 12, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{details}</span>
    </span>
  );
}

/** Asks once more before something that's hard to take back. */
export function ConfirmButton(props: { label: string; ask: string; disabled?: boolean; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <Button size="sm" variant="ghost" disabled={props.disabled} onClick={() => setAsking(true)}>
        {props.label}
      </Button>
    );
  return (
    <>
      <Button size="sm" variant="danger" disabled={props.disabled} onClick={props.onConfirm}>
        {props.ask}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
        Keep
      </Button>
    </>
  );
}

export function FriendsTab(props: { me: MyAirline; busy: boolean; act: Act }) {
  const me = props.me.id;
  const [data, setData] = useState<FriendsData | null | undefined>(undefined);
  const [typed, setTyped] = useState('');
  const [answer, setAnswer] = useState('');
  const [copied, setCopied] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  const mapFeature = featureOn('friends_map');
  const load = useCallback(async () => {
    try {
      setData(await loadFriends(me));
    } catch {
      setData((d) => d ?? null);
    }
  }, [me]);
  // Another airline: nothing of the last one's shows while this one loads
  useEffect(() => {
    setData(undefined);
    setAnswer('');
    setTyped('');
  }, [me]);
  useEffect(() => {
    void load();
  }, [load]);
  // Each change goes to the server, then the list is read back, so what's shown is what's true
  const change = (label: string, fn: () => Promise<unknown>) =>
    props.act(label, async () => {
      await fn();
      await load();
      // The map follows straight away
      void refreshFriendsMap();
    });

  if (data === undefined) return <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>Loading your friends…</p>;
  if (data === null) return <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>Your friends can’t be loaded right now. Try again in a moment.</p>;

  const send = () => {
    const code = cleanFriendCode(typed);
    if (code.length !== 8) return setAnswer('Friend codes have 8 letters and numbers.');
    setAnswer('');
    void change('Sending…', async () => {
      const said = await sendFriendRequest(me, code);
      setAnswer(said);
      setTyped('');
    });
  };

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ ...rowStyle(), justifyContent: 'space-between' }}>
        <span style={{ flex: '1 1 180px', minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{props.me.airline}’s friend code: give it only to people you know</span>
          <span className="num" style={{ display: 'block', fontSize: 21, fontWeight: 700, letterSpacing: '0.09em', marginTop: 1 }}>
            {formatFriendCode(data.code)}
          </span>
        </span>
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Button
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(data.code).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <ConfirmButton
            label="New code"
            ask="Replace it"
            disabled={props.busy}
            onConfirm={() =>
              void change('Making a new code…', async () => {
                if (!(await newFriendCode(me))) setAnswer('That’s enough new codes for today. Try again tomorrow.');
              })
            }
          />
        </span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        style={{ display: 'flex', gap: 6 }}
      >
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value.toUpperCase().slice(0, 12))}
          placeholder="A friend’s code"
          aria-label="A friend’s code"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          style={{ ...inputStyle, flex: 1, minWidth: 0, letterSpacing: '0.06em' }}
        />
        <Button variant="primary" type="submit" disabled={props.busy || !typed.trim()}>
          <Icon name="plus" size={14} />
          Add friend
        </Button>
      </form>
      <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>
        {data.mode === 'sandbox' ? 'A Sandbox airline: its friends are Sandbox airlines too.' : 'A Career airline: its friends are Career airlines too.'}
      </p>
      {answer && (
        <p role="status" style={{ fontSize: 12.5, margin: 0, color: C.text }}>
          {answer}
        </p>
      )}

      {data.incoming.length > 0 && <p style={headStyle()}>Asking to be friends</p>}
      {data.incoming.map((r) => (
        <div key={r.id} style={rowStyle()}>
          <AirlineChip card={r.card} />
          <AirlineName card={r.card} />
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Button
              size="sm"
              variant="primary"
              disabled={props.busy}
              onClick={() =>
                void change('Accepting…', async () => {
                  const said = await respondToFriend(me, r.id, true);
                  if (said) setAnswer(said);
                })
              }
            >
              Accept
            </Button>
            <Button size="sm" disabled={props.busy} onClick={() => void change('Declining…', () => respondToFriend(me, r.id, false))}>
              Decline
            </Button>
            <ConfirmButton label="Block" ask="Block them" disabled={props.busy} onConfirm={() => void change('Blocking…', () => blockFriend(me, r.id))} />
          </span>
        </div>
      ))}

      {data.friends.length > 0 && <p style={headStyle()}>Friends ({data.friends.length} of 100)</p>}
      {data.friends.map((f) => (
        <div key={f.id} style={rowStyle()}>
          <AirlineChip card={f.card} />
          <AirlineName card={f.card} />
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {mapFeature && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, cursor: 'pointer', marginRight: 2 }}>
                <input type="checkbox" checked={f.onMap} disabled={props.busy} onChange={(e) => void change('Saving…', () => setFriendOnMap(me, f.id, e.target.checked))} style={{ width: 16, height: 16, accentColor: C.brand }} />
                On map
              </label>
            )}
            <ConfirmButton label="Remove" ask="Remove them" disabled={props.busy} onConfirm={() => void change('Removing…', () => removeFriend(me, f.id))} />
            <ConfirmButton label="Block" ask="Block them" disabled={props.busy} onConfirm={() => void change('Blocking…', () => blockFriend(me, f.id))} />
          </span>
        </div>
      ))}
      {data.friends.length === 0 && data.incoming.length === 0 && <p style={{ fontSize: 12.5, color: C.muted, margin: '4px 0 0' }}>No friends yet. Swap codes with someone you know.</p>}
      <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>Blocking stops every airline of that player reaching any of yours.</p>
      {mapFeature && data.friends.length > 20 && <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>The map shows up to 20 friends’ airlines at once, the most recently active first.</p>}

      {data.outgoing.length > 0 && <p style={headStyle()}>Waiting for an answer</p>}
      {data.outgoing.map((r) => (
        <div key={r.id} style={rowStyle()}>
          <span className="num" style={{ flex: '1 1 150px', fontSize: 13.5, fontWeight: 600, letterSpacing: '0.05em' }}>
            {formatFriendCode(r.code)}
          </span>
          <Button size="sm" variant="ghost" disabled={props.busy} onClick={() => void change('Cancelling…', () => removeFriend(me, r.id))}>
            Cancel
          </Button>
        </div>
      ))}

      {data.blocked.length > 0 && (
        <button type="button" onClick={() => setShowBlocked((v) => !v)} style={{ ...headStyle(), border: 0, padding: 0, background: 'none', textAlign: 'left', cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 650 }}>
          Blocked ({data.blocked.length}) {showBlocked ? '▴' : '▾'}
        </button>
      )}
      {showBlocked &&
        data.blocked.map((b) => (
          <div key={b.id} style={rowStyle()}>
            <span style={{ flex: '1 1 150px', minWidth: 0, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.label}</span>
            <Button size="sm" variant="ghost" disabled={props.busy} onClick={() => void change('Unblocking…', () => unblockFriend(b.id))}>
              Unblock
            </Button>
          </div>
        ))}
    </div>
  );
}
