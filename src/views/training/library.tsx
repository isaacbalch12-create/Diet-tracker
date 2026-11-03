"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Library, Pencil, Plus, Search, Star, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/kit";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, cx, EmptyState, ErrorBanner, Input, Modal, Select, Skeleton } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useExercises, useInvalidateData } from "@/lib/client/hooks";
import type { ExerciseListItemJ } from "@/lib/client/types";
import { CATEGORIES, EQUIPMENT, MUSCLE_GROUPS, type Equipment, type ExerciseCategory, type MuscleGroup } from "@/lib/training/types";
import { ExerciseForm } from "./components/exercise-form";
import { matchesExercise } from "./components/exercise-picker";
import { dayLabelWithYear, exerciseHref, plural, titleCase } from "./components/format";
import { ActionMenu } from "./components/menu";

type Editing = null | { mode: "create" } | { mode: "edit"; exercise: ExerciseListItemJ };

export function ExerciseLibraryView() {
  const q = useExercises();
  const qc = useQueryClient();
  const toast = useToast();
  const invalidate = useInvalidateData();
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<MuscleGroup | "all">("all");
  const [equipment, setEquipment] = useState<Equipment | "all">("all");
  const [category, setCategory] = useState<ExerciseCategory | "all">("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);

  const all = useMemo(() => q.data ?? [], [q.data]);
  const list = useMemo(
    () =>
      all
        .filter(
          (e) =>
            (showArchived || !e.archived) &&
            (!favoritesOnly || e.isFavorite) &&
            (muscle === "all" || e.primaryMuscle === muscle || e.secondaryMuscles.includes(muscle)) &&
            (equipment === "all" || e.equipment === equipment) &&
            (category === "all" || e.category === category) &&
            matchesExercise(e, query),
        )
        .sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || a.name.localeCompare(b.name)),
    [all, showArchived, favoritesOnly, muscle, equipment, category, query],
  );
  const filtering = query.trim() !== "" || muscle !== "all" || equipment !== "all" || category !== "all" || favoritesOnly;
  const archivedCount = all.filter((e) => e.archived).length;

  const patchCache = (id: string, patch: Partial<ExerciseListItemJ>) => qc.setQueryData<ExerciseListItemJ[]>(["exercises"], (old) => old?.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const patch = async (e: ExerciseListItemJ, body: { isFavorite?: boolean; archived?: boolean }, done?: string) => {
    patchCache(e.id, body);
    try {
      await api.patch(`/api/exercises/${encodeURIComponent(e.id)}`, body);
      void invalidate();
      if (done) toast.success(done);
    } catch (err) {
      patchCache(e.id, { isFavorite: e.isFavorite, archived: e.archived });
      toast.error(err);
    }
  };

  const remove = async (e: ExerciseListItemJ) => {
    if (!window.confirm(`Delete “${e.name}”? If it has logged sets or is used in a template it will be archived instead, keeping its history.`)) return;
    try {
      const res = await api.del<{ result: "deleted" | "archived" }>(`/api/exercises/${encodeURIComponent(e.id)}`);
      void invalidate();
      if (res.result === "deleted") toast.success(`Deleted “${e.name}”`);
      else toast.info(`“${e.name}” has logged sets or is used in a template, so it was archived instead of deleted. Its history is kept; unarchive it any time.`);
    } catch (err) {
      toast.error(err);
    }
  };

  const clear = () => {
    setQuery("");
    setMuscle("all");
    setEquipment("all");
    setCategory("all");
    setFavoritesOnly(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Exercises"
        sub={q.data ? `${plural(all.filter((e) => !e.archived).length, "exercise")} · ${plural(all.filter((e) => e.isCustom).length, "custom")}` : "Your exercise library"}
        actions={
          <Button onClick={() => setEditing({ mode: "create" })}>
            <Plus className="size-4" aria-hidden /> New exercise
          </Button>
        }
      />

      <Card className="flex flex-col gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input type="search" className="pl-9 text-base sm:text-sm" placeholder="Search exercises" aria-label="Search exercises" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Select aria-label="Filter by muscle" value={muscle} onChange={(e) => setMuscle(e.target.value as MuscleGroup | "all")}>
            <option value="all">All muscles</option>
            {MUSCLE_GROUPS.map((m) => (
              <option key={m} value={m}>
                {titleCase(m)}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by equipment" value={equipment} onChange={(e) => setEquipment(e.target.value as Equipment | "all")}>
            <option value="all">All equipment</option>
            {EQUIPMENT.map((m) => (
              <option key={m} value={m}>
                {titleCase(m)}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value as ExerciseCategory | "all")}>
            <option value="all">Compound & isolation</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {titleCase(c)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={favoritesOnly}
            onClick={() => setFavoritesOnly(!favoritesOnly)}
            className={cx("inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium", favoritesOnly ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-fg-2 hover:bg-surface-2")}
          >
            <Star className={cx("size-4", favoritesOnly && "fill-current")} aria-hidden /> Favorites
          </button>
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border border-line-strong px-3 text-sm font-medium text-fg-2 hover:bg-surface-2">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived{archivedCount ? ` (${archivedCount})` : ""}
          </label>
          {filtering && (
            <Button variant="ghost" size="sm" onClick={clear}>
              <X className="size-4" aria-hidden /> Clear
            </Button>
          )}
        </div>
      </Card>

      {q.error ? <ErrorBanner error={q.error} onRetry={() => q.refetch()} /> : null}

      {!q.data ? (
        q.error ? null : (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading exercises">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        )
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Library className="size-6" />}
          title={filtering ? "No exercises match" : "No exercises"}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {filtering && (
                <Button variant="secondary" onClick={clear}>
                  Clear filters
                </Button>
              )}
              <Button onClick={() => setEditing({ mode: "create" })}>
                <Plus className="size-4" aria-hidden /> Create {query.trim() ? `“${query.trim()}”` : "an exercise"}
              </Button>
            </div>
          }
        >
          {filtering ? "Try another search or filter, or add it as a custom exercise." : "Create a custom exercise to get started."}
        </EmptyState>
      ) : (
        <Card className="px-2 py-2 sm:px-3">
          <p className="px-2 pt-1 pb-2 text-xs text-muted" aria-live="polite">
            {plural(list.length, "exercise")}
            {filtering ? " match" : ""}
          </p>
          <ul className="flex flex-col divide-y divide-line">
            {list.map((e) => (
              <li key={e.id} className={cx("flex items-center gap-1 py-1.5", e.archived && "opacity-70")}>
                <button
                  type="button"
                  aria-pressed={e.isFavorite}
                  aria-label={e.isFavorite ? `Remove ${e.name} from favorites` : `Add ${e.name} to favorites`}
                  title={e.isFavorite ? "Favorite" : "Add to favorites"}
                  onClick={() => void patch(e, { isFavorite: !e.isFavorite })}
                  className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg hover:bg-surface-2"
                >
                  <Star className={cx("size-5", e.isFavorite ? "fill-current text-warning" : "text-muted")} aria-hidden />
                </button>
                <Link href={exerciseHref(e.id)} className="min-w-0 flex-1 rounded-lg px-1 py-1 hover:bg-surface-2">
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="truncate font-medium text-fg">{e.name}</span>
                    {e.isCustom && <Badge tone="outline">Custom</Badge>}
                    {e.archived && <Badge>Archived</Badge>}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {titleCase(e.primaryMuscle)} · {titleCase(e.equipment)} · {titleCase(e.category)}
                  </span>
                  <span className="block text-xs text-fg-2 tabular">{e.setCount > 0 ? `${plural(e.setCount, "set")} logged${e.lastDate ? ` · last ${dayLabelWithYear(e.lastDate)}` : ""}` : "Not logged yet"}</span>
                </Link>
                <ActionMenu
                  label={`${e.name} actions`}
                  items={[
                    e.isCustom && { label: "Edit", icon: <Pencil />, onSelect: () => setEditing({ mode: "edit", exercise: e }) },
                    e.archived
                      ? { label: "Unarchive", icon: <ArchiveRestore />, onSelect: () => void patch(e, { archived: false }, `“${e.name}” is back in your pickers`) }
                      : { label: "Archive", icon: <Archive />, onSelect: () => void patch(e, { archived: true }, `Archived “${e.name}” — hidden from pickers, history kept`) },
                    e.isCustom && { label: "Delete", icon: <Trash2 />, danger: true, onSelect: () => void remove(e) },
                  ]}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal open={editing != null} onClose={() => setEditing(null)} title={editing?.mode === "edit" ? `Edit “${editing.exercise.name}”` : "New exercise"}>
        {editing && (
          <ExerciseForm
            exerciseId={editing.mode === "edit" ? editing.exercise.id : undefined}
            initial={
              editing.mode === "edit"
                ? { name: editing.exercise.name, primaryMuscle: editing.exercise.primaryMuscle, secondaryMuscles: editing.exercise.secondaryMuscles, equipment: editing.exercise.equipment, category: editing.exercise.category, instructions: editing.exercise.instructions }
                : { name: query.trim(), primaryMuscle: muscle === "all" ? undefined : muscle, equipment: equipment === "all" ? undefined : equipment, category: category === "all" ? undefined : category }
            }
            onCancel={() => setEditing(null)}
            onSaved={() => setEditing(null)}
          />
        )}
      </Modal>
    </div>
  );
}
