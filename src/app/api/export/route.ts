import { query, route } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { dailyCsv, fullBackup, mealItemsCsv, weightsCsv } from "@/lib/services/export";
import { earliestMealDate } from "@/lib/services/meals";
import { earliestWeightDate } from "@/lib/services/weights";
import { addDays, minDate } from "@/lib/time";

function download(body: string, filename: string, type: string) {
  return new Response(body, {
    headers: { "Content-Type": `${type}; charset=utf-8`, "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
}

export const GET = route(async (req, { db, today }) => {
  const q = query(req);
  const type = q.get("type");
  const [m, w] = await Promise.all([earliestMealDate(db), earliestWeightDate(db)]);
  const earliest = m && w ? minDate(m, w) : (m ?? w ?? addDays(today, -30));
  const range = { start: q.get("start") ?? earliest, end: q.get("end") ?? today };
  switch (type) {
    case "weights":
      return download(await weightsCsv(db), `weights-${today}.csv`, "text/csv");
    case "meals":
      return download(await mealItemsCsv(db, range), `food-log-${today}.csv`, "text/csv");
    case "daily":
      return download(await dailyCsv(db, range), `daily-summary-${today}.csv`, "text/csv");
    case "backup": {
      const data = await fullBackup(db, { includeImages: q.get("images") === "1" });
      return download(JSON.stringify(data), `diet-tracker-backup-${today}.json`, "application/json");
    }
    default:
      throw badRequest("type must be one of weights, meals, daily, backup");
  }
});
