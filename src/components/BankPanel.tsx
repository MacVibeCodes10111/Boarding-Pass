import { useEffect, useMemo, useState } from 'react';
import {
  BANK,
  GOALS,
  LOAN_PRODUCTS,
  MAX_ACTIVE_LOANS,
  MIN_LOAN,
  STAGES,
  STANDINGS,
  activeLoans,
  availableCredit,
  borrowBlocker,
  creditLine,
  currentStage,
  econDateText,
  goalDone,
  goalProgressText,
  goalValue,
  goalsOfStage,
  loanOutstanding,
  loanRatePct,
  loanTerms,
  nextGoal,
  productById,
  standingIndex,
  totalOutstanding,
  uncollected,
  usdFull,
  usdShort,
  weeklyInstalments,
  type CareerMetrics,
  type GoalDef,
} from '../game/career';
import { econWeekOf } from '../game/clock';
import type { BankLetter, CareerState, GameMode, PlayerAircraft } from '../game/types';
import { Icon } from '../ui/icons';
import { Button, C, EmptyState, Meter, RAIL_W, Segmented, SidePanel, Stat, inputStyle } from '../ui/kit';

type Tab = 'programme' | 'loans' | 'letters';

export interface BankPanelProps {
  career: CareerState;
  metrics: CareerMetrics;
  fleet: PlayerAircraft[];
  cash: number;
  gameMode: GameMode;
  econMin: number;
  initialTab?: Tab;
  onTakeLoan: (productId: string, amount: number) => void;
  onRepay: (loanId: string) => void;
  onCollect: (letterId: string) => void;
  onRead: (letterId: string) => void;
  onClose: () => void;
}

// Bank stationery: the one place the game steps out of the ops-console look
const PAPER = '#eef1f5';
const INK = '#18233a';
const INK_SOFT = '#4a5873';
const RULE = '#c9d1de';
const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif";

export function BankPanel(props: BankPanelProps) {
  const { career, metrics, fleet, cash, gameMode, econMin } = props;
  const [tab, setTab] = useState<Tab>(props.initialTab ?? 'programme');
  const career_ = gameMode === 'standard';
  const standing = STANDINGS[standingIndex(career)];
  const line = creditLine(career, fleet);
  const owed = totalOutstanding(career);
  const toCollect = uncollected(career).length;
  const unreadCount = career.letters.filter((l) => !l.read).length;

  return (
    <SidePanel
      title={BANK.name}
      subtitle={career_ ? `${BANK.division}. Your standing: ${standing.label}` : `${BANK.programme}. Grants and loans are part of Career mode.`}
      width={840}
      onClose={props.onClose}
    >
      {career_ && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 12,
            padding: '12px 14px',
            border: `1px solid ${C.line}`,
            borderRadius: 8,
            marginBottom: 14,
            background: C.panelAlt,
          }}
        >
          <Stat label="Standing" value={standing.label} sub={`Rates from ${standing.ratePct}%`} />
          <Stat label="Credit line" value={usdShort(line)} />
          <Stat label="Borrowed" value={usdShort(owed)} sub={`${activeLoans(career).length} of ${MAX_ACTIVE_LOANS} loans`} />
          <Stat label="Available" value={usdShort(availableCredit(career, fleet))} />
          <Stat label="Instalments" value={`${usdShort(weeklyInstalments(career))}`} sub="per week" />
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'programme', label: toCollect ? `Milestones (${toCollect} to collect)` : 'Milestones' },
            { value: 'loans', label: 'Loans' },
            { value: 'letters', label: unreadCount ? `Letters (${unreadCount} new)` : 'Letters' },
          ]}
        />
      </div>

      {tab === 'programme' && <Programme {...props} />}
      {tab === 'loans' &&
        (career_ ? (
          <Loans {...props} />
        ) : (
          <EmptyState title="Loans are for Career airlines" body="Sandbox airlines have unlimited money, so the bank has nothing to lend. Start a Career airline to borrow." />
        ))}
      {tab === 'letters' && <Letters {...props} />}
      <div style={{ fontSize: 11.5, color: C.faint, marginTop: 16 }}>
        {career_ ? `Cash ${usdShort(cash)}. ${econDateText(econMin)}.` : `Progress is tracked here for fun. ${GOALS.length} milestones in ${STAGES.length} stages.`}
        {metrics.aircraft === 0 && career_ ? ' Start with the first milestone: buy an aircraft.' : ''}
      </div>
    </SidePanel>
  );
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------
function Programme({ career, metrics, gameMode, onCollect }: BankPanelProps) {
  const open = currentStage(career);
  const [toggled, setToggled] = useState<Record<number, boolean>>({});
  const letterFor = (pred: (l: BankLetter) => boolean) => career.letters.find(pred);

  return (
    <div>
      {STAGES.map((st) => {
        const goals = goalsOfStage(st.stage);
        const met = goals.filter((g) => career.goalsMet.includes(g.id)).length;
        const done = career.stagesMet.includes(st.stage);
        const isOpen = open?.stage === st.stage;
        const locked = !done && !isOpen && (open ? st.stage > open.stage : false);
        const show = toggled[st.stage] ?? Boolean(isOpen || (open && st.stage === open.stage + 1));
        const stageLetter = letterFor((l) => l.kind === 'standing' && l.stage === st.stage);
        return (
          <section key={st.stage} style={{ marginBottom: 14 }}>
            <button
              type="button"
              onClick={() => setToggled((t) => ({ ...t, [st.stage]: !show }))}
              aria-expanded={Boolean(show)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 2px',
                background: 'none',
                border: 'none',
                color: C.text,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <Icon name="chevron" size={14} color={C.muted} style={{ transform: show ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }} />
              <span style={{ fontSize: 14, fontWeight: 650, color: locked ? C.muted : C.text }}>
                Stage {st.stage}: {st.name}
              </span>
              {done && <Icon name="check" size={15} color={C.green} />}
              <span style={{ flex: 1 }} />
              <span className="num" style={{ fontSize: 12, color: C.muted }}>
                {met} of {goals.length} met. Stage bonus {usdShort(st.bonus)}
              </span>
              {stageLetter && !stageLetter.collected && gameMode === 'standard' && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCollect(stageLetter.id);
                  }}
                >
                  Collect {usdShort(st.bonus)}
                </Button>
              )}
            </button>
            {locked && !show && (
              <div style={{ fontSize: 12, color: C.faint, padding: '0 0 0 26px' }}>
                Opens when stage {st.stage - 1} is complete. Progress already counts.
              </div>
            )}
            {show && (
              <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden' }}>
                {goals.map((g, i) => (
                  <GoalRow
                    key={g.id}
                    goal={g}
                    metrics={metrics}
                    first={i === 0}
                    met={career.goalsMet.includes(g.id)}
                    letter={letterFor((l) => l.goalId === g.id)}
                    canCollect={gameMode === 'standard'}
                    onCollect={onCollect}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function GoalRow({
  goal,
  metrics,
  first,
  met,
  letter,
  canCollect,
  onCollect,
}: {
  goal: GoalDef;
  metrics: CareerMetrics;
  first: boolean;
  met: boolean;
  letter?: BankLetter;
  canCollect: boolean;
  onCollect: (id: string) => void;
}) {
  const doneNow = met || goalDone(goal, metrics);
  const pct = Math.max(0, Math.min(100, (goalValue(goal, metrics) / goal.target) * 100));
  return (
    <div
      className="bp-row"
      style={{
        display: 'grid',
        gridTemplateColumns: '22px 1fr 170px 120px',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        borderTop: first ? 'none' : `1px solid ${C.line}`,
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 999,
          display: 'grid',
          placeItems: 'center',
          border: `1.5px solid ${doneNow ? C.green : C.border}`,
          background: doneNow ? 'rgba(62,207,142,0.14)' : 'transparent',
        }}
      >
        {doneNow && <Icon name="check" size={12} color={C.green} />}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: doneNow ? C.textSoft : C.text }}>{goal.title}</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{goal.hint}</div>
      </div>
      <div>
        <div className="num" style={{ fontSize: 11.5, color: C.muted, marginBottom: 4 }}>
          {goalProgressText(goal, metrics)}
        </div>
        <Meter pct={met ? 100 : pct} gradient={met ? C.green : C.accent} height={4} />
      </div>
      <div style={{ textAlign: 'right' }}>
        {letter && !letter.collected && canCollect ? (
          <Button size="sm" variant="primary" onClick={() => onCollect(letter.id)}>
            Collect {usdShort(goal.reward)}
          </Button>
        ) : letter?.collected ? (
          <span className="num" style={{ fontSize: 12, color: C.green }}>
            {usdShort(goal.reward)} collected
          </span>
        ) : (
          <span className="num" style={{ fontSize: 13, fontWeight: 600, color: C.textDim }}>
            {usdShort(goal.reward)}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loans
// ---------------------------------------------------------------------------
function Loans({ career, fleet, cash, econMin, onTakeLoan, onRepay }: BankPanelProps) {
  const [productId, setProductId] = useState('fleet');
  const avail = availableCredit(career, fleet);
  const [amountM, setAmountM] = useState(() => Math.max(5, Math.floor(Math.min(avail, 50_000_000) / 1e6)));
  const product = productById(productId);
  const amount = amountM * 1e6;
  const rate = loanRatePct(career, product, econMin);
  const terms = loanTerms(amount, rate, product.termWeeks);
  const blocker = borrowBlocker(career, fleet, cash, amount);
  const loans = activeLoans(career);
  const week = econWeekOf(econMin);

  return (
    <div>
      {loans.length > 0 && (
        <section style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 650, marginBottom: 8 }}>Your loans</div>
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden' }}>
            {loans.map((l, i) => {
              const owed = loanOutstanding(l);
              const weeksLeft = Math.ceil((l.totalRepayable - l.paid) / l.weeklyPayment);
              return (
                <div
                  key={l.id}
                  style={{ display: 'grid', gridTemplateColumns: '1fr 180px 150px', gap: 14, alignItems: 'center', padding: '10px 12px', borderTop: i ? `1px solid ${C.line}` : 'none' }}
                >
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                      {productById(l.product).name} <span style={{ color: C.muted, fontWeight: 500 }}>{l.ref}</span>
                    </div>
                    <div className="num" style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                      {usdShort(l.principal)} at {l.ratePct}%, {usdShort(l.weeklyPayment)} a week, {weeksLeft} {weeksLeft === 1 ? 'week' : 'weeks'} left
                    </div>
                  </div>
                  <div>
                    <div className="num" style={{ fontSize: 11.5, color: C.muted, marginBottom: 4 }}>
                      {usdShort(l.paid)} of {usdShort(l.totalRepayable)} repaid
                    </div>
                    <Meter pct={(l.paid / l.totalRepayable) * 100} gradient={C.accent} height={4} />
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <Button size="sm" disabled={cash < owed} title={cash < owed ? 'Not enough cash to settle now' : 'No charge for early repayment'} onClick={() => onRepay(l.id)}>
                      Repay {usdShort(owed)}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div style={{ fontSize: 14, fontWeight: 650, marginBottom: 8 }}>Apply for a loan</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
        {LOAN_PRODUCTS.map((p) => {
          const on = p.id === productId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setProductId(p.id)}
              aria-pressed={on}
              style={{
                textAlign: 'left',
                padding: '10px 12px',
                borderRadius: 8,
                cursor: 'pointer',
                background: on ? C.raised : 'transparent',
                border: `1px solid ${on ? C.brand : C.line}`,
                color: C.text,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 650 }}>{p.name}</div>
              <div className="num" style={{ fontSize: 12, color: C.textDim, margin: '2px 0 4px' }}>
                {p.termWeeks} weeks, {loanRatePct(career, p, econMin)}%
              </div>
              <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.35 }}>{p.blurb}</div>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: 14, border: `1px solid ${C.line}`, borderRadius: 8 }}>
        <div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Amount (you can borrow up to {usdShort(avail)})</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: C.muted }}>$</span>
            <input
              type="number"
              min={MIN_LOAN / 1e6}
              step={1}
              value={amountM}
              aria-label="Loan amount in millions"
              onChange={(e) => setAmountM(Math.max(0, Math.round(Number(e.target.value) || 0)))}
              style={{ ...inputStyle, width: 110, fontWeight: 650 }}
            />
            <span style={{ color: C.muted }}>million</span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {[0.25, 0.5, 1].map((f) => (
              <Button key={f} size="sm" variant="ghost" disabled={avail < MIN_LOAN} onClick={() => setAmountM(Math.max(5, Math.floor((avail * f) / 1e6)))}>
                {f === 1 ? 'Maximum' : `${f * 100}%`}
              </Button>
            ))}
          </div>
        </div>
        <div className="num" style={{ fontSize: 12.5, color: C.textDim, lineHeight: 1.7 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Weekly instalment</span>
            <b style={{ color: C.text }}>{usdFull(terms.weeklyPayment)}</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Interest over {product.termWeeks} weeks</span>
            <span>{usdFull(terms.interest)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Total repayable</span>
            <span>{usdFull(terms.totalRepayable)}</span>
          </div>
          {week <= career.surchargeUntilWeek && (
            <div style={{ color: C.amber, fontSize: 11.5 }}>Includes a 2% overdraft surcharge until week {career.surchargeUntilWeek}.</div>
          )}
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button variant="primary" disabled={Boolean(blocker)} onClick={() => onTakeLoan(product.id, amount)}>
            Borrow {usdShort(amount)}
          </Button>
          <span style={{ fontSize: 12, color: blocker ? C.amber : C.faint }}>
            {blocker ?? 'Paid into your account straight away. Instalments come out as the week runs.'}
          </span>
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: C.faint, marginTop: 10, lineHeight: 1.5 }}>
        Your credit line grows as your standing rises and with the aircraft you own outright. If a week closes with your account below zero, new borrowing stops until you are back in credit and new loans cost 2% more for four weeks.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Letters
// ---------------------------------------------------------------------------
function Letters({ career, gameMode, onCollect, onRead }: BankPanelProps) {
  const [openId, setOpenId] = useState<string | null>(() => career.letters[0]?.id ?? null);
  const letter = useMemo(() => career.letters.find((l) => l.id === openId) ?? career.letters[0] ?? null, [career.letters, openId]);
  // Opening a letter marks it read
  const shownId = letter?.id;
  const shownUnread = letter ? !letter.read : false;
  useEffect(() => {
    if (shownId && shownUnread) onRead(shownId);
  }, [shownId, shownUnread, onRead]);
  if (career.letters.length === 0) {
    return (
      <EmptyState
        title="No letters yet"
        body={gameMode === 'standard' ? 'Letters from the bank arrive here when you meet a milestone or take out a loan.' : 'The bank writes to Career airlines only.'}
      />
    );
  }
  const open = (id: string) => setOpenId(id);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 14, alignItems: 'start' }}>
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden', maxHeight: 560, overflowY: 'auto' }}>
        {career.letters.map((l, i) => {
          const sel = l.id === letter?.id;
          return (
            <button
              key={l.id}
              type="button"
              className="bp-row"
              onClick={() => open(l.id)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '9px 12px',
                border: 'none',
                borderTop: i ? `1px solid ${C.line}` : 'none',
                borderLeft: `3px solid ${sel ? C.brand : 'transparent'}`,
                background: sel ? C.raised : 'transparent',
                color: C.text,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {!l.read && <span aria-label="Unread" style={{ width: 7, height: 7, borderRadius: 999, background: C.brand, flex: 'none' }} />}
                <span style={{ fontSize: 12.5, fontWeight: l.read ? 500 : 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.subject}</span>
              </div>
              <div className="num" style={{ fontSize: 11.5, color: C.faint, marginTop: 2 }}>
                {econDateText(l.econMin)}
                {l.reward ? (l.collected ? `, ${usdShort(l.reward)} collected` : `, ${usdShort(l.reward)} to collect`) : ''}
              </div>
            </button>
          );
        })}
      </div>
      {letter && <LetterSheet letter={letter} canCollect={gameMode === 'standard'} onCollect={onCollect} />}
    </div>
  );
}

function LetterSheet({ letter, canCollect, onCollect }: { letter: BankLetter; canCollect: boolean; onCollect: (id: string) => void }) {
  return (
    <article
      style={{
        background: PAPER,
        color: INK,
        borderRadius: 4,
        padding: '26px 30px 24px',
        fontFamily: SERIF,
        fontSize: 14.5,
        lineHeight: 1.6,
        boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', borderBottom: `1px solid ${RULE}`, paddingBottom: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="bank" size={26} color={INK} />
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '0.04em', fontVariant: 'small-caps' }}>{BANK.name}</div>
            <div style={{ fontSize: 12, color: INK_SOFT }}>{BANK.division}</div>
          </div>
        </div>
        <div className="num" style={{ fontSize: 12, color: INK_SOFT, textAlign: 'right' }}>{econDateText(letter.econMin)}</div>
      </header>
      <div style={{ fontWeight: 700, marginBottom: 12 }}>{letter.subject}</div>
      {letter.body.map((p, i) => (
        <p key={i} style={{ margin: '0 0 10px', whiteSpace: 'pre-line' }}>
          {p}
        </p>
      ))}
      {letter.reward ? (
        <div
          style={{
            marginTop: 16,
            paddingTop: 12,
            borderTop: `1px solid ${RULE}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontFamily: 'inherit',
          }}
        >
          <span className="num" style={{ fontSize: 13, color: INK_SOFT }}>
            {letter.kind === 'standing' ? 'Stage completion bonus' : 'Performance grant'}: <b style={{ color: INK }}>{usdFull(letter.reward)}</b>
          </span>
          {letter.collected ? (
            <span style={{ fontSize: 13, color: '#1f7a52', fontFamily: 'system-ui, sans-serif', fontWeight: 600 }}>Paid into your account</span>
          ) : canCollect ? (
            <Button variant="primary" onClick={() => onCollect(letter.id)}>
              Collect {usdShort(letter.reward)}
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Next milestone card on the map
// ---------------------------------------------------------------------------
export function MilestoneCard({
  career,
  metrics,
  onOpen,
  onHide,
}: {
  career: CareerState;
  metrics: CareerMetrics;
  onOpen: () => void;
  onHide: () => void;
}) {
  const goal = nextGoal(career);
  const ready = uncollected(career);
  if (!goal && ready.length === 0) return null;
  const pct = goal ? Math.max(0, Math.min(100, (goalValue(goal, metrics) / goal.target) * 100)) : 100;
  return (
    <div
      style={{
        position: 'absolute',
        left: RAIL_W + 12,
        bottom: 12,
        width: 300,
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: '10px 12px 12px',
        zIndex: 30,
        boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Icon name="flag" size={15} color={C.brand} />
        <span style={{ fontSize: 12, color: C.muted, flex: 1 }}>{goal ? `Stage ${goal.stage}: ${STAGES[goal.stage - 1].name}` : 'All milestones met'}</span>
        <button type="button" aria-label="Hide milestone card" onClick={onHide} style={{ background: 'none', border: 'none', color: C.faint, cursor: 'pointer', padding: 2 }}>
          <Icon name="close" size={14} />
        </button>
      </div>
      {goal && (
        <button type="button" onClick={onOpen} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}>
          <div style={{ fontSize: 13.5, fontWeight: 650, color: C.text }}>{goal.title}</div>
          <div style={{ fontSize: 12, color: C.muted, margin: '2px 0 8px' }}>{goal.hint}</div>
          <Meter pct={pct} gradient={C.brand} height={4} />
          <div className="num" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: C.muted, marginTop: 5 }}>
            <span>{goalProgressText(goal, metrics)}</span>
            <span>Grant {usdShort(goal.reward)}</span>
          </div>
        </button>
      )}
      {ready.length > 0 && (
        <Button size="sm" variant="primary" block onClick={onOpen} style={{ marginTop: 10 }}>
          {ready.length === 1 ? `Collect ${usdShort(ready[0].reward!)} from the bank` : `${ready.length} payments ready to collect`}
        </Button>
      )}
    </div>
  );
}
