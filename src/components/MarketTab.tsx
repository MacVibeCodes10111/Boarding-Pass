// ============================================================================
// THE MARKETPLACE TAB (Update B: used aircraft)
//   Buy: aircraft other airlines of the same mode have listed, with filters.
//   Sell: list one of this career's owned aircraft at a price inside the
//     allowed range. It leaves the fleet straight away; if nobody buys it in
//     30 days it comes back.
//   Listings and History: this career's own.
//   Game money only. Buying and selling happen inside a career (the game
//   applies them to its save, see game/market.ts); the main menu can look.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { AIRCRAFT_BY_ID } from '../game/aircraftCatalog';
import { loadAlliance } from '../game/alliances';
import type { MyAirline } from '../game/cloud';
import { usdShort } from '../game/career';
import { LISTING_DAYS, MAX_LISTINGS, browseMarket, buyListing, cabinSeats, clampPrice, marketAnswer, marketCabin, priceBand, type MarketMine, type MarketOffer, type MarketSort } from '../game/market';
import type { AircraftCategory, PlayerAircraft } from '../game/types';
import { Icon } from '../ui/icons';
import { Button, C, DISPLAY, ModalShell, Segmented, inputStyle } from '../ui/kit';
import { AircraftPhoto } from './AircraftPhoto';
import { AllianceTag } from './FriendsTab';

type Act = (label: string, fn: () => Promise<unknown>) => Promise<void>;
type Part = 'buy' | 'sell' | 'listings' | 'history';

/** What a career gives the Marketplace tab (nothing on the main menu). */
export interface MarketHooks {
  saveId: string;
  sandbox: boolean;
  cash: number;
  hub: string;
  fleet: PlayerAircraft[];
  /** Registrations that have flights (those can't be sold). */
  flying: ReadonlySet<string>;
  /** This career's listings and trades, as last read. */
  mine: MarketMine | null;
  /** Reads the marketplace again and applies anything new to the career. */
  refresh: () => Promise<void>;
  /** Lists an aircraft. '' when it worked, else what went wrong. */
  list: (tail: string, price: number) => Promise<string>;
  cancel: (id: string) => Promise<string>;
  /** An aircraft to start selling (from its window). */
  sellTail?: string | null;
}

const CATEGORIES: { value: AircraftCategory | ''; label: string }[] = [
  { value: '', label: 'Every size' },
  { value: 'turboprop', label: 'Turboprops' },
  { value: 'regional_jet', label: 'Regional jets' },
  { value: 'narrowbody', label: 'Narrowbodies' },
  { value: 'widebody', label: 'Widebodies' },
  { value: 'heavy_widebody', label: 'Heavy widebodies' },
];
const note: React.CSSProperties = { fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.45 };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, background: C.raised, flexWrap: 'wrap' };
const day = (x: string) => (x ? new Date(x).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');
const seatsText = (c: { econSeats: number; premSeats: number; busSeats: number; firstSeats: number }) =>
  [c.firstSeats && `${c.firstSeats}F`, c.busSeats && `${c.busSeats}J`, c.premSeats && `${c.premSeats}W`, c.econSeats && `${c.econSeats}Y`].filter(Boolean).join(' ') || 'No seats';

export function MarketTab(props: { me: MyAirline; busy: boolean; act: Act; market?: MarketHooks }) {
  const { market } = props;
  const [part, setPart] = useState<Part>(market?.sellTail ? 'sell' : 'buy');
  useEffect(() => {
    if (market?.sellTail) setPart('sell');
  }, [market?.sellTail]);
  // Sales come in from other games: look when it opens, on each part, and every minute while open
  const refresh = market?.refresh;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    void refreshRef.current?.();
  }, [part]);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshRef.current?.();
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);
  const open = market?.mine?.listings.filter((l) => l.status === 'open') ?? [];
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Segmented<Part>
        value={part}
        onChange={setPart}
        options={[
          { value: 'buy', label: 'Buy' },
          { value: 'sell', label: 'Sell' },
          { value: 'listings', label: open.length ? `Listed · ${open.length}` : 'Listed' },
          { value: 'history', label: 'History' },
        ]}
      />
      {part === 'buy' && <Buy me={props.me} busy={props.busy} act={props.act} market={market} />}
      {part === 'sell' && (market ? <Sell market={market} busy={props.busy} act={props.act} onListed={() => setPart('listings')} /> : <InCareer what="sell an aircraft" />)}
      {part === 'listings' && (market ? <Listings market={market} busy={props.busy} act={props.act} /> : <InCareer what="see its listings" />)}
      {part === 'history' && (market ? <History market={market} /> : <InCareer what="see its trades" />)}
      <p style={note}>Game money only: nothing here costs or pays real money. {props.me.mode === 'sandbox' ? 'Sandbox airlines trade only with Sandbox airlines.' : 'Career airlines trade only with Career airlines.'}</p>
    </div>
  );
}

function InCareer(props: { what: string }) {
  return <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.5 }}>Open this airline’s career to {props.what}.</p>;
}

// ---------------------------------------------------------------------------
// Buy
// ---------------------------------------------------------------------------
function Buy(props: { me: MyAirline; busy: boolean; act: Act; market?: MarketHooks }) {
  const { me, market } = props;
  const [sort, setSort] = useState<MarketSort>('new');
  const [cat, setCat] = useState<AircraftCategory | ''>('');
  const [type, setType] = useState('');
  const [max, setMax] = useState('');
  const [ours, setOurs] = useState(false);
  const [alliance, setAlliance] = useState<{ id: string; tag: string } | null>(null);
  const [offers, setOffers] = useState<MarketOffer[] | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const [v, setV] = useState(0);
  useEffect(() => {
    let live = true;
    loadAlliance(me.id)
      .then((d) => live && setAlliance(d?.alliance ? { id: d.alliance.id, tag: d.alliance.tag } : null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [me.id]);
  const models = useMemo(() => (type ? [type] : cat ? [...AIRCRAFT_BY_ID.values()].filter((m) => m.category === cat).map((m) => m.id) : []), [type, cat]);
  const maxUsd = Number(max) > 0 ? Math.round(Number(max) * 1e6) : null;
  useEffect(() => {
    let live = true;
    setOffers(null);
    const t = window.setTimeout(() => {
      browseMarket(me.id, { models, max: maxUsd, alliance: ours && alliance ? alliance.id : null, sort })
        .then((o) => live && setOffers(o))
        .catch(() => live && setOffers([]));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [me.id, models, maxUsd, ours, alliance, sort, v]);
  // One menu: every aircraft, a whole size, or one type
  const groups = useMemo(
    () => CATEGORIES.filter((c) => c.value).map((c) => ({ ...c, types: [...AIRCRAFT_BY_ID.values()].filter((m) => m.category === c.value).sort((a, b) => a.name.localeCompare(b.name)) })),
    [],
  );
  const pick = type ? `t:${type}` : cat ? `c:${cat}` : '';

  const buy = (o: MarketOffer) =>
    void props.act(`Buying the ${o.model.name}…`, async () => {
      const r = await buyListing(me.id, o.id);
      setAsking(null);
      if (r === 'bought') {
        setSaid(`Bought. The ${o.model.name} joins your fleet at ${market?.hub ?? 'your hub'}.`);
        await market?.refresh();
      } else setSaid(marketAnswer(r));
      setV((x) => x + 1);
    });

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select
          aria-label="Which aircraft"
          value={pick}
          onChange={(e) => {
            const v = e.target.value;
            setCat(v.startsWith('c:') ? (v.slice(2) as AircraftCategory) : '');
            setType(v.startsWith('t:') ? v.slice(2) : '');
          }}
          style={{ ...inputStyle, flex: 1, minWidth: 0 }}
        >
          <option value="">Every aircraft</option>
          {groups.map((g) => (
            <optgroup key={g.value} label={g.label}>
              <option value={`c:${g.value}`}>All {g.label.toLowerCase()}</option>
              {g.types.map((m) => (
                <option key={m.id} value={`t:${m.id}`}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5, color: C.muted, flex: 'none' }}>
          $
          <input inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value.replace(/[^0-9.]/g, '').slice(0, 7))} placeholder="max" aria-label="Most to pay, in millions" style={{ ...inputStyle, width: 64 }} />M
        </label>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Segmented<MarketSort>
          size="sm"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'new', label: 'Newest' },
            { value: 'cheap', label: 'Cheapest' },
            { value: 'dear', label: 'Dearest' },
          ]}
        />
        {alliance && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={ours} onChange={(e) => setOurs(e.target.checked)} style={{ accentColor: C.brand }} />
            Only from {alliance.tag}
          </label>
        )}
      </div>
      {said && (
        <p role="status" style={{ fontSize: 12.5, margin: 0 }}>
          {said}
        </p>
      )}
      {offers === null ? (
        <p style={note}>Looking…</p>
      ) : offers.length === 0 ? (
        <div style={{ padding: '24px 16px', borderRadius: 12, background: C.raised, textAlign: 'center' }}>
          <Icon name="buy" size={26} color={C.muted} style={{ display: 'block', margin: '0 auto' }} />
          <p style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, margin: '8px 0 4px' }}>Nothing for sale{models.length || maxUsd || ours ? ' that matches' : ' yet'}</p>
          <p style={note}>Other airlines’ aircraft appear here when they list them. You can sell yours in Sell.</p>
        </div>
      ) : (
        <div className="bp-stack" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))', gap: 10 }}>
          {offers.map((o) => {
            const newPrice = o.model.base_price_usd;
            const off = Math.round((1 - o.price / newPrice) * 100);
            const short = market && !market.sandbox && market.cash < o.price;
            return (
              <article key={o.id} style={{ display: 'grid', gap: 6, padding: 10, borderRadius: 12, background: C.raised, border: `1px solid ${C.lineSoft}` }}>
                <div style={{ display: 'grid', placeItems: 'center', minHeight: 70, borderRadius: 8, background: `${C.bg}88` }}>
                  <AircraftPhoto model={o.model} width="100%" paintWidth={380} plain />
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.model.name}</span>
                  {off > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: C.green, whiteSpace: 'nowrap' }}>{off}% below new</span>}
                </div>
                <div className="num" style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 700, lineHeight: 1 }}>
                  {usdShort(o.price)}
                </div>
                <div style={{ fontSize: 12, color: C.muted }}>
                  {o.model.is_cargo ? `${o.model.cargo_cap_tons} t cargo` : `${cabinSeats(o.cabin)} seats · ${seatsText(o.cabin)}`} · {o.model.range_nm.toLocaleString()} nm
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textDim, minWidth: 0 }}>
                  <span aria-hidden style={{ width: 12, height: 12, borderRadius: 3, flex: 'none', background: `linear-gradient(135deg, ${o.seller?.colours.a ?? '#475569'} 50%, ${o.seller?.colours.b ?? '#94a3b8'} 50%)` }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.seller?.airline ?? 'An airline'}</span>
                  {o.seller?.alliance && <AllianceTag badge={o.seller.alliance} />}
                  <span style={{ marginLeft: 'auto', color: C.faint, flex: 'none' }}>{day(o.createdAt)}</span>
                </div>
                {!market ? (
                  <p style={{ ...note, fontSize: 11.5 }}>Open this airline’s career to buy.</p>
                ) : asking === o.id ? (
                  <div style={{ display: 'grid', gap: 6, padding: 8, borderRadius: 8, background: C.bg }}>
                    <span style={{ fontSize: 12.5, lineHeight: 1.4 }}>
                      Pay {usdShort(o.price)}{market.sandbox ? ' (Sandbox money)' : ''}. It joins your fleet at {market.hub} straight away, owned, with its cabin as it is.
                    </span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      <Button size="sm" variant="primary" disabled={props.busy} onClick={() => buy(o)}>
                        Buy it
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>
                        Not now
                      </Button>
                    </span>
                  </div>
                ) : (
                  <Button size="sm" variant={short ? 'ghost' : 'primary'} disabled={props.busy || short} title={short ? 'Not enough cash' : undefined} onClick={() => (setSaid(''), setAsking(o.id))}>
                    {short ? 'Not enough cash' : 'Buy'}
                  </Button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sell
// ---------------------------------------------------------------------------
function Sell(props: { market: MarketHooks; busy: boolean; act: Act; onListed: () => void }) {
  const { market } = props;
  const owned = market.fleet.filter((a) => a.acquisition === 'owned' && AIRCRAFT_BY_ID.has(a.model.id));
  const free = (a: PlayerAircraft) => !market.flying.has(a.tailNumber);
  const pickable = (t: string | null | undefined) => !!t && owned.some((a) => a.tailNumber === t && free(a));
  const [tail, setTail] = useState<string>(() => (pickable(market.sellTail) ? market.sellTail! : ''));
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (pickable(market.sellTail)) setTail(market.sellTail!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market.sellTail]);
  const ac = owned.find((a) => a.tailNumber === tail && free(a)) ?? null;
  const band = ac ? priceBand(ac.model) : null;
  const [price, setPrice] = useState(0);
  useEffect(() => {
    if (ac) setPrice(clampPrice(ac.model, priceBand(ac.model).value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tail]);
  const [said, setSaid] = useState('');
  const openCount = market.mine?.listings.filter((l) => l.status === 'open').length ?? 0;
  const ready = owned.filter(free).length;

  if (!owned.length) return <p style={note}>Only aircraft you own can be sold here. Leased ones go back to the lessor instead.</p>;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <button
        type="button"
        onClick={() => setPicking(true)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: ac ? 8 : '14px 12px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', font: 'inherit', color: C.text, background: C.raised, border: `1px solid ${C.border}` }}
      >
        {ac ? (
          <>
            <span style={{ flex: '0 0 46%', maxWidth: 260 }}>
              <AircraftPhoto model={ac.model} width="100%" paintWidth={260} tailNumber={ac.tailNumber} liveryIndex={ac.livery} noTag />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 700, fontSize: 15 }}>{ac.tailNumber}</span>
              <span style={{ display: 'block', fontSize: 12.5, color: C.muted }}>{ac.model.name}</span>
            </span>
          </>
        ) : (
          <span style={{ flex: 1, fontWeight: 650, fontSize: 14 }}>Choose an aircraft to sell</span>
        )}
        <span style={{ fontSize: 12.5, color: C.brand, fontWeight: 650, flex: 'none' }}>{ac ? 'Change' : `${ready} ready`}</span>
      </button>
      {!ac && <p style={note}>Only aircraft you own with no flights can be sold. Remove an aircraft’s flights in its schedule first.</p>}
      {picking && (
        <ModalShell onClose={() => setPicking(false)} maxWidth={520} zIndex={260}>
          <h2 style={{ fontFamily: DISPLAY, fontSize: 22, margin: '0 0 4px' }}>Sell which aircraft?</h2>
          <p style={{ ...note, marginBottom: 12 }}>Only aircraft with no flights can be sold.</p>
          <div style={{ display: 'grid', gap: 8 }}>
            {[...owned].sort((a, b) => Number(!free(a)) - Number(!free(b))).map((a) => {
              const ok = free(a);
              return (
                <button
                  key={a.tailNumber}
                  type="button"
                  disabled={!ok}
                  onClick={() => {
                    setSaid('');
                    setTail(a.tailNumber);
                    setPicking(false);
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 8, borderRadius: 12, textAlign: 'left', font: 'inherit', color: C.text, cursor: ok ? 'pointer' : 'default', opacity: ok ? 1 : 0.55, background: C.raised, border: `1px solid ${a.tailNumber === tail ? C.brand : C.lineSoft}` }}
                >
                  <span style={{ flex: '0 0 50%', maxWidth: 240 }}>
                    <AircraftPhoto model={a.model} width="100%" paintWidth={240} tailNumber={a.tailNumber} liveryIndex={a.livery} noTag />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 14.5 }}>{a.tailNumber}</span>
                    <span style={{ display: 'block', fontSize: 12.5, color: C.muted }}>{a.model.name}</span>
                    <span style={{ display: 'block', fontSize: 12, marginTop: 2, color: ok ? C.green : C.muted }}>{ok ? `Up to ${usdShort(priceBand(a.model).max)}` : 'Has flights'}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </ModalShell>
      )}
      {ac && band && (
        <div style={{ display: 'grid', gap: 10, padding: 12, borderRadius: 12, background: C.raised }}>
          <div style={{ fontSize: 12.5, color: C.muted }}>
            {ac.model.is_cargo ? `${ac.model.cargo_cap_tons} t cargo` : `${cabinSeats(marketCabin(ac.model, ac.cabin))} seats · ${seatsText(ac.cabin)}`} · new {usdShort(ac.model.base_price_usd)} · the game pays {usdShort(band.value)}
          </div>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 12, color: C.muted, flex: 1 }}>Asking price</span>
              <span className="num" style={{ fontFamily: DISPLAY, fontSize: 28, fontWeight: 700 }}>
                {usdShort(price)}
              </span>
            </span>
            <input type="range" min={band.min} max={band.max} step={10_000} value={price} onChange={(e) => setPrice(clampPrice(ac.model, Number(e.target.value)))} style={{ width: '100%', accentColor: C.brand }} />
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5, color: C.faint }}>
              <span>{usdShort(band.min)}</span>
              <span style={{ textAlign: 'center' }}>{price > band.value ? `+${usdShort(price - band.value)} on the game’s price` : price < band.value ? `−${usdShort(band.value - price)} on the game’s price` : 'The game’s price'}</span>
              <span>{usdShort(band.max)}</span>
            </span>
          </label>
          <p style={note}>
            It leaves your fleet when listed. You’re paid when another airline buys it; if nobody does in {LISTING_DAYS} days, or you take it down, it comes back.
          </p>
          {said && <p style={{ fontSize: 12.5, margin: 0, color: C.red }}>{said}</p>}
          <Button
            variant="primary"
            disabled={props.busy || openCount >= MAX_LISTINGS}
            onClick={() =>
              void props.act(`Listing ${ac.tailNumber}…`, async () => {
                const r = await market.list(ac.tailNumber, price);
                if (r) setSaid(r);
                else {
                  setTail('');
                  props.onListed();
                }
              })
            }
          >
            List for {usdShort(price)}
          </Button>
          <span style={{ fontSize: 12, color: C.muted, textAlign: 'center' }}>
            {openCount} of {MAX_LISTINGS} listed
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// This career's listings and trades
// ---------------------------------------------------------------------------
const ENDED: Record<string, string> = { sold: 'Sold', cancelled: 'Taken down', expired: 'Not sold in 30 days', removed: 'Taken down by a moderator', withdrawn: 'Ended: the airline stopped sharing' };

function Listings(props: { market: MarketHooks; busy: boolean; act: Act }) {
  const { market } = props;
  const ls = market.mine?.listings ?? null;
  if (ls === null) return <p style={note}>Loading your listings…</p>;
  const open = ls.filter((l) => l.status === 'open');
  const ended = ls.filter((l) => l.status !== 'open');
  const left = (x: string) => Math.max(0, Math.ceil((Date.parse(x) + LISTING_DAYS * 86_400_000 - Date.now()) / 86_400_000));
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {open.length === 0 && <p style={note}>Nothing listed. Pick an aircraft in Sell.</p>}
      {open.map((l) => {
        const m = AIRCRAFT_BY_ID.get(l.model)!;
        return (
          <div key={l.id} style={rowStyle}>
            <span style={{ width: 90, flex: 'none' }}>
              <AircraftPhoto model={m} width={90} />
            </span>
            <span style={{ flex: '1 1 160px', minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 650 }}>
                {l.tail} · {m.name}
              </span>
              <span style={{ display: 'block', fontSize: 12, color: C.muted }}>
                Listed {day(l.createdAt)} · {left(l.createdAt)} days left
              </span>
            </span>
            <span className="num" style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700 }}>
              {usdShort(l.price)}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={props.busy}
              onClick={() =>
                void props.act('Taking it down…', async () => {
                  const r = await market.cancel(l.id);
                  if (r) throw new Error(r);
                })
              }
            >
              Take down
            </Button>
          </div>
        );
      })}
      {ended.length > 0 && <p style={{ fontSize: 12, fontWeight: 650, color: C.muted, margin: '8px 0 0' }}>Ended in the last 30 days</p>}
      {ended.map((l) => (
        <div key={l.id} style={{ ...rowStyle, opacity: 0.8 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
            {l.tail} · {AIRCRAFT_BY_ID.get(l.model)?.name}
          </span>
          <span style={{ fontSize: 12, color: l.status === 'sold' ? C.green : C.muted }}>{ENDED[l.status]}</span>
          <span className="num" style={{ fontSize: 13 }}>
            {usdShort(l.price)}
          </span>
        </div>
      ))}
    </div>
  );
}

function History(props: { market: MarketHooks }) {
  const ts = props.market.mine?.trades ?? null;
  if (ts === null) return <p style={note}>Loading…</p>;
  if (!ts.length) return <p style={note}>No trades yet.</p>;
  const sold = ts.filter((t) => t.role === 'seller' && !t.reversed).reduce((s, t) => s + t.price, 0);
  const bought = ts.filter((t) => t.role === 'buyer' && !t.reversed).reduce((s, t) => s + t.price, 0);
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        <div style={{ padding: '8px 10px', borderRadius: 10, background: C.raised }}>
          <div style={{ fontSize: 11.5, color: C.muted }}>Sold</div>
          <div className="num" style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, color: C.green }}>
            {usdShort(sold)}
          </div>
        </div>
        <div style={{ padding: '8px 10px', borderRadius: 10, background: C.raised }}>
          <div style={{ fontSize: 11.5, color: C.muted }}>Bought</div>
          <div className="num" style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700 }}>
            {usdShort(bought)}
          </div>
        </div>
      </div>
      {ts.map((t) => (
        <div key={t.id} style={rowStyle}>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 6, background: t.role === 'seller' ? `${C.green}22` : `${C.accent}22`, color: t.role === 'seller' ? C.green : C.accent }}>{t.role === 'seller' ? 'Sold' : 'Bought'}</span>
          <span style={{ flex: '1 1 160px', minWidth: 0, fontSize: 13 }}>
            {AIRCRAFT_BY_ID.get(t.model)?.name}
            {t.role === 'seller' && t.tail ? ` (${t.tail})` : ''}
            <span style={{ color: C.muted }}>
              {' '}
              · {t.role === 'seller' ? 'to' : 'from'} {t.other} · {day(t.at)}
            </span>
          </span>
          {t.reversed && <span style={{ fontSize: 12, color: C.amber }}>Reversed</span>}
          <span className="num" style={{ fontSize: 13.5, fontWeight: 650, textDecoration: t.reversed ? 'line-through' : undefined }}>
            {usdShort(t.price)}
          </span>
        </div>
      ))}
      <p style={note}>Trade records are kept 12 months.</p>
    </div>
  );
}
