import { query, route } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { deleteSourceData } from "@/lib/services/health";

/** Delete all values from one source ("manual" or "conn:<id>"). */
export const DELETE = route(async (req, { db }) => {
  const source = query(req).get("source");
  if (!source || !(source === "manual" || /^conn:[0-9a-f-]{36}$/.test(source))) throw badRequest("source must be manual or conn:<id>");
  return { deleted: await deleteSourceData(db, source) };
});
