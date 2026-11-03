import { query, readJson, route } from "@/lib/api";
import { connectionPatchSchema, deleteSourceData, revokeConnection, updateConnection } from "@/lib/services/health";

export const PATCH = route<{ id: string }>(async (req, { db }, { id }) => ({ connection: await updateConnection(db, id, await readJson(req, connectionPatchSchema)) }));

/** Revoke the token. With ?deleteData=1, also delete everything this connection synced. */
export const DELETE = route<{ id: string }>(async (req, { db }, { id }) => {
  await revokeConnection(db, id);
  const deleted = query(req).get("deleteData") === "1" ? await deleteSourceData(db, `conn:${id}`) : 0;
  return { ok: true, deleted };
});
