import { and, count, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { foods, type Food, type Portion } from "../db/schema";
import { notFound } from "../errors";
import { cleanProfile, type NutrientProfile } from "../nutrition/nutrients";
import { FdcError, getFdcFood, searchFdc } from "./fdc";
import type { NormalizedFood } from "./usda";

export interface FoodSearchResult {
  id: string;
  description: string;
  brand: string | null;
  dataType: string;
  source: "usda" | "custom";
  externalId: string | null;
  category: string | null;
  nutrientsPer100g: NutrientProfile;
  portions: Portion[];
  score: number;
}

const STOP_WORDS = new Set(["a", "an", "the", "of", "with", "and", "or", "in", "on", "some", "my", "i", "ate", "had", "piece", "pieces", "slice", "slices", "cup", "cups", "glass", "bowl"]);

/** Turn free text into safe tsquery tokens. */
export function queryTokens(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t) && !/^\d+$/.test(t))
    .slice(0, 8);
}

const DATA_TYPE_WEIGHT = sql`case
  when ${foods.source} = 'custom' then 1.35
  when ${foods.dataType} = 'fndds' then 1.15
  when ${foods.dataType} = 'foundation' then 1.1
  when ${foods.dataType} = 'sr_legacy' then 1.0
  else 0.85 end`;

function toResult(row: Food & { score?: number }): FoodSearchResult {
  return {
    id: row.id,
    description: row.description,
    brand: row.brand,
    dataType: row.dataType,
    source: row.source,
    externalId: row.externalId,
    category: row.category,
    nutrientsPer100g: row.nutrientsPer100g,
    portions: row.portions,
    score: row.score ?? 0,
  };
}

/**
 * tsquery for one token. The word that may still be being typed also matches as
 * a raw prefix ("chick" → chicken) rather than a stemmed one: "cooked" stems to
 * "cook", and "cook:*" would match "cookies".
 */
function tokenQuery(token: string, prefix: boolean): SQL {
  const exact = sql`to_tsquery('english', ${token})`;
  return prefix ? sql`(${exact} || to_tsquery('simple', ${`${token}:*`}))` : exact;
}

function combinedQuery(tokens: string[], mode: "and" | "or", prefixToken: string | undefined): SQL {
  return sql`(${sql.join(
    tokens.map((t) => tokenQuery(t, t === prefixToken)),
    sql.raw(mode === "and" ? " && " : " || "),
  )})`;
}

async function ftsSearch(db: DbOrTx, tokens: string[], mode: "and" | "or", limit: number, prefixToken = tokens.at(-1)): Promise<FoodSearchResult[]> {
  if (tokens.length === 0) return [];
  const matchQ = combinedQuery(tokens, mode, prefixToken);
  // Whole-word matches outrank prefix-only matches ("egg" should beat "eggplant").
  const exactQ = sql`to_tsquery('english', ${tokens.join(" | ")})`;
  const phrase = `^${tokens.join("\\W+")}s?\\M`;
  const score = sql<number>`(
      ts_rank_cd(${foods.searchVector}, ${matchQ})
      + 2 * ts_rank_cd(${foods.searchVector}, ${exactQ})
      + case when ${foods.description} ~* ${phrase} then 0.5 else 0 end
    ) * ${DATA_TYPE_WEIGHT} / (1 + char_length(${foods.description}) / 60.0)`;
  const rows = await db
    .select({ food: foods, score })
    .from(foods)
    .where(sql`${foods.searchVector} @@ ${matchQ}`)
    .orderBy(sql`${score} desc`, foods.description)
    .limit(limit);
  return rows.map((r) => toResult({ ...r.food, score: Number(r.score) }));
}

/** How many foods match each token on its own. */
async function tokenFrequencies(db: DbOrTx, tokens: string[], prefixToken: string | undefined): Promise<number[]> {
  const fields = Object.fromEntries(
    tokens.map((t, i) => [`t${i}`, sql<number>`count(*) filter (where ${foods.searchVector} @@ ${tokenQuery(t, t === prefixToken)})`]),
  );
  const [row] = await db.select(fields).from(foods);
  return tokens.map((_, i) => Number(row?.[`t${i}`] ?? 0));
}

export async function countFoods(db: DbOrTx, source?: "usda" | "custom"): Promise<number> {
  const [row] = await db.select({ n: count() }).from(foods).where(source ? eq(foods.source, source) : undefined);
  return Number(row?.n ?? 0);
}

export async function searchLocalFoods(db: DbOrTx, query: string, limit = 10): Promise<FoodSearchResult[]> {
  const tokens = [...new Set(queryTokens(query))];
  if (tokens.length === 0) return [];
  const prefixToken = tokens.at(-1);
  const out: FoodSearchResult[] = [];
  const seen = new Set<string>();
  const add = (rows: FoodSearchResult[]) => {
    for (const r of rows) {
      if (out.length >= limit) return;
      if (!seen.has(r.id)) {
        seen.add(r.id);
        out.push(r);
      }
    }
  };
  add(await ftsSearch(db, tokens, "and", limit, prefixToken));
  if (out.length >= Math.min(limit, 5) || tokens.length === 1) return out;
  // Relax by dropping the least informative words first: words that match
  // nothing (typos), then the most common ones ("cooked", "raw"), so that
  // "cooked oatmeal" falls back to oatmeal rather than to everything cooked.
  const freq = await tokenFrequencies(db, tokens, prefixToken);
  const dropRank = (n: number) => (n === 0 ? Number.MAX_SAFE_INTEGER : n);
  const dropOrder = tokens
    .map((t, i) => ({ t, rank: dropRank(freq[i]) }))
    .sort((a, b) => b.rank - a.rank)
    .map((x) => x.t);
  let kept = tokens;
  for (const t of dropOrder.slice(0, -1)) {
    if (out.length >= limit) break;
    kept = kept.filter((k) => k !== t);
    add(await ftsSearch(db, kept, "and", limit, prefixToken));
  }
  if (out.length < limit) add(await ftsSearch(db, tokens, "or", limit, prefixToken));
  return out;
}

export interface SearchOutcome {
  results: FoodSearchResult[];
  usedApi: boolean;
  apiError: string | null;
}

/**
 * Search the local food table first; fall back to (and cache results from) the
 * USDA API when local results are thin or when branded products are requested.
 */
export async function searchFoods(db: DbOrTx, query: string, opts: { limit?: number; branded?: boolean; allowApi?: boolean } = {}): Promise<SearchOutcome> {
  const limit = opts.limit ?? 10;
  const local = opts.branded ? [] : await searchLocalFoods(db, query, limit);
  const allowApi = opts.allowApi ?? true;
  if (!allowApi || (!opts.branded && local.length >= 3)) return { results: local, usedApi: false, apiError: null };
  try {
    const remote = await searchFdc(query, { branded: opts.branded, pageSize: limit });
    const saved = await upsertUsdaFoods(db, remote);
    const seen = new Set(local.map((r) => r.id));
    const merged = [...local, ...saved.filter((r) => !seen.has(r.id)).map((f) => toResult(f))];
    return { results: merged.slice(0, limit), usedApi: true, apiError: null };
  } catch (err) {
    const msg = err instanceof FdcError ? err.message : "USDA search failed";
    return { results: local, usedApi: true, apiError: msg };
  }
}

/** Insert or refresh USDA foods; returns the stored rows (same order as input). */
export async function upsertUsdaFoods(db: DbOrTx, list: NormalizedFood[]): Promise<Food[]> {
  if (list.length === 0) return [];
  const rows = await db
    .insert(foods)
    .values(
      list.map((f) => ({
        source: "usda" as const,
        dataType: f.dataType,
        externalId: f.externalId,
        description: f.description,
        brand: f.brand,
        category: f.category,
        nutrientsPer100g: f.nutrientsPer100g,
        portions: f.portions,
      })),
    )
    .onConflictDoUpdate({
      target: [foods.source, foods.externalId],
      set: {
        description: sql`excluded.description`,
        brand: sql`excluded.brand`,
        category: sql`excluded.category`,
        nutrientsPer100g: sql`excluded.nutrients_per_100g`,
        portions: sql`case when jsonb_array_length(excluded.portions) > 0 then excluded.portions else ${foods.portions} end`,
        dataType: sql`excluded.data_type`,
        updatedAt: new Date(),
      },
    })
    .returning();
  const byExt = new Map(rows.map((r) => [r.externalId, r]));
  return list.map((f) => byExt.get(f.externalId)).filter((r): r is Food => !!r);
}

export async function getFood(db: DbOrTx, id: string): Promise<Food> {
  const [row] = await db.select().from(foods).where(eq(foods.id, id));
  if (!row) throw notFound("Food");
  return row;
}

export async function getFoodsByIds(db: DbOrTx, ids: string[]): Promise<Map<string, Food>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(foods).where(inArray(foods.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Fetch serving sizes for an API-cached food that arrived without them. */
export async function ensurePortions(db: DbOrTx, food: Food): Promise<Food> {
  if (food.portions.length > 0 || food.source !== "usda" || !food.externalId) return food;
  try {
    const detail = await getFdcFood(food.externalId);
    if (!detail || detail.portions.length === 0) return food;
    const [row] = await db.update(foods).set({ portions: detail.portions }).where(eq(foods.id, food.id)).returning();
    return row ?? food;
  } catch {
    return food;
  }
}

export interface CustomFoodInput {
  description: string;
  brand?: string | null;
  /** Nutrients for one serving of `servingGrams`. */
  servingGrams: number;
  servingLabel?: string | null;
  nutrientsPerServing: NutrientProfile;
}

export async function createCustomFood(db: DbOrTx, input: CustomFoodInput): Promise<Food> {
  const per100: NutrientProfile = {};
  for (const [k, v] of Object.entries(cleanProfile(input.nutrientsPerServing as Record<string, unknown>))) {
    per100[k as keyof NutrientProfile] = ((v as number) * 100) / input.servingGrams;
  }
  const portions: Portion[] = [{ label: input.servingLabel?.trim() || "serving", grams: input.servingGrams }];
  const [row] = await db
    .insert(foods)
    .values({ source: "custom", dataType: "custom", description: input.description.trim(), brand: input.brand ?? null, nutrientsPer100g: per100, portions })
    .returning();
  return row;
}

export async function deleteCustomFood(db: DbOrTx, id: string): Promise<void> {
  const rows = await db.delete(foods).where(and(eq(foods.id, id), eq(foods.source, "custom"))).returning({ id: foods.id });
  if (rows.length === 0) throw notFound("Custom food");
}
