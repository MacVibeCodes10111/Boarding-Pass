import { useRef, useState } from 'react';
import { formatAway, formatGameSpan, type CatchUpReport } from '../game/clock';
import type { GameAlert, GameMode } from '../game/types';
import { Icon } from '../ui/icons';
import { Button, C, ModalShell } from '../ui/kit';

const severityColor = (s: 'error' | 'warning' | 'info') => ({ error: C.red, warning: C.amberStrong, info: C.accent })[s];

/** In-game notice. With `onConfirm` it becomes a Cancel / confirm dialog. */
export function AlertModal({ alert, onDismiss }: { alert: GameAlert; onDismiss: () => void }) {
  const severity = alert.severity ?? 'error';
  const color = severityColor(severity);
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

/**
 * A short message under the top bar. Tap it, or swipe it away in any
 * direction (it follows your finger and slides off when let go far enough).
 */
export function Toast({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [leaving, setLeaving] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const moved = useRef(false);
  const SWIPE = 60;
  const leave = (dx: number, dy: number) => {
    // Off the side it went towards; straight up when it was mostly a vertical flick
    const side = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx || 1) * window.innerWidth, y: dy } : { x: dx, y: -160 };
    setLeaving(side);
    window.setTimeout(() => onDismiss?.(), 180);
  };
  const offset = leaving ?? drag ?? { x: 0, y: 0 };
  const dist = Math.hypot(offset.x, Math.min(0, offset.y) * 1.6);
  return (
    <div
      role="status"
      className="bp-toast"
      title={onDismiss ? 'Tap or swipe to dismiss' : undefined}
      onPointerDown={(e) => {
        if (!onDismiss || leaving) return;
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        moved.current = false;
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        const s0 = start.current;
        if (!s0 || s0.id !== e.pointerId) return;
        const dx = e.clientX - s0.x;
        const dy = e.clientY - s0.y;
        if (Math.hypot(dx, dy) > 6) moved.current = true;
        // Downwards it only gives a little (it lives under the top bar)
        if (moved.current) setDrag({ x: dx, y: dy > 0 ? dy * 0.25 : dy });
      }}
      onPointerUp={(e) => {
        const s0 = start.current;
        start.current = null;
        if (!s0 || s0.id !== e.pointerId) return;
        const dx = e.clientX - s0.x;
        const dy = e.clientY - s0.y;
        if (!moved.current) return onDismiss?.(); // a tap
        if (Math.abs(dx) > SWIPE || dy < -SWIPE / 2) leave(dx, dy);
        else setDrag(null);
      }}
      onPointerCancel={() => {
        start.current = null;
        setDrag(null);
      }}
      style={{
        // Just under the top bar: never over the buttons at the bottom of panels and the drawer
        position: 'fixed',
        top: 'calc(var(--bp-top-h) + 8px)',
        cursor: onDismiss ? 'grab' : undefined,
        left: '50%',
        transform: `translate(calc(-50% + ${offset.x}px), ${offset.y}px)`,
        opacity: leaving ? 0 : Math.max(0.25, 1 - dist / 260),
        transition: drag && !leaving ? 'none' : 'transform .18s ease-out, opacity .18s ease-out',
        touchAction: 'none',
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: C.raised,
        color: C.text,
        border: `1px solid ${C.border}`,
        padding: '9px 16px',
        borderRadius: 14,
        fontWeight: 500,
        fontSize: 13,
        zIndex: 250,
        boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
        maxWidth: 'min(calc(100vw - 24px), 620px)',
        width: 'max-content',
        lineHeight: 1.4,
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
