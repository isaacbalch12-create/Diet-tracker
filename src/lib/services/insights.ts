/**
 * Cross-domain insights and period summaries, computed only from recorded data.
 *
 * Every insight is labeled:
 * - measured:    counts and averages of what you logged or synced
 * - estimate:    derived from a model (estimated 1RM, energy balance, projections)
 * - observation: a pattern/association in your data — never presented as cause
 * Insights never push more training or less food: recovery and safety cautions
 * take priority, and thin data is reported as "not enough data" instead of guessed.
 */
import type { DbOrTx } from "../db";
import type { Settings } from "../db/schema";
import { analyzeRelationship } from "../analytics/relationship";
import { formatSleepMinutes } from "../health/metrics";
import { goalForDate, goalTargets, evaluateGoal as evaluateNutrient } from "../nutrition/goals";
import { classifyDays, consistency, runStreaks } from "../running/stats";
import { addDays, eachDate, type LocalDate } from "../time";
import { buildSessions } from "../training/sessions";
import { groupByExercise } from "../training/facts";
import { e1rmTrend, plateauCheck } from "../training/insights";
import { dateToMs } from "../training/aggregate";
import { formatWeight, formatWeightDelta } from "../units";
import { buildDailyMap, dailySeries, linearTrend } from "../weight/stats";
import { goalsWithProgress } from "./goals";
import { listHealth, metricByDate } from "./health";
import { routineStats } from "./routines";
import { listRuns, toRunLike, dailyRunGoal } from "./running";
import { listGoals as nutritionVersions, toGoalVersion } from "./settings";
import { nutritionDays } from "./stats";
import { loadTrainingData } from "./training";
import { listWeights } from "./weights";

export type InsightKind = "measured" | "estimate" | "observation";
export type InsightTone = "positive" | "neutral" | "attention" | "caution";
export type InsightDomain = "nutrition" | "body" | "training" | "running" | "health" | "routines" | "goals";

export interface Insight {
  id: string;
  domain: InsightDomain;
  kind: InsightKind;
  tone: InsightTone;
  title: string;
  detail: string;
}

export interface PeriodSummary {
  label: string;
  range: { start: LocalDate; end: LocalDate };
  days: number;
  nutrition: { loggedDays: number; avgCalories: number | null; avgProtein: number | null; proteinTargetDays: number | null };
  body: { startKg: number | null; endKg: number | null; changeKg: number | null; weighInDays: number };
  training: { workouts: number; sets: number; volumeKg: number };
  running: { runDays: number; distanceM: number; restDays: number; consistencyPct: number | null };
  health: { avgSteps: number | null; stepDays: number; avgSleepMin: number | null; sleepDays: number };
  routines: { morningPct: number | null; nightPct: number | null; journalDays: number; readingTotal: number };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);

interface Loaded {
  days: Awaited<ReturnType<typeof nutritionDays>>;
  versions: ReturnType<typeof toGoalVersion>[];
  weights: Awaited<ReturnType<typeof listWeights>>;
  training: Awaited<ReturnType<typeof loadTrainingData>>;
  runs: Awaited<ReturnType<typeof listRuns>>;
  runGoal: Awaited<ReturnType<typeof dailyRunGoal>>;
  health: Awaited<ReturnType<typeof listHealth>>;
}

async function load(db: DbOrTx, s: Settings, start: LocalDate, end: LocalDate): Promise<Loaded> {
  const [days, versions, weights, training, runs, runGoal, health] = await Promise.all([
    nutritionDays(db, { start, end }),
    nutritionVersions(db).then((v) => v.map(toGoalVersion)),
    listWeights(db, { start: addDays(start, -7), end }),
    loadTrainingData(db, s),
    listRuns(db, { end }),
    dailyRunGoal(db),
    listHealth(db, { start: addDays(start, -1), end }),
  ]);
  return { days, versions, weights, training, runs, runGoal, health };
}

function summarize(label: string, range: { start: LocalDate; end: LocalDate }, l: Loaded, routines: Awaited<ReturnType<typeof routineStats>>, today: LocalDate): PeriodSummary {
  const inR = (d: LocalDate) => d >= range.start && d <= range.end;
  const nd = l.days.filter((d) => inR(d.date) && d.mealCount > 0);
  const proteinDays = nd.filter((d) => {
    const t = goalTargets(goalForDate(l.versions, d.date)).protein;
    return t != null;
  });
  const proteinMet = proteinDays.filter((d) => (d.totals.values.protein ?? 0) >= (goalTargets(goalForDate(l.versions, d.date)).protein ?? Infinity)).length;
  const wmap = buildDailyMap(l.weights.map((w) => ({ localDate: w.localDate, period: w.period, weightKg: w.weightKg })));
  const wdays = [...wmap.values()].filter((w) => inR(w.date) && w.average != null).sort((a, b) => a.date.localeCompare(b.date));
  const facts = l.training.facts.filter((f) => inR(f.date));
  const runDays = classifyDays(l.runs.map(toRunLike), range.start, range.end, today, l.runGoal?.minDistanceM ?? null);
  const firstRun = l.runs[0]?.localDate ?? null;
  const trackedRunDays = runDays.filter((d) => !firstRun || d.date >= firstRun);
  const steps = [...metricByDate(l.health, "steps").entries()].filter(([d]) => inR(d)).map(([, v]) => v);
  const sleep = [...metricByDate(l.health, "sleep").entries()].filter(([d]) => inR(d)).map(([, v]) => v);
  return {
    label,
    range,
    days: eachDate(range.start, range.end).length,
    nutrition: {
      loggedDays: nd.length,
      avgCalories: mean(nd.map((d) => d.totals.values.calories).filter((x): x is number => x != null)),
      avgProtein: mean(nd.map((d) => d.totals.values.protein).filter((x): x is number => x != null)),
      proteinTargetDays: proteinDays.length ? proteinMet : null,
    },
    body: {
      startKg: wdays[0]?.average ?? null,
      endKg: wdays.at(-1)?.average ?? null,
      changeKg: wdays.length >= 2 ? wdays.at(-1)!.average! - wdays[0].average! : null,
      weighInDays: wdays.length,
    },
    training: { workouts: new Set(facts.map((f) => f.workoutId)).size, sets: facts.length, volumeKg: facts.reduce((a, f) => a + f.weightKg * f.reps, 0) },
    running: {
      runDays: trackedRunDays.filter((d) => d.status === "done" || d.status === "short").length,
      distanceM: trackedRunDays.reduce((a, d) => a + d.distanceM, 0),
      restDays: trackedRunDays.filter((d) => d.status === "rest" || d.status === "recovery").length,
      consistencyPct: consistency(trackedRunDays).pct,
    },
    health: { avgSteps: mean(steps), stepDays: steps.length, avgSleepMin: mean(sleep), sleepDays: sleep.length },
    routines: {
      morningPct: routines.morning.completionPct,
      nightPct: routines.night.completionPct,
      journalDays: routines.journaling.days,
      readingTotal: routines.reading.total,
    },
  };
}

/** Insights over the last `days` days (default 30) plus daily/weekly/monthly summaries. */
export async function computeInsights(db: DbOrTx, s: Settings, today: LocalDate, days = 30) {
  const end = today;
  const start = addDays(today, -(days - 1));
  const prevStart = addDays(start, -days);
  const l = await load(db, s, addDays(prevStart, -1), end);
  const [routines, routinesWeek, goals] = await Promise.all([
    routineStats(db, { start, end }, s.weekStartsOn, today),
    routineStats(db, { start: addDays(today, -6), end }, s.weekStartsOn, today),
    goalsWithProgress(db, s, today, { includeLinked: true, recent: 30 }),
  ]);
  const routinesDay = await routineStats(db, { start: today, end: today }, s.weekStartsOn, today);
  const unit = s.weightUnit;
  const out: Insight[] = [];
  const inR = (d: LocalDate) => d >= start && d <= end;

  // --- Nutrition ------------------------------------------------------------
  const logged = l.days.filter((d) => inR(d.date) && d.mealCount > 0);
  const withProteinTarget = logged.filter((d) => goalTargets(goalForDate(l.versions, d.date)).protein);
  if (withProteinTarget.length >= 5) {
    const met = withProteinTarget.filter((d) => (d.totals.values.protein ?? 0) >= goalTargets(goalForDate(l.versions, d.date)).protein!).length;
    const share = met / withProteinTarget.length;
    out.push({
      id: "protein-adherence",
      domain: "nutrition",
      kind: "measured",
      tone: share >= 0.8 ? "positive" : share >= 0.5 ? "neutral" : "attention",
      title: share >= 0.8 ? "Protein target met consistently" : "Protein target often missed",
      detail: `You reached your protein target on ${met} of ${withProteinTarget.length} logged days (${pct(share)}) in the last ${days} days.`,
    });
  }
  const withCalTarget = logged.filter((d) => goalTargets(goalForDate(l.versions, d.date)).calories && d.totals.values.calories != null);
  if (withCalTarget.length >= 5) {
    const within = withCalTarget.filter((d) => evaluateNutrient("calories", d.totals.values.calories!, goalTargets(goalForDate(l.versions, d.date)).calories!).met).length;
    out.push({ id: "calorie-adherence", domain: "nutrition", kind: "measured", tone: within / withCalTarget.length >= 0.7 ? "positive" : "neutral", title: "Calorie target adherence", detail: `${within} of ${withCalTarget.length} logged days were within ±10% of your calorie target.` });
  }
  const avgCal = mean(logged.map((d) => d.totals.values.calories).filter((x): x is number => x != null));
  if (avgCal != null && logged.length >= 5 && avgCal < 1200) {
    out.push({
      id: "low-intake",
      domain: "nutrition",
      kind: "measured",
      tone: "caution",
      title: "Very low average intake",
      detail: `Logged days averaged ${Math.round(avgCal)} kcal. If that reflects what you actually ate (not missed logs), intake this low is hard to sustain and can affect recovery and health — consider talking with a doctor or dietitian before continuing.`,
    });
  }
  // Calories vs weight goal, using the existing relationship analysis.
  const weightDays = dailySeries(l.weights.map((w) => ({ localDate: w.localDate, period: w.period, weightKg: w.weightKg })), start, end);
  const rel = analyzeRelationship(l.days, weightDays, { start, end }, { weekStartsOn: s.weekStartsOn, formatWeight: (kg) => formatWeight(kg, unit, 2) });
  const trend = linearTrend(weightDays.filter((d) => d.average != null), 8);
  if (trend && s.targetWeightKg) {
    const latest = weightDays.filter((d) => d.average != null).at(-1)?.average ?? null;
    if (latest != null) {
      const wantLoss = latest > s.targetWeightKg + 0.25;
      const wantGain = latest < s.targetWeightKg - 0.25;
      const moving = trend.slopePerWeek;
      const aligned = (wantLoss && moving < -0.05) || (wantGain && moving > 0.05) || (!wantLoss && !wantGain && Math.abs(moving) < 0.15);
      out.push({
        id: "weight-vs-goal",
        domain: "body",
        kind: "estimate",
        tone: aligned ? "positive" : "attention",
        title: aligned ? "Weight trend is moving toward your target" : "Weight trend isn't moving toward your target",
        detail: `Your weight trend is ${formatWeightDelta(moving, unit)}/week (fitted over ${trend.n} weigh-in days); target ${formatWeight(s.targetWeightKg, unit)}, latest average ${formatWeight(latest, unit)}.${avgCal != null ? ` Average logged intake: ${Math.round(avgCal)} kcal.` : ""}${rel.energyBalance ? ` Rough maintenance estimate ≈ ${Math.round(rel.energyBalance.estimatedMaintenance / 50) * 50} kcal/day (assumes complete logging).` : ""}`,
      });
      if (latest > 0 && wantLoss && moving < 0 && Math.abs(moving) / latest > 0.01) {
        out.push({ id: "fast-loss", domain: "body", kind: "estimate", tone: "caution", title: "Losing weight quickly", detail: `Your trend is losing more than 1% of body weight per week. Faster loss tends to cost muscle and energy; a slower pace is usually easier to sustain.` });
      }
    }
  }
  for (const o of rel.observations.filter((x) => x.kind === "pattern")) out.push({ id: `rel-${out.length}`, domain: "body", kind: "observation", tone: "neutral", title: "Calories and weight", detail: o.text });

  // --- Training -------------------------------------------------------------
  const byEx = groupByExercise(l.training.facts);
  const exName = new Map(l.training.exercises.map((e) => [e.id, e.name]));
  const startMs = dateToMs(start);
  const improving: { name: string; pct: number }[] = [];
  const stalled: { name: string; status: string }[] = [];
  const nowDate = new Date(dateToMs(today) + 12 * 3600_000);
  for (const [id, facts] of byEx) {
    const sessions = buildSessions(facts, l.training.calc);
    if (!sessions.some((x) => x.dateMs >= startMs)) continue;
    const t = e1rmTrend(sessions.filter((x) => x.dateMs >= dateToMs(addDays(today, -90))));
    if (t.status === "ok" && t.pctPerMonth > 0.015) improving.push({ name: exName.get(id) ?? id, pct: t.pctPerMonth });
    const p = plateauCheck(sessions, nowDate);
    if (p.status === "plateau" || p.status === "declining") stalled.push({ name: exName.get(id) ?? id, status: p.status });
  }
  improving.sort((a, b) => b.pct - a.pct);
  if (improving.length) {
    out.push({ id: "improving-lifts", domain: "training", kind: "estimate", tone: "positive", title: "Lifts that are improving", detail: improving.slice(0, 4).map((x) => `${x.name} (+${(x.pct * 100).toFixed(1)}%/month est. 1RM)`).join(", ") + ". Trends use estimated 1RM over the last 90 days." });
  }
  if (stalled.length) {
    out.push({ id: "stalled-lifts", domain: "training", kind: "estimate", tone: "neutral", title: "Lifts that have stalled", detail: `${stalled.slice(0, 4).map((x) => `${x.name} (${x.status === "plateau" ? "flat" : "trending down"})`).join(", ")}. Common causes include accumulated fatigue, sleep, or eating below maintenance — a lighter week can help as much as pushing harder.` });
  }

  // --- Running --------------------------------------------------------------
  if (l.runs.length) {
    const minM = l.runGoal?.minDistanceM ?? null;
    const first = l.runs[0].localDate;
    const cur = classifyDays(l.runs.map(toRunLike), start < first ? first : start, end, today, minM);
    const prev = first <= addDays(start, -1) ? classifyDays(l.runs.map(toRunLike), prevStart < first ? first : prevStart, addDays(start, -1), today, minM) : [];
    const c1 = consistency(cur);
    const c0 = prev.length ? consistency(prev) : null;
    if (c1.eligible >= 5) {
      const delta = c0?.pct != null && c1.pct != null ? c1.pct - c0.pct : null;
      out.push({
        id: "run-consistency",
        domain: "running",
        kind: "measured",
        tone: delta != null && delta <= -0.05 ? "attention" : (c1.pct ?? 0) >= 0.8 ? "positive" : "neutral",
        title: delta == null ? "Running consistency" : delta >= 0.05 ? "Running consistency is improving" : delta <= -0.05 ? "Running consistency dipped" : "Running consistency is steady",
        detail: `You ran on ${c1.done} of ${c1.eligible} days (${pct(c1.pct)}) in the last ${days} days${c0?.pct != null ? `, vs ${pct(c0.pct)} the ${days} days before` : ""}. ${c1.rest + c1.recovery} planned rest/recovery day${c1.rest + c1.recovery === 1 ? "" : "s"} were excluded.`,
      });
    }
    const all = classifyDays(l.runs.map(toRunLike), first, today, today, minM);
    const streaks = runStreaks(all);
    if (streaks.daysWithoutRest >= 10) {
      out.push({ id: "recovery", domain: "running", kind: "measured", tone: "caution", title: "Plan a recovery day", detail: `You've run ${streaks.daysWithoutRest} days in a row without a rest or recovery day. Marking a planned recovery day keeps your streak intact — and pain, unusual soreness or fatigue are signals to rest, not push through.` });
    }
    const recentEfforts = l.runs.filter((r) => r.kind === "run" && r.effort != null && r.localDate >= addDays(today, -6)).map((r) => r.effort!);
    if (recentEfforts.length >= 4 && mean(recentEfforts)! >= 8) {
      out.push({ id: "effort", domain: "running", kind: "measured", tone: "caution", title: "Most recent runs felt very hard", detail: `Average perceived effort over the last week was ${mean(recentEfforts)!.toFixed(1)}/10. Mixing in easy runs supports daily consistency and recovery.` });
    }
  }

  // --- Health ---------------------------------------------------------------
  const steps = metricByDate(l.health, "steps");
  const stepVals = [...steps.entries()].filter(([d]) => inR(d));
  const stepGoal = goals.find((g) => g.metric === "steps" && g.status === "active" && g.period === "daily");
  if (stepVals.length >= 5) {
    if (stepGoal) {
      const met = stepVals.filter(([, v]) => v >= stepGoal.targetValue).length;
      out.push({ id: "steps-goal", domain: "health", kind: "measured", tone: met / stepVals.length >= 0.7 ? "positive" : "attention", title: "Step goal", detail: `You reached ${Math.round(stepGoal.targetValue).toLocaleString()} steps on ${met} of ${stepVals.length} days with step data (${pct(met / stepVals.length)}).` });
    } else {
      out.push({ id: "steps-avg", domain: "health", kind: "measured", tone: "neutral", title: "Daily steps", detail: `You averaged ${Math.round(mean(stepVals.map(([, v]) => v))!).toLocaleString()} steps over ${stepVals.length} days with data. Add a step goal to track it.` });
    }
  }
  const sleep = metricByDate(l.health, "sleep");
  const sleepVals = [...sleep.entries()].filter(([d]) => inR(d)).map(([, v]) => v);
  if (sleepVals.length >= 5) {
    const avg = mean(sleepVals)!;
    out.push({ id: "sleep-avg", domain: "health", kind: "measured", tone: avg >= 420 ? "positive" : "attention", title: avg >= 420 ? "Sleep averaging 7+ hours" : "Sleep averaging under 7 hours", detail: `Average ${formatSleepMinutes(avg)} over ${sleepVals.length} nights with data.` });
  }
  // Sleep vs strength: performance relative to each exercise's recent best, after short vs long nights.
  const paired: { long: boolean; rel: number }[] = [];
  for (const [, facts] of byEx) {
    const sessions = buildSessions(facts, l.training.calc).filter((x) => x.bestE1rm != null);
    for (let i = 3; i < sessions.length; i++) {
      const date = new Date(sessions[i].dateMs).toISOString().slice(0, 10);
      const night = sleep.get(date);
      if (night == null) continue;
      const ref = Math.max(...sessions.slice(Math.max(0, i - 5), i).map((x) => x.bestE1rm!));
      if (ref > 0) paired.push({ long: night >= 420, rel: sessions[i].bestE1rm! / ref });
    }
  }
  const longN = paired.filter((p) => p.long);
  const shortN = paired.filter((p) => !p.long);
  if (longN.length >= 4 && shortN.length >= 4) {
    const a = mean(longN.map((p) => p.rel))!;
    const b = mean(shortN.map((p) => p.rel))!;
    const diff = (a - b) * 100;
    out.push({
      id: "sleep-performance",
      domain: "health",
      kind: "observation",
      tone: "neutral",
      title: "Sleep and lifting performance",
      detail:
        Math.abs(diff) < 1.5
          ? `Across ${paired.length} exercise sessions, performance after nights of 7h+ and under 7h was similar (difference ${diff.toFixed(1)} percentage points of your recent best).`
          : `After nights of 7h+ sleep, your lifts averaged ${(a * 100).toFixed(1)}% of your recent best vs ${(b * 100).toFixed(1)}% after shorter nights (${longN.length} vs ${shortN.length} sessions). This is an association in your data, not proof of cause.`,
    });
  } else if (sleepVals.length && l.training.facts.length) {
    out.push({ id: "sleep-performance-insufficient", domain: "health", kind: "observation", tone: "neutral", title: "Sleep and lifting performance", detail: `Not enough paired data yet: this comparison needs at least 4 sessions after nights of 7h+ and 4 after shorter nights (have ${longN.length} and ${shortN.length}).` });
  }

  // --- Routines -------------------------------------------------------------
  const acts = [...routines.morning.activities.map((a) => ({ ...a, slot: "Morning" })), ...routines.night.activities.map((a) => ({ ...a, slot: "Night" }))].filter((a) => a.eligibleDays >= 5 && a.rate != null);
  if (acts.length) {
    const best = [...acts].sort((a, b) => b.rate! - a.rate!)[0];
    const worst = [...acts].sort((a, b) => a.rate! - b.rate!)[0];
    out.push({ id: "routine-best", domain: "routines", kind: "measured", tone: "positive", title: "Most consistent habit", detail: `${best.slot} · ${best.title}: done on ${best.doneDays} of ${best.eligibleDays} days (${pct(best.rate)}).` });
    if (worst.id !== best.id && worst.rate! < 0.7) out.push({ id: "routine-worst", domain: "routines", kind: "measured", tone: "attention", title: "Most often missed habit", detail: `${worst.slot} · ${worst.title}: done on ${worst.doneDays} of ${worst.eligibleDays} days (${pct(worst.rate)}).` });
  }
  // "Reach" goals (target weight, a lift milestone) aren't habits you can miss day to day.
  const weakGoals = goals.filter((g) => g.status === "active" && g.aggregation !== "level" && g.judged >= 5 && (g.successRate ?? 1) < 0.5).sort((a, b) => (a.successRate ?? 0) - (b.successRate ?? 0));
  if (weakGoals.length) {
    out.push({ id: "missed-goals", domain: "goals", kind: "measured", tone: "attention", title: "Goals you frequently miss", detail: weakGoals.slice(0, 3).map((g) => `${g.title} (${g.met}/${g.judged} periods)`).join(", ") + ". If a target feels out of reach, adjusting it is a valid way to keep momentum." });
  }

  const order: Record<InsightTone, number> = { caution: 0, attention: 1, positive: 2, neutral: 3 };
  out.sort((a, b) => order[a.tone] - order[b.tone]);

  return {
    range: { start, end },
    insights: out,
    summaries: {
      daily: summarize("Today", { start: today, end: today }, l, routinesDay, today),
      weekly: summarize("Last 7 days", { start: addDays(today, -6), end: today }, l, routinesWeek, today),
      monthly: summarize(`Last ${days} days`, { start, end }, l, routines, today),
    },
  };
}
