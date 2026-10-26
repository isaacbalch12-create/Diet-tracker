/**
 * Optional starting-point targets. These are population-level estimates
 * (Mifflin–St Jeor resting energy × an activity factor), not medical advice;
 * real needs vary by ±10–20%. Weight-loss suggestions are deliberately modest.
 */

export type Sex = "male" | "female";
export type Activity = "sedentary" | "light" | "moderate" | "very";
export type Aim = "maintain" | "lose_slow" | "lose" | "gain_slow";

export const ACTIVITY_FACTORS: Record<Activity, { factor: number; label: string }> = {
  sedentary: { factor: 1.2, label: "Mostly sitting, little exercise" },
  light: { factor: 1.375, label: "Light exercise 1–3 days/week" },
  moderate: { factor: 1.55, label: "Moderate exercise 3–5 days/week" },
  very: { factor: 1.725, label: "Hard exercise 6–7 days/week" },
};

export const AIMS: Record<Aim, { adjust: number; label: string }> = {
  maintain: { adjust: 0, label: "Maintain weight" },
  lose_slow: { adjust: -0.1, label: "Lose slowly (~10% below maintenance)" },
  lose: { adjust: -0.2, label: "Lose (~20% below maintenance, the most we suggest)" },
  gain_slow: { adjust: 0.1, label: "Gain slowly (~10% above maintenance)" },
};

export interface TargetInput {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: Activity;
  aim: Aim;
}

export interface TargetSuggestion {
  restingKcal: number;
  maintenanceKcal: number;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  floorApplied: boolean;
  assumptions: string[];
}

export function suggestTargets(i: TargetInput): TargetSuggestion {
  const resting = 10 * i.weightKg + 6.25 * i.heightCm - 5 * i.age + (i.sex === "male" ? 5 : -161);
  const maintenance = resting * ACTIVITY_FACTORS[i.activity].factor;
  let calories = maintenance * (1 + AIMS[i.aim].adjust);
  const floor = i.sex === "male" ? 1500 : 1200;
  const floorApplied = calories < floor;
  if (floorApplied) calories = floor;
  calories = Math.round(calories / 10) * 10;
  const protein = Math.round(i.weightKg * 1.6);
  const fat = Math.round((calories * 0.3) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  return {
    restingKcal: Math.round(resting),
    maintenanceKcal: Math.round(maintenance),
    calories,
    protein,
    fat,
    carbs,
    floorApplied,
    assumptions: [
      "Resting energy from the Mifflin–St Jeor equation, multiplied by your activity level. Individual needs commonly differ by 10–20%.",
      "Protein at 1.6 g per kg of body weight, a common evidence-based target for active adults.",
      "Fat at ~30% of calories; carbohydrates fill the rest.",
      floorApplied ? `Calories were raised to ${floor} kcal — suggestions never go below this.` : "Weight-loss suggestions are capped at 20% below estimated maintenance.",
      "After 2–4 weeks of consistent logging, compare your weight trend with your intake and adjust. Not medical advice — consult a professional if you have health conditions.",
    ],
  };
}
