import { DAY_MS, dayStart, nextPeriod, periodStart } from './aggregate';

export interface StreakInfo {
  /** Consecutive weeks (ending this week or last week) with at least one workout. */
  currentWeeks: number;
  longestWeeks: number;
  /** Consecutive weeks meeting the weekly workout target. */
  currentTargetWeeks: number;
  workoutsThisWeek: number;
  daysSinceLast: number | null;
}

/**
 * Weekly streaks suit strength training better than daily ones — rest days are part
 * of the plan. The current week never breaks a streak while it is still in progress:
 * if you have not trained yet this week, the streak counts through last week.
 */
export function computeStreaks(workoutDatesMs: number[], now: Date, weekStartsOn: 0 | 1, weeklyTarget: number): StreakInfo {
  if (!workoutDatesMs.length) {
    return { currentWeeks: 0, longestWeeks: 0, currentTargetWeeks: 0, workoutsThisWeek: 0, daysSinceLast: null };
  }
  const perWeek = new Map<number, number>();
  for (const ms of workoutDatesMs) {
    const w = periodStart(ms, 'week', weekStartsOn);
    perWeek.set(w, (perWeek.get(w) ?? 0) + 1);
  }
  const thisWeek = periodStart(now.getTime(), 'week', weekStartsOn);
  const lastWeek = periodStart(thisWeek - 1, 'week', weekStartsOn);

  const countBack = (from: number, ok: (n: number) => boolean) => {
    let n = 0;
    let w = from;
    while (ok(perWeek.get(w) ?? 0)) {
      n += 1;
      w = periodStart(w - 1, 'week', weekStartsOn);
    }
    return n;
  };

  const hasAny = (n: number) => n > 0;
  const currentWeeks = countBack(perWeek.has(thisWeek) ? thisWeek : lastWeek, hasAny);
  const meets = (n: number) => n >= Math.max(1, weeklyTarget);
  const currentTargetWeeks = countBack(meets(perWeek.get(thisWeek) ?? 0) ? thisWeek : lastWeek, meets);

  // Longest run of consecutive weeks with a workout.
  const weeks = [...perWeek.keys()].sort((a, b) => a - b);
  let longestWeeks = 0;
  let run = 0;
  let prev: number | null = null;
  for (const w of weeks) {
    run = prev != null && nextPeriod(prev, 'week') === w ? run + 1 : 1;
    longestWeeks = Math.max(longestWeeks, run);
    prev = w;
  }

  const last = Math.max(...workoutDatesMs);
  return {
    currentWeeks,
    longestWeeks,
    currentTargetWeeks,
    workoutsThisWeek: perWeek.get(thisWeek) ?? 0,
    daysSinceLast: Math.max(0, Math.round((dayStart(now.getTime()) - dayStart(last)) / DAY_MS)),
  };
}
