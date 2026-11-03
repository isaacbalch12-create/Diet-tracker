"use client";

import { Check, Plus, Search, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, cx, ErrorBanner, Input, Modal, Select, Skeleton } from "@/components/ui";
import { useExercises } from "@/lib/client/hooks";
import type { ExerciseListItemJ } from "@/lib/client/types";
import { MUSCLE_GROUPS, type MuscleGroup } from "@/lib/training/types";
import { ExerciseForm } from "./exercise-form";
import { dayLabel, titleCase } from "./format";

export function matchesExercise(e: Pick<ExerciseListItemJ, "name" | "primaryMuscle" | "equipment">, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${e.name} ${e.primaryMuscle} ${e.equipment}`.toLowerCase();
  return q.split(/\s+/).every((tok) => hay.includes(tok));
}

/** Favorites first, then most recently trained, then alphabetical. */
function byRelevance(a: ExerciseListItemJ, b: ExerciseListItemJ): number {
  return Number(b.isFavorite) - Number(a.isFavorite) || (b.lastDate ?? "").localeCompare(a.lastDate ?? "") || a.name.localeCompare(b.name);
}

interface PickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (ids: string[]) => void;
  multi?: boolean;
  title?: string;
  /** Exercises already present (still selectable, just labelled). */
  presentIds?: string[];
  confirmLabel?: (n: number) => string;
}

export function ExercisePicker(props: PickerProps) {
  return (
    <Modal open={props.open} onClose={props.onClose} title={props.title ?? (props.multi ? "Add exercises" : "Choose exercise")}>
      <PickerBody {...props} />
    </Modal>
  );
}

function PickerBody({ onClose, onSelect, multi = false, presentIds = [], confirmLabel }: PickerProps) {
  const q = useExercises();
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<MuscleGroup | "all">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // The picker exists to search: focus the field once the dialog is shown (it opens in the parent's effect).
  useEffect(() => {
    if (creating) return;
    const raf = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [creating]);

  const active = useMemo(() => (q.data ?? []).filter((e) => !e.archived), [q.data]);
  const filtering = query.trim() !== "" || muscle !== "all";
  const filtered = useMemo(
    () => active.filter((e) => (muscle === "all" || e.primaryMuscle === muscle || e.secondaryMuscles.includes(muscle)) && matchesExercise(e, query)).sort(byRelevance),
    [active, muscle, query],
  );
  const sections = useMemo(() => {
    if (filtering) return [{ title: `${filtered.length} ${filtered.length === 1 ? "match" : "matches"}`, items: filtered }];
    const favorites = active.filter((e) => e.isFavorite).sort((a, b) => a.name.localeCompare(b.name));
    const recent = active
      .filter((e) => !e.isFavorite && e.lastDate)
      .sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? ""))
      .slice(0, 8);
    const shown = new Set([...favorites, ...recent].map((e) => e.id));
    return [
      { title: "Favorites", items: favorites },
      { title: "Recently used", items: recent },
      { title: "All exercises", items: active.filter((e) => !shown.has(e.id)) },
    ].filter((s) => s.items.length > 0);
  }, [active, filtered, filtering]);

  const choose = (id: string) => {
    if (!multi) {
      onSelect([id]);
      onClose();
      return;
    }
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  if (creating) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">Create a custom exercise. It&apos;s added to your library and selected right away.</p>
        <ExerciseForm
          initial={{ name: query.trim(), primaryMuscle: muscle === "all" ? undefined : muscle }}
          submitLabel={multi ? "Create and select" : "Create and add"}
          onCancel={() => setCreating(false)}
          onSaved={(ex) => {
            if (multi) {
              setSelected((s) => [...s, ex.id]);
              setCreating(false);
              setQuery("");
            } else {
              onSelect([ex.id]);
              onClose();
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="sticky -top-4 z-10 -mx-5 -mt-4 flex flex-col gap-2 border-b border-line bg-surface px-5 pt-4 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input ref={searchRef} type="search" className="h-11 pl-9 text-base" placeholder="Search exercises" aria-label="Search exercises" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Select aria-label="Filter by muscle" value={muscle} onChange={(e) => setMuscle(e.target.value as MuscleGroup | "all")}>
          <option value="all">All muscles</option>
          {MUSCLE_GROUPS.map((m) => (
            <option key={m} value={m}>
              {titleCase(m)}
            </option>
          ))}
        </Select>
      </div>

      {q.error ? <ErrorBanner error={q.error} onRetry={() => q.refetch()} /> : null}
      {!q.data ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : (
        <>
          {sections.map((s) => (
            <section key={s.title} aria-label={s.title}>
              <h3 className="pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{s.title}</h3>
              <ul className="-mx-2 flex flex-col">
                {s.items.map((e) => {
                  const isSel = selected.includes(e.id);
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => choose(e.id)}
                        aria-pressed={multi ? isSel : undefined}
                        className={cx("flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-2", isSel && "bg-accent-soft hover:bg-accent-soft")}
                      >
                        <span className={cx("flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold uppercase", isSel ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-2")} aria-hidden>
                          {isSel ? <Check className="size-4" /> : e.name.slice(0, 2)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
                            <span className="truncate">{e.name}</span>
                            {e.isFavorite && <Star className="size-3.5 shrink-0 fill-current text-warning" aria-label="Favorite" />}
                            {e.isCustom && <Badge tone="outline">Custom</Badge>}
                          </span>
                          <span className="block truncate text-xs text-muted">
                            {titleCase(e.primaryMuscle)} · {titleCase(e.equipment)}
                            {e.lastDate ? ` · last ${dayLabel(e.lastDate)}` : ""}
                            {presentIds.includes(e.id) ? " · in this workout" : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {filtered.length === 0 && filtering && <p className="text-center text-sm text-muted">No exercise matches{query.trim() ? ` “${query.trim()}”` : " this filter"}.</p>}
          <Button variant="secondary" className="w-full" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden /> Create {query.trim() ? `“${query.trim()}”` : "custom exercise"}
          </Button>
        </>
      )}

      {multi && (
        <div className="sticky -bottom-4 -mx-5 -mb-4 flex justify-end gap-2 border-t border-line bg-surface px-5 py-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!selected.length}
            onClick={() => {
              onSelect(selected);
              onClose();
            }}
          >
            {confirmLabel ? confirmLabel(selected.length) : selected.length ? `Add ${selected.length}` : "Add"}
          </Button>
        </div>
      )}
    </div>
  );
}
