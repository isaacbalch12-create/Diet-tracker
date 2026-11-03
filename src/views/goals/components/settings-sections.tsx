"use client";

import { useQueryClient } from "@tanstack/react-query";
import { History, Scale, UtensilsCrossed } from "lucide-react";
import { useState } from "react";
import { GoalsForm } from "@/components/goals-form";
import { useToast } from "@/components/toast";
import { Button, Card, CardTitle, Field, Input } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useInvalidateData } from "@/lib/client/hooks";
import type { SettingsResponse } from "@/lib/client/types";
import { NUTRIENT_BY_KEY, type NutrientKey } from "@/lib/nutrition/nutrients";
import { formatLocalDate } from "@/lib/time";
import { fromKg } from "@/lib/units";

/** Daily nutrition targets (versioned), edited with the shared GoalsForm. */
export function NutritionTargetsSection({ data }: { data: SettingsResponse }) {
  const history = [...data.goalHistory].reverse();
  return (
    <Card id="nutrition-targets" className="scroll-mt-20">
      <CardTitle sub="Leave a field blank for no target. Calories, carbs and fat count as met within ±10% of the target; protein when at or above it. Each target also appears as a linked goal above.">
        <span className="inline-flex items-center gap-2">
          <UtensilsCrossed className="size-4 text-[var(--series-cal)]" aria-hidden /> Daily nutrition targets
        </span>
      </CardTitle>
      <GoalsForm data={data} key={JSON.stringify(data.goals)} />
      {history.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-fg-2">
            <History className="size-4" aria-hidden /> Target history ({history.length} version{history.length === 1 ? "" : "s"})
          </summary>
          <ul className="mt-1 flex flex-col divide-y divide-line rounded-lg border border-line text-fg-2 tabular">
            {history.map((g) => {
              const extras = Object.entries(g.extra ?? {}).filter(([, v]) => typeof v === "number" && v > 0);
              return (
                <li key={g.effectiveFrom} className="flex flex-col gap-0.5 px-3 py-2">
                  <span className="text-xs font-medium text-muted">{g.effectiveFrom === "2000-01-01" ? "Initial" : `From ${formatLocalDate(g.effectiveFrom, { month: "short", day: "numeric", year: "numeric" })}`}</span>
                  <span className="text-fg">
                    {g.calories ?? "—"} kcal · Protein {g.protein ?? "—"} g · Carbs {g.carbs ?? "—"} g · Fat {g.fat ?? "—"} g
                  </span>
                  {extras.length > 0 && (
                    <span className="text-xs">
                      {extras
                        .map(([k, v]) => {
                          const n = NUTRIENT_BY_KEY[k as NutrientKey];
                          return n ? `${n.label} ${v} ${n.unit}` : `${k} ${v}`;
                        })
                        .join(" · ")}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </Card>
  );
}

/** Starting and target body weight, in the user's weight unit (same behavior as Settings). */
export function WeightGoalsSection({ data }: { data: SettingsResponse }) {
  const toast = useToast();
  const qc = useQueryClient();
  const invalidate = useInvalidateData();
  const s = data.settings;
  const unit = s.weightUnit;
  const show = (kg: number | null) => (kg == null ? "" : String(Number(fromKg(kg, unit).toFixed(1))));
  const [start, setStart] = useState(show(s.startingWeightKg));
  const [startDate, setStartDate] = useState(s.startingWeightDate ?? data.today);
  const [target, setTarget] = useState(show(s.targetWeightKg));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ start?: string; target?: string; date?: string }>({});

  const parse = (v: string) => {
    const t = v.trim().replace(",", ".");
    return t === "" ? null : Number(t);
  };

  const save = async () => {
    const a = parse(start);
    const b = parse(target);
    const e: typeof errors = {};
    if (a != null && (!Number.isFinite(a) || a <= 0)) e.start = "Enter a weight, or leave blank";
    if (b != null && (!Number.isFinite(b) || b <= 0)) e.target = "Enter a weight, or leave blank";
    if (a != null && !startDate) e.date = "Choose the starting date";
    if (startDate && startDate > data.today) e.date = "The starting date can't be in the future";
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      await api.patch("/api/settings", {
        startingWeight: a != null ? { value: a, unit, date: startDate } : null,
        targetWeight: b != null ? { value: b, unit } : null,
      });
      await invalidate();
      await qc.invalidateQueries();
      toast.success("Weight goals saved");
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card id="weight-goals" className="scroll-mt-20">
      <CardTitle sub="Used for “change since start” and “to target”. The target also appears as a linked goal above, compared with your 7-day average. Leave blank if not applicable.">
        <span className="inline-flex items-center gap-2">
          <Scale className="size-4 text-[var(--series-1)]" aria-hidden /> Weight goals
        </span>
      </CardTitle>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label={`Starting weight (${unit})`} error={errors.start}>
            {(id) => <Input id={id} inputMode="decimal" value={start} onChange={(e) => setStart(e.target.value)} placeholder="Optional" aria-invalid={!!errors.start || undefined} />}
          </Field>
          <Field label="Starting date" error={errors.date}>
            {(id) => <Input id={id} type="date" value={startDate} max={data.today} onChange={(e) => setStartDate(e.target.value)} aria-invalid={!!errors.date || undefined} />}
          </Field>
          <Field label={`Target weight (${unit})`} error={errors.target} className="col-span-2 sm:col-span-1">
            {(id) => <Input id={id} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Optional" aria-invalid={!!errors.target || undefined} />}
          </Field>
        </div>
        <Button type="submit" className="mt-4" loading={saving}>
          Save weight goals
        </Button>
      </form>
    </Card>
  );
}
