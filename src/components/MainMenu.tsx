// ============================================================================
// MAIN MENU (v2.38+): save, export, the tour, and back to the home screen
// ============================================================================
import { useState } from 'react';
import { IS_DEV } from '../game/channel';
import { Icon, type IconName } from '../ui/icons';
import { Button, C, DISPLAY, Field, ModalShell, inputStyle } from '../ui/kit';
import { openAppearance } from './Appearance';
import { CreditsModal } from './Credits';

export function MainMenu(props: {
  airlineName: string;
  version: string;
  onClose: () => void;
  onSave: () => void;
  onExport: () => void;
  onCloud: () => void;
  airlineCallsign: string;
  /** Change the airline's name and radio callsign; returns an error message. */
  onAirlineDetails: (name: string, callsign: string) => string | null;
  onTour: () => void;
  onLeave: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [credits, setCredits] = useState(false);
  const [details, setDetails] = useState(false);
  const row = (icon: IconName, label: string, hint: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="bp-row"
      style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '11px 12px', borderRadius: 10, background: C.raised, border: `1px solid ${C.line}`, color: C.text, cursor: 'pointer', textAlign: 'left' }}
    >
      <Icon name={icon} size={20} color={C.brand} />
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 14.5 }}>{label}</span>
        <span style={{ fontSize: 12, color: C.muted }}>{hint}</span>
      </span>
    </button>
  );
  return (
    <>
      <ModalShell onClose={props.onClose} maxWidth={420} closeButton={false}>
        <div style={{ padding: '18px 18px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
            <span style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 700 }}>Menu</span>
            <span style={{ fontSize: 13, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{props.airlineName}</span>
            <button
              type="button"
              aria-label="Back to the game"
              title="Back to the game"
              onClick={props.onClose}
              style={{ width: 36, height: 36, flex: 'none', borderRadius: 10, display: 'grid', placeItems: 'center', background: C.raised, border: `1px solid ${C.border}`, color: C.textSoft, cursor: 'pointer', boxShadow: '0 2px 0 rgba(0,0,0,.25)' }}
            >
              <Icon name="close" size={15} />
            </button>
          </div>
          <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 14 }}>Your career saves itself every minute, and money keeps coming in while you're away.</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {row('save', saved ? 'Saved' : 'Save now', saved ? 'Your career is saved on this device.' : 'Save this career on this device', () => {
              props.onSave();
              setSaved(true);
            })}
            {row('download', 'Export save file', 'A protected copy to keep or move to another computer', props.onExport)}
            {row('swap', 'Cloud saves', 'Sign in to play your careers on all your devices', props.onCloud)}
            {row('edit', 'Airline name and callsign', `${props.airlineName}, callsign ${props.airlineCallsign}`, () => setDetails(true))}
            {row('help', 'Welcome tour', 'How to play, in a minute', () => {
              props.onClose();
              props.onTour();
            })}
            {row('layers', 'Appearance', 'Theme and colours', () => {
              props.onClose();
              openAppearance();
            })}
            {row('letter', 'Credits and licences', 'Maps, data and software the game is built on', () => setCredits(true))}
          </div>
          <div style={{ height: 1, background: C.line, margin: '16px 0 14px' }} />
          <div style={{ display: 'grid', gap: 8 }}>
            <Button size="lg" block onClick={props.onClose}>
              <Icon name="map" size={18} />
              Back to the game
            </Button>
            <Button variant="primary" size="lg" block onClick={props.onLeave}>
              <Icon name="exit" size={18} />
              Save and leave to home screen
            </Button>
          </div>
          <div className="num" style={{ fontSize: 11.5, color: C.faint, textAlign: 'center', marginTop: 10 }}>
            Boarding Pass {props.version}
            {IS_DEV ? ' dev' : ''}
          </div>
        </div>
      </ModalShell>
      {credits && <CreditsModal onClose={() => setCredits(false)} />}
      {details && <AirlineDetailsModal name={props.airlineName} callsign={props.airlineCallsign} onSave={props.onAirlineDetails} onClose={() => setDetails(false)} />}
    </>
  );
}

/** Rename the airline or change its radio callsign (v2.52). The code stays: flight numbers use it. */
function AirlineDetailsModal(props: { name: string; callsign: string; onSave: (name: string, callsign: string) => string | null; onClose: () => void }) {
  const [name, setName] = useState(props.name);
  const [callsign, setCallsign] = useState(props.callsign);
  const [err, setErr] = useState<string | null>(null);
  const save = () => {
    const e = props.onSave(name, callsign);
    setErr(e);
    if (!e) props.onClose();
  };
  return (
    <ModalShell onClose={props.onClose} maxWidth={420} zIndex={260} label="Airline name and callsign">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        style={{ display: 'grid', gap: 12 }}
      >
        <h2 style={{ margin: 0, fontFamily: DISPLAY, fontSize: 24 }}>Airline name and callsign</h2>
        <Field label="Airline name">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} style={inputStyle} />
        </Field>
        <Field label="Radio callsign" hint="What controllers call your flights on the map, like SPEEDBIRD or JETSTREAM. Letters, digits and spaces.">
          <input value={callsign} onChange={(e) => setCallsign(e.target.value.toUpperCase())} maxLength={20} autoCapitalize="characters" spellCheck={false} style={inputStyle} />
        </Field>
        <div role="alert" style={{ minHeight: 16, fontSize: 12.5, color: C.red }}>
          {err}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={props.onClose}>Cancel</Button>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
