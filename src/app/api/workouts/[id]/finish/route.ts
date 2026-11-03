import { z } from "zod";
import { readJson, route } from "@/lib/api";
import { finishWorkout } from "@/lib/services/training";

const schema = z.object({ incomplete: z.enum(["discard", "complete"]).default("discard") });

export const POST = route<{ id: string }>(async (req, { db }, { id }) => ({ workout: await finishWorkout(db, id, (await readJson(req, schema)).incomplete) }));
