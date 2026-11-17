// ============================================================================
// RECONNECTING (online careers, 2026-11-17)
//   A Career needs the connection. While it's lost the game is paused behind
//   this window, and carries on by itself when the connection is back.
// ============================================================================
import { Button, C, DISPLAY, ModalShell } from '../ui/kit';

export function ReconnectOverlay(props: { reason: 'offline' | 'signed_out'; onSignIn: () => void; onHome: () => void }) {
  const signedOut = props.reason === 'signed_out';
  return (
    <ModalShell maxWidth={420} zIndex={190} closeButton={false} label={signedOut ? 'Signed out' : 'Reconnecting'}>
      <div style={{ textAlign: 'center', padding: '6px 4px' }}>
        {!signedOut && (
          <div
            aria-hidden
            style={{ width: 34, height: 34, margin: '4px auto 14px', borderRadius: '50%', border: `3px solid ${C.border}`, borderTopColor: C.brand, animation: 'bp-spin 0.9s linear infinite' }}
          />
        )}
        <h2 style={{ margin: '0 0 8px', fontFamily: DISPLAY, fontSize: 22 }}>{signedOut ? 'You’re signed out' : 'Reconnecting…'}</h2>
        <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.5, color: C.textSoft }}>
          {signedOut
            ? 'Airlines are played online. Log in again to carry on; the game is paused until then.'
            : 'The connection to Boarding Pass was lost. The game is paused and carries on by itself when it’s back.'}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          {signedOut && (
            <Button variant="primary" onClick={props.onSignIn}>
              Sign in
            </Button>
          )}
          <Button variant="ghost" onClick={props.onHome}>
            Back to the home screen
          </Button>
        </div>
      </div>
      <style>{'@keyframes bp-spin { to { transform: rotate(360deg); } }'}</style>
    </ModalShell>
  );
}
