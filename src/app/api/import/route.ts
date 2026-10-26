import { route } from "@/lib/api";
import { AppError, badRequest } from "@/lib/errors";
import { restoreBackup } from "@/lib/services/export";

export const POST = route(async (req, { db }) => {
  const url = new URL(req.url);
  if (url.searchParams.get("confirm") !== "replace-all") {
    throw new AppError(400, "confirmation_required", "Restoring replaces all current data. Confirm with ?confirm=replace-all.");
  }
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    throw badRequest("Backup file is not valid JSON");
  }
  return { restored: await restoreBackup(db, data) };
});
