// ============================================================================
// MAIN MENU (v2.38+): save, export, the tour, and back to the home screen
// ============================================================================
import { useState } from 'react';
import { IS_DEV } from '../game/channel';
import { Icon, type IconName } from '../ui/icons';
import { Button, C, DISPLAY, ModalShell } from '../ui/kit';
import { openAppearance } from './Appearance';
import { CreditsModal } from './Credits';

export function MainMenu(props: {
  airlineName: string;
  version: string;
  onClose: () => void;
  onSave: () => void;
  onExport: () => void;
  onCloud: () => void;
  onTour: () => void;
  onLeave: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [credits, setCredits] = useState(false);
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
    </>
  );
}
