import { route } from "@/lib/api";
import { getAnalysis } from "@/lib/services/analysis";
import { uuidSchema } from "@/lib/validation";

export const GET = route<{ id: string }>(async (_req, { db }, { id }) => ({ analysis: await getAnalysis(db, uuidSchema.parse(id)) }));
