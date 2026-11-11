import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  BANK,
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
  INSOLVENCY_WEEKS,
  MIN_PART_REPAYMENT,
  debtSummary,
  loanInterestLeft,
  loanOutstanding,
  loanRatePct,
  loanRepaidShare,
  loanStartPrincipal,
  loanTerms,
  loanWeeksLeft,
  nextGoal,
  partRepaymentPreview,
  productById,
  standingIndex,
  uncollected,
  goalsWaiting,
  usdFull,
  usdShort,
  type CareerMetrics,
  type GoalDef,
} from '../game/career';
import { OVERDRAFT_RATE_PCT, econWeekOf, type WeekLedger } from '../game/clock';
import type { BankLetter, CareerState, GameMode, PlayerAircraft } from '../game/types';
import { Icon } from '../ui/icons';
import { Button, C, EmptyState, IconButton, Meter, SectionTitle, SidePanel, Stat, inputStyle, glass, well } from '../ui/kit';

type Tab = 'programme' | 'loans' | 'letters';

export interface BankPanelProps {
  career: CareerState;
  metrics: CareerMetrics;
  fleet: PlayerAircraft[];
  cash: number;
  gameMode: GameMode;
  econMin: number;
  initialTab?: Tab;
  /** Closed weeks, for the debt chart. */
  ledgerHistory: WeekLedger[];
  onTakeLoan: (productId: string, amount: number) => void;
  onRepay: (loanId: string) => void;
  onRepayPart: (loanId: string, amount: number) => void;
  onOpenSettlement: () => void;
  onCollect: (letterId: string) => void;
  /** Collect every payment that is waiting. */
  onCollectAll: () => void;
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
  const { career, gameMode } = props;
  const [tab, setTab] = useState<Tab>(props.initialTab ?? 'programme');
  const career_ = gameMode === 'standard';
  const toCollect = career_ ? uncollected(career).length : 0;
  const unreadCount = career.letters.filter((l) => !l.read).length;

  return (
    <SidePanel
      title="Bank"
      width={840}
      onClose={props.onClose}
      tabs={{
        group: 'Bank',
        active: tab,
        onPick: (id) => setTab(id as Tab),
        tabs: [
          { id: 'programme', label: 'Milestones', badge: toCollect },
          { id: 'loans', label: 'Loans' },
          { id: 'letters', label: 'Letters', badge: unreadCount },
        ],
      }}
    >
      {tab === 'programme' && <Programme {...props} />}
      {tab === 'loans' && (career_ ? <Loans {...props} /> : <EmptyState title="Career only" body="Sandbox airlines have unlimited money." />)}
      {tab === 'letters' && <Letters {...props} />}
    </SidePanel>
  );
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------
function Programme({ career, metrics, gameMode, onCollect, onCollectAll, econMin }: BankPanelProps) {
  const waiting = goalsWaiting(career, econMin);
  const open = currentStage(career);
  const [toggled, setToggled] = useState<Record<number, boolean>>({});
  const letterFor = (pred: (l: BankLetter) => boolean) => career.letters.find(pred);
  const ready = gameMode === 'standard' ? uncollected(career) : [];

  return (
    <div>
      {ready.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 10px 10px 14px', borderRadius: 12, background: `${C.brand}1c`, marginBottom: 14 }}>
          <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{ready.length} payments ready</span>
          <Button size="sm" variant="primary" onClick={onCollectAll}>
            Collect {usdShort(ready.reduce((s, l) => s + (l.reward ?? 0), 0))}
          </Button>
        </div>
      )}
      {STAGES.map((st) => {
        const goals = goalsOfStage(st.stage);
        const met = goals.filter((g) => career.goalsMet.includes(g.id)).length;
        const done = career.stagesMet.includes(st.stage);
        const isOpen = open?.stage === st.stage;
        const locked = !done && !isOpen && (open ? st.stage > open.stage : false);
        const show = toggled[st.stage] ?? Boolean(isOpen);
        const stageLetter = letterFor((l) => l.kind === 'standing' && l.stage === st.stage);
        return (
          <section key={st.stage} style={{ marginBottom: show ? 16 : 2 }}>
            <button
              type="button"
              className="bp-group-toggle"
              onClick={() => setToggled((t) => ({ ...t, [st.stage]: !show }))}
              aria-expanded={Boolean(show)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 2px', background: 'none', border: 'none', color: locked ? C.faint : C.muted, cursor: 'pointer', textAlign: 'left' }}
            >
              <Icon name="chevron" size={13} style={{ transform: show ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }} />
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {st.stage} · {st.name}
              </span>
              {done && <Icon name="check" size={14} color={C.green} />}
              <span style={{ flex: 1 }} />
              {stageLetter && !stageLetter.collected && gameMode === 'standard' ? (
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
              ) : (
                <span className="num" style={{ fontSize: 12, color: C.faint, whiteSpace: 'nowrap' }}>
                  {met}/{goals.length} · bonus {usdShort(st.bonus)}
                </span>
              )}
            </button>
            {show && (
              <div className="bp-list">
                {goals.map((g) => (
                  <GoalRow
                    key={g.id}
                    goal={g}
                    metrics={metrics}
                    met={career.goalsMet.includes(g.id)}
                    letter={letterFor((l) => l.goalId === g.id)}
                    canCollect={gameMode === 'standard'}
                    onCollect={onCollect}
                    waitMin={locked ? undefined : waiting.get(g.id)}
                    locked={locked}
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
  met,
  letter,
  canCollect,
  onCollect,
  waitMin,
  locked,
}: {
  goal: GoalDef;
  metrics: CareerMetrics;
  met: boolean;
  letter?: BankLetter;
  canCollect: boolean;
  onCollect: (id: string) => void;
  /** Met, but waiting out its game day: game minutes left. */
  waitMin?: number;
  /** Its stage isn't open yet: met milestones pay once it is. */
  locked?: boolean;
}) {
  const doneNow = met || goalDone(goal, metrics);
  const pct = Math.max(0, Math.min(100, (goalValue(goal, metrics) / goal.target) * 100));
  return (
    <div className="bp-goal" style={{ display: 'grid', gridTemplateColumns: '22px 1fr 150px 110px', alignItems: 'center', gap: 12, padding: '10px 8px' }}>
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
        <div style={{ fontSize: 13.5, fontWeight: 600, color: doneNow ? C.textDim : C.text }}>{goal.title}</div>
        {!doneNow && <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{goal.hint}</div>}
      </div>
      <div>
        {!met && (
          <>
            <div className="num" style={{ fontSize: 11.5, color: C.muted, marginBottom: 4 }}>
              {goalProgressText(goal, metrics)}
            </div>
            <Meter pct={pct} gradient={doneNow ? C.green : C.accent} height={4} />
          </>
        )}
      </div>
      <div style={{ textAlign: 'right' }}>
        {letter && !letter.collected && canCollect ? (
          <Button size="sm" variant="primary" onClick={() => onCollect(letter.id)}>
            Collect {usdShort(goal.reward)}
          </Button>
        ) : letter?.collected ? (
          <span className="num" style={{ fontSize: 12.5, color: C.faint }}>
            {usdShort(goal.reward)} paid
          </span>
        ) : waitMin !== undefined && goalDone(goal, metrics) ? (
          <span className="num" title="Pays after staying met for a game day" style={{ fontSize: 12, color: C.amber }}>
            {usdShort(goal.reward)} in {Math.max(1, Math.ceil(waitMin / 60))} h
          </span>
        ) : locked && goalDone(goal, metrics) ? (
          <span className="num" title="Pays when this stage opens" style={{ fontSize: 12, color: C.amber }}>
            {usdShort(goal.reward)} later
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
function Loans(props: BankPanelProps) {
  const { career, fleet, cash, econMin, onTakeLoan } = props;
  const [productId, setProductId] = useState('fleet');
  const avail = availableCredit(career, fleet);
  const [amountM, setAmountM] = useState(() => Math.max(5, Math.floor(Math.min(avail, 50_000_000) / 1e6)));
  const product = productById(productId);
  const amount = amountM * 1e6;
  const rate = loanRatePct(career, product, econMin);
  const terms = loanTerms(amount, rate, product.termWeeks);
  const blocker = borrowBlocker(career, fleet, cash, amount, econMin);
  const loans = activeLoans(career);
  const week = econWeekOf(econMin);

  return (
    <div>
      <DebtTracker {...props} />
      {loans.length > 0 && (
        <section style={{ marginBottom: 20 }}>
          <SectionTitle>Loans</SectionTitle>
          <div className="bp-list">
            {loans.map((l) => (
              <LoanRow key={l.id} loan={l} cash={cash} onRepay={props.onRepay} onRepayPart={props.onRepayPart} />
            ))}
          </div>
        </section>
      )}

      <SectionTitle>New loan</SectionTitle>
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
                borderRadius: 12,
                cursor: 'pointer',
                background: on ? `${C.brand}24` : well(),
                border: 'none',
                color: C.text,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 650 }}>{p.name}</div>
              <div className="num" style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                {p.termWeeks} weeks · {loanRatePct(career, p, econMin)}%
              </div>
            </button>
          );
        })}
      </div>

      <div className="bp-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: 14, borderRadius: 14, background: well() }}>
        <div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Amount · up to {usdShort(avail)}</div>
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
                {f === 1 ? 'Max' : `${f * 100}%`}
              </Button>
            ))}
          </div>
        </div>
        <div className="num" style={{ fontSize: 12.5, color: C.textDim, lineHeight: 1.7 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>A week</span>
            <b style={{ color: C.text }}>{usdFull(terms.weeklyPayment)}</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Interest</span>
            <span>{usdFull(terms.interest)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Total</span>
            <span>{usdFull(terms.totalRepayable)}</span>
          </div>
          {week <= career.surchargeUntilWeek && (
            <div style={{ color: C.amber, fontSize: 11.5 }}>+2% overdraft surcharge until week {career.surchargeUntilWeek}</div>
          )}
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button variant="primary" disabled={Boolean(blocker)} onClick={() => onTakeLoan(product.id, amount)}>
            Borrow {usdShort(amount)}
          </Button>
          {blocker && <span style={{ fontSize: 12.5, color: C.amber }}>{blocker}</span>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Debt tracker: everything owed, what it costs, when it's gone
// ---------------------------------------------------------------------------
function DebtTracker({ career, fleet, cash, econMin, ledgerHistory, onOpenSettlement }: BankPanelProps) {
  const standing = STANDINGS[standingIndex(career)];
  const d = debtSummary(career, cash, econMin);
  const overdrawn = career.overdrawnWeeks ?? 0;
  const week = econWeekOf(econMin);
  return (
    <section style={{ marginBottom: 20 }}>
      {career.insolvent ? (
        <Banner tone="red" title="Your airline is insolvent">
          Overdrawn {INSOLVENCY_WEEKS} weeks in a row. Settle with the bank to borrow again.
          <div style={{ marginTop: 8 }}>
            <Button size="sm" variant="primary" onClick={onOpenSettlement}>
              Settle
            </Button>
          </div>
        </Banner>
      ) : d.overdraft > 0 ? (
        <Banner tone="amber" title={`Overdrawn by ${usdShort(d.overdraft)}`}>
          {usdShort(d.overdraftWeekly)} a week in interest ({OVERDRAFT_RATE_PCT}%), and no new loans.{' '}
          {overdrawn >= 1 ? 'End this week overdrawn and the airline is insolvent.' : `${INSOLVENCY_WEEKS} overdrawn weeks in a row means insolvency.`}
        </Banner>
      ) : null}
      <div className="bp-debt-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr) 1.4fr', gap: 12, padding: '14px 16px', borderRadius: 14, background: well(), alignItems: 'start' }}>
        <Stat label="Standing" value={standing.label} sub={`from ${standing.ratePct}%`} />
        <Stat label="Credit line" value={usdShort(creditLine(career, fleet))} sub={`${usdShort(availableCredit(career, fleet))} free`} />
        <Stat label="Owed" value={usdShort(d.total)} sub={d.overdraft ? `${usdShort(d.overdraft)} overdraft` : `${d.loans} of ${MAX_ACTIVE_LOANS} loans`} />
        <Stat label="A week" value={usdShort(d.weekly)} />
        <Stat label="Debt-free" value={d.debtFreeWeek ? `Week ${d.debtFreeWeek}` : d.overdraft ? 'Overdrawn' : 'Now'} sub={d.debtFreeWeek ? `in ${Math.max(0, d.debtFreeWeek - week)} weeks` : undefined} />
        <DebtChart history={ledgerHistory} now={d.total} week={week} />
      </div>
    </section>
  );
}


function Banner({ tone, title, children }: { tone: 'red' | 'amber'; title: string; children: React.ReactNode }) {
  const col = tone === 'red' ? C.red : C.amber;
  return (
    <div role="alert" style={{ background: `${col}1c`, borderRadius: 12, padding: '10px 14px', marginBottom: 12 }}>
      <div style={{ fontSize: 13.5, fontWeight: 650, color: col }}>{title}</div>
      <div style={{ fontSize: 12.5, color: C.textDim, marginTop: 3, lineHeight: 1.45 }}>{children}</div>
    </div>
  );
}

/** Debt at the end of each closed week, and now. */
function DebtChart({ history, now, week }: { history: WeekLedger[]; now: number; week: number }) {
  const pts = [...history.filter((w) => w.debtEnd !== undefined).map((w) => ({ week: w.week, v: w.debtEnd! + Math.max(0, -(w.cashEnd ?? 0)), now: false })), { week, v: now, now: true }];
  // Never in debt: nothing to draw
  if (pts.every((p) => p.v <= 0)) return null;
  const max = Math.max(1, ...pts.map((p) => p.v));
  const H = 46;
  return (
    <div aria-label="Debt at the end of each week" style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: H }}>
        {pts.map((p) => (
          <div
            key={p.week + (p.now ? 'n' : '')}
            className="bp-debt-bar"
            title={`${p.now ? 'Now' : `End of week ${p.week}`}: ${usdShort(p.v)}`}
            style={{
              flex: 1,
              maxWidth: 22,
              height: Math.max(2, (p.v / max) * H),
              borderRadius: '3px 3px 0 0',
              background: p.now ? C.amber : C.accentStrong,
              opacity: p.v > 0 ? 1 : 0.35,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function LoanRow({
  loan: l,
  cash,
  onRepay,
  onRepayPart,
}: {
  loan: ReturnType<typeof activeLoans>[number];
  cash: number;
  onRepay: (id: string) => void;
  onRepayPart: (id: string, amount: number) => void;
}) {
  const owed = loanOutstanding(l);
  const weeksLeft = loanWeeksLeft(l);
  const start = loanStartPrincipal(l);
  const [open, setOpen] = useState(false);
  const maxM = Math.max(1, Math.floor(Math.min(owed, Math.max(0, cash)) / 1e6));
  const [payM, setPayM] = useState(() => Math.max(1, Math.min(maxM, Math.round(owed / 4 / 1e6))));
  const pay = Math.min(payM * 1e6, owed);
  const pv = partRepaymentPreview(l, pay);
  const tooLittle = pay < MIN_PART_REPAYMENT && !pv.settles;
  const short = cash < pay;
  const wl = Math.ceil(weeksLeft - 1e-6);
  return (
    <div className="bp-loan" style={{ padding: '11px 8px' }}>
      <div className="bp-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 200px auto', gap: 14, alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>
            {productById(l.product).name} <span style={{ color: C.muted, fontWeight: 500 }}>{l.ref}</span>
          </div>
          <div className="num" style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
            {usdShort(owed)} of {usdShort(start)} · {l.ratePct}% · {usdShort(l.weeklyPayment)} a week · {wl} {wl === 1 ? 'week' : 'weeks'} left
          </div>
        </div>
        <div>
          <div className="num" style={{ fontSize: 11.5, color: C.muted, marginBottom: 4 }}>
            {Math.round(loanRepaidShare(l) * 100)}% paid
          </div>
          <Meter pct={loanRepaidShare(l) * 100} gradient={C.accent} height={5} />
        </div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost" aria-expanded={open} disabled={cash < MIN_PART_REPAYMENT} onClick={() => setOpen((o) => !o)}>
            Pay part
          </Button>
          <Button size="sm" disabled={cash < owed} onClick={() => onRepay(l.id)}>
            Repay {usdShort(owed)}
          </Button>
        </div>
      </div>
      {open && (
        <div className="bp-part" style={{ marginTop: 10, padding: '10px 12px', borderRadius: 12, background: well() }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, color: C.textDim }}>Pay</span>
            <span style={{ color: C.muted }}>$</span>
            <input
              type="number"
              min={1}
              step={1}
              value={payM}
              aria-label="Part repayment in millions"
              onChange={(e) => setPayM(Math.max(0, Math.round(Number(e.target.value) || 0)))}
              style={{ ...inputStyle, width: 90, fontWeight: 650 }}
            />
            <span style={{ color: C.muted, fontSize: 12.5 }}>million</span>
            {[0.1, 0.25, 0.5].map((f) => (
              <Button key={f} size="sm" variant="ghost" onClick={() => setPayM(Math.max(1, Math.min(maxM, Math.round((owed * f) / 1e6))))}>
                {f * 100}%
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setPayM(Math.max(1, maxM))}>
              Max
            </Button>
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="primary" disabled={tooLittle || short || pay <= 0} onClick={() => onRepayPart(l.id, pay)}>
              Pay {usdShort(pay)}
            </Button>
          </div>
          <div className="num" style={{ fontSize: 12, color: short || tooLittle ? C.amber : C.muted, marginTop: 7 }}>
            {short
              ? `You have ${usdShort(cash)}.`
              : tooLittle
                ? `Minimum ${usdShort(MIN_PART_REPAYMENT)}.`
                : pv.settles
                  ? `Settles the loan. Saves ${usdShort(loanInterestLeft(l))} interest.`
                  : `Leaves ${usdShort(pv.principalAfter)} · ${usdShort(pv.weeklyAfter)} a week · saves ${usdShort(pv.interestSaved)} interest`}
          </div>
        </div>
      )}
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
      />
    );
  }
  const open = (id: string) => setOpenId(id);

  return (
    <div className="bp-stack" style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 14, alignItems: 'start' }}>
      <div className="bp-list" style={{ maxHeight: 560, overflowY: 'auto' }}>
        {career.letters.map((l) => {
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
                padding: '9px 10px',
                border: 'none',
                borderRadius: 0,
                background: sel ? `${C.brand}1c` : 'transparent',
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
                {l.reward ? (l.collected ? ` · ${usdShort(l.reward)} paid` : ` · ${usdShort(l.reward)} to collect`) : ''}
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
        borderRadius: 10,
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
        left: 'max(8px, calc(var(--bp-gap) + 2px))',
        bottom: 'calc(var(--bp-bottom-h) + 8px - var(--bp-gap))',
        width: 'min(280px, calc(100vw - 24px))',
        ...glass(),
        borderRadius: 16,
        padding: '10px 8px 12px 14px',
        zIndex: 30,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" onClick={onOpen} style={{ all: 'unset', cursor: 'pointer', flex: 1, minWidth: 0, fontSize: 14, fontWeight: 650, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {goal ? goal.title : 'All milestones met'}
        </button>
        <IconButton icon="close" label="Hide" size={26} iconSize={13} color={C.faint} onClick={onHide} />
      </div>
      {goal && (
        <button type="button" aria-label="Open milestones" onClick={onOpen} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: 'calc(100% - 6px)', marginTop: 6 }}>
          <Meter pct={pct} gradient={C.brand} height={4} />
          <div className="num" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.muted, marginTop: 6 }}>
            <span>{goalProgressText(goal, metrics)}</span>
            <span>{usdShort(goal.reward)}</span>
          </div>
        </button>
      )}
      {ready.length > 0 && (
        <Button size="sm" variant="primary" block onClick={onOpen} style={{ marginTop: 10, width: 'calc(100% - 6px)' }}>
          Collect {usdShort(ready.reduce((s, l) => s + (l.reward ?? 0), 0))}
        </Button>
      )}
    </div>
  );
}
