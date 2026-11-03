/**
 * Display conversion for canonical values used by goals and statistics
 * (kg, meters, ml, minutes, fractions). Safe to import in client components.
 */
import type { CanonicalUnit } from "../goals/catalog";
import { formatSleepMinutes } from "../health/metrics";
import { fromMeters, toMeters, type DistanceUnit } from "../running/stats";
import { fromKg, toKg, type WeightUnit } from "../units";

export const ML_PER_OZ = 29.5735295625;

export interface UnitPrefs {
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
  waterUnit: "oz" | "ml";
}

export function fmtNum(v: number | null | undefined, decimals = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
}

export function fmtDistance(m: number | null | undefined, unit: DistanceUnit, decimals = 2): string {
  if (m == null || !Number.isFinite(m)) return "—";
  return `${fmtNum(fromMeters(m, unit), decimals)} ${unit}`;
}

export function fmtWater(ml: number | null | undefined, unit: "oz" | "ml"): string {
  if (ml == null || !Number.isFinite(ml)) return "—";
  return unit === "oz" ? `${fmtNum(ml / ML_PER_OZ, 0)} oz` : `${fmtNum(ml, 0)} ml`;
}

/** The label shown next to a goal value in the user's units. */
export function displayUnit(unit: CanonicalUnit, p: UnitPrefs, custom?: string | null): string {
  switch (unit) {
    case "kg":
      return p.weightUnit;
    case "kg_per_week":
      return `${p.weightUnit}/week`;
    case "m":
      return p.distanceUnit;
    case "ml":
      return p.waterUnit;
    case "min":
      return "hours";
    case "fraction":
      return "%";
    case "custom":
      return custom || "";
    default:
      return unit;
  }
}

/** Canonical → number shown in inputs. */
export function toDisplay(value: number, unit: CanonicalUnit, p: UnitPrefs): number {
  switch (unit) {
    case "kg":
    case "kg_per_week":
      return fromKg(value, p.weightUnit);
    case "m":
      return fromMeters(value, p.distanceUnit);
    case "ml":
      return p.waterUnit === "oz" ? value / ML_PER_OZ : value;
    case "min":
      return value / 60;
    case "fraction":
      return value * 100;
    default:
      return value;
  }
}

/** Number typed in an input → canonical. */
export function fromDisplay(value: number, unit: CanonicalUnit, p: UnitPrefs): number {
  switch (unit) {
    case "kg":
    case "kg_per_week":
      return toKg(value, p.weightUnit);
    case "m":
      return toMeters(value, p.distanceUnit);
    case "ml":
      return p.waterUnit === "oz" ? value * ML_PER_OZ : value;
    case "min":
      return value * 60;
    case "fraction":
      return value / 100;
    default:
      return value;
  }
}

const DECIMALS: Partial<Record<CanonicalUnit, number>> = { kg: 1, kg_per_week: 2, m: 1, min: 1, fraction: 0, "µg": 1, mg: 0, g: 0, kcal: 0, ml: 0 };

/** "182.4 lb", "7h 30m", "85%", "12,000 steps". */
export function fmtGoalValue(value: number | null | undefined, unit: CanonicalUnit, p: UnitPrefs, custom?: string | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (unit === "min") return formatSleepMinutes(value);
  if (unit === "fraction") return `${Math.round(value * 100)}%`;
  const v = toDisplay(value, unit, p);
  const label = displayUnit(unit, p, custom);
  const d = DECIMALS[unit] ?? (Math.abs(v) < 10 && v % 1 !== 0 ? 1 : 0);
  const sign = unit === "kg_per_week" && v > 0 ? "+" : "";
  return `${sign}${fmtNum(v, d)}${label ? ` ${label}` : ""}`;
}
