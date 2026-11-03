import type { OneRmFormula } from './types';

/**
 * Estimated one-rep max.
 *
 * Epley:   1RM = w × (1 + reps / 30)
 * Brzycki: 1RM = w × 36 / (37 − reps)
 *
 * A single is its own 1RM (no estimate). Estimates get less reliable as reps rise,
 * so every estimate carries a confidence band and sets above `maxReps` are excluded
 * from records and trends entirely.
 */
export function estimate1RM(weightKg: number, reps: number, formula: OneRmFormula = 'epley'): number | null {
  if (!Number.isFinite(weightKg) || !Number.isFinite(reps) || weightKg <= 0 || reps < 1) return null;
  if (reps === 1) return weightKg;
  if (formula === 'brzycki') {
    if (reps >= 37) return null;
    return (weightKg * 36) / (37 - reps);
  }
  return weightKg * (1 + reps / 30);
}

export type EstimateConfidence = 'actual' | 'high' | 'moderate' | 'low' | 'excluded';

export function estimateConfidence(reps: number, maxReps: number): EstimateConfidence {
  if (reps > maxReps) return 'excluded';
  if (reps <= 1) return 'actual';
  if (reps <= 5) return 'high';
  if (reps <= 10) return 'moderate';
  return 'low';
}

export const CONFIDENCE_LABEL: Record<EstimateConfidence, string> = {
  actual: 'Actual single',
  high: 'High confidence (2–5 reps)',
  moderate: 'Moderate confidence (6–10 reps)',
  low: 'Low confidence (11+ reps)',
  excluded: 'Not used — too many reps for a reliable estimate',
};

/** An estimate usable for records and trends (i.e. not excluded by the rep cap). */
export function eligible1RM(weightKg: number, reps: number, formula: OneRmFormula, maxReps: number): number | null {
  if (reps > maxReps) return null;
  return estimate1RM(weightKg, reps, formula);
}

export const FORMULA_LABEL: Record<OneRmFormula, string> = {
  epley: 'Epley — weight × (1 + reps ÷ 30)',
  brzycki: 'Brzycki — weight × 36 ÷ (37 − reps)',
};
