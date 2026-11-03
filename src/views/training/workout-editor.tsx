"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ClipboardList, CloudCheck, CloudOff, Copy, Dumbbell, Flag, Loader2, PartyPopper, Plus, Repeat, RotateCcw, Trash2, Trophy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KindBadge } from "@/components/kit";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardTitle, EmptyState, ErrorBanner, Field, Input, Modal, Segmented, Skeleton, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/client/api";
import { DATA_KEYS, useExercises, useInvalidateData, useSettings, useWorkout } from "@/lib/client/hooks";
import type { SettingsJ, WorkoutDetailJ, WorkoutTemplateJ } from "@/lib/client/types";
import { estimate1RM } from "@/lib/training/oneRm";
import type { Unit } from "@/lib/training/types";
import { formatLift, formatVolume } from "@/lib/training/units";
import { useAutosave, type SaveStatus } from "./components/autosave";
import { ExerciseBlock, type ExerciseMeta } from "./components/exercise-block";
import { ExercisePicker } from "./components/exercise-picker";
import { celebrationText, plural, recordDetail, recordValue } from "./components/format";
import { ActionMenu } from "./components/menu";
import { apiPut, inProgressConflict, isTransient } from "./components/put";
import { ConflictBanner, useStartWorkout, type Conflict } from "./components/start-workout";
import {
  blankSet,
  docFromWorkout,
  docPayload,
  docTotals,
  LIMITS,
  newSetId,
  newWorkoutExerciseId,
  recordSignature,
  setCounts,
  setLabels,
  type EditorDoc,
  type EditorExercise,
  type EditorSet,
  type PrevSet,
  type SetKind,
} from "./components/workout-doc";

type RecordJ = WorkoutDetailJ["records"][number];
type Busy = null | "finish" | "reopen" | "template" | "delete" | "repeat";

const NO_RECORDS: RecordJ[] = [];
const UNKNOWN_META: ExerciseMeta = { name: "Loading exercise…", primaryMuscle: "", equipment: "", archived: false };

const mapExercise = (d: EditorDoc, weId: string, fn: (e: EditorExercise) => EditorExercise): EditorDoc => ({ ...d, exercises: d.exercises.map((e) => (e.id === weId ? fn(e) : e)) });
const mapSet = (e: EditorExercise, setId: string, fn: (s: EditorSet) => EditorSet): EditorExercise => ({ ...e, sets: e.sets.map((s) => (s.id === setId ? fn(s) : s)) });

export function WorkoutEditorView({ id }: { id: string }) {
  const settingsQ = useSettings();
  const q = useWorkout(id);
  if (q.error && !q.data) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        {missing ? (
          <EmptyState icon={<Dumbbell className="size-6" />} title="Workout not found" action={<Link href="/training/history" className="font-medium text-accent hover:underline">Go to workout history</Link>}>
            It may have been deleted.
          </EmptyState>
        ) : (
          <ErrorBanner error={q.error} onRetry={() => q.refetch()} />
        )}
      </div>
    );
  }
  if (!q.data || !settingsQ.data) return <EditorSkeleton />;
  return <Editor key={id} id={id} initial={q.data} settings={settingsQ.data.settings} today={settingsQ.data.today} />;
}

function BackLink() {
  return (
    <Link href="/training" className="inline-flex h-10 items-center gap-1 self-start rounded-lg pr-2 text-sm font-medium text-fg-2 hover:text-fg">
      <ChevronLeft className="size-4" aria-hidden /> Training
    </Link>
  );
}

function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading workout">
      <Skeleton className="h-12" />
      <Skeleton className="h-40" />
      <Skeleton className="h-56" />
      <Skeleton className="h-56" />
    </div>
  );
}

function SaveIndicator({ status, error, onRetry }: { status: SaveStatus; error: unknown; onRetry: () => void }) {
  if (status === "error") {
    return (
      <p role="status" className="flex items-center gap-1 text-xs text-critical" title={error instanceof Error ? error.message : undefined}>
        <CloudOff className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{isTransient(error) ? "Offline — will retry" : error instanceof Error ? error.message : "Not saved"}</span>
        <button type="button" onClick={onRetry} className="shrink-0 font-medium underline">
          Retry
        </button>
      </p>
    );
  }
  const saving = status === "pending" || status === "saving";
  return (
    <p role="status" aria-live="polite" className="flex items-center gap-1 text-xs text-muted">
      {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <CloudCheck className="size-3.5" aria-hidden />}
      {saving ? "Saving…" : "Saved"}
    </p>
  );
}

function Editor({ id, initial, settings, today }: { id: string; initial: WorkoutDetailJ; settings: SettingsJ; today: string }) {
  const q = useWorkout(id);
  const server = q.data ?? initial;
  const exercisesQ = useExercises();
  const qc = useQueryClient();
  const invalidate = useInvalidateData();
  const toast = useToast();
  const router = useRouter();
  const startW = useStartWorkout();
  const unit: Unit = settings.weightUnit;
  const enc = encodeURIComponent(id);

  const [init] = useState(() => {
    const d = docFromWorkout(initial);
    return { doc: d, sig: recordSignature(d) };
  });
  const [doc, setDoc] = useState(init.doc);
  const docRef = useRef(init.doc);
  const sigRef = useRef(init.sig);
  const celebratedRef = useRef<string[]>([]);
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  });

  const [picker, setPicker] = useState<null | { mode: "add" } | { mode: "replace"; weId: string }>(null);
  const [menu, setMenu] = useState<null | { weId: string; setId: string }>(null);
  const [finishAsk, setFinishAsk] = useState<null | ReturnType<typeof setCounts>>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [justFinished, setJustFinished] = useState<null | { records: number }>(null);

  // ---- Saving -------------------------------------------------------------
  const save = async (d: EditorDoc) => {
    const keys = celebratedRef.current;
    await apiPut(`/api/workouts/${enc}`, docPayload(d, keys));
    if (keys.length) celebratedRef.current = celebratedRef.current.filter((k) => !keys.includes(k));
    const sig = recordSignature(d);
    if (sig !== sigRef.current) {
      // Records, "last time" and every derived screen depend on this: refetch now.
      sigRef.current = sig;
      void invalidate();
    } else {
      // Names/notes/unticked numbers: mark everything stale without refetching this screen.
      void Promise.all(DATA_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k], refetchType: "none" })));
    }
  };
  const [saveState, autosave] = useAutosave(save);

  const update = useCallback(
    (fn: (d: EditorDoc) => EditorDoc) => {
      const next = fn(docRef.current);
      if (next === docRef.current) return;
      docRef.current = next;
      setDoc(next);
      autosave.schedule(next);
    },
    [autosave],
  );

  const replaceDoc = (next: EditorDoc) => {
    docRef.current = next;
    sigRef.current = recordSignature(next);
    setDoc(next);
  };

  // ---- Set and exercise actions (stable so memoized rows skip re-rendering) ----
  const patchSet = useCallback((weId: string, setId: string, patch: Partial<EditorSet>) => update((d) => mapExercise(d, weId, (e) => mapSet(e, setId, (s) => ({ ...s, ...patch })))), [update]);

  const toggleSet = useCallback(
    (weId: string, setId: string, prev: PrevSet | null) => {
      const s = docRef.current.exercises.find((e) => e.id === weId)?.sets.find((x) => x.id === setId);
      if (!s) return;
      if (s.completed) return patchSet(weId, setId, { completed: false });
      // "Same as last time": empty fields take last session's matching set, else the template target.
      const weightKg = s.weightKg ?? prev?.weightKg ?? s.targetWeightKg ?? null;
      const reps = s.reps ?? prev?.reps ?? s.targetReps ?? null;
      if (weightKg == null || reps == null || reps < 1) {
        toastRef.current.error("Enter weight and reps first (use 0 for bodyweight exercises).");
        return;
      }
      patchSet(weId, setId, { weightKg, reps, completed: true });
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(12);
    },
    [patchSet],
  );

  const onMessage = useCallback((kind: "error" | "info", message: string) => (kind === "error" ? toastRef.current.error(message) : toastRef.current.info(message)), []);
  const openSetMenu = useCallback((weId: string, setId: string) => setMenu({ weId, setId }), []);
  const openReplace = useCallback((weId: string) => setPicker({ mode: "replace", weId }), []);

  const addSet = useCallback(
    (weId: string) =>
      update((d) =>
        mapExercise(d, weId, (e) => {
          if (e.sets.length >= LIMITS.maxSets) return e;
          const last = e.sets[e.sets.length - 1];
          return { ...e, sets: [...e.sets, blankSet(last ? { weightKg: last.weightKg, reps: last.reps, targetWeightKg: last.targetWeightKg, targetReps: last.targetReps } : {})] };
        }),
      ),
    [update],
  );

  const moveExercise = useCallback(
    (weId: string, dir: -1 | 1) =>
      update((d) => {
        const i = d.exercises.findIndex((e) => e.id === weId);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= d.exercises.length) return d;
        const list = [...d.exercises];
        [list[i], list[j]] = [list[j], list[i]];
        return { ...d, exercises: list };
      }),
    [update],
  );

  const removeExercise = useCallback(
    (weId: string) => {
      const d = docRef.current;
      const i = d.exercises.findIndex((e) => e.id === weId);
      if (i < 0) return;
      const removed = d.exercises[i];
      update((cur) => ({ ...cur, exercises: cur.exercises.filter((e) => e.id !== weId) }));
      if (removed.sets.some((s) => s.completed || s.weightKg != null || s.reps != null)) {
        toastRef.current.success("Exercise removed", {
          label: "Undo",
          onClick: () => update((cur) => (cur.exercises.some((e) => e.id === removed.id) ? cur : { ...cur, exercises: [...cur.exercises.slice(0, i), removed, ...cur.exercises.slice(i)] })),
        });
      }
    },
    [update],
  );

  const setExerciseNotes = useCallback((weId: string, notes: string) => update((d) => mapExercise(d, weId, (e) => ({ ...e, notes }))), [update]);

  const duplicateSet = (weId: string, setId: string) =>
    update((d) =>
      mapExercise(d, weId, (e) => {
        const i = e.sets.findIndex((s) => s.id === setId);
        if (i < 0 || e.sets.length >= LIMITS.maxSets) return e;
        const copy: EditorSet = { ...e.sets[i], id: newSetId(), completed: false, manualSetNumber: false };
        return { ...e, sets: [...e.sets.slice(0, i + 1), copy, ...e.sets.slice(i + 1)] };
      }),
    );

  const deleteSet = (weId: string, setId: string) => {
    const ex = docRef.current.exercises.find((e) => e.id === weId);
    const i = ex?.sets.findIndex((s) => s.id === setId) ?? -1;
    if (!ex || i < 0) return;
    const removed = ex.sets[i];
    update((d) => mapExercise(d, weId, (e) => ({ ...e, sets: e.sets.filter((s) => s.id !== setId) })));
    if (removed.completed || removed.weightKg != null || removed.reps != null) {
      toast.success("Set deleted", {
        label: "Undo",
        onClick: () => update((d) => mapExercise(d, weId, (e) => (e.sets.some((s) => s.id === removed.id) ? e : { ...e, sets: [...e.sets.slice(0, i), removed, ...e.sets.slice(i)] }))),
      });
    }
  };

  const addExercises = (ids: string[]) =>
    update((d) => {
      const room = LIMITS.maxExercises - d.exercises.length;
      if (room <= 0) {
        toast.error(`A workout can hold up to ${LIMITS.maxExercises} exercises.`);
        return d;
      }
      const added = ids.slice(0, room).map((exerciseId): EditorExercise => ({ id: newWorkoutExerciseId(), exerciseId, notes: "", sets: [blankSet()] }));
      return { ...d, exercises: [...d.exercises, ...added] };
    });

  const replaceExercise = (weId: string, exerciseId: string) => update((d) => mapExercise(d, weId, (e) => ({ ...e, exerciseId })));

  // ---- Derived display data ----------------------------------------------
  const metaById = useMemo(() => {
    const m = new Map<string, ExerciseMeta>();
    for (const e of exercisesQ.data ?? []) m.set(e.id, { name: e.name, primaryMuscle: e.primaryMuscle, equipment: e.equipment, archived: e.archived });
    for (const e of server.exercises) if (!m.has(e.exerciseId)) m.set(e.exerciseId, { name: e.exercise.name, primaryMuscle: e.exercise.primaryMuscle, equipment: e.exercise.equipment, archived: e.exercise.archived });
    return m;
  }, [exercisesQ.data, server.exercises]);
  const serverByWe = useMemo(() => new Map(server.exercises.map((e) => [e.id, e])), [server.exercises]);
  const recordsByExercise = useMemo(() => {
    const m = new Map<string, RecordJ[]>();
    for (const r of server.records) {
      if (!r.exerciseId) continue;
      m.set(r.exerciseId, [...(m.get(r.exerciseId) ?? []), r]);
    }
    return m;
  }, [server.records]);

  const status = server.status;
  const totals = docTotals(doc);
  const counts = setCounts(doc);
  const dateError = doc.localDate > today ? "Workouts can't be logged in the future." : null;

  // ---- Workout-level actions ----------------------------------------------
  const saveNow = async () => {
    const ok = await autosave.flush();
    if (!ok) throw new Error("Couldn't save your latest changes. Check your connection and try again.");
  };

  const requestFinish = () => {
    const c = setCounts(docRef.current);
    if (c.untickedWithValues > 0 || c.completed === 0) setFinishAsk(c);
    else void finish("discard");
  };

  const finish = async (incomplete: "discard" | "complete") => {
    setBusy("finish");
    try {
      await saveNow();
      await api.post(`/api/workouts/${enc}/finish`, { incomplete });
      const fresh = (await api.get<{ workout: WorkoutDetailJ }>(`/api/workouts/${enc}`)).workout;
      qc.setQueryData(["workout", id], fresh);
      replaceDoc(docFromWorkout(fresh));
      const celebrated = new Set(fresh.celebratedRecordKeys);
      const fresh_ = fresh.records.filter((r) => !celebrated.has(r.key));
      toast.success(fresh_.length > 3 ? `Workout finished — ${fresh_.length} new records!` : "Workout finished");
      fresh_.slice(0, 3).forEach((r) => toast.success(celebrationText(r, unit)));
      if (fresh_.length) {
        // Persist which records were celebrated so reopening never celebrates them again.
        celebratedRef.current = [...celebratedRef.current, ...fresh_.map((r) => r.key)];
        autosave.schedule(docRef.current, 0);
      }
      setJustFinished({ records: fresh_.length });
      setFinishAsk(null);
      void invalidate();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const reopen = async () => {
    setBusy("reopen");
    setConflict(null);
    try {
      await saveNow();
      await api.post(`/api/workouts/${enc}/reopen`);
      setJustFinished(null);
      await invalidate();
      toast.success("Workout reopened — finish it again when you're done.");
    } catch (err) {
      const c = inProgressConflict(err);
      if (c) setConflict(c);
      else toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const saveAsTemplate = async () => {
    setBusy("template");
    try {
      await saveNow();
      const res = await api.post<{ template: WorkoutTemplateJ }>(`/api/workouts/${enc}/template`);
      void invalidate();
      toast.success(`Saved template “${res.template.name}”`, { label: "View", onClick: () => router.push("/training/templates") });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const repeat = async () => {
    setBusy("repeat");
    try {
      await saveNow();
      await startW.start({ repeatWorkoutId: id }, "repeat");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    const msg =
      status === "in_progress"
        ? "Discard this workout? Everything logged in it will be deleted."
        : "Delete this workout? Its sets are removed from your history and records are recalculated. This can't be undone.";
    if (!window.confirm(msg)) return;
    setBusy("delete");
    try {
      await autosave.cancel();
      await api.del(`/api/workouts/${enc}`);
      router.push("/training");
      void invalidate();
      toast.success(status === "in_progress" ? "Workout discarded" : "Workout deleted");
    } catch (err) {
      toast.error(err);
      setBusy(null);
    }
  };

  const workoutActions = [
    status === "completed" && { label: "Reopen workout", icon: <RotateCcw />, onSelect: () => void reopen() },
    status === "completed" && { label: "Repeat workout", icon: <Repeat />, onSelect: () => void repeat() },
    { label: "Save as template", icon: <ClipboardList />, onSelect: () => void saveAsTemplate(), disabled: totals.sets === 0 && status === "completed" },
    { label: status === "in_progress" ? "Discard workout" : "Delete workout", icon: <Trash2 />, danger: true, onSelect: () => void remove() },
  ];

  const menuSet = menu ? doc.exercises.find((e) => e.id === menu.weId)?.sets.find((s) => s.id === menu.setId) : undefined;
  const menuEx = menu ? doc.exercises.find((e) => e.id === menu.weId) : undefined;

  return (
    <div className="flex flex-col gap-4">
      {/* Sticky bar: always reachable save state and Finish while scrolling through sets. */}
      <div className="sticky top-[57px] z-20 -mx-4 -mt-4 flex items-center gap-2 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 md:top-0 md:-mt-8 md:pt-3">
        <Link href="/training" aria-label="Back to training" className="flex size-10 shrink-0 items-center justify-center rounded-lg text-fg-2 hover:bg-surface-2 hover:text-fg">
          <ChevronLeft className="size-5" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg">{doc.name.trim() || "Workout"}</p>
          <SaveIndicator status={saveState.status} error={saveState.error} onRetry={() => void autosave.flush()} />
        </div>
        {status === "in_progress" ? (
          <Button onClick={requestFinish} loading={busy === "finish"} disabled={busy != null} className="shrink-0">
            <Flag className="size-4" aria-hidden /> Finish
          </Button>
        ) : (
          <Badge tone="good" className="shrink-0">
            Completed
          </Badge>
        )}
        <ActionMenu label="Workout actions" items={workoutActions} />
      </div>

      {q.error && busy !== "delete" ? <ErrorBanner error={q.error} onRetry={() => q.refetch()} /> : null}
      <ConflictBanner conflict={conflict ?? startW.conflict} onDismiss={() => (conflict ? setConflict(null) : startW.clearConflict())} />

      {justFinished && status === "completed" && (
        <Card className="border-good/40 bg-good-soft">
          <div className="flex items-start gap-3">
            <PartyPopper className="mt-0.5 size-6 shrink-0 text-good-text" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-fg">Workout complete</p>
              <p className="text-sm text-fg-2 tabular">
                {plural(totals.sets, "working set")} · {plural(totals.reps, "rep")} · {formatVolume(totals.volumeKg, unit)} volume
                {justFinished.records > 0 ? ` · ${plural(justFinished.records, "new record")}` : ""}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void saveAsTemplate()} loading={busy === "template"}>
                  <ClipboardList className="size-4" aria-hidden /> Save as template
                </Button>
                <Link href="/training" className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium text-fg-2 hover:bg-surface hover:text-fg">
                  Back to training
                </Link>
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {status === "in_progress" ? <Badge tone="accent">In progress</Badge> : <Badge tone="good">Completed</Badge>}
          {server.source === "liftlog" && <Badge tone="outline">Imported from LiftLog</Badge>}
          {status === "completed" && <span className="text-xs text-muted">Edits save automatically and update your records.</span>}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <Field label="Workout name">
            {(fid) => <Input id={fid} value={doc.name} maxLength={200} autoComplete="off" className="text-base font-semibold" onChange={(e) => update((d) => ({ ...d, name: e.target.value }))} />}
          </Field>
          <Field label="Date" error={dateError}>
            {(fid) => (
              <Input
                id={fid}
                type="date"
                max={today}
                value={doc.localDate}
                className="text-base"
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  if (v > today) return toast.error("Workouts can't be logged in the future.");
                  update((d) => ({ ...d, localDate: v }));
                }}
              />
            )}
          </Field>
        </div>
        <Field label="Notes">
          {(fid) => <Textarea id={fid} rows={2} maxLength={4000} value={doc.notes} className="text-base" placeholder="Energy, how it went, anything to remember…" onChange={(e) => update((d) => ({ ...d, notes: e.target.value }))} />}
        </Field>
        <p className="text-sm text-fg-2 tabular">
          {plural(totals.sets, "working set")} · {plural(totals.reps, "rep")} · {formatVolume(totals.volumeKg, unit)}
          {counts.untickedWithValues > 0 && <span className="text-muted"> · {counts.untickedWithValues} not ticked</span>}
        </p>
      </Card>

      {server.records.length > 0 && (
        <Card>
          <CardTitle sub="Recomputed from your sets — editing a set updates these.">{status === "completed" ? "Records this workout" : "Records so far"}</CardTitle>
          <ul className="flex flex-col gap-2.5">
            {server.records.map((r) => (
              <li key={r.key} className="flex items-start gap-2.5">
                <Trophy className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">
                    {r.exerciseName ?? "Whole workout"} <span className="font-normal text-muted">— {r.label}</span>
                  </p>
                  <p className="text-sm text-fg-2 tabular">
                    {recordValue(r, unit)}
                    {recordDetail(r, unit) && <span className="text-xs text-muted"> · {recordDetail(r, unit)}</span>}
                  </p>
                </div>
                {r.type === "e1rm" && <KindBadge kind="estimate" />}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <fieldset disabled={busy === "finish" || busy === "delete"} className="flex min-w-0 flex-col gap-3">
        <legend className="sr-only">Exercises</legend>
        {doc.exercises.map((we, i) => {
          const srv = serverByWe.get(we.id);
          return (
            <ExerciseBlock
              key={we.id}
              we={we}
              meta={metaById.get(we.exerciseId) ?? UNKNOWN_META}
              previous={srv && srv.exerciseId === we.exerciseId ? srv.previous : undefined}
              unit={unit}
              showRpe={settings.showRpe}
              index={i}
              count={doc.exercises.length}
              records={recordsByExercise.get(we.exerciseId) ?? NO_RECORDS}
              onPatch={patchSet}
              onToggle={toggleSet}
              onMenu={openSetMenu}
              onMessage={onMessage}
              onAddSet={addSet}
              onMove={moveExercise}
              onReplace={openReplace}
              onRemove={removeExercise}
              onNotes={setExerciseNotes}
            />
          );
        })}
        {doc.exercises.length === 0 && (
          <EmptyState icon={<Dumbbell className="size-6" />} title="No exercises yet">
            Add an exercise to start logging sets. Your last session&apos;s numbers show up beside each set.
          </EmptyState>
        )}
        <Button variant="secondary" size="lg" className="w-full" onClick={() => setPicker({ mode: "add" })} disabled={doc.exercises.length >= LIMITS.maxExercises}>
          <Plus className="size-5" aria-hidden /> Add exercise
        </Button>
      </fieldset>

      {status === "in_progress" ? (
        <Button size="lg" className="w-full" onClick={requestFinish} loading={busy === "finish"} disabled={busy != null}>
          <Flag className="size-5" aria-hidden /> Finish workout
        </Button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void reopen()} loading={busy === "reopen"} disabled={busy != null}>
            <RotateCcw className="size-4" aria-hidden /> Reopen
          </Button>
          <Button variant="secondary" onClick={() => void repeat()} loading={busy === "repeat" || startW.pending != null} disabled={busy != null}>
            <Repeat className="size-4" aria-hidden /> Repeat
          </Button>
          <Button variant="secondary" onClick={() => void saveAsTemplate()} loading={busy === "template"} disabled={busy != null || totals.sets === 0}>
            <ClipboardList className="size-4" aria-hidden /> Save as template
          </Button>
          <Button variant="ghost" className="text-critical hover:text-critical" onClick={() => void remove()} loading={busy === "delete"} disabled={busy != null}>
            <Trash2 className="size-4" aria-hidden /> Delete
          </Button>
        </div>
      )}

      <ExercisePicker
        open={picker != null}
        onClose={() => setPicker(null)}
        multi={picker?.mode === "add"}
        title={picker?.mode === "replace" ? "Replace exercise" : "Add exercises"}
        presentIds={doc.exercises.map((e) => e.exerciseId)}
        onSelect={(ids) => {
          if (!picker) return;
          if (picker.mode === "add") addExercises(ids);
          else if (ids[0]) replaceExercise(picker.weId, ids[0]);
        }}
      />

      <Modal open={!!menuSet && !!menuEx} onClose={() => setMenu(null)} title={menuSet && menuEx ? `${(metaById.get(menuEx.exerciseId) ?? UNKNOWN_META).name} · ${menuSet.kind === "warmup" ? "Warm-up set" : `Set ${setLabels(menuEx.sets)[menuEx.sets.indexOf(menuSet)]}`}` : "Set"}>
        {menuSet && menuEx && (
          <SetMenuBody
            set={menuSet}
            unit={unit}
            settings={settings}
            onKind={(kind) => patchSet(menuEx.id, menuSet.id, { kind })}
            onNotes={(notes) => patchSet(menuEx.id, menuSet.id, { notes })}
            onDuplicate={() => {
              duplicateSet(menuEx.id, menuSet.id);
              setMenu(null);
            }}
            onDelete={() => {
              deleteSet(menuEx.id, menuSet.id);
              setMenu(null);
            }}
            onClose={() => setMenu(null)}
          />
        )}
      </Modal>

      <Modal open={finishAsk != null} onClose={() => setFinishAsk(null)} title="Finish workout">
        {finishAsk &&
          (finishAsk.untickedWithValues > 0 ? (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-fg">
                {finishAsk.untickedWithValues === 1 ? "1 set has numbers but isn't ticked." : `${finishAsk.untickedWithValues} sets have numbers but aren't ticked.`}
              </p>
              <p className="text-muted">
                Mark them complete to count them, or discard them. Empty sets are removed either way.
                {finishAsk.completable < finishAsk.untickedWithValues && ` ${finishAsk.untickedWithValues - finishAsk.completable} of them are missing weight or reps and will be discarded.`}
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="ghost" onClick={() => setFinishAsk(null)} disabled={busy === "finish"}>
                  Keep logging
                </Button>
                <Button variant="secondary" onClick={() => void finish("discard")} loading={busy === "finish"}>
                  Discard unticked
                </Button>
                {finishAsk.completable > 0 && (
                  <Button onClick={() => void finish("complete")} loading={busy === "finish"}>
                    Mark {finishAsk.completable} complete
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-fg">No sets are ticked yet.</p>
              <p className="text-muted">Finishing now saves an empty workout. Tick the sets you did first, or discard the workout.</p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="ghost" onClick={() => setFinishAsk(null)}>
                  Keep logging
                </Button>
                <Button variant="danger" onClick={() => void remove()} loading={busy === "delete"}>
                  Discard workout
                </Button>
                <Button variant="secondary" onClick={() => void finish("discard")} loading={busy === "finish"}>
                  Finish anyway
                </Button>
              </div>
            </div>
          ))}
      </Modal>
    </div>
  );
}

function SetMenuBody({ set, unit, settings, onKind, onNotes, onDuplicate, onDelete, onClose }: { set: EditorSet; unit: Unit; settings: SettingsJ; onKind: (k: SetKind) => void; onNotes: (n: string) => void; onDuplicate: () => void; onDelete: () => void; onClose: () => void }) {
  const hasNumbers = set.weightKg != null && set.reps != null && set.reps > 0;
  const e1 = hasNumbers && set.weightKg! > 0 && set.reps! <= settings.maxRepsFor1rm ? estimate1RM(set.weightKg!, set.reps!, settings.oneRmFormula) : null;
  return (
    <div className="flex flex-col gap-4">
      {hasNumbers && (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-fg-2 tabular">
          {formatLift(set.weightKg, unit)} × {set.reps} = <span className="font-medium text-fg">{formatVolume(set.weightKg! * set.reps!, unit)}</span> volume
          {e1 != null && (
            <>
              <span aria-hidden>·</span> est. 1RM {formatLift(e1, unit)} <KindBadge kind="estimate" />
            </>
          )}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium text-fg-2">Set type</p>
        <Segmented
          label="Set type"
          value={set.kind}
          onChange={onKind}
          options={[
            { value: "working", label: "Working set" },
            { value: "warmup", label: "Warm-up" },
          ]}
        />
        <p className="text-xs text-muted">Warm-ups stay in your log but are left out of statistics and records.</p>
      </div>
      <Field label="Note">{(fid) => <Textarea id={fid} rows={3} maxLength={1000} className="text-base" value={set.notes} placeholder="Grip, tempo, how it felt…" onChange={(e) => onNotes(e.target.value)} />}</Field>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onDuplicate}>
          <Copy className="size-4" aria-hidden /> Duplicate
        </Button>
        <Button variant="danger" onClick={onDelete}>
          <Trash2 className="size-4" aria-hidden /> Delete set
        </Button>
      </div>
      <Button variant="ghost" onClick={onClose}>
        Done
      </Button>
    </div>
  );
}
