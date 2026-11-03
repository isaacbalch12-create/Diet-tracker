"use client";

import { ArrowDown, ArrowUp, ClipboardList, Copy, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/kit";
import { useToast } from "@/components/toast";
import { Button, Card, CardTitle, cx, EmptyState, ErrorBanner, Field, IconButton, Input, Modal, Skeleton, Textarea } from "@/components/ui";
import { api, newRequestId } from "@/lib/client/api";
import { useExercises, useInvalidateData, useSettings, useTemplates } from "@/lib/client/hooks";
import type { WorkoutTemplateJ } from "@/lib/client/types";
import type { Unit } from "@/lib/training/types";
import { displayWeight, formatLift, parseNumberInput, toKg } from "@/lib/training/units";
import { ExercisePicker } from "./components/exercise-picker";
import { byLastUsed, dayLabelWithYear, plural, titleCase } from "./components/format";
import { ActionMenu } from "./components/menu";
import { apiPut } from "./components/put";
import { ConflictBanner, useStartWorkout } from "./components/start-workout";
import { LIMITS } from "./components/workout-doc";

type Item = WorkoutTemplateJ["items"][number];

function targetText(i: Pick<Item, "targetSets" | "targetReps" | "targetWeightKg">, unit: Unit): string {
  const sets = i.targetReps != null ? `${i.targetSets} × ${i.targetReps}` : plural(i.targetSets, "set");
  return i.targetWeightKg != null ? `${sets} @ ${formatLift(i.targetWeightKg, unit)}` : sets;
}

/** lastUsedAt is an instant; show the calendar day it falls on locally. */
function usedLabel(iso: string | null): string {
  if (!iso) return "Never used";
  const d = new Date(iso);
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `Last used ${dayLabelWithYear(local)}`;
}

export function TemplatesView() {
  const settingsQ = useSettings();
  const unit: Unit = settingsQ.data?.settings.weightUnit ?? "lb";
  const q = useTemplates();
  const exercisesQ = useExercises();
  const toast = useToast();
  const invalidate = useInvalidateData();
  const startW = useStartWorkout();
  const [editing, setEditing] = useState<null | { template: WorkoutTemplateJ | null }>(null);
  const names = useMemo(() => new Map((exercisesQ.data ?? []).map((e) => [e.id, e])), [exercisesQ.data]);
  const templates = useMemo(() => (q.data ? [...q.data].sort(byLastUsed) : undefined), [q.data]);

  const duplicate = async (t: WorkoutTemplateJ) => {
    try {
      const res = await api.post<{ template: WorkoutTemplateJ }>(`/api/workout-templates/${encodeURIComponent(t.id)}/duplicate`);
      void invalidate();
      toast.success(`Created “${res.template.name}”`);
    } catch (err) {
      toast.error(err);
    }
  };

  const remove = async (t: WorkoutTemplateJ) => {
    if (!window.confirm(`Delete the template “${t.name}”? Workouts already logged from it are kept.`)) return;
    try {
      await api.del(`/api/workout-templates/${encodeURIComponent(t.id)}`);
      void invalidate();
      toast.success(`Deleted “${t.name}”`);
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Templates"
        sub="Saved workouts with target sets, reps and weight. Starting one copies it — editing a template never changes past workouts."
        actions={
          <Button onClick={() => setEditing({ template: null })}>
            <Plus className="size-4" aria-hidden /> New template
          </Button>
        }
      />
      <ConflictBanner conflict={startW.conflict} onDismiss={startW.clearConflict} />
      {q.error ? <ErrorBanner error={q.error} onRetry={() => q.refetch()} /> : null}

      {!templates ? (
        q.error ? null : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-busy="true" aria-label="Loading templates">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        )
      ) : templates.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="size-6" />}
          title="No templates yet"
          action={
            <Button onClick={() => setEditing({ template: null })}>
              <Plus className="size-4" aria-hidden /> Create a template
            </Button>
          }
        >
          Build one here, or open a finished workout and choose “Save as template”.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {templates.map((t) => (
            <li key={t.id} className="min-w-0">
              <Card className="flex h-full flex-col">
                <CardTitle
                  sub={`${plural(t.items.length, "exercise")} · ${usedLabel(t.lastUsedAt)}`}
                  action={
                    <ActionMenu
                      label={`${t.name} actions`}
                      items={[
                        { label: "Edit", icon: <Pencil />, onSelect: () => setEditing({ template: t }) },
                        { label: "Duplicate", icon: <Copy />, onSelect: () => void duplicate(t) },
                        { label: "Delete", icon: <Trash2 />, danger: true, onSelect: () => void remove(t) },
                      ]}
                    />
                  }
                >
                  {t.name}
                </CardTitle>
                {t.notes && <p className="-mt-1 mb-3 text-sm whitespace-pre-line text-fg-2">{t.notes}</p>}
                <ol className="mb-4 flex flex-col gap-1.5">
                  {t.items.map((i, n) => {
                    const ex = names.get(i.exerciseId);
                    return (
                      <li key={i.id} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate text-fg">
                          <span className="mr-1.5 text-xs text-muted tabular">{n + 1}.</span>
                          {ex?.name ?? "Unknown exercise"}
                          {ex?.archived && <span className="text-xs text-muted"> (archived)</span>}
                        </span>
                        <span className="shrink-0 text-xs text-fg-2 tabular">{targetText(i, unit)}</span>
                      </li>
                    );
                  })}
                </ol>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button onClick={() => void startW.start({ templateId: t.id }, t.id)} loading={startW.pending === t.id} disabled={startW.pending != null}>
                    <Play className="size-4" aria-hidden /> Start workout
                  </Button>
                  <Button variant="secondary" onClick={() => setEditing({ template: t })}>
                    <Pencil className="size-4" aria-hidden /> Edit
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Modal open={editing != null} onClose={() => setEditing(null)} title={editing?.template ? `Edit “${editing.template.name}”` : "New template"} wide>
        {editing && <TemplateEditor template={editing.template} unit={unit} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

interface DraftItem {
  key: string;
  id?: string;
  exerciseId: string;
  sets: string;
  reps: string;
  weight: string;
  notes: string;
}

interface ItemErrors {
  sets?: string;
  reps?: string;
  weight?: string;
}

function TemplateEditor({ template, unit, onDone }: { template: WorkoutTemplateJ | null; unit: Unit; onDone: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const exercisesQ = useExercises();
  const exMap = useMemo(() => new Map((exercisesQ.data ?? []).map((e) => [e.id, e])), [exercisesQ.data]);
  const [name, setName] = useState(template?.name ?? "");
  const [notes, setNotes] = useState(template?.notes ?? "");
  const [items, setItems] = useState<DraftItem[]>(() =>
    (template?.items ?? []).map((i) => ({
      key: i.id,
      id: i.id,
      exerciseId: i.exerciseId,
      sets: String(i.targetSets),
      reps: i.targetReps == null ? "" : String(i.targetReps),
      weight: i.targetWeightKg == null ? "" : String(displayWeight(i.targetWeightKg, unit)),
      notes: i.notes,
    })),
  );
  const [picker, setPicker] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; items?: string; byKey: Record<string, ItemErrors> }>({ byKey: {} });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const patch = (key: string, p: Partial<DraftItem>) => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...p } : i)));
  const move = (idx: number, dir: -1 | 1) =>
    setItems((cur) => {
      const j = idx + dir;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });

  const save = async () => {
    const byKey: Record<string, ItemErrors> = {};
    const parsed = items.map((i) => {
      const e: ItemErrors = {};
      const sets = parseNumberInput(i.sets);
      if (sets == null || !Number.isInteger(sets) || sets < 1 || sets > 50) e.sets = "1–50";
      const reps = i.reps.trim() === "" ? null : parseNumberInput(i.reps);
      if (i.reps.trim() !== "" && (reps == null || !Number.isInteger(reps) || reps < 1 || reps > 1000)) e.reps = "1–1000";
      const w = i.weight.trim() === "" ? null : parseNumberInput(i.weight);
      if (i.weight.trim() !== "" && (w == null || w < 0 || toKg(w, unit) > LIMITS.maxWeightKg)) e.weight = "Invalid";
      if (Object.keys(e).length) byKey[i.key] = e;
      return { ...(i.id ? { id: i.id } : {}), exerciseId: i.exerciseId, targetSets: sets ?? 1, targetReps: reps, targetWeightKg: w == null ? null : toKg(w, unit), notes: i.notes.slice(0, 1000) };
    });
    const next = { name: name.trim() ? undefined : "Give the template a name.", items: items.length ? undefined : "Add at least one exercise.", byKey };
    setErrors(next);
    if (next.name || next.items || Object.keys(byKey).length) return;
    setSaving(true);
    setError(null);
    try {
      const body = { name: name.trim(), notes: notes.slice(0, 2000), items: parsed };
      if (template) await apiPut(`/api/workout-templates/${encodeURIComponent(template.id)}`, body);
      else await api.post("/api/workout-templates", body);
      void invalidate();
      toast.success(template ? "Template saved" : `Created “${body.name}”`);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = (bad?: string) => cx("h-10 px-2 text-center text-base tabular sm:text-sm", bad && "border-critical");

  return (
    <>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Name" error={errors.name}>
          {(id) => <Input id={id} value={name} maxLength={200} placeholder="e.g. Upper A" onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Notes (optional)">{(id) => <Textarea id={id} rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-fg-2">Exercises</p>
          {items.length === 0 ? (
            <p className={cx("rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-sm", errors.items ? "text-critical" : "text-muted")}>{errors.items ?? "No exercises yet — add some below."}</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {items.map((i, idx) => {
                const ex = exMap.get(i.exerciseId);
                const err = errors.byKey[i.key] ?? {};
                const label = ex?.name ?? "Exercise";
                return (
                  <li key={i.key} className="rounded-lg border border-line p-2.5">
                    <div className="flex items-start gap-1">
                      <div className="min-w-0 flex-1 pt-1.5">
                        <p className="truncate text-sm font-medium text-fg">
                          <span className="mr-1 text-xs text-muted tabular">{idx + 1}.</span>
                          {label}
                        </p>
                        {ex && <p className="truncate text-xs text-muted">{titleCase(ex.primaryMuscle)}</p>}
                      </div>
                      <IconButton label={`Move ${label} up`} className="size-10" disabled={idx === 0} onClick={() => move(idx, -1)}>
                        <ArrowUp className="size-4" />
                      </IconButton>
                      <IconButton label={`Move ${label} down`} className="size-10" disabled={idx === items.length - 1} onClick={() => move(idx, 1)}>
                        <ArrowDown className="size-4" />
                      </IconButton>
                      <IconButton label={`Remove ${label}`} className="size-10" onClick={() => setItems((cur) => cur.filter((x) => x.key !== i.key))}>
                        <X className="size-4" />
                      </IconButton>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                        Sets
                        <Input inputMode="numeric" className={inputCls(err.sets)} value={i.sets} aria-invalid={!!err.sets} onChange={(e) => patch(i.key, { sets: e.target.value })} />
                        {err.sets && <span className="text-critical">{err.sets}</span>}
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                        Reps
                        <Input inputMode="numeric" className={inputCls(err.reps)} placeholder="any" value={i.reps} aria-invalid={!!err.reps} onChange={(e) => patch(i.key, { reps: e.target.value })} />
                        {err.reps && <span className="text-critical">{err.reps}</span>}
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                        Weight ({unit})
                        <Input inputMode="decimal" className={inputCls(err.weight)} placeholder="any" value={i.weight} aria-invalid={!!err.weight} onChange={(e) => patch(i.key, { weight: e.target.value })} />
                        {err.weight && <span className="text-critical">{err.weight}</span>}
                      </label>
                    </div>
                    <Input className="mt-2 text-base sm:text-sm" placeholder="Note (optional)" aria-label={`${label} note`} maxLength={1000} value={i.notes} onChange={(e) => patch(i.key, { notes: e.target.value })} />
                  </li>
                );
              })}
            </ol>
          )}
          <Button variant="secondary" onClick={() => setPicker(true)} disabled={items.length >= LIMITS.maxExercises}>
            <Plus className="size-4" aria-hidden /> Add exercises
          </Button>
          <p className="text-xs text-muted">Targets are a guide: when you tick an empty set, it fills from your last session first, then from these targets.</p>
        </div>

        {error ? <ErrorBanner error={error} /> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {template ? "Save template" : "Create template"}
          </Button>
        </div>
      </form>

      <ExercisePicker
        open={picker}
        onClose={() => setPicker(false)}
        multi
        title="Add exercises to template"
        presentIds={items.map((i) => i.exerciseId)}
        confirmLabel={(n) => (n ? `Add ${n}` : "Add")}
        onSelect={(ids) =>
          setItems((cur) => [...cur, ...ids.slice(0, LIMITS.maxExercises - cur.length).map((exerciseId) => ({ key: newRequestId(), exerciseId, sets: "3", reps: "", weight: "", notes: "" }))])
        }
      />
    </>
  );
}
