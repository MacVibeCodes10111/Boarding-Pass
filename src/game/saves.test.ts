import { beforeEach, describe, expect, it, vi } from 'vitest';

// A stand-in for the browser's storage, in place before the game code loads
const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
});

const { MAX_SAVE_SLOTS, hasRoomForCareer, readSaveSlots, readSaveFileText, upsertSaveSlot, writeSaveSlots } = await import('./saves');
const { protectSave } = await import('./saveCrypt');
const { recordAge, storeIncoming } = await import('./cloud');
const { MAX_CATCH_UP_GAME_MIN, advanceEconomy, liveTickGameMinutes } = await import('./clock');
import type { SaveGameState } from './types';
import type { SupabaseClient } from '@supabase/supabase-js';

const career = (id: string, rev: number, name = `Airline ${id}`) =>
  ({ saveId: id, airlineName: name, hubIata: 'JFK', fleet: [], schedule: [], rev, cash: 1, simDay: 1, simMin: 0 }) as unknown as SaveGameState;
const ids = () => readSaveSlots().map((s) => s.saveId);
const SYNCED = 'bp_cloud_synced_v1';
const setSynced = (id: string, rev: number) => mem.set(SYNCED, JSON.stringify({ [id]: rev }));

/** A cloud copy, and a server that records what it was told arrived. */
const row = (id: string, rev: number, name = `Airline ${id}`) => ({ save_id: id, rev, airline: name, data: protectSave(career(id, rev, name)) });
const server = () => {
  const acks: number[] = [];
  const c = { rpc: async (_fn: string, a: { p_rev: number }) => void acks.push(a.p_rev) } as unknown as SupabaseClient;
  return { c, acks };
};

beforeEach(() => mem.clear());

describe('career slots', () => {
  const fill = () => writeSaveSlots(Array.from({ length: MAX_SAVE_SLOTS }, (_, i) => career(`S${i}`, i + 1)));

  it('never drops a career when saving a new one', () => {
    fill();
    writeSaveSlots(upsertSaveSlot(readSaveSlots(), career('NEW', 99)));
    expect(ids()).toHaveLength(MAX_SAVE_SLOTS + 1);
    expect(ids()).toContain(`S${MAX_SAVE_SLOTS - 1}`);
  });

  it('has no room for a new career at the limit, but a career already here still fits', () => {
    fill();
    const slots = readSaveSlots();
    expect(hasRoomForCareer(slots)).toBe(false);
    expect(hasRoomForCareer(slots, 'NEW')).toBe(false);
    expect(hasRoomForCareer(slots, 'S3')).toBe(true);
  });

  it('refuses a cloud career at the limit, keeps every career and leaves it in the cloud', async () => {
    fill();
    const { c, acks } = server();
    const r = await storeIncoming(c, row('NEW', 100), null);
    expect(r.kind).toBe('full');
    expect(ids()).toHaveLength(MAX_SAVE_SLOTS);
    expect(acks).toEqual([]);
  });
});

describe('saves', () => {
  it('reads back what it wrote', () => {
    writeSaveSlots([career('A', 5, 'Über Air “One”')]);
    expect(readSaveSlots()[0].airlineName).toBe('Über Air “One”');
  });

  it('leaves out a protected save that was changed outside the game', () => {
    const good = protectSave(career('A', 1));
    const bad = protectSave(career('B', 1)).replace(/.{8}$/, 'AAAAAAA=');
    mem.set('bp_pc_saves_protected_v1', '1');
    mem.set('bp_pc_saves_list_v2', JSON.stringify([good, bad]));
    expect(ids()).toEqual(['A']);
  });

  it('refuses a changed save file, and opens a plain one in Sandbox', () => {
    expect(readSaveFileText('BP2.salt.badsig.AAAA').ok).toBe(false);
    const plain = readSaveFileText(JSON.stringify(career('A', 1)));
    expect(plain.ok && plain.save.gameMode).toBe('sandbox');
  });
});

describe('cloud copies arriving on this device', () => {
  it('takes a newer copy when this device has not changed', async () => {
    writeSaveSlots([career('A', 100)]);
    setSynced('A', 100);
    const { c, acks } = server();
    const r = await storeIncoming(c, row('A', 200), null);
    expect(r.kind).toBe('stored');
    expect(readSaveSlots().map((s) => s.rev)).toEqual([200]);
    expect(acks).toEqual([200]);
  });

  it('keeps the other device’s progress when an older copy was opened here', async () => {
    const opened = 5_000_000; // opening the old copy gave it a new, higher revision
    writeSaveSlots([career('A', opened)]);
    setSynced('A', 100);
    const { c, acks } = server();
    const r = await storeIncoming(c, row('A', 200), null);
    expect(r).toMatchObject({ kind: 'had', kept: true });
    const copy = readSaveSlots().find((s) => s.saveId === 'A-copy');
    expect(copy?.rev).toBe(200);
    expect(copy?.airlineName).toBe('Airline A (other copy)');
    expect(readSaveSlots().find((s) => s.saveId === 'A')?.rev).toBe(opened);
    expect(acks).toEqual([200]);
  });

  it('keeps the other device’s progress on a device that has just signed back in', async () => {
    writeSaveSlots([career('A', 5_000_000)]); // nothing recorded as synced
    const r = await storeIncoming(server().c, row('A', 200), null);
    expect(r).toMatchObject({ kind: 'had', kept: true });
    expect(readSaveSlots().find((s) => s.saveId === 'A-copy')?.rev).toBe(200);
  });

  it('adds no copy when both devices already have the same version', async () => {
    writeSaveSlots([career('A', 200)]);
    setSynced('A', 100);
    const r = await storeIncoming(server().c, row('A', 200), null);
    expect(r).toMatchObject({ kind: 'had', kept: false });
    expect(ids()).toEqual(['A']);
  });

  it('still uploads this device’s version after keeping the other one', async () => {
    writeSaveSlots([career('A', 5_000_000)]);
    setSynced('A', 100);
    await storeIncoming(server().c, row('A', 200), null);
    expect(JSON.parse(mem.get(SYNCED)!).A).toBe(200); // below 5,000,000, so it still counts as unsent
  });

  it('refreshes one copy instead of adding more each time', async () => {
    writeSaveSlots([career('A', 5_000_000)]);
    setSynced('A', 100);
    await storeIncoming(server().c, row('A', 200), null);
    await storeIncoming(server().c, row('A', 300), null);
    expect(ids().filter((id) => id === 'A-copy')).toHaveLength(1);
    expect(readSaveSlots().find((s) => s.saveId === 'A-copy')?.rev).toBe(300);
  });

  it('keeps long unsent play here as a copy when a newer copy arrives', async () => {
    const twoHours = 2 * 3_600_000;
    writeSaveSlots([career('A', 100 + twoHours)]);
    setSynced('A', 100);
    const r = await storeIncoming(server().c, row('A', 100 + 3 * 3_600_000), null);
    expect(r).toMatchObject({ kind: 'stored', kept: true });
    expect(readSaveSlots().find((s) => s.saveId === 'A-copy')?.rev).toBe(100 + twoHours);
  });

  it('adds no copy for the last moments before the game closed', async () => {
    writeSaveSlots([career('A', 100 + 60_000)]);
    setSynced('A', 100);
    const r = await storeIncoming(server().c, row('A', 100 + 3_600_000), null);
    expect(r).toMatchObject({ kind: 'stored', kept: false });
    expect(ids()).toEqual(['A']);
  });

  it('never replaces the career being played, and doesn’t mark it delivered', async () => {
    writeSaveSlots([career('A', 100)]);
    setSynced('A', 100);
    const { c, acks } = server();
    const r = await storeIncoming(c, row('A', 200), 'A');
    expect(r.kind).toBe('playing');
    expect(readSaveSlots()[0].rev).toBe(100);
    expect(acks).toEqual([]);
  });

  it('drops a damaged copy without touching this device', async () => {
    writeSaveSlots([career('A', 100)]);
    const r = await storeIncoming(server().c, { ...row('A', 200), data: 'BP2.x.y.AAAA' }, null);
    expect(r.kind).toBe('dropped');
    expect(readSaveSlots()[0].rev).toBe(100);
  });
});

describe('age check', () => {
  const now = new Date(2026, 10, 5); // November 2026
  it('counts a birthday this month as still to come', () => {
    expect(recordAge(2013, 11, now)).toBe('under13');
    expect(recordAge(2013, 10, now)).toBe('ok');
    expect(recordAge(2013, 12, now)).toBe('under13');
    expect(recordAge(2012, 12, now)).toBe('ok');
  });
});

describe('economy clock', () => {
  const rate = 10_080 / 86_400; // one game week per real day

  it('limits one long tick after sleep to the catch-up limit', () => {
    expect(liveTickGameMinutes(30 * 86_400, rate)).toBe(MAX_CATCH_UP_GAME_MIN);
  });

  it('leaves normal ticks alone, and ignores a clock moved backwards', () => {
    expect(liveTickGameMinutes(1, rate)).toBeCloseTo(rate);
    expect(liveTickGameMinutes(-500, rate)).toBe(0);
  });

  it('closes each week once and adds up the money', () => {
    const fresh = { week: 1, flightProfit: 0, leaseCost: 0 };
    const res = advanceEconomy(0, fresh, 2.5 * 10_080, { weeklyFlightProfit: 7_000_000, dailyLeaseCost: 0 }, [], 0);
    expect(res.closedWeeks.map((w) => w.week)).toEqual([1, 2]);
    expect(res.cashDelta).toBeCloseTo(17_500_000, 0);
  });

  it('finishes a loan exactly once', () => {
    const fresh = { week: 1, flightProfit: 0, leaseCost: 0 };
    const loan = { id: 'L', ref: 'R', product: 'bridge', principal: 800, ratePct: 0, termWeeks: 8, weeklyPayment: 100, totalRepayable: 800, paid: 0, startMin: 0 };
    const res = advanceEconomy(0, fresh, 10 * 10_080, { weeklyFlightProfit: 0, dailyLeaseCost: 0 }, [loan], 0);
    expect(res.finishedLoans).toHaveLength(1);
    expect(res.loanCost).toBeCloseTo(800);
  });
});
