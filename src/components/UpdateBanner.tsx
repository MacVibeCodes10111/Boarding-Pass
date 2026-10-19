// ============================================================================
// UPDATE BANNER
//   In the downloaded game, checks GitHub for a newer release a few seconds
//   after start-up and every 6 hours. When there is one, offers it in a small
//   card; "Update now" saves the career, downloads and installs the update
//   (checked against the game's public key) and restarts. Does nothing in a
//   web browser or when the check fails (offline, GitHub down).
//   The Rust side is check_for_update / install_update in src-tauri/src/lib.rs.
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import { Button, C } from '../ui/kit';

const FIRST_CHECK_MS = 4000;
const RECHECK_MS = 6 * 60 * 60 * 1000;
const RELEASES_URL = 'https://github.com/MacVibeCodes10111/Boarding-Pass/releases/latest';

/** True inside the desktop app, false in a web browser. */
export const inDesktopApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

type State =
  | { kind: 'idle' }
  | { kind: 'available'; version: string }
  | { kind: 'installing'; version: string; done: number; total: number }
  | { kind: 'failed'; version: string; error: string };

const mb = (bytes: number) => (bytes / 1048576).toFixed(1);

// Kept outside the component, which remounts when the screen changes, so a
// "Later" lasts until the game is restarted.
let dismissedVersion: string | null = null;

export function UpdateBanner({ onBeforeInstall }: { onBeforeInstall: () => void }) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const busy = useRef(false);

  useEffect(() => {
    if (!inDesktopApp()) return;
    let cancelled = false;
    const check = async () => {
      if (busy.current) return;
      try {
        const found = await invoke<[string, string] | null>('check_for_update');
        if (cancelled || !found || busy.current) return;
        const [version] = found;
        if (dismissedVersion === version) return;
        setState({ kind: 'available', version });
      } catch {
        // Offline or GitHub unreachable: try again at the next check.
      }
    };
    const first = window.setTimeout(check, FIRST_CHECK_MS);
    const again = window.setInterval(check, RECHECK_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(again);
    };
  }, []);

  if (state.kind === 'idle') return null;

  const install = async (version: string) => {
    busy.current = true;
    try {
      onBeforeInstall();
    } catch {
      /* the autosave every minute still has the career */
    }
    setState({ kind: 'installing', version, done: 0, total: 0 });
    const onProgress = new Channel<[number, number]>();
    onProgress.onmessage = ([done, total]) => setState({ kind: 'installing', version, done, total });
    try {
      // Look the update up again (it may be a retry, or a newer one may be out),
      // then install it. On success the game restarts; on Windows the installer
      // closes it first.
      const found = await invoke<[string, string] | null>('check_for_update');
      if (!found) throw new Error('GitHub no longer lists a newer version');
      await invoke('install_update', { onProgress });
    } catch (e) {
      busy.current = false;
      const error = (e instanceof Error ? e.message : String(e)).replace(/[.\s]+$/, '');
      setState({ kind: 'failed', version, error });
    }
  };

  const later = (version: string) => {
    dismissedVersion = version;
    setState({ kind: 'idle' });
  };

  const pct = state.kind === 'installing' && state.total > 0 ? Math.min(100, (state.done / state.total) * 100) : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bp-update"
      style={{
        position: 'fixed',
        left: 18,
        bottom: 18,
        width: 330,
        zIndex: 260,
        background: C.raised,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        boxShadow: '0 14px 36px rgba(0,0,0,0.55)',
        padding: '14px 16px',
        color: C.text,
        fontSize: 13,
      }}
    >
      {state.kind === 'available' && (
        <>
          <div style={{ fontWeight: 650, fontSize: 14 }}>Boarding Pass {state.version} is ready</div>
          <div style={{ color: C.textDim, marginTop: 4, lineHeight: 1.45 }}>
            The game saves your career, installs the update and restarts. It takes about a minute.{' '}
            <a href={RELEASES_URL} target="_blank" rel="noreferrer" style={{ color: C.accent }}>
              What's new
            </a>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
            <Button onClick={() => later(state.version)}>Later</Button>
            <Button variant="primary" onClick={() => install(state.version)}>
              Update now
            </Button>
          </div>
        </>
      )}

      {state.kind === 'installing' && (
        <>
          <div style={{ fontWeight: 650, fontSize: 14 }}>Updating to {state.version}…</div>
          <div style={{ height: 6, background: C.line, borderRadius: 3, marginTop: 10, overflow: 'hidden' }}>
            <div
              className="bp-update-bar"
              style={{
                height: '100%',
                width: pct === null ? '35%' : `${pct}%`,
                background: C.brand,
                borderRadius: 3,
                transition: 'width 200ms linear',
              }}
            />
          </div>
          <div style={{ color: C.muted, marginTop: 7, fontSize: 12 }}>
            {state.total > 0
              ? `${mb(state.done)} of ${mb(state.total)} MB`
              : state.done > 0
                ? `${mb(state.done)} MB downloaded`
                : 'Starting the download'}
            {pct !== null && pct >= 100 ? '. Installing, the game will restart.' : ''}
          </div>
        </>
      )}

      {state.kind === 'failed' && (
        <>
          <div style={{ fontWeight: 650, fontSize: 14 }}>The update didn't install</div>
          <div style={{ color: C.textDim, marginTop: 4, lineHeight: 1.45, wordBreak: 'break-word' }}>
            {state.error}. Your career is saved. Try again, or download {state.version} from the{' '}
            <a href={RELEASES_URL} target="_blank" rel="noreferrer" style={{ color: C.accent }}>
              Releases page
            </a>
            .
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
            <Button onClick={() => later(state.version)}>Close</Button>
            <Button variant="primary" onClick={() => install(state.version)}>
              Try again
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
