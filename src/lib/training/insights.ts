import type { Exercise, MuscleGroup, ResolvedRange, SetFact } from './types';
import type { ExerciseSession } from './sessions';
import { dayStart } from './aggregate';

const DAY = 86_400_000;
const DAYS_PER_MONTH = 30.4375;

export interface Regression {
  slope: number;
  intercept: number;
  r2: number;
}

/** Ordinary least squares. Returns null for fewer than two points or zero x-variance. */
export function linearRegression(points: { x: number; y: number }[]): Regression | null {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2 };
}

function withE1rm(sessions: ExerciseSession[]) {
  return sessions.filter((s): s is ExerciseSession & { bestE1rm: number } => s.bestE1rm != null);
}

export type TrendResult =
  | { status: 'insufficient'; reason: string; sessions: number }
  | {
      status: 'ok';
      sessions: number;
      spanDays: number;
      /** Fitted change per month as a fraction of the fitted starting value. */
      pctPerMonth: number;
      kgPerMonth: number;
      startFit: number;
      endFit: number;
      r2: number;
    };

/**
 * Trend of the best estimated 1RM per session, fitted with a least-squares line.
 * Requires enough sessions over enough time that one good or bad day can't
 * dominate the result.
 */
export function e1rmTrend(sessions: ExerciseSession[], minSessions = 4, minSpanDays = 21): TrendResult {
  const pts = withE1rm(sessions);
  if (pts.length < minSessions) {
    return { status: 'insufficient', sessions: pts.length, reason: `Needs at least ${minSessions} sessions with an estimable 1RM (has ${pts.length}).` };
  }
  const t0 = pts[0].dateMs;
  const spanDays = (pts[pts.length - 1].dateMs - t0) / DAY;
  if (spanDays < minSpanDays) {
    return { status: 'insufficient', sessions: pts.length, reason: `Sessions span ${Math.round(spanDays)} days; a trend needs at least ${minSpanDays}.` };
  }
  const reg = linearRegression(pts.map((s) => ({ x: (s.dateMs - t0) / DAY, y: s.bestE1rm })));
  if (!reg) return { status: 'insufficient', sessions: pts.length, reason: 'Not enough variation in dates to fit a trend.' };
  const startFit = reg.intercept;
  const endFit = reg.intercept + reg.slope * spanDays;
  const base = startFit > 0 ? startFit : pts.reduce((a, s) => a + s.bestE1rm, 0) / pts.length;
  const kgPerMonth = reg.slope * DAYS_PER_MONTH;
  return { status: 'ok', sessions: pts.length, spanDays, pctPerMonth: kgPerMonth / base, kgPerMonth, startFit, endFit, r2: reg.r2 };
}

export type ChangeResult =
  | { status: 'insufficient'; reason: string; sessions: number }
  | { status: 'ok'; pct: number; baseline: number; current: number; k: number; sessions: number; explanation: string };

/**
 * Strength change over the last `days` days: the best estimated 1RM of the last k
 * sessions in the window vs. the first k sessions in the window, where k grows with
 * the amount of data (1–3) to smooth out single-session noise.
 */
export function periodChange(sessions: ExerciseSession[], days: number, now: Date = new Date()): ChangeResult {
  // "Last N days" includes today, matching the date-range filters.
  const start = dayStart(now.getTime()) - (days - 1) * DAY;
  const pts = withE1rm(sessions).filter((s) => s.dateMs >= start && s.dateMs < dayStart(now.getTime()) + DAY);
  const n = pts.length;
  if (n < 3) {
    return { status: 'insufficient', sessions: n, reason: `Needs 3+ sessions in the last ${days} days (has ${n}).` };
  }
  const span = (pts[n - 1].dateMs - pts[0].dateMs) / DAY;
  const minSpan = Math.round(days / 4);
  if (span < minSpan) {
    return { status: 'insufficient', sessions: n, reason: `Sessions span ${Math.round(span)} days; needs at least ${minSpan} for a ${days}-day comparison.` };
  }
  const k = Math.min(3, Math.max(1, Math.floor(n / 3)));
  const baseline = Math.max(...pts.slice(0, k).map((s) => s.bestE1rm));
  const current = Math.max(...pts.slice(n - k).map((s) => s.bestE1rm));
  const plural = k === 1 ? 'session' : `${k} sessions`;
  return {
    status: 'ok',
    pct: (current - baseline) / baseline,
    baseline,
    current,
    k,
    sessions: n,
    explanation: `Best estimated 1RM of your latest ${plural} vs. your earliest ${plural} in the last ${days} days (${n} sessions).`,
  };
}

export type PlateauStatus = 'insufficient' | 'inactive' | 'progressing' | 'plateau' | 'declining';

export interface PlateauResult {
  status: PlateauStatus;
  explanation: string;
  pctPerMonth?: number;
  recentBest?: number;
  previousBest?: number | null;
}

const PLATEAU_WINDOW = 6;
const PLATEAU_MIN_SPAN_DAYS = 21;
const TREND_THRESHOLD = 0.015; // ±1.5% per month counts as "moving"
const RECENT_BEST_SESSIONS = 2;

/**
 * Conservative plateau check over the last 6 sessions (spanning 3+ weeks), in order:
 * 1. progressing — one of the last 2 sessions set a new best e1RM (>1% above every earlier session)
 * 2. declining   — the trend over the 6 sessions is steeper than −1.5%/month
 * 3. progressing — the trend is rising faster than +1.5%/month
 * 4. plateau     — otherwise: flat trend and no new best recently
 * Anything with less history is reported as insufficient data rather than guessed.
 */
export function plateauCheck(sessions: ExerciseSession[], now: Date = new Date()): PlateauResult {
  const pts = withE1rm(sessions);
  if (!pts.length) return { status: 'insufficient', explanation: 'No sets with an estimable 1RM yet.' };
  const daysSinceLast = (dayStart(now.getTime()) - dayStart(pts[pts.length - 1].dateMs)) / DAY;
  if (daysSinceLast > 42) {
    return { status: 'inactive', explanation: `Not trained in the last ${Math.floor(daysSinceLast)} days — no current trend to judge.` };
  }
  if (pts.length < PLATEAU_WINDOW) {
    return { status: 'insufficient', explanation: `Needs ${PLATEAU_WINDOW} sessions to judge a plateau (has ${pts.length}).` };
  }
  const recent = pts.slice(-PLATEAU_WINDOW);
  const span = (recent[recent.length - 1].dateMs - recent[0].dateMs) / DAY;
  if (span < PLATEAU_MIN_SPAN_DAYS) {
    return { status: 'insufficient', explanation: `Last ${PLATEAU_WINDOW} sessions span only ${Math.round(span)} days; needs ${PLATEAU_MIN_SPAN_DAYS}+.` };
  }
  const latest = pts.slice(-RECENT_BEST_SESSIONS);
  const before = pts.slice(0, -RECENT_BEST_SESSIONS);
  const previousBest = Math.max(...before.map((s) => s.bestE1rm));
  const recentBest = Math.max(...latest.map((s) => s.bestE1rm));
  const trend = e1rmTrend(recent, PLATEAU_WINDOW, PLATEAU_MIN_SPAN_DAYS);
  const pctPerMonth = trend.status === 'ok' ? trend.pctPerMonth : 0;
  const weeks = Math.round(span / 7);
  const base = { pctPerMonth, recentBest, previousBest };

  if (recentBest > previousBest * 1.01) {
    return { ...base, status: 'progressing', explanation: `New best estimated 1RM in your last ${RECENT_BEST_SESSIONS} sessions.` };
  }
  if (pctPerMonth < -TREND_THRESHOLD) {
    return { ...base, status: 'declining', explanation: `Estimated 1RM trending down over the last ${PLATEAU_WINDOW} sessions (${weeks} weeks). Could reflect a deload, fatigue, or a switch to higher reps.` };
  }
  if (pctPerMonth > TREND_THRESHOLD) {
    return { ...base, status: 'progressing', explanation: `Estimated 1RM trending up over the last ${PLATEAU_WINDOW} sessions (${weeks} weeks).` };
  }
  return { ...base, status: 'plateau', explanation: `Flat trend across the last ${PLATEAU_WINDOW} sessions (${weeks} weeks) and no new best in the last ${RECENT_BEST_SESSIONS}.` };
}

export interface RelativeStrength {
  exerciseId: string;
  allTimeBest: number;
  recentBest: number;
  ratio: number;
}

/**
 * Current strength relative to your own peak: best e1RM in the last 30 days as a
 * fraction of the all-time best. Needs 3+ sessions overall and one in the last 30 days.
 */
export function relativeStrength(exerciseId: string, sessions: ExerciseSession[], now: Date = new Date(), recentDays = 30): RelativeStrength | null {
  const pts = withE1rm(sessions);
  if (pts.length < 3) return null;
  const start = dayStart(now.getTime()) - (recentDays - 1) * DAY;
  const recent = pts.filter((s) => s.dateMs >= start);
  if (!recent.length) return null;
  const allTimeBest = Math.max(...pts.map((s) => s.bestE1rm));
  const recentBest = Math.max(...recent.map((s) => s.bestE1rm));
  return { exerciseId, allTimeBest, recentBest, ratio: recentBest / allTimeBest };
}

export interface MuscleVolume {
  muscle: MuscleGroup;
  /** Hard sets: 1 per set for the primary muscle, 0.5 for each secondary muscle. */
  sets: number;
  /** Weight × reps, attributed to the primary muscle only. */
  volumeKg: number;
  /** Distinct sessions (workouts) that trained this muscle as primary. */
  sessions: number;
  setsPerWeek: number;
  volumePerWeekKg: number;
}

export function muscleVolume(facts: SetFact[], exercises: Map<string, Exercise>, range: ResolvedRange, now: Date = new Date()): MuscleVolume[] {
  const map = new Map<MuscleGroup, { sets: number; volumeKg: number; workouts: Set<string> }>();
  const get = (m: MuscleGroup) => {
    let v = map.get(m);
    if (!v) map.set(m, (v = { sets: 0, volumeKg: 0, workouts: new Set() }));
    return v;
  };
  let first = Infinity;
  for (const f of facts) {
    const ex = exercises.get(f.exerciseId);
    if (!ex) continue;
    first = Math.min(first, f.dateMs);
    const p = get(ex.primaryMuscle);
    p.sets += 1;
    p.volumeKg += f.weightKg * f.reps;
    p.workouts.add(f.workoutId);
    for (const m of ex.secondaryMuscles) if (m !== ex.primaryMuscle) get(m).sets += 0.5;
  }
  const start = range.startMs ?? (Number.isFinite(first) ? first : now.getTime());
  const end = Math.min(range.endMs ?? now.getTime(), now.getTime());
  const weeks = Math.max(1, (end - start) / (7 * DAY));
  return [...map.entries()]
    .map(([muscle, v]) => ({
      muscle,
      sets: v.sets,
      volumeKg: v.volumeKg,
      sessions: v.workouts.size,
      setsPerWeek: v.sets / weeks,
      volumePerWeekKg: v.volumeKg / weeks,
    }))
    .sort((a, b) => b.sets - a.sets);
}
