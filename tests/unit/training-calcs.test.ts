import { describe, expect, it } from 'vitest';
import { estimate1RM, estimateConfidence, eligible1RM } from '@/lib/training/oneRm';
import { KG_PER_LB, displayWeight, formatVolume, formatLift, fromKg, parseNumberInput, toKg } from '@/lib/training/units';
import { buildFacts, isCountableSet, summarizeWorkouts, type FactSet, type FactWorkout } from '@/lib/training/facts';
import { buildSessions, DEFAULT_CALC } from '@/lib/training/sessions';
import { computeExerciseStats } from '@/lib/training/exerciseStats';
import { computeRecordEvents } from '@/lib/training/records';
import { aggregateByPeriod, periodStart } from '@/lib/training/aggregate';
import { computeStreaks } from '@/lib/training/streaks';
import { e1rmTrend, linearRegression, periodChange, plateauCheck, relativeStrength, muscleVolume } from '@/lib/training/insights';
import { compareWeeks, computeTotals } from '@/lib/training/dashboard';
import type { Exercise, SetFact } from '@/lib/training/types';

let counter = 0;

/** Build a SetFact for tests. Days are UTC-midnight keys, as in the app. */
function fact(p: { workoutId: string; date: string; weightLb?: number; weightKg?: number; reps: number; exerciseId?: string; setNumber?: number }): SetFact {
  const [y, m, d] = p.date.split('-').map(Number);
  const weightKg = p.weightKg ?? (p.weightLb ?? 0) * KG_PER_LB;
  counter += 1;
  return {
    id: `f${counter}`,
    workoutId: p.workoutId,
    exerciseId: p.exerciseId ?? 'bench',
    date: p.date,
    dateMs: Date.UTC(y, m - 1, d),
    setNumber: p.setNumber ?? 1,
    position: (p.setNumber ?? 1) - 1,
    weightKg,
    reps: p.reps,
    rpe: null,
  };
}

const lb = (n: number) => n * KG_PER_LB;

describe('units', () => {
  it('converts kg and lb exactly and round-trips', () => {
    expect(toKg(100, 'lb')).toBeCloseTo(45.359237, 6);
    expect(fromKg(100, 'kg')).toBe(100);
    expect(fromKg(toKg(135, 'lb'), 'lb')).toBeCloseTo(135, 10);
    expect(displayWeight(toKg(135, 'lb'), 'lb')).toBe(135);
    expect(displayWeight(100, 'lb')).toBe(220.5);
    expect(displayWeight(null, 'kg')).toBeNull();
  });

  it('formats weights and volume in the chosen unit', () => {
    expect(formatLift(lb(185), 'lb')).toBe('185 lb');
    expect(formatLift(100, 'kg')).toBe('100 kg');
    expect(formatVolume(lb(185) * 8, 'lb')).toBe('1,480 lb');
  });

  it('parses numeric input safely', () => {
    expect(parseNumberInput('')).toBeNull();
    expect(parseNumberInput('  ')).toBeNull();
    expect(parseNumberInput('abc')).toBeNull();
    expect(parseNumberInput('62,5')).toBe(62.5);
    expect(parseNumberInput('135')).toBe(135);
  });
});

describe('estimated 1RM', () => {
  it('implements Epley and treats a single as the actual max', () => {
    expect(estimate1RM(100, 1)).toBe(100);
    expect(estimate1RM(100, 10)).toBeCloseTo(133.333, 3);
    expect(estimate1RM(lb(185), 8)! / KG_PER_LB).toBeCloseTo(234.33, 2);
  });

  it('implements Brzycki', () => {
    expect(estimate1RM(100, 10, 'brzycki')).toBeCloseTo(133.333, 3);
    expect(estimate1RM(100, 5, 'brzycki')).toBeCloseTo(112.5, 3);
    expect(estimate1RM(100, 37, 'brzycki')).toBeNull();
  });

  it('returns null for bodyweight or invalid sets', () => {
    expect(estimate1RM(0, 10)).toBeNull();
    expect(estimate1RM(100, 0)).toBeNull();
  });

  it('labels confidence by rep range and excludes high-rep sets', () => {
    expect(estimateConfidence(1, 12)).toBe('actual');
    expect(estimateConfidence(3, 12)).toBe('high');
    expect(estimateConfidence(8, 12)).toBe('moderate');
    expect(estimateConfidence(12, 12)).toBe('low');
    expect(estimateConfidence(13, 12)).toBe('excluded');
    expect(eligible1RM(100, 15, 'epley', 12)).toBeNull();
    expect(eligible1RM(100, 12, 'epley', 12)).toBeCloseTo(140, 6);
  });
});

describe('facts', () => {
  const base: FactSet = {
    id: 's1', workoutId: 'w1', exerciseId: 'bench', position: 0, setNumber: 1,
    weightKg: 60, reps: 5, rpe: null, kind: 'working', completed: true,
  };
  it('only counts completed working sets with reps and a weight', () => {
    expect(isCountableSet(base)).toBe(true);
    expect(isCountableSet({ ...base, completed: false })).toBe(false);
    expect(isCountableSet({ ...base, kind: 'warmup' })).toBe(false);
    expect(isCountableSet({ ...base, reps: 0 })).toBe(false);
    expect(isCountableSet({ ...base, reps: null })).toBe(false);
    expect(isCountableSet({ ...base, weightKg: null })).toBe(false);
    expect(isCountableSet({ ...base, weightKg: 0 })).toBe(true); // bodyweight
  });

  it('joins sets to workout dates and drops orphans', () => {
    const w: FactWorkout = { id: 'w1', localDate: '2026-01-05', createdAt: '2026-01-05T17:00:00.000Z' };
    const facts = buildFacts({ workouts: [w], sets: [base, { ...base, id: 's2', workoutId: 'missing' }] });
    expect(facts).toHaveLength(1);
    expect(facts[0].dateMs).toBe(Date.UTC(2026, 0, 5));
    expect(facts[0].date).toBe('2026-01-05');
  });
});

// The example workout from the spec.
const benchDay = [
  fact({ workoutId: 'w1', date: '2026-01-05', weightLb: 135, reps: 12, setNumber: 1 }),
  fact({ workoutId: 'w1', date: '2026-01-05', weightLb: 155, reps: 10, setNumber: 2 }),
  fact({ workoutId: 'w1', date: '2026-01-05', weightLb: 175, reps: 8, setNumber: 3 }),
  fact({ workoutId: 'w1', date: '2026-01-05', weightLb: 185, reps: 6, setNumber: 4 }),
];

describe('sessions and exercise stats', () => {
  it('computes session volume, top set and best e1RM', () => {
    const [s] = buildSessions(benchDay, DEFAULT_CALC);
    expect(s.setCount).toBe(4);
    expect(s.totalReps).toBe(36);
    expect(fromKg(s.volumeKg, 'lb')).toBeCloseTo(135 * 12 + 155 * 10 + 175 * 8 + 185 * 6, 6); // 5,680
    expect(fromKg(s.topWeightKg, 'lb')).toBeCloseTo(185, 6);
    expect(s.topWeightReps).toBe(6);
    // 175×8 → 221.67, 185×6 → 222.0 ⇒ 185×6 wins.
    expect(fromKg(s.bestE1rm!, 'lb')).toBeCloseTo(222, 6);
    expect(s.bestE1rmSet!.reps).toBe(6);
  });

  it('computes lifetime statistics and compares the last two sessions', () => {
    const week2 = [
      fact({ workoutId: 'w2', date: '2026-01-12', weightLb: 135, reps: 12 }),
      fact({ workoutId: 'w2', date: '2026-01-12', weightLb: 185, reps: 7, setNumber: 2 }),
      fact({ workoutId: 'w2', date: '2026-01-12', weightLb: 135, reps: 15, setNumber: 3 }),
    ];
    const stats = computeExerciseStats('bench', [...benchDay, ...week2], DEFAULT_CALC, 'lb');
    expect(stats.sessionCount).toBe(2);
    expect(stats.setCount).toBe(7);
    expect(stats.totalReps).toBe(36 + 34);
    expect(fromKg(stats.heaviest!.value, 'lb')).toBeCloseTo(185, 6);
    expect(stats.heaviest!.workoutId).toBe('w1'); // first time reached
    expect(stats.mostReps!.value).toBe(15);
    expect(fromKg(stats.bestE1rm!.value, 'lb')).toBeCloseTo(185 * (1 + 7 / 30), 6);
    expect(stats.bestE1rm!.workoutId).toBe('w2');
    const at135 = stats.repRecords.find((r) => r.weightKey === 135)!;
    expect(at135.reps).toBe(15);
    expect(stats.comparison!.totalRepsDelta).toBe(34 - 36);
    expect(stats.comparison!.e1rmDeltaKg!).toBeGreaterThan(0);
    expect(stats.avgReps).toBeCloseTo(70 / 7, 6);
  });

  it('never uses sets above the rep cap for e1RM', () => {
    const highRep = [fact({ workoutId: 'w1', date: '2026-01-05', weightLb: 135, reps: 20 })];
    const stats = computeExerciseStats('bench', highRep, DEFAULT_CALC, 'lb');
    expect(stats.bestE1rm).toBeNull();
    expect(stats.sessions[0].bestE1rm).toBeNull();
  });
});

describe('records', () => {
  it('treats the first session as a baseline and fires each record type once per session', () => {
    const facts = [
      ...benchDay,
      fact({ workoutId: 'w2', date: '2026-01-12', weightLb: 190, reps: 5 }),
      fact({ workoutId: 'w2', date: '2026-01-12', weightLb: 195, reps: 3, setNumber: 2 }),
      fact({ workoutId: 'w2', date: '2026-01-12', weightLb: 135, reps: 14, setNumber: 3 }),
    ];
    const events = computeRecordEvents(facts, DEFAULT_CALC, 'lb');
    const w1 = events.filter((e) => e.workoutId === 'w1' && e.type !== 'milestone');
    expect(w1).toHaveLength(0);
    const weight = events.filter((e) => e.type === 'weight');
    expect(weight).toHaveLength(1);
    expect(fromKg(weight[0].value, 'lb')).toBeCloseTo(195, 6);
    expect(fromKg(weight[0].previous!, 'lb')).toBeCloseTo(185, 6);
    const reps = events.filter((e) => e.type === 'reps');
    expect(reps).toHaveLength(1);
    expect(reps[0].value).toBe(14);
    expect(reps[0].previous).toBe(12);
  });

  it('is deterministic — recomputing yields identical keys (no duplicates)', () => {
    const facts = [...benchDay, fact({ workoutId: 'w2', date: '2026-01-12', weightLb: 200, reps: 2 })];
    const a = computeRecordEvents(facts, DEFAULT_CALC, 'lb').map((e) => e.key);
    const b = computeRecordEvents(facts, DEFAULT_CALC, 'lb').map((e) => e.key);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it('updates when history is edited (records are derived, not stored)', () => {
    const facts = [...benchDay, fact({ workoutId: 'w2', date: '2026-01-12', weightLb: 200, reps: 2 })];
    expect(computeRecordEvents(facts, DEFAULT_CALC, 'lb').some((e) => e.type === 'weight')).toBe(true);
    const edited = facts.map((f) => (f.workoutId === 'w2' ? { ...f, weightKg: lb(180) } : f));
    expect(computeRecordEvents(edited, DEFAULT_CALC, 'lb').some((e) => e.type === 'weight')).toBe(false);
  });

  it('emits workout-volume records and lifetime milestones', () => {
    const facts = [
      fact({ workoutId: 'w1', date: '2026-01-05', weightLb: 200, reps: 10 }),
      fact({ workoutId: 'w2', date: '2026-01-07', weightLb: 200, reps: 30 }),
      fact({ workoutId: 'w3', date: '2026-01-09', weightLb: 200, reps: 20 }),
    ];
    const events = computeRecordEvents(facts, DEFAULT_CALC, 'lb');
    const wv = events.filter((e) => e.type === 'workoutVolume');
    expect(wv.map((e) => e.workoutId)).toEqual(['w2']);
    const tenK = events.find((e) => e.key === 'milestone:totalVolume:lb:10000');
    // Running total: 2,000 → 8,000 → 12,000 lb, so 10k is crossed in w3.
    expect(tenK?.workoutId).toBe('w3');
  });
});

describe('aggregation and ranges', () => {
  it('buckets by week with the configured week start and fills empty weeks', () => {
    const facts = [
      fact({ workoutId: 'w1', date: '2026-01-05', weightLb: 100, reps: 10 }), // Monday
      fact({ workoutId: 'w2', date: '2026-01-11', weightLb: 100, reps: 10 }), // Sunday
      fact({ workoutId: 'w3', date: '2026-01-26', weightLb: 100, reps: 10 }),
    ];
    const mon = aggregateByPeriod(facts, (f) => f.dateMs, (f) => f.reps, 'week', 1);
    expect(mon.map((b) => b.value)).toEqual([20, 0, 0, 10]);
    const sun = aggregateByPeriod(facts, (f) => f.dateMs, (f) => f.reps, 'week', 0);
    expect(sun.map((b) => b.value)).toEqual([10, 10, 0, 10]);
    const month = aggregateByPeriod(facts, (f) => f.dateMs, (f) => f.reps, 'month', 1);
    expect(month.map((b) => b.value)).toEqual([30]);
  });

});

describe('streaks', () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`).getTime();
  it('counts consecutive weeks and does not break on an in-progress week', () => {
    const now = new Date('2026-01-27T12:00:00Z'); // Tuesday
    const dates = [d('2026-01-05'), d('2026-01-13'), d('2026-01-20'), d('2026-01-22')];
    const s = computeStreaks(dates, now, 1, 2);
    expect(s.currentWeeks).toBe(3);
    expect(s.longestWeeks).toBe(3);
    expect(s.workoutsThisWeek).toBe(0);
    expect(s.currentTargetWeeks).toBe(1);
    expect(s.daysSinceLast).toBe(5);
  });
  it('handles no data', () => {
    expect(computeStreaks([], new Date(), 1, 3).currentWeeks).toBe(0);
  });
});

describe('insights', () => {
  const series = (n: number, startLb: number, incLb: number, gapDays = 7, reps = 5) =>
    Array.from({ length: n }, (_, i) => {
      const date = new Date(Date.UTC(2026, 0, 5 + i * gapDays));
      const iso = date.toISOString().slice(0, 10);
      return fact({ workoutId: `w${i}`, date: iso, weightLb: startLb + i * incLb, reps });
    });

  it('fits a least-squares line', () => {
    const r = linearRegression([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }])!;
    expect(r.slope).toBeCloseTo(2);
    expect(r.intercept).toBeCloseTo(1);
    expect(r.r2).toBeCloseTo(1);
    expect(linearRegression([{ x: 1, y: 1 }])).toBeNull();
  });

  it('reports insufficient data instead of a trend', () => {
    const t = e1rmTrend(buildSessions(series(3, 200, 5), DEFAULT_CALC));
    expect(t.status).toBe('insufficient');
  });

  it('computes a positive trend for steady progress', () => {
    const t = e1rmTrend(buildSessions(series(8, 200, 5), DEFAULT_CALC));
    expect(t.status).toBe('ok');
    if (t.status === 'ok') expect(t.pctPerMonth).toBeGreaterThan(0.05);
  });

  it('computes period change from first-k vs last-k sessions', () => {
    const sessions = buildSessions(series(6, 200, 5), DEFAULT_CALC);
    const now = new Date(sessions[5].dateMs + 86_400_000);
    const c = periodChange(sessions, 90, now);
    expect(c.status).toBe('ok');
    if (c.status === 'ok') {
      expect(c.k).toBe(2);
      // first 2: max at 205, last 2: max at 225 (same reps) ⇒ +9.76%
      expect(c.pct).toBeCloseTo(225 / 205 - 1, 6);
    }
    expect(periodChange(sessions, 7, now).status).toBe('insufficient');
  });

  it('flags a plateau only with enough flat history', () => {
    const flat = buildSessions(series(8, 200, 0), DEFAULT_CALC);
    const now = new Date(flat[7].dateMs + 86_400_000);
    expect(plateauCheck(flat, now).status).toBe('plateau');
    expect(plateauCheck(flat.slice(0, 4), now).status).toBe('insufficient');
    const rising = buildSessions(series(8, 200, 5), DEFAULT_CALC);
    expect(plateauCheck(rising, new Date(rising[7].dateMs)).status).toBe('progressing');
    expect(plateauCheck(flat, new Date(flat[7].dateMs + 60 * 86_400_000)).status).toBe('inactive');
  });

  it('measures current strength relative to the all-time best', () => {
    const facts = [...series(4, 200, 10)];
    facts.push(fact({ workoutId: 'late', date: '2026-03-01', weightLb: 200, reps: 5 }));
    const sessions = buildSessions(facts, DEFAULT_CALC);
    const r = relativeStrength('bench', sessions, new Date('2026-03-02T12:00:00Z'))!;
    expect(r.ratio).toBeCloseTo(200 / 230, 6);
  });

  it('attributes sets to primary (1) and secondary (0.5) muscles', () => {
    const ex: Exercise = { id: 'bench', name: 'Bench', primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'shoulders'], equipment: 'barbell', category: 'compound' };
    const mv = muscleVolume(benchDay, new Map([['bench', ex]]), { startMs: null, endMs: null }, new Date('2026-01-06T00:00:00Z'));
    const chest = mv.find((m) => m.muscle === 'chest')!;
    expect(chest.sets).toBe(4);
    expect(mv.find((m) => m.muscle === 'triceps')!.sets).toBe(2);
    expect(mv.find((m) => m.muscle === 'triceps')!.volumeKg).toBe(0);
  });
});

describe('dashboard', () => {
  it('totals counts only real data', () => {
    expect(computeTotals([])).toEqual({ workouts: 0, sets: 0, reps: 0, volumeKg: 0, exercises: 0 });
    const t = computeTotals(benchDay);
    expect(t.workouts).toBe(1);
    expect(t.sets).toBe(4);
    expect(fromKg(t.volumeKg, 'lb')).toBeCloseTo(5680, 6);
  });

  it('compares this week with last week', () => {
    const facts = [
      fact({ workoutId: 'a', date: '2026-01-06', weightLb: 200, reps: 5 }),
      fact({ workoutId: 'b', date: '2026-01-08', weightLb: 200, reps: 5 }),
      fact({ workoutId: 'c', date: '2026-01-13', weightLb: 210, reps: 5 }),
    ];
    const cmp = compareWeeks(facts, new Date('2026-01-14T12:00:00Z'), 1, DEFAULT_CALC, ['bench']);
    expect(cmp.thisWeek.workouts).toBe(1);
    expect(cmp.lastWeek.workouts).toBe(2);
    expect(cmp.dayOfWeek).toBe(3);
    // Same point last week = Mon–Wed noon: only the Tuesday workout counts.
    expect(cmp.lastWeekToDate.workouts).toBe(1);
    expect(fromKg(cmp.exercises[0].thisWeekE1rm!, 'lb')).toBeCloseTo(210 * (1 + 5 / 30), 6);
    expect(fromKg(cmp.exercises[0].lastWeekE1rm!, 'lb')).toBeCloseTo(200 * (1 + 5 / 30), 6);
  });

  it('summarizes workouts', () => {
    const s = summarizeWorkouts(benchDay);
    expect(s).toHaveLength(1);
    expect(s[0].exerciseIds).toEqual(['bench']);
  });
});

describe('period start', () => {
  it('respects Sunday vs Monday week start', () => {
    const wed = new Date('2026-01-07T12:00:00Z').getTime();
    expect(new Date(periodStart(wed, 'week', 1)).getUTCDay()).toBe(1);
    expect(new Date(periodStart(wed, 'week', 0)).getUTCDay()).toBe(0);
  });
});

describe('daylight saving time', () => {
  it('keeps weekly buckets and streaks contiguous across DST changes', () => {
    // US DST starts Mar 8 2026 and ends Nov 1 2026; EU on Mar 29 / Oct 25.
    const dates = ['2026-02-23', '2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30', '2026-04-06'].map((s) => new Date(`${s}T00:00:00Z`).getTime());
    const s = computeStreaks(dates, new Date('2026-04-07T12:00:00Z'), 1, 1);
    expect(s.currentWeeks).toBe(7);
    expect(s.longestWeeks).toBe(7);
    const facts = dates.map((_, i) => fact({ workoutId: `w${i}`, date: ['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'][i], weightLb: 100, reps: 1 }));
    const weeks = aggregateByPeriod(facts, (f) => f.dateMs, () => 1, 'week', 1);
    expect(weeks.map((w) => w.value)).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });
});

describe('review regressions', () => {
  it('session-volume records keep one key as more sets are added', () => {
    const base = [fact({ workoutId: 'w1', date: '2026-01-05', weightLb: 100, reps: 10 })];
    const today = (n: number) => Array.from({ length: n }, (_, i) => fact({ workoutId: 'w2', date: '2026-01-12', weightLb: 100, reps: 5, setNumber: i + 1 }));
    const keys = (n: number) => computeRecordEvents([...base, ...today(n)], DEFAULT_CALC, 'lb').filter((e) => e.type === 'sessionVolume').map((e) => e.key);
    expect(keys(3)).toEqual(keys(5));
    expect(keys(3)).toHaveLength(1);
  });

  it('record keys do not depend on the display unit', () => {
    const facts = [
      fact({ workoutId: 'w1', date: '2026-01-05', weightKg: 100, reps: 5 }),
      fact({ workoutId: 'w2', date: '2026-01-12', weightKg: 100, reps: 6 }),
      fact({ workoutId: 'w2', date: '2026-01-12', weightKg: 105, reps: 3, setNumber: 2 }),
    ];
    const nonMilestone = (u: 'kg' | 'lb') => computeRecordEvents(facts, DEFAULT_CALC, u).filter((e) => e.type !== 'milestone').map((e) => e.key).sort();
    expect(nonMilestone('lb')).toEqual(nonMilestone('kg'));
  });

  it('the same plates entered in kg then lb are not a new record', () => {
    const facts = [
      fact({ workoutId: 'w1', date: '2026-01-05', weightKg: 100, reps: 5 }),
      fact({ workoutId: 'w2', date: '2026-01-12', weightLb: 220.5, reps: 5 }), // 100.017 kg
    ];
    const events = computeRecordEvents(facts, DEFAULT_CALC, 'lb').filter((e) => e.type !== 'milestone');
    expect(events).toEqual([]);
  });

  it('a decline after an earlier best is reported as declining, not progressing', () => {
    const vals = [100, 102, 104, 110, 104, 100, 96, 92];
    const facts = vals.map((w, i) => {
      const d = new Date(Date.UTC(2026, 0, 5 + i * 7));
      const iso = d.toISOString().slice(0, 10);
      return fact({ workoutId: `w${i}`, date: iso, weightKg: w, reps: 1 });
    });
    const sessions = buildSessions(facts, DEFAULT_CALC);
    const r = plateauCheck(sessions, new Date(sessions[sessions.length - 1].dateMs + 86_400_000));
    expect(r.status).toBe('declining');
  });

  it('a new best in the last two sessions is progressing', () => {
    const vals = [100, 100, 100, 100, 100, 100, 100, 103];
    const facts = vals.map((w, i) => {
      const d = new Date(Date.UTC(2026, 0, 5 + i * 7));
      const iso = d.toISOString().slice(0, 10);
      return fact({ workoutId: `w${i}`, date: iso, weightKg: w, reps: 1 });
    });
    const sessions = buildSessions(facts, DEFAULT_CALC);
    expect(plateauCheck(sessions, new Date(sessions[7].dateMs)).status).toBe('progressing');
  });

  it('day-of-week never exceeds 7, even across a DST change', () => {
    for (let h = 0; h < 8 * 24; h += 1) {
      const now = new Date(Date.UTC(2026, 9, 26, 0, 30 + h * 60)); // day keys are UTC, so DST never shifts buckets
      const cmp = compareWeeks([], now, 1, DEFAULT_CALC, []);
      expect(cmp.dayOfWeek).toBeGreaterThanOrEqual(1);
      expect(cmp.dayOfWeek).toBeLessThanOrEqual(7);
    }
  });
});
