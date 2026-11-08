// ============================================================================
// THE ADMIN SITE (Update A, phase A6)
//   Three locks: Cloudflare Access in front of the site (only listed emails load
//   it); a Boarding Pass account signed in with two-factor; and a row in
//   private.admins, checked by the server on every call. This page re-checks the
//   last two whenever the page changes, and signs out after 30 minutes idle.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, C, DISPLAY, FONT, Segmented, inputStyle } from '../../src/ui/kit';
import { signInState, signInUsername, signInWith, signOut, startEnrol, verifyCode, whoami, type Channel, type Me } from './api';
import { Page, type Route } from './pages';

const IDLE_MS = 30 * 60_000;

const parseRoute = (): Route => {
  const [page = 'dashboard', id = ''] = location.hash.replace(/^#\/?/, '').split('/');
  return { page: (['dashboard', 'reports', 'airlines', 'alliances', 'market', 'logos', 'log', 'team'].includes(page) ? page : 'dashboard') as Route['page'], id };
};
export const go = (page: Route['page'], id = '') => {
  location.hash = `/${page}${id ? `/${id}` : ''}`;
};

type State = { step: 'loading' } | { step: 'signin' } | { step: 'enrol' } | { step: 'code' } | { step: 'refused'; why: string } | { step: 'in'; me: Me };

export function Admin() {
  const [state, setState] = useState<State>({ step: 'loading' });
  const [route, setRoute] = useState<Route>(parseRoute);
  const [channel, setChannel] = useState<Channel>(() => (sessionStorage.getItem('bp_admin_channel') === 'dev' ? 'dev' : 'main'));
  const [note, setNote] = useState('');

  /** Where the sign-in has got to, and whether the server still says this is an admin. */
  const check = useCallback(async () => {
    try {
      const s = await signInState();
      if (s.level === 'none') return setState({ step: 'signin' });
      if (s.level === 'aal1') return setState({ step: s.hasFactor ? 'code' : 'enrol' });
      setState({ step: 'in', me: await whoami() });
    } catch (e) {
      setState({ step: 'refused', why: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  useEffect(() => {
    void check();
  }, [check]);
  // Every page change asks the server again
  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute());
      void check();
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [check]);

  // 30 minutes without a click, key or scroll: signed out
  const last = useRef(Date.now());
  useEffect(() => {
    const touch = () => (last.current = Date.now());
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of evs) window.addEventListener(e, touch, { passive: true });
    const t = window.setInterval(() => {
      if (Date.now() - last.current > IDLE_MS) {
        void signOut().then(() => {
          setNote('Signed out after 30 minutes without use.');
          setState({ step: 'signin' });
        });
        last.current = Date.now();
      }
    }, 20_000);
    return () => {
      for (const e of evs) window.removeEventListener(e, touch);
      window.clearInterval(t);
    };
  }, []);

  const out = async () => {
    await signOut();
    setNote('');
    setState({ step: 'signin' });
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: FONT }}>
      {state.step === 'in' ? (
        <>
          <header style={{ position: 'sticky', top: 0, zIndex: 10, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '10px 18px', background: C.panel, borderBottom: `1px solid ${C.line}` }}>
            <b style={{ fontFamily: DISPLAY, fontSize: 20, letterSpacing: '0.01em' }}>Boarding Pass admin</b>
            <nav style={{ display: 'flex', gap: 2, flexWrap: 'wrap', flex: '1 1 400px' }}>
              {(
                [
                  ['dashboard', 'Dashboard'],
                  ['reports', 'Reports'],
                  ['logos', 'Logos'],
                  ['airlines', 'Airlines'],
                  ['alliances', 'Alliances'],
                  ['market', 'Marketplace'],
                  ['log', 'Admin log'],
                  ['team', 'Team'],
                ] as const
              ).map(([p, label]) => (
                <a key={p} href={`#/${p}`} style={{ padding: '6px 10px', borderRadius: 8, fontSize: 13.5, fontWeight: 650, textDecoration: 'none', color: route.page === p ? C.brandInk : C.textSoft, background: route.page === p ? C.brand : 'transparent' }}>
                  {label}
                </a>
              ))}
            </nav>
            <Segmented<Channel>
              value={channel}
              onChange={(c) => {
                sessionStorage.setItem('bp_admin_channel', c);
                setChannel(c);
              }}
              options={[
                { value: 'main', label: 'Live game' },
                { value: 'dev', label: 'Test builds' },
              ]}
            />
            <span style={{ fontSize: 12.5, color: C.muted }}>
              {state.me.name} · <b style={{ color: state.me.role === 'owner' ? C.brand : C.textSoft }}>{state.me.role === 'owner' ? 'Owner' : 'Moderator'}</b>
            </span>
            <Button size="sm" variant="ghost" onClick={() => void out()}>
              Sign out
            </Button>
          </header>
          <main style={{ maxWidth: 1180, margin: '0 auto', padding: '20px 18px 60px' }}>
            <Page key={`${route.page}/${route.id}/${channel}`} route={route} channel={channel} me={state.me} />
          </main>
        </>
      ) : (
        <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 18 }}>
          <div style={{ width: 'min(400px, 100%)', padding: 24, borderRadius: 16, background: C.panel, border: `1px solid ${C.line}` }}>
            <h1 style={{ fontFamily: DISPLAY, fontSize: 26, margin: '0 0 4px' }}>Boarding Pass admin</h1>
            <p style={{ fontSize: 13, color: C.muted, margin: '0 0 16px', lineHeight: 1.45 }}>For moderators only. Everything you do here is logged.</p>
            {note && <p style={{ fontSize: 13, margin: '0 0 12px', color: C.amber }}>{note}</p>}
            {state.step === 'loading' && <p style={{ color: C.muted }}>Checking…</p>}
            {state.step === 'signin' && <SignIn onDone={() => void check()} />}
            {state.step === 'enrol' && <Enrol onDone={() => void check()} onOut={() => void out()} />}
            {state.step === 'code' && <Code onDone={() => void check()} onOut={() => void out()} />}
            {state.step === 'refused' && (
              <div style={{ display: 'grid', gap: 12 }}>
                <p style={{ fontSize: 14, margin: 0, color: C.red }}>{state.why}</p>
                <p style={{ fontSize: 12.5, margin: 0, color: C.muted, lineHeight: 1.45 }}>Only accounts the owner has added can use this site.</p>
                <Button onClick={() => void out()}>Sign out</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function useBusy() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<unknown>, after: () => void) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      after();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function SignIn(props: { onDone: () => void }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const { busy, error, run } = useBusy();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => signInUsername(u, p), props.onDone);
      }}
      style={{ display: 'grid', gap: 10 }}
    >
      <label style={{ display: 'grid', gap: 4, fontSize: 12, color: C.muted }}>
        Username
        <input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" style={inputStyle} />
      </label>
      <label style={{ display: 'grid', gap: 4, fontSize: 12, color: C.muted }}>
        Password
        <input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" style={inputStyle} />
      </label>
      {error && <p style={{ fontSize: 13, margin: 0, color: C.red }}>{error}</p>}
      <Button variant="primary" type="submit" disabled={busy || !u || !p}>
        Sign in
      </Button>
      <div style={{ display: 'flex', gap: 6 }}>
        <Button type="button" size="sm" style={{ flex: 1 }} disabled={busy} onClick={() => void run(() => signInWith('google'), () => undefined)}>
          Google
        </Button>
        <Button type="button" size="sm" style={{ flex: 1 }} disabled={busy} onClick={() => void run(() => signInWith('discord'), () => undefined)}>
          Discord
        </Button>
      </div>
      <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>Your Boarding Pass account. Two-factor comes next.</p>
    </form>
  );
}

function Enrol(props: { onDone: () => void; onOut: () => void }) {
  const [f, setF] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const { busy, error, run } = useBusy();
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p style={{ fontSize: 14, margin: 0, fontWeight: 650 }}>Turn on two-factor</p>
      <p style={{ fontSize: 13, margin: 0, color: C.muted, lineHeight: 1.45 }}>Admins need an authenticator app (Google Authenticator, 1Password, Authy…). It’s asked for every time you sign in here.</p>
      {!f ? (
        <Button variant="primary" disabled={busy} onClick={() => void run(async () => setF(await startEnrol()), () => undefined)}>
          Set up an authenticator app
        </Button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => verifyCode(code, f.id), props.onDone);
          }}
          style={{ display: 'grid', gap: 10 }}
        >
          <img src={f.qr} alt="QR code for your authenticator app" style={{ width: 200, height: 200, justifySelf: 'center', background: '#fff', borderRadius: 10, padding: 8 }} />
          <p style={{ fontSize: 12, margin: 0, color: C.muted, overflowWrap: 'anywhere' }}>
            Can’t scan it? Enter this key: <span className="num" style={{ color: C.text, letterSpacing: '0.05em' }}>{f.secret}</span>
          </p>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: C.muted }}>
            The 6-digit code it shows
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} style={{ ...inputStyle, letterSpacing: '0.2em', fontSize: 18 }} />
          </label>
          <Button variant="primary" type="submit" disabled={busy || code.replace(/\s/g, '').length < 6}>
            Turn it on
          </Button>
        </form>
      )}
      {error && <p style={{ fontSize: 13, margin: 0, color: C.red }}>{error}</p>}
      <Button variant="ghost" size="sm" onClick={props.onOut}>
        Sign out
      </Button>
    </div>
  );
}

function Code(props: { onDone: () => void; onOut: () => void }) {
  const [code, setCode] = useState('');
  const { busy, error, run } = useBusy();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => verifyCode(code), props.onDone);
      }}
      style={{ display: 'grid', gap: 10 }}
    >
      <label style={{ display: 'grid', gap: 4, fontSize: 12, color: C.muted }}>
        Code from your authenticator app
        <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} autoFocus style={{ ...inputStyle, letterSpacing: '0.2em', fontSize: 18 }} />
      </label>
      {error && <p style={{ fontSize: 13, margin: 0, color: C.red }}>{error}</p>}
      <Button variant="primary" type="submit" disabled={busy || code.replace(/\s/g, '').length < 6}>
        Continue
      </Button>
      <Button variant="ghost" size="sm" type="button" onClick={props.onOut}>
        Sign out
      </Button>
    </form>
  );
}
