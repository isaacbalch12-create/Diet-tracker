/**
 * Download (or read cached) USDA FoodData Central CSV datasets and upsert them
 * into the local `foods` table. Used by `npm run usda:import` and the demo seeder.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import type { Db } from "../db";
import { upsertUsdaFoods } from "./repo";
import { parseUsdaCsv, type UsdaDataType } from "./usda";

export const USDA_DATASETS: { file: string; dataType: UsdaDataType; label: string }[] = [
  { file: "FoodData_Central_survey_food_csv_2024-10-31.zip", dataType: "fndds", label: "FNDDS survey foods (as-eaten foods with household portions)" },
  { file: "FoodData_Central_sr_legacy_food_csv_2018-04.zip", dataType: "sr_legacy", label: "SR Legacy reference foods" },
];
const BASE_URL = "https://fdc.nal.usda.gov/fdc-datasets/";

async function loadZip(dir: string, file: string, log: (m: string) => void): Promise<Uint8Array> {
  const local = path.join(dir, file);
  try {
    return new Uint8Array(await fs.readFile(local));
  } catch {
    // not cached yet
  }
  log(`  downloading ${BASE_URL + file} …`);
  const res = await fetch(BASE_URL + file);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${BASE_URL + file}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(local, buf);
  return buf;
}

function csvFiles(zip: Uint8Array): Record<string, string> {
  const entries = unzipSync(zip, { filter: (f) => f.name.endsWith(".csv") });
  const decoder = new TextDecoder("utf-8");
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(entries)) out[path.basename(name)] = decoder.decode(data);
  return out;
}

export async function importUsda(db: Db, dir: string, log: (m: string) => void = console.log): Promise<number> {
  let total = 0;
  for (const ds of USDA_DATASETS) {
    log(`→ ${ds.label}`);
    const parsed = parseUsdaCsv(csvFiles(await loadZip(dir, ds.file, log)), ds.dataType);
    log(`  parsed ${parsed.length.toLocaleString()} foods`);
    for (let i = 0; i < parsed.length; i += 400) await upsertUsdaFoods(db, parsed.slice(i, i + 400));
    total += parsed.length;
  }
  return total;
}
