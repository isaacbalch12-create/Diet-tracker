import { query, readJson, route } from "@/lib/api";
import { createWeight, earliestWeightDate, weightOverview } from "@/lib/services/weights";
import { presetRange, RANGE_PRESETS, type RangePreset } from "@/lib/time";
import { rangeQuerySchema, weightInputSchema } from "@/lib/validation";

export const GET = route(async (req, { db, settings, today }) => {
  const q = query(req);
  const preset = q.get("range");
  let range;
  if (preset && (RANGE_PRESETS as readonly string[]).includes(preset)) {
    range = presetRange(preset as RangePreset, today, await earliestWeightDate(db));
  } else {
    range = rangeQuerySchema.parse({ start: q.get("start"), end: q.get("end") ?? today });
  }
  return weightOverview(db, range, settings, today);
});

export const POST = route(async (req, { db, settings }) => {
  const input = await readJson(req, weightInputSchema);
  return Response.json({ entry: await createWeight(db, input, settings) }, { status: 201 });
});
