/**
 * Apply database migrations. For PostgreSQL (DATABASE_URL) run this once per
 * deploy; the embedded database migrates itself automatically on startup.
 */
import "./env";
import { MIGRATIONS_FOLDER } from "../src/lib/db";

async function main() {
  // Neon (and its Vercel integration) also provide a direct, unpooled URL: better for DDL.
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url && process.env.VERCEL) {
    console.warn("No DATABASE_URL on this Vercel build: skipping migrations. Connect a Neon database to the project (Storage tab).");
    process.exit(0);
  }
  if (url) {
    const [{ drizzle }, { default: postgres }, { migrate }] = await Promise.all([import("drizzle-orm/postgres-js"), import("postgres"), import("drizzle-orm/postgres-js/migrator")]);
    const client = postgres(url, { max: 1 });
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    await client.end();
    console.log("Migrations applied to DATABASE_URL.");
  } else {
    const { getDb } = await import("../src/lib/db");
    await getDb();
    console.log(`Embedded database migrated (${process.env.PGLITE_DIR ?? "./data/pglite"}).`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
