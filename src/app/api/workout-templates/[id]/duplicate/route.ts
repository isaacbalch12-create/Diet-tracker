import { route } from "@/lib/api";
import { duplicateTemplate } from "@/lib/services/training";

export const POST = route<{ id: string }>(async (_req, { db }, { id }) => ({ template: await duplicateTemplate(db, id) }));
