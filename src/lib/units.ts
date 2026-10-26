export type WeightUnit = "kg" | "lb";

export const KG_PER_LB = 0.45359237;

export function toKg(value: number, unit: WeightUnit): number {
  return unit === "kg" ? value : value * KG_PER_LB;
}

export function fromKg(kg: number, unit: WeightUnit): number {
  return unit === "kg" ? kg : kg / KG_PER_LB;
}

export function formatWeight(kg: number | null | undefined, unit: WeightUnit, decimals = 1): string {
  if (kg == null || !Number.isFinite(kg)) return "—";
  return `${fromKg(kg, unit).toFixed(decimals)} ${unit}`;
}

/** Signed difference, e.g. "+0.4 lb" / "−1.2 lb". */
export function formatWeightDelta(kg: number | null | undefined, unit: WeightUnit, decimals = 1): string {
  if (kg == null || !Number.isFinite(kg)) return "—";
  const v = fromKg(kg, unit);
  const rounded = Number(v.toFixed(decimals));
  if (rounded === 0) return `±0 ${unit}`;
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(decimals)} ${unit}`;
}

export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
