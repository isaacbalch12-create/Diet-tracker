"use client";

import { BedDouble, Check, Footprints, HeartPulse, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader, ProgressRing, RangeTabs, rangeTitle } from "@/components/kit";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, cx, EmptyState, ErrorBanner, Modal, Skeleton } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useGoals, useInsights, useInvalidateData, useRuns, useSettings } from "@/lib/client/hooks";
import type { RunningJ, SettingsJ } from "@/lib/client/types";
import { fmtDistance } from "@/lib/client/units";
import { formatLocalDate, type RangePreset } from "@/lib/time";
import { RunCalendar } from "./components/run-calendar";
import { ConsistencyStats, RecordsCard, RunGoalsCard, RunInsights, RunTypeBreakdown, StreakCard } from "./components/run-cards";
import { DistanceBarsChart, RunProgressionChart } from "./components/run-charts";
import { DayOffForm, RunForm } from "./components/run-form";
import { RunEntryRow, RunHistory, useDeleteRunEntry } from "./components/run-history";
import { RUN_COLOR, STATUS_META, type RunEntryJ, type RunStatus } from "./components/run-meta";

function headline(status: RunStatus, day: RunningJ["days"][number] | undefined, unit: SettingsJ["distanceUnit"], minM: number | null): { title: string; body: string } {
  const dist = day && day.hasDistance ? fmtDistance(day.distanceM, unit, 2) : null;
  switch (status) {
    case "done":
      return { title: dist ? `Ran ${dist} today` : "Run done today", body: "Today counts toward your streak. Nice work." };
    case "short":
      return {
        title: `${dist ?? "Run"} logged — below your ${fmtDistance(minM, unit, 2)} minimum`,
        body: "It doesn't extend the streak, but short runs still build the habit. Never push through pain to hit a number.",
      };
    case "rest":
      return { title: "Rest day", body: "A planned day off. Your streak and consistency are safe." };
    case "recovery":
      return { title: "Recovery day", body: "Recovering is part of training. Your streak and consistency are safe." };
    default:
      return { title: "No run logged yet today", body: "Log it when you're done — distance is optional. Sore, ill or worn out? A rest or recovery day keeps your streak." };
  }
}

function StatusIcon({ status, day, minM }: { status: RunStatus; day: RunningJ["days"][number] | undefined; minM: number | null }) {
  if (status === "short" && minM && day) {
    return (
      <ProgressRing value={day.distanceM / minM} size={56} color="var(--warning)" label={`${Math.round((day.distanceM / minM) * 100)}% of daily minimum`}>
        {Math.round((day.distanceM / minM) * 100)}%
      </ProgressRing>
    );
  }
  const Icon = status === "done" ? Check : status === "rest" ? BedDouble : status === "recovery" ? HeartPulse : Footprints;
  const style = status === "done" ? { background: RUN_COLOR, color: "white" } : status === "recovery" ? { background: "var(--accent-soft)", color: "var(--accent)" } : { background: "var(--surface-2)", color: "var(--muted)" };
  return (
    <span className="flex size-14 shrink-0 items-center justify-center rounded-full" style={style} aria-hidden>
      <Icon className="size-6" />
    </span>
  );
}

function TodayCard({
  settings,
  today,
  data,
  formOpen,
  onOpenForm,
  onCloseForm,
  focusKey,
  onEdit,
}: {
  settings: SettingsJ;
  today: string;
  data: RunningJ | undefined;
  formOpen: boolean;
  onOpenForm: () => void;
  onCloseForm: () => void;
  focusKey: number;
  onEdit: (e: RunEntryJ) => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const remove = useDeleteRunEntry();
  const [busy, setBusy] = useState<null | "rest" | "recovery" | "clear">(null);
  const unit = settings.distanceUnit;
  const day = data?.days.find((d) => d.date === today);
  const status: RunStatus = day?.status ?? "pending";
  const minM = data?.goal?.minDistanceM ?? null;
  const todays = data?.entries.filter((e) => e.localDate === today) ?? [];
  const lastDistanceM = data?.entries.find((e) => e.kind === "run" && e.distanceM != null)?.distanceM ?? null;
  const h = headline(status, day, unit, minM);
  const hasRun = status === "done" || status === "short";
  const isOff = status === "rest" || status === "recovery";

  const clearOff = async (silent = false) => {
    setBusy("clear");
    try {
      await api.del(`/api/runs/day-off?date=${today}`);
      await invalidate();
      if (!silent) toast.success("Day off cleared");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const markOff = async (kind: "rest" | "recovery") => {
    setBusy(kind);
    try {
      await api.post("/api/runs/day-off", { localDate: today, kind, notes: null });
      await invalidate();
      toast.success(kind === "rest" ? "Today is a rest day — streak safe" : "Today is a recovery day — streak safe", { label: "Undo", onClick: () => void clearOff(true) });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="lg:col-span-2">
      <div className="flex items-start gap-4">
        {data ? <StatusIcon status={status} day={day} minM={minM} /> : <Skeleton className="size-14 rounded-full" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-muted">Today · {formatLocalDate(today, { weekday: "long", month: "short", day: "numeric" })}</p>
            {data && <Badge tone={STATUS_META[status].tone}>{status === "done" ? "Done" : STATUS_META[status].label}</Badge>}
          </div>
          {data ? (
            <>
              <h2 className="mt-1 text-lg font-semibold text-fg">{h.title}</h2>
              <p className="mt-0.5 text-sm text-fg-2">{h.body}</p>
            </>
          ) : (
            <Skeleton className="mt-2 h-10 w-full max-w-sm" />
          )}
        </div>
      </div>

      {todays.length > 0 && (
        <ul className="mt-3 flex flex-col divide-y divide-line border-t border-line">
          {todays.map((e) => (
            <RunEntryRow key={e.id} entry={e} unit={unit} onEdit={onEdit} onDelete={remove} showDate={false} />
          ))}
        </ul>
      )}

      {!formOpen && data && (
        <div className="mt-4 flex flex-wrap gap-2">
          {status === "pending" && (
            <>
              <Button size="lg" onClick={onOpenForm}>
                <Plus className="size-4" /> Log today&apos;s run
              </Button>
              <Button size="lg" variant="secondary" loading={busy === "rest"} onClick={() => markOff("rest")}>
                <BedDouble className="size-4" /> Rest day
              </Button>
              <Button size="lg" variant="secondary" loading={busy === "recovery"} onClick={() => markOff("recovery")}>
                <HeartPulse className="size-4" /> Recovery day
              </Button>
            </>
          )}
          {hasRun && (
            <Button size="lg" variant="secondary" onClick={onOpenForm}>
              <Plus className="size-4" /> Log another run
            </Button>
          )}
          {isOff && (
            <>
              <Button size="lg" variant="secondary" onClick={onOpenForm}>
                <Footprints className="size-4" /> I ran after all
              </Button>
              <Button size="lg" variant="ghost" loading={busy === "clear"} onClick={() => clearOff()}>
                Clear {status} day
              </Button>
            </>
          )}
        </div>
      )}

      {formOpen && (
        <div className="mt-4 border-t border-line pt-4">
          <RunForm settings={settings} today={today} days={data?.days} defaultDate={today} lastDistanceM={lastDistanceM} focusKey={focusKey} onDone={onCloseForm} onCancel={onCloseForm} />
        </div>
      )}
    </Card>
  );
}

export function RunningView({ log }: { log: string | null }) {
  const router = useRouter();
  const settingsQ = useSettings();
  const [range, setRange] = useState<RangePreset>("30d");
  const q = useRuns(`range=${range}`);
  const goalsQ = useGoals();
  const insightsQ = useInsights(30);
  const [formOpen, setFormOpen] = useState(log === "1");
  const [focusKey, setFocusKey] = useState(log === "1" ? 1 : 0);
  const [prevLog, setPrevLog] = useState(log);
  const [editing, setEditing] = useState<RunEntryJ | null>(null);

  // Opening /running?log=1 while already on the page (quick-add menu) reopens the form.
  if (log !== prevLog) {
    setPrevLog(log);
    if (log === "1") {
      setFormOpen(true);
      setFocusKey((k) => k + 1);
    }
  }
  useEffect(() => {
    if (log === "1") router.replace("/running", { scroll: false });
  }, [log, router]);

  if (!settingsQ.data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-48" />
        <Skeleton className="h-72" />
      </div>
    );
  }
  const settings = settingsQ.data.settings;
  const today = settingsQ.data.today;
  const unit = settings.distanceUnit;
  const d = q.data;
  const runInsights = (insightsQ.data?.insights ?? []).filter((i) => i.domain === "running");
  const recoveryInsight = runInsights.find((i) => i.id === "recovery") ?? null;
  const cautionShown = (d?.streaks.daysWithoutRest ?? 0) >= 10;
  const otherInsights = cautionShown ? runInsights.filter((i) => i.id !== "recovery") : runInsights;
  const neverLogged = !!d && d.entries.length === 0 && d.totals.runs === 0 && d.streaks.longest === 0 && !d.records.longestRun;
  const rangeLabel = rangeTitle(range);
  const openForm = () => {
    setFormOpen(true);
    setFocusKey((k) => k + 1);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Running"
        icon={<Footprints className="size-5" style={{ color: RUN_COLOR }} aria-hidden />}
        sub="Run every day — tracked by consistency and distance. No timers, no pace."
        actions={
          !formOpen ? (
            <Button onClick={openForm}>
              <Plus className="size-4" /> Log run
            </Button>
          ) : undefined
        }
      />

      {q.error && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <TodayCard settings={settings} today={today} data={d} formOpen={formOpen} onOpenForm={openForm} onCloseForm={() => setFormOpen(false)} focusKey={focusKey} onEdit={setEditing} />
        {d ? <StreakCard streaks={d.streaks} recoveryInsight={recoveryInsight} /> : <Skeleton className="h-40" />}
      </div>

      <div className={cx("grid grid-cols-1 gap-4", otherInsights.length > 0 && "lg:grid-cols-2")}>
        <RunGoalsCard goals={goalsQ.data?.goals} settings={settings} runGoal={d?.goal ?? null} />
        {otherInsights.length > 0 ? <RunInsights insights={otherInsights} /> : null}
      </div>

      {!d ? (
        <Skeleton className="h-96" />
      ) : neverLogged ? (
        <EmptyState
          icon={<Footprints className="size-8" />}
          title="Your first run starts the streak"
          action={
            !formOpen ? (
              <Button onClick={openForm}>
                <Plus className="size-4" /> Log a run
              </Button>
            ) : undefined
          }
        >
          Log each day&apos;s run — distance is optional. Streaks, consistency, distance charts and records appear here as you go. Planned rest and recovery days never count against you.
        </EmptyState>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-fg">Progress · {rangeLabel}</h2>
            <RangeTabs value={range} onChange={setRange} />
          </div>
          <div className={`flex flex-col gap-4 ${q.isFetching ? "opacity-80 transition-opacity" : ""}`}>
            <ConsistencyStats data={d} unit={unit} rangeLabel={rangeLabel} />
            <Card>
              <h3 className="mb-0.5 text-sm font-semibold text-fg">Daily completion</h3>
              <p className="mb-3 text-xs text-muted">Each square is a day. Hover or long-press for details.</p>
              <RunCalendar days={d.days} weekStartsOn={settings.weekStartsOn} unit={unit} showShort={!!d.goal?.minDistanceM || d.consistency.short > 0} />
            </Card>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <DistanceBarsChart buckets={d.weekly} unit={unit} period="week" />
              <DistanceBarsChart buckets={d.monthly} unit={unit} period="month" />
            </div>
            <RunProgressionChart entries={d.entries} unit={unit} minDistanceM={d.goal?.minDistanceM ?? null} />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <RunTypeBreakdown byType={d.byType} unit={unit} />
              <RecordsCard records={d.records} unit={unit} />
            </div>
            <RunHistory entries={d.entries} unit={unit} rangeLabel={range === "all" ? "all time" : `the last ${rangeLabel}`} onEdit={setEditing} />
          </div>
        </>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.kind === "run" ? "Edit run" : "Edit day off"}>
        {editing &&
          (editing.kind === "run" ? (
            <RunForm settings={settings} today={today} entry={editing} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
          ) : (
            <DayOffForm entry={editing} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
          ))}
      </Modal>
    </div>
  );
}
