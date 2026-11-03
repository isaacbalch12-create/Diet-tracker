"use client";

import { ArrowLeft, Check, ChevronRight, Search, Star } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useToast } from "@/components/toast";
import { Button, cx, ErrorBanner, Field, Input, Modal, Segmented, Select, Skeleton, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/client/api";
import { useExercises, useInvalidateData } from "@/lib/client/hooks";
import type { GoalJ2, SettingsResponse } from "@/lib/client/types";
import type { GoalCategory, GoalComparator, GoalPeriod } from "@/lib/db/schema";
import { METRICS, METRIC_BY_KEY, type Aggregation } from "@/lib/goals/catalog";
import { NUTRIENTS } from "@/lib/nutrition/nutrients";
import {
  blankDraft,
  draftForMetric,
  draftFromGoal,
  effectiveAgg,
  inputUnitLabel,
  isFixedDaily,
  metricUnit,
  needsThreshold,
  nutrientDefaults,
  suggestTitle,
  targetUnit,
  toPayload,
  validateDraft,
  type Draft,
  type FieldErrors,
  type Slot,
} from "./draft";
import { AGG_LABELS, CATEGORY_META, CATEGORY_ORDER, COMPARATOR_LABELS, PERIOD_LABELS, prefsOf } from "./labels";
import { PRESET_BY_ID, PRESETS, type PresetCtx } from "./presets";
import { goalUrl } from "./use-goal-actions";

export type GoalFormInit = { mode: "create"; presetId?: string } | { mode: "edit"; goal: GoalJ2 };

const METRIC_HINTS: Record<string, string> = {
  weight_rate: "Negative numbers mean losing weight: −0.5 to −0.25 means lose 0.25–0.5 per week. Uses a trend fitted over 3 weeks of weigh-ins.",
  weight_target: "Compared with your 7-day average weight, so day-to-day swings don't count against you.",
  sleep_score: "Only works when a connected device or app provides its own sleep score.",
  routine_completion: "100% means every required activity in the routine was done that day.",
  exercise_e1rm: "Estimated from your best set — an estimate, not a tested max.",
  exercise_weight_reps: "Met once you complete a set of at least this many reps at this weight or heavier.",
  run_consistency: "Planned rest and recovery days don't count against you.",
  run_distance: "Planned rest and recovery days don't count against you.",
  custom: "You check in by hand on the goal's page. For a yes/no habit keep the target at 1 (1 = done).",
};

const FIXED_TEXT: Record<string, string> = {
  run_completed: "Met on each day you log a run. Planned rest and recovery days are excused.",
  weigh_ins: "Met on each day with the chosen weigh-in.",
  journal_days: "Met on each day with a journal entry.",
  mobility_days: "Met on each day your stretching or mobility activity is done.",
};

const SLOT_REQUIRED: { value: Slot; label: string }[] = [
  { value: "morning", label: "Morning routine" },
  { value: "night", label: "Nightly routine" },
  { value: "both", label: "Both routines" },
];
const SLOT_OPTIONAL: { value: Slot; label: string }[] = [
  { value: "any", label: "Any routine" },
  { value: "morning", label: "Morning routine" },
  { value: "night", label: "Nightly routine" },
];
const WEIGH_INS: { value: Slot; label: string }[] = [
  { value: "morning", label: "Morning weigh-in" },
  { value: "night", label: "Night weigh-in" },
  { value: "both", label: "Both morning and night" },
  { value: "any", label: "Either one" },
];

export function GoalFormModal({ init, settings, onClose }: { init: GoalFormInit | null; settings: SettingsResponse; onClose: () => void }) {
  return (
    <Modal open={!!init} onClose={onClose} title={init?.mode === "edit" ? "Edit goal" : "New goal"} wide>
      {init && <GoalForm init={init} settings={settings} onClose={onClose} />}
    </Modal>
  );
}

function Label({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p id={id} className="text-sm font-medium text-fg-2">
      {children}
    </p>
  );
}

function UnitInput({
  id,
  value,
  onChange,
  unit,
  placeholder,
  invalid,
  allowNegative,
  ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  placeholder?: string;
  invalid?: boolean;
  allowNegative?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        inputMode={allowNegative ? "text" : "decimal"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        className="min-w-0 flex-1"
      />
      {unit && <span className="max-w-24 shrink-0 truncate text-sm text-fg-2">{unit}</span>}
    </div>
  );
}

function GoalForm({ init, settings, onClose }: { init: GoalFormInit; settings: SettingsResponse; onClose: () => void }) {
  const prefs = prefsOf(settings.settings);
  const today = settings.today;
  const toast = useToast();
  const invalidate = useInvalidateData();
  const ctx: PresetCtx = { prefs, settings };

  const [initial] = useState<{ draft: Draft; step: "choose" | "details"; query: string }>(() => {
    if (init.mode === "edit") return { draft: draftFromGoal(init.goal, prefs), step: "details", query: "" };
    const preset = init.presetId ? PRESET_BY_ID[init.presetId] : undefined;
    if (preset) return { draft: preset.apply(blankDraft(today), ctx), step: "details", query: preset.exerciseQuery ?? "" };
    return { draft: blankDraft(today), step: "choose", query: "" };
  });
  const [draft, setDraft] = useState<Draft>(initial.draft);
  const [step, setStep] = useState(initial.step);
  const [category, setCategory] = useState<GoalCategory | null>(null);
  const [exerciseQuery, setExerciseQuery] = useState(initial.query);
  const [showErrors, setShowErrors] = useState(false);
  const [serverFields, setServerFields] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (Object.keys(serverFields).length) setServerFields({});
  };

  const def = METRIC_BY_KEY[draft.metric];
  const suggested = suggestTitle(draft, prefs);
  const title = draft.titleTouched ? draft.title : suggested;
  const clientErrors: FieldErrors = { ...validateDraft(draft), ...(title.trim() ? {} : { title: "Give the goal a name" }) };
  const err = (key: string) => (showErrors ? clientErrors[key] : undefined) ?? serverFields[key];

  const pickPreset = (id: string) => {
    const p = PRESET_BY_ID[id];
    if (!p) return;
    setDraft(p.apply(blankDraft(today), ctx));
    setExerciseQuery(p.exerciseQuery ?? "");
    setShowErrors(false);
    setStep("details");
  };
  const pickMetric = (metric: string) => {
    setDraft((d) => draftForMetric(d, metric, prefs));
    setExerciseQuery("");
    setShowErrors(false);
    setStep("details");
  };

  const submit = async () => {
    setShowErrors(true);
    setServerError(null);
    if (Object.keys(clientErrors).length) {
      requestAnimationFrame(() => formRef.current?.querySelector('[role="alert"]')?.scrollIntoView({ block: "center", behavior: "smooth" }));
      return;
    }
    setSaving(true);
    try {
      if (init.mode === "create") {
        await api.post("/api/user-goals", toPayload(draft, prefs, title));
        await invalidate();
        toast.success("Goal created — it updates automatically from your logs");
      } else {
        const g = init.goal;
        const before = initial.draft;
        const keep =
          draft.target === before.target && draft.targetMax === before.targetMax && draft.comparator === before.comparator && targetUnit(draft) === targetUnit(before)
            ? { targetValue: g.targetValue, targetMax: g.targetMax }
            : undefined;
        const payload = toPayload(draft, prefs, title, keep);
        await api.patch(goalUrl(g.id), payload);
        await invalidate();
        const targetChanged = payload.targetValue !== g.targetValue || payload.targetMax !== (g.comparator === "range" ? g.targetMax : null);
        toast.success(targetChanged ? "Saved — the new target applies from today; earlier periods keep the target they had" : "Goal saved");
      }
      onClose();
    } catch (e) {
      const fields: FieldErrors = {};
      if (e instanceof ApiError && Array.isArray(e.details)) {
        for (const d of e.details as { path?: unknown; message?: unknown }[]) {
          if (typeof d.path === "string" && typeof d.message === "string" && !fields[d.path]) fields[d.path] = d.message;
        }
      }
      setServerFields(fields);
      setServerError(e);
    } finally {
      setSaving(false);
    }
  };

  if (step === "choose" || !def) {
    return <ChooseStep ctx={ctx} category={category} onCategory={setCategory} onPreset={pickPreset} onMetric={pickMetric} />;
  }

  const meta = CATEGORY_META[def.category];
  const Icon = meta.icon;
  const tUnit = targetUnit(draft);
  const unitLabel = inputUnitLabel(tUnit, prefs, draft.unitLabel);
  const fixed = isFixedDaily(draft);
  const agg = effectiveAgg(draft);
  const showAgg = draft.period !== "daily" && def.aggregations.length > 1;
  const threshold = needsThreshold(draft);
  const mUnit = metricUnit(draft);
  const allowNegative = mUnit === "kg_per_week";

  const onAggChange = (next: Aggregation) => {
    const wasCount = agg === "count";
    const patch: Partial<Draft> = { agg: next };
    if (next === "count" && !wasCount && mUnit !== "days") {
      if (!draft.dailyThreshold.trim()) patch.dailyThreshold = draft.target;
      patch.target = draft.period === "monthly" ? "20" : draft.period === "custom" ? String(Math.max(1, Math.round(Number(draft.periodDays) * 0.7) || 5)) : "5";
      patch.targetMax = "";
      if (draft.comparator === "range") patch.comparator = "at_least";
    } else if (wasCount && next !== "count" && draft.dailyThreshold.trim()) {
      patch.target = draft.dailyThreshold;
    }
    set(patch);
  };

  const onPeriodChange = (p: GoalPeriod) => {
    const patch: Partial<Draft> = { period: p };
    // Yes/no daily goals keep a sensible count when they become weekly or monthly.
    if (fixed && p !== "daily") patch.target = p === "weekly" ? "7" : p === "monthly" ? "28" : draft.periodDays || "7";
    set(patch);
  };

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-5"
    >
      <div className="flex items-start gap-3 rounded-lg bg-surface-2 p-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-surface" style={{ color: meta.color }}>
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">
            {meta.label} · {def.label}
          </p>
          <p className="mt-0.5 text-xs text-muted">{def.description}</p>
        </div>
        {init.mode === "create" && (
          <Button variant="ghost" size="sm" onClick={() => setStep("choose")}>
            Change
          </Button>
        )}
      </div>
      {METRIC_HINTS[draft.metric] && <p className="-mt-2 text-xs text-fg-2">{METRIC_HINTS[draft.metric]}</p>}

      {/* Parameters */}
      {def.params.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {def.params.map((p) => {
            if (p.key === "nutrient")
              return (
                <Field key={p.key} label="Nutrient" error={err("params.nutrient")}>
                  {(id) => (
                    <Select id={id} value={draft.nutrient} onChange={(e) => set(nutrientDefaults(e.target.value))}>
                      <option value="" disabled>
                        Choose a nutrient
                      </option>
                      {NUTRIENTS.map((n) => (
                        <option key={n.key} value={n.key}>
                          {n.label} ({n.unit})
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              );
            if (p.key === "exerciseId")
              return (
                <div key={p.key} className="sm:col-span-2">
                  <ExercisePicker
                    label={p.required ? "Exercise" : "Exercise (optional)"}
                    required={p.required}
                    value={draft.exerciseId}
                    valueName={draft.exerciseName}
                    query={exerciseQuery}
                    onQuery={setExerciseQuery}
                    onPick={(id, name) => set({ exerciseId: id, exerciseName: name })}
                    error={err("params.exerciseId")}
                  />
                </div>
              );
            if (p.key === "slot")
              return (
                <Field key={p.key} label="Routine">
                  {(id) => (
                    <Select id={id} value={draft.slot} onChange={(e) => set({ slot: e.target.value as Slot })}>
                      {(p.required ? SLOT_REQUIRED : SLOT_OPTIONAL).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              );
            if (p.key === "weighIn")
              return (
                <Field key={p.key} label="Which weigh-in">
                  {(id) => (
                    <Select id={id} value={draft.weighIn} onChange={(e) => set({ weighIn: e.target.value as Slot })}>
                      {WEIGH_INS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              );
            if (p.key === "reps")
              return (
                <Field key={p.key} label="Reps" error={err("params.reps")}>
                  {(id) => <UnitInput id={id} value={draft.reps} onChange={(v) => set({ reps: v })} unit="reps" invalid={!!err("params.reps")} />}
                </Field>
              );
            if (p.key === "minDistanceM")
              return (
                <Field key={p.key} label="Minimum distance (optional)" hint="Shorter runs don't count. Leave blank to count any run." error={err("params.minDistanceM")}>
                  {(id) => <UnitInput id={id} value={draft.minDistance} onChange={(v) => set({ minDistance: v })} unit={prefs.distanceUnit} placeholder="Any distance" invalid={!!err("params.minDistanceM")} />}
                </Field>
              );
            if (p.key === "unitLabel")
              return (
                <Field key={p.key} label="Unit (optional)" hint="e.g. glasses, minutes, chapters">
                  {(id) => <Input id={id} value={draft.unitLabel} maxLength={30} onChange={(e) => set({ unitLabel: e.target.value })} placeholder="times" />}
                </Field>
              );
            return null;
          })}
        </div>
      )}

      {/* Schedule */}
      <div className="flex flex-col gap-2">
        <Label>Schedule</Label>
        {def.periods.length > 1 ? (
          <Segmented<GoalPeriod> label="Schedule" value={draft.period} onChange={onPeriodChange} options={def.periods.map((p) => ({ value: p, label: PERIOD_LABELS[p] }))} />
        ) : (
          <p className="text-sm text-fg">{draft.period === "daily" ? "Checked every day" : draft.period === "weekly" ? "Checked every week" : PERIOD_LABELS[draft.period]}</p>
        )}
        {draft.period === "custom" && (
          <Field label="Days in each period" hint="Periods start on the start date and repeat." error={err("periodDays")} className="max-w-56">
            {(id) => <UnitInput id={id} value={draft.periodDays} onChange={(v) => set({ periodDays: v })} unit="days" invalid={!!err("periodDays")} />}
          </Field>
        )}
      </div>

      {showAgg && (
        <div className="flex flex-col gap-3">
          <Field label="Count it as">
            {(id) => (
              <Select id={id} value={agg} onChange={(e) => onAggChange(e.target.value as Aggregation)}>
                {def.aggregations.map((a) => (
                  <option key={a} value={a}>
                    {AGG_LABELS[a]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {threshold && (
            <div className="flex flex-col gap-1.5">
              <Label>A day counts when it&apos;s</Label>
              <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-2">
                <Select aria-label="Daily comparison" value={draft.dailyComparator} onChange={(e) => set({ dailyComparator: e.target.value as "at_least" | "at_most" })}>
                  <option value="at_least">At least</option>
                  <option value="at_most">At most</option>
                </Select>
                <UnitInput
                  id="goal-daily-threshold"
                  ariaLabel="Daily amount"
                  value={draft.dailyThreshold}
                  onChange={(v) => set({ dailyThreshold: v })}
                  unit={inputUnitLabel(mUnit, prefs, draft.unitLabel)}
                  placeholder={draft.metric === "custom" ? "1" : "Amount"}
                  invalid={!!err("params.dailyThreshold")}
                />
              </div>
              {err("params.dailyThreshold") ? (
                <p className="text-xs text-critical" role="alert">
                  {err("params.dailyThreshold")}
                </p>
              ) : (
                <p className="text-xs text-muted">{draft.metric === "custom" ? "Leave blank to count any check-in of 1 or more." : "The target below is then a number of days."}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Target */}
      {fixed ? (
        <p className="rounded-lg border border-line px-3 py-2 text-sm text-fg-2">{FIXED_TEXT[draft.metric] ?? "Met on each day it happens."}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {def.comparators.length > 1 && (
            <>
              <Label>Target</Label>
              <Segmented<GoalComparator> label="Comparison" value={draft.comparator} onChange={(c) => set({ comparator: c })} options={def.comparators.map((c) => ({ value: c, label: COMPARATOR_LABELS[c] }))} />
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={draft.comparator === "range" ? "From" : def.comparators.length > 1 ? "Amount" : `Target (${COMPARATOR_LABELS[draft.comparator].toLowerCase()})`} error={err("targetValue")}>
              {(id) => <UnitInput id={id} value={draft.target} onChange={(v) => set({ target: v })} unit={unitLabel} invalid={!!err("targetValue")} allowNegative={allowNegative} />}
            </Field>
            {draft.comparator === "range" && (
              <Field label="To" error={err("targetMax")}>
                {(id) => <UnitInput id={id} value={draft.targetMax} onChange={(v) => set({ targetMax: v })} unit={unitLabel} invalid={!!err("targetMax")} allowNegative={allowNegative} />}
              </Field>
            )}
          </div>
          {tUnit === "min" && <p className="text-xs text-muted">In hours — 7.5 = 7 h 30 min.</p>}
        </div>
      )}
      {init.mode === "edit" && <p className="-mt-2 text-xs text-fg-2">Changing the target applies from today. Earlier periods keep the target they had, so your history isn&apos;t rewritten.</p>}

      {/* Dates */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date" error={err("startDate")}>
          {(id) => <Input id={id} type="date" value={draft.startDate} onChange={(e) => set({ startDate: e.target.value })} aria-invalid={!!err("startDate") || undefined} />}
        </Field>
        <Field label="End date (optional)" error={err("endDate")}>
          {(id) => <Input id={id} type="date" value={draft.endDate} min={draft.startDate || undefined} onChange={(e) => set({ endDate: e.target.value })} aria-invalid={!!err("endDate") || undefined} />}
        </Field>
      </div>

      {/* Title & notes */}
      <Field
        label="Name"
        error={err("title")}
        hint={
          draft.titleTouched && suggested && suggested !== draft.title ? (
            <button type="button" className="text-accent" onClick={() => set({ titleTouched: false, title: "" })}>
              Use “{suggested}”
            </button>
          ) : (
            "Suggested from your choices — edit freely."
          )
        }
      >
        {(id) => <Input id={id} value={title} maxLength={120} onChange={(e) => set({ title: e.target.value, titleTouched: true })} placeholder={draft.metric === "custom" ? "e.g. No phone after 10 pm" : "Goal name"} aria-invalid={!!err("title") || undefined} />}
      </Field>
      <Field label="Notes (optional)">{(id) => <Textarea id={id} rows={2} maxLength={1000} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Why it matters, how you'll do it…" />}</Field>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-fg">
        <input type="checkbox" className="size-5 accent-[var(--accent)]" checked={draft.showOnDashboard} onChange={(e) => set({ showOnDashboard: e.target.checked })} />
        Show on the dashboard
      </label>

      {serverError ? <ErrorBanner error={serverError} /> : null}

      <div className="sticky bottom-0 -mx-5 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          <Check className="size-4" aria-hidden /> {init.mode === "edit" ? "Save changes" : "Create goal"}
        </Button>
      </div>
    </form>
  );
}

function ChooseStep({ ctx, category, onCategory, onPreset, onMetric }: { ctx: PresetCtx; category: GoalCategory | null; onCategory: (c: GoalCategory | null) => void; onPreset: (id: string) => void; onMetric: (m: string) => void }) {
  if (category) {
    const meta = CATEGORY_META[category];
    return (
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" className="self-start" onClick={() => onCategory(null)}>
          <ArrowLeft className="size-4" aria-hidden /> All goal types
        </Button>
        <h3 className="text-sm font-semibold text-fg">{meta.label}</h3>
        <ul className="flex flex-col gap-2">
          {METRICS.filter((m) => m.category === category).map((m) => (
            <li key={m.key}>
              <button type="button" onClick={() => onMetric(m.key)} className="flex min-h-14 w-full items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-left hover:border-accent/60 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-fg">{m.label}</span>
                  <span className="mt-0.5 block text-xs text-muted">{m.description}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="goal-presets">
        <h3 id="goal-presets" className="text-sm font-semibold text-fg">
          Quick start
        </h3>
        <p className="mb-2 text-xs text-muted">One tap fills everything in — you can adjust before saving.</p>
        <PresetGrid ctx={ctx} onPick={onPreset} />
      </section>
      <section aria-labelledby="goal-types">
        <h3 id="goal-types" className="mb-2 text-sm font-semibold text-fg">
          Or choose what to track
        </h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CATEGORY_ORDER.map((c) => {
            const meta = CATEGORY_META[c];
            const Icon = meta.icon;
            return (
              <button key={c} type="button" onClick={() => onCategory(c)} className="flex min-h-14 items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-left hover:border-accent/60 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2" style={{ color: meta.color }}>
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-fg">{meta.label}</span>
                  <span className="block truncate text-xs text-muted">{meta.blurb}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/** Preset buttons; also used by the empty state on the goals page. */
export function PresetGrid({ ctx, onPick, limit }: { ctx: PresetCtx; onPick: (id: string) => void; limit?: number }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {PRESETS.slice(0, limit).map((p) => {
        const meta = CATEGORY_META[p.category];
        const Icon = meta.icon;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p.id)}
            className="flex min-h-14 min-w-0 items-start gap-2 rounded-lg border border-line px-2.5 py-2 text-left hover:border-accent/60 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
          >
            <Icon className="mt-0.5 size-4 shrink-0" style={{ color: meta.color }} aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm leading-snug font-medium text-fg">{p.label(ctx)}</span>
              <span className="block text-[11px] leading-snug text-muted">{p.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ExercisePicker({
  label,
  required,
  value,
  valueName,
  query,
  onQuery,
  onPick,
  error,
}: {
  label: string;
  required: boolean;
  value: string;
  valueName: string;
  query: string;
  onQuery: (q: string) => void;
  onPick: (id: string, name: string) => void;
  error?: string;
}) {
  const q = useExercises();
  const all = useMemo(
    () => (q.data ?? []).filter((e) => !e.archived || e.id === value).sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || a.name.localeCompare(b.name)),
    [q.data, value],
  );
  const needle = query.trim().toLowerCase();
  const matches = needle ? all.filter((e) => e.name.toLowerCase().includes(needle)) : all;
  const shown = matches.slice(0, 60);
  const selected = all.find((e) => e.id === value);
  const listId = "goal-exercise-list";
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="goal-exercise-search" className="text-sm font-medium text-fg-2">
        {label}
      </label>
      <p className="text-xs text-fg">
        {value ? (
          <>
            Selected: <strong>{selected?.name || valueName || "Exercise"}</strong>
          </>
        ) : required ? (
          <span className="text-muted">Pick one below.</span>
        ) : (
          <span className="text-muted">All exercises — or pick one below.</span>
        )}
      </p>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input id="goal-exercise-search" type="search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search exercises" className="pl-9" aria-controls={listId} autoComplete="off" />
      </div>
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : q.error ? (
        <ErrorBanner error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <ul id={listId} role="listbox" aria-label="Exercises" className="max-h-56 overflow-y-auto rounded-lg border border-line">
          {!required && (
            <li role="option" aria-selected={!value}>
              <button type="button" onClick={() => onPick("", "")} className={cx("flex min-h-11 w-full items-center gap-2 border-b border-line px-3 text-left text-sm hover:bg-surface-2", !value && "bg-accent-soft text-accent")}>
                <span className="flex-1">All exercises</span>
                {!value && <Check className="size-4" aria-hidden />}
              </button>
            </li>
          )}
          {shown.map((e) => (
            <li key={e.id} role="option" aria-selected={e.id === value}>
              <button type="button" onClick={() => onPick(e.id, e.name)} className={cx("flex min-h-11 w-full items-center gap-2 border-b border-line px-3 text-left text-sm last:border-0 hover:bg-surface-2", e.id === value && "bg-accent-soft text-accent")}>
                {e.isFavorite && <Star className="size-3.5 shrink-0 fill-current text-[var(--serious)]" aria-label="Favorite" />}
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
                {e.setCount > 0 && <span className="shrink-0 text-xs text-muted tabular">{e.setCount} sets</span>}
                {e.id === value && <Check className="size-4 shrink-0" aria-hidden />}
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="px-3 py-3 text-sm text-muted">No exercises match “{query}”.</li>}
          {matches.length > shown.length && <li className="px-3 py-2 text-xs text-muted">{matches.length - shown.length} more — refine your search.</li>}
        </ul>
      )}
      {error && (
        <p className="text-xs text-critical" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

