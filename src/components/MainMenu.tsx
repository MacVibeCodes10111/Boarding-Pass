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
import { Button, C, DISPLAY, Field, ModalShell, inputStyle } from '../ui/kit';
import { openAppearance } from './Appearance';
import { CreditsModal } from './Credits';

export function MainMenu(props: {
  airlineName: string;
  version: string;
  onClose: () => void;
  onSave: () => void;
  onCloud: () => void;
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
            {row('swap', 'Cloud saves', 'Sign in to play your careers on all your devices', props.onCloud)}
            {row('edit', 'Airline name, colours and logo', `${props.airlineName}, callsign ${props.airlineCallsign}`, () => setDetails(true))}
            {row('layers', 'Livery', props.hasLivery ? 'Your airline\'s colours on its aircraft' : 'Paint your aircraft in your airline\'s colours', () => {
              props.onClose();
              props.onOpenLivery();
            })}
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
        <h2 style={{ margin: 0, fontFamily: DISPLAY, fontSize: 24 }}>Airline details</h2>
        <Field label="Airline name">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} style={inputStyle} />
        </Field>
        <Field label="Radio callsign" hint="What controllers call your flights on the map, like SPEEDBIRD or JETSTREAM. Letters, digits and spaces.">
          <input value={callsign} onChange={(e) => setCallsign(e.target.value.toUpperCase())} maxLength={20} autoCapitalize="characters" spellCheck={false} style={inputStyle} />
        </Field>
        <div style={{ display: 'grid', gap: 10, padding: 12, borderRadius: 10, border: `1px solid ${C.line}` }}>
          <div style={{ fontSize: 13, fontWeight: 650 }}>Airline colours</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: -6 }}>Used by the ready-made liveries and logos.</div>
          <ColourPicker label="Main colour" value={colours.a} onChange={(a) => setColours((c) => ({ ...c, a }))} />
          <ColourPicker label="Second colour" value={colours.b} onChange={(b) => setColours((c) => ({ ...c, b }))} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={Boolean(colours.theme)} onChange={(e) => setColours((c) => ({ ...c, theme: e.target.checked || undefined }))} />
            Use them for the game’s look while I play this airline
          </label>
        </div>
        <div style={{ display: 'grid', gap: 10, padding: 12, borderRadius: 10, border: `1px solid ${C.line}` }}>
          <div style={{ fontSize: 13, fontWeight: 650 }}>Airline logo</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: -6 }}>Shown in the corner and beside your flights, and ready to put on your aircraft in the livery editor.</div>
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
          <div style={{ fontSize: 11.5, color: C.muted }}>PNG, JPG or WebP, kept at its own size up to 1024×1024 and 48 KB. Only upload pictures you own or have the right to use.</div>
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
