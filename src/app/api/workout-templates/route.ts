import { readJson, route } from "@/lib/api";
import { listTemplates, saveTemplate, templateInputSchema } from "@/lib/services/training";

export const GET = route(async (_req, { db }) => ({ templates: await listTemplates(db) }));

export const POST = route(async (req, { db }) => ({ template: await saveTemplate(db, await readJson(req, templateInputSchema)) }));
