"use client";

import { AlertTriangle, Database, Pencil, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { evaluateGoal } from "@/lib/nutrition/goals";
import { NUTRIENTS, NUTRIENT_BY_KEY, type NutrientKey, type NutrientProfile } from "@/lib/nutrition/nutrients";
import { fmtKcal, fmtNutrient } from "@/lib/format";
import { Badge, cx, Meter } from "./ui";

export const MACRO_COLORS: Record<"calories" | "protein" | "carbs" | "fat", string> = {
  calories: "var(--series-cal)",
  protein: "var(--series-1)",
  carbs: "var(--series-2)",
  fat: "var(--series-3)",
};

export function SourceBadge({ source }: { source: "database" | "ai_estimate" | "manual" }) {
  if (source === "database")
    return (
      <Badge tone="accent" title="Nutrient values from the USDA FoodData Central database">
        <Database className="size-3" aria-hidden /> Database
      </Badge>
    );
  if (source === "ai_estimate")
    return (
      <Badge tone="warning" title="Nutrient values estimated by AI — no database match was used">
        <Sparkles className="size-3" aria-hidden /> AI estimate
      </Badge>
    );
  return (
    <Badge tone="neutral" title="Values entered or corrected by you">
      <Pencil className="size-3" aria-hidden /> Manual
    </Badge>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: "high" | "medium" | "low" | null }) {
  if (!confidence) return null;
  const tone = confidence === "high" ? "good" : confidence === "medium" ? "outline" : "critical";
  const label = confidence === "high" ? "High confidence" : confidence === "medium" ? "Medium confidence" : "Low confidence";
  return (
    <Badge tone={tone} title="How sure the AI is about this food and its amount">
      {confidence === "low" && <AlertTriangle className="size-3" aria-hidden />}
      {label}
    </Badge>
  );
}

/** Compact "520 kcal · P 32 · C 40 · F 22" line. Text stays on text tokens; dots carry color. */
export function MacroLine({ values, incomplete = [], className }: { values: NutrientProfile; incomplete?: NutrientKey[]; className?: string }) {
  const item = (key: "protein" | "carbs" | "fat", label: string) => (
    <span className="inline-flex items-center gap-1">
      <span className="size-1.5 rounded-full" style={{ background: MACRO_COLORS[key] }} aria-hidden />
      <span className="text-muted">{label}</span>
      <span className="tabular">
        {fmtNutrient(key, values[key], false)}
        {incomplete.includes(key) ? "+" : ""}
      </span>
    </span>
  );
  return (
    <span className={cx("inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-2", className)}>
      <span className="font-semibold text-fg tabular">
        {fmtKcal(values.calories)}
        {incomplete.includes("calories") ? "+" : ""} kcal
      </span>
      {item("protein", "P")}
      {item("carbs", "C")}
      {item("fat", "F")}
    </span>
  );
}

/** Full nutrient table (expanded views). Unknown values show "—"; partial totals show "+". */
export function NutrientGrid({ values, incomplete = [], targets = {}, keys }: { values: NutrientProfile; incomplete?: NutrientKey[]; targets?: Partial<Record<NutrientKey, number>>; keys?: NutrientKey[] }) {
  const list = keys ? NUTRIENTS.filter((n) => keys.includes(n.key)) : NUTRIENTS;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
      {list.map((n) => {
        const v = values[n.key];
        const t = targets[n.key];
        return (
          <div key={n.key} className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 last:border-0">
            <dt className="text-fg-2">{n.label}</dt>
            <dd className="tabular text-right text-fg">
              {fmtNutrient(n.key, v)}
              {incomplete.includes(n.key) && v != null && (
                <span className="ml-1 text-xs text-muted" title="Some foods have no data for this nutrient, so the true total is likely higher">
                  (partial)
                </span>
              )}
              {t ? <span className="ml-1 text-xs text-muted">/ {fmtNutrient(n.key, t)}</span> : null}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Goal progress row: label, consumed / target, remaining, meter. */
export function GoalProgress({ nkey, value, target, incomplete }: { nkey: "calories" | "protein" | "carbs" | "fat"; value: number | null | undefined; target: number | undefined; incomplete?: boolean }) {
  const def = NUTRIENT_BY_KEY[nkey];
  const v = value ?? 0;
  const ev = target ? evaluateGoal(nkey, v, target) : null;
  const unit = def.unit === "kcal" ? "kcal" : "g";
  let remainingText: ReactNode = null;
  if (ev) {
    const rem = Math.round(ev.remaining);
    if (def.goalType === "min") remainingText = rem > 0 ? `${rem.toLocaleString()} ${unit} to go` : "Goal reached";
    else remainingText = rem >= 0 ? `${rem.toLocaleString()} ${unit} left` : `${Math.abs(rem).toLocaleString()} ${unit} over`;
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="inline-flex items-center gap-2 font-medium text-fg">
          <span className="size-2 rounded-full" style={{ background: MACRO_COLORS[nkey] }} aria-hidden />
          {def.label}
        </span>
        <span className="tabular text-fg-2">
          <span className="font-semibold text-fg">{Math.round(v).toLocaleString()}</span>
          {incomplete ? "+" : ""}
          {target ? ` / ${Math.round(target).toLocaleString()}` : ""} {unit}
        </span>
      </div>
      {target ? (
        <>
          <Meter value={v} max={target} color={MACRO_COLORS[nkey]} label={`${def.label} ${Math.round(v)} of ${Math.round(target)} ${unit}`} over={def.goalType !== "min" && ev?.status === "over"} />
          <span className={cx("text-xs", ev?.status === "over" && def.goalType !== "min" ? "text-critical" : "text-muted")}>
            {ev?.status === "over" && def.goalType !== "min" && <AlertTriangle className="mr-1 inline size-3" aria-hidden />}
            {remainingText}
          </span>
        </>
      ) : (
        <span className="text-xs text-muted">No goal set</span>
      )}
    </div>
  );
}
