// ============================================================================
// MAIN MENU (v2.38+): save, export, the tour, and back to the home screen
// ============================================================================
import type { AirlineColours } from '../game/livery';
import { ColourPicker } from './livery/ColourPicker';
import { LOGO_TYPES, makeLogo } from './livery/logoUpload';
import { PRESET_LOGOS, presetLogo } from './livery/presetLogos';
import { useMemo, useRef, useState } from 'react';
import { IS_DEV } from '../game/channel';
import { Icon, type IconName } from '../ui/icons';
import { Button, C, DISPLAY, Field, ModalShell, SectionTitle, inputStyle } from '../ui/kit';
import { openAppearance } from './Appearance';
import { CreditsModal } from './Credits';

export function MainMenu(props: {
  airlineName: string;
  version: string;
  onClose: () => void;
  onSave: () => void;
  /** Opens the account (sign in, the player's airlines). */
  onAccount: () => void;
  airlineCallsign: string;
  /** Change the airline's name and radio callsign; returns an error message. */
  onAirlineDetails: (name: string, callsign: string) => string | null;
  onTour: () => void;
  onLeave: () => void;
  /** True when the airline has a livery. */
  hasLivery: boolean;
  airlineColours: AirlineColours;
  onAirlineColours: (c: AirlineColours) => void;
  airlineLogo?: string;
  onAirlineLogo: (l: string | undefined) => void;
  /** Opens the livery editor. */
  onOpenLivery: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [credits, setCredits] = useState(false);
  const [details, setDetails] = useState(false);
  const row = (icon: IconName, label: string, onClick: () => void, done = false) => (
    <button
      type="button"
      onClick={onClick}
      className="bp-row"
      style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '11px 10px', background: 'transparent', border: 'none', color: C.text, cursor: 'pointer', textAlign: 'left', fontSize: 15, fontWeight: 550 }}
    >
      <Icon name={done ? 'check' : icon} size={19} color={done ? C.green : C.muted} />
      <span style={{ flex: 1 }}>{label}</span>
    </button>
  );
  const away = (fn: () => void) => () => {
    props.onClose();
    fn();
  };
  return (
    <>
      <ModalShell onClose={props.onClose} maxWidth={360} label="Menu">
        <h2 style={{ margin: '0 36px 10px 10px', fontFamily: DISPLAY, fontSize: 24, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props.airlineName}</h2>
        {row('save', saved ? 'Saved' : 'Save', () => {
          props.onSave();
          setSaved(true);
        }, saved)}
        {row('globe', 'Account', props.onAccount)}
        <div style={{ height: 1, background: C.line, margin: '6px 10px' }} />
        {row('edit', 'Name, colours and logo', () => setDetails(true))}
        {row('fleet', 'Livery', away(props.onOpenLivery))}
        {row('layers', 'Appearance', away(openAppearance))}
        <div style={{ height: 1, background: C.line, margin: '6px 10px' }} />
        {row('help', 'How to play', away(props.onTour))}
        {row('letter', 'Credits', () => setCredits(true))}
        <Button size="lg" block onClick={props.onLeave} style={{ marginTop: 12 }}>
          <Icon name="exit" size={18} />
          Save and exit
        </Button>
        <div className="num" style={{ fontSize: 11.5, color: C.faint, textAlign: 'center', marginTop: 12 }}>
          {props.version}
          {IS_DEV ? ' dev' : ''}
        </div>
      </ModalShell>
      {credits && <CreditsModal onClose={() => setCredits(false)} />}
      {details && <AirlineDetailsModal name={props.airlineName} callsign={props.airlineCallsign} colours={props.airlineColours} logo={props.airlineLogo} onSave={props.onAirlineDetails} onColours={props.onAirlineColours} onLogo={props.onAirlineLogo} onClose={() => setDetails(false)} />}
    </>
  );
}


/** Rename the airline or change its radio callsign (v2.52). The code stays: flight numbers use it. */
function AirlineDetailsModal(props: {
  name: string;
  callsign: string;
  colours: AirlineColours;
  logo?: string;
  onSave: (name: string, callsign: string) => string | null;
  onColours: (c: AirlineColours) => void;
  onLogo: (l: string | undefined) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(props.name);
  const [callsign, setCallsign] = useState(props.callsign);
  const [colours, setColours] = useState(props.colours);
  const [logo, setLogo] = useState(props.logo);
  /** The ready-made logo picked, drawn big for keeping (its button shows a small one). */
  const [picked, setPicked] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const save = () => {
    const e = props.onSave(name, callsign);
    setErr(e);
    if (!e) {
      props.onColours(colours);
      props.onLogo(logo);
      props.onClose();
    }
  };
  const presets = useMemo(() => PRESET_LOGOS.map((p) => ({ ...p, url: presetLogo(p.id, colours.a, colours.b, name) })), [colours.a, colours.b, name]);
  return (
    <ModalShell onClose={props.onClose} maxWidth={420} zIndex={260} label="Airline details">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        style={{ display: 'grid', gap: 12 }}
      >
        <h2 style={{ margin: 0, fontFamily: DISPLAY, fontSize: 24 }}>Airline</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 10 }}>
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} style={inputStyle} />
          </Field>
          <Field label="Callsign">
            <input value={callsign} onChange={(e) => setCallsign(e.target.value.toUpperCase())} maxLength={20} autoCapitalize="characters" spellCheck={false} style={inputStyle} />
          </Field>
        </div>
        <div style={{ display: 'grid', gap: 10, marginTop: 6 }}>
          <SectionTitle>Colours</SectionTitle>
          <ColourPicker label="Main colour" value={colours.a} onChange={(a) => setColours((c) => ({ ...c, a }))} />
          <ColourPicker label="Second colour" value={colours.b} onChange={(b) => setColours((c) => ({ ...c, b }))} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={Boolean(colours.theme)} onChange={(e) => setColours((c) => ({ ...c, theme: e.target.checked || undefined }))} />
            Use as the game’s theme
          </label>
        </div>
        <div style={{ display: 'grid', gap: 10, marginTop: 6 }}>
          <SectionTitle>Logo</SectionTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 56, height: 56, borderRadius: 12, background: '#fff', display: 'grid', placeItems: 'center', flex: 'none', border: `1px solid ${C.line}` }}>
              {logo ? <img src={logo} alt="Your airline logo" style={{ width: 48, height: 48, objectFit: 'contain' }} /> : <span style={{ fontSize: 11, color: '#667' }}>None</span>}
            </span>
            <Button size="sm" onClick={() => fileRef.current?.click()}>
              Upload
            </Button>
            {logo && (
              <Button size="sm" variant="ghost" onClick={() => { setLogo(undefined); setPicked(null); }}>
                Remove
              </Button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept={LOGO_TYPES}
              style={{ display: 'none' }}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                const r = await makeLogo(f, { fit: 'contain', removeWhite: false });
                if ('error' in r) setErr(r.error);
                else {
                  setErr(null);
                  setPicked(null);
                  setLogo(r.url);
                }
              }}
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {presets.map((p) =>
              p.url ? (
                <button key={p.id} type="button" aria-label={`Use the ${p.label} logo`} title={p.label} onClick={() => {
                    setPicked(p.id);
                    setLogo(presetLogo(p.id, colours.a, colours.b, name, true) ?? p.url!);
                  }} style={{ width: 40, height: 40, borderRadius: 8, border: `1px solid ${picked === p.id && logo ? C.brand : C.line}`, background: C.bg, padding: 3, cursor: 'pointer' }}>
                  <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </button>
              ) : null
            )}
          </div>
          <div style={{ fontSize: 11.5, color: C.faint }}>Only upload pictures you own or have the right to use.</div>
        </div>
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
