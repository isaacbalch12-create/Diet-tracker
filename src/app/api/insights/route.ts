import { query, route } from "@/lib/api";
import { computeInsights } from "@/lib/services/insights";

export const GET = route(async (req, { db, settings, today }) => {
  const days = Math.min(365, Math.max(7, Number(query(req).get("days") ?? 30) || 30));
  return computeInsights(db, settings, today, days);
});
