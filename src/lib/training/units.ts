import { KG_PER_LB } from "../units";
import type { Unit } from "./types";

export { KG_PER_LB };

/**
 * The same plates entered in different units differ by a few grams after conversion
 * (100 kg vs 220.5 lb = 100.017 kg). Differences under 50 g are treated as equal when
 * deciding records, so unit switches never create phantom PRs.
 */
export const WEIGHT_TOLERANCE_KG = 0.05;

export function toKg(value: number, unit: Unit): number {
  return unit === "kg" ? value : value * KG_PER_LB;
}

export function fromKg(kg: number, unit: Unit): number {
  return unit === "kg" ? kg : kg / KG_PER_LB;
}

export function roundTo(value: number, decimals = 1): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Convert a stored kg value into the number shown in an input (0.1 lb / 0.01 kg precision). */
export function displayWeight(kg: number | null | undefined, unit: Unit): number | null {
  if (kg == null || !Number.isFinite(kg)) return null;
  return roundTo(fromKg(kg, unit), unit === "kg" ? 2 : 1);
}

const numberFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** "135 lb" / "61.2 kg". */
export function formatLift(kg: number | null | undefined, unit: Unit, opts: { withUnit?: boolean } = {}): string {
  const v = displayWeight(kg, unit);
  if (v == null) return "—";
  const text = numberFmt.format(roundTo(v, 1));
  return opts.withUnit === false ? text : `${text} ${unit}`;
}

/** Volume is always shown as a whole number: "1,480 lb". */
export function formatVolume(kg: number, unit: Unit, opts: { withUnit?: boolean; compact?: boolean } = {}): string {
  const v = fromKg(kg, unit);
  const text = opts.compact ? compactNumber(v) : intFmt.format(Math.round(v));
  return opts.withUnit === false ? text : `${text} ${unit}`;
}

export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${roundTo(value / 1_000_000, abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${roundTo(value / 1000, 0)}K`;
  if (abs >= 1000) return `${roundTo(value / 1000, 1)}K`;
  return intFmt.format(Math.round(value));
}

export function formatPercent(fraction: number, opts: { signed?: boolean; decimals?: number } = {}): string {
  const pct = roundTo(fraction * 100, opts.decimals ?? 1);
  const sign = opts.signed && pct > 0 ? "+" : "";
  return `${sign}${pct}%`;
}

/** Parse a user-typed number; returns null for blank or invalid input. Accepts a comma decimal separator. */
export function parseNumberInput(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
