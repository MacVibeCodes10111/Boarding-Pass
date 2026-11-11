import { describe, expect, it } from 'vitest';
import { GOALS, GOAL_HOLD_MIN, STAGES, freshCareer, goalsOfStage, reviewProgramme, type CareerMetrics } from './career';
import type { CareerState } from './types';

const none: CareerMetrics = {
  aircraft: 0, owned: 0, routes: 0, intlRoutes: 0, destinations: 0, countries: 0, continents: 0, hubs: 1, hubContinents: 1, departuresPerWeek: 0,
  paxPerWeek: 0, widebodies: 0, heavies: 0, transatlantic: 0, transpacific: 0, ultraLong: 0, bestWeekNet: 0, loansRepaid: 0, closedWeekInProfit: 0,
};
/** Metrics that meet every milestone of the programme. */
const everything = { ...none } as CareerMetrics;
for (const g of GOALS) everything[g.metric] = Math.max(everything[g.metric], g.target);
const ctx = (econMin: number) => ({ airlineName: 'Test Air', econMin, fleet: [] });
/** Reviews at `econMin` and returns the career after, and what the letters paid for. */
const review = (c: CareerState, m: CareerMetrics, econMin: number) => {
  const r = reviewProgramme(c, m, ctx(econMin));
  return { career: r?.career ?? c, goals: (r?.letters ?? []).filter((l) => l.goalId).map((l) => l.goalId!), stages: (r?.letters ?? []).filter((l) => l.kind === 'standing').map((l) => l.stage!) };
};

describe('the milestone programme', () => {
  it('a new airline with a hundred aircraft is paid for stage 1 only: later stages aren’t open', () => {
    const r = review(freshCareer(), { ...none, aircraft: 100 }, 0);
    expect(r.goals.sort()).toEqual(['s1-aircraft', 's1-fleet3']);
    const later = review(r.career, { ...none, aircraft: 100 }, 30 * GOAL_HOLD_MIN);
    expect(later.goals).toEqual([]);
  });

  it('progress on a stage that isn’t open counts: it pays when the stage opens, its day’s wait included', () => {
    // 8 aircraft from the start, the rest of stage 1 a day and more later
    const a = review(freshCareer(), { ...none, aircraft: 8 }, 0);
    expect(a.goals).not.toContain('s2-fleet8');
    const stage1 = { ...none, aircraft: 8, routes: 5, closedWeekInProfit: 1 };
    const b = review(a.career, stage1, 2 * GOAL_HOLD_MIN);
    expect(b.stages).toEqual([1]);
    expect(b.goals).toContain('s2-fleet8'); // held for a day already, paid in the same review
  });

  it('a milestone of an open stage still waits out its game day', () => {
    const stage1 = { ...none, aircraft: 3, routes: 5, closedWeekInProfit: 1 };
    const a = review(freshCareer(), stage1, 0);
    expect(a.stages).toEqual([1]);
    const b = review(a.career, { ...stage1, hubs: 2 }, 100);
    expect(b.goals).toEqual([]);
    const c = review(b.career, { ...stage1, hubs: 2 }, 100 + GOAL_HOLD_MIN);
    expect(c.goals).toEqual(['s2-hub2']);
  });

  it('an airline that meets everything works through every stage in order, each paid once', () => {
    const a = review(freshCareer(), everything, 0);
    expect(a.stages).toEqual([1]);
    const b = review(a.career, everything, GOAL_HOLD_MIN);
    expect(b.stages).toEqual([2, 3, 4, 5]);
    expect(b.career.goalsMet).toHaveLength(GOALS.length);
    expect(review(b.career, everything, 5 * GOAL_HOLD_MIN).goals).toEqual([]);
    expect(STAGES.every((s) => goalsOfStage(s.stage).length > 0)).toBe(true);
  });

  it('a milestone paid early by an older version stays paid', () => {
    const old = { ...freshCareer(), goalsMet: ['s5-fleet100'] };
    const r = review(old, { ...none, aircraft: 100 }, 0);
    expect(r.career.goalsMet).toContain('s5-fleet100');
    expect(r.goals).not.toContain('s5-fleet100');
  });
});
