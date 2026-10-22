import { CreditsModal } from './Credits';
import { openAppearance } from './Appearance';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  CASH_FLOW_LABELS,
  econDayOfWeek,
  econMinOfDay,
  econWeekOf,
  ledgerCashFlow,
  ledgerNet,
  type CashFlowKind,
  type EconomySpeed,
  type MapSpeed,
  type UtcClock,
  type WeekLedger,
} from '../game/clock';
import { DAY_NAMES_SHORT, dayIndexOf, formatClockShort } from '../game/time';
import { HEIGHT_HINT, TILT_HINT } from '../game/platform';
import { DEV_BUILD, IS_DEV } from '../game/channel';
import type { GameMode } from '../game/types';
import { Icon, type IconName } from '../ui/icons';
import { C, DISPLAY, Segmented, glass } from '../ui/kit';
import { isTouchFirst, useLayout } from '../ui/layout';

export type PanelId = 'fleet' | 'buy' | 'schedule' | 'airports' | 'bank' | 'stats';
export type AiDensityLevel = 'off' | 'low' | 'medium' | 'high';
export type AiDetailLevel = 'auto' | 'low' | 'medium' | 'high' | 'max' | 'extreme';
export type MapStyleChoice = 'dark' | 'light' | 'satellite';

const money = (v: number) => (Math.round(v) === 0 ? '$0' : `${v < 0 ? '−' : '+'}$${Math.abs(Math.round(v)).toLocaleString()}`);
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
export const DevTag = ({ big }: { big?: boolean }) =>
  IS_DEV ? (
    <span
      className="bp-dev-tag"
      title={DEV_BUILD ? `Test build ${DEV_BUILD} from the dev branch` : 'Test build from the dev branch'}
      style={{ flex: 'none', fontFamily: DISPLAY, fontSize: big ? 15 : 12, fontWeight: 700, letterSpacing: '0.06em', lineHeight: big ? '22px' : '17px', padding: '0 6px', borderRadius: 5, background: '#e5383b', color: '#fff' }}
    >
      DEV{DEV_BUILD ? ` ${DEV_BUILD}` : ''}
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

export function TopBar(props: {
  airlineName: string;
  airlineIata: string;
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
  layers: React.ReactNode;
}) {
  const phone = useLayout() === 'phone';
  const net = ledgerNet(props.weekSoFar);
  const w = props.weekSoFar;
  const career = props.gameMode !== 'sandbox';
  const { rate, debt } = props.money;
  const interest = (w.interestCost ?? w.loanCost ?? 0) + (w.overdraftCost ?? 0);
  const oneOffs = Object.entries(w.flows ?? {}).filter(([, v]) => Math.round(v ?? 0) !== 0) as [CashFlowKind, number][];
  const flowTitle = [
    `Regular cash flow per week at today's schedule: flights ${money(rate.flights)}, leases ${money(-rate.leases)}, loan instalments ${money(-rate.instalments)}${rate.overdraft ? `, overdraft interest ${money(-rate.overdraft)}` : ''}.`,
    `This week so far ${money(ledgerCashFlow(w))}${oneOffs.length ? ` (with ${oneOffs.map(([k, v]) => `${CASH_FLOW_LABELS[k].toLowerCase()} ${money(v)}`).join(', ')})` : ''}.`,
    props.lastWeek ? `Last week ${money(ledgerCashFlow(props.lastWeek))}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const paused = props.econSpeed === 'paused';
  return (
    <header
      className={phone ? 'bp-topbar bp-glass' : 'bp-topbar'}
      data-tour="topbar"
      style={
        phone
          ? { position: 'absolute', top: 0, left: 0, right: 0, height: 'var(--bp-top-h)', display: 'flex', alignItems: 'stretch', gap: 10, padding: '0 6px 0 0', zIndex: 50, borderRadius: 0, borderWidth: '0 0 1px 0' }
          : // One floating glass bar across the top, its sections spread out along it
            { ...glass(), position: 'absolute', top: 10, left: 10, right: 10, height: 54, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 0 4px', borderRadius: 15, zIndex: 50 }
      }
    >
      {/* Airline mark and name */}
      <button
        type="button"
        className="bp-topcard bp-topcard-airline bp-airline-btn"
        onClick={props.onOpenAirline}
        title={`${props.airlineName}: open My Airline`}
        aria-label={`${props.airlineName}: open My Airline`}
        style={{ ...topCard({ gap: 11, padding: phone ? 0 : '0 16px 0 7px', width: phone ? 50 : undefined, justifyContent: phone ? 'center' : undefined, maxWidth: 280 }), background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', textAlign: 'left', font: 'inherit' }}
      >
        <div
          style={{
            width: phone ? 32 : 38,
            height: phone ? 32 : 38,
            borderRadius: 9,
            background: C.brand,
            color: C.brandInk,
            display: 'grid',
            placeItems: 'center',
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: 16,
            letterSpacing: '0.03em',
            flex: 'none',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,.3), 0 2px 0 rgba(0,0,0,.3)',
          }}
        >
          {props.airlineIata || 'BP'}
        </div>
        <DevTag />
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
        <div className="bp-topcard" style={topCard()}>
          <Readout label="Cash">
            <span style={{ color: props.cash < 0 ? C.red : C.text }}>{props.gameMode === 'sandbox' ? 'Unlimited' : compactMoney(props.cash)}</span>
          </Readout>
          <Divider />
          <Readout
            label="Profit this week"
            title={`Flights ${money(w.flightProfit)}, leases ${money(-w.leaseCost)}${interest ? `, interest ${money(-interest)}` : ''}. Repaying a loan's principal isn't a cost, so only interest counts.${props.lastWeek ? `\nLast week ${money(ledgerNet(props.lastWeek))}.` : ''}`}
          >
            <span style={{ color: tone(net) }}>{phone ? signedCompact(net) : money(net)}</span>
          </Readout>
          {career && (
            <Readout label="Cash flow" title={flowTitle}>
              <span className="bp-cashflow" style={{ color: tone(rate.net) }}>
                {signedCompact(rate.net)}
                {!phone && <span style={{ color: C.muted, fontWeight: 500, fontSize: 14 }}>/wk</span>}
              </span>
            </Readout>
          )}
          {career && (debt || props.money.insolvent) && (
            <button
              type="button"
              className="bp-debt"
              onClick={props.onOpenDebt}
              title={
                props.money.insolvent
                  ? 'The bank has declared your airline insolvent. Open the bank to settle.'
                  : `Loans ${compactMoney(debt!.principal)}${debt!.overdraft ? `, overdraft ${compactMoney(debt!.overdraft)}` : ''}. Interest still to pay ${compactMoney(debt!.interestLeft)}. Instalments ${compactMoney(debt!.weekly)} a week${debt!.debtFreeWeek ? `, debt-free in week ${debt!.debtFreeWeek}` : ''}.${props.money.overdrawnWeeks ? `\nOverdrawn when ${props.money.overdrawnWeeks} week${props.money.overdrawnWeeks === 1 ? '' : 's'} closed: two in a row and the bank declares you insolvent.` : ''}\nClick to manage your loans.`
              }
              style={{ all: 'unset', cursor: 'pointer', display: 'flex' }}
            >
              <Readout label={props.money.insolvent ? 'Insolvent' : debt!.overdraft ? 'Debt (overdrawn)' : 'Debt'}>
                <span style={{ color: props.money.insolvent || debt!.overdraft ? C.red : C.amber }}>{props.money.insolvent ? 'Settle now' : compactMoney(debt!.total)}</span>
              </Readout>
            </button>
          )}
        </div>

        {!phone && <Divider />}
        <div className="bp-topcard" style={topCard({ gap: 11, paddingLeft: 9 })}>
          <button
            type="button"
            onClick={() => props.onEconSpeed(paused ? 'normal' : 'paused')}
            title={paused ? 'Resume the economy' : 'Pause the economy (also stops catch-up while the game is closed)'}
            aria-label={paused ? 'Resume economy' : 'Pause economy'}
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              flex: 'none',
              background: paused ? C.brand : C.raised,
              color: paused ? C.brandInk : C.textSoft,
              border: `1px solid ${paused ? C.brand : C.border}`,
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08), 0 2px 0 rgba(0,0,0,.25)',
            }}
          >
            <Icon name={paused ? 'play' : 'pause'} size={14} />
          </button>
          <Readout label={paused ? 'Economy paused' : props.econSpeed === 'test' ? 'Economy (test speed)' : 'Economy, 1 week per day'}>
            Week {econWeekOf(props.econMin)}, day {econDayOfWeek(props.econMin)}
            <span style={{ color: C.muted, fontWeight: 500 }}>{formatClockShort(econMinOfDay(props.econMin))}</span>
          </Readout>
        </div>

        {!phone && <Divider />}
        <div className="bp-topcard" style={topCard({ gap: 12 })}>
          <Readout
            label={props.mapSpeed === 'live' ? 'Map time, live' : paused ? 'Map time, paused with economy' : 'Map time, 7× with economy'}
            title={props.mapSpeed === 'live' ? 'Planes are drawn where they would be right now (real UTC)' : 'Planes follow the economy clock, 7× faster than real time'}
          >
            {props.mapSpeed === 'live' && (
              <span
                className="bp-live"
                style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', lineHeight: '16px', padding: '0 5px', borderRadius: 4, background: C.brand, color: C.brandInk }}
              >
                LIVE
              </span>
            )}
            {DAY_NAMES_SHORT[dayIndexOf(props.mapClock.day)]} {formatClockShort(props.mapClock.min)}
            <span style={{ color: C.muted, fontWeight: 500 }}>{props.mapSpeed === 'live' ? 'UTC' : ''}</span>
          </Readout>
          <Segmented<MapSpeed>
            size="sm"
            value={props.mapSpeed}
            onChange={props.onMapSpeed}
            options={[
              { value: 'live', label: '1×', title: 'Real time (UTC)' },
              { value: 'x7', label: '7×', title: 'Follow the economy clock (7× real time)' },
            ]}
          />
        </div>
      </div>
      {!phone && <Divider />}
      <div style={{ display: 'flex', alignItems: 'center', flex: 'none' }}>{props.layers}</div>
    </header>
  );
}

// ----------------------------------------------------------------------------
// Nav rail
// ----------------------------------------------------------------------------
function RailButton({
  icon,
  label,
  active,
  onClick,
  title,
  badge,
  tab,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  onClick: () => void;
  title?: string;
  badge?: number;
  /** In the phone's bottom tab bar (otherwise the floating toolbar). */
  tab?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      aria-current={active ? 'page' : undefined}
      className="bp-dock-btn"
      data-tour={label.toLowerCase().replace(/\s+/g, '-')}
      style={{
        position: 'relative',
        flex: tab ? '1 1 0' : 'none',
        minWidth: 0,
        width: tab ? undefined : 70,
        height: tab ? undefined : 58,
        padding: tab ? '7px 2px 5px' : '7px 0 5px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        borderRadius: tab ? 0 : 12,
        background: active ? (tab ? 'transparent' : C.raised) : 'transparent',
        border: 'none',
        boxShadow: active && !tab ? `inset 0 0 0 1px ${C.border}, inset 0 -2px 0 ${C.brand}` : 'none',
        color: active ? C.text : C.textDim,
        cursor: 'pointer',
        fontFamily: DISPLAY,
        fontSize: tab ? 12 : 14,
        fontWeight: 600,
        letterSpacing: '0.01em',
        whiteSpace: 'nowrap',
      }}
    >
      {active && tab && <span style={{ position: 'absolute', top: 0, left: 12, right: 12, height: 3, borderRadius: 2, background: C.brand }} />}
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

/** Toolbar buttons that each open a group of panels (with tabs at the top). */
export const PANEL_GROUPS: Record<'airline' | 'buy', { label: string; tabs: { id: PanelId; label: string; icon: IconName }[] }> = {
  airline: {
    label: 'My Airline',
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
      { id: 'airports', label: 'Airports & hubs', icon: 'airport' },
    ],
  },
};
export const groupOfPanel = (p: PanelId | null): 'airline' | 'buy' | null =>
  !p ? null : PANEL_GROUPS.airline.tabs.some((t) => t.id === p) ? 'airline' : PANEL_GROUPS.buy.tabs.some((t) => t.id === p) ? 'buy' : null;

export function NavRail(props: {
  activePanel: PanelId | null;
  fleetCount: number;
  /** Letters waiting in the Bank panel (unread or with a grant to collect). */
  bankBadge: number;
  onOpen: (p: PanelId | null) => void;
  /** Opens a group on its last-used tab. */
  onOpenGroup: (g: 'airline' | 'buy') => void;
  onSave: () => void;
  onMenu: () => void;
  version: string;
}) {
  const group = groupOfPanel(props.activePanel);
  const phone = useLayout() === 'phone';
  const buttons = (tab: boolean) => (
    <>
      <RailButton tab={tab} icon="map" label="Map" active={props.activePanel === null} onClick={() => props.onOpen(null)} title="Close panels and show the map" />
      <RailButton
        tab={tab}
        icon="fleet"
        label="My Airline"
        active={group === 'airline'}
        onClick={() => (group === 'airline' ? props.onOpen(null) : props.onOpenGroup('airline'))}
        title={`Your airline: overview, fleet (${props.fleetCount}) and schedule`}
      />
      <RailButton
        tab={tab}
        icon="buy"
        label="Buy"
        active={group === 'buy'}
        onClick={() => (group === 'buy' ? props.onOpen(null) : props.onOpenGroup('buy'))}
        title="Buy or lease aircraft, and buy hubs at airports"
      />
      <RailButton
        tab={tab}
        icon="bank"
        label="Bank"
        active={props.activePanel === 'bank'}
        onClick={() => props.onOpen(props.activePanel === 'bank' ? null : 'bank')}
        title="Loans, milestones and letters from the bank"
        badge={props.bankBadge}
      />
      {!tab && <span aria-hidden style={{ width: 1, alignSelf: 'stretch', margin: '10px 4px', background: C.line }} />}
      {/* On a phone Save lives in the menu (the career autosaves anyway) */}
      {!tab && <RailButton icon="save" label="Save" onClick={props.onSave} title="Save career now (it also autosaves every minute)" />}
      {/* Menu goes back out of the career: set apart with its own divider */}
      {!tab && <span aria-hidden style={{ width: 2, alignSelf: 'stretch', margin: '8px 5px', borderRadius: 1, background: C.border }} />}
      <RailButton
        tab={tab}
        icon="exit"
        label="Menu"
        onClick={props.onMenu}
        title={`Main menu: save, export or leave to the home screen (Boarding Pass ${props.version}${IS_DEV ? ' dev' : ''})`}
      />
    </>
  );
  if (phone) {
    // Bottom tab bar: every section and the menu one tap away, nothing hidden off the edge
    return (
      <nav
        aria-label="Main"
        className="bp-tabbar bp-glass"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 'var(--bp-bottom-h)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          borderRadius: 0,
          borderWidth: '1px 0 0 0',
          display: 'flex',
          zIndex: 45,
        }}
      >
        {buttons(true)}
      </nav>
    );
  }
  // Desktop and tablet: a floating toolbar along the bottom of the map
  return (
    <nav
      aria-label="Main"
      className="bp-dock"
      style={{
        ...glass(),
        position: 'absolute',
        left: '50%',
        bottom: 12,
        transform: 'translateX(-50%)',
        maxWidth: 'calc(100vw - 20px)',
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: 4,
        borderRadius: 16,
        zIndex: 45,
      }}
    >
      {buttons(false)}
    </nav>
  );
}

// ----------------------------------------------------------------------------
// Map layers menu
// ----------------------------------------------------------------------------
function Switch({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '6px 0' }}>
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', fontSize: 14, color: C.text }}>{label}</span>
        {hint && <span style={{ display: 'block', fontSize: 11.5, color: C.faint }}>{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        style={{
          width: 34,
          height: 20,
          borderRadius: 999,
          border: 'none',
          padding: 2,
          cursor: 'pointer',
          background: on ? C.brand : C.border,
          display: 'flex',
          justifyContent: on ? 'flex-end' : 'flex-start',
        }}
      >
        <span style={{ width: 16, height: 16, borderRadius: 999, background: on ? C.brandInk : C.textDim }} />
      </button>
    </label>
  );
}

/** Small section heading inside the layers menu. */
function MenuSection({ title, aside, children, first }: { title: string; aside?: React.ReactNode; children: React.ReactNode; first?: boolean }) {
  return (
    <div style={{ borderTop: first ? 'none' : `1px solid ${C.line}`, paddingTop: first ? 2 : 10, marginTop: first ? 0 : 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontFamily: DISPLAY, fontSize: 15.5, fontWeight: 700, color: C.textSoft }}>{title}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

export function LayersMenu(props: {
  mapStyle: MapStyleChoice;
  onMapStyle: (v: MapStyleChoice) => void;
  globe: boolean;
  onGlobe: (v: boolean) => void;
  threeD: boolean;
  onThreeD: (v: boolean) => void;
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

  const activeCount =
    Number(props.threeD) +
    Number(props.showAllRoutes) +
    Number(props.showWeather) +
    Number(props.showApproaches) +
    Number(props.showNavaids) +
    Number(props.aiAvailable && props.aiDensity !== 'off');

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-expanded={open}
        aria-label="Map layers"
        data-tour="layers"
        onClick={() => setOpen((v) => !v)}
        style={{
          ...(phone
            ? { background: open ? C.raised : 'transparent', border: `1px solid ${open ? C.border : C.line}`, padding: '6px 12px', borderRadius: 9 }
            : { background: open ? C.raised : 'transparent', border: `1px solid ${open ? C.border : 'transparent'}`, height: 42, padding: '0 14px', borderRadius: 10 }),
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          fontFamily: DISPLAY,
          fontSize: 17,
          fontWeight: 600,
          color: open ? C.text : C.textSoft,
        }}
      >
        <Icon name="layers" size={18} color={open ? C.brand : 'currentColor'} />
        {/* On a phone just the icon, so the money readouts get the room */}
        {!phone && 'Map layers'}
        {activeCount > 0 && (
          <span className="num" style={{ fontSize: 13, background: C.brand, color: C.brandInk, borderRadius: 999, padding: '0 6px', lineHeight: '18px', fontWeight: 700 }}>
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Map layers"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            width: 'min(330px, calc(100vw - 16px))',
            // Never taller than the window: the rest scrolls
            maxHeight: 'calc(100dvh - var(--bp-top-h) - var(--bp-bottom-h) - 16px)',
            overscrollBehavior: 'contain',
            overflowY: 'auto',
            ...glass('f0'),
            borderRadius: 14,
            padding: '12px 14px 14px',
            zIndex: 60,
          }}
        >
          <MenuSection
            title="Map"
            first
            aside={
              <button type="button" onClick={() => { setOpen(false); openAppearance(); }} title="Theme and colours of the game" style={{ background: 'none', border: 'none', color: C.accent, fontSize: 11.5, cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span aria-hidden style={{ width: 10, height: 10, borderRadius: '50%', background: C.brand, boxShadow: `0 0 0 1.5px ${C.fleet}` }} />
                Appearance
              </button>
            }
          >
            <Segmented<MapStyleChoice>
              size="sm"
              block
              value={props.mapStyle}
              onChange={props.onMapStyle}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
                { value: 'satellite', label: 'Satellite', title: 'Satellite imagery (Esri World Imagery)' },
              ]}
            />
            {props.globeAvailable ? (
              <Switch on={props.globe} onChange={props.onGlobe} label="Globe" hint="The earth as a globe when zoomed out" />
            ) : (
              <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8 }}>Globe view needs the newer map engine, which didn't load.</div>
            )}
            <Switch
              on={props.threeD}
              onChange={props.onThreeD}
              label="3D aircraft"
              hint={`Tilted view with aircraft at their altitude. ${TILT_HINT}; ${HEIGHT_HINT}.`}
            />
            {props.threeD && (
              <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2 }}>
                Heights are 6× real at every zoom, so cruise levels stand apart. Zoomed in close, cruising aircraft pass above the camera. Up to 3,000 other airlines' aircraft are drawn in 3D.
              </div>
            )}
          </MenuSection>

          <MenuSection title="On the map">
            <Switch on={props.showAllRoutes} onChange={props.onShowAllRoutes} label="All route lines" hint="Every route you fly" />
            <Switch on={props.showWeather} onChange={props.onShowWeather} label="Weather" hint="VFR, MVFR or IFR tag above each airport, updated hourly" />
            <Switch on={props.showApproaches} onChange={props.onShowApproaches} label="Approaches" hint="ILS cones on the runways in use, coloured by flight conditions" />
            <Switch on={props.showNavaids} onChange={props.onShowNavaids} label="Navaids" hint="VOR and DME beacons with their frequencies" />
          </MenuSection>

          <MenuSection
            title="Other airlines"
            aside={
              props.aiAvailable && props.aiDensity !== 'off' ? (
                <span className="num" style={{ fontSize: 11.5, color: C.muted }}>
                  {props.aiAirborne.toLocaleString()} in the air
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
                  { value: 'low', label: 'Light', title: 'About a quarter of flights' },
                  { value: 'medium', label: 'Normal', title: 'About half of flights' },
                  { value: 'high', label: 'All' },
                ]}
              />
            ) : (
              <div style={{ fontSize: 11.5, color: C.faint }}>{props.aiStatus}</div>
            )}
            {props.aiAvailable && props.aiNote && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>{props.aiNote}</div>}

            {props.aiAvailable && props.aiDensity !== 'off' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '12px 0 6px' }}>
                  <span style={{ fontSize: 13, color: C.text }}>Detail level</span>
                  <span className="num" style={{ fontSize: 11.5, color: C.muted }} title="Aircraft drawn in view right now">
                    {props.aiDrawn.toLocaleString()} drawn
                    {Number.isFinite(props.aiBudget) ? `, limit ${props.aiBudget.toLocaleString()}` : ''}
                  </span>
                </div>
                <Segmented<AiDetailLevel>
                  size="sm"
                  block
                  value={props.aiDetail}
                  onChange={props.onAiDetail}
                  options={[
                    { value: 'auto', label: 'Auto', title: 'Adjusts to how smoothly the map is running' },
                    { value: 'low', label: 'Low', title: 'Up to 600 aircraft, dots when zoomed out' },
                    { value: 'medium', label: 'Med', title: 'Up to 1,500 aircraft' },
                    { value: 'high', label: 'High', title: 'Up to 3,000 aircraft' },
                    { value: 'max', label: 'Max', title: 'Up to 5,000 aircraft' },
                    { value: 'extreme', label: 'Extreme', title: 'Up to 10,000 aircraft (very demanding)' },
                  ]}
                />
                {props.aiDetail === 'extreme' ? (
                  <div
                    role="alert"
                    style={{
                      display: 'flex',
                      gap: 8,
                      marginTop: 8,
                      padding: '8px 10px',
                      borderRadius: 7,
                      background: `${C.amber}17`,
                      border: `1px solid ${C.amberStrong}66`,
                      color: C.amber,
                      fontSize: 11.5,
                      lineHeight: 1.45,
                    }}
                  >
                    <Icon name="warning" size={15} />
                    <span>
                      <b>High performance use.</b> Up to 10,000 aircraft at once can make the map stutter, run your fans loud and drain a laptop battery. Choose Max or Auto if the map gets slow.
                    </span>
                  </div>
                ) : (
                  <div style={{ fontSize: 11.5, color: C.faint, marginTop: 6, lineHeight: 1.4 }}>
                    {props.aiDetail === 'auto'
                      ? 'Draws fewer aircraft when the map slows down. Zoom in to see more.'
                      : props.aiDetail === 'max'
                      ? 'Up to 5,000 aircraft in view. Can be slow on older computers.'
                      : 'A sample when zoomed out, more detail as you zoom in. Your own aircraft are always shown.'}
                  </div>
                )}
              </>
            )}
          </MenuSection>

          <MenuSection
            title="Aircraft icon size"
            aside={
              <button
                type="button"
                onClick={() => props.onPlaneIconScale(0.85)}
                style={{ background: 'none', border: 'none', color: C.muted, fontSize: 12, cursor: 'pointer', padding: 0 }}
              >
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
              aria-label="Aircraft icon size"
              onChange={(e) => props.onPlaneIconScale(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.brand, cursor: 'pointer' }}
            />
          </MenuSection>
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.line}`, fontSize: 11.5, color: C.faint, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>Maps © CARTO, © OpenStreetMap contributors{props.mapStyle === 'satellite' ? ', EOxCloudless' : ''}</span>
            <button type="button" onClick={() => setCredits(true)} style={{ background: 'none', border: 'none', color: C.accent, fontSize: 11.5, cursor: 'pointer', padding: 0, whiteSpace: 'nowrap' }}>
              Credits
            </button>
          </div>
        </div>
      )}
      {credits && <CreditsModal onClose={() => setCredits(false)} />}
    </div>
  );
}
