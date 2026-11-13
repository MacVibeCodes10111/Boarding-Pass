// ============================================================================
// SUBSIDIARIES (2026-11): set up a regional and a cargo brand, rename them,
// paint them, or close them. Aircraft join them from the fleet.
// ============================================================================
import { useState } from 'react';
import { BRAND_KINDS, BRAND_RULE, checkBrandNames, suggestedBrandCallsign, suggestedBrandName } from '../game/subsidiaries';
import type { BrandKind, PlayerAircraft, Subsidiary } from '../game/types';
import { Button, C, DISPLAY, Field, ModalShell, inputStyle, well } from '../ui/kit';

const TITLE: Record<BrandKind, string> = { regional: 'Regional brand', cargo: 'Cargo brand' };
const LIKE: Record<BrandKind, string> = { regional: 'Like American Eagle or Delta Connection.', cargo: 'Like Delta Cargo or Lufthansa Cargo.' };

export function SubsidiariesModal(props: {
  airlineName: string;
  airlineCallsign: string;
  subsidiaries: Subsidiary[];
  fleet: PlayerAircraft[];
  onSave: (kind: BrandKind, next: { name: string; callsign: string } | null) => void;
  onEditLivery: (kind: BrandKind) => void;
  onClose: () => void;
}) {
  return (
    <ModalShell onClose={props.onClose} maxWidth={480} zIndex={260} label="Subsidiaries">
      <h2 style={{ margin: '0 36px 4px 0', fontFamily: DISPLAY, fontSize: 24 }}>Subsidiaries</h2>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: C.textDim, lineHeight: 1.45 }}>
        Brands that fly part of your fleet under their own name, callsign and livery. They share {props.airlineName}’s money, bank and flight numbers.
      </p>
      <div style={{ display: 'grid', gap: 12 }}>
        {BRAND_KINDS.map((kind) => (
          <BrandCard key={kind} kind={kind} {...props} sub={props.subsidiaries.find((s) => s.kind === kind)} aircraft={props.fleet.filter((a) => a.brand === kind).length} />
        ))}
      </div>
      <div style={{ fontSize: 12, color: C.faint, marginTop: 12 }}>Move aircraft into a brand from Fleet: select them, or open one with Manage.</div>
    </ModalShell>
  );
}

function BrandCard(props: {
  kind: BrandKind;
  sub?: Subsidiary;
  aircraft: number;
  airlineName: string;
  airlineCallsign: string;
  onSave: (kind: BrandKind, next: { name: string; callsign: string } | null) => void;
  onEditLivery: (kind: BrandKind) => void;
}) {
  const { kind, sub } = props;
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [name, setName] = useState(sub?.name ?? suggestedBrandName(kind, props.airlineName));
  const [callsign, setCallsign] = useState(sub?.callsign ?? suggestedBrandCallsign(kind, props.airlineCallsign));
  const [err, setErr] = useState<string | null>(null);
  const open = () => {
    setName(sub?.name ?? suggestedBrandName(kind, props.airlineName));
    setCallsign(sub?.callsign ?? suggestedBrandCallsign(kind, props.airlineCallsign));
    setErr(null);
    setClosing(false);
    setEditing(true);
  };
  const save = () => {
    const r = checkBrandNames(name, callsign);
    if ('error' in r) return setErr(r.error);
    props.onSave(kind, r);
    setEditing(false);
  };

  return (
    <section aria-label={TITLE[kind]} style={{ borderRadius: 14, background: well(), padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.muted }}>{TITLE[kind]}</span>
        {sub && (
          <span className="num" style={{ fontSize: 12, color: C.faint }}>
            {props.aircraft === 1 ? '1 aircraft' : `${props.aircraft} aircraft`}
          </span>
        )}
      </div>
      {sub && !editing ? (
        <>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4 }}>{sub.name}</div>
          <div className="num" style={{ fontSize: 12.5, color: C.muted }}>Callsign {sub.callsign}</div>
        </>
      ) : !editing ? (
        <div style={{ fontSize: 13, color: C.textDim, marginTop: 4 }}>{LIKE[kind]}</div>
      ) : null}
      <div style={{ fontSize: 12.5, color: C.textDim, marginTop: 6 }}>{BRAND_RULE[kind]}</div>

      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          style={{ display: 'grid', gap: 10, marginTop: 10 }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 10 }}>
            <Field label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} style={inputStyle} />
            </Field>
            <Field label="Callsign">
              <input value={callsign} onChange={(e) => setCallsign(e.target.value.toUpperCase())} maxLength={20} autoCapitalize="characters" spellCheck={false} style={inputStyle} />
            </Field>
          </div>
          {err && (
            <div role="alert" style={{ fontSize: 12.5, color: C.red }}>
              {err}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" variant="primary">
              {sub ? 'Save' : 'Set up'}
            </Button>
          </div>
        </form>
      )}

      {!editing && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {sub ? (
            closing ? (
              <>
                <span style={{ flex: '1 1 200px', fontSize: 12.5, color: C.textDim }}>
                  Close {sub.name}? {props.aircraft ? `Its ${props.aircraft === 1 ? 'aircraft goes' : `${props.aircraft} aircraft go`} back to ${props.airlineName}, flights and all.` : 'It has no aircraft.'}
                </span>
                <Button size="sm" onClick={() => setClosing(false)}>
                  Keep it
                </Button>
                <Button size="sm" variant="danger" onClick={() => props.onSave(kind, null)}>
                  Close it
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" onClick={() => props.onEditLivery(kind)}>
                  Livery
                </Button>
                <Button size="sm" onClick={open}>
                  Rename
                </Button>
                <span style={{ flex: 1 }} />
                <Button size="sm" variant="ghost" onClick={() => setClosing(true)} style={{ color: C.red }}>
                  Close brand
                </Button>
              </>
            )
          ) : (
            <Button size="sm" variant="primary" onClick={open}>
              Set up
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
