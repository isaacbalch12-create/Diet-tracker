/**
 * The Momentum connector: an MCP server the Claude app talks to. Claude does
 * the interpreting (on the user's own Claude plan); Momentum stores the data
 * and does every calculation, exactly as for in-app logging:
 *
 * - all the assistant's read-only data tools (day logs, stats, training,
 *   running, health, routines, goals, insights);
 * - search_foods against the local USDA database;
 * - log_meal, which resolves each food to a USDA entry, published restaurant
 *   values (with the source page) or a labelled AI estimate, then computes
 *   totals itself; copy_meal and delete_meal.
 */
import { createHash } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Db } from "../db";
import type { Food, Settings } from "../db/schema";
import { AppError } from "../errors";
import { getFoodsByIds, searchFoods, type FoodSearchResult } from "../foods/repo";
import { ASSISTANT_TOOLS, runAssistantTool } from "../ai/assistant-tools";
import { Candidates, resolveItems, type AiItem } from "../ai/meal-analysis";
import { normalizeUrl, verifyResult } from "../ai/restaurant-lookup";
import { createMeal, deleteMeal, duplicateMeal, getMeal, type MealView } from "../services/meals";
import { createMealSchema } from "../validation";
import { isLocalDate, type LocalDate } from "../time";

export const MCP_INSTRUCTIONS = `Momentum is the user's personal nutrition, training, running, health and routine tracker. Use these tools to answer questions about their data and to log meals for them.

Logging food:
1. Split the meal into foods and drinks with amounts. If the person gave no amount, estimate a typical portion and set quantity_source "estimated". Ask at most a couple of short questions, and only when the answer would change calories by roughly 15% or more.
2. For generic foods, call search_foods (batch all foods in one call) and pass the best match's food_id. Momentum then uses the USDA values.
3. For food from a named restaurant, chain or packaged brand, look up the official nutrition information on the web and pass it as restaurant (per-serving values exactly as published, plus the source_url of the page you read). Only pass numbers you actually found.
4. Otherwise pass estimate_per_100g; Momentum labels it as an AI estimate.
5. Unless the person asked you to log it right away, show them the foods, amounts and approximate calories first and log after they confirm.
6. Momentum computes all totals. Report the totals log_meal returns, not your own arithmetic, and say which items are estimates.
Never invent a food_id: use only ids search_foods returned.`;

const r0 = (v: number | null | undefined) => (v == null ? null : Math.round(v));
const r1 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10) / 10);

const num = (description?: string) => ({ type: "number", ...(description ? { description } : {}) });
const nullableNum = (description?: string) => ({ anyOf: [{ type: "number" }, { type: "null" }], ...(description ? { description } : {}) });

const NUTRIENTS_PER_SERVING_SCHEMA = {
  type: "object",
  properties: {
    calories: num(),
    protein_g: num(),
    carbs_g: num(),
    fat_g: num(),
    fiber_g: nullableNum(),
    sugar_g: nullableNum(),
    saturated_fat_g: nullableNum(),
    sodium_mg: nullableNum(),
  },
  required: ["calories", "protein_g", "carbs_g", "fat_g"],
};

const WRITE_TOOLS: Tool[] = [
  {
    name: "search_foods",
    description:
      "Search Momentum's USDA FoodData Central database (as-eaten Survey/FNDDS foods, SR Legacy, branded foods and the user's custom foods). One query per food, in USDA-style wording such as \"egg whole fried\" or \"rice white cooked\". Returns up to 6 candidates per query with a food_id to pass to log_meal, per-100 g calories/macros and household portions with gram weights.",
    inputSchema: { type: "object", properties: { queries: { type: "array", items: { type: "string" }, description: "1–10 search phrases" } }, required: ["queries"] },
    annotations: { title: "Search foods", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "log_meal",
    description:
      "Log a meal to the user's food diary. Each item needs exactly one nutrition source: food_id (from search_foods), restaurant (published per-serving values with their source_url), or estimate_per_100g (an AI estimate). Momentum computes all totals and returns the saved meal plus the day's totals vs. goals. Logging the same meal again within a minute is ignored, so retries are safe.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title, e.g. \"Eggs, bacon & toast\"" },
        category: { type: "string", description: "Meal category, e.g. Breakfast, Lunch, Dinner or Snack. Defaults from the time of day." },
        eaten_at: { type: "string", description: "When it was eaten, ISO 8601 with offset (e.g. 2026-11-07T08:30:00-05:00). Defaults to now." },
        date: { type: "string", description: "YYYY-MM-DD diary day, only to log on a different day than eaten_at implies." },
        description: { type: "string", description: "The person's own description of the meal." },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              quantity: num("Number of units eaten"),
              unit: { type: "string", description: "e.g. large, slice, cup, g, serving, burrito" },
              grams_per_unit: num("Weight of one unit in grams (1 for g)"),
              quantity_source: { type: "string", enum: ["user_stated", "estimated"] },
              food_id: { type: "string", description: "A food_id returned by search_foods" },
              restaurant: {
                type: "object",
                description: "Published nutrition for one serving of a restaurant or brand item.",
                properties: {
                  restaurant: { type: "string" },
                  item: { type: "string", description: "Item name as published" },
                  serving: { type: "string", description: "Serving as published, e.g. \"1 burrito\"" },
                  serving_grams: nullableNum("Serving weight in grams, only if published"),
                  per_serving: NUTRIENTS_PER_SERVING_SCHEMA,
                  source_url: { type: "string", description: "The page the numbers came from" },
                },
                required: ["restaurant", "item", "serving", "per_serving", "source_url"],
              },
              estimate_per_100g: { ...NUTRIENTS_PER_SERVING_SCHEMA, description: "Your estimate per 100 g (protein/carbs/fat in g, sodium in mg)." },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              cooking_method: { type: "string" },
              is_assumed: { type: "boolean", description: "True for inferred items such as cooking oil the person didn't mention" },
              notes: { type: "string" },
            },
            required: ["name", "quantity", "unit", "grams_per_unit"],
          },
        },
      },
      required: ["title", "items"],
    },
    annotations: { title: "Log a meal", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "copy_meal",
    description: "Log a copy of an earlier meal (find it with get_meals or get_day), e.g. \"same breakfast as yesterday\". Returns the new meal and the day's totals.",
    inputSchema: {
      type: "object",
      properties: {
        meal_id: { type: "string" },
        eaten_at: { type: "string", description: "ISO 8601 with offset. Defaults to now." },
        category: { type: "string" },
      },
      required: ["meal_id"],
    },
    annotations: { title: "Copy a meal", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "delete_meal",
    description: "Delete a logged meal by id (find it with get_day or get_meals). Confirm with the person first.",
    inputSchema: { type: "object", properties: { meal_id: { type: "string" } }, required: ["meal_id"] },
    annotations: { title: "Delete a meal", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
];

const READ_TOOLS: Tool[] = ASSISTANT_TOOLS.filter((t) => t.name !== "propose_action").map((t) => ({
  name: t.name,
  description: t.description ?? "",
  inputSchema: t.input_schema as Tool["inputSchema"],
  annotations: { readOnlyHint: true, openWorldHint: false },
}));

export const MCP_TOOLS: Tool[] = [...READ_TOOLS, ...WRITE_TOOLS];

const perServingSchema = z.object({
  calories: z.number(),
  protein_g: z.number(),
  carbs_g: z.number(),
  fat_g: z.number(),
  fiber_g: z.number().nullable().optional(),
  sugar_g: z.number().nullable().optional(),
  saturated_fat_g: z.number().nullable().optional(),
  sodium_mg: z.number().nullable().optional(),
});

const logItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.number().positive().max(10_000),
  unit: z.string().trim().min(1).max(120),
  grams_per_unit: z.number().positive().max(10_000),
  quantity_source: z.enum(["user_stated", "estimated"]).default("estimated"),
  food_id: z.string().max(100).nullable().optional(),
  restaurant: z
    .object({
      restaurant: z.string().trim().min(1).max(200),
      item: z.string().trim().min(1).max(300),
      serving: z.string().trim().max(200).default("1 serving"),
      serving_grams: z.number().positive().max(5000).nullable().optional(),
      per_serving: perServingSchema,
      source_url: z.string().max(2000),
    })
    .nullable()
    .optional(),
  estimate_per_100g: perServingSchema.nullable().optional(),
  confidence: z.enum(["high", "medium", "low"]).nullable().optional(),
  cooking_method: z.string().max(120).nullable().optional(),
  is_assumed: z.boolean().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const logMealSchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.string().trim().max(40).nullable().optional(),
  eaten_at: z.string().max(40).nullable().optional(),
  date: z.string().nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  items: z.array(logItemSchema).min(1, "A meal needs at least one food").max(40),
});

export interface McpContext {
  db: Db;
  settings: Settings;
  today: LocalDate;
  now?: Date;
}

function parseInstant(v: string | null | undefined, now: Date): Date {
  if (!v) return now;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new AppError(400, "invalid_input", "eaten_at must be an ISO 8601 date-time, e.g. 2026-11-07T08:30:00-05:00");
  if (d.getTime() > now.getTime() + 36 * 3600_000) throw new AppError(400, "invalid_input", "eaten_at is in the future.");
  return d;
}

/** Match the person's categories case-insensitively; default from the local hour. */
function pickCategory(s: Settings, wanted: string | null | undefined, eatenAt: Date): string {
  const cats = s.mealCategories.length ? s.mealCategories : ["Breakfast", "Lunch", "Dinner", "Snack"];
  if (wanted) return cats.find((c) => c.toLowerCase() === wanted.toLowerCase()) ?? wanted;
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: s.timezone }).format(eatenAt));
  const guess = hour < 11 ? "breakfast" : hour < 15 ? "lunch" : hour < 21 ? "dinner" : "snack";
  return cats.find((c) => c.toLowerCase() === guess) ?? cats[0];
}

const toSearchResult = (f: Food): FoodSearchResult => ({
  id: f.id,
  description: f.description,
  brand: f.brand,
  dataType: f.dataType,
  source: f.source,
  externalId: f.externalId,
  category: f.category,
  nutrientsPer100g: f.nutrientsPer100g,
  portions: f.portions,
  score: 0,
});

type Profileish = Partial<Record<"calories" | "protein" | "carbs" | "fat" | "fiber" | "sugar" | "saturatedFat" | "sodium", number | null>>;
const estimateFrom = (p: Profileish): AiItem["estimate_per_100g"] => ({
  calories: p.calories ?? 0,
  protein: p.protein ?? 0,
  carbs: p.carbs ?? 0,
  fat: p.fat ?? 0,
  fiber: p.fiber ?? null,
  sugar: p.sugar ?? null,
  saturated_fat: p.saturatedFat ?? null,
  sodium_mg: p.sodium ?? null,
});

function hostOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).host.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

function describeMeal(meal: MealView) {
  return {
    meal_id: meal.id,
    title: meal.title,
    date: meal.localDate,
    category: meal.category,
    eaten_at: meal.eatenAt.toISOString(),
    items: meal.items.map((i) => ({
      name: i.name,
      amount: `${r1(i.quantity)} × ${i.unit} (${r0(i.grams)} g)`,
      source:
        i.nutrientSource === "database"
          ? `USDA database: ${i.sourceRef?.description ?? "matched food"}`
          : i.nutrientSource === "restaurant"
            ? `Restaurant data: ${i.sourceRef?.description ?? ""}${hostOf(i.sourceRef?.url) ? ` (${hostOf(i.sourceRef?.url)})` : ""}`
            : i.nutrientSource === "ai_estimate"
              ? "AI estimate"
              : "Manual",
      calories: r0(i.nutrients.calories),
      protein_g: r1(i.nutrients.protein),
      carbs_g: r1(i.nutrients.carbs),
      fat_g: r1(i.nutrients.fat),
      warnings: i.warnings.length ? i.warnings : undefined,
    })),
    meal_totals: {
      calories: r0(meal.totals.values.calories),
      protein_g: r1(meal.totals.values.protein),
      carbs_g: r1(meal.totals.values.carbs),
      fat_g: r1(meal.totals.values.fat),
    },
  };
}

/** Resolve items exactly like the in-app AI pipeline, then save the meal. */
export async function logMealTool(ctx: McpContext, raw: unknown) {
  const input = logMealSchema.parse(raw);
  const now = ctx.now ?? new Date();
  const eatenAt = parseInstant(input.eaten_at, now);
  if (input.date != null && !isLocalDate(input.date)) throw new AppError(400, "invalid_input", "date must be YYYY-MM-DD");

  const ids = [...new Set(input.items.map((i) => i.food_id).filter((x): x is string => !!x))];
  const foods = ids.length ? await getFoodsByIds(ctx.db, ids.filter((id) => z.uuid().safeParse(id).success)) : new Map<string, Food>();
  const unknown = ids.filter((id) => !foods.has(id));
  if (unknown.length) throw new AppError(400, "unknown_food", `Unknown food_id ${unknown.join(", ")}. Use ids returned by search_foods, or give restaurant or estimate_per_100g instead.`);

  const cands = new Candidates();
  const aiItems: AiItem[] = input.items.map((it, idx) => {
    let ref: string | null = null;
    let estimate = it.estimate_per_100g
      ? { calories: it.estimate_per_100g.calories, protein: it.estimate_per_100g.protein_g, carbs: it.estimate_per_100g.carbs_g, fat: it.estimate_per_100g.fat_g, fiber: it.estimate_per_100g.fiber_g ?? null, sugar: it.estimate_per_100g.sugar_g ?? null, saturated_fat: it.estimate_per_100g.saturated_fat_g ?? null, sodium_mg: it.estimate_per_100g.sodium_mg ?? null }
      : null;
    if (it.food_id) {
      const food = foods.get(it.food_id)!;
      ref = cands.add(toSearchResult(food));
      estimate ??= estimateFrom(food.nutrientsPer100g);
    } else if (it.restaurant) {
      const r = it.restaurant;
      const key = normalizeUrl(r.source_url);
      if (!key) throw new AppError(400, "invalid_input", `Item ${idx + 1} (${it.name}): source_url must be a web address.`);
      const fact = verifyResult(
        { restaurant: r.restaurant, item: r.item },
        {
          index: idx,
          found: true,
          restaurant: r.restaurant,
          item: r.item,
          serving: r.serving,
          serving_grams: r.serving_grams ?? null,
          calories: r.per_serving.calories,
          protein_g: r.per_serving.protein_g,
          carbs_g: r.per_serving.carbs_g,
          fat_g: r.per_serving.fat_g,
          fiber_g: r.per_serving.fiber_g ?? null,
          sugar_g: r.per_serving.sugar_g ?? null,
          saturated_fat_g: r.per_serving.saturated_fat_g ?? null,
          sodium_mg: r.per_serving.sodium_mg ?? null,
          source_url: r.source_url,
          notes: null,
        },
        new Map([[key, { url: r.source_url, title: null }]]),
      );
      if (!fact.found) throw new AppError(400, "invalid_input", `Item ${idx + 1} (${it.name}): ${fact.notes} Check the published numbers, or give estimate_per_100g instead.`);
      fact.warnings.push(`Values reported by Claude from ${hostOf(fact.sourceUrl ?? undefined) ?? "the web"} — check the source link.`);
      ref = cands.addRestaurant(fact);
      const g = fact.servingGrams ?? it.grams_per_unit;
      const per100 = Object.fromEntries(Object.entries(fact.perServing).map(([k, v]) => [k, (v as number) * (100 / g)]));
      estimate ??= estimateFrom(per100);
    } else if (!estimate) {
      throw new AppError(400, "invalid_input", `Item ${idx + 1} (${it.name}) needs food_id, restaurant or estimate_per_100g.`);
    }
    return {
      name: it.name,
      quantity: it.quantity,
      unit: it.unit,
      grams_per_unit: it.grams_per_unit,
      quantity_source: it.quantity_source,
      food_ref: ref,
      estimate_per_100g: estimate!,
      confidence: it.confidence ?? (ref ? "high" : "medium"),
      cooking_method: it.cooking_method ?? null,
      is_assumed: it.is_assumed ?? false,
      notes: it.notes ?? null,
    };
  });
  // createMealSchema drops the draft-only `key` field.
  const items = resolveItems(aiItems, cands, foods);

  // Same meal again within the same minute is a retry, not a second meal.
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ t: input.title, d: input.date ?? null, at: Math.floor(eatenAt.getTime() / 60_000), items: input.items }))
    .digest("hex")
    .slice(0, 40);
  const { meal, created } = await createMeal(
    ctx.db,
    createMealSchema.parse({
      clientRequestId: `mcp-${fingerprint}`,
      eatenAt: eatenAt.toISOString(),
      localDate: input.date ?? undefined,
      category: pickCategory(ctx.settings, input.category, eatenAt),
      title: input.title,
      description: input.description ?? null,
      source: "connector",
      items,
    }),
    ctx.settings,
  );
  const day = await runAssistantTool({ db: ctx.db, settings: ctx.settings, today: ctx.today, conversationId: null }, "get_day", { date: meal.localDate });
  return { status: created ? "logged" : "already_logged", meal: describeMeal(meal), day };
}

async function callTool(ctx: McpContext, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "search_foods": {
      const { queries } = z.object({ queries: z.array(z.string().trim().min(1).max(200)).min(1).max(10) }).parse(args);
      const out: Record<string, unknown> = {};
      for (const q of queries) {
        const res = await searchFoods(ctx.db, q, { limit: 6 });
        out[q] = res.results.map((f) => ({
          food_id: f.id,
          description: f.brand ? `${f.description} (${f.brand})` : f.description,
          source: f.source === "custom" ? "User's custom food" : `USDA ${f.dataType}`,
          per_100g: { calories: r0(f.nutrientsPer100g.calories), protein_g: r1(f.nutrientsPer100g.protein), carbs_g: r1(f.nutrientsPer100g.carbs), fat_g: r1(f.nutrientsPer100g.fat) },
          portions: f.portions.slice(0, 6).map((p) => `${p.label} = ${r1(p.grams)} g`),
        }));
        if (res.apiError) out._note = `Online USDA search unavailable (${res.apiError}); results are from the local database only.`;
      }
      return out;
    }
    case "log_meal":
      return logMealTool(ctx, args);
    case "copy_meal": {
      const a = z.object({ meal_id: z.uuid(), eaten_at: z.string().max(40).nullable().optional(), category: z.string().max(40).nullable().optional() }).parse(args);
      const now = ctx.now ?? new Date();
      const eatenAt = parseInstant(a.eaten_at, now);
      const source = await getMeal(ctx.db, a.meal_id);
      const meal = await duplicateMeal(ctx.db, a.meal_id, { eatenAt, category: a.category ? pickCategory(ctx.settings, a.category, eatenAt) : source.category }, ctx.settings);
      const day = await runAssistantTool({ db: ctx.db, settings: ctx.settings, today: ctx.today, conversationId: null }, "get_day", { date: meal.localDate });
      return { status: "logged", meal: describeMeal(meal), day };
    }
    case "delete_meal": {
      const { meal_id } = z.object({ meal_id: z.uuid() }).parse(args);
      const meal = await getMeal(ctx.db, meal_id);
      await deleteMeal(ctx.db, meal_id);
      return { status: "deleted", meal_id, title: meal.title, date: meal.localDate };
    }
    default:
      if (READ_TOOLS.some((t) => t.name === name)) return runAssistantTool({ db: ctx.db, settings: ctx.settings, today: ctx.today, conversationId: null }, name, args);
      throw new AppError(400, "unknown_tool", `Unknown tool ${name}`);
  }
}

function toolError(err: unknown): CallToolResult {
  let message = "Something went wrong on the server. Nothing was changed.";
  if (err instanceof AppError) message = err.message;
  else if (err instanceof z.ZodError) {
    const i = err.issues[0];
    message = `Invalid input${i ? ` at ${i.path.join(".") || "input"}: ${i.message}` : ""}`;
  } else console.error("MCP tool error", err);
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** One server per request (stateless Streamable HTTP). */
export function buildMcpServer(ctx: McpContext): Server {
  const server = new Server({ name: "momentum", title: "Momentum", version: "1.0.0" }, { capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: MCP_TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    try {
      const result = await callTool(ctx, req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (err) {
      return toolError(err);
    }
  });
  return server;
}
