import { describe, expect, it } from 'vitest';
import { AIRCRAFT_BY_ID } from './aircraftCatalog';
import { applyMarket, clampPrice, marketActions, marketCabin, normaliseMarket, normaliseMarketMine, normaliseOffers, priceBand, type MarketMine, type MarketSave } from './market';
import { marketPricesSql } from './marketSql';
import { getDefaultCabinForModel } from './economics';
import type { PlayerAircraft } from './types';

const A320 = AIRCRAFT_BY_ID.get('a320-200') ?? [...AIRCRAFT_BY_ID.values()][0];
const L1 = '11111111-1111-4111-8111-111111111111';
const L2 = '22222222-2222-4222-8222-222222222222';
const T1 = '33333333-3333-4333-8333-333333333333';
const T2 = '44444444-4444-4444-8444-444444444444';

const plane = (tail: string, extra: Partial<PlayerAircraft> = {}): PlayerAircraft => ({ tailNumber: tail, model: A320, acquisition: 'owned', hubIata: 'LHR', cabin: getDefaultCabinForModel(A320), ...extra });
let n = 0;
const opts = { hub: 'LHR', now: 1000, newTail: () => `G-NEW${n++}`, money: (x: number) => `$${x}` };
const empty: MarketSave = { applied: [] };

describe('prices', () => {
  it('allows 40% to 120% of the resale value', () => {
    const b = priceBand(A320);
    expect(b.value).toBe(Math.round(A320.base_price_usd * 0.75));
    expect(b.min).toBe(Math.ceil(b.value * 0.4));
    expect(b.max).toBe(Math.floor(b.value * 1.2));
    expect(clampPrice(A320, 1)).toBe(b.min);
    expect(clampPrice(A320, 1e12)).toBe(b.max);
  });

  it('works out the same band as the server for every type', () => {
    for (const m of AIRCRAFT_BY_ID.values()) {
      const v = Math.round((m.base_price_usd * 3) / 4);
      const b = priceBand(m);
      expect([b.min, b.max]).toEqual([Math.ceil((v * 2) / 5), Math.floor((v * 6) / 5)]);
      expect(Number.isInteger(m.base_price_usd)).toBe(true);
    }
  });

  it('the server copy of the prices matches the catalog (npx vitest -u remakes the file)', async () => {
    await expect(marketPricesSql()).toMatchFileSnapshot('../../cloud/supabase/market-prices.sql');
  });
});

describe('what comes from the server', () => {
  it('drops anything that isn’t a real listing or trade', () => {
    const m = normaliseMarketMine({
      listings: [{ id: L1, model: A320.id, tail: 'G-ABCD', price: 5e6, status: 'open' }, { id: 'nope', model: A320.id, tail: 'X', price: 1 }, { id: L2, model: 'made-up', tail: 'G-ABCE', price: 1 }],
      trades: [{ id: T1, model: A320.id, price: -5, role: 'buyer' }, { id: T2, model: A320.id, price: 7e6, role: 'seller', other: 'x'.repeat(90) }],
    })!;
    expect(m.listings.map((l) => l.id)).toEqual([L1]);
    expect(m.trades.map((t) => t.id)).toEqual([T2]);
    expect(m.trades[0].other.length).toBe(40);
    expect(normaliseMarketMine(null)).toBeNull();
  });

  it('only keeps a cabin that fits', () => {
    expect(marketCabin(A320, { econSeats: 9999 })).toEqual(getDefaultCabinForModel(A320));
    expect(marketCabin(A320, getDefaultCabinForModel(A320))).toEqual(getDefaultCabinForModel(A320));
  });

  it('reads offers safely', () => {
    const o = normaliseOffers([{ id: L1, model: A320.id, price: 1e6, seller: { id: T1, airline: 'Sky', colours: { a: 'red' } } }, { id: L2, model: A320.id, price: 'free' }]);
    expect(o).toHaveLength(1);
    expect(o[0].seller?.colours.a).toBe('#475569');
  });

  it('keeps only real keys in a save', () => {
    expect(normaliseMarket({ applied: [`l:${L1}`, 'junk', `l:${L1}`, 5, `zz:${L1}`] })).toEqual({ applied: [`l:${L1}`] });
    expect(normaliseMarket(undefined)).toEqual({ applied: [] });
  });
});

describe('applying the marketplace to a career', () => {
  const sold: MarketMine = {
    listings: [{ id: L1, model: A320.id, cabin: null, tail: 'G-ABCD', price: 5e6, status: 'sold', createdAt: '', closedAt: '', returned: false }],
    trades: [{ id: T1, listing: L1, role: 'seller', model: A320.id, cabin: null, tail: 'G-ABCD', price: 5e6, at: '', other: 'Sky', claimed: false, reversed: false, reversalClaimed: false }],
  };

  it('takes a listed aircraft out and pays for the sale once', () => {
    const first = marketActions(sold, empty);
    expect(first.apply.map((a) => a.kind)).toEqual(['escrow', 'sold']);
    const r = applyMarket([plane('G-ABCD'), plane('G-KEEP')], empty, first.apply, opts);
    expect(r.fleet.map((a) => a.tailNumber)).toEqual(['G-KEEP']);
    expect(r.cashIn).toBe(5e6);
    expect(r.claim).toEqual([`s:${T1}`]);
    // Read again before the claim reached the server: nothing applies twice, the claim is sent again
    const again = marketActions(sold, r.market);
    expect(again.apply).toEqual([]);
    expect(again.claim).toEqual([`s:${T1}`]);
  });

  it('a save from before the listing (rolled back) still loses the aircraft it sold', () => {
    const r = applyMarket([plane('G-ABCD')], empty, marketActions(sold, empty).apply, opts);
    expect(r.fleet).toEqual([]);
    expect(r.cashIn).toBe(5e6);
  });

  it('gives an unsold aircraft back once, under its own registration when it’s free', () => {
    const mine: MarketMine = { listings: [{ ...sold.listings[0], status: 'cancelled' }], trades: [] };
    const after = applyMarket([], { applied: [`l:${L1}`] }, marketActions(mine, { applied: [`l:${L1}`] }).apply, opts);
    expect(after.fleet.map((a) => a.tailNumber)).toEqual(['G-ABCD']);
    expect(marketActions(mine, after.market).apply).toEqual([]);
    const taken = applyMarket([plane('G-ABCD')], { applied: [`l:${L1}`] }, [{ kind: 'return', key: `r:${L1}`, tail: 'G-ABCD', model: A320.id, cabin: null }], opts);
    expect(taken.fleet).toHaveLength(2);
    expect(new Set(taken.fleet.map((a) => a.tailNumber)).size).toBe(2);
  });

  it('a purchase arrives once, and a reversal takes that same aircraft back', () => {
    const bought: MarketMine = { listings: [], trades: [{ id: T2, listing: L2, role: 'buyer', model: A320.id, cabin: null, tail: 'N1', price: 4e6, at: '', other: 'Sky', claimed: false, reversed: false, reversalClaimed: false }] };
    const r = applyMarket([plane('G-OLD')], empty, marketActions(bought, empty).apply, opts);
    expect(r.fleet).toHaveLength(2);
    expect(r.cashOut).toBe(4e6);
    const got = r.fleet.find((a) => a.trade === T2)!;
    expect(got.tailNumber).not.toBe('N1');
    const reversed: MarketMine = { listings: [], trades: [{ ...bought.trades[0], claimed: true, reversed: true }] };
    const back = applyMarket(r.fleet, r.market, marketActions(reversed, r.market).apply, opts);
    expect(back.fleet.map((a) => a.tailNumber)).toEqual(['G-OLD']);
    expect(back.cashIn).toBe(4e6);
    expect(marketActions(reversed, back.market).apply).toEqual([]);
  });

  it('a reversed sale takes the money back and returns the aircraft', () => {
    const mine: MarketMine = { listings: sold.listings, trades: [{ ...sold.trades[0], claimed: true, reversed: true }] };
    const save = { applied: [`l:${L1}`, `s:${T1}`] };
    const r = applyMarket([], save, marketActions(mine, save).apply, opts);
    expect(r.cashOut).toBe(5e6);
    expect(r.fleet.map((a) => a.tailNumber)).toEqual(['G-ABCD']);
  });

  it('an older copy of the save keeps an aircraft that another copy already took back', () => {
    const mine: MarketMine = { listings: [{ ...sold.listings[0], status: 'withdrawn', returned: true }], trades: [] };
    const r = applyMarket([plane('G-ABCD'), plane('G-KEEP')], empty, marketActions(mine, empty).apply, opts);
    expect(r.fleet.map((a) => a.tailNumber).sort()).toEqual(['G-ABCD', 'G-KEEP']);
    expect(marketActions(mine, r.market).apply).toEqual([]);
  });

  it('an older copy that sold it gets the money with it, even if another copy claimed it', () => {
    const mine: MarketMine = { listings: sold.listings, trades: [{ ...sold.trades[0], claimed: true }] };
    const r = applyMarket([plane('G-ABCD')], empty, marketActions(mine, empty).apply, opts);
    expect(r.fleet).toEqual([]);
    expect(r.cashIn).toBe(5e6);
  });

  it('never undoes what this save didn’t do', () => {
    const mine: MarketMine = { listings: [], trades: [{ ...sold.trades[0], claimed: true, reversed: true }] };
    expect(marketActions(mine, empty).apply).toEqual([]);
    const bought: MarketMine = { listings: [], trades: [{ id: T2, listing: L2, role: 'buyer', model: A320.id, cabin: null, tail: 'N1', price: 4e6, at: '', other: 'Sky', claimed: true, reversed: true, reversalClaimed: false }] };
    expect(marketActions(bought, empty).apply).toEqual([]);
  });
});
