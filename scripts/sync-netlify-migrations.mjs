// Copies Drizzle-generated SQL migrations (drizzle/NNNN_name.sql) into
// netlify/database/migrations/, where Netlify Database applies them on deploy.
// Run automatically by `npm run db:generate`. Existing files are never rewritten
// once applied, so only missing files are copied (a changed file is an error).
import fs from "node:fs";
import path from "node:path";

const src = path.resolve("drizzle");
const dest = path.resolve("netlify/database/migrations");
fs.mkdirSync(dest, { recursive: true });
let copied = 0;
for (const file of fs.readdirSync(src).filter((f) => /^\d+_[a-z0-9_-]+\.sql$/.test(f)).sort()) {
  const from = path.join(src, file);
  const to = path.join(dest, file);
  const sql = fs.readFileSync(from, "utf8");
  if (fs.existsSync(to)) {
    if (fs.readFileSync(to, "utf8") !== sql) {
      console.error(`netlify/database/migrations/${file} differs from drizzle/${file}. Applied migrations must not change — generate a new migration instead.`);
      process.exit(1);
    }
    continue;
  }
  fs.writeFileSync(to, sql);
  copied++;
}
console.log(`Netlify migrations in sync (${copied} copied).`);
