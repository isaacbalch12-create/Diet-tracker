"use client";

import { CalendarDays, Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/kit";
import { Button, Card, EmptyState, ErrorBanner, Field, Input, Select, Skeleton } from "@/components/ui";
import { useExercises, useSettings, useWorkouts } from "@/lib/client/hooks";
import type { WorkoutSummaryJ } from "@/lib/client/types";
import type { Unit } from "@/lib/training/types";
import { formatVolume } from "@/lib/training/units";
import { monthTitle, plural } from "./components/format";
import { WorkoutRow } from "./components/workout-row";

const PAGE = 60;

export function WorkoutHistoryView() {
  const settingsQ = useSettings();
  const exercisesQ = useExercises();
  const unit: Unit = settingsQ.data?.settings.weightUnit ?? "lb";
  const today = settingsQ.data?.today;
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [exerciseId, setExerciseId] = useState("");
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);

  // Debounce typing so the list doesn't refetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const rangeError = start && end && start > end ? "“From” must be on or before “To”." : null;
  const qs = new URLSearchParams(
    Object.entries({ start: rangeError ? "" : start, end: rangeError ? "" : end, exerciseId, q: search }).filter(([, v]) => v !== ""),
  ).toString();
  const q = useWorkouts(qs);
  const filtered = qs !== "";

  const exerciseOptions = useMemo(() => (exercisesQ.data ?? []).filter((e) => e.setCount > 0 || e.id === exerciseId).sort((a, b) => a.name.localeCompare(b.name)), [exercisesQ.data, exerciseId]);

  const groups = useMemo(() => {
    const all = q.data ?? [];
    // Month totals cover the whole month even when only part of it is shown yet.
    const totals = new Map<string, { workouts: number; sets: number; volumeKg: number }>();
    for (const w of all) {
      const k = w.localDate.slice(0, 7);
      const t = totals.get(k) ?? { workouts: 0, sets: 0, volumeKg: 0 };
      totals.set(k, { workouts: t.workouts + 1, sets: t.sets + w.setCount, volumeKg: t.volumeKg + w.volumeKg });
    }
    const map = new Map<string, WorkoutSummaryJ[]>();
    for (const w of all.slice(0, shown)) {
      const k = w.localDate.slice(0, 7);
      map.set(k, [...(map.get(k) ?? []), w]);
    }
    return [...map.entries()].map(([month, list]) => ({ month, list, totals: totals.get(month)! }));
  }, [q.data, shown]);

  const clear = () => {
    setStart("");
    setEnd("");
    setExerciseId("");
    setText("");
    setSearch("");
    setShown(PAGE);
  };

  const total = q.data?.length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Workout history"
        sub="Every workout, newest first. Tap one to view or edit it — records update automatically."
        actions={
          <Link href="/training?start=1" className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover">
            Log workout
          </Link>
        }
      />

      <Card>
        <form className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]" onSubmit={(e) => e.preventDefault()} role="search" aria-label="Filter workouts">
          <div className="relative col-span-2 md:col-span-1 md:self-end">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input type="search" aria-label="Search workouts by name, notes or exercise" placeholder="Search name, notes, exercise" className="pl-9 text-base sm:text-sm" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <Field label="Exercise" className="col-span-2 md:col-span-1">
            {(id) => (
              <Select id={id} value={exerciseId} onChange={(e) => setExerciseId(e.target.value)}>
                <option value="">All exercises</option>
                {exerciseOptions.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="From" error={rangeError}>
            {(id) => <Input id={id} type="date" max={end || today} value={start} onChange={(e) => setStart(e.target.value)} />}
          </Field>
          <Field label="To">
            {(id) => <Input id={id} type="date" min={start || undefined} max={today} value={end} onChange={(e) => setEnd(e.target.value)} />}
          </Field>
        </form>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
          <span aria-live="polite">{q.data ? `${plural(total, "workout")}${filtered ? " match" : ""}` : "Loading…"}</span>
          {(filtered || text) && (
            <Button variant="ghost" size="sm" onClick={clear}>
              <X className="size-4" aria-hidden /> Clear filters
            </Button>
          )}
        </div>
      </Card>

      {q.error ? <ErrorBanner error={q.error} onRetry={() => q.refetch()} /> : null}

      {!q.data ? (
        q.error ? null : (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading workouts">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        )
      ) : total === 0 ? (
        filtered ? (
          <EmptyState
            icon={<Search className="size-6" />}
            title="No workouts match these filters"
            action={
              <Button variant="secondary" onClick={clear}>
                Clear filters
              </Button>
            }
          >
            Try a wider date range or a different exercise.
          </EmptyState>
        ) : (
          <EmptyState
            icon={<CalendarDays className="size-6" />}
            title="No workouts yet"
            action={
              <Link href="/training?start=1" className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover">
                Start a workout
              </Link>
            }
          >
            Workouts you log (or import from LiftLog in Settings) show up here, grouped by month.
          </EmptyState>
        )
      ) : (
        <div className={q.isFetching ? "flex flex-col gap-4 opacity-80" : "flex flex-col gap-4"}>
          {groups.map(({ month, list, totals }) => {
            return (
              <Card key={month} className="px-2 py-3 sm:px-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-2 pb-1">
                  <h2 className="text-base font-semibold text-fg">{monthTitle(month)}</h2>
                  <p className="text-xs text-muted tabular">
                    {plural(totals.workouts, "workout")} · {plural(totals.sets, "set")} · {formatVolume(totals.volumeKg, unit)}
                  </p>
                </div>
                <ul className="flex flex-col">
                  {list.map((w) => (
                    <WorkoutRow key={w.id} w={w} unit={unit} />
                  ))}
                </ul>
              </Card>
            );
          })}
          {total > shown && (
            <Button variant="secondary" className="self-center" onClick={() => setShown(shown + PAGE)}>
              Show more ({(total - shown).toLocaleString()} older)
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
