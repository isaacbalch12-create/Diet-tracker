import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db";
import {
  chatConversations,
  foods,
  goals,
  mealAnalyses,
  mealImages,
  mealItems,
  meals,
  savedMeals,
  settings,
  weightEntries,
} from "../db/schema";
import { badRequest } from "../errors";
import { itemGrams, itemNutrients } from "../nutrition/calc";
import { NUTRIENTS } from "../nutrition/nutrients";
import { eachDate, type LocalDate } from "../time";
import { fromKg } from "../units";
import { buildDailyMap } from "../weight/stats";
import { listMeals } from "./meals";
import { listGoals, toGoalVersion } from "./settings";
import { nutritionDaysFromMeals } from "./stats";
import { listWeights } from "./weights";
import { goalForDate, goalTargets } from "../nutrition/goals";

export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  // Neutralize spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}

const round = (v: number | null | undefined, d = 3) => (v == null ? null : Number(v.toFixed(d)));

export async function weightsCsv(db: Db): Promise<string> {
  const rows = await listWeights(db);
  return toCsv(
    ["date", "period", "measured_at", "timezone", "weight_kg", "weight_lb", "entered_value", "entered_unit", "note"],
    rows.map((w) => [w.localDate, w.period, w.measuredAt, w.timezone, round(w.weightKg, 4), round(fromKg(w.weightKg, "lb"), 3), w.inputValue, w.inputUnit, w.note]),
  );
}

export async function mealItemsCsv(db: Db, range: { start: LocalDate; end: LocalDate }): Promise<string> {
  const list = await listMeals(db, range);
  const header = [
    "date",
    "eaten_at",
    "meal_id",
    "meal_title",
    "category",
    "meal_source",
    "item_name",
    "quantity",
    "unit",
    "grams",
    ...NUTRIENTS.map((n) => `${n.key}_${n.unit === "µg" ? "ug" : n.unit}`),
    "nutrient_source",
    "quantity_source",
    "confidence",
    "database_ref",
    "original_description",
  ];
  const rows: unknown[][] = [];
  for (const m of list) {
    for (const i of m.items) {
      const n = itemNutrients(i);
      rows.push([
        m.localDate,
        m.eatenAt,
        m.id,
        m.title,
        m.category,
        m.source,
        i.name,
        i.quantity,
        i.unit,
        round(itemGrams(i), 2),
        ...NUTRIENTS.map((d) => round(n[d.key] ?? null, 3)),
        i.nutrientSource,
        i.quantitySource,
        i.confidence,
        i.sourceRef ? `${i.sourceRef.provider}:${i.sourceRef.fdcId ?? ""} ${i.sourceRef.description}` : null,
        m.description,
      ]);
    }
  }
  return toCsv(header, rows);
}

export async function dailyCsv(db: Db, range: { start: LocalDate; end: LocalDate }): Promise<string> {
  const [list, weights, goalRows] = await Promise.all([listMeals(db, range), listWeights(db, range), listGoals(db)]);
  const days = new Map(nutritionDaysFromMeals(list).map((d) => [d.date, d]));
  const wmap = buildDailyMap(weights.map((w) => ({ localDate: w.localDate, period: w.period, weightKg: w.weightKg })));
  const versions = goalRows.map(toGoalVersion);
  const header = ["date", "meals_logged", ...NUTRIENTS.map((n) => `${n.key}_${n.unit === "µg" ? "ug" : n.unit}`), "goal_calories", "goal_protein_g", "goal_carbs_g", "goal_fat_g", "morning_kg", "night_kg", "daily_avg_kg"];
  const rows = eachDate(range.start, range.end).map((date) => {
    const d = days.get(date);
    const w = wmap.get(date);
    const g = goalTargets(goalForDate(versions, date));
    return [
      date,
      d?.mealCount ?? 0,
      ...NUTRIENTS.map((n) => (d ? round(d.totals.values[n.key], 3) : null)),
      g.calories ?? null,
      g.protein ?? null,
      g.carbs ?? null,
      g.fat ?? null,
      round(w?.morning ?? null, 4),
      round(w?.night ?? null, 4),
      round(w?.average ?? null, 4),
    ];
  });
  return toCsv(header, rows);
}

export const BACKUP_VERSION = 1;

export async function fullBackup(db: Db, opts: { includeImages: boolean }) {
  const [s, g, w, m, mi, sm, cf, an] = await Promise.all([
    db.select().from(settings),
    db.select().from(goals),
    db.select().from(weightEntries),
    db.select().from(meals),
    db.select().from(mealItems),
    db.select().from(savedMeals),
    db.select().from(foods).where(eq(foods.source, "custom")),
    db.select().from(mealAnalyses),
  ]);
  const imgs = await db.select().from(mealImages);
  return {
    app: "diet-tracker",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: s,
    goals: g,
    weightEntries: w,
    meals: m,
    mealItems: mi,
    savedMeals: sm,
    customFoods: cf.map(({ searchVector: _sv, ...rest }) => {
      void _sv;
      return rest;
    }),
    mealAnalyses: an,
    images: imgs.map(({ data, ...meta }) => ({ ...meta, data: opts.includeImages && data ? data.toString("base64") : null })),
  };
}

type Backup = Awaited<ReturnType<typeof fullBackup>>;

const reviveDates = <T extends Record<string, unknown>>(row: T, keys: string[]): T => {
  const out: Record<string, unknown> = { ...row };
  for (const k of keys) if (typeof out[k] === "string") out[k] = new Date(out[k] as string);
  return out as T;
};

/**
 * Replace all personal data with the contents of a backup (one transaction —
 * either everything is restored or nothing changes). Reference USDA foods are kept.
 */
export async function restoreBackup(db: Db, raw: unknown): Promise<{ meals: number; weights: number }> {
  const b = raw as Backup;
  if (!b || b.app !== "diet-tracker" || b.version !== BACKUP_VERSION) throw badRequest("This file is not a Diet Tracker backup (or is from an unsupported version).");
  const ts = ["createdAt", "updatedAt"];
  await db.transaction(async (tx) => {
    await tx.delete(chatConversations);
    await tx.delete(mealImages);
    await tx.delete(mealItems);
    await tx.delete(meals);
    await tx.delete(mealAnalyses);
    await tx.delete(weightEntries);
    await tx.delete(goals);
    await tx.delete(savedMeals);
    await tx.delete(foods).where(eq(foods.source, "custom"));
    await tx.delete(settings);
    if (b.settings?.length) await tx.insert(settings).values(b.settings.map((r) => reviveDates(r, ts)));
    if (b.goals?.length) await tx.insert(goals).values(b.goals.map((r) => reviveDates(r, ts)));
    if (b.weightEntries?.length) await tx.insert(weightEntries).values(b.weightEntries.map((r) => reviveDates(r, [...ts, "measuredAt"])));
    if (b.customFoods?.length) await tx.insert(foods).values(b.customFoods.map((r) => reviveDates(r, ts)));
    if (b.meals?.length) await tx.insert(meals).values(b.meals.map((r) => reviveDates(r, [...ts, "eatenAt"])));
    if (b.mealItems?.length) {
      // Food references may point at reference foods that don't exist in this database
      // (e.g. restoring onto a fresh install); the item keeps its USDA id in source_ref.
      const refIds = [...new Set(b.mealItems.map((r) => r.foodId).filter((x): x is string => !!x))];
      const present = new Set<string>();
      for (let i = 0; i < refIds.length; i += 500) {
        const found = await tx.select({ id: foods.id }).from(foods).where(inArray(foods.id, refIds.slice(i, i + 500)));
        found.forEach((f) => present.add(f.id));
      }
      const rows = b.mealItems.map((r) => reviveDates({ ...r, foodId: r.foodId && present.has(r.foodId) ? r.foodId : null }, ts));
      for (let i = 0; i < rows.length; i += 500) await tx.insert(mealItems).values(rows.slice(i, i + 500));
    }
    if (b.savedMeals?.length) await tx.insert(savedMeals).values(b.savedMeals.map((r) => reviveDates(r, [...ts, "lastUsedAt"])));
    if (b.mealAnalyses?.length) await tx.insert(mealAnalyses).values(b.mealAnalyses.map((r) => reviveDates(r, ts)));
    const imgs = (b.images ?? []).filter((i) => i.storage === "s3" || i.data);
    if (imgs.length) {
      await tx.insert(mealImages).values(imgs.map((i) => ({ ...reviveDates(i, ["createdAt"]), data: i.data ? Buffer.from(i.data, "base64") : null })));
    }
  });
  return { meals: b.meals?.length ?? 0, weights: b.weightEntries?.length ?? 0 };
}
