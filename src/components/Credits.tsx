// ============================================================================
// CREDITS & LICENCES
//   Who made the maps, data and software the game is built on, under which
//   licence, and what the game is not (affiliated with any airline). Opened
//   from the home screen and from the Map layers menu.
// ============================================================================
import type React from 'react';
import { APP_VERSION } from '../version';
import { Button, C, ModalShell } from '../ui/kit';

const link = (href: string, text?: string) => (
  <a href={href} target="_blank" rel="noreferrer" style={{ color: C.accent }}>
    {text ?? href.replace(/^https?:\/\//, '')}
  </a>
);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 18 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 13.5, fontWeight: 650, color: C.text }}>{title}</h3>
      <div style={{ display: 'grid', gap: 9 }}>{children}</div>
    </section>
  );
}

function Item({ name, children }: { name: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.textDim }}>
      <span style={{ color: C.text, fontWeight: 600 }}>{name}</span> {children}
    </div>
  );
}

export function CreditsModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalShell onClose={onClose} maxWidth={640} zIndex={400}>
      <div role="dialog" aria-label="Credits and licences" style={{ padding: '22px 24px', maxHeight: 'calc(100dvh - 80px)', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text }}>Boarding Pass</h2>
          <span style={{ fontSize: 12.5, color: C.muted }}>version {APP_VERSION}</span>
        </div>
        <div style={{ fontSize: 12.5, color: C.textDim, marginTop: 6, lineHeight: 1.5 }}>
          A small airline manager game. © 2026 Ermek Baker-Niffka. The game's own code is free software under the MIT licence. The maps and data below
          belong to their makers and are used under their own licences.
        </div>

        <Section title="Maps">
          <Item name="Dark and light maps:">
            © {link('https://carto.com/attributions', 'CARTO')} basemaps. Map data © {link('https://www.openstreetmap.org/copyright', 'OpenStreetMap contributors')}, under the
            Open Database Licence.
          </Item>
          <Item name="Satellite imagery:">
            EOxCloudless {link('https://cloudless.eox.at')} by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2024), under CC BY-NC-SA 4.0. Used for
            non-commercial purposes only. Place names and borders on it: © CARTO, © OpenStreetMap contributors.
          </Item>
          <Item name="Map engine:">{link('https://maplibre.org', 'MapLibre GL JS')}, © MapLibre contributors, under the BSD 3-Clause licence.</Item>
        </Section>

        <Section title="Data">
          <Item name="Airports, runways and navaids:">{link('https://ourairports.com/data/', 'OurAirports')}, public domain.</Item>
          <Item name="Other airlines' routes, airports and aircraft types:">
            {link('https://openflights.org/data', 'OpenFlights')}, under the Open Database Licence (ODbL 1.0) and Database Contents Licence. The other airlines'
            schedules in the game are worked out from these routes; they are a derived database made available under the same ODbL.
          </Item>
        </Section>

        <Section title="Software">
          <Item name="React">© Meta Platforms, Inc. and affiliates, under the MIT licence.</Item>
          <Item name="Tauri">© Tauri Programme within The Commons Conservancy, under the MIT and Apache 2.0 licences.</Item>
          <Item name="Barlow and Barlow Condensed">Typefaces by Jeremy Tribby, © 2017 The Barlow Project Authors, under the SIL Open Font License 1.1 ({link('https://github.com/jpt/barlow')}).</Item>
          <div style={{ fontSize: 12, color: C.muted }}>Full licence texts are in THIRD_PARTY_NOTICES.md, which comes with the game.</div>
        </Section>

        <Section title="Not affiliated">
          <div style={{ fontSize: 12.5, lineHeight: 1.55, color: C.textDim }}>
            Boarding Pass is a game. It is not affiliated with, endorsed or sponsored by any airline, aircraft maker or airport. Airline, aircraft and airport names
            are used only to identify them and belong to their owners. Schedules, passengers, weather and flight paths are simulated: not for navigation or real
            flight planning.
          </div>
        </Section>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
