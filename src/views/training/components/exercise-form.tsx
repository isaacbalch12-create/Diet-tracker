"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useToast } from "@/components/toast";
import { Button, cx, ErrorBanner, Field, Input, Segmented, Select, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/client/api";
import { useInvalidateData } from "@/lib/client/hooks";
import type { ExerciseListItemJ } from "@/lib/client/types";
import { CATEGORIES, EQUIPMENT, MUSCLE_GROUPS, type Equipment, type ExerciseCategory, type MuscleGroup } from "@/lib/training/types";
import { titleCase } from "./format";

export type ExerciseRowJ = Omit<ExerciseListItemJ, "setCount" | "lastDate">;

export interface ExerciseFormInitial {
  name?: string;
  primaryMuscle?: MuscleGroup;
  secondaryMuscles?: MuscleGroup[];
  equipment?: Equipment;
  category?: ExerciseCategory;
  instructions?: string;
}

/**
 * Create or edit a custom exercise. On success the exercise list cache is
 * updated immediately (so pickers can show it before the refetch lands).
 */
export function ExerciseForm({ exerciseId, initial, onSaved, onCancel, submitLabel }: { exerciseId?: string; initial?: ExerciseFormInitial; onSaved: (exercise: ExerciseRowJ) => void; onCancel: () => void; submitLabel?: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const invalidate = useInvalidateData();
  const [name, setName] = useState(initial?.name ?? "");
  const [primary, setPrimary] = useState<MuscleGroup>(initial?.primaryMuscle ?? "chest");
  const [secondary, setSecondary] = useState<MuscleGroup[]>(initial?.secondaryMuscles ?? []);
  const [equipment, setEquipment] = useState<Equipment>(initial?.equipment ?? "barbell");
  const [category, setCategory] = useState<ExerciseCategory>(initial?.category ?? "compound");
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const secondaryLabelId = useId();

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setNameError("Give the exercise a name.");
    if (trimmed.length > 100) return setNameError("Keep the name under 100 characters.");
    setNameError(null);
    setError(null);
    setSaving(true);
    const body = { name: trimmed, primaryMuscle: primary, secondaryMuscles: secondary.filter((m) => m !== primary), equipment, category, instructions: instructions.slice(0, 4000) };
    try {
      const res = exerciseId
        ? await api.patch<{ exercise: ExerciseRowJ }>(`/api/exercises/${encodeURIComponent(exerciseId)}`, body)
        : await api.post<{ exercise: ExerciseRowJ }>("/api/exercises", body);
      qc.setQueryData<ExerciseListItemJ[]>(["exercises"], (old) => {
        if (!old) return old;
        const existing = old.find((e) => e.id === res.exercise.id);
        const row: ExerciseListItemJ = { ...res.exercise, setCount: existing?.setCount ?? 0, lastDate: existing?.lastDate ?? null };
        return existing ? old.map((e) => (e.id === row.id ? row : e)) : [...old, row].sort((a, b) => a.name.localeCompare(b.name));
      });
      void invalidate();
      toast.success(exerciseId ? `Saved “${res.exercise.name}”` : `Created “${res.exercise.name}”`);
      onSaved(res.exercise);
    } catch (err) {
      if (err instanceof ApiError && err.code === "exercise_exists") setNameError(err.message);
      else setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label="Name" error={nameError}>
        {(id) => <Input id={id} value={name} maxLength={100} autoComplete="off" aria-invalid={!!nameError} onChange={(e) => setName(e.target.value)} placeholder="e.g. Incline Dumbbell Press" />}
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Primary muscle">
          {(id) => (
            <Select id={id} value={primary} onChange={(e) => setPrimary(e.target.value as MuscleGroup)}>
              {MUSCLE_GROUPS.map((m) => (
                <option key={m} value={m}>
                  {titleCase(m)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Equipment">
          {(id) => (
            <Select id={id} value={equipment} onChange={(e) => setEquipment(e.target.value as Equipment)}>
              {EQUIPMENT.map((m) => (
                <option key={m} value={m}>
                  {titleCase(m)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium text-fg-2" id={secondaryLabelId}>
          Secondary muscles <span className="font-normal text-muted">(optional — count as half a set)</span>
        </p>
        <div role="group" aria-labelledby={secondaryLabelId} className="flex flex-wrap gap-1.5">
          {MUSCLE_GROUPS.filter((m) => m !== primary).map((m) => {
            const on = secondary.includes(m);
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                onClick={() => setSecondary(on ? secondary.filter((x) => x !== m) : [...secondary, m])}
                className={cx("h-8 rounded-full border px-3 text-xs font-medium", on ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-fg-2 hover:bg-surface-2")}
              >
                {titleCase(m)}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium text-fg-2">Category</p>
        <Segmented label="Category" value={category} onChange={setCategory} options={CATEGORIES.map((c) => ({ value: c, label: titleCase(c) }))} />
        <p className="text-xs text-muted">Compound moves work several joints (squat, bench); isolation moves work one (curl, raise).</p>
      </div>
      <Field label="Instructions" hint="Optional cues, setup or form notes.">
        {(id) => <Textarea id={id} rows={3} maxLength={4000} value={instructions} onChange={(e) => setInstructions(e.target.value)} />}
      </Field>
      {error ? <ErrorBanner error={error} /> : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {submitLabel ?? (exerciseId ? "Save changes" : "Create exercise")}
        </Button>
      </div>
    </form>
  );
}
