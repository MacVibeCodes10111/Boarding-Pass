// ============================================================================
// REPORT AND NOTICES (Update A, phase A6)
//   A Report button for another player's airline, alliance or logo, and the plain
//   notice a player sees when a moderator changed something of theirs.
// ============================================================================
import { useEffect, useState } from 'react';
import { currentUser } from '../game/cloud';
import { featureOn } from '../game/features';
import { REPORT_NOTE_MAX, REPORT_REASONS, makeReport, reportAnswer, takeNotices, type Notice, type ReportKind, type ReportReason } from '../game/reports';
import { Button, C, DISPLAY, ModalShell, inputStyle } from '../ui/kit';

export interface ReportTarget {
  /** The reporting player's airline (reports are made as one of their airlines). */
  me: string;
  kind: ReportKind;
  target: string;
  /** What's being reported, as the player sees it. */
  name: string;
  /** The logo, when the airline or alliance has one: it can be reported on its own. */
  logo?: string | null;
}

/** Hidden while reporting is off. */
export function ReportButton(props: ReportTarget & { disabled?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  if (!featureOn('reports')) return null;
  return (
    <>
      <Button size="sm" variant="ghost" disabled={props.disabled} onClick={() => setOpen(true)} title={`Report ${props.name}`}>
        {props.label ?? 'Report'}
      </Button>
      {open && <ReportWindow {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReportWindow(props: ReportTarget & { onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [aboutLogo, setAboutLogo] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState('');
  const [done, setDone] = useState(false);
  const send = async () => {
    if (!reason) return;
    setBusy(true);
    try {
      const r = await makeReport(props.me, aboutLogo && props.logo ? 'logo' : props.kind, props.target, reason, note, aboutLogo ? props.logo : null);
      setAnswer(reportAnswer(r));
      setDone(r === 'sent' || r === 'already');
    } catch (e) {
      setAnswer(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalShell onClose={props.onClose} maxWidth={420} zIndex={260} label={`Report ${props.name}`}>
      <div style={{ padding: '20px 22px', display: 'grid', gap: 12 }}>
        <div style={{ paddingRight: 30 }}>
          <h2 style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 700, margin: 0 }}>Report</h2>
          <p style={{ fontSize: 13, color: C.muted, margin: '4px 0 0', lineHeight: 1.45, overflowWrap: 'anywhere' }}>
            {props.kind === 'alliance' ? 'The alliance' : 'The airline'} {props.name}. Only moderators see reports, with your airline’s name. They don’t tell the other player who reported them.
          </p>
        </div>
        {done ? (
          <>
            <p role="status" style={{ fontSize: 13.5, margin: 0, lineHeight: 1.5 }}>
              {answer}
            </p>
            <Button variant="primary" onClick={props.onClose}>
              Done
            </Button>
          </>
        ) : (
          <>
            {props.logo && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[false, true].map((l) => (
                  <Button key={String(l)} size="sm" variant={aboutLogo === l ? 'primary' : 'subtle'} onClick={() => setAboutLogo(l)} aria-pressed={aboutLogo === l}>
                    {l ? 'Just its logo' : props.kind === 'alliance' ? 'The alliance' : 'The airline'}
                  </Button>
                ))}
              </div>
            )}
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 6 }}>
              <legend style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>What’s wrong</legend>
              {REPORT_REASONS.map((r) => (
                <label key={r.value} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 9, background: C.raised, border: `1px solid ${reason === r.value ? C.brand : 'transparent'}`, fontSize: 13.5, cursor: 'pointer' }}>
                  <input type="radio" name="bp-report-reason" checked={reason === r.value} onChange={() => setReason(r.value)} style={{ accentColor: C.brand }} />
                  {r.label}
                </label>
              ))}
            </fieldset>
            <label style={{ display: 'grid', gap: 4, fontSize: 12, color: C.muted }}>
              Anything a moderator should know (optional)
              <textarea value={note} maxLength={REPORT_NOTE_MAX} rows={2} onChange={(e) => setNote(e.target.value)} style={{ ...inputStyle, resize: 'vertical', minHeight: 50, fontFamily: 'inherit' }} />
            </label>
            {answer && (
              <p role="status" style={{ fontSize: 12.5, margin: 0, color: C.red }}>
                {answer}
              </p>
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Button variant="primary" disabled={!reason || busy} onClick={() => void send()}>
                {busy ? 'Sending…' : 'Send report'}
              </Button>
              <Button variant="ghost" onClick={props.onClose}>
                Cancel
              </Button>
            </div>
            <p style={{ fontSize: 11.5, color: C.faint, margin: 0, lineHeight: 1.45 }}>To block them as well, use Block in Friends. Reports are kept for up to 12 months.</p>
          </>
        )}
      </div>
    </ModalShell>
  );
}

const NOTICE_EVERY_MS = 30 * 60_000;
const CHECK_EVENT = 'bp-check-notices';
/** Looks for notices now (the Online window does when it opens). */
export const checkNotices = () => window.dispatchEvent(new Event(CHECK_EVENT));

/** Shows any notices from moderators: when the game starts, every half hour, and when Online opens. */
export function NoticesHost() {
  const [notices, setNotices] = useState<Notice[]>([]);
  useEffect(() => {
    let live = true;
    const check = async () => {
      try {
        if (!featureOn('online') || !(await currentUser())) return;
        const got = await takeNotices();
        if (live && got.length) setNotices((n) => [...n, ...got]);
      } catch {
        /* tried again later */
      }
    };
    void check();
    const t = window.setInterval(() => void check(), NOTICE_EVERY_MS);
    const onCheck = () => void check();
    window.addEventListener(CHECK_EVENT, onCheck);
    return () => {
      live = false;
      window.clearInterval(t);
      window.removeEventListener(CHECK_EVENT, onCheck);
    };
  }, []);
  if (!notices.length) return null;
  return (
    <ModalShell onClose={() => setNotices([])} maxWidth={440} zIndex={270} label="A note from Boarding Pass">
      <div style={{ padding: '20px 22px', display: 'grid', gap: 12 }}>
        <h2 style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 700, margin: 0, paddingRight: 30 }}>A note from Boarding Pass</h2>
        {notices.map((n, i) => (
          <p key={i} style={{ fontSize: 13.5, margin: 0, lineHeight: 1.5, padding: '10px 12px', borderRadius: 10, background: C.raised }}>
            {n.text}
          </p>
        ))}
        <p style={{ fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.45 }}>
          The sharing rules are in the Terms of use. If you think this was a mistake, ask on the Boarding Pass Discord.
        </p>
        <Button variant="primary" onClick={() => setNotices([])}>
          OK
        </Button>
      </div>
    </ModalShell>
  );
}
