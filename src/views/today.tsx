"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  BedDouble,
  BookOpen,
  Check,
  ChevronRight,
  Droplets,
  Dumbbell,
  Eye,
  EyeOff,
  Footprints,
  HeartPulse,
  Lightbulb,
  ListChecks,
  Moon,
  Plus,
  Scale,
  Settings2,
  Sun,
  Target,
  UtensilsCrossed,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { DateNav } from "@/components/date-nav";
import { KindBadge, ProgressRing, SourceLine, StatusPill, StreakBadge, DOMAIN_COLORS, timeAgo, type PeriodStatusName } from "@/components/kit";
import { MealCard } from "@/components/meal-card";
import { GoalProgress, MACRO_COLORS } from "@/components/nutrition";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardTitle, cx, EmptyState, ErrorBanner, Meter, Modal, Skeleton } from "@/components/ui";
import { api, newRequestId } from "@/lib/client/api";
import { useInsights, useInvalidateData, useSettings, useToday } from "@/lib/client/hooks";
import type { GoalJ2, SettingsJ, TodayJ } from "@/lib/client/types";
import { fmtDistance, fmtGoalValue, fmtWater, type UnitPrefs } from "@/lib/client/units";
import { DASHBOARD_SECTIONS, OVERVIEW_TILES, type DashboardPrefs, type DashboardSection, type OverviewTile } from "@/lib/db/schema";
import { fmtKcal } from "@/lib/format";
import { formatSleepMinutes } from "@/lib/health/metrics";
import { formatLocalDate, formatTimeInZone, isLocalDate } from "@/lib/time";
import { formatWeight } from "@/lib/units";

const SECTION_LABELS: Record<DashboardSection, string> = {
  overview: "Daily overview",
  goals: "Goal progress",
  nutrition: "Nutrition",
  training: "Training",
  running: "Running",
  health: "Steps & sleep",
  routines: "Routines",
  insights: "Insights",
  timeline: "Activity log",
};

const TILE_LABELS: Record<OverviewTile, string> = {
  weight: "Body weight",
  calories: "Calories",
  macros: "Protein · carbs · fat",
  water: "Water",
  workout: "Workout",
  run: "Run",
  steps: "Steps",
  sleep: "Sleep",
  morning: "Morning routine",
  night: "Nightly routine",
};

function prefsOf(s: SettingsJ): UnitPrefs {
  return { weightUnit: s.weightUnit, distanceUnit: s.distanceUnit, waterUnit: s.waterUnit };
}

function periodLabel(g: GoalJ2): string {
  const c = g.current;
  if (!c) return g.status === "paused" ? "Paused" : "";
  if (g.period === "daily") return "Today";
  if (g.period === "weekly") return "This week";
  if (g.period === "monthly") return "This month";
  return `${formatLocalDate(c.start, { month: "short", day: "numeric" })} – ${formatLocalDate(c.end, { month: "short", day: "numeric" })}`;
}

export function goalTargetText(g: GoalJ2, p: UnitPrefs): string {
  if (g.center != null) return `${fmtGoalValue(g.center, g.unit, p, g.unitLabel)} ±10%`;
  const t = g.current?.target ?? g.targetValue;
  const m = g.current?.targetMax ?? g.targetMax;
  if (g.comparator === "range") return `${fmtGoalValue(t, g.unit, p, g.unitLabel)} – ${fmtGoalValue(m, g.unit, p, g.unitLabel)}`;
  return `${g.comparator === "at_most" ? "≤ " : ""}${fmtGoalValue(t, g.unit, p, g.unitLabel)}`;
}

function goalValueText(g: GoalJ2, p: UnitPrefs): string {
  const v = g.current?.value ?? null;
  if (g.aggregation === "count") return g.period === "daily" ? `${v ?? 0}` : `${v ?? 0} ${v === 1 ? "day" : "days"}`;
  return fmtGoalValue(v, g.unit, p, g.unitLabel);
}

// ---------------------------------------------------------------------------

function Tile({ href, icon, label, value, sub, color, ring, children }: { href?: string; icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; color?: string; ring?: number | null; children?: ReactNode }) {
  const body = (
    <div className="flex h-full flex-col gap-1.5 rounded-xl border border-line bg-surface p-3 shadow-[var(--shadow)] transition-colors hover:bg-surface-2/60">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted">
          <span style={{ color }}>{icon}</span>
          <span className="truncate">{label}</span>
        </span>
        {ring !== undefined && <ProgressRing value={ring} size={26} stroke={3.5} color={color} label={`${label} progress`} />}
      </div>
      <div className="truncate text-lg font-semibold text-fg tabular">{value}</div>
      {sub && <div className="truncate text-xs text-muted">{sub}</div>}
      {children}
    </div>
  );
  return href ? (
    <Link href={href} className="block min-w-0">
      {body}
    </Link>
  ) : (
    <div className="min-w-0">{body}</div>
  );
}

function Overview({ t, s, tiles }: { t: TodayJ; s: SettingsJ; tiles: OverviewTile[] }) {
  const p = prefsOf(s);
  const n = t.nutrition;
  const kcal = n.totals.values.calories ?? 0;
  const kcalTarget = n.goals.calories;
  const m = n.weights.morning?.weightKg ?? null;
  const nt = n.weights.night?.weightKg ?? null;
  const steps = t.health.steps;
  const stepGoal = t.goals.find((g) => g.metric === "steps" && g.period === "daily");
  const sleep = t.health.sleep;
  const run = t.running.status;
  const w = t.training.workouts;
  const routine = (slot: "morning" | "night") => t.routines[slot].progress;
  const render: Record<OverviewTile, ReactNode> = {
    weight: (
      <Tile href="/weight" icon={<Scale className="size-3.5" />} color={DOMAIN_COLORS.body} label="Weight" value={m != null ? formatWeight(m, s.weightUnit) : nt != null ? formatWeight(nt, s.weightUnit) : <span className="text-muted">Not logged</span>} sub={m != null && nt != null ? `Night ${formatWeight(nt, s.weightUnit)}` : m != null ? "Morning" : nt != null ? "Night" : "Morning & night weigh-ins"} />
    ),
    calories: (
      <Tile href="/nutrition" icon={<UtensilsCrossed className="size-3.5" />} color={MACRO_COLORS.calories} label="Calories" ring={kcalTarget ? kcal / kcalTarget : undefined} value={`${fmtKcal(kcal)}${kcalTarget ? ` / ${fmtKcal(kcalTarget)}` : ""}`} sub={kcalTarget ? (kcalTarget - kcal >= 0 ? `${fmtKcal(kcalTarget - kcal)} kcal left` : `${fmtKcal(kcal - kcalTarget)} kcal over`) : `${n.meals.length} meals`} />
    ),
    macros: (
      <Tile href="/nutrition" icon={<UtensilsCrossed className="size-3.5" />} color={MACRO_COLORS.protein} label="Macros" value={`P ${Math.round(n.totals.values.protein ?? 0)} g`} sub={`C ${Math.round(n.totals.values.carbs ?? 0)} g · F ${Math.round(n.totals.values.fat ?? 0)} g${n.goals.protein ? ` · P goal ${Math.round(n.goals.protein)} g` : ""}`} />
    ),
    water: <WaterTile t={t} s={s} />,
    workout: (
      <Tile href={w[0] ? `/training/workouts/${w[0].id}` : "/training?start=1"} icon={<Dumbbell className="size-3.5" />} color={DOMAIN_COLORS.training} label="Workout" value={w.length ? (w.some((x) => x.status === "in_progress") ? "In progress" : "Done") : <span className="text-muted">None yet</span>} sub={w.length ? `${w.reduce((a, x) => a + x.setCount, 0)} sets · ${w.map((x) => x.name).join(", ")}` : "Tap to start"} />
    ),
    run: (
      <Tile href="/running" icon={<Footprints className="size-3.5" />} color={DOMAIN_COLORS.running} label="Run" value={run?.status === "done" ? (run.hasDistance ? fmtDistance(run.distanceM, p.distanceUnit) : "Done") : run?.status === "rest" ? "Rest day" : run?.status === "recovery" ? "Recovery day" : run?.status === "short" ? `Short · ${fmtDistance(run.distanceM, p.distanceUnit)}` : <span className="text-muted">Not yet</span>} sub={<StreakBadge count={t.running.streak.current} unit="days" best={t.running.streak.longest} />} />
    ),
    steps: (
      <Tile href="/health" icon={<Footprints className="size-3.5" />} color={DOMAIN_COLORS.health} label="Steps" ring={stepGoal && steps ? steps.value / stepGoal.targetValue : undefined} value={steps ? Math.round(steps.value).toLocaleString() : <span className="text-muted">No data</span>} sub={steps ? `Synced ${timeAgo(steps.syncedAt)}` : "Set up phone sync"} />
    ),
    sleep: (
      <Tile href="/health" icon={<BedDouble className="size-3.5" />} color={DOMAIN_COLORS.health} label="Sleep" value={sleep ? formatSleepMinutes(sleep.value) : <span className="text-muted">No data</span>} sub={t.health.sleepScore ? `Score ${Math.round(t.health.sleepScore.value)} (${t.health.sleepScore.origin ?? "source"})` : sleep ? sleep.sourceLabel : "Last night"} />
    ),
    morning: (
      <Tile href="/routines/morning" icon={<Sun className="size-3.5" />} color="var(--warning)" label="Morning routine" ring={routine("morning").pct} value={`${routine("morning").done}/${routine("morning").required}`} sub={routine("morning").complete ? "Complete" : "Activities done"} />
    ),
    night: <Tile href="/routines/night" icon={<Moon className="size-3.5" />} color="var(--accent)" label="Nightly routine" ring={routine("night").pct} value={`${routine("night").done}/${routine("night").required}`} sub={routine("night").complete ? "Complete" : "Activities done"} />,
  };
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{tiles.map((k) => <div key={k}>{render[k]}</div>)}</div>;
}

function WaterTile({ t, s }: { t: TodayJ; s: SettingsJ }) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const [busy, setBusy] = useState(false);
  const unit = s.waterUnit;
  const step = unit === "oz" ? 8 : 250;
  const add = async () => {
    setBusy(true);
    try {
      await api.post("/api/water", { value: step, unit, localDate: t.date, clientRequestId: newRequestId() });
      await invalidate();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Tile icon={<Droplets className="size-3.5" />} color={DOMAIN_COLORS.health} label="Water" ring={t.water.targetMl ? t.water.totalMl / t.water.targetMl : undefined} value={fmtWater(t.water.totalMl, unit)} sub={t.water.targetMl ? `Goal ${fmtWater(t.water.targetMl, unit)}` : `${t.water.entries.length} entries`}>
      <button type="button" disabled={busy} onClick={add} className="mt-0.5 inline-flex h-7 w-fit items-center gap-1 rounded-md border border-line-strong px-2 text-xs font-medium text-fg hover:bg-surface-3 disabled:opacity-50" aria-label={`Add ${step} ${unit} of water`}>
        <Plus className="size-3" /> {step} {unit}
      </button>
    </Tile>
  );
}

const DASHBOARD_GOAL_LIMIT = 8;

function GoalsSection({ t, s }: { t: TodayJ; s: SettingsJ }) {
  const p = prefsOf(s);
  const [all, setAll] = useState(false);
  const pinned = t.goals.filter((g) => g.showOnDashboard).sort((a, b) => a.position - b.position);
  const goals = all ? pinned : pinned.slice(0, DASHBOARD_GOAL_LIMIT);
  return (
    <Card>
      <CardTitle
        sub="Updated automatically from everything you log."
        action={
          <Link href="/goals" className="inline-flex items-center gap-1 text-sm font-medium whitespace-nowrap text-accent">
            All goals <ChevronRight className="size-4" />
          </Link>
        }
      >
        Goal progress
      </CardTitle>
      {goals.length === 0 ? (
        <EmptyState icon={<Target className="size-8" />} title="No goals on your dashboard" action={<Link href="/goals?new=1"><Button size="sm"><Plus className="size-4" /> Add a goal</Button></Link>}>
          Create goals for nutrition, training, running, sleep, steps and routines.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {goals.map((g) => {
            const color = DOMAIN_COLORS[g.category];
            const status = (g.current?.status ?? (g.status === "paused" ? "paused" : "no_data")) as PeriodStatusName;
            const over = g.comparator === "at_most" && (g.progress ?? 0) > 1;
            return (
              <li key={g.id}>
                <Link href={`/goals/${encodeURIComponent(g.id)}`} className="flex flex-col gap-1.5 rounded-lg p-1 hover:bg-surface-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-fg">{g.title}</span>
                    <StatusPill status={status} />
                  </div>
                  <Meter value={Math.min(1, g.progress ?? 0)} max={1} color={color} over={over} label={`${g.title}: ${goalValueText(g, p)} of ${goalTargetText(g, p)}`} />
                  <div className="flex items-center justify-between gap-2 text-xs text-muted">
                    <span className="tabular">
                      {g.aggregation === "count" && g.period === "daily" && (g.current?.target ?? 1) === 1 ? (
                        <>
                          {periodLabel(g)}: <span className="text-fg-2">{status === "met" ? "Done" : status === "excused" ? "Rest day" : "Not yet"}</span>
                        </>
                      ) : (
                        <>
                          {periodLabel(g)}: <span className="text-fg-2">{goalValueText(g, p)}</span> / {goalTargetText(g, p)}
                        </>
                      )}
                    </span>
                    <StreakBadge count={g.streak.current} unit={g.streak.unit} best={g.streak.best} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {pinned.length > DASHBOARD_GOAL_LIMIT && (
        <button type="button" className="mt-3 text-sm font-medium text-accent" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? "Show fewer" : `Show ${pinned.length - DASHBOARD_GOAL_LIMIT} more`}
        </button>
      )}
    </Card>
  );
}

function NutritionSection({ t }: { t: TodayJ }) {
  const n = t.nutrition;
  const href = t.date === t.today ? "/log" : `/log?date=${t.date}`;
  return (
    <Card>
      <CardTitle
        action={
          <div className="flex items-center gap-2">
            <Link href={t.date === t.today ? "/nutrition" : `/nutrition?date=${t.date}`} className="text-sm font-medium text-accent">
              Details
            </Link>
            <Link href={href}>
              <Button size="sm">
                <Plus className="size-4" /> Log meal
              </Button>
            </Link>
          </div>
        }
      >
        Nutrition
      </CardTitle>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          {(["calories", "protein", "carbs", "fat"] as const).map((k) => (
            <GoalProgress key={k} nkey={k} value={n.totals.values[k]} target={n.goals[k]} incomplete={n.totals.incomplete.includes(k)} />
          ))}
        </div>
        <div>
          {n.meals.length === 0 ? (
            <EmptyState icon={<UtensilsCrossed className="size-7" />} title="No meals logged">
              Describe a meal in plain English, snap a photo, or search the food database.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {n.meals.map((m) => (
                <MealCard key={m.id} meal={m} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

function TrainingSection({ t, s }: { t: TodayJ; s: SettingsJ }) {
  const w = t.training.workouts;
  const weekly = t.goals.find((g) => g.metric === "workouts" && g.period === "weekly");
  return (
    <Card>
      <CardTitle action={<Link href="/training" className="text-sm font-medium text-accent">Training</Link>} sub={weekly ? `${weekly.current?.value ?? 0} of ${weekly.current?.target ?? weekly.targetValue} workouts this week` : undefined}>
        Training
      </CardTitle>
      {w.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">No workout logged {t.date === t.today ? "today" : "on this day"}.</p>
          <Link href="/training?start=1">
            <Button size="sm" variant="secondary">
              <Dumbbell className="size-4" /> Start workout
            </Button>
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {w.map((x) => (
            <li key={x.id}>
              <Link href={`/training/workouts/${x.id}`} className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2.5 hover:bg-surface-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">{x.name}</span>
                  <span className="text-xs text-muted tabular">
                    {x.exerciseCount} exercises · {x.setCount} sets · {x.totalReps} reps · {Math.round(s.weightUnit === "lb" ? x.volumeKg / 0.45359237 : x.volumeKg).toLocaleString()} {s.weightUnit} volume
                  </span>
                </span>
                {x.status === "in_progress" ? <Badge tone="accent">In progress</Badge> : <Badge tone="good"><Check className="size-3" /> Done</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RunningSection({ t, s }: { t: TodayJ; s: SettingsJ }) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const [busy, setBusy] = useState(false);
  const st = t.running.status;
  const markOff = async (kind: "rest" | "recovery" | null) => {
    setBusy(true);
    try {
      if (kind) await api.post("/api/runs/day-off", { localDate: t.date, kind, notes: null });
      else await api.del(`/api/runs/day-off?date=${t.date}`);
      await invalidate();
      toast.success(kind ? `Marked as a ${kind} day — your streak is safe` : "Day-off marker removed");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const statusText =
    st?.status === "done" ? `Run complete${st.hasDistance ? ` · ${fmtDistance(st.distanceM, s.distanceUnit)}` : ""}` : st?.status === "short" ? `Short of your minimum · ${fmtDistance(st.distanceM, s.distanceUnit)}` : st?.status === "rest" ? "Planned rest day" : st?.status === "recovery" ? "Planned recovery day" : st?.status === "missed" ? "No run logged" : "Not run yet";
  return (
    <Card>
      <CardTitle action={<Link href="/running" className="text-sm font-medium text-accent">Running</Link>} sub={t.running.minDistanceM ? `Daily minimum ${fmtDistance(t.running.minDistanceM, s.distanceUnit)}` : t.running.hasGoal ? "Goal: run every day" : undefined}>
        Daily run
      </CardTitle>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={cx("flex size-10 items-center justify-center rounded-full", st?.status === "done" ? "bg-good-soft text-good-text" : st?.status === "rest" || st?.status === "recovery" ? "bg-surface-3 text-fg-2" : "bg-surface-2 text-muted")}>
            {st?.status === "done" ? <Check className="size-5" /> : <Footprints className="size-5" />}
          </span>
          <div>
            <p className="text-sm font-medium text-fg">{statusText}</p>
            <StreakBadge count={t.running.streak.current} unit="days" best={t.running.streak.longest} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {st?.status !== "done" && st?.status !== "short" && (
            <Link href="/running?log=1">
              <Button size="sm">
                <Plus className="size-4" /> Log run
              </Button>
            </Link>
          )}
          {(st?.status === "pending" || st?.status === "missed") && (
            <>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => markOff("rest")}>
                Rest day
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => markOff("recovery")}>
                Recovery day
              </Button>
            </>
          )}
          {(st?.status === "rest" || st?.status === "recovery") && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => markOff(null)}>
              Undo
            </Button>
          )}
        </div>
      </div>
      {t.running.streak.daysWithoutRest >= 10 && <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning-text">{t.running.streak.daysWithoutRest} days in a row without a rest or recovery day. A planned recovery day keeps your streak — and pain or unusual fatigue are signals to rest.</p>}
    </Card>
  );
}

function HealthSection({ t }: { t: TodayJ }) {
  const h = t.health;
  const none = !h.steps && !h.sleep && !h.restingHr;
  const stages = (h.sleep?.details as { stages?: { deep?: number | null; rem?: number | null; core?: number | null; awake?: number | null } | null } | null)?.stages ?? null;
  return (
    <Card>
      <CardTitle action={<Link href="/health" className="text-sm font-medium text-accent">Steps & sleep</Link>}>Phone health data</CardTitle>
      {none ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">No steps or sleep for this day. Data arrives from your phone (Apple Health via Shortcuts or Health Auto Export) or can be entered by hand.</p>
          <Link href="/health/connect">
            <Button size="sm" variant="secondary">
              <HeartPulse className="size-4" /> Set up sync
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-muted">Steps</p>
            <p className="text-2xl font-semibold text-fg tabular">{h.steps ? Math.round(h.steps.value).toLocaleString() : "—"}</p>
            {h.steps && <SourceLine label={h.steps.sourceLabel} syncedAt={h.steps.syncedAt} origin={h.steps.origin} />}
          </div>
          <div>
            <p className="text-xs font-medium text-muted">Sleep (night ending this day)</p>
            <p className="text-2xl font-semibold text-fg tabular">{h.sleep ? formatSleepMinutes(h.sleep.value) : "—"}</p>
            {stages && (stages.deep != null || stages.rem != null || stages.core != null) && (
              <p className="text-xs text-fg-2 tabular">
                Deep {formatSleepMinutes(stages.deep ?? 0)} · Core {formatSleepMinutes(stages.core ?? 0)} · REM {formatSleepMinutes(stages.rem ?? 0)}
              </p>
            )}
            <p className="text-xs text-fg-2">{h.sleepScore ? `Sleep score ${Math.round(h.sleepScore.value)} — provided by ${h.sleepScore.origin}` : "No sleep score from a connected source"}</p>
            {h.sleep && <SourceLine label={h.sleep.sourceLabel} syncedAt={h.sleep.syncedAt} origin={h.sleep.origin} />}
          </div>
        </div>
      )}
    </Card>
  );
}

function RoutineList({ t, slot }: { t: TodayJ; slot: "morning" | "night" }) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const qc = useQueryClient();
  const r = t.routines[slot];
  const toggle = async (activityId: string, completed: boolean, value: number | null) => {
    // Optimistic update for an instant tick.
    qc.setQueryData<TodayJ>(["today", t.date === t.today ? null : t.date], (old) =>
      old ? { ...old, routines: { ...old.routines, [slot]: { ...old.routines[slot], activities: old.routines[slot].activities.map((a) => (a.id === activityId ? { ...a, completed } : a)) } } } : old,
    );
    try {
      await api.post("/api/routines/log", { localDate: t.date, activityId, completed, value });
      await invalidate();
    } catch (err) {
      toast.error(err);
      await invalidate();
    }
  };
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <Link href={`/routines/${slot}${t.date === t.today ? "" : `?date=${t.date}`}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-fg hover:underline">
          {slot === "morning" ? <Sun className="size-4 text-warning" /> : <Moon className="size-4 text-accent" />}
          {slot === "morning" ? "Morning" : "Night"}
        </Link>
        <span className="text-xs text-muted tabular">
          {r.progress.done}/{r.progress.required} required
        </span>
      </div>
      {r.activities.length === 0 ? (
        <p className="text-sm text-muted">No activities. <Link className="text-accent" href={`/routines/${slot}`}>Set up</Link></p>
      ) : (
        <ul className="flex flex-col gap-1">
          {r.activities.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <button
                type="button"
                role="checkbox"
                aria-checked={a.completed}
                aria-label={`${a.title} ${a.completed ? "done" : "not done"}`}
                onClick={() => toggle(a.id, !a.completed, a.value)}
                className={cx("flex size-6 shrink-0 items-center justify-center rounded-md border", a.completed ? "border-good bg-good text-white" : "border-line-strong bg-surface hover:bg-surface-2")}
              >
                {a.completed && <Check className="size-4" />}
              </button>
              <Link href={`/routines/${slot}${t.date === t.today ? "" : `?date=${t.date}`}`} className={cx("min-w-0 flex-1 truncate text-sm", a.completed ? "text-muted line-through" : "text-fg")}>
                {a.title}
                {!a.required && <span className="ml-1 text-xs text-muted">(optional)</span>}
              </Link>
              {a.targetValue != null && (
                <span className="text-xs text-muted tabular">
                  {a.value ?? 0}/{a.targetValue} {a.targetUnit ?? ""}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RoutinesSection({ t }: { t: TodayJ }) {
  return (
    <Card>
      <CardTitle action={<Link href="/journal" className="inline-flex items-center gap-1 text-sm font-medium text-accent"><BookOpen className="size-4" /> Journal</Link>}>Routines</CardTitle>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <RoutineList t={t} slot="morning" />
        <RoutineList t={t} slot="night" />
      </div>
    </Card>
  );
}

function InsightsSection() {
  const q = useInsights(30);
  const items = q.data?.insights.slice(0, 4) ?? [];
  return (
    <Card>
      <CardTitle sub="From the last 30 days of your own data." action={<Link href="/analytics" className="text-sm font-medium text-accent">Analytics</Link>}>
        Insights
      </CardTitle>
      {q.isLoading ? (
        <Skeleton className="h-24" />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">Keep logging — insights appear once there&apos;s enough data to say something reliable.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((i) => (
            <li key={i.id} className={cx("rounded-lg border px-3 py-2.5", i.tone === "caution" ? "border-warning/50 bg-warning-soft" : i.tone === "attention" ? "border-line-strong" : "border-line")}>
              <div className="mb-0.5 flex flex-wrap items-center gap-2">
                <Lightbulb className={cx("size-4", i.tone === "caution" ? "text-warning-text" : i.tone === "positive" ? "text-good" : "text-muted")} aria-hidden />
                <span className="text-sm font-medium text-fg">{i.title}</span>
                <KindBadge kind={i.kind} />
              </div>
              <p className="text-sm text-fg-2">{i.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const TIMELINE_ICON: Record<TodayJ["timeline"][number]["kind"], typeof Scale> = {
  meal: UtensilsCrossed,
  weight: Scale,
  water: Droplets,
  workout: Dumbbell,
  run: Footprints,
  rest: Footprints,
  routine: ListChecks,
  journal: BookOpen,
};

function TimelineSection({ t, s }: { t: TodayJ; s: SettingsJ }) {
  return (
    <Card>
      <CardTitle sub="Everything logged on this day, in order.">Activity log</CardTitle>
      {t.timeline.length === 0 ? (
        <p className="text-sm text-muted">Nothing logged yet.</p>
      ) : (
        <ol className="relative flex flex-col gap-3 border-l border-line pl-5">
          {t.timeline.map((e, i) => {
            const Icon = TIMELINE_ICON[e.kind];
            const inner = (
              <>
                <span className="absolute -left-[31px] flex size-5 items-center justify-center rounded-full border border-line bg-surface">
                  <Icon className="size-3 text-fg-2" aria-hidden />
                </span>
                <span className="w-16 shrink-0 text-xs text-muted tabular">{formatTimeInZone(e.at, s.timezone)}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-fg">{e.title}</span>
                  {e.detail && <span className="block truncate text-xs text-muted">{e.detail}</span>}
                </span>
              </>
            );
            return (
              <li key={`${e.at}-${i}`} className="relative">
                {e.href ? (
                  <Link href={e.href} className="flex items-start gap-2 rounded-md hover:bg-surface-2">
                    {inner}
                  </Link>
                ) : (
                  <div className="flex items-start gap-2">{inner}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function Customize({ open, onClose, s }: { open: boolean; onClose: () => void; s: SettingsJ }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [d, setD] = useState<DashboardPrefs>(s.dashboard);
  const [saving, setSaving] = useState(false);
  const move = <T,>(list: T[], i: number, dir: -1 | 1): T[] => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return list;
    const out = [...list];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  };
  const save = async () => {
    setSaving(true);
    try {
      await api.patch("/api/settings", { dashboard: d });
      await qc.invalidateQueries();
      toast.success("Dashboard updated");
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };
  const tilesOrdered = [...d.tiles, ...OVERVIEW_TILES.filter((x) => !d.tiles.includes(x))];
  return (
    <Modal open={open} onClose={onClose} title="Customize dashboard" wide>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-medium text-fg">Sections</p>
          <ul className="flex flex-col gap-1">
            {d.order.map((sec, i) => {
              const hidden = d.hidden.includes(sec);
              return (
                <li key={sec} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5">
                  <span className={cx("flex-1 text-sm", hidden ? "text-muted line-through" : "text-fg")}>{SECTION_LABELS[sec]}</span>
                  <button type="button" aria-label={`Move ${SECTION_LABELS[sec]} up`} className="rounded p-1 text-fg-2 hover:bg-surface-2 disabled:opacity-30" disabled={i === 0} onClick={() => setD({ ...d, order: move(d.order, i, -1) })}>
                    <ArrowUp className="size-4" />
                  </button>
                  <button type="button" aria-label={`Move ${SECTION_LABELS[sec]} down`} className="rounded p-1 text-fg-2 hover:bg-surface-2 disabled:opacity-30" disabled={i === d.order.length - 1} onClick={() => setD({ ...d, order: move(d.order, i, 1) })}>
                    <ArrowDown className="size-4" />
                  </button>
                  <button type="button" aria-label={hidden ? `Show ${SECTION_LABELS[sec]}` : `Hide ${SECTION_LABELS[sec]}`} className="rounded p-1 text-fg-2 hover:bg-surface-2" onClick={() => setD({ ...d, hidden: hidden ? d.hidden.filter((x) => x !== sec) : [...d.hidden, sec] })}>
                    {hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-fg">Overview metrics</p>
          <ul className="flex flex-col gap-1">
            {tilesOrdered.map((tile) => {
              const on = d.tiles.includes(tile);
              const i = d.tiles.indexOf(tile);
              return (
                <li key={tile} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5">
                  <label className="flex flex-1 items-center gap-2 text-sm text-fg">
                    <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={on} onChange={() => setD({ ...d, tiles: on ? d.tiles.filter((x) => x !== tile) : [...d.tiles, tile] })} />
                    {TILE_LABELS[tile]}
                  </label>
                  <button type="button" aria-label={`Move ${TILE_LABELS[tile]} up`} className="rounded p-1 text-fg-2 hover:bg-surface-2 disabled:opacity-30" disabled={!on || i === 0} onClick={() => setD({ ...d, tiles: move(d.tiles, i, -1) })}>
                    <ArrowUp className="size-4" />
                  </button>
                  <button type="button" aria-label={`Move ${TILE_LABELS[tile]} down`} className="rounded p-1 text-fg-2 hover:bg-surface-2 disabled:opacity-30" disabled={!on || i === d.tiles.length - 1} onClick={() => setD({ ...d, tiles: move(d.tiles, i, 1) })}>
                    <ArrowDown className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-muted">Choose which goals appear on the dashboard from each goal&apos;s menu on the Goals page.</p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap justify-between gap-2">
        <Button variant="ghost" onClick={() => setD({ order: [...DASHBOARD_SECTIONS], hidden: [], tiles: [...OVERVIEW_TILES], hiddenGoalIds: d.hiddenGoalIds })}>
          Reset to default
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function TodayView({ initialDate }: { initialDate: string | null }) {
  const router = useRouter();
  const settingsQ = useSettings();
  const [date, setDate] = useState<string | null>(initialDate && isLocalDate(initialDate) ? initialDate : null);
  const today = settingsQ.data?.today ?? null;
  const active = date && date !== today ? date : null;
  const q = useToday(active);
  const [customizing, setCustomizing] = useState(false);

  if (!settingsQ.data || !today) return null;
  const s = settingsQ.data.settings;
  const t = q.data;
  const changeDate = (d: string) => {
    setDate(d === today ? null : d);
    router.replace(d === today ? "/" : `/?date=${d}`, { scroll: false });
  };
  const order = s.dashboard.order.filter((x) => !s.dashboard.hidden.includes(x));

  const section = (key: DashboardSection, tt: TodayJ) => {
    switch (key) {
      case "overview":
        return s.dashboard.tiles.length ? <Overview t={tt} s={s} tiles={s.dashboard.tiles} /> : null;
      case "goals":
        return <GoalsSection t={tt} s={s} />;
      case "nutrition":
        return <NutritionSection t={tt} />;
      case "training":
        return <TrainingSection t={tt} s={s} />;
      case "running":
        return <RunningSection t={tt} s={s} />;
      case "health":
        return <HealthSection t={tt} />;
      case "routines":
        return <RoutinesSection t={tt} />;
      case "insights":
        return <InsightsSection />;
      case "timeline":
        return <TimelineSection t={tt} s={s} />;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateNav date={active ?? today} today={today} onChange={changeDate} />
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setCustomizing(true)} aria-label="Customize dashboard">
            <Settings2 className="size-4" /> <span className="hidden sm:inline">Customize</span>
          </Button>
          <Link href={active ? `/log?date=${active}` : "/log"}>
            <Button size="sm">
              <Plus className="size-4" /> Log meal
            </Button>
          </Link>
        </div>
      </div>
      {q.error && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      {!t ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-48" />
        </div>
      ) : (
        <div className={cx("flex flex-col gap-4", q.isFetching && "opacity-90 transition-opacity")}>
          {order.map((key) => {
            const el = section(key, t);
            return el ? <section key={key} aria-label={SECTION_LABELS[key]}>{el}</section> : null;
          })}
          {order.length === 0 && (
            <EmptyState title="Every section is hidden" action={<Button onClick={() => setCustomizing(true)}>Customize</Button>}>
              Choose what to show on your dashboard.
            </EmptyState>
          )}
        </div>
      )}
      <Customize key={JSON.stringify(s.dashboard)} open={customizing} onClose={() => setCustomizing(false)} s={s} />
    </div>
  );
}
