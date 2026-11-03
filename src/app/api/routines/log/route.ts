import { readJson, route } from "@/lib/api";
import { logActivity, logInputSchema } from "@/lib/services/routines";

export const POST = route(async (req, { db, today }) => ({ log: await logActivity(db, await readJson(req, logInputSchema), today) }));
