import { readJson, route } from "@/lib/api";
import { addWater, waterInputSchema } from "@/lib/services/water";

export const POST = route(async (req, { db, settings, today }) => ({ entry: await addWater(db, await readJson(req, waterInputSchema), settings, today) }));
