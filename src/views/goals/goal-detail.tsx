"use client";

import { Archive, ArrowLeft, Check, CheckCircle2, Eye, EyeOff, Link2, Pause, Pencil, Play, RotateCcw, Target, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PeriodStrip, ProgressRing, StatusPill, StreakBadge, type PeriodStatusName } from "@/components/kit";
import { Badge, Button, Card, CardTitle, EmptyState, ErrorBanner, Meter, Skeleton, Stat } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/client/api";
import { DATA_KEYS, useGoal, useSettings } from "@/lib/client/hooks";
import type { GoalJ2 } from "@/lib/client/types";
import type { UnitPrefs } from "@/lib/client/units";
import { METRIC_BY_KEY } from "@/lib/goals/catalog";
import { formatLocalDate } from "@/lib/time";
import { CheckinCard } from "./components/checkin";
import { displayRatio, isOver, periodTitle, ProjectionLine, ringColor, ringIsCheck } from "./components/goal-card";
import { GoalFormModal } from "./components/goal-form";
import { GoalHistoryChart } from "./components/history-chart";
import {
  AGG_LABELS,
  CATEGORY_META,
  countsDays,
  fmtPeriodValue,
  fmtTarget,
  fmtTargetWords,
  fmtValue,
  GOAL_STATUS_LABELS,
  isBinary,
  linkedSectionLabel,
  onTrackText,
  periodLabel,
  plural,
  prefsOf,
  rangeLabel,
  scheduleLabel,
  sectionHref,
  successText,
  type GoalPeriodJ,
} from "./components/labels";
import { ConfirmDialog } from "./components/menu";
import { goalUrl, useGoalActions, type GoalActions } from "./components/use-goal-actions";

const LEGEND: PeriodStatusName[] = ["met", "missed", "not_reached", "in_progress", "excused", "paused", "no_data"];

const longDate = (d: string) => formatLocalDate(d, { month: "short", day: "numeric", year: "numeric" });

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading goal">
      <Skeleton className="h-16" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
      <Skeleton className="h-72" />
      <Skeleton className="h-32" />
    </div>
  );
}

function CurrentCard({ goal, prefs, today }: { goal: GoalJ2; prefs: UnitPrefs; today: string }) {
  const c = goal.current;
  const ratio = displayRatio(goal);
  const check = ringIsCheck(goal);
  const track = onTrackText(goal);
  if (!c)
    return (
      <Card>
        <CardTitle>Current period</CardTitle>
        <p className="text-sm text-fg-2">
          {goal.status === "completed" || goal.status === "archived"
            ? `This goal is ${GOAL_STATUS_LABELS[goal.status].toLowerCase()}. Its history is kept below.`
            : goal.endDate && goal.endDate < today
              ? `This goal ended on ${longDate(goal.endDate)}.`
              : goal.startDate > today
                ? `This goal starts on ${longDate(goal.startDate)}.`
                : "No current period."}
        </p>
        <p className="mt-2 text-sm text-fg-2">Target {fmtTargetWords(goal, goal.targetValue, goal.targetMax, prefs)}</p>
      </Card>
    );
  // Event metrics (workouts, runs, check-ins) report 0 on empty days, so "days with data" only means something for averages.
  const showDays = goal.period !== "daily" && goal.aggregation === "avg";
  return (
    <Card>
      <CardTitle sub={goal.period === "daily" ? undefined : `${rangeLabel(c)} · day ${Math.min(c.daysElapsed, c.daysTotal)} of ${c.daysTotal}`}>{periodLabel(goal, c, today)}</CardTitle>
      <div className="flex items-center gap-4">
        <ProgressRing value={ratio} size={88} stroke={8} color={ringColor(goal)} label={`${goal.title}: ${ratio == null ? "no data yet" : check ? (ratio === 1 ? "on target" : "not on target yet") : `${Math.round(ratio * 100)}% of target`}`}>
          {check ? ratio === 1 ? <Check className="size-7 text-good" aria-hidden /> : <span className="text-muted">—</span> : <span className="text-sm">{ratio == null ? "—" : `${Math.min(999, Math.round(ratio * 100))}%`}</span>}
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <p className="text-3xl font-semibold tracking-tight text-fg tabular">{fmtPeriodValue(goal, c.value, prefs, true)}</p>
          <p className="mt-0.5 text-sm text-fg-2">Target {fmtTargetWords(goal, c.target, c.targetMax, prefs)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill status={c.status} />
            {track && <span className={c.meetsNow ? "text-xs text-good-text" : "text-xs text-fg-2"}>{track}</span>}
          </div>
        </div>
      </div>
      {!check && ratio != null && (
        <div className="mt-4">
          <Meter value={Math.max(0, ratio * 100)} max={100} color={CATEGORY_META[goal.category].color} over={isOver(goal)} label={`${Math.round(ratio * 100)}% of target`} />
        </div>
      )}
      <div className="mt-3 flex flex-col gap-1.5">
        {showDays && (
          <p className="text-xs text-fg-2">
            Days with data: <span className="font-medium text-fg tabular">{c.daysWithData}</span> of {plural(c.daysElapsed, "days")} so far
          </p>
        )}
        <ProjectionLine goal={goal} prefs={prefs} />
      </div>
    </Card>
  );
}

function StatsCard({ goal }: { goal: GoalJ2 }) {
  const u = goal.streak.unit;
  return (
    <Card>
      <CardTitle>Track record</CardTitle>
      <div className="grid grid-cols-2 gap-4">
        <Stat label="Current streak" value={<StreakBadge count={goal.streak.current} unit={u} />} sub={goal.streak.current ? "Rest days and pauses don't break it" : "Meet the goal to start one"} />
        <Stat label="Best streak" value={<span className="tabular">{plural(goal.streak.best, u)}</span>} />
        <Stat label="Success rate" value={<span className="tabular">{goal.successRate == null ? "—" : `${Math.round(goal.successRate * 100)}%`}</span>} sub={successText(goal)} />
        <Stat label="Judged periods" value={<span className="tabular">{goal.judged}</span>} sub="Finished periods (not paused or rest)" />
      </div>
    </Card>
  );
}

function StripCard({ goal, prefs }: { goal: GoalJ2; prefs: UnitPrefs }) {
  const periods = goal.recent.filter((p) => p.status !== "upcoming");
  const unit = goal.streak.unit;
  return (
    <Card>
      <CardTitle sub={periods.length ? `${plural(periods.length, unit)} since ${longDate(periods[0].start)}. Hover a square for details.` : undefined}>All periods</CardTitle>
      {periods.length === 0 ? <p className="text-sm text-muted">No periods yet.</p> : <PeriodStrip periods={periods} title={periodTitle(goal, prefs)} />}
      <ul className="mt-4 flex flex-wrap gap-x-3 gap-y-2" aria-label="Legend">
        {LEGEND.map((s) => (
          <li key={s}>
            <StatusPill status={s} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TargetHistoryCard({ goal, prefs }: { goal: GoalJ2; prefs: UnitPrefs }) {
  const versions = [...goal.targetHistory].sort((a, b) => a.from.localeCompare(b.from));
  return (
    <Card>
      <CardTitle sub="A changed target applies from that day on; earlier periods keep the target they had.">Target history</CardTitle>
      {versions.length === 0 ? (
        <p className="text-sm text-fg-2">{fmtTarget(goal, goal.targetValue, goal.targetMax, prefs)} since the start.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {[...versions].reverse().map((v, i) => (
            <li key={`${v.from}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-fg-2">{v.from <= "2000-01-01" ? "Initial" : v.from <= goal.startDate ? `From the start (${longDate(v.from)})` : `From ${longDate(v.from)}`}</span>
              <span className="flex items-center gap-2">
                <span className="font-medium text-fg tabular">{fmtTarget(goal, v.value, v.max, prefs)}</span>
                {i === 0 && <Badge tone="accent">Current</Badge>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Whole periods spent paused, merged into spans (the API doesn't expose the pause list itself). */
function pauseSpans(periods: GoalPeriodJ[]): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  periods.forEach((p, i) => {
    if (p.status !== "paused") return;
    const last = out[out.length - 1];
    if (last && i > 0 && periods[i - 1].status === "paused") last.to = p.end;
    else out.push({ from: p.start, to: p.end });
  });
  return out;
}

function PausesCard({ goal, today }: { goal: GoalJ2; today: string }) {
  const spans = pauseSpans(goal.recent);
  return (
    <Card>
      <CardTitle sub="Paused days are excused — they never count as missed or break a streak.">Pauses</CardTitle>
      {goal.status === "paused" && <p className="mb-2 text-sm font-medium text-fg">Paused now. Resume when you&apos;re ready.</p>}
      {spans.length === 0 ? (
        <p className="text-sm text-muted">{goal.status === "paused" ? "Paused today — earlier days are unaffected." : "No pauses."}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {[...spans].reverse().map((s) => (
            <li key={s.from} className="py-2 text-fg-2">
              {s.from === s.to ? longDate(s.from) : `${longDate(s.from)} – ${s.to >= today && goal.status === "paused" ? "now" : longDate(s.to)}`}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SettingsCard({ goal, prefs, actions }: { goal: GoalJ2; prefs: UnitPrefs; actions: GoalActions }) {
  const def = METRIC_BY_KEY[goal.metric];
  const p = goal.params;
  const rows: [string, string][] = [["Tracks", `${def?.label ?? goal.metric}${goal.subject ? ` — ${goal.subject}` : ""}`]];
  rows.push(["Target", fmtTargetWords(goal, goal.targetValue, goal.targetMax, prefs)]);
  rows.push(["Schedule", scheduleLabel(goal.period, goal.periodDays)]);
  if (goal.period !== "daily") rows.push(["Counted as", AGG_LABELS[goal.aggregation]]);
  if (countsDays(goal)) {
    const thr = typeof p.dailyThreshold === "number" ? p.dailyThreshold : 1;
    rows.push(["A day counts when", `${p.dailyComparator === "at_most" ? "at most" : "at least"} ${fmtValue(thr, goal.unit, prefs, goal.unitLabel)}`]);
  }
  if (typeof p.reps === "number") rows.push(["Reps", String(p.reps)]);
  if (typeof p.minDistanceM === "number" && p.minDistanceM > 0) rows.push(["Minimum distance", fmtValue(p.minDistanceM, "m", prefs)]);
  rows.push(["Starts", longDate(goal.startDate)]);
  rows.push(["Ends", goal.endDate ? longDate(goal.endDate) : "No end date"]);
  return (
    <Card>
      <CardTitle>Settings</CardTitle>
      <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="text-fg [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
        {goal.notes && (
          <div className="contents">
            <dt className="text-muted">Notes</dt>
            <dd className="whitespace-pre-wrap text-fg [overflow-wrap:anywhere]">{goal.notes}</dd>
          </div>
        )}
      </dl>
      <Button variant="secondary" size="sm" className="mt-4" onClick={() => void actions.toggleDashboard(goal)} loading={actions.busy === goal.id}>
        {goal.showOnDashboard ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        {goal.showOnDashboard ? "Hide from dashboard" : "Show on dashboard"}
      </Button>
    </Card>
  );
}

export function GoalDetailView({ id }: { id: string }) {
  const router = useRouter();
  const q = useGoal(id);
  const settingsQ = useSettings();
  const settings = settingsQ.data;
  const actions = useGoalActions(settings);
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const back = (
    <Link href="/goals" className="inline-flex min-h-10 items-center gap-1.5 self-start rounded-lg pr-2 text-sm font-medium text-fg-2 hover:text-fg">
      <ArrowLeft className="size-4" aria-hidden /> Goals
    </Link>
  );

  if (q.error) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        {back}
        {notFound ? (
          <EmptyState icon={<Target className="size-6" aria-hidden />} title="Goal not found" action={<Link href="/goals" className="font-medium text-accent">Back to goals</Link>}>
            It may have been deleted.
          </EmptyState>
        ) : (
          <ErrorBanner error={q.error} onRetry={() => q.refetch()} />
        )}
      </div>
    );
  }

  if (!q.data || !settings) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        {back}
        {settingsQ.error ? <ErrorBanner error={settingsQ.error} onRetry={() => settingsQ.refetch()} /> : <DetailSkeleton />}
      </div>
    );
  }

  const g = q.data.goal;
  const today = q.data.today;
  const prefs = prefsOf(settings.settings);
  const meta = CATEGORY_META[g.category];
  const Icon = meta.icon;
  const def = METRIC_BY_KEY[g.metric];
  const isCustom = g.metric === "custom" && !g.linked;
  const busy = actions.busy === g.id;
  const href = sectionHref(g);
  const hasHistory = g.recent.some((p) => p.status !== "upcoming");

  const remove = async () => {
    setDeleting(true);
    try {
      await api.del(goalUrl(g.id));
      toast.success("Goal deleted");
      router.replace("/goals");
      // Refresh everything except this page's own query, which would now 404 before the navigation lands.
      void Promise.all(DATA_KEYS.filter((k) => k !== "goal").map((k) => qc.invalidateQueries({ queryKey: [k] })));
    } catch (err) {
      toast.error(err);
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      {back}

      <header className="flex flex-col gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-medium" style={{ color: meta.color }}>
            <Icon className="size-3.5" aria-hidden /> {meta.label}
            {def && <span className="text-muted">· {def.label}</span>}
          </p>
          <h1 className="mt-1 text-xl font-semibold text-fg [overflow-wrap:anywhere]">{g.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {g.subject && <span className="mr-1 text-sm text-fg-2">{g.subject}</span>}
            <Badge tone={g.status === "active" ? "good" : g.status === "completed" ? "accent" : "neutral"}>{GOAL_STATUS_LABELS[g.status]}</Badge>
            {g.linked && (
              <Badge tone="accent">
                <Link2 className="size-3" aria-hidden /> Linked
              </Badge>
            )}
            {!g.showOnDashboard && (
              <Badge tone="outline">
                <EyeOff className="size-3" aria-hidden /> Hidden from dashboard
              </Badge>
            )}
          </div>
        </div>
        {!g.linked && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Goal actions">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden /> Edit
            </Button>
            {g.status === "active" && (
              <Button variant="secondary" onClick={() => void actions.setStatus(g, "paused")} loading={busy}>
                <Pause className="size-4" aria-hidden /> Pause
              </Button>
            )}
            {g.status === "paused" && (
              <Button variant="secondary" onClick={() => void actions.setStatus(g, "active")} loading={busy}>
                <Play className="size-4" aria-hidden /> Resume
              </Button>
            )}
            {(g.status === "completed" || g.status === "archived") && (
              <Button variant="secondary" onClick={() => void actions.setStatus(g, "active")} loading={busy}>
                <RotateCcw className="size-4" aria-hidden /> Restore
              </Button>
            )}
            {g.status !== "completed" && (
              <Button variant="ghost" onClick={() => void actions.setStatus(g, "completed")} disabled={busy}>
                <CheckCircle2 className="size-4" aria-hidden /> Complete
              </Button>
            )}
            {g.status !== "archived" && (
              <Button variant="ghost" onClick={() => void actions.setStatus(g, "archived")} disabled={busy}>
                <Archive className="size-4" aria-hidden /> Archive
              </Button>
            )}
            <Button variant="ghost" className="text-critical hover:text-critical" onClick={() => setConfirm(true)}>
              <Trash2 className="size-4" aria-hidden /> Delete
            </Button>
          </div>
        )}
      </header>

      {g.linked && href && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2.5 text-sm text-fg">
          <span className="min-w-0">
            {g.linked === "nutrition" ? "This goal comes from your daily nutrition targets" : "This goal comes from your weight goals"} — it&apos;s read-only here.
          </span>
          <Link href={href} className="inline-flex min-h-10 items-center rounded-lg bg-surface px-3 font-medium text-accent hover:bg-surface-2">
            {linkedSectionLabel(g)}
          </Link>
        </div>
      )}

      {g.status === "paused" && <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg-2">Paused — days from now until you resume are excused from this goal&apos;s history.</p>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CurrentCard goal={g} prefs={prefs} today={today} />
        {isCustom ? <CheckinCard key={g.id} goal={g} today={today} prefs={prefs} actions={actions} /> : <StatsCard goal={g} />}
      </div>
      {isCustom && <StatsCard goal={g} />}

      {hasHistory && !isBinary(g) && <GoalHistoryChart goal={g} prefs={prefs} />}
      <StripCard goal={g} prefs={prefs} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TargetHistoryCard goal={g} prefs={prefs} />
        {!g.linked && <PausesCard goal={g} today={today} />}
        <div className={g.linked ? "" : "md:col-span-2"}>
          <SettingsCard goal={g} prefs={prefs} actions={actions} />
        </div>
      </div>

      {!g.linked && <GoalFormModal init={editing ? { mode: "edit", goal: g } : null} settings={settings} onClose={() => setEditing(false)} />}
      <ConfirmDialog open={confirm} title="Delete goal?" confirmLabel="Delete goal" loading={deleting} onClose={() => setConfirm(false)} onConfirm={() => void remove()}>
        <p>
          “{g.title}” and its history{isCustom ? " and check-ins" : ""} will be deleted. This can&apos;t be undone. To keep the history, archive it instead.
        </p>
      </ConfirmDialog>
    </div>
  );
}
