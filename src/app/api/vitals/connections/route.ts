import { readJson, route } from "@/lib/api";
import { connectionInputSchema, createConnection, listConnections } from "@/lib/services/health";

export const GET = route(async (_req, { db }) => ({ connections: await listConnections(db) }));

/** Returns the token once; only its hash is stored. */
export const POST = route(async (req, { db }) => createConnection(db, await readJson(req, connectionInputSchema)));
