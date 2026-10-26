import { query, route } from "@/lib/api";
import { earliestMealDate } from "@/lib/services/meals";
import { analyticsOverview } from "@/lib/services/stats";
import { earliestWeightDate } from "@/lib/services/weights";
import { diffDays, minDate, presetRange, RANGE_PRESETS, type RangePreset } from "@/lib/time";
import { badRequest } from "@/lib/errors";
import { rangeQuerySchema } from "@/lib/validation";

export const GET = route(async (req, { db, settings, today }) => {
  const q = query(req);
  const preset = q.get("range");
  let range;
  if (preset && (RANGE_PRESETS as readonly string[]).includes(preset)) {
    const [m, w] = await Promise.all([earliestMealDate(db), earliestWeightDate(db)]);
    const earliest = m && w ? minDate(m, w) : (m ?? w);
    range = presetRange(preset as RangePreset, today, earliest);
  } else {
    range = rangeQuerySchema.parse({ start: q.get("start"), end: q.get("end") });
    if (range.start > range.end) throw badRequest("Start date must be before end date");
    if (diffDays(range.start, range.end) > 3660) throw badRequest("Range is limited to 10 years");
  }
  return analyticsOverview(db, range, settings);
});
