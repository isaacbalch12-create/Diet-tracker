"use client";

import { ArrowLeftRight, Check, NotebookPen, Pencil, PartyPopper } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DateNav } from "@/components/date-nav";
import { PageHeader, ProgressRing, RangeTabs } from "@/components/kit";
import { Button, Card, CardTitle, EmptyState, ErrorBanner, Skeleton, Stat, cx } from "@/components/ui";
import { useRoutine, useRoutineStats, useSettings } from "@/lib/client/hooks";
import { formatLocalDate, isLocalDate, type RangePreset } from "@/lib/time";
import { ActivityCard } from "./components/activity-cards";
import { RoutineEditor } from "./components/routine-editor";
import { otherSlot, pct, SLOT_META, SlotIcon, useLogActivity, type Slot } from "./components/shared";
import { ActivityRates, CompletionBars, DayStrip, SLOT_COLORS, StreakStat } from "./components/stats";

const STAT_RANGES: RangePreset[] = ["7d", "30d", "90d", "6m", "1y"];

function RoutineStats({ slot }: { slot: Slot }) {
  const [range, setRange] = useState<RangePreset>("30d");
  const q = useRoutineStats(`range=${range}`);
  const s = q.data;
  const st = s?.[slot];
  return (
    <section aria-labelledby="routine-stats-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="routine-stats-title" className="text-base font-semibold text-fg">
            Consistency
          </h2>
          {s && (
            <p className="text-xs text-muted">
              {formatLocalDate(s.range.start, { month: "short", day: "numeric" })} – {formatLocalDate(s.range.end, { month: "short", day: "numeric" })}
            </p>
          )}
        </div>
        <RangeTabs value={range} onChange={setRange} options={STAT_RANGES} />
      </div>
      {q.error && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      {!s || !st ? (
        <>
          <Skeleton className="h-40" />
          <Skeleton className="h-56" />
        </>
      ) : (
        <div className={cx("flex flex-col gap-4", q.isPlaceholderData && "opacity-70 transition-opacity")}>
          <Card>
            <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
              <Stat label="Days fully done" value={pct(st.completionPct)} sub={`${st.completeDays} of ${st.trackedDays} day${st.trackedDays === 1 ? "" : "s"}`} />
              <Stat label="Avg of required done" value={pct(st.avgPct)} sub="Per tracked day" />
              <StreakStat stats={st} />
              <Stat label="Days journaled" value={s.journaling[slot]} sub={`In this ${SLOT_META[slot].short.toLowerCase()} routine`} />
            </div>
            <div className="mt-5 border-t border-line pt-4">
              <DayStrip days={s.days} slot={slot} today={s.range.end} />
            </div>
          </Card>
          <CompletionBars stats={st} slot={slot} />
          <Card>
            <CardTitle sub="Most consistent first.">By activity</CardTitle>
            <ActivityRates stats={st} slot={slot} compact />
            <p className="mt-3 text-xs text-muted">Rates count the days each activity was part of the routine, so changes you make never rewrite the past. Today is counted from tomorrow.</p>
          </Card>
        </div>
      )}
    </section>
  );
}

export function RoutineView({ slot, initialDate }: { slot: "morning" | "night"; initialDate: string | null }) {
  const router = useRouter();
  const settingsQ = useSettings();
  // null = today (lets the server decide "today" and shares the cache with the dashboard).
  const [date, setDate] = useState<string | null>(initialDate && isLocalDate(initialDate) ? initialDate : null);
  const [editing, setEditing] = useState(false);
  const queryKey = ["routine", slot, date] as const;
  const q = useRoutine(slot, date);
  const todayQ = useRoutine(slot, null);
  const log = useLogActivity(queryKey);
  const meta = SLOT_META[slot];
  const other = otherSlot(slot);

  const today = q.data?.today ?? todayQ.data?.today ?? settingsQ.data?.today ?? null;
  const active = date ?? today;
  const isToday = !!active && active === today;
  // While another day loads, the previous day stays visible (dimmed, not editable).
  const day = q.data ?? null;
  const stale = !!day && day.date !== active;

  const changeDate = (d: string) => {
    const next = d === today ? null : d;
    setDate(next);
    router.replace(next ? `/routines/${slot}?date=${next}` : `/routines/${slot}`, { scroll: false });
  };
  const dateQs = active && !isToday ? `?date=${active}` : "";

  const p = day?.progress;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={<SlotIcon slot={slot} />}
        title={meta.label}
        sub={editing ? "Editing — add, remove, reorder and change activities." : "Tick things off as you go. No timers, just a checklist."}
        actions={
          <>
            <Link href={`/routines/${other}${dateQs}`} className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-fg-2 hover:bg-surface-2 hover:text-fg">
              <ArrowLeftRight className="size-4" aria-hidden /> {SLOT_META[other].short}
            </Link>
            <Link href={active ? `/journal?date=${active}&new=${slot}` : "/journal"} className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-fg-2 hover:bg-surface-2 hover:text-fg">
              <NotebookPen className="size-4" aria-hidden /> Journal
            </Link>
            <Button variant={editing ? "primary" : "secondary"} onClick={() => setEditing(!editing)} aria-pressed={editing}>
              {editing ? <Check className="size-4" aria-hidden /> : <Pencil className="size-4" aria-hidden />}
              {editing ? "Done editing" : "Edit routine"}
            </Button>
          </>
        }
      />

      {editing ? (
        todayQ.error ? (
          <ErrorBanner error={todayQ.error} onRetry={() => todayQ.refetch()} />
        ) : !todayQ.data ? (
          <Skeleton className="h-72" />
        ) : (
          <RoutineEditor slot={slot} day={todayQ.data} queryKey={["routine", slot, null]} />
        )
      ) : (
        <>
          <Card className="flex flex-wrap items-center justify-between gap-3">
            {active && today ? <DateNav date={active} today={today} onChange={changeDate} /> : <Skeleton className="h-10 w-48" />}
            {p ? (
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-sm font-medium text-fg">{p.required === 0 ? "Nothing required" : p.complete ? "All required done" : `${p.done} of ${p.required} required done`}</p>
                  {p.optionalDone > 0 && <p className="text-xs text-muted">+{p.optionalDone} optional</p>}
                </div>
                <ProgressRing value={p.required ? p.done / p.required : null} color={p.complete ? "var(--good)" : SLOT_COLORS[slot]} label={`${meta.label}: ${p.done} of ${p.required} required activities done`}>
                  {p.required ? `${p.done}/${p.required}` : "—"}
                </ProgressRing>
              </div>
            ) : (
              <Skeleton className="size-14 rounded-full" />
            )}
          </Card>

          {q.error && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}

          {p?.complete && !stale && (
            <div role="status" className="flex items-center gap-2 rounded-lg border border-good/30 bg-good-soft px-3 py-2 text-sm text-good-text">
              <PartyPopper className="size-4 shrink-0" aria-hidden />
              {isToday ? `${meta.label} complete — nice work.` : `${meta.label} was completed on this day.`}
            </div>
          )}
          {!isToday && active && day && !stale && (
            <p className="text-sm text-muted">
              {day.progress.required === 0 && day.activities.some((a) => a.activeFrom > day.date)
                ? `Your ${meta.label.toLowerCase()} didn't have these activities yet on ${formatLocalDate(active, { month: "long", day: "numeric" })}, so ticks here won't count toward your history.`
                : `Showing the activities that were part of this routine on ${formatLocalDate(active, { weekday: "long", month: "long", day: "numeric" })}. You can still update this day.`}
            </p>
          )}

          {!day ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          ) : day.activities.length === 0 ? (
            <EmptyState
              icon={<SlotIcon slot={slot} className="size-8" />}
              title={`Your ${meta.label.toLowerCase()} is empty`}
              action={
                <Button onClick={() => setEditing(true)}>
                  <Pencil className="size-4" aria-hidden /> Edit routine
                </Button>
              }
            >
              Add stretching, reading, journaling or anything else you want to do every {slot === "morning" ? "morning" : "night"}.
            </EmptyState>
          ) : (
            <ul className={cx("flex flex-col gap-3", stale && "pointer-events-none opacity-60 transition-opacity")} aria-busy={stale} aria-label={`${meta.label} checklist`}>
              {day.activities.map((a) => (
                <li key={`${a.id}:${day.date}`}>
                  <ActivityCard activity={a} date={day.date} slot={slot} queryKey={queryKey} log={log} journal={day.journal} onEditRoutine={() => setEditing(true)} />
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4">
            <RoutineStats slot={slot} />
          </div>
        </>
      )}
    </div>
  );
}
