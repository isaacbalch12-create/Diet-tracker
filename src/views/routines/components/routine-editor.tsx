"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Eye, EyeOff, Info, LayoutTemplate, Library, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardTitle, cx, EmptyState, ErrorBanner, Field, IconButton, Input, Modal, Segmented, Select, Skeleton, Textarea } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useInvalidateData, useRoutineTemplates } from "@/lib/client/hooks";
import type { MobilityRoutineJ, RoutineDayJ, RoutineTemplateJ } from "@/lib/client/types";
import { formatLocalDate } from "@/lib/time";
import { MobilityLibrary } from "./mobility-library";
import { fmtAmount, KIND_META, KINDS, newId, putJson, SLOT_META, type ActivityJ, type JournalPrompt, type RoutineActivityKind, type Slot } from "./shared";

const DEFAULT_PROMPTS: Record<Slot, string[]> = {
  morning: ["What am I grateful for this morning?", "What is the one thing that would make today a success?", "How am I feeling, physically and mentally?"],
  night: ["What went well today?", "What could I have done better?", "What did I accomplish?", "What do I want to accomplish tomorrow?"],
};

function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

interface ActivityBody {
  title: string;
  required: boolean;
  targetValue: number | null;
  targetUnit: string | null;
  instructions: string | null;
  config: { mobilityRoutineId?: string | null; prompts?: JournalPrompt[] };
}

/**
 * Every editable field of an activity. The PATCH endpoint re-applies schema
 * defaults for omitted fields, so partial patches would reset them.
 */
function fullBody(a: ActivityJ, patch: Partial<ActivityBody> = {}): ActivityBody {
  return { title: a.title, required: a.required, targetValue: a.targetValue, targetUnit: a.targetUnit, instructions: a.instructions, config: a.config, ...patch };
}

const hasTarget = (k: RoutineActivityKind) => k === "reading" || k === "count";

// ---------------------------------------------------------------------------

function PromptsEditor({ prompts, onChange }: { prompts: JournalPrompt[]; onChange: (p: JournalPrompt[]) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    if (!text.trim() || prompts.length >= 20) return;
    onChange([...prompts, { id: newId(), text: text.trim(), enabled: true }]);
    setText("");
  };
  const set = (id: string, patch: Partial<JournalPrompt>) => onChange(prompts.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-fg-2">Prompts</p>
      <p className="-mt-1 text-xs text-muted">Hidden prompts aren&apos;t shown when writing. A free-writing box is always there.</p>
      {prompts.length === 0 && <p className="text-sm text-muted">No prompts — free writing only.</p>}
      <ol className="flex flex-col gap-2">
        {prompts.map((p, idx) => (
          <li key={p.id} className={cx("flex items-center gap-1 rounded-lg border border-line p-1.5", !p.enabled && "bg-surface-2")}>
            <IconButton label={p.enabled ? `Hide prompt ${idx + 1}` : `Show prompt ${idx + 1}`} aria-pressed={p.enabled} onClick={() => set(p.id, { enabled: !p.enabled })} className={p.enabled ? "text-accent" : "text-muted"}>
              {p.enabled ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            </IconButton>
            <Input aria-label={`Prompt ${idx + 1}`} value={p.text} maxLength={300} onChange={(e) => set(p.id, { text: e.target.value })} className={cx("min-w-0 flex-1", !p.enabled && "text-muted")} />
            <div className="flex shrink-0">
              <IconButton label={`Move prompt ${idx + 1} up`} disabled={idx === 0} onClick={() => onChange(move(prompts, idx, -1))}>
                <ArrowUp className="size-4" />
              </IconButton>
              <IconButton label={`Move prompt ${idx + 1} down`} disabled={idx === prompts.length - 1} onClick={() => onChange(move(prompts, idx, 1))}>
                <ArrowDown className="size-4" />
              </IconButton>
              <IconButton label={`Delete prompt ${idx + 1}`} className="hover:text-critical" onClick={() => onChange(prompts.filter((x) => x.id !== p.id))}>
                <Trash2 className="size-4" />
              </IconButton>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex gap-2">
        <Input
          aria-label="New prompt"
          placeholder="Add a prompt, e.g. “What am I looking forward to?”"
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button variant="secondary" onClick={add} disabled={!text.trim() || prompts.length >= 20}>
          <Plus className="size-4" aria-hidden /> Add
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ActivityForm({ slot, activity, mobilityRoutines, onDone, onOpenLibrary }: { slot: Slot; activity: ActivityJ | null; mobilityRoutines: MobilityRoutineJ[]; onDone: () => void; onOpenLibrary: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const [kind, setKind] = useState<RoutineActivityKind>(activity?.kind ?? "checklist");
  const [title, setTitle] = useState(activity?.title ?? "");
  const [titleTouched, setTitleTouched] = useState(!!activity);
  const [required, setRequired] = useState(activity?.required ?? true);
  const [target, setTarget] = useState(activity?.targetValue?.toString() ?? "");
  const [unit, setUnit] = useState(activity?.targetUnit ?? "");
  const [instructions, setInstructions] = useState(activity?.instructions ?? "");
  const [mobilityId, setMobilityId] = useState(activity?.config.mobilityRoutineId ?? (activity ? "" : (mobilityRoutines.find((m) => m.slot === slot)?.id ?? mobilityRoutines[0]?.id ?? "")));
  const [prompts, setPrompts] = useState<JournalPrompt[]>(() => activity?.config.prompts ?? DEFAULT_PROMPTS[slot].map((text) => ({ id: newId(), text, enabled: true })));
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const pickKind = (k: RoutineActivityKind) => {
    setKind(k);
    if (!titleTouched) setTitle(k === "checklist" || k === "count" ? "" : k === "journal" ? SLOT_META[slot].journalTitle : KIND_META[k].label);
    if (k === "reading" && !unit) setUnit("pages");
    if (k === "reading" && !target) setTarget("10");
  };

  const targetNum = target.trim() ? Number(target.replace(",", ".")) : null;
  const targetError = hasTarget(kind) && targetNum != null && !(Number.isFinite(targetNum) && targetNum > 0 && targetNum <= 100_000) ? "Enter a positive number" : null;
  const titleError = title.trim() ? null : "Give the activity a name";

  const save = async () => {
    setShowErrors(true);
    if (titleError || targetError) return;
    setSaving(true);
    setError(null);
    const body: ActivityBody = {
      title: title.trim(),
      required,
      targetValue: hasTarget(kind) ? targetNum : null,
      targetUnit: hasTarget(kind) && unit.trim() ? unit.trim() : null,
      instructions: instructions.trim() || null,
      config: kind === "mobility" ? { mobilityRoutineId: mobilityId || null } : kind === "journal" ? { prompts: prompts.filter((p) => p.text.trim()).map((p) => ({ ...p, text: p.text.trim() })) } : {},
    };
    try {
      if (activity) await api.patch(`/api/routines/activities/${activity.id}`, body);
      else await api.post(`/api/routines/${slot}/activities`, { ...body, kind });
      await invalidate();
      toast.success(activity ? "Activity updated" : "Activity added");
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {activity ? (
        <p className="flex items-center gap-2 text-sm text-fg-2">
          Type: <Badge>{KIND_META[kind].label}</Badge>
          <span className="text-xs text-muted">(to change the type, add a new activity and remove this one)</span>
        </p>
      ) : (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-fg-2">Type</legend>
          <div role="radiogroup" aria-label="Activity type" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {KINDS.map((k) => {
              const Icon = KIND_META[k].icon;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => pickKind(k)}
                  className={cx("flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors", kind === k ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2")}
                >
                  <Icon className={cx("mt-0.5 size-4 shrink-0", kind === k ? "text-accent" : "text-muted")} aria-hidden />
                  <span>
                    <span className="block text-sm font-medium text-fg">{KIND_META[k].label}</span>
                    <span className="block text-xs text-muted">{KIND_META[k].hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      <Field label="Name" error={showErrors ? titleError : null}>
        {(id) => (
          <Input
            id={id}
            value={title}
            maxLength={80}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleTouched(true);
            }}
            placeholder={kind === "checklist" ? "e.g. Make the bed" : kind === "count" ? "e.g. Push-ups" : undefined}
          />
        )}
      </Field>

      <Field label="Completion" hint={required ? "Required activities count toward the routine's completion %." : "Optional activities are tracked but never lower your completion %."}>
        {() => (
          <Segmented
            label="Completion requirement"
            value={required ? "required" : "optional"}
            onChange={(v) => setRequired(v === "required")}
            options={[
              { value: "required", label: "Required" },
              { value: "optional", label: "Optional" },
            ]}
          />
        )}
      </Field>

      {hasTarget(kind) && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Daily target" error={showErrors ? targetError : null} hint={kind === "reading" ? "Reaching it ticks the activity off." : "Leave empty for no target."}>
            {(id) => <Input id={id} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="e.g. 10" />}
          </Field>
          <Field label="Unit">{(id) => <Input id={id} value={unit} maxLength={30} onChange={(e) => setUnit(e.target.value)} placeholder={kind === "reading" ? "pages, chapters…" : "reps, glasses…"} />}</Field>
        </div>
      )}

      {kind === "mobility" && (
        <Field label="Mobility routine" hint="The list of stretches to tick off. Manage them in the library.">
          {(id) => (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select id={id} value={mobilityId} onChange={(e) => setMobilityId(e.target.value)}>
                <option value="">None — tick off manually</option>
                {mobilityRoutines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.items.length})
                  </option>
                ))}
              </Select>
              <Button variant="secondary" onClick={onOpenLibrary}>
                <Library className="size-4" aria-hidden /> Library
              </Button>
            </div>
          )}
        </Field>
      )}

      {kind === "journal" && <PromptsEditor prompts={prompts} onChange={setPrompts} />}

      <Field label="Instructions / notes (optional)">{(id) => <Textarea id={id} rows={2} value={instructions} maxLength={2000} onChange={(e) => setInstructions(e.target.value)} placeholder="Shown on the checklist" />}</Field>

      {error ? <ErrorBanner error={error} /> : null}
      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button loading={saving} onClick={() => void save()}>
          {activity ? "Save" : "Add activity"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TemplatesPanel({ slot, activityCount }: { slot: Slot; activityCount: number }) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const q = useRoutineTemplates(slot);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<{ t: RoutineTemplateJ; action: "apply" | "delete" } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.post(`/api/routines/${slot}/templates`, { name: name.trim() });
      await invalidate();
      toast.success(`Saved template “${name.trim()}”`);
      setName("");
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const run = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.action === "apply") {
        await api.post(`/api/routines/templates/${confirm.t.id}/apply`);
        toast.success(`${SLOT_META[slot].label} replaced with “${confirm.t.name}”`);
      } else {
        await api.del(`/api/routines/templates/${confirm.t.id}`);
        toast.success(`Deleted template “${confirm.t.name}”`);
      }
      await invalidate();
      setConfirm(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardTitle sub={`Save this ${SLOT_META[slot].short.toLowerCase()} routine as a template and switch between versions anytime (e.g. “Weekday” and “Weekend”). Templates for the other routine are separate.`}>
        <span className="inline-flex items-center gap-2">
          <LayoutTemplate className="size-4 text-muted" aria-hidden /> Templates
        </span>
      </CardTitle>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input aria-label="Template name" placeholder="Template name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="secondary" loading={saving} disabled={!name.trim() || activityCount === 0}>
          Save current
        </Button>
      </form>
      {activityCount === 0 && <p className="mt-1.5 text-xs text-muted">Add at least one activity before saving a template.</p>}
      <div className="mt-4">
        {q.error ? (
          <ErrorBanner error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <Skeleton className="h-14" />
        ) : q.data.length === 0 ? (
          <p className="text-sm text-muted">No saved templates yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {q.data.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-fg">{t.name}</p>
                  <p className="truncate text-xs text-muted">
                    {t.activities.length} activit{t.activities.length === 1 ? "y" : "ies"}: {t.activities.map((a) => a.title).join(", ")} · saved {formatLocalDate(t.updatedAt.slice(0, 10), { month: "short", day: "numeric" })}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="secondary" onClick={() => setConfirm({ t, action: "apply" })}>
                    Apply
                  </Button>
                  <IconButton label={`Delete template ${t.name}`} className="hover:text-critical" onClick={() => setConfirm({ t, action: "delete" })}>
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.action === "apply" ? "Apply template?" : "Delete template?"}>
        {confirm && (
          <div className="flex flex-col gap-4">
            {confirm.action === "apply" ? (
              <div className="flex flex-col gap-2 text-sm text-fg-2">
                <p>
                  Replace your {SLOT_META[slot].label.toLowerCase()} with “{confirm.t.name}” ({confirm.t.activities.map((a) => a.title).join(", ")}) from today on.
                </p>
                <p>Past days keep the activities and history they had. Anything already ticked off today for the current activities won&apos;t count anymore. Your other routine isn&apos;t affected.</p>
                {activityCount > 0 && <p className="text-xs text-muted">Tip: save the current routine as a template first if you may want it back.</p>}
              </div>
            ) : (
              <p className="text-sm text-fg-2">“{confirm.t.name}” will be deleted. Your current routine isn&apos;t affected.</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button variant={confirm.action === "apply" ? "primary" : "danger"} loading={busy} onClick={() => void run()}>
                {confirm.action === "apply" ? "Replace routine" : "Delete"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}

// ---------------------------------------------------------------------------

/** Edit mode: add, edit, remove and reorder activities, templates and the mobility library. */
export function RoutineEditor({ slot, day, queryKey }: { slot: Slot; day: RoutineDayJ; queryKey: readonly unknown[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const invalidate = useInvalidateData();
  const [form, setForm] = useState<{ activity: ActivityJ | null } | null>(null);
  const [remove, setRemove] = useState<ActivityJ | null>(null);
  const [removing, setRemoving] = useState(false);
  const [library, setLibrary] = useState(false);
  const activities = day.activities;

  const reorder = async (idx: number, dir: -1 | 1) => {
    const ids = move(
      activities.map((a) => a.id),
      idx,
      dir,
    );
    const prev = qc.getQueryData<RoutineDayJ>(queryKey);
    if (prev) qc.setQueryData<RoutineDayJ>(queryKey, { ...prev, activities: ids.map((id) => prev.activities.find((a) => a.id === id)).filter((a): a is ActivityJ => !!a) });
    try {
      await putJson(`/api/routines/${slot}/activities`, { ids });
    } catch (err) {
      if (prev) qc.setQueryData(queryKey, prev);
      toast.error(err);
    } finally {
      void invalidate();
    }
  };

  const setMobility = async (a: ActivityJ, id: string) => {
    try {
      await api.patch(`/api/routines/activities/${a.id}`, fullBody(a, { config: { ...a.config, mobilityRoutineId: id || null } }));
      await invalidate();
      toast.success(id ? "Mobility routine updated" : "Mobility routine unlinked");
    } catch (err) {
      toast.error(err);
    }
  };

  const toggleRequired = async (a: ActivityJ) => {
    try {
      await api.patch(`/api/routines/activities/${a.id}`, fullBody(a, { required: !a.required }));
      await invalidate();
    } catch (err) {
      toast.error(err);
    }
  };

  const doRemove = async () => {
    if (!remove) return;
    setRemoving(true);
    try {
      const res = await api.del<{ result: "deleted" | "archived" }>(`/api/routines/activities/${remove.id}`);
      await invalidate();
      toast.success(res.result === "archived" ? `Removed “${remove.title}” from today on. Past days are unchanged and keep it in their history.` : `Removed “${remove.title}”.`);
      setRemove(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-fg">
        <Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        <span>
          Changes apply to your {SLOT_META[slot].label.toLowerCase()} from today on. Past days keep the activities they had, and the {SLOT_META[slot === "morning" ? "night" : "morning"].label.toLowerCase()} is never affected.
        </span>
      </p>

      <Card>
        <CardTitle
          sub="Order here is the order on your checklist."
          action={
            <Button size="sm" onClick={() => setForm({ activity: null })} disabled={activities.length >= 100}>
              <Plus className="size-4" aria-hidden /> Add activity
            </Button>
          }
        >
          Activities
        </CardTitle>
        {activities.length === 0 ? (
          <EmptyState title="No activities" action={<Button onClick={() => setForm({ activity: null })}>Add your first activity</Button>}>
            Add stretching, reading, journaling, a simple check-off or a count.
          </EmptyState>
        ) : (
          <ol className="flex flex-col divide-y divide-line">
            {activities.map((a, idx) => {
              const Icon = KIND_META[a.kind].icon;
              const details = [
                KIND_META[a.kind].label,
                a.targetValue != null ? `target ${fmtAmount(a.targetValue, a.targetUnit)}` : null,
                a.kind === "journal" ? `${(a.config.prompts ?? []).filter((p) => p.enabled).length} of ${(a.config.prompts ?? []).length} prompts shown` : null,
              ].filter(Boolean);
              return (
                <li key={a.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start gap-2">
                    <div className="flex shrink-0 flex-col">
                      <IconButton label={`Move ${a.title} up`} disabled={idx === 0} onClick={() => void reorder(idx, -1)}>
                        <ArrowUp className="size-4" />
                      </IconButton>
                      <IconButton label={`Move ${a.title} down`} disabled={idx === activities.length - 1} onClick={() => void reorder(idx, 1)}>
                        <ArrowDown className="size-4" />
                      </IconButton>
                    </div>
                    <div className="min-w-0 flex-1 pt-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
                        <Icon className="size-4 shrink-0 text-muted" aria-hidden />
                        <span className="min-w-0 break-words">{a.title}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-muted">{details.join(" · ")}</p>
                      <button
                        type="button"
                        onClick={() => void toggleRequired(a)}
                        className="mt-1.5 inline-flex min-h-8 items-center"
                        title={a.required ? "Counts toward completion — tap to make optional" : "Doesn't count toward completion — tap to make required"}
                        aria-label={`${a.title}: ${a.required ? "required" : "optional"}. Tap to make ${a.required ? "optional" : "required"}`}
                      >
                        <Badge tone={a.required ? "accent" : "outline"}>{a.required ? "Required" : "Optional"}</Badge>
                      </button>
                    </div>
                    <div className="flex shrink-0 items-center">
                      <IconButton label={`Edit ${a.title}`} onClick={() => setForm({ activity: a })}>
                        <Pencil className="size-4" />
                      </IconButton>
                      <IconButton label={`Remove ${a.title}`} className="hover:text-critical" onClick={() => setRemove(a)}>
                        <Trash2 className="size-4" />
                      </IconButton>
                    </div>
                  </div>
                  {a.kind === "mobility" && (
                    <div className="flex flex-col gap-2 pl-11 sm:flex-row sm:items-center">
                      <Select aria-label={`Mobility routine used by ${a.title}`} value={a.config.mobilityRoutineId ?? ""} onChange={(e) => void setMobility(a, e.target.value)} className="sm:max-w-xs">
                        <option value="">No mobility routine</option>
                        {day.mobilityRoutines.map((m) => (
                          <option key={m.id} value={m.id}>
                            Uses: {m.name} ({m.items.length})
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <Card>
        <CardTitle
          sub="Saved lists of stretches and mobility exercises with order, sets/reps, per-side and notes."
          action={
            <Button size="sm" variant="secondary" onClick={() => setLibrary(true)}>
              <Library className="size-4" aria-hidden /> Open library
            </Button>
          }
        >
          Mobility library
        </CardTitle>
        <p className="text-sm text-fg-2">
          {day.mobilityRoutines.length} saved: {day.mobilityRoutines.map((m) => m.name).join(", ") || "none yet"}
        </p>
      </Card>

      <TemplatesPanel slot={slot} activityCount={activities.length} />

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.activity ? `Edit “${form.activity.title}”` : `Add to ${SLOT_META[slot].label.toLowerCase()}`} wide>
        {form && <ActivityForm key={form.activity?.id ?? "new"} slot={slot} activity={form.activity} mobilityRoutines={day.mobilityRoutines} onDone={() => setForm(null)} onOpenLibrary={() => setLibrary(true)} />}
      </Modal>

      <Modal open={!!remove} onClose={() => setRemove(null)} title="Remove activity?">
        {remove && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-fg-2">
              “{remove.title}” will be removed from your {SLOT_META[slot].label.toLowerCase()} from today on. If you&apos;ve logged it on earlier days, those days keep it in their history and completion %.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRemove(null)}>
                Cancel
              </Button>
              <Button variant="danger" loading={removing} onClick={() => void doRemove()}>
                Remove
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <MobilityLibrary open={library} onClose={() => setLibrary(false)} slot={slot} />
    </div>
  );
}
