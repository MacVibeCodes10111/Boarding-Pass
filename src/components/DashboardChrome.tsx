import { CreditsModal } from './Credits';
import { openAppearance } from './Appearance';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  econDayOfWeek,
  econMinOfDay,
  econWeekOf,
  ledgerCashFlow,
  ledgerNet,
  type EconomySpeed,
  type MapSpeed,
  type UtcClock,
  type WeekLedger,
} from '../game/clock';
import { DAY_NAMES_SHORT, dayIndexOf, formatClockShort } from '../game/time';
import { TILT_HINT } from '../game/platform';
import { DEV_BUILD, IS_DEV } from '../game/channel';
import type { GameMode } from '../game/types';
import { Icon, type IconName } from '../ui/icons';
import { Button, C, DISPLAY, FONT, IconButton, Segmented, floatShadow, glass } from '../ui/kit';
import { isTouchFirst, useLayout } from '../ui/layout';
import { deviceOffsetMin, offsetLabel, shiftClock } from '../game/localTime';

export type PanelId = 'fleet' | 'buy' | 'schedule' | 'airports' | 'bank' | 'stats' | 'online';
export type AiDensityLevel = 'off' | 'low' | 'medium' | 'high';
export type AiDetailLevel = 'auto' | 'low' | 'medium' | 'high' | 'max' | 'extreme';
export type MapStyleChoice = 'dark' | 'light' | 'satellite';

const compactMoney = (v: number): string => {
  if (v < 0) return `−${compactMoney(-v)}`;
  return v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `$${(v / 1e3).toFixed(1)}K` : `$${Math.round(v).toLocaleString()}`;
};
/** +$1.2M / −$350,000 */
const signedCompact = (v: number) => (Math.round(v) === 0 ? '$0' : `${v < 0 ? '−' : '+'}${compactMoney(Math.abs(v))}`);
const tone = (v: number) => (v > 0.5 ? C.green : v < -0.5 ? C.red : C.textSoft);

/** The regular weekly cash flow and the debt, shown in the top bar (Career mode). */
export interface TopBarMoney {
  /** Regular cash flow per week at today's schedule. */
  rate: { flights: number; leases: number; instalments: number; overdraft: number; net: number };
  debt: { total: number; principal: number; overdraft: number; interestLeft: number; weekly: number; loans: number; debtFreeWeek: number | null } | null;
  insolvent: boolean;
  overdrawnWeeks: number;
}

// ----------------------------------------------------------------------------
// Top bar
// ----------------------------------------------------------------------------
function Readout({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  // Touch screens have no hover: a tap shows the details instead (tap again or anywhere to hide)
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!show) return;
    const hide = () => setShow(false);
    const t = window.setTimeout(() => window.addEventListener('pointerdown', hide, { once: true }), 0);
    const auto = window.setTimeout(hide, 8000);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(auto);
      window.removeEventListener('pointerdown', hide);
    };
  }, [show]);
  return (
    <div
      title={title}
      onClick={title && isTouchFirst() ? () => setShow((v) => !v) : undefined}
      style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0, flex: 'none' }}
    >
      <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.15, whiteSpace: 'nowrap' }}>{label}</div>
      <div className="num" style={{ fontFamily: DISPLAY, fontSize: 19, fontWeight: 600, color: C.text, lineHeight: 1.15, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}>
        {children}
      </div>
      {show && title && (
        <div
          role="status"
          className="bp-readout-tip"
          style={{
            position: 'fixed',
            top: 'calc(var(--bp-top-h) + 6px)',
            left: 8,
            right: 8,
            maxWidth: 520,
            margin: '0 auto',
            zIndex: 300,
            background: C.raised,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: '10px 12px',
            fontSize: 12.5,
            lineHeight: 1.5,
            color: C.textSoft,
            whiteSpace: 'pre-line',
            boxShadow: '0 14px 36px rgba(0,0,0,0.55)',
          }}
        >
          <b style={{ color: C.text }}>{label}</b>
          {'\n'}
          {title}
        </div>
      )}
    </div>
  );
}

const Divider = () => <div style={{ width: 1, flex: 'none', alignSelf: 'stretch', margin: '12px 0', background: C.line }} />;

/** Red DEV tag on test builds (dev branch), so they are never mistaken for the real game */
export const DevTag = ({ big, onBadge }: { big?: boolean; onBadge?: boolean }) =>
  IS_DEV ? (
    <span
      className="bp-dev-tag"
      title={DEV_BUILD ? `Test build ${DEV_BUILD} from the dev branch` : 'Test build from the dev branch'}
      style={
        onBadge
          ? // Phone: a small tab across the foot of the airline badge, so it takes no room in the bar
            { position: 'absolute', left: '50%', bottom: 3, transform: 'translateX(-50%)', fontFamily: DISPLAY, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', lineHeight: '13px', padding: '0 4px', borderRadius: 4, background: '#e5383b', color: '#fff', boxShadow: '0 0 0 1.5px rgba(0,0,0,.35)', pointerEvents: 'none' }
          : { flex: 'none', fontFamily: DISPLAY, fontSize: big ? 15 : 12, fontWeight: 700, letterSpacing: '0.06em', lineHeight: big ? '22px' : '17px', padding: '0 6px', borderRadius: 5, background: '#e5383b', color: '#fff' }
      }
    >
      DEV{DEV_BUILD && !onBadge ? ` ${DEV_BUILD}` : ''}
    </span>
  ) : null;

/** One section of the top bar (the bar itself is the glass) */
const topCard = (extra?: React.CSSProperties): React.CSSProperties => ({
  borderRadius: 10,
  height: 50,
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '0 14px',
  flex: 'none',
  pointerEvents: 'auto',
  ...extra,
});

/** The window width, updated on resize (for layouts that depend on more than phone/tablet/desktop). */
function useWindowWidth() {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

/**
 * Phone: the economy clock, its pause and the map clock in one small button
 * at the end of the top bar; tap it for the details and the controls.
 */
function ClockButton(props: {
  econMin: number;
  econSpeed: EconomySpeed;
  onEconSpeed: (s: EconomySpeed) => void;
  mapClock: UtcClock;
  mapSpeed: MapSpeed;
  onMapSpeed: (s: MapSpeed) => void;
  /** Desktop: the map time on the button too, and the panel under the floating bar. */
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const paused = props.econSpeed === 'paused';
  const week = econWeekOf(props.econMin);
  const day = econDayOfWeek(props.econMin);
  const econTime = formatClockShort(econMinOfDay(props.econMin));
  const live = props.mapSpeed === 'live';
  return (
    <div ref={ref} style={{ display: 'flex', alignItems: 'center', flex: 'none' }}>
      <button
        type="button"
        className="bp-clock-btn"
        aria-expanded={open}
        aria-label={`${paused ? 'Paused' : `Week ${week}, day ${day}`}: clock`}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          height: 40,
          padding: '0 9px 0 8px',
          borderRadius: 10,
          cursor: 'pointer',
          background: open ? C.raised : paused ? `${C.brand}22` : 'transparent',
          border: `1px solid ${paused ? C.brand : open ? C.border : C.line}`,
          color: C.text,
          font: 'inherit',
          textAlign: 'left',
        }}
      >
        <Icon name={paused ? 'pause' : 'clock'} size={15} color={paused ? C.brand : C.textSoft} />
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.12 }}>
          <span style={{ fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>{paused ? 'Paused' : props.wide ? `Week ${week}, day ${day}` : `Week ${week}`}</span>
          <span className="num" style={{ fontFamily: DISPLAY, fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', color: paused ? C.brand : C.text }}>
            {props.wide ? (
              <>
                {live && <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', padding: '0 4px', borderRadius: 4, background: C.brand, color: C.brandInk, marginRight: 5 }}>LIVE</span>}
                {formatClockShort(props.mapClock.min)} <span style={{ color: C.muted, fontWeight: 500 }}>UTC</span>
              </>
            ) : (
              <>Day {day}</>
            )}
          </span>
        </span>
        {props.wide && <span style={{ display: 'inline-flex', transform: `rotate(${open ? -90 : 90}deg)`, transition: 'transform .15s' }}><Icon name="chevron" size={12} color={C.muted} /></span>}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Clock"
          style={{
            ...glass('f0'),
            position: 'fixed',
            top: props.wide ? 72 : 'calc(var(--bp-top-h) + 8px)',
            right: props.wide ? 12 : 8,
            width: 'min(330px, calc(100vw - 16px))',
            borderRadius: 16,
            padding: '14px 16px 16px',
            zIndex: 300,
            boxShadow: floatShadow(),
            display: 'grid',
            gap: 14,
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 3 }}>{paused ? 'Paused' : props.econSpeed === 'test' ? 'Game time (test speed)' : 'Game time · a week a day'}</div>
            <div className="num" style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
              Week {week}, day {day} <span style={{ color: C.muted, fontWeight: 500 }}>{econTime}</span>
            </div>
            <Button size="sm" variant={paused ? 'primary' : 'subtle'} block onClick={() => props.onEconSpeed(paused ? 'normal' : 'paused')}>
              <Icon name={paused ? 'play' : 'pause'} size={14} />
              {paused ? 'Resume' : 'Pause'}
            </Button>
            {paused && <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Nothing earns or costs money, even while you’re away.</div>}
          </div>
          <div style={{ height: 1, background: C.line }} />
          <div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 3 }}>Map time</div>
            <div className="num" style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              {live && <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', lineHeight: '16px', padding: '0 5px', borderRadius: 4, background: C.brand, color: C.brandInk }}>LIVE</span>}
              {DAY_NAMES_SHORT[dayIndexOf(props.mapClock.day)]} {formatClockShort(props.mapClock.min)}
              <span style={{ color: C.muted, fontWeight: 500 }}>UTC</span>
            </div>
            <div className="num" style={{ fontSize: 14, color: C.textDim, margin: '-4px 0 8px' }}>
              {deviceLocal(props.mapClock)} <span style={{ color: C.muted }}>local ({offsetLabel(deviceOffsetMin())})</span>
            </div>
            <Segmented<MapSpeed>
              size="sm"
              block
              value={props.mapSpeed}
              onChange={props.onMapSpeed}
              options={[
                { value: 'live', label: 'Real time' },
                { value: 'x7', label: 'Game speed (7×)' },
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function TopBar(props: {
  airlineName: string;
  airlineIata: string;
  /** The airline's logo (from its livery), shown in place of its code. */
  airlineLogo?: string;
  hubs: string[];
  gameMode: GameMode;
  cash: number;
  mapClock: UtcClock;
  mapSpeed: MapSpeed;
  onMapSpeed: (s: MapSpeed) => void;
  econMin: number;
  econSpeed: EconomySpeed;
  onEconSpeed: (s: EconomySpeed) => void;
  weekSoFar: WeekLedger;
  lastWeek: WeekLedger | null;
  money: TopBarMoney;
  onOpenDebt: () => void;
  /** The airline badge opens My Airline. */
  onOpenAirline: () => void;
}) {
  const layout = useLayout();
  const phone = layout === 'phone';
  const width = useWindowWidth();
  const wideClock = !(phone || (layout === 'tablet' && width < 960));
  const [moneyOpen, setMoneyOpen] = useState(false);
  const moneyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!moneyOpen) return;
    const onDown = (e: PointerEvent) => moneyRef.current && !moneyRef.current.contains(e.target as Node) && setMoneyOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMoneyOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [moneyOpen]);
  const net = ledgerNet(props.weekSoFar);
  const w = props.weekSoFar;
  const career = props.gameMode !== 'sandbox';
  const { rate, debt } = props.money;
  return (
    <header
      className={phone ? 'bp-topbar bp-glass' : 'bp-topbar'}
      data-tour="topbar"
      style={
        phone
          ? { position: 'absolute', top: 0, left: 0, right: 0, height: 'var(--bp-top-h)', display: 'flex', alignItems: 'stretch', gap: 10, padding: '0 6px 0 0', zIndex: 50, borderRadius: 0, borderWidth: '0 0 1px 0' }
          : // One floating glass bar across the top, its sections spread out along it
            { ...glass(), position: 'absolute', top: 10, left: 10, right: 10, height: 54, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 0 4px', borderRadius: 18, zIndex: 50 }
      }
    >
      {/* Airline mark and name */}
      <button
        type="button"
        className="bp-topcard bp-topcard-airline bp-airline-btn"
        onClick={props.onOpenAirline}
        aria-label={`${props.airlineName}: your airline`}
        style={{ ...topCard({ gap: 11, padding: phone ? 0 : '0 16px 0 7px', width: phone ? 46 : undefined, justifyContent: phone ? 'center' : undefined, maxWidth: 280 }), position: 'relative', alignSelf: 'stretch', height: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', textAlign: 'left', font: 'inherit' }}
      >
        <div
          style={{
            width: phone ? 32 : 38,
            height: phone ? 32 : 38,
            borderRadius: 9,
            background: props.airlineLogo ? '#ffffff' : C.brand,
            color: C.brandInk,
            overflow: 'hidden',
            display: 'grid',
            placeItems: 'center',
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: 16,
            letterSpacing: '0.03em',
            flex: 'none',
          }}
        >
          {props.airlineLogo ? <img src={props.airlineLogo} alt="" style={{ width: '86%', height: '86%', objectFit: 'contain' }} /> : props.airlineIata || 'BP'}
        </div>
        {phone ? <DevTag onBadge /> : <DevTag />}
        <div className="bp-hide-phone bp-hide-tablet" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 700, lineHeight: 1.1, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{props.airlineName}</div>
          <div style={{ fontSize: 12, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {props.hubs.length === 1 ? `Hub ${props.hubs[0]}` : `Hubs ${props.hubs.join(', ')}`}
          </div>
        </div>
      </button>

      {/* Money, the economy and the map clock; swipe sideways on a phone */}
      {!phone && <Divider />}
      <div
        className="bp-topbar-strip bp-scroll-x"
        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'stretch', justifyContent: phone ? undefined : 'space-between', gap: phone ? 14 : 6, alignSelf: 'stretch' }}
      >
        <div className="bp-topcard" style={topCard(phone ? { gap: 12, padding: '0 2px' } : undefined)}>
          <div ref={moneyRef} style={{ position: 'relative', display: 'flex' }}>
            <button
              type="button"
              className="bp-money-btn"
              aria-expanded={moneyOpen}
              aria-label="Money"
              disabled={!career}
              onClick={() => setMoneyOpen((v) => !v)}
              style={{ all: 'unset', cursor: career ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: phone ? 12 : 16, padding: '0 6px', margin: '0 -6px', borderRadius: 10, background: moneyOpen ? `${C.text}12` : 'transparent' }}
            >
              <Readout label="Cash">
                <span style={{ color: props.cash < 0 ? C.red : C.text }}>{props.gameMode === 'sandbox' ? 'Unlimited' : compactMoney(props.cash)}</span>
              </Readout>
              <Readout label="This week">
                <span style={{ color: tone(net) }}>{signedCompact(net)}</span>
              </Readout>
              {career && <span style={{ display: 'inline-flex', transform: `rotate(${moneyOpen ? -90 : 90}deg)`, transition: 'transform .15s' }}><Icon name="chevron" size={12} color={C.muted} /></span>}
            </button>
            {moneyOpen && (
              <div
                role="dialog"
                aria-label="Money"
                style={{ ...glass('f0'), position: 'fixed', top: phone ? 'calc(var(--bp-top-h) + 8px)' : 72, left: phone ? 8 : 230, width: 'min(300px, calc(100vw - 16px))', borderRadius: 16, padding: '14px 16px 16px', zIndex: 300, boxShadow: floatShadow(), display: 'grid', gap: 8, fontSize: 13.5 }}
              >
                <div style={{ fontSize: 12, color: C.muted }}>A week, as scheduled</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ color: C.muted }}>Flights</span>
                    <b className="num" style={{ color: tone(rate.flights) }}>{signedCompact(rate.flights)}</b>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ color: C.muted }}>Leases</span>
                    <b className="num" style={{ color: tone(-rate.leases) }}>{signedCompact(-rate.leases)}</b>
                  </div>
                {rate.instalments > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ color: C.muted }}>Loan instalments</span>
                    <b className="num" style={{ color: tone(-rate.instalments) }}>{signedCompact(-rate.instalments)}</b>
                  </div>
                )}
                {rate.overdraft > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ color: C.muted }}>Overdraft interest</span>
                    <b className="num" style={{ color: tone(-rate.overdraft) }}>{signedCompact(-rate.overdraft)}</b>
                  </div>
                )}
                <div style={{ height: 1, background: C.line }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ color: C.text, fontWeight: 600 }}>Cash flow</span>
                    <b className="num" style={{ color: tone(rate.net) }}>{signedCompact(rate.net)}</b>
                  </div>
                <div style={{ height: 1, background: C.line }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ color: C.muted }}>This week so far</span>
                    <b className="num" style={{ color: tone(ledgerCashFlow(w)) }}>{signedCompact(ledgerCashFlow(w))}</b>
                  </div>
                {props.lastWeek && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ color: C.muted }}>Last week</span>
                    <b className="num" style={{ color: tone(ledgerCashFlow(props.lastWeek)) }}>{signedCompact(ledgerCashFlow(props.lastWeek))}</b>
                  </div>
                )}
                <Button
                  size="sm"
                  style={{ marginTop: 4 }}
                  onClick={() => {
                    setMoneyOpen(false);
                    props.onOpenDebt();
                  }}
                >
                  Bank
                </Button>
              </div>
            )}
          </div>
          {career && (debt || props.money.insolvent) && (
            <button
              type="button"
              className="bp-debt"
              onClick={props.onOpenDebt}
              title={props.money.insolvent ? undefined : `${compactMoney(debt!.weekly)} a week${debt!.debtFreeWeek ? `, debt-free in week ${debt!.debtFreeWeek}` : ''}`}
              style={{ all: 'unset', cursor: 'pointer', display: 'flex' }}
            >
              <Readout label={props.money.insolvent ? 'Insolvent' : debt!.overdraft ? 'Overdrawn' : 'Debt'}>
                <span style={{ color: props.money.insolvent || debt!.overdraft ? C.red : C.amber }}>{props.money.insolvent ? 'Settle now' : compactMoney(debt!.total)}</span>
              </Readout>
            </button>
          )}
        </div>

      </div>
      {!phone && <IconButton icon="palette" label="Appearance" size={38} iconSize={19} onClick={openAppearance} />}
      {/* Both clocks live behind one button */}
      <ClockButton
        econMin={props.econMin}
        econSpeed={props.econSpeed}
        onEconSpeed={props.onEconSpeed}
        mapClock={props.mapClock}
        mapSpeed={props.mapSpeed}
        onMapSpeed={props.onMapSpeed}
        wide={wideClock}
      />
    </header>
  );
}

/** The map clock on this computer's local time: "Thu 15:16" (v2.55). */
function deviceLocal(clock: { day: number; min: number }): string {
  const { text, dayShift } = shiftClock(clock.min, deviceOffsetMin());
  return `${DAY_NAMES_SHORT[dayIndexOf(clock.day + dayShift)]} ${text}`;
}

// ----------------------------------------------------------------------------
// The dock: every part of the game, one tap away
// ----------------------------------------------------------------------------
function RailButton({
  icon,
  label,
  active,
  onClick,
  badge,
  tab,
  tour,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  onClick: () => void;
  badge?: number;
  /** In the phone's bottom tab bar (otherwise the floating dock). */
  tab?: boolean;
  /** Name the welcome tour points at. */
  tour?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className="bp-dock-btn"
      data-tour={tour}
      style={{
        position: 'relative',
        flex: tab ? '1 1 0' : 'none',
        minWidth: 0,
        width: tab ? undefined : 68,
        height: tab ? undefined : 54,
        padding: tab ? '8px 2px 6px' : 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        borderRadius: tab ? 0 : 13,
        background: active && !tab ? `${C.brand}24` : 'transparent',
        border: 'none',
        color: active ? C.text : C.muted,
        cursor: 'pointer',
        fontFamily: FONT,
        fontSize: 11.5,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      <Icon name={icon} size={22} color={active ? C.brand : 'currentColor'} />
      {label}
      {badge ? (
        <span
          className="num"
          aria-label={`${badge} new`}
          style={{
            position: 'absolute',
            top: 4,
            left: '50%',
            marginLeft: 7,
            minWidth: 17,
            height: 17,
            padding: '0 4px',
            borderRadius: 999,
            background: C.red,
            color: '#fff',
            fontFamily: DISPLAY,
            fontSize: 11.5,
            fontWeight: 700,
            lineHeight: '17px',
            boxShadow: `0 0 0 2px ${C.panel}`,
          }}
        >
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </button>
  );
}

/** Dock buttons that each open a group of panels (with tabs at the top). */
export const PANEL_GROUPS: Record<'airline' | 'buy', { label: string; tabs: { id: PanelId; label: string; icon: IconName }[] }> = {
  airline: {
    label: 'Airline',
    tabs: [
      { id: 'stats', label: 'Overview', icon: 'chart' },
      { id: 'fleet', label: 'Fleet', icon: 'fleet' },
      { id: 'schedule', label: 'Schedule', icon: 'schedule' },
    ],
  },
  buy: {
    label: 'Buy',
    tabs: [
      { id: 'buy', label: 'Aircraft', icon: 'buy' },
      { id: 'airports', label: 'Airports', icon: 'airport' },
    ],
  },
};
export const groupOfPanel = (p: PanelId | null): 'airline' | 'buy' | null =>
  !p ? null : PANEL_GROUPS.airline.tabs.some((t) => t.id === p) ? 'airline' : PANEL_GROUPS.buy.tabs.some((t) => t.id === p) ? 'buy' : null;

export function NavRail(props: {
  activePanel: PanelId | null;
  /** Letters waiting in the Bank panel (unread or with a grant to collect). */
  bankBadge: number;
  onOpen: (p: PanelId | null) => void;
  /** Opens a group on its last-used tab. */
  onOpenGroup: (g: 'airline' | 'buy') => void;
  onMenu: () => void;
}) {
  const group = groupOfPanel(props.activePanel);
  const phone = useLayout() === 'phone';
  const toggle = (p: PanelId) => props.onOpen(props.activePanel === p ? null : p);
  const buttons = (tab: boolean) => (
    <>
      <RailButton tab={tab} icon="map" label="Map" active={props.activePanel === null} onClick={() => props.onOpen(null)} />
      <RailButton tab={tab} tour="airline" icon="fleet" label="Airline" active={group === 'airline'} onClick={() => (group === 'airline' ? props.onOpen(null) : props.onOpenGroup('airline'))} />
      <RailButton tab={tab} tour="buy" icon="buy" label="Buy" active={group === 'buy'} onClick={() => (group === 'buy' ? props.onOpen(null) : props.onOpenGroup('buy'))} />
      <RailButton tab={tab} tour="bank" icon="bank" label="Bank" active={props.activePanel === 'bank'} onClick={() => toggle('bank')} badge={props.bankBadge} />
      <RailButton tab={tab} icon="globe" label="Online" active={props.activePanel === 'online'} onClick={() => toggle('online')} />
      <RailButton tab={tab} tour="menu" icon="menu" label="Menu" onClick={props.onMenu} />
    </>
  );
  if (phone) {
    return (
      <nav
        aria-label="Main"
        className="bp-tabbar bp-glass"
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 'var(--bp-bottom-h)', paddingBottom: 'env(safe-area-inset-bottom, 0px)', borderRadius: 0, borderWidth: '1px 0 0 0', display: 'flex', zIndex: 45 }}
      >
        {buttons(true)}
      </nav>
    );
  }
  return (
    <nav
      aria-label="Main"
      className="bp-dock"
      style={{ ...glass(), position: 'absolute', left: '50%', bottom: 12, transform: 'translateX(-50%)', maxWidth: 'calc(100vw - 20px)', display: 'flex', alignItems: 'center', gap: 2, padding: 5, borderRadius: 18, zIndex: 45 }}
    >
      {buttons(false)}
    </nav>
  );
}

// ----------------------------------------------------------------------------
// Map menu
// ----------------------------------------------------------------------------
function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', minHeight: 36 }}>
      <span style={{ flex: 1, fontSize: 14, color: C.text }}>{label}</span>
      <button
        type="button"
        role="switch"
        className="bp-switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        style={{ width: 36, height: 22, borderRadius: 999, border: 'none', padding: 2, cursor: 'pointer', background: on ? C.brand : C.border, display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start', flex: 'none' }}
      >
        <span style={{ width: 18, height: 18, borderRadius: 999, background: on ? C.brandInk : C.textDim }} />
      </button>
    </label>
  );
}

function MenuSection({ title, aside, children, first }: { title: string; aside?: React.ReactNode; children: React.ReactNode; first?: boolean }) {
  return (
    <div style={{ borderTop: first ? 'none' : `1px solid ${C.line}`, paddingTop: first ? 0 : 12, marginTop: first ? 0 : 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.muted }}>{title}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

/** The most of friends' aircraft to draw on the map. */
export type FriendsCap = '100' | '300' | '1000' | 'all';

export function LayersMenu(props: {
  mapStyle: MapStyleChoice;
  onMapStyle: (v: MapStyleChoice) => void;
  globe: boolean;
  onGlobe: (v: boolean) => void;
  threeD: boolean;
  onThreeD: (v: boolean) => void;
  detailed3d: boolean;
  onDetailed3d: (v: boolean) => void;
  /** False when the map engine can't draw a globe (older MapLibre). */
  globeAvailable: boolean;
  showAllRoutes: boolean;
  onShowAllRoutes: (v: boolean) => void;
  showWeather: boolean;
  onShowWeather: (v: boolean) => void;
  showApproaches: boolean;
  onShowApproaches: (v: boolean) => void;
  showNavaids: boolean;
  onShowNavaids: (v: boolean) => void;
  aiAvailable: boolean;
  aiDensity: AiDensityLevel;
  onAiDensity: (d: AiDensityLevel) => void;
  aiAirborne: number;
  aiDrawn: number;
  aiBudget: number;
  aiDetail: AiDetailLevel;
  onAiDetail: (d: AiDetailLevel) => void;
  /** Shown under Other airlines, e.g. which real airline your airline replaces. */
  aiNote?: string;
  aiStatus: string;
  /** Friends' aircraft: shown once the server has them switched on. */
  friendsAvailable: boolean;
  friendsOn: boolean;
  onFriendsOn: (v: boolean) => void;
  friendsCap: FriendsCap;
  onFriendsCap: (c: FriendsCap) => void;
  friendAirlines: number;
  planeIconScale: number;
  onPlaneIconScale: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const phone = useLayout() === 'phone';
  const [credits, setCredits] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // The round button sits above the zoom buttons (higher in 3D, where the camera box is under them)
  const fabBottom = props.threeD ? 'calc(var(--bp-bottom-h) + 38px + var(--bp-cam-space) + 80px)' : 'calc(var(--bp-bottom-h) + 38px + 80px)';
  const note: React.CSSProperties = { fontSize: 12, color: C.muted, lineHeight: 1.4 };
  const link: React.CSSProperties = { background: 'none', border: 'none', color: C.accent, fontSize: 12, cursor: 'pointer', padding: 0, whiteSpace: 'nowrap' };
  return (
    <div ref={ref}>
      <button
        type="button"
        className="bp-layers-fab"
        aria-expanded={open}
        aria-label="Map options"
        title="Map options"
        data-tour="layers"
        onClick={() => setOpen((v) => !v)}
        style={{
          position: 'absolute',
          right: 10,
          bottom: fabBottom,
          zIndex: 30,
          width: 44,
          height: 44,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          cursor: 'pointer',
          padding: 0,
          background: open ? C.brand : `${C.panel}f0`,
          color: open ? C.brandInk : C.text,
          border: `1px solid ${open ? C.brand : C.border}`,
          boxShadow: '0 6px 18px rgba(0,0,0,.35)',
        }}
      >
        <Icon name="layers" size={20} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Map options"
          style={{
            position: 'fixed',
            right: 10,
            bottom: phone ? 'calc(var(--bp-bottom-h) + 10px)' : fabBottom,
            width: 'min(320px, calc(100vw - 20px))',
            // Never taller than the space between the bars: the rest scrolls
            maxHeight: phone ? 'calc(100dvh - var(--bp-top-h) - var(--bp-bottom-h) - 20px)' : `calc(100dvh - var(--bp-top-h) - 30px - (${fabBottom}))`,
            overscrollBehavior: 'contain',
            overflowY: 'auto',
            ...glass('f2'),
            borderRadius: 16,
            padding: '10px 14px 12px',
            zIndex: 60,
            boxShadow: floatShadow(),
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontFamily: DISPLAY, fontSize: 19, fontWeight: 700, flex: 1 }}>Map</span>
            <IconButton icon="close" label="Close" size={32} iconSize={14} onClick={() => setOpen(false)} style={{ marginRight: -6 }} />
          </div>
          <button
            type="button"
            className="bp-row"
            onClick={() => {
              setOpen(false);
              openAppearance();
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 10px', margin: '0 0 10px', borderRadius: 12, border: 'none', background: `${C.brand}1c`, color: C.text, cursor: 'pointer', font: 'inherit', fontSize: 14.5, fontWeight: 600, textAlign: 'left' }}
          >
            <Icon name="palette" size={19} color={C.brand} />
            <span style={{ flex: 1 }}>Appearance</span>
            <span style={{ fontSize: 12.5, fontWeight: 500, color: C.muted }}>Colours and glass</span>
            <Icon name="chevron" size={13} color={C.muted} />
          </button>
          <Segmented<MapStyleChoice>
            size="sm"
            block
            value={props.mapStyle}
            onChange={props.onMapStyle}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
              { value: 'satellite', label: 'Satellite' },
            ]}
          />
          <div style={{ marginTop: 6 }}>
            {props.globeAvailable && <Switch on={props.globe} onChange={props.onGlobe} label="Globe" />}
            <Switch on={props.threeD} onChange={props.onThreeD} label="3D" />
            {props.threeD && <Switch on={props.detailed3d} onChange={props.onDetailed3d} label="Detailed aircraft" />}
            {props.threeD && <div style={{ ...note, margin: '2px 0 4px' }}>{TILT_HINT}.</div>}
          </div>

          <MenuSection title="Show">
            <Switch on={props.showAllRoutes} onChange={props.onShowAllRoutes} label="All my routes" />
            <Switch on={props.showWeather} onChange={props.onShowWeather} label="Weather" />
            <Switch on={props.showApproaches} onChange={props.onShowApproaches} label="Approaches" />
            <Switch on={props.showNavaids} onChange={props.onShowNavaids} label="Navaids" />
            {props.friendsAvailable && <Switch on={props.friendsOn} onChange={props.onFriendsOn} label={`Friends’ aircraft${props.friendsOn && props.friendAirlines > 0 ? ` (${props.friendAirlines} ${props.friendAirlines === 1 ? 'airline' : 'airlines'})` : ''}`} />}
            {props.friendsAvailable && props.friendsOn && (
              <div style={{ margin: '2px 0 6px' }}>
                <Segmented<FriendsCap>
                  size="sm"
                  block
                  value={props.friendsCap}
                  onChange={props.onFriendsCap}
                  options={[
                    { value: '100', label: '100' },
                    { value: '300', label: '300' },
                    { value: '1000', label: '1,000' },
                    { value: 'all', label: 'All' },
                  ]}
                />
              </div>
            )}
          </MenuSection>

          <MenuSection
            title="Other airlines"
            aside={
              props.aiAvailable && props.aiDensity !== 'off' ? (
                <span className="num" style={{ fontSize: 12, color: C.muted }}>
                  {props.aiAirborne.toLocaleString()} flying
                </span>
              ) : undefined
            }
          >
            {props.aiAvailable ? (
              <Segmented
                size="sm"
                block
                value={props.aiDensity}
                onChange={props.onAiDensity}
                options={[
                  { value: 'off', label: 'Off' },
                  { value: 'low', label: 'Few' },
                  { value: 'medium', label: 'Half' },
                  { value: 'high', label: 'All' },
                ]}
              />
            ) : (
              <div style={note}>{props.aiStatus}</div>
            )}
            {props.aiAvailable && props.aiNote && <div style={{ ...note, marginTop: 6 }}>{props.aiNote}</div>}

            {props.aiAvailable && props.aiDensity !== 'off' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '12px 0 6px' }}>
                  <span style={{ fontSize: 14, color: C.text }}>Detail</span>
                  <span className="num" style={{ fontSize: 12, color: C.muted }}>
                    {props.aiDrawn.toLocaleString()} drawn
                  </span>
                </div>
                <Segmented<AiDetailLevel>
                  size="sm"
                  block
                  value={props.aiDetail}
                  onChange={props.onAiDetail}
                  options={[
                    { value: 'auto', label: 'Auto' },
                    { value: 'low', label: 'Low', title: 'Up to 600 aircraft' },
                    { value: 'medium', label: 'Med', title: 'Up to 1,500 aircraft' },
                    { value: 'high', label: 'High', title: 'Up to 3,000 aircraft' },
                    { value: 'max', label: 'Max', title: 'Up to 5,000 aircraft' },
                    { value: 'extreme', label: 'Ultra', title: 'Up to 10,000 aircraft' },
                  ]}
                />
                {props.aiDetail === 'extreme' && (
                  <div role="alert" style={{ display: 'flex', gap: 8, marginTop: 8, color: C.amber, fontSize: 12, lineHeight: 1.4 }}>
                    <Icon name="warning" size={15} />
                    <span>Up to 10,000 aircraft: the map may stutter.</span>
                  </div>
                )}
              </>
            )}
          </MenuSection>

          <MenuSection
            title="Aircraft size"
            aside={
              <button type="button" onClick={() => props.onPlaneIconScale(0.85)} style={{ ...link, color: C.muted }}>
                Reset
              </button>
            }
          >
            <input
              type="range"
              min={0.35}
              max={1.85}
              step={0.05}
              value={props.planeIconScale}
              aria-label="Aircraft size on the map"
              onChange={(e) => props.onPlaneIconScale(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.brand, cursor: 'pointer' }}
            />
          </MenuSection>
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 14 }}>
            <button type="button" onClick={() => setCredits(true)} style={link}>
              Credits
            </button>
          </div>
          <div style={{ fontSize: 11, color: C.faint, marginTop: 6 }}>Maps © CARTO, © OpenStreetMap contributors{props.mapStyle === 'satellite' ? ', EOxCloudless' : ''}</div>
        </div>
      )}
      {credits && <CreditsModal onClose={() => setCredits(false)} />}
    </div>
  );
}
