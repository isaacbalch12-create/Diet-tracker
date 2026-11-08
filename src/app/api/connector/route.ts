import { z } from "zod";
import { query, route } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { listConnections, mcpResourceUrl, publicOrigin, revokeConnection } from "@/lib/services/oauth";

/** Settings: the connector URL to paste into Claude, and the connections the owner approved. */
export const GET = route(async (req, { db }) => ({
  url: mcpResourceUrl(publicOrigin(req)),
  connections: await listConnections(db),
}));

export const DELETE = route(async (req, { db }) => {
  const id = z.uuid().parse(query(req).get("id"));
  if (!(await revokeConnection(db, id))) throw new AppError(404, "not_found", "Connection not found");
  return { ok: true };
});
