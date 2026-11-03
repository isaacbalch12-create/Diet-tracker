import { readJson, route } from "@/lib/api";
import { deleteTemplate, saveTemplate, templateInputSchema } from "@/lib/services/training";

export const PUT = route<{ id: string }>(async (req, { db }, { id }) => ({ template: await saveTemplate(db, await readJson(req, templateInputSchema), id) }));

export const DELETE = route<{ id: string }>(async (_req, { db }, { id }) => {
  await deleteTemplate(db, id);
  return { ok: true };
});
