/**
 * Read-only data tools for the nutrition assistant, plus the confirmation-gated
 * `propose_action`. Every number the assistant reports should come from here.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Db } from "../db";
import { assistantActions, type AssistantActionType, type Settings } from "../db/schema";
import { goalForDate, goalTargets, describeGoalRule } from "../nutrition/goals";
import { NUTRIENTS, PRIMARY_KEYS, type NutrientKey } from "../nutrition/nutrients";
import { proteinPer100Kcal } from "../nutrition/calc";
import { addDays, dayOfWeek, diffDays, isLocalDate, type LocalDate } from "../time";
import { fromKg, type WeightUnit } from "../units";
import { summarizeNutrition } from "../analytics/nutrition";
import { analyzeRelationship } from "../analytics/relationship";
import { dailySeries } from "../weight/stats";
import { getMeal, listMeals, type MealView } from "../services/meals";
import { listGoals, toGoalVersion } from "../services/settings";
import { daySummary, nutritionDays } from "../services/stats";
import { listWeights, weightOverview } from "../services/weights";
import { AppError } from "../errors";

export interface ToolContext {
  db: Db;
  settings: Settings;
  today: LocalDate;
  conversationId: string | null;
}

const r0 = (v: number | null | undefined) => (v == null ? null : Math.round(v));
const r1 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10) / 10);
const r2 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100) / 100);
const pct = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100));

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function w(kg: number | null | undefined, unit: WeightUnit) {
  return kg == null ? null : r2(fromKg(kg, unit));
}

const dateField = { type: "string", description: "YYYY-MM-DD" } as const;
const rangeProps = { start_date: dateField, end_date: dateField };

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]): Anthropic.Beta.BetaTool {
  return {
    name,
    description,
    strict: true,
    eager_input_streaming: true,
    input_schema: { type: "object", properties, required, additionalProperties: false },
  };
}

export const ASSISTANT_TOOLS: Anthropic.Beta.BetaTool[] = [
  tool("get_day", "One day's food log: every meal with its foods and amounts, the day's nutrient totals vs. goals, and morning/night weigh-ins.", { date: dateField }, ["date"]),
  tool(
    "get_meals",
    "List logged meals in a date range (newest first, at most 150) with per-meal calories/macros and food names. Optional case-insensitive text filter on meal titles, descriptions and food names.",
    { ...rangeProps, search: { anyOf: [{ type: "string" }, { type: "null" }] } },
    ["start_date", "end_date", "search"],
  ),
  tool(
    "get_nutrition_stats",
    "Nutrition statistics for a date range: logged days vs. total days, average daily intake of every tracked nutrient (over logged days only), highest/lowest calorie and protein days, goal adherence, average meals per day, weekly averages with week-over-week changes, meal-category composition, logging streaks and day-to-day variability.",
    rangeProps,
    ["start_date", "end_date"],
  ),
  tool(
    "get_weight_stats",
    "Weight statistics for a date range, in the user's unit: latest readings, 7-day average, changes vs. previous day/week/month and since the starting weight, weekly and monthly averages, linear trend per week, average morning→night fluctuation, and how many days are missing weigh-ins.",
    rangeProps,
    ["start_date", "end_date"],
  ),
  tool(
    "get_food_rankings",
    "Rank foods or meals over a date range. sort_by: 'frequency' (most often eaten), 'protein_per_100kcal' (protein density — best protein for the calories; ignores items under 50 kcal), 'protein' (total protein contributed), or 'calories' (total calories contributed).",
    {
      ...rangeProps,
      level: { type: "string", enum: ["food", "meal"] },
      sort_by: { type: "string", enum: ["frequency", "protein_per_100kcal", "protein", "calories"] },
      limit: { type: "integer", description: "1–25" },
    },
    ["start_date", "end_date", "level", "sort_by", "limit"],
  ),
  tool(
    "compare_periods",
    "Compare two date ranges side by side: logged days, average calories/macros/fiber/sodium/sugar, goal adherence, and average weight / weight change in each period.",
    { a_start: dateField, a_end: dateField, b_start: dateField, b_end: dateField },
    ["a_start", "a_end", "b_start", "b_end"],
  ),
  tool("get_goals_and_settings", "The user's current nutrition goals (and how each is judged), goal history, starting/target weight, unit and time-zone settings.", {}, []),
  tool(
    "get_weight_nutrition_relationship",
    "Weekly pairs of average calories, average protein and average weight for a range, the correlation between weekly calories and the next week's weight change, a rough maintenance-calorie estimate when data allow, and pre-written caveated observations.",
    rangeProps,
    ["start_date", "end_date"],
  ),
  tool(
    "propose_action",
    "Propose a change to the user's records. Nothing is changed until the user presses Confirm in the app. Use for: log_weight (weight_value, weight_unit, period, optional date), update_goals (any of calories/protein/carbs/fat; omitted ones keep their current value), delete_meal (meal_id), delete_weight_entry (weight_entry_id), open_food_logger (food_text — opens the food logger prefilled so the user can review an AI estimate). Set unused fields to null.",
    {
      action: { type: "string", enum: ["log_weight", "update_goals", "delete_meal", "delete_weight_entry", "open_food_logger"] },
      summary: { type: "string", description: "One sentence describing the change for the confirmation button." },
      weight_value: { anyOf: [{ type: "number" }, { type: "null" }] },
      weight_unit: { anyOf: [{ type: "string", enum: ["kg", "lb"] }, { type: "null" }] },
      period: { anyOf: [{ type: "string", enum: ["morning", "night"] }, { type: "null" }] },
      date: { anyOf: [dateField, { type: "null" }] },
      meal_id: { anyOf: [{ type: "string" }, { type: "null" }] },
      weight_entry_id: { anyOf: [{ type: "string" }, { type: "null" }] },
      calories: { anyOf: [{ type: "number" }, { type: "null" }] },
      protein: { anyOf: [{ type: "number" }, { type: "null" }] },
      carbs: { anyOf: [{ type: "number" }, { type: "null" }] },
      fat: { anyOf: [{ type: "number" }, { type: "null" }] },
      food_text: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
    ["action", "summary", "weight_value", "weight_unit", "period", "date", "meal_id", "weight_entry_id", "calories", "protein", "carbs", "fat", "food_text"],
  ),
];

const dateS = z.string().refine(isLocalDate, "Invalid date (use YYYY-MM-DD)");
const rangeS = z
  .object({ start_date: dateS, end_date: dateS })
  .refine((r) => r.start_date <= r.end_date, "start_date must be on or before end_date")
  .refine((r) => diffDays(r.start_date, r.end_date) <= 3 * 366, "Range is limited to 3 years");

function mealBrief(m: MealView) {
  return {
    meal_id: m.id,
    date: m.localDate,
    time: new Intl.DateTimeFormat("en-US", { timeZone: m.timezone, hour: "numeric", minute: "2-digit" }).format(m.eatenAt),
    category: m.category,
    title: m.title,
    calories: r0(m.totals.values.calories),
    protein_g: r0(m.totals.values.protein),
    carbs_g: r0(m.totals.values.carbs),
    fat_g: r0(m.totals.values.fat),
    foods: m.items.map((i) => `${i.name} (${r0(i.grams)} g)`),
  };
}

async function nutritionStats(ctx: ToolContext, start: LocalDate, end: LocalDate) {
  const [days, goals] = await Promise.all([nutritionDays(ctx.db, { start: addDays(start, -7), end }), listGoals(ctx.db)]);
  const s = summarizeNutrition(days, { start, end }, goals.map(toGoalVersion), { weekStartsOn: ctx.settings.weekStartsOn });
  const averages: Record<string, unknown> = {};
  for (const n of NUTRIENTS) {
    const a = s.averages[n.key];
    if (a.value === null) continue;
    averages[`${n.key}_${n.unit}`] = n.unit === "kcal" || n.unit === "mg" ? r0(a.value) : r1(a.value);
    if (a.days < s.range.loggedDays) averages[`${n.key}_days_with_data`] = a.days;
  }
  const adherence: Record<string, unknown> = {};
  for (const [k, a] of Object.entries(s.adherence)) if (a) adherence[k] = { days_met: a.met, days_evaluated: a.evaluated, pct: pct(a.pct), rule: describeGoalRule(k as NutrientKey) };
  return {
    range: { start, end },
    logged_days: s.range.loggedDays,
    total_days: s.range.totalDays,
    note: s.range.loggedDays === 0 ? "No meals logged in this range." : "Averages use logged days only; unlogged days are missing data, not zero.",
    average_daily: averages,
    highest_calorie_day: s.extremes.calories.highest && { date: s.extremes.calories.highest.date, calories: r0(s.extremes.calories.highest.value) },
    lowest_calorie_day: s.extremes.calories.lowest && { date: s.extremes.calories.lowest.date, calories: r0(s.extremes.calories.lowest.value) },
    highest_protein_day: s.extremes.protein.highest && { date: s.extremes.protein.highest.date, protein_g: r0(s.extremes.protein.highest.value) },
    lowest_protein_day: s.extremes.protein.lowest && { date: s.extremes.protein.lowest.date, protein_g: r0(s.extremes.protein.lowest.value) },
    avg_meals_per_logged_day: r1(s.avgMealsPerDay),
    goal_adherence: adherence,
    pct_days_all_primary_goals_met: pct(s.allPrimaryMetPct),
    weekly: s.weekly.map((wk) => ({ week_start: wk.weekStart, logged_days: wk.loggedDays, calories: r0(wk.calories), protein_g: r0(wk.protein), carbs_g: r0(wk.carbs), fat_g: r0(wk.fat), calories_change_vs_prev_week: r0(wk.caloriesChange) })),
    meal_categories: s.categories.map((c) => ({ category: c.category, meals: c.meals, avg_calories_per_logged_day: r0(c.avgCalories), share_of_calories_pct: pct(c.pctCalories), share_of_protein_pct: pct(c.pctProtein) })),
    logging: { current_streak_days: s.consistency.currentStreak, longest_streak_days: s.consistency.longestStreak, pct_days_logged: pct(s.consistency.pct) },
    variability: { avg_abs_day_to_day_calorie_change: r0(s.variability.avgAbsDayToDayCalories), sd_daily_calories: r0(s.variability.sdCalories) },
    calorie_trend_kcal_per_day_change_per_week: r0(s.calorieTrendPerWeek),
  };
}

async function weightStats(ctx: ToolContext, start: LocalDate, end: LocalDate) {
  const unit = ctx.settings.weightUnit;
  const ov = await weightOverview(ctx.db, { start, end }, ctx.settings, ctx.today);
  const sm = ov.summary;
  const chg = (c: { value: number | null; reason?: string }) => (c.value === null ? { value: null, reason: c.reason } : { value: w(c.value, unit) });
  return {
    unit,
    range: { start, end },
    days_with_weigh_ins: ov.loggedDays,
    total_days: ov.totalDays,
    days_missing_morning: ov.missing.filter((m) => m.missingMorning).length,
    days_missing_night: ov.missing.filter((m) => m.missingNight).length,
    definitions: "Daily average = mean of morning & night (or the single reading). 7-day average = mean of daily averages over the trailing 7 days (needs ≥3). Week/month changes compare 7-day averages.",
    latest: { date: sm.latestDate, daily_average: w(sm.latestDaily, unit), morning: sm.latestMorning && { date: sm.latestMorning.date, value: w(sm.latestMorning.value, unit) }, night: sm.latestNight && { date: sm.latestNight.date, value: w(sm.latestNight.value, unit) } },
    current_7_day_average: w(sm.current7DayAverage, unit),
    change_vs_previous_day: chg(sm.changeVsPreviousDay),
    change_vs_previous_week: chg(sm.changeVsPreviousWeek),
    change_vs_previous_month: chg(sm.changeVsPreviousMonth),
    change_since_start: chg(sm.changeFromStart),
    remaining_to_target: w(sm.toTarget, unit),
    avg_night_minus_morning: w(sm.averageFluctuation, unit),
    trend_in_range: ov.trend ? { per_week: w(ov.trend.slopePerWeek, unit), r_squared: r2(ov.trend.r2), days_used: ov.trend.n } : "Not enough weigh-ins in range for a trend (need 5+ days).",
    weekly_averages: ov.weekly.filter((x) => x.average !== null).map((x) => ({ week_start: x.start, average: w(x.average, unit), days: x.days })),
    monthly_averages: ov.monthly.filter((x) => x.average !== null).map((x) => ({ month: x.key, average: w(x.average, unit), days: x.days })),
    daily: ov.days.length <= 62 ? ov.days.filter((d) => d.average !== null).map((d) => ({ date: d.date, morning: w(d.morning, unit), night: w(d.night, unit), avg: w(d.average, unit) })) : "Omitted for long ranges — use weekly/monthly averages.",
  };
}

async function foodRankings(ctx: ToolContext, input: { start_date: string; end_date: string; level: "food" | "meal"; sort_by: string; limit: number }) {
  const meals = await listMeals(ctx.db, { start: input.start_date, end: input.end_date });
  type Agg = { name: string; count: number; calories: number; protein: number; examples: Set<string> };
  const groups = new Map<string, Agg>();
  const add = (key: string, name: string, kcal: number | null | undefined, prot: number | null | undefined, example: string) => {
    const g = groups.get(key) ?? { name, count: 0, calories: 0, protein: 0, examples: new Set<string>() };
    g.count += 1;
    g.calories += kcal ?? 0;
    g.protein += prot ?? 0;
    if (g.examples.size < 3) g.examples.add(example);
    groups.set(key, g);
  };
  for (const m of meals) {
    if (input.level === "meal") add(m.title.trim().toLowerCase(), m.title, m.totals.values.calories, m.totals.values.protein, m.localDate);
    else for (const i of m.items) add(i.name.trim().toLowerCase(), i.name, i.nutrients.calories, i.nutrients.protein, m.localDate);
  }
  let rows = [...groups.values()].map((g) => ({
    name: g.name,
    times_logged: g.count,
    total_calories: r0(g.calories),
    total_protein_g: r0(g.protein),
    avg_calories: r0(g.calories / g.count),
    avg_protein_g: r1(g.protein / g.count),
    protein_per_100kcal: r1(proteinPer100Kcal({ protein: g.protein, calories: g.calories })),
    example_dates: [...g.examples],
  }));
  if (input.sort_by === "protein_per_100kcal") rows = rows.filter((r) => (r.avg_calories ?? 0) >= 50 && r.protein_per_100kcal !== null);
  const key = { frequency: "times_logged", protein_per_100kcal: "protein_per_100kcal", protein: "total_protein_g", calories: "total_calories" }[input.sort_by] as keyof (typeof rows)[number];
  rows.sort((a, b) => Number(b[key] ?? 0) - Number(a[key] ?? 0));
  return { range: { start: input.start_date, end: input.end_date }, level: input.level, sort_by: input.sort_by, meals_in_range: meals.length, results: rows.slice(0, Math.min(Math.max(input.limit, 1), 25)) };
}

async function comparePeriod(ctx: ToolContext, start: LocalDate, end: LocalDate) {
  const n = await nutritionStats(ctx, start, end);
  const weights = await listWeights(ctx.db, { start, end });
  const days = dailySeries(weights.map((x) => ({ localDate: x.localDate, period: x.period, weightKg: x.weightKg })), start, end).filter((d) => d.average !== null);
  const avgW = days.length ? days.reduce((a, d) => a + (d.average as number), 0) / days.length : null;
  return {
    range: { start, end },
    logged_days: n.logged_days,
    total_days: n.total_days,
    average_daily: n.average_daily,
    goal_adherence: n.goal_adherence,
    weight: {
      unit: ctx.settings.weightUnit,
      days_with_weigh_ins: days.length,
      average: w(avgW, ctx.settings.weightUnit),
      first_to_last_change: days.length >= 2 ? w((days.at(-1)!.average as number) - (days[0].average as number), ctx.settings.weightUnit) : null,
    },
  };
}

async function proposeAction(ctx: ToolContext, raw: Record<string, unknown>) {
  const input = z
    .object({
      action: z.enum(["log_weight", "update_goals", "delete_meal", "delete_weight_entry", "open_food_logger"]),
      summary: z.string().min(1).max(300),
      weight_value: z.number().positive().max(1500).nullable(),
      weight_unit: z.enum(["kg", "lb"]).nullable(),
      period: z.enum(["morning", "night"]).nullable(),
      date: dateS.nullable(),
      meal_id: z.string().nullable(),
      weight_entry_id: z.string().nullable(),
      calories: z.number().positive().max(20000).nullable(),
      protein: z.number().positive().max(2000).nullable(),
      carbs: z.number().positive().max(3000).nullable(),
      fat: z.number().positive().max(1000).nullable(),
      food_text: z.string().max(2000).nullable(),
    })
    .parse(raw);
  let payload: Record<string, unknown>;
  switch (input.action) {
    case "log_weight":
      if (!input.weight_value || !input.period) throw new AppError(400, "invalid_action", "log_weight needs weight_value and period");
      payload = { value: input.weight_value, unit: input.weight_unit ?? ctx.settings.weightUnit, period: input.period, localDate: input.date ?? ctx.today };
      break;
    case "update_goals": {
      const current = goalTargets(goalForDate((await listGoals(ctx.db)).map(toGoalVersion), ctx.today));
      payload = {
        calories: input.calories ?? current.calories ?? null,
        protein: input.protein ?? current.protein ?? null,
        carbs: input.carbs ?? current.carbs ?? null,
        fat: input.fat ?? current.fat ?? null,
      };
      break;
    }
    case "delete_meal": {
      const meal = await getMeal(ctx.db, z.uuid().parse(input.meal_id));
      payload = { mealId: meal.id, title: meal.title, date: meal.localDate };
      break;
    }
    case "delete_weight_entry": {
      const id = z.uuid().parse(input.weight_entry_id);
      const all = await listWeights(ctx.db);
      const entry = all.find((x) => x.id === id);
      if (!entry) throw new AppError(404, "not_found", "Weight entry not found");
      payload = { weightEntryId: id, date: entry.localDate, period: entry.period };
      break;
    }
    case "open_food_logger":
      if (!input.food_text) throw new AppError(400, "invalid_action", "open_food_logger needs food_text");
      payload = { text: input.food_text, date: input.date };
      break;
  }
  const [row] = await ctx.db
    .insert(assistantActions)
    .values({ conversationId: ctx.conversationId, type: input.action as AssistantActionType, payload, summary: input.summary })
    .returning();
  return {
    action_id: row.id,
    status: "awaiting_user_confirmation",
    message: "The app now shows the user a Confirm / Dismiss button for this change. Nothing has been changed yet — tell the user to confirm it.",
    _action: row,
  };
}

/** Execute one tool call. Errors are returned to the model as tool errors. */
export async function runAssistantTool(ctx: ToolContext, name: string, input: unknown): Promise<unknown> {
  const raw = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "get_day": {
      const date = dateS.parse(raw.date);
      const d = await daySummary(ctx.db, date);
      const unit = ctx.settings.weightUnit;
      const totals: Record<string, unknown> = {};
      for (const n of NUTRIENTS) {
        const v = d.totals.values[n.key];
        if (v != null) totals[`${n.key}_${n.unit}`] = n.unit === "kcal" || n.unit === "mg" ? r0(v) : r1(v);
      }
      return {
        date,
        weekday: WEEKDAYS[dayOfWeek(date)],
        meals_logged: d.meals.length,
        totals: d.meals.length ? totals : "No meals logged on this day.",
        incomplete_nutrients: d.totals.incomplete.length ? d.totals.incomplete : undefined,
        goals: Object.fromEntries(
          Object.entries(d.evaluations).map(([k, e]) => [k, { target: r0(e!.target), consumed: r1(e!.value), remaining: r1(e!.remaining), status: e!.status }]),
        ),
        meals: d.meals.map((m) => ({ ...mealBrief(m), foods: m.items.map((i) => ({ name: i.name, amount: `${r1(i.quantity)} × ${i.unit} (${r0(i.grams)} g)`, calories: r0(i.nutrients.calories), protein_g: r1(i.nutrients.protein), data_source: i.nutrientSource })) })),
        weigh_ins: { unit, morning: w(d.weights.morning?.weightKg, unit), night: w(d.weights.night?.weightKg, unit) },
      };
    }
    case "get_meals": {
      const r = rangeS.parse(raw);
      const search = typeof raw.search === "string" && raw.search.trim() ? raw.search.trim().toLowerCase() : null;
      let meals = await listMeals(ctx.db, { start: r.start_date, end: r.end_date });
      if (search) meals = meals.filter((m) => [m.title, m.description ?? "", ...m.items.map((i) => i.name)].some((t) => t.toLowerCase().includes(search)));
      meals.sort((a, b) => b.eatenAt.getTime() - a.eatenAt.getTime());
      return { range: { start: r.start_date, end: r.end_date }, total_matching: meals.length, meals: meals.slice(0, 150).map(mealBrief) };
    }
    case "get_nutrition_stats": {
      const r = rangeS.parse(raw);
      return nutritionStats(ctx, r.start_date, r.end_date);
    }
    case "get_weight_stats": {
      const r = rangeS.parse(raw);
      return weightStats(ctx, r.start_date, r.end_date);
    }
    case "get_food_rankings": {
      const r = rangeS.parse(raw);
      const extra = z.object({ level: z.enum(["food", "meal"]), sort_by: z.enum(["frequency", "protein_per_100kcal", "protein", "calories"]), limit: z.number().int() }).parse(raw);
      return foodRankings(ctx, { ...r, ...extra });
    }
    case "compare_periods": {
      const a = rangeS.parse({ start_date: raw.a_start, end_date: raw.a_end });
      const b = rangeS.parse({ start_date: raw.b_start, end_date: raw.b_end });
      return { period_a: await comparePeriod(ctx, a.start_date, a.end_date), period_b: await comparePeriod(ctx, b.start_date, b.end_date) };
    }
    case "get_goals_and_settings": {
      const goals = (await listGoals(ctx.db)).map(toGoalVersion);
      const current = goalTargets(goalForDate(goals, ctx.today));
      const unit = ctx.settings.weightUnit;
      return {
        today: ctx.today,
        current_goals: Object.fromEntries(Object.entries(current).map(([k, v]) => [k, { target: v, rule: describeGoalRule(k as NutrientKey) }])),
        primary_goals_set: PRIMARY_KEYS.filter((k) => current[k] !== undefined),
        goal_history: goals.map((g) => ({ effective_from: g.effectiveFrom === "2000-01-01" ? "start" : g.effectiveFrom, calories: g.calories, protein: g.protein, carbs: g.carbs, fat: g.fat })),
        weight_unit: unit,
        starting_weight: w(ctx.settings.startingWeightKg, unit),
        starting_weight_date: ctx.settings.startingWeightDate,
        target_weight: w(ctx.settings.targetWeightKg, unit),
        timezone: ctx.settings.timezone,
        meal_categories: ctx.settings.mealCategories,
      };
    }
    case "get_weight_nutrition_relationship": {
      const r = rangeS.parse(raw);
      const [days, weights] = await Promise.all([nutritionDays(ctx.db, { start: r.start_date, end: r.end_date }), listWeights(ctx.db, { start: r.start_date, end: r.end_date })]);
      const wd = dailySeries(weights.map((x) => ({ localDate: x.localDate, period: x.period, weightKg: x.weightKg })), r.start_date, r.end_date);
      const unit = ctx.settings.weightUnit;
      const rel = analyzeRelationship(days, wd, { start: r.start_date, end: r.end_date }, { weekStartsOn: ctx.settings.weekStartsOn, formatWeight: (kg) => `${r2(fromKg(kg, unit))} ${unit}` });
      return {
        unit,
        weeks: rel.weeks.map((x) => ({ week_start: x.weekStart, logged_days: x.loggedDays, weigh_in_days: x.weightDays, avg_calories: r0(x.avgCalories), avg_protein_g: r0(x.avgProtein), avg_weight: w(x.avgWeight, unit), weight_change_next_week: w(x.weightChangeNextWeek, unit) })),
        correlation_weekly_calories_vs_next_week_weight_change: rel.correlation && { r: r2(rel.correlation.r), weeks: rel.correlation.n, strength: rel.correlation.strength },
        rough_maintenance_estimate: rel.energyBalance && { kcal_per_day: Math.round(rel.energyBalance.estimatedMaintenance / 50) * 50, avg_calories: r0(rel.energyBalance.avgCalories), weight_trend_per_week: w(rel.energyBalance.weightSlopePerWeekKg, unit), caveat: "Very rough: assumes complete logging and ~7,700 kcal/kg." },
        observations: rel.observations.map((o) => o.text),
      };
    }
    case "propose_action":
      return proposeAction(ctx, raw);
    default:
      throw new AppError(400, "unknown_tool", `Unknown tool ${name}`);
  }
}
