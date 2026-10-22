// ============================================================================
// BANKRUPTCY SETTLEMENT
//   Shown when the bank has declared the airline insolvent (two weeks in a row
//   closed overdrawn). An airline with 10 or more aircraft sells half its fleet
//   (the bank proposes which; the player can change the picks) and every debt
//   is cleared. A smaller airline is offered a bail-out: debts cleared, no new
//   loans for 48 real hours. "Decide later" closes it; the top bar reopens it.
// ============================================================================
import type React from 'react';
import { useMemo, useState } from 'react';
import {
  BAILOUT_FLEET_LIMIT,
  BAILOUT_LOAN_LOCK_MIN,
  BANK,
  BANKRUPTCY_SURCHARGE_WEEKS,
  bankruptcyRoute,
  proposedSales,
  sellHalfCount,
  settlementTerms,
  bailoutSeizures,
  usdShort,
  type BankruptcyRoute,
} from '../game/career';
import { ECONOMY_RATE } from '../game/clock';
import { calcAircraftResaleUsd } from '../game/tiers';
import type { CareerState, PlayerAircraft } from '../game/types';
import { Button, C, ModalShell } from '../ui/kit';

export function BankruptcyModal(props: {
  career: CareerState;
  fleet: PlayerAircraft[];
  cash: number;
  weeklyProfitByTail: Map<string, number>;
  scheduledTails: Set<string>;
  onSettle: (route: BankruptcyRoute, sellTails: string[]) => void;
  onLater: () => void;
}) {
  const { career, fleet, cash } = props;
  const route = bankruptcyRoute(fleet);
  const need = sellHalfCount(fleet);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(proposedSales(fleet, props.weeklyProfitByTail, props.scheduledTails)));
  const seized = useMemo(() => (route === 'bailout' ? bailoutSeizures(career, cash, fleet, (a) => calcAircraftResaleUsd(a.model)) : []), [route, career, cash, fleet]);
  const proceeds = useMemo(() => {
    const sold = route === 'bailout' ? new Set(seized) : picked;
    return fleet.reduce((s, a) => s + (sold.has(a.tailNumber) && a.acquisition === 'owned' ? calcAircraftResaleUsd(a.model) : 0), 0);
  }, [fleet, picked, route, seized]);
  const t = settlementTerms(career, cash, route, proceeds);
  const lockHours = Math.round(BAILOUT_LOAN_LOCK_MIN / ECONOMY_RATE.normal / 3600);
  const toggle = (tail: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(tail)) n.delete(tail);
      else n.add(tail);
      return n;
    });
  const enough = picked.size >= need;

  return (
    <ModalShell maxWidth={720} zIndex={320} onClose={props.onLater}>
      <div className="bp-bankruptcy">
        <div style={{ fontSize: 12, color: C.red, fontWeight: 650 }}>{BANK.name}</div>
        <h2 style={{ margin: '2px 0 6px', fontSize: 21, color: C.text }}>Your airline is insolvent</h2>
        <p style={{ margin: 0, fontSize: 13.5, color: C.textDim, lineHeight: 1.5 }}>
          Your account closed two weeks in a row overdrawn, so the bank has stepped in. Settle to clear every debt and carry on flying.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, margin: '16px 0' }}>
          <Figure label="Cash" value={usdShort(cash)} bad={cash < 0} />
          <Figure label="Owed on loans" value={usdShort(t.loans)} />
          <Figure label="Total debt" value={usdShort(t.loans + t.overdraft)} bad />
        </div>

        {route === 'sell-half' ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 650, color: C.text }}>Sell half your fleet</div>
            <div style={{ fontSize: 12.5, color: C.muted, margin: '3px 0 8px', lineHeight: 1.45 }}>
              With {fleet.length} aircraft ({BAILOUT_FLEET_LIMIT} or more), the bank sells at least {need} of them. It has picked the ones earning least; change the picks
              if you like. Leased aircraft go back to the lessor and fetch nothing. Their flights are cancelled.
            </div>
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, maxHeight: 260, overflowY: 'auto' }}>
              {[...fleet]
                .sort((a, b) => Number(picked.has(b.tailNumber)) - Number(picked.has(a.tailNumber)) || a.tailNumber.localeCompare(b.tailNumber))
                .map((a, i) => {
                  const on = picked.has(a.tailNumber);
                  const wk = props.weeklyProfitByTail.get(a.tailNumber);
                  return (
                    <label
                      key={a.tailNumber}
                      className="bp-row"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '22px 90px 1fr 120px 120px',
                        gap: 10,
                        alignItems: 'center',
                        padding: '7px 10px',
                        borderTop: i ? `1px solid ${C.line}` : 'none',
                        cursor: 'pointer',
                        fontSize: 12.5,
                        color: on ? C.text : C.textDim,
                      }}
                    >
                      <input type="checkbox" checked={on} onChange={() => toggle(a.tailNumber)} aria-label={`Sell ${a.tailNumber}`} />
                      <b>{a.tailNumber}</b>
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.model.name}</span>
                      <span className="num" style={{ color: C.muted }}>
                        {props.scheduledTails.has(a.tailNumber) ? `${wk && wk < 0 ? '−' : '+'}${usdShort(Math.abs(wk ?? 0))}/wk` : 'No flights'}
                      </span>
                      <span className="num" style={{ textAlign: 'right' }}>
                        {a.acquisition === 'owned' ? usdShort(calcAircraftResaleUsd(a.model)) : 'Leased: returned'}
                      </span>
                    </label>
                  );
                })}
            </div>
            <Terms>
              <Line k={`${picked.size} aircraft sold for`} v={usdShort(t.proceeds)} />
              <Line k="Pays off loans and overdraft" v={usdShort(Math.min(t.loans + t.overdraft, t.proceeds + Math.max(0, cash)))} />
              {t.writtenOff > 0 && <Line k="Written off by the bank" v={usdShort(t.writtenOff)} />}
              <Line k="Your cash afterwards" v={usdShort(t.cashAfter)} strong />
            </Terms>
          </>
        ) : (
          <>
            <div style={{ fontSize: 14, fontWeight: 650, color: C.text }}>Bank bail-out</div>
            <div style={{ fontSize: 12.5, color: C.muted, margin: '3px 0 0', lineHeight: 1.45 }}>
              With {fleet.length} aircraft (under {BAILOUT_FLEET_LIMIT}), the bank bails you out.{' '}
              {seized.length
                ? `It takes the aircraft you own to cover what it can (${seized.join(', ')}); leased aircraft stay with you.`
                : 'You own no aircraft it can take, so you keep your fleet.'}
            </div>
            <Terms>
              {seized.length > 0 && <Line k={`${seized.length} aircraft taken and sold for`} v={usdShort(t.proceeds)} />}
              <Line k="Debt the bank writes off" v={usdShort(t.writtenOff)} />
              <Line k="Your cash afterwards" v={usdShort(t.cashAfter)} strong />
              <Line k="New loans" v={`none for ${lockHours} hours (2 game weeks)`} />
            </Terms>
          </>
        )}
        <div style={{ fontSize: 12, color: C.faint, marginTop: 10, lineHeight: 1.45 }}>
          Afterwards new loans cost 2% more for {BANKRUPTCY_SURCHARGE_WEEKS} weeks. Until you settle, the bank lends nothing.
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
          <Button variant="ghost" onClick={props.onLater}>
            Decide later
          </Button>
          <span style={{ flex: 1, fontSize: 12, color: enough || route === 'bailout' ? C.faint : C.amber, textAlign: 'right' }}>
            {route === 'sell-half' && !enough ? `Pick at least ${need} aircraft (${picked.size} picked).` : ''}
          </span>
          {route === 'sell-half' ? (
            <Button variant="primary" disabled={!enough} onClick={() => props.onSettle('sell-half', [...picked])}>
              Sell {picked.size} aircraft and clear all debts
            </Button>
          ) : (
            <Button variant="primary" onClick={() => props.onSettle('bailout', [])}>
              Accept the bail-out
            </Button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function Figure({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div style={{ padding: '9px 11px', border: `1px solid ${C.line}`, borderRadius: 8, background: C.panelAlt }}>
      <div style={{ fontSize: 11.5, color: C.muted }}>{label}</div>
      <div className="num" style={{ fontSize: 17, fontWeight: 650, color: bad ? C.red : C.text }}>
        {value}
      </div>
    </div>
  );
}

function Terms({ children }: { children: React.ReactNode }) {
  return <div style={{ marginTop: 12, padding: '10px 12px', border: `1px solid ${C.line}`, borderRadius: 8, display: 'grid', gap: 4 }}>{children}</div>;
}

function Line({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="num" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: strong ? C.text : C.textDim, fontWeight: strong ? 650 : 500 }}>
      <span>{k}</span>
      <span>{v}</span>
    </div>
  );
}
