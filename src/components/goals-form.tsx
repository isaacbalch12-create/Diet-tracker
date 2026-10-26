"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Calculator } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/client/api";
import type { SettingsResponse } from "@/lib/client/types";
import { ACTIVITY_FACTORS, AIMS, suggestTargets, type Activity, type Aim, type Sex } from "@/lib/nutrition/targets";
import { NUTRIENTS, SECONDARY_KEYS, type NutrientKey } from "@/lib/nutrition/nutrients";
import { fromKg, toKg } from "@/lib/units";
import { Button, ErrorBanner, Field, Input, Select } from "./ui";
import { useToast } from "./toast";

type GoalFields = Record<"calories" | "protein" | "carbs" | "fat", string> & { extra: Partial<Record<NutrientKey, string>> };

function Calculator_({ weightKg, unit, onUse }: { weightKg: number | null; unit: "kg" | "lb"; onUse: (s: { calories: number; protein: number; carbs: number; fat: number }) => void }) {
  const [f, setF] = useState({ sex: "male" as Sex, age: "35", height: "", heightUnit: unit === "lb" ? "in" : "cm", weight: weightKg ? fromKg(weightKg, unit).toFixed(1) : "", activity: "light" as Activity, aim: "maintain" as Aim });
  const heightCm = f.heightUnit === "in" ? Number(f.height) * 2.54 : Number(f.height);
  const valid = Number(f.age) >= 15 && Number(f.age) <= 100 && heightCm > 100 && heightCm < 250 && Number(f.weight) > 0;
  const s = valid ? suggestTargets({ sex: f.sex, age: Number(f.age), heightCm, weightKg: toKg(Number(f.weight), unit), activity: f.activity, aim: f.aim }) : null;
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface-2 p-4">
      <p className="text-sm text-fg-2">Optional starting point. Nothing is saved until you press “Save goals”.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Sex (for the equation)">
          {(id) => (
            <Select id={id} value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value as Sex })}>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </Select>
          )}
        </Field>
        <Field label="Age">{(id) => <Input id={id} inputMode="numeric" value={f.age} onChange={(e) => setF({ ...f, age: e.target.value })} />}</Field>
        <Field label={`Height (${f.heightUnit})`}>
          {(id) => (
            <div className="flex gap-1">
              <Input id={id} inputMode="decimal" value={f.height} onChange={(e) => setF({ ...f, height: e.target.value })} />
              <Select aria-label="Height unit" value={f.heightUnit} onChange={(e) => setF({ ...f, heightUnit: e.target.value })} className="w-20">
                <option value="in">in</option>
                <option value="cm">cm</option>
              </Select>
            </div>
          )}
        </Field>
        <Field label={`Weight (${unit})`}>{(id) => <Input id={id} inputMode="decimal" value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} />}</Field>
        <Field label="Activity">
          {(id) => (
            <Select id={id} value={f.activity} onChange={(e) => setF({ ...f, activity: e.target.value as Activity })}>
              {Object.entries(ACTIVITY_FACTORS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Aim">
          {(id) => (
            <Select id={id} value={f.aim} onChange={(e) => setF({ ...f, aim: e.target.value as Aim })}>
              {Object.entries(AIMS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {s && (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3 text-sm">
          <p className="text-fg">
            Estimated maintenance ≈ <strong>{s.maintenanceKcal.toLocaleString()} kcal</strong>. Suggested: <strong>{s.calories.toLocaleString()} kcal</strong>, protein {s.protein} g, carbs {s.carbs} g, fat {s.fat} g.
          </p>
          <ul className="list-disc pl-5 text-xs text-muted">
            {s.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          <div>
            <Button size="sm" variant="secondary" onClick={() => onUse(s)}>
              Use these numbers
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function GoalsForm({ data, onSaved }: { data: SettingsResponse; onSaved?: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const g = data.goals;
  const toStr = (v: number | null | undefined) => (v == null ? "" : String(v));
  const [f, setF] = useState<GoalFields>({
    calories: toStr(g?.calories),
    protein: toStr(g?.protein),
    carbs: toStr(g?.carbs),
    fat: toStr(g?.fat),
    extra: Object.fromEntries(Object.entries(g?.extra ?? {}).map(([k, v]) => [k, String(v)])),
  });
  const [showExtra, setShowExtra] = useState(Object.keys(g?.extra ?? {}).length > 0);
  const [showCalc, setShowCalc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const macroKcal = (num(f.protein) ?? 0) * 4 + (num(f.carbs) ?? 0) * 4 + (num(f.fat) ?? 0) * 9;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const extra: Partial<Record<NutrientKey, number>> = {};
      for (const [k, v] of Object.entries(f.extra)) if (v && Number(v) > 0) extra[k as NutrientKey] = Number(v);
      await api.post("/api/goals", { calories: num(f.calories), protein: num(f.protein), carbs: num(f.carbs), fat: num(f.fat), extra });
      await qc.invalidateQueries();
      toast.success("Goals saved — they apply from today onward");
      onSaved?.();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const latestKg = data.settings.startingWeightKg;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ["calories", "Calories (kcal)"],
            ["protein", "Protein (g)"],
            ["carbs", "Carbohydrates (g)"],
            ["fat", "Fat (g)"],
          ] as const
        ).map(([k, label]) => (
          <Field key={k} label={label}>
            {(id) => <Input id={id} inputMode="decimal" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder="No goal" />}
          </Field>
        ))}
      </div>
      {macroKcal > 0 && num(f.calories) && Math.abs(macroKcal - (num(f.calories) ?? 0)) > (num(f.calories) ?? 0) * 0.1 && (
        <p className="text-xs text-warning-text">Note: your macro goals add up to about {Math.round(macroKcal).toLocaleString()} kcal (4/4/9 kcal per g), which differs from the calorie goal.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onClick={() => setShowExtra(!showExtra)}>
          {showExtra ? "Hide other nutrient targets" : "Targets for other nutrients (optional)"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setShowCalc(!showCalc)}>
          <Calculator className="size-4" /> {showCalc ? "Hide calculator" : "Suggest targets"}
        </Button>
      </div>
      {showExtra && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {NUTRIENTS.filter((n) => SECONDARY_KEYS.includes(n.key)).map((n) => (
            <Field key={n.key} label={`${n.label} (${n.unit}) ${n.goalType === "max" ? "limit" : "min"}`}>
              {(id) => <Input id={id} inputMode="decimal" value={f.extra[n.key] ?? ""} onChange={(e) => setF({ ...f, extra: { ...f.extra, [n.key]: e.target.value } })} placeholder="—" />}
            </Field>
          ))}
        </div>
      )}
      {showCalc && <Calculator_ weightKg={latestKg} unit={data.settings.weightUnit} onUse={(s) => setF({ ...f, calories: String(s.calories), protein: String(s.protein), carbs: String(s.carbs), fat: String(s.fat) })} />}
      {error ? <ErrorBanner error={error} /> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} loading={saving}>
          Save goals
        </Button>
        <span className="text-xs text-muted">New goals apply from today. Past days keep the goals they had.</span>
      </div>
    </div>
  );
}
