/**
 * Import USDA FoodData Central reference foods (FNDDS survey foods + SR Legacy,
 * ~13,000 foods) into the local `foods` table, so food matching works offline
 * and without API rate limits. Safe to re-run (rows are upserted by FDC id).
 *
 *   npm run usda:import                 # downloads into ./data/usda (cached) and imports
 *   npm run usda:import -- --dir <path> # use already-downloaded .zip files in <path>
 */
import "./env";
import path from "node:path";
import { getDb } from "../src/lib/db";
import { importUsda } from "../src/lib/foods/import";
import { countFoods } from "../src/lib/foods/repo";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const db = await getDb();
  const before = await countFoods(db, "usda");
  await importUsda(db, path.resolve(arg("--dir") ?? "./data/usda"));
  const after = await countFoods(db, "usda");
  console.log(`Done. USDA foods in database: ${after.toLocaleString()} (was ${before.toLocaleString()}).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
