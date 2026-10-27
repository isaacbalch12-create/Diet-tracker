import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { readJson, route } from "@/lib/api";
import { importUsdaDataset } from "@/lib/foods/import";
import { countFoods } from "@/lib/foods/repo";

// One dataset per request keeps each call well inside serverless time limits.
export const maxDuration = 60;

/**
 * Load the USDA reference foods into this app's database (signed-in user only).
 * Idempotent: foods are upserted by their USDA id.
 */
export const POST = route(async (req, { db }) => {
  const { dataset } = await readJson(req, z.object({ dataset: z.enum(["fndds", "sr_legacy"]) }));
  const imported = await importUsdaDataset(db, dataset, path.join(os.tmpdir(), "usda"), () => undefined);
  return { dataset, imported, usdaFoods: await countFoods(db, "usda") };
});
