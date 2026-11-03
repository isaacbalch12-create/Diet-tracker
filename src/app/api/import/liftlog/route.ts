import { route } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { importLiftlog } from "@/lib/services/liftlog-import";

export const maxDuration = 60;

export const POST = route(async (req, { db, settings, today }) => {
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    throw badRequest("The file is not valid JSON. Choose the file from LiftLog → Settings → Backup (JSON).");
  }
  return { imported: await importLiftlog(db, data, settings, today) };
});
