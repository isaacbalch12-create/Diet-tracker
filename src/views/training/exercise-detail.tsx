"use client";

import { Archive, ArchiveRestore, ChevronLeft, Dumbbell, Pencil, Star, Trophy } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/charts";
import { KindBadge } from "@/components/kit";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardTitle, cx, EmptyState, ErrorBanner, Modal, Select, Skeleton, Stat } from "@/components/ui";
import { api, ApiError } from "@/lib/client/api";
import { useExercise, useInvalidateData, useSettings } from "@/lib/client/hooks";
import type { ExerciseDetailJ } from "@/lib/client/types";
import { formatLocalDate } from "@/lib/time";
import { weightKey } from "@/lib/training/exerciseStats";
import { CONFIDENCE_LABEL } from "@/lib/training/oneRm";
import type { Unit } from "@/lib/training/types";
import { formatLift, formatVolume } from "@/lib/training/units";
import { ExerciseForm } from "./components/exercise-form";
import { dayLabelWithYear, fmtInt, msToLocalDate, PLATEAU_LABEL, PLATEAU_TONE, plural, recordDetail, recordValue, signedPct, titleCase, workoutHref } from "./components/format";
import { BarSeriesChart, RepsChart, StrengthChart } from "./components/strength-charts";

type Detail = ExerciseDetailJ;
type ChangeJ = Detail["changes"]["d30"];

const weekTitle = (k: string) => `Week of ${formatLocalDate(k, { month: "short", day: "numeric", year: "numeric" })}`;

function signedLift(kg: number, unit: Unit): string {
  if (Math.abs(kg) < 0.01) return `±0 ${unit}`;
  return `${kg > 0 ? "+" : "−"}${formatLift(Math.abs(kg), unit)}`;
}

export function ExerciseDetailView({ id }: { id: string }) {
  const settingsQ = useSettings();
  const q = useExercise(id);
  const unit: Unit = settingsQ.data?.settings.weightUnit ?? "lb";

  if (q.error && !q.data) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        {missing ? (
          <EmptyState icon={<Dumbbell className="size-6" />} title="Exercise not found" action={<Link href="/training/exercises" className="font-medium text-accent hover:underline">Browse exercises</Link>} />
        ) : (
          <ErrorBanner error={q.error} onRetry={() => q.refetch()} />
        )}
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading exercise">
        <BackLink />
        <Skeleton className="h-36" />
        <Skeleton className="h-40" />
        <Skeleton className="h-72" />
      </div>
    );
  }
  return <DetailBody d={q.data} unit={unit} />;
}

function BackLink() {
  return (
    <Link href="/training/exercises" className="inline-flex h-10 items-center gap-1 self-start rounded-lg pr-2 text-sm font-medium text-fg-2 hover:text-fg">
      <ChevronLeft className="size-4" aria-hidden /> Exercises
    </Link>
  );
}

function DetailBody({ d, unit }: { d: Detail; unit: Unit }) {
  const ex = d.exercise;
  const s = d.stats;
  return (
    <div className="flex flex-col gap-4">
      <BackLink />
      <Header d={d} />
      {s.sessionCount === 0 ? (
        <EmptyState
          icon={<Dumbbell className="size-6" />}
          title={`No ${ex.name} sets logged yet`}
          action={
            <Link href="/training?start=1" className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover">
              Start a workout
            </Link>
          }
        >
          Statistics, charts and records appear after your first completed working set. Warm-ups don&apos;t count.
        </EmptyState>
      ) : (
        <>
          <StatsCard d={d} unit={unit} />
          <ProgressCard d={d} unit={unit} />
          <Charts d={d} unit={unit} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <RepRecords d={d} unit={unit} />
            <RecordsList d={d} unit={unit} />
          </div>
          <History d={d} unit={unit} />
        </>
      )}
    </div>
  );
}

function Header({ d }: { d: Detail }) {
  const ex = d.exercise;
  const toast = useToast();
  const invalidate = useInvalidateData();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const patch = async (body: { isFavorite?: boolean; archived?: boolean }, done?: string) => {
    setBusy(true);
    try {
      await api.patch(`/api/exercises/${encodeURIComponent(ex.id)}`, body);
      await invalidate();
      if (done) toast.success(done);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-fg">{ex.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone="accent">{titleCase(ex.primaryMuscle)}</Badge>
            {ex.secondaryMuscles.map((m) => (
              <Badge key={m} tone="outline">
                {titleCase(m)}
              </Badge>
            ))}
            <Badge>{titleCase(ex.equipment)}</Badge>
            <Badge>{titleCase(ex.category)}</Badge>
            {ex.isCustom && <Badge tone="outline">Custom</Badge>}
            {ex.archived && <Badge tone="warning">Archived</Badge>}
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          aria-pressed={ex.isFavorite}
          aria-label={ex.isFavorite ? "Remove from favorites" : "Add to favorites"}
          title={ex.isFavorite ? "Favorite" : "Add to favorites"}
          onClick={() => void patch({ isFavorite: !ex.isFavorite })}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg hover:bg-surface-2 disabled:opacity-50"
        >
          <Star className={cx("size-5", ex.isFavorite ? "fill-current text-warning" : "text-muted")} aria-hidden />
        </button>
      </div>
      {ex.instructions.trim() && <p className="mt-3 text-sm whitespace-pre-line text-fg-2">{ex.instructions}</p>}
      <p className="mt-3 text-xs text-muted">Secondary muscles count as half a set in muscle-group totals.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {ex.isCustom && (
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="size-4" aria-hidden /> Edit
          </Button>
        )}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void patch({ archived: !ex.archived }, ex.archived ? "Unarchived — back in your pickers" : "Archived — hidden from pickers, history kept")}>
          {ex.archived ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
          {ex.archived ? "Unarchive" : "Archive"}
        </Button>
      </div>
      <Modal open={editing} onClose={() => setEditing(false)} title={`Edit “${ex.name}”`}>
        <ExerciseForm
          exerciseId={ex.id}
          initial={{ name: ex.name, primaryMuscle: ex.primaryMuscle, secondaryMuscles: ex.secondaryMuscles, equipment: ex.equipment, category: ex.category, instructions: ex.instructions }}
          onCancel={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      </Modal>
    </Card>
  );
}

function StatsCard({ d, unit }: { d: Detail; unit: Unit }) {
  const s = d.stats;
  const when = (ms: number) => dayLabelWithYear(msToLocalDate(ms));
  return (
    <Card>
      <CardTitle action={<KindBadge kind="measured" />}>Lifetime</CardTitle>
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
        <Stat label="Sessions" value={<span className="tabular">{fmtInt(s.sessionCount)}</span>} />
        <Stat label="Working sets" value={<span className="tabular">{fmtInt(s.setCount)}</span>} />
        <Stat label="Reps" value={<span className="tabular">{fmtInt(s.totalReps)}</span>} />
        <Stat label="Total volume" value={<span className="tabular">{formatVolume(s.totalVolumeKg, unit)}</span>} />
        <Stat label="Heaviest" value={<span className="tabular">{formatLift(s.heaviest?.value, unit)}</span>} sub={s.heaviest ? `× ${s.heaviest.reps} · ${when(s.heaviest.dateMs)}` : undefined} />
        <Stat
          label="Best est. 1RM"
          value={<span className="tabular">{formatLift(s.bestE1rm?.value, unit)}</span>}
          sub={
            s.bestE1rm ? (
              <span className="flex flex-col gap-1">
                <span>
                  From {formatLift(s.bestE1rm.weightKg, unit)} × {s.bestE1rm.reps} · {when(s.bestE1rm.dateMs)}
                </span>
                <span className="flex flex-wrap items-center gap-1">
                  <KindBadge kind="estimate" /> {CONFIDENCE_LABEL[s.bestE1rm.confidence]}
                </span>
              </span>
            ) : (
              "No set within your rep cap yet"
            )
          }
        />
        <Stat label="Most reps" value={<span className="tabular">{s.mostReps ? `${s.mostReps.value} reps` : "—"}</span>} sub={s.mostReps ? `at ${formatLift(s.mostReps.weightKg, unit)} · ${when(s.mostReps.dateMs)}` : undefined} />
        <Stat label="Best session volume" value={<span className="tabular">{s.bestSessionVolume ? formatVolume(s.bestSessionVolume.value, unit) : "—"}</span>} sub={s.bestSessionVolume ? when(s.bestSessionVolume.dateMs) : undefined} />
      </div>
    </Card>
  );
}

function ChangeStat({ label, c, unit }: { label: string; c: ChangeJ; unit: Unit }) {
  if (c.status !== "ok") return <Stat label={label} value={<span className="text-base text-muted">—</span>} sub={c.reason} />;
  return (
    <Stat
      label={label}
      value={<span className={cx("tabular", c.pct > 0.001 ? "text-good-text" : c.pct < -0.001 ? "text-critical" : "")}>{signedPct(c.pct)}</span>}
      sub={
        <span title={c.explanation}>
          {formatLift(c.baseline, unit)} → {formatLift(c.current, unit)}
        </span>
      }
    />
  );
}

function ProgressCard({ d, unit }: { d: Detail; unit: Unit }) {
  const t = d.trend;
  const p = d.plateau;
  const cmp = d.stats.comparison;
  return (
    <Card>
      <CardTitle sub="Based on your best estimated 1RM per session — approximate, not a tested max." action={<KindBadge kind="estimate" />}>
        Progress
      </CardTitle>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-fg-2">Status</span>
            <Badge tone={PLATEAU_TONE[p.status]}>{PLATEAU_LABEL[p.status]}</Badge>
          </div>
          <p className="text-sm text-fg-2">{p.explanation}</p>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
          <Stat
            label="Trend"
            value={t.status === "ok" ? <span className={cx("tabular", t.pctPerMonth > 0.001 ? "text-good-text" : t.pctPerMonth < -0.001 ? "text-critical" : "")}>{signedPct(t.pctPerMonth)}/mo</span> : <span className="text-base text-muted">—</span>}
            sub={t.status === "ok" ? `${signedLift(t.kgPerMonth, unit)} per month · fitted to ${plural(t.sessions, "session")}` : t.reason}
          />
          <ChangeStat label="Last 30 days" c={d.changes.d30} unit={unit} />
          <ChangeStat label="Last 90 days" c={d.changes.d90} unit={unit} />
          <ChangeStat label="Last 180 days" c={d.changes.d180} unit={unit} />
        </div>
        {d.relative && (
          <p className="text-sm text-fg-2">
            Current vs peak: <span className="font-semibold text-fg tabular">{Math.round(d.relative.ratio * 100)}%</span> — best estimated 1RM in the last 30 days ({formatLift(d.relative.recentBest, unit)}) vs your all-time best ({formatLift(d.relative.allTimeBest, unit)}).
          </p>
        )}
        {cmp && (
          <div className="rounded-lg bg-surface-2 px-3 py-2.5">
            <p className="text-xs font-medium text-muted">
              Last session ({dayLabelWithYear(cmp.latestDate)}) vs the one before ({dayLabelWithYear(cmp.previousDate)})
            </p>
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-2 tabular">
              <span>Top set {signedLift(cmp.topWeightDeltaKg, unit)}</span>
              {cmp.e1rmDeltaKg != null && <span>Est. 1RM {signedLift(cmp.e1rmDeltaKg, unit)}</span>}
              <span>
                Volume {cmp.volumeDeltaKg >= 0 ? "+" : "−"}
                {formatVolume(Math.abs(cmp.volumeDeltaKg), unit)}
              </span>
              <span>
                Reps {cmp.totalRepsDelta >= 0 ? "+" : "−"}
                {Math.abs(cmp.totalRepsDelta)}
              </span>
              <span>
                Sets {cmp.setCountDelta >= 0 ? "+" : "−"}
                {Math.abs(cmp.setCountDelta)}
              </span>
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

function Charts({ d, unit }: { d: Detail; unit: Unit }) {
  const series = d.series;
  const [choice, setChoice] = useState<number | null>(null);
  const key = choice ?? series.weightsUsed[0]?.weightKey ?? null;
  const repsAt = useMemo(
    () =>
      key == null
        ? []
        : series.repsByWeight.flatMap((sess) => {
            const at = sess.sets.filter((f) => weightKey(f.weightKg, unit) === key);
            return at.length ? [{ date: sess.date, reps: Math.max(...at.map((f) => f.reps)), note: plural(at.length, "set") }] : [];
          }),
    [series.repsByWeight, key, unit],
  );
  const vol = (v: number) => `${v.toLocaleString("en-US")} ${unit}`;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <StrengthChart data={series.strength} unit={unit} actions={<KindBadge kind="estimate" />} />
      </div>
      <BarSeriesChart title="Volume per session" sub="Weight × reps of working sets." data={series.sessionVolume.map((p) => ({ key: p.date, value: p.value }))} valueLabel="Volume" fmt={vol} />
      <BarSeriesChart
        title="Weekly volume"
        sub="Weeks without this exercise show as zero."
        data={series.weeklyVolume.map((p) => ({ key: p.date, value: p.value }))}
        valueLabel="Volume"
        fmt={vol}
        keyLabel="Week"
        keyTitle={weekTitle}
        color="var(--series-1)"
      />
      <BarSeriesChart
        title="Sessions per week"
        data={series.sessionsPerWeek.map((p) => ({ key: p.date, value: p.value }))}
        valueLabel="Sessions"
        fmt={(v) => String(v)}
        keyLabel="Week"
        keyTitle={weekTitle}
        color="var(--series-3)"
        height={180}
      />
      <RepsChart
        title="Reps at one weight"
        sub="Best set at the chosen weight in each session that used it."
        data={repsAt}
        emptyText="No sets at this weight."
        actions={
          series.weightsUsed.length > 0 ? (
            <Select aria-label="Weight" className="h-8 w-auto py-0 pr-7 text-xs" value={key ?? ""} onChange={(e) => setChoice(Number(e.target.value))}>
              {series.weightsUsed.map((w) => (
                <option key={w.weightKey} value={w.weightKey}>
                  {w.weightKey.toLocaleString("en-US")} {unit} ({plural(w.sessions, "session")})
                </option>
              ))}
            </Select>
          ) : undefined
        }
      />
      <RepsChart
        title="Most reps per session"
        sub="Your highest-rep working set each session, with the weight used."
        color="var(--series-cal)"
        data={series.maxReps.map((p) => ({ date: p.date, reps: p.reps, note: `at ${p.weight.toLocaleString("en-US")} ${unit}` }))}
      />
    </div>
  );
}

function RepRecords({ d, unit }: { d: Detail; unit: Unit }) {
  const rows = d.stats.repRecords;
  return (
    <Card>
      <CardTitle sub="Most reps you've done at each weight (heaviest first).">Rep records</CardTitle>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">None yet.</p>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          <DataTable columns={["Weight", "Most reps", "Date"]} rows={rows.map((r) => [formatLift(r.weightKg, unit), r.reps, dayLabelWithYear(msToLocalDate(r.dateMs))])} />
        </div>
      )}
    </Card>
  );
}

function RecordsList({ d, unit }: { d: Detail; unit: Unit }) {
  const [all, setAll] = useState(false);
  const list = all ? d.records : d.records.slice(0, 12);
  return (
    <Card>
      <CardTitle sub="Every time you beat your own best on this exercise.">Records</CardTitle>
      {d.records.length === 0 ? (
        <p className="text-sm text-muted">Your first session sets the baseline — beat it to log a record.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {list.map((r) => (
              <li key={r.key}>
                <Link href={workoutHref(r.workoutId)} className="-mx-2 flex items-start gap-2.5 rounded-lg px-2 py-1 hover:bg-surface-2">
                  <Trophy className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-fg">
                      {r.label} <span className="font-normal text-fg-2 tabular">· {recordValue(r, unit)}</span>
                    </span>
                    {recordDetail(r, unit) && <span className="block text-xs text-muted tabular">{recordDetail(r, unit)}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{dayLabelWithYear(r.date)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {d.records.length > list.length && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAll(true)}>
              Show all {d.records.length}
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

function History({ d, unit }: { d: Detail; unit: Unit }) {
  const [shown, setShown] = useState(15);
  const list = d.history.slice(0, shown);
  return (
    <Card>
      <CardTitle sub="Completed working sets, newest first. Warm-ups aren't shown.">History</CardTitle>
      <ul className="flex flex-col divide-y divide-line">
        {list.map((h) => (
          <li key={h.workoutId} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <Link href={workoutHref(h.workoutId)} className="min-w-0 truncate font-medium text-fg hover:text-accent">
                {h.workoutName}
              </Link>
              <span className="text-xs text-muted">{dayLabelWithYear(h.date)}</span>
            </div>
            <p className="mt-1 flex flex-wrap gap-1.5">
              {h.sets.map((x) => (
                <span key={x.id} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-fg-2 tabular">
                  {formatLift(x.weightKg, unit, { withUnit: false })} × {x.reps}
                  {x.rpe != null && <span className="text-muted"> @{x.rpe}</span>}
                </span>
              ))}
            </p>
            <p className="mt-1 text-xs text-muted tabular">
              {formatVolume(h.volumeKg, unit)} · {plural(h.totalReps, "rep")}
              {h.bestE1rmKg != null && <> · est. 1RM {formatLift(h.bestE1rmKg, unit)}</>}
            </p>
          </li>
        ))}
      </ul>
      {d.history.length > shown && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setShown(shown + 30)}>
          Show more ({d.history.length - shown} older)
        </Button>
      )}
    </Card>
  );
}

