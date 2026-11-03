import { query, readJson, route } from "@/lib/api";
import { journalInputSchema, listJournal, saveJournal, slotSchema } from "@/lib/services/routines";
import { isLocalDate } from "@/lib/time";

export const GET = route(async (req, { db }) => {
  const q = query(req);
  const d = (k: string) => {
    const v = q.get(k);
    return v && isLocalDate(v) ? v : undefined;
  };
  const slot = q.get("slot");
  return { entries: await listJournal(db, { start: d("start"), end: d("end"), slot: slot ? slotSchema.parse(slot) : undefined, q: q.get("q") ?? undefined }) };
});

export const PUT = route(async (req, { db, today }) => ({ entry: await saveJournal(db, await readJson(req, journalInputSchema), today) }));
