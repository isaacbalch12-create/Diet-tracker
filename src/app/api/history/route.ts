import { query, route } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { addDays, diffDays, eachDate } from "@/lib/time";
import { nutritionDays } from "@/lib/services/stats";
import { listWeights } from "@/lib/services/weights";
import { buildDailyMap } from "@/lib/weight/stats";
import { rangeQuerySchema } from "@/lib/validation";

export const GET = route(async (req, { db, today }) => {
  const q = query(req);
  const range = rangeQuerySchema.parse({ start: q.get("start") ?? addDays(today, -29), end: q.get("end") ?? today });
  if (range.start > range.end || diffDays(range.start, range.end) > 400) throw badRequest("Choose a range of up to ~13 months");
  const [days, weights] = await Promise.all([nutritionDays(db, range), listWeights(db, range)]);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const wmap = buildDailyMap(weights.map((w) => ({ localDate: w.localDate, period: w.period, weightKg: w.weightKg })));
  return {
    range,
    days: eachDate(range.start, range.end)
      .reverse()
      .map((date) => {
        const d = byDate.get(date);
        const w = wmap.get(date);
        return {
          date,
          mealCount: d?.mealCount ?? 0,
          calories: d?.totals.values.calories ?? null,
          protein: d?.totals.values.protein ?? null,
          carbs: d?.totals.values.carbs ?? null,
          fat: d?.totals.values.fat ?? null,
          morningKg: w?.morning ?? null,
          nightKg: w?.night ?? null,
        };
      }),
  };
});
