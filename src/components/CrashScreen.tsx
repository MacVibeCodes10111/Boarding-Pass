import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches a crash while drawing the game, so the player gets a way back instead
 * of a blank window. Plain styles on purpose: it can't rely on anything that may
 * have just failed. Careers autosave every minute, so little is ever lost.
 */
export class CrashScreen extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Boarding Pass crashed:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, boxSizing: 'border-box', background: '#0c1320', color: '#e8edf5', fontFamily: 'system-ui, sans-serif' }}>
        <div role="alert" style={{ maxWidth: 440, width: '100%' }}>
          <h1 style={{ margin: '0 0 10px', fontSize: 22, fontWeight: 650 }}>Something went wrong</h1>
          <p style={{ margin: '0 0 18px', fontSize: 15, lineHeight: 1.5, color: '#b6c0d0' }}>The game hit a problem it couldn’t recover from. Careers autosave every minute, so restarting should lose a minute of play at most.</p>
          <button
            type="button"
            onClick={() => location.reload()}
            style={{ padding: '10px 18px', fontSize: 15, fontWeight: 600, border: 0, borderRadius: 8, background: '#f5a623', color: '#0c1320', cursor: 'pointer' }}
          >
            Restart the game
          </button>
          <p style={{ margin: '20px 0 0', fontSize: 12, lineHeight: 1.45, color: '#8592a6', overflowWrap: 'anywhere' }}>If this keeps happening, please report this message: {error.message || String(error)}</p>
        </div>
      </div>
    );
  }
}
