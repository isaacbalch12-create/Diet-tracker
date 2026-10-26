import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: process.env.DATABASE_URL ? { url: process.env.DATABASE_URL } : undefined,
  strict: true,
});
