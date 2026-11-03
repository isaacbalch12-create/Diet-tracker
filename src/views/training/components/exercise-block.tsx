"use client";

import { ArrowDown, ArrowUp, Plus, Repeat2, StickyNote, Trash2, Trophy } from "lucide-react";
import Link from "next/link";
import { memo, useMemo, useState } from "react";
import { Badge, Button, Card, cx, Textarea } from "@/components/ui";
import type { WorkoutDetailJ } from "@/lib/client/types";
import type { Unit } from "@/lib/training/types";
import { formatLift } from "@/lib/training/units";
import { dayLabel, exerciseHref, plural, titleCase, workoutHref } from "./format";
import { ActionMenu } from "./menu";
import { SET_GRID, SET_GRID_RPE, SetRow, type SetRowProps } from "./set-row";
import { LIMITS, matchPrevious, setLabels, type EditorExercise, type PreviousSession } from "./workout-doc";

export interface ExerciseMeta {
  name: string;
  primaryMuscle: string;
  equipment: string;
  archived: boolean;
}

export interface ExerciseBlockProps extends Pick<SetRowProps, "onPatch" | "onToggle" | "onMenu" | "onMessage"> {
  we: EditorExercise;
  meta: ExerciseMeta;
  /** undefined = not known yet (just added; appears after the next save), null = first time. */
  previous: PreviousSession | undefined;
  unit: Unit;
  showRpe: boolean;
  index: number;
  count: number;
  /** This exercise's records in this workout (stable between refetches). */
  records: WorkoutDetailJ["records"];
  onAddSet: (weId: string) => void;
  onMove: (weId: string, dir: -1 | 1) => void;
  onReplace: (weId: string) => void;
  onRemove: (weId: string) => void;
  onNotes: (weId: string, notes: string) => void;
}

export const ExerciseBlock = memo(function ExerciseBlock(p: ExerciseBlockProps) {
  const { we, meta, previous, unit, showRpe } = p;
  const [notesOpen, setNotesOpen] = useState(false);
  const prevs = useMemo(() => matchPrevious(we.sets, previous ?? undefined), [we.sets, previous]);
  const labels = useMemo(() => setLabels(we.sets), [we.sets]);
  // Mark the set that earned each record (records come back from the server after a save).
  const recordSetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of p.records) {
      if (r.weightKg == null || r.reps == null) continue;
      const hit = we.sets.find((s) => s.completed && s.kind === "working" && s.reps === r.reps && s.weightKg != null && Math.abs(s.weightKg - (r.weightKg ?? 0)) < 0.01);
      if (hit) ids.add(hit.id);
    }
    return ids;
  }, [p.records, we.sets]);
  const done = we.sets.filter((s) => s.completed).length;
  const last = we.sets[we.sets.length - 1];
  const showNotes = notesOpen || we.notes !== "";
  const prevBest = previous?.sets.filter((s) => s.kind !== "warmup" && s.weightKg != null && s.reps != null).reduce<{ weightKg: number; reps: number } | null>((best, s) => (!best || (s.weightKg ?? 0) > best.weightKg ? { weightKg: s.weightKg ?? 0, reps: s.reps ?? 0 } : best), null);

  return (
    <Card className="px-2 py-3 sm:px-4 sm:py-4">
      <div className="flex items-start gap-2 px-1">
        <div className="min-w-0 flex-1">
          <Link href={exerciseHref(we.exerciseId)} className="block truncate text-base font-semibold text-fg hover:text-accent">
            {meta.name}
          </Link>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted">
            <span>{titleCase(meta.primaryMuscle)}</span>
            <span aria-hidden>·</span>
            <span className="tabular">
              {done}/{plural(we.sets.length, "set")}
            </span>
            {meta.archived && <Badge tone="outline">Archived</Badge>}
            {p.records.length > 0 && (
              <Badge tone="warning">
                <Trophy className="size-3" aria-hidden /> {plural(p.records.length, "record")}
              </Badge>
            )}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted">
            {previous === undefined ? (
              "Last time: checking…"
            ) : previous === null ? (
              "First time logging this exercise"
            ) : (
              <>
                Last time:{" "}
                <Link href={workoutHref(previous.workoutId)} className="text-fg-2 underline-offset-2 hover:underline">
                  {dayLabel(previous.localDate)}
                </Link>
                {prevBest && (
                  <span className="tabular">
                    {" "}
                    · top {formatLift(prevBest.weightKg, unit)} × {prevBest.reps}
                  </span>
                )}
              </>
            )}
          </p>
        </div>
        <ActionMenu
          label={`${meta.name} actions`}
          items={[
            { label: "Move up", icon: <ArrowUp />, onSelect: () => p.onMove(we.id, -1), disabled: p.index === 0 },
            { label: "Move down", icon: <ArrowDown />, onSelect: () => p.onMove(we.id, 1), disabled: p.index === p.count - 1 },
            { label: "Replace exercise", icon: <Repeat2 />, onSelect: () => p.onReplace(we.id) },
            !showNotes && { label: "Add exercise note", icon: <StickyNote />, onSelect: () => setNotesOpen(true) },
            showNotes && we.notes === "" && { label: "Hide note", icon: <StickyNote />, onSelect: () => setNotesOpen(false) },
            { label: "Remove exercise", icon: <Trash2 />, danger: true, onSelect: () => p.onRemove(we.id) },
          ]}
        />
      </div>

      {showNotes && (
        <div className="px-1 pt-2">
          <Textarea rows={2} maxLength={2000} value={we.notes} placeholder="Notes for this exercise today (grip, setup, how it felt)…" aria-label={`${meta.name} notes`} onChange={(e) => p.onNotes(we.id, e.target.value)} />
        </div>
      )}

      <div className="pt-3">
        {we.sets.length > 0 && (
          <div className={cx(showRpe ? SET_GRID_RPE : SET_GRID, "px-1 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase")} aria-hidden>
            <span className="text-center">Set</span>
            <span className={cx("pl-1", showRpe && "hidden sm:block")}>Previous</span>
            <span className="text-center">{unit}</span>
            <span className="text-center">Reps</span>
            {showRpe && <span className="text-center">RPE</span>}
            <span className="text-center">Done</span>
          </div>
        )}
        <div className="flex flex-col gap-1">
          {we.sets.map((s, i) => (
            <SetRow
              key={s.id}
              weId={we.id}
              set={s}
              label={labels[i]}
              unit={unit}
              showRpe={showRpe}
              prev={prevs[i]}
              isRecord={recordSetIds.has(s.id)}
              onPatch={p.onPatch}
              onToggle={p.onToggle}
              onMenu={p.onMenu}
              onMessage={p.onMessage}
            />
          ))}
        </div>
        <Button variant="ghost" className="mt-1.5 h-11 w-full" onClick={() => p.onAddSet(we.id)} disabled={we.sets.length >= LIMITS.maxSets}>
          <Plus className="size-4" aria-hidden /> Add set
          {last && last.weightKg != null && (
            <span className="font-normal text-muted tabular">
              ({formatLift(last.weightKg, unit, { withUnit: false })} × {last.reps ?? "—"})
            </span>
          )}
        </Button>
      </div>
    </Card>
  );
});
