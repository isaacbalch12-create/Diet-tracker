import path from "node:path";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { env } from "../env";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

interface DbState {
  promise: Promise<Db> | null;
  override: Db | null;
  driver: "postgres" | "pglite" | null;
  /** Connection string the current connection was opened with (it can rotate on Netlify). */
  url: string | null;
  close: (() => Promise<void>) | null;
}

const globalForDb = globalThis as unknown as { __dietDb?: DbState };
const state: DbState = (globalForDb.__dietDb ??= { promise: null, override: null, driver: null, url: null, close: null });

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

async function connectPostgres(url: string): Promise<Db> {
  const [{ drizzle }, { default: postgres }] = await Promise.all([
    import("drizzle-orm/postgres-js"),
    import("postgres"),
  ]);
  const client = postgres(url, {
    // Serverless instances handle one request at a time; keep their pools small.
    max: Number(process.env.DATABASE_POOL_SIZE ?? (env.onNetlify ? 2 : 5)),
    idle_timeout: env.onNetlify ? 20 : undefined,
    // Supabase/Neon poolers (transaction mode) do not support prepared statements.
    prepare: process.env.DATABASE_PREPARE === "true",
  });
  const db = drizzle(client, { schema });
  state.close = () => client.end({ timeout: 5 });
  if (process.env.AUTO_MIGRATE === "true") {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  }
  state.driver = "postgres";
  return db;
}

async function connectPglite(dir: string): Promise<Db> {
  const [{ drizzle }, { PGlite }, { migrate }] = await Promise.all([
    import("drizzle-orm/pglite"),
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite/migrator"),
  ]);
  const dataDir = dir === "memory://" ? dir : path.resolve(dir);
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  state.driver = "pglite";
  return db as unknown as Db;
}

/** Returns the shared database connection, running migrations for the embedded database. */
export function getDb(): Promise<Db> {
  if (state.override) return Promise.resolve(state.override);
  const url = env.databaseUrl ?? null;
  if (state.promise && state.url !== url) {
    // The connection string changed (e.g. rotated credentials): reconnect.
    const close = state.close;
    state.promise = null;
    state.close = null;
    close?.().catch(() => undefined);
  }
  if (!state.promise) {
    if (!url && (process.env.VERCEL || env.onNetlify || process.env.AWS_LAMBDA_FUNCTION_NAME)) {
      // Serverless file systems are ephemeral: an embedded database would silently lose data.
      return Promise.reject(new Error("A PostgreSQL database is required on serverless platforms: set DATABASE_URL or enable Netlify Database."));
    }
    state.url = url;
    state.promise = (url ? connectPostgres(url) : connectPglite(env.pgliteDir)).catch((err) => {
      state.promise = null;
      throw err;
    });
  }
  return state.promise;
}

export function dbDriver(): "postgres" | "pglite" | null {
  return state.driver;
}

/** Test helper: create an isolated in-memory database with all migrations applied. */
export async function createMemoryDb(): Promise<Db> {
  return connectPglite("memory://");
}

/** Test helper: route getDb() to a specific database. */
export function setDbOverride(db: Db | null) {
  state.override = db;
}
