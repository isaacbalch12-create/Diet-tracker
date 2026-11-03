"use client";

import { CalendarDays, ClipboardList, Dumbbell, Play, Repeat } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useToast } from "@/components/toast";
import { Button, Field, Input, Modal, Skeleton } from "@/components/ui";
import { api, newRequestId } from "@/lib/client/api";
import { useExercises, useInvalidateData, useTemplates } from "@/lib/client/hooks";
import type { WorkoutSummaryJ } from "@/lib/client/types";
import { byLastUsed, dayLabel, plural, workoutHref } from "./format";
import { inProgressConflict } from "./put";

export interface StartBody {
  localDate?: string;
  name?: string;
  templateId?: string;
  repeatWorkoutId?: string;
}

export interface Conflict {
  message: string;
  workoutId: string | null;
}

/** POST /api/workouts, then open the editor. A 409 surfaces as `conflict` (offer "Resume it"). */
export function useStartWorkout() {
  const router = useRouter();
  const toast = useToast();
  const invalidate = useInvalidateData();
  const [pending, setPending] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);

  const start = async (body: StartBody, key = "start"): Promise<boolean> => {
    if (pending) return false;
    setPending(key);
    setConflict(null);
    try {
      const res = await api.post<{ workout: { id: string } }>("/api/workouts", { clientRequestId: newRequestId(), ...body });
      void invalidate();
      router.push(workoutHref(res.workout.id));
      return true;
    } catch (err) {
      const c = inProgressConflict(err);
      if (c) setConflict(c);
      else toast.error(err);
      return false;
    } finally {
      setPending(null);
    }
  };

  return { start, pending, conflict, clearConflict: () => setConflict(null) };
}

export function ConflictBanner({ conflict, onDismiss }: { conflict: Conflict | null; onDismiss?: () => void }) {
  if (!conflict) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-text">
      <span className="min-w-0 flex-1">{conflict.message}</span>
      <span className="flex items-center gap-2">
        {conflict.workoutId && (
          <Link href={workoutHref(conflict.workoutId)} className="inline-flex h-9 items-center rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent-hover">
            Resume it
          </Link>
        )}
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="h-9 rounded-lg px-2 text-sm font-medium underline">
            Dismiss
          </button>
        )}
      </span>
    </div>
  );
}

export function StartWorkoutDialog({ open, onClose, today, recent, inProgress }: { open: boolean; onClose: () => void; today: string; recent: WorkoutSummaryJ[]; inProgress?: { id: string; name: string } | null }) {
  return (
    <Modal open={open} onClose={onClose} title="Start a workout">
      <StartBodyView today={today} recent={recent} inProgress={inProgress ?? null} />
    </Modal>
  );
}

function StartBodyView({ today, recent, inProgress }: { today: string; recent: WorkoutSummaryJ[]; inProgress: { id: string; name: string } | null }) {
  const { start, pending, conflict, clearConflict } = useStartWorkout();
  const templatesQ = useTemplates();
  const exercisesQ = useExercises();
  const [date, setDate] = useState(today);
  const [name, setName] = useState("");
  const names = useMemo(() => new Map((exercisesQ.data ?? []).map((e) => [e.id, e.name])), [exercisesQ.data]);
  const templates = useMemo(() => (templatesQ.data ? [...templatesQ.data].sort(byLastUsed) : []), [templatesQ.data]);
  const past = date < today;
  const base = (): StartBody => ({ localDate: date, ...(name.trim() ? { name: name.trim() } : {}) });
  const repeatable = recent.filter((w) => w.status === "completed" && w.setCount > 0).slice(0, 5);
  const dateError = !date ? "Pick a date." : date > today ? "Workouts can't be logged in the future." : null;

  return (
    <div className="flex flex-col gap-4">
      {inProgress && !conflict && <ConflictBanner conflict={{ message: `“${inProgress.name}” is still in progress. Finish it before starting another.`, workoutId: inProgress.id }} />}
      <ConflictBanner conflict={conflict} onDismiss={clearConflict} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Date" hint={past ? "Logging a past workout." : "Change it to log a past workout."} error={dateError}>
          {(id) => <Input id={id} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label="Name (optional)">
          {(id) => <Input id={id} value={name} maxLength={200} placeholder="e.g. Push day" onChange={(e) => setName(e.target.value)} />}
        </Field>
      </div>

      <Button size="lg" className="w-full" disabled={!!dateError} loading={pending === "empty"} onClick={() => start(base(), "empty")}>
        {past ? <CalendarDays className="size-5" aria-hidden /> : <Play className="size-5" aria-hidden />}
        {past ? `Log empty workout for ${dayLabel(date)}` : "Start empty workout"}
      </Button>

      <section aria-labelledby="start-templates">
        <h3 id="start-templates" className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-fg">
          <ClipboardList className="size-4 text-muted" aria-hidden /> From a template
        </h3>
        {templatesQ.isLoading ? (
          <Skeleton className="h-12" />
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted">
            No templates yet.{" "}
            <Link href="/training/templates" className="font-medium text-accent hover:underline">
              Create one
            </Link>{" "}
            or save a finished workout as a template.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  disabled={!!dateError || !!pending}
                  onClick={() => start({ ...base(), templateId: t.id }, `t:${t.id}`)}
                  className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-left hover:bg-surface-2 disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-fg">{t.name}</span>
                    <span className="block truncate text-xs text-muted">{t.items.map((i) => names.get(i.exerciseId) ?? "Exercise").join(", ") || "No exercises"}</span>
                  </span>
                  <span className="shrink-0 text-xs text-fg-2">{pending === `t:${t.id}` ? "Starting…" : plural(t.items.length, "exercise")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {repeatable.length > 0 && (
        <section aria-labelledby="start-repeat">
          <h3 id="start-repeat" className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-fg">
            <Repeat className="size-4 text-muted" aria-hidden /> Repeat a recent workout
          </h3>
          <ul className="flex flex-col gap-1.5">
            {repeatable.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  disabled={!!dateError || !!pending}
                  onClick={() => start({ ...base(), repeatWorkoutId: w.id }, `r:${w.id}`)}
                  className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-left hover:bg-surface-2 disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-fg">{w.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {dayLabel(w.localDate)} · {w.exerciseNames.join(", ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-fg-2">{pending === `r:${w.id}` ? "Starting…" : plural(w.setCount, "set")}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-muted">Copies the exercises and uses last time&apos;s numbers as targets.</p>
        </section>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Dumbbell className="size-3.5" aria-hidden /> Only one workout can be in progress at a time.
      </p>
    </div>
  );
}
