import { NUTRIENT_BY_KEY, type NutrientKey } from "./nutrition/nutrients";

/** Display-only rounding; stored values keep full precision. */
export function fmtNutrient(key: NutrientKey, value: number | null | undefined, withUnit = true): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const def = NUTRIENT_BY_KEY[key];
  const decimals = value !== 0 && Math.abs(value) < 1 && def.decimals === 0 ? 1 : value >= 100 && def.unit !== "µg" ? 0 : def.decimals;
  const n = value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: Math.min(decimals, 1) });
  if (!withUnit) return n;
  return def.unit === "kcal" ? `${n} kcal` : `${n} ${def.unit}`;
}

export function fmtKcal(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString("en-US");
}

export function fmtG(v: number | null | undefined, decimals = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toLocaleString("en-US", { maximumFractionDigits: decimals })} g`;
}

export function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

export function fmtQty(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function fmtTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function fdcUrl(fdcId?: string | null): string | null {
  return fdcId ? `https://fdc.nal.usda.gov/food-details/${encodeURIComponent(fdcId)}/nutrients` : null;
}
