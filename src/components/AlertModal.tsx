import { formatAway, formatGameSpan, type CatchUpReport } from '../game/clock';
import type { GameAlert, GameMode } from '../game/types';
import { Icon } from '../ui/icons';
import { Button, C, ModalShell } from '../ui/kit';

const SEVERITY_COLOR = { error: C.red, warning: C.amberStrong, info: C.accent } as const;

/** In-game notice. With `onConfirm` it becomes a Cancel / confirm dialog. */
export function AlertModal({ alert, onDismiss }: { alert: GameAlert; onDismiss: () => void }) {
  const severity = alert.severity ?? 'error';
  const color = SEVERITY_COLOR[severity];
  return (
    <ModalShell onClose={onDismiss} maxWidth={440} zIndex={300}>
      <div style={{ display: 'flex', gap: 12 }}>
        {severity !== 'info' && <Icon name="warning" size={20} color={color} style={{ marginTop: 2 }} />}
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 650 }}>{alert.title}</h3>
          <div style={{ fontSize: 13, color: C.textSoft, lineHeight: 1.5 }}>{alert.message}</div>
          {alert.detail && <div style={{ marginTop: 8, fontSize: 12.5, color: C.muted, lineHeight: 1.45 }}>{alert.detail}</div>}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
        {alert.onConfirm ? (
          <>
            {alert.secondaryLabel && alert.onSecondary && (
              <Button
                variant={alert.secondaryVariant ?? 'ghost'}
                onClick={() => {
                  if (alert.secondaryCloses) onDismiss();
                  alert.onSecondary?.();
                }}
                style={{ marginRight: 'auto' }}
              >
                {alert.secondaryLabel}
              </Button>
            )}
            <Button onClick={onDismiss}>Cancel</Button>
            <Button
              variant={severity === 'error' ? 'danger' : 'primary'}
              onClick={() => {
                onDismiss();
                alert.onConfirm?.();
              }}
            >
              {alert.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onDismiss} autoFocus>
            OK
          </Button>
        )}
      </div>
    </ModalShell>
  );
}

export function Toast({ message }: { message: string }) {
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        bottom: 22,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: C.raised,
        color: C.text,
        border: `1px solid ${C.border}`,
        padding: '9px 16px',
        borderRadius: 999,
        fontWeight: 500,
        fontSize: 13,
        zIndex: 250,
        boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
        maxWidth: '70vw',
        animation: 'bp-fade-in .15s ease-out',
      }}
    >
      <Icon name="check" size={15} color={C.green} />
      {message}
    </div>
  );
}

const usd = (v: number) => (Math.round(v) === 0 ? '$0' : `${v < 0 ? '−' : '+'}$${Math.abs(Math.round(v)).toLocaleString()}`);

/** Shown when a career resumes: what the economy did while the app was closed. */
export function AwayReportModal({ report, gameMode, onClose }: { report: CatchUpReport; gameMode: GameMode; onClose: () => void }) {
  const row = (label: string, value: string, color: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${C.line}`, fontSize: 13 }}>
      <span style={{ color: C.muted }}>{label}</span>
      <b style={{ color }}>{value}</b>
    </div>
  );
  return (
    <ModalShell onClose={onClose} maxWidth={440} zIndex={300}>
      <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 650 }}>While you were away</h3>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
        You were gone {formatAway(report.realAwayMs)} → {formatGameSpan(report.gameMinutes)} of airline operations.
      </div>
      {row('Flight operations', usd(report.flightProfit), report.flightProfit >= 0 ? C.green : C.red)}
      {row('Lease payments', usd(-report.leaseCost), report.leaseCost > 0 ? C.red : C.muted)}
      {report.loanCost ? row('Loan instalments', usd(-report.loanCost), C.red) : null}
      {row('Net change', usd(report.net), report.net >= 0 ? C.green : C.red)}
      {report.weeksClosed > 0 && row('Weeks closed', String(report.weeksClosed), C.textSoft)}
      {report.capped && (
        <div style={{ fontSize: 11, color: C.amber, marginTop: 10 }}>
          Catch-up is capped at 4 game weeks, so only the first ~4 real days of your absence were counted.
        </div>
      )}
      {gameMode === 'sandbox' && <div style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>Sandbox mode: cash is unlimited, this is just for reference.</div>}
      <Button size="lg" block variant="primary" style={{ marginTop: 14 }} onClick={onClose}>
        Back to work
      </Button>
    </ModalShell>
  );
}
