import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { HomeScreen } from './HomeScreen';

describe('home screen (smoke)', () => {
  it('renders signed out with a sandbox and a career on the device', () => {
    const sv = (id: string, mode: 'standard' | 'sandbox') => ({ saveId: id, airlineName: `Air ${id}`, airlineIata: 'AA', gameMode: mode, cash: 1e6, fleet: [], hubs: ['ORD'], hubIata: 'ORD' }) as never;
    const html = renderToString(
      <HomeScreen
        airlineName="Test" airlineIata="TS" airlineCallsign="TEST" hubIata="ORD" gameMode="standard"
        onChange={() => undefined} airports={[]} airportByIata={new Map()} savedGames={[sv('SAVE-1', 'standard'), sv('SAVE-2', 'sandbox')]}
        onLaunch={() => undefined} onResume={() => undefined} onDeleteSave={() => undefined} onImportFile={() => undefined}
        onAccount={() => undefined} onPlayCloud={async () => undefined} toast={() => undefined}
      />
    );
    expect(html).toContain('Log in');
    expect(html).toContain('Career');
    expect(html).toContain('Sandbox');
    expect(html).toContain('Your airlines live in your account');
  });
});
