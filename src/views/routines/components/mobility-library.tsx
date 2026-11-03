"use client";

import { ArrowDown, ArrowUp, Pencil, PersonStanding, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { Badge, Button, cx, EmptyState, ErrorBanner, Field, IconButton, Input, Modal, Segmented, Skeleton, Textarea } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useInvalidateData, useMobility, useRoutine } from "@/lib/client/hooks";
import type { MobilityRoutineJ } from "@/lib/client/types";
import { mobilityTarget, newId, putJson, SLOT_META, type Slot } from "./shared";

interface ItemDraft {
  id: string;
  name: string;
  sets: string;
  reps: string;
  perSide: boolean;
  targetNote: string;
  instructions: string;
}

const blankItem = (): ItemDraft => ({ id: newId(), name: "", sets: "", reps: "", perSide: false, targetNote: "", instructions: "" });

function parseInt0(s: string, max: number): { ok: boolean; value: number | null } {
  const t = s.trim();
  if (!t) return { ok: true, value: null };
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 && n <= max ? { ok: true, value: n } : { ok: false, value: null };
}

function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

// ---------------------------------------------------------------------------

function MobilityForm({ routine, defaultSlot, onDone }: { routine: MobilityRoutineJ | null; defaultSlot: Slot; onDone: (saved: MobilityRoutineJ | null) => void }) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const [name, setName] = useState(routine?.name ?? "");
  const [slot, setSlot] = useState<"any" | Slot>(routine ? (routine.slot ?? "any") : defaultSlot);
  const [items, setItems] = useState<ItemDraft[]>(() =>
    routine
      ? routine.items.map((i) => ({ id: i.id, name: i.name, sets: i.sets?.toString() ?? "", reps: i.reps?.toString() ?? "", perSide: i.perSide, targetNote: i.targetNote, instructions: i.instructions }))
      : [blankItem()],
  );
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const update = (id: string, patch: Partial<ItemDraft>) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const itemErrors = (i: ItemDraft) => ({
    name: i.name.trim() ? null : "Name the stretch or exercise",
    sets: parseInt0(i.sets, 50).ok ? null : "Whole number 1–50",
    reps: parseInt0(i.reps, 500).ok ? null : "Whole number 1–500",
  });
  // Rows left completely blank are dropped rather than blocking the save.
  const filled = items.filter((i) => i.name.trim() || i.sets.trim() || i.reps.trim() || i.targetNote.trim() || i.instructions.trim());
  const invalid = !name.trim() || filled.some((i) => Object.values(itemErrors(i)).some(Boolean));

  const save = async () => {
    setShowErrors(true);
    if (invalid) return;
    setSaving(true);
    setError(null);
    const body = {
      name: name.trim(),
      slot: slot === "any" ? null : slot,
      items: filled.map((i) => ({ id: i.id, name: i.name.trim(), sets: parseInt0(i.sets, 50).value, reps: parseInt0(i.reps, 500).value, perSide: i.perSide, targetNote: i.targetNote.trim(), instructions: i.instructions.trim() })),
    };
    try {
      const res = routine ? await putJson<{ routine: MobilityRoutineJ }>(`/api/mobility/${routine.id}`, body) : await api.post<{ routine: MobilityRoutineJ }>("/api/mobility", body);
      await invalidate();
      toast.success(routine ? "Mobility routine saved" : "Mobility routine created");
      onDone(res.routine);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
        <Field label="Name" error={showErrors && !name.trim() ? "Give it a name" : null}>
          {(id) => <Input id={id} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hips & lower back" />}
        </Field>
        <Field label="Usually for" hint="Just for organizing — any routine can use it.">
          {() => (
            <Segmented
              label="Usually for"
              value={slot}
              onChange={setSlot}
              options={[
                { value: "any", label: "Any" },
                { value: "morning", label: "Morning" },
                { value: "night", label: "Night" },
              ]}
            />
          )}
        </Field>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-fg-2">Stretches & exercises, in order</p>
        {items.length === 0 && <p className="mb-2 text-sm text-muted">No stretches yet.</p>}
        <ol className="flex flex-col gap-3">
          {items.map((it, idx) => {
            const errs = showErrors && filled.includes(it) ? itemErrors(it) : { name: null, sets: null, reps: null };
            return (
              <li key={it.id} className="rounded-xl border border-line bg-surface-2/50 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-muted tabular">#{idx + 1}</span>
                  <div className="flex items-center">
                    <IconButton label={`Move ${it.name || "stretch"} up`} disabled={idx === 0} onClick={() => setItems((p) => move(p, idx, -1))}>
                      <ArrowUp className="size-4" />
                    </IconButton>
                    <IconButton label={`Move ${it.name || "stretch"} down`} disabled={idx === items.length - 1} onClick={() => setItems((p) => move(p, idx, 1))}>
                      <ArrowDown className="size-4" />
                    </IconButton>
                    <IconButton label={`Remove ${it.name || "stretch"}`} className="hover:text-critical" onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-[2fr_1fr_1fr]">
                  <Field label="Name" error={errs.name} className="col-span-2 sm:col-span-1">
                    {(id) => <Input id={id} value={it.name} maxLength={100} onChange={(e) => update(it.id, { name: e.target.value })} placeholder="e.g. Pigeon pose" />}
                  </Field>
                  <Field label="Sets" error={errs.sets}>
                    {(id) => <Input id={id} inputMode="numeric" value={it.sets} onChange={(e) => update(it.id, { sets: e.target.value })} placeholder="—" />}
                  </Field>
                  <Field label="Reps" error={errs.reps}>
                    {(id) => <Input id={id} inputMode="numeric" value={it.reps} onChange={(e) => update(it.id, { reps: e.target.value })} placeholder="—" />}
                  </Field>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr] sm:items-end">
                  <label className="flex h-10 cursor-pointer items-center gap-2 text-sm text-fg">
                    <input type="checkbox" className="size-5 accent-[var(--accent)]" checked={it.perSide} onChange={(e) => update(it.id, { perSide: e.target.checked })} />
                    Per side
                  </label>
                  <Field label="Target (optional)">
                    {(id) => <Input id={id} value={it.targetNote} maxLength={120} onChange={(e) => update(it.id, { targetNote: e.target.value })} placeholder="e.g. 5 slow breaths" />}
                  </Field>
                </div>
                <Field label="Instructions / notes" className="mt-3">
                  {(id) => <Textarea id={id} rows={2} value={it.instructions} maxLength={2000} onChange={(e) => update(it.id, { instructions: e.target.value })} placeholder="Cues, form notes, modifications…" />}
                </Field>
              </li>
            );
          })}
        </ol>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setItems((p) => [...p, blankItem()])} disabled={items.length >= 60}>
          <Plus className="size-4" aria-hidden /> Add stretch or exercise
        </Button>
      </div>

      {error ? <ErrorBanner error={error} /> : null}
      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <Button variant="secondary" onClick={() => onDone(null)}>
          Cancel
        </Button>
        <Button loading={saving} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function LibraryContent({ slot, initialEditId }: { slot: Slot; initialEditId?: string | null }) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const mobQ = useMobility();
  const morningQ = useRoutine("morning", null);
  const nightQ = useRoutine("night", null);
  const [editing, setEditing] = useState<string | "new" | null>(initialEditId ?? null);
  const [confirm, setConfirm] = useState<MobilityRoutineJ | null>(null);
  const [deleting, setDeleting] = useState(false);

  const usedBy = (id: string) =>
    [...(morningQ.data?.activities ?? []), ...(nightQ.data?.activities ?? [])].filter((a) => a.kind === "mobility" && a.config.mobilityRoutineId === id).map((a) => `${SLOT_META[a.slot].short} · ${a.title}`);

  const remove = async (r: MobilityRoutineJ) => {
    setDeleting(true);
    try {
      await api.del(`/api/mobility/${r.id}`);
      await invalidate();
      toast.success(`Deleted “${r.name}”`);
      setConfirm(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setDeleting(false);
    }
  };

  if (mobQ.error) return <ErrorBanner error={mobQ.error} onRetry={() => mobQ.refetch()} />;
  if (!mobQ.data)
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );

  if (editing) {
    const routine = editing === "new" ? null : (mobQ.data.find((r) => r.id === editing) ?? null);
    return <MobilityForm key={editing} routine={routine} defaultSlot={slot} onDone={() => setEditing(null)} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Save as many stretching & mobility routines as you like, then choose which one each routine&apos;s mobility activity uses (Edit routine → edit the activity).</p>
      {mobQ.data.length === 0 ? (
        <EmptyState icon={<PersonStanding className="size-8" />} title="No mobility routines yet">
          Create one with the stretches you want, in order.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {mobQ.data.map((r) => {
            const users = usedBy(r.id);
            return (
              <li key={r.id} className="rounded-xl border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
                      {r.name}
                      {r.slot && <Badge>{SLOT_META[r.slot].short}</Badge>}
                    </p>
                    <p className="mt-0.5 text-sm text-muted">
                      {r.items.length} stretch{r.items.length === 1 ? "" : "es"}
                      {r.items.length > 0 && `: ${r.items.slice(0, 4).map((i) => i.name).join(", ")}${r.items.length > 4 ? "…" : ""}`}
                    </p>
                    <p className={cx("mt-1 text-xs", users.length ? "text-fg-2" : "text-muted")}>{users.length ? `Used by ${users.join(", ")}` : "Not used by a routine right now"}</p>
                  </div>
                  <div className="flex shrink-0 items-center">
                    <IconButton label={`Edit ${r.name}`} onClick={() => setEditing(r.id)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton label={`Delete ${r.name}`} className="hover:text-critical" onClick={() => setConfirm(r)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </div>
                {r.items.length > 0 && (
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-xs font-medium text-accent">Show all</summary>
                    <ol className="mt-2 flex flex-col gap-1 pl-1">
                      {r.items.map((i, idx) => (
                        <li key={i.id} className="text-fg-2">
                          <span className="text-muted tabular">{idx + 1}.</span> {i.name}
                          {mobilityTarget(i) && <span className="text-muted"> — {mobilityTarget(i)}</span>}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <Button variant="secondary" onClick={() => setEditing("new")}>
          <Plus className="size-4" aria-hidden /> New mobility routine
        </Button>
      </div>
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Delete mobility routine?">
        {confirm && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-fg-2">
              “{confirm.name}” will be deleted.
              {usedBy(confirm.id).length > 0 && ` It's currently used by ${usedBy(confirm.id).join(", ")} — choose a different mobility routine there first.`}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button variant="danger" loading={deleting} onClick={() => void remove(confirm)}>
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Modal for creating, editing and deleting saved mobility routines. */
export function MobilityLibrary({ open, onClose, slot, editId }: { open: boolean; onClose: () => void; slot: Slot; editId?: string | null }) {
  return (
    <Modal open={open} onClose={onClose} title="Mobility library" wide>
      {open && <LibraryContent key={editId ?? "list"} slot={slot} initialEditId={editId} />}
    </Modal>
  );
}
