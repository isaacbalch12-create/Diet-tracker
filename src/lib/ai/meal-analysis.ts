/**
 * AI meal interpretation. Claude's job is limited to *interpretation*: splitting a
 * description or photo into foods, estimating portions, and choosing the best
 * USDA database match (via the `search_foods` tool). Nutrient values for matched
 * foods come from the database, and all totals are computed deterministically
 * by the nutrition calculator — never taken from the model's arithmetic.
 */
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { DbOrTx } from "../db";
import type { Food, Portion } from "../db/schema";
import type { DraftItem, DraftQuestion, MealDraft } from "../drafts";
import { AppError } from "../errors";
import { getFoodsByIds, searchFoods, type FoodSearchResult } from "../foods/repo";
import { calorieDisagreement } from "../nutrition/calc";
import type { NutrientProfile } from "../nutrition/nutrients";
import { env } from "../env";
import { type AnthropicLike, fallbackParams, getAnthropic, toAiError } from "./client";

type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
type BetaContentBlockParam = Anthropic.Beta.BetaContentBlockParam;
type BetaToolResultBlockParam = Anthropic.Beta.BetaToolResultBlockParam;

export const SYSTEM_PROMPT = `You are the food-logging engine inside a personal nutrition tracker. You turn a person's meal description and/or meal photos into an itemized list of foods that the app will store and total.

Division of labour:
- You interpret: identify each food, estimate its amount in grams, and pick the closest entry from the USDA FoodData Central database using the search_foods tool.
- The app computes nutrition: for any item matched to a database entry, the app uses the database's per-100 g values and does all arithmetic. Your own per-100 g estimate is used only when no database entry fits, and is labelled as an AI estimate in the app.

How to work:
1. Split the meal into individual foods and drinks. Keep a composite dish as one item when the database has a good as-eaten entry (e.g. "Pizza, cheese, thin crust", "Chicken burrito"); otherwise list its main components.
2. Call search_foods once with a query for every item (batch all queries in one call). USDA descriptions are formal, e.g. "Egg, whole, fried with butter", "Bread, white, toasted", "Pork, cured, bacon, cooked", "Rice, white, cooked, no added fat". Prefer "Survey (FNDDS)" as-eaten entries that match the preparation. Search again with different wording if nothing fits. Never invent a food_ref; use only refs returned by the tool.
3. Amounts: use the quantity the person stated. If none was stated, estimate a typical adult portion (or, for photos, estimate from plate size, utensils and food volume) and mark quantity_source "estimated". Express each item as quantity × unit, with grams_per_unit being the weight of one unit. When the matched entry lists a suitable household portion (e.g. "large = 50 g", "slice = 25 g"), use that portion name as the unit and its grams. For liquids, convert volume to grams (water-like drinks ≈ 1 g/ml).
4. Hidden ingredients: include cooking fat, butter, dressings or sauces only when the description or photo gives real evidence (e.g. "fried", visible sheen, "with butter"). Mark such inferred items is_assumed = true with a short note. Don't add speculative items.
5. Always fill estimate_per_100g with your best per-100 g estimate for the food as described (even when you also give a food_ref) — the app uses it as a plausibility check. Use null for nutrients you cannot estimate sensibly.
6. Confidence: "high" when the food and amount are clear, "medium" when the amount or preparation is estimated, "low" when identity or amount is a guess.
7. Clarifying questions: ask at most 3 short questions, and only when the answer would change the meal's calories by roughly 15% or more (e.g. portion size of a calorie-dense food, whether something was fried in oil, regular vs diet soda). Give 2–4 short answer options for each. If the description is clear enough, ask nothing.
8. Photos: identify visible foods, cooking methods, sauces, toppings and condiments. Never claim precision you don't have; explain the main uncertainties (portion sizes, oils, hidden ingredients) in uncertainty_notes. If the image is not food or is too unclear to identify anything, return no items, set is_food accordingly, and ask a short question instead of inventing foods.
9. When revising a previous analysis using the person's answers, keep the items they did not question and adjust the rest.

Your final message must be the JSON object only.`;

export const SEARCH_TOOL: Anthropic.Beta.BetaTool = {
  name: "search_foods",
  description:
    "Search the USDA FoodData Central food database (Survey/FNDDS as-eaten foods, SR Legacy, and the user's custom foods). Pass one query per food, in USDA-style wording. Returns up to 6 candidates per query, each with a ref to cite as food_ref, per-100 g calories/protein/carbs/fat, and household portions with gram weights.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      queries: { type: "array", items: { type: "string" }, description: "Search phrases, e.g. [\"egg whole fried\", \"bacon cooked\", \"bread white toasted\"]" },
    },
    required: ["queries"],
    additionalProperties: false,
  },
};

const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] };
const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };

export const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["meal_title", "suggested_category", "is_food", "items", "questions", "uncertainty_notes"],
  properties: {
    meal_title: { type: "string", description: "Short title, e.g. 'Eggs, bacon & toast'" },
    suggested_category: { anyOf: [{ type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] }, { type: "null" }] },
    is_food: { type: "boolean" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "quantity", "unit", "grams_per_unit", "quantity_source", "food_ref", "estimate_per_100g", "confidence", "cooking_method", "is_assumed", "notes"],
        properties: {
          name: { type: "string" },
          quantity: { type: "number" },
          unit: { type: "string" },
          grams_per_unit: { type: "number" },
          quantity_source: { type: "string", enum: ["user_stated", "estimated"] },
          food_ref: nullableString,
          estimate_per_100g: {
            type: "object",
            additionalProperties: false,
            required: ["calories", "protein", "carbs", "fat", "fiber", "sugar", "saturated_fat", "sodium_mg"],
            properties: {
              calories: { type: "number" },
              protein: { type: "number" },
              carbs: { type: "number" },
              fat: { type: "number" },
              fiber: nullableNumber,
              sugar: nullableNumber,
              saturated_fat: nullableNumber,
              sodium_mg: nullableNumber,
            },
          },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          cooking_method: nullableString,
          is_assumed: { type: "boolean" },
          notes: nullableString,
        },
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "options"],
        properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" } } },
      },
    },
    uncertainty_notes: nullableString,
  },
} as const;

const num = z.number();
const aiItemSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: num,
  unit: z.string().min(1).max(120),
  grams_per_unit: num,
  quantity_source: z.enum(["user_stated", "estimated"]),
  food_ref: z.string().nullable(),
  estimate_per_100g: z.object({
    calories: num,
    protein: num,
    carbs: num,
    fat: num,
    fiber: num.nullable(),
    sugar: num.nullable(),
    saturated_fat: num.nullable(),
    sodium_mg: num.nullable(),
  }),
  confidence: z.enum(["high", "medium", "low"]),
  cooking_method: z.string().nullable(),
  is_assumed: z.boolean(),
  notes: z.string().nullable(),
});
export const aiOutputSchema = z.object({
  meal_title: z.string().min(1).max(200),
  suggested_category: z.enum(["breakfast", "lunch", "dinner", "snack"]).nullable(),
  is_food: z.boolean(),
  items: z.array(aiItemSchema).max(40),
  questions: z.array(z.object({ question: z.string().min(1).max(300), options: z.array(z.string().max(100)).max(6) })).max(5),
  uncertainty_notes: z.string().max(2000).nullable(),
});
export type AiOutput = z.infer<typeof aiOutputSchema>;
export type AiItem = z.infer<typeof aiItemSchema>;

export interface AnalyzeInput {
  text?: string | null;
  images?: { contentType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; base64: string }[];
  /** e.g. "Sunday 8:32 AM" — helps the model judge typical portions and meal type. */
  localTimeLabel?: string;
  category?: string | null;
  previous?: MealDraft | null;
  answers?: { question: string; answer: string }[];
  extraNote?: string | null;
}

export interface AnalyzeResult {
  draft: MealDraft;
  usage: Record<string, number>;
}

/** Candidate registry: the model may only cite refs the tool actually returned. */
class Candidates {
  private byRef = new Map<string, FoodSearchResult>();
  private byId = new Map<string, string>();
  add(food: FoodSearchResult): string {
    const existing = this.byId.get(food.id);
    if (existing) return existing;
    const ref = `F${this.byRef.size + 1}`;
    this.byRef.set(ref, food);
    this.byId.set(food.id, ref);
    return ref;
  }
  get(ref: string | null): FoodSearchResult | undefined {
    return ref ? this.byRef.get(ref.trim().toUpperCase()) : undefined;
  }
}

const DATA_TYPE_LABEL: Record<string, string> = {
  fndds: "Survey (FNDDS)",
  sr_legacy: "SR Legacy",
  foundation: "Foundation",
  branded: "Branded",
  custom: "User's custom food",
};

function r1(v: number | null | undefined) {
  return v == null ? null : Math.round(v * 10) / 10;
}

async function runSearchTool(db: DbOrTx, input: unknown, cands: Candidates): Promise<string> {
  const parsed = z.object({ queries: z.array(z.string().min(1).max(200)).min(1).max(12) }).safeParse(input);
  if (!parsed.success) return JSON.stringify({ error: "queries must be a non-empty array of strings" });
  const out: Record<string, unknown> = {};
  let apiNote: string | null = null;
  for (const q of parsed.data.queries) {
    const res = await searchFoods(db, q, { limit: 6 });
    if (res.apiError) apiNote = res.apiError;
    out[q] = res.results.map((f) => ({
      ref: cands.add(f),
      description: f.brand ? `${f.description} (${f.brand})` : f.description,
      source: DATA_TYPE_LABEL[f.dataType] ?? f.dataType,
      per_100g: { kcal: r1(f.nutrientsPer100g.calories), protein_g: r1(f.nutrientsPer100g.protein), carbs_g: r1(f.nutrientsPer100g.carbs), fat_g: r1(f.nutrientsPer100g.fat) },
      portions: f.portions.slice(0, 6).map((p) => `${p.label} = ${r1(p.grams)} g`),
    }));
  }
  if (apiNote) out._note = `Online USDA search unavailable (${apiNote}); results are from the local database only.`;
  return JSON.stringify(out);
}

function buildUserContent(input: AnalyzeInput): BetaContentBlockParam[] {
  const content: BetaContentBlockParam[] = [];
  for (const img of input.images ?? []) {
    content.push({ type: "image", source: { type: "base64", media_type: img.contentType, data: img.base64 } });
  }
  const lines: string[] = [];
  if (input.images?.length) lines.push(`${input.images.length} meal photo${input.images.length > 1 ? "s" : ""} attached${input.images.length > 1 ? " (they show the same meal)" : ""}.`);
  lines.push(input.text?.trim() ? `Meal description: ${input.text.trim()}` : "No written description — analyze the photo.");
  if (input.category) lines.push(`Meal category chosen by the user: ${input.category}.`);
  if (input.localTimeLabel) lines.push(`Eaten at (local time): ${input.localTimeLabel}.`);
  if (input.previous) {
    const prev = {
      title: input.previous.title,
      items: input.previous.items.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit, grams_per_unit: i.gramsPerUnit, matched_database_entry: i.sourceRef?.description ?? null, assumed: i.isAssumed })),
      questions: input.previous.questions.map((q) => q.question),
    };
    lines.push(`Your previous analysis: ${JSON.stringify(prev)}`);
  }
  if (input.answers?.length) {
    lines.push("The person answered your questions:");
    for (const a of input.answers) lines.push(`- Q: ${a.question}\n  A: ${a.answer}`);
  }
  if (input.extraNote?.trim()) lines.push(`Additional note from the person: ${input.extraNote.trim()}`);
  lines.push(input.previous ? "Revise the analysis using this information. Search the database again for any item that changed." : "Analyze this meal.");
  content.push({ type: "text", text: lines.join("\n") });
  return content;
}

const MAX_TURNS = 5;

/** Run the model ↔ search_foods loop and return the validated structured output. */
export async function runMealModel(db: DbOrTx, input: AnalyzeInput, client: AnthropicLike = getAnthropic()): Promise<{ output: AiOutput; cands: Candidates; usage: Record<string, number> }> {
  const cands = new Candidates();
  const messages: BetaMessageParam[] = [{ role: "user", content: buildUserContent(input) }];
  const usage: Record<string, number> = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const last = turn === MAX_TURNS - 1;
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await client.beta.messages.create({
        model: env.anthropicModel,
        max_tokens: 16000,
        // Cache the stable prefix (system + tool + photos) across loop turns.
        cache_control: { type: "ephemeral" },
        system: SYSTEM_PROMPT,
        tools: [SEARCH_TOOL],
        tool_choice: last ? { type: "none" } : { type: "auto" },
        output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
        messages,
        ...fallbackParams(),
      });
    } catch (err) {
      throw toAiError(err);
    }
    usage.input_tokens += response.usage.input_tokens ?? 0;
    usage.output_tokens += response.usage.output_tokens ?? 0;
    usage.cache_read_input_tokens += response.usage.cache_read_input_tokens ?? 0;

    if (response.stop_reason === "refusal") {
      throw new AppError(422, "ai_refused", "The AI declined to analyze this input. You can still add the foods manually.");
    }
    if (response.stop_reason === "max_tokens") {
      throw new AppError(502, "ai_truncated", "The AI response was cut off. Try a shorter description or fewer photos.");
    }
    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason === "tool_use" && toolUses.length > 0) {
      messages.push({ role: "assistant", content: response.content as BetaContentBlockParam[] });
      const results: BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        if (tu.name !== "search_foods") {
          results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Unknown tool ${tu.name}` });
          continue;
        }
        results.push({ type: "tool_result", tool_use_id: tu.id, content: await runSearchTool(db, tu.input, cands) });
      }
      messages.push({ role: "user", content: results });
      continue;
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AppError(502, "ai_bad_output", "The AI returned an unreadable result. Please try again.");
    }
    const parsed = aiOutputSchema.safeParse(json);
    if (!parsed.success) throw new AppError(502, "ai_bad_output", "The AI result didn't match the expected format. Please try again.");
    return { output: parsed.data, cands, usage };
  }
  throw new AppError(502, "ai_no_result", "The AI did not finish the analysis. Please try again.");
}

function estimateProfile(e: AiItem["estimate_per_100g"]): NutrientProfile {
  const p: NutrientProfile = { calories: e.calories, protein: e.protein, carbs: e.carbs, fat: e.fat };
  if (e.fiber != null) p.fiber = e.fiber;
  if (e.sugar != null) p.sugar = e.sugar;
  if (e.saturated_fat != null) p.saturatedFat = e.saturated_fat;
  if (e.sodium_mg != null) p.sodium = e.sodium_mg;
  for (const [k, v] of Object.entries(p)) if (typeof v !== "number" || !Number.isFinite(v) || v < 0) delete p[k as keyof NutrientProfile];
  return p;
}

/**
 * Deterministic resolution: map each AI item to stored nutrient data.
 * Matched items take per-100 g values from the database row; unmatched items
 * use the AI estimate and are labelled as such. Implausible numbers are flagged.
 */
export function resolveItems(items: AiItem[], cands: Candidates, foodsById: Map<string, Food>): DraftItem[] {
  return items.map((ai) => {
    const warnings: string[] = [];
    let quantity = ai.quantity;
    let gramsPerUnit = ai.grams_per_unit;
    if (!(quantity > 0) || !Number.isFinite(quantity)) {
      quantity = 1;
      warnings.push("The AI gave an invalid quantity; it was set to 1 — please check.");
    }
    if (!(gramsPerUnit > 0) || !Number.isFinite(gramsPerUnit)) {
      gramsPerUnit = 100;
      warnings.push("The AI gave an invalid portion weight; it was set to 100 g — please check.");
    }
    if (quantity * gramsPerUnit > 2500) warnings.push(`That is ${Math.round(quantity * gramsPerUnit)} g — unusually large; please check the amount.`);

    const estimate = estimateProfile(ai.estimate_per_100g);
    const cand = cands.get(ai.food_ref);
    const food = cand ? foodsById.get(cand.id) : undefined;
    if (ai.food_ref && !cand) warnings.push("The AI cited a database entry that wasn't in its search results, so its own estimate is used.");

    let nutrientsPer100g: NutrientProfile;
    let nutrientSource: DraftItem["nutrientSource"];
    let sourceRef: DraftItem["sourceRef"] = null;
    let portions: Portion[] = [];
    if (food) {
      nutrientsPer100g = food.nutrientsPer100g;
      nutrientSource = "database";
      sourceRef = { provider: food.source, fdcId: food.externalId ?? undefined, dataType: food.dataType, description: food.description };
      portions = [...food.portions];
      const ratio = calorieDisagreement(food.nutrientsPer100g.calories, estimate.calories);
      if (ratio !== null && ratio > 2.5) {
        warnings.push(`Database match "${food.description}" (${Math.round(food.nutrientsPer100g.calories ?? 0)} kcal/100 g) differs a lot from the AI's estimate (${Math.round(estimate.calories ?? 0)} kcal/100 g). Check that the match is right.`);
      }
    } else {
      nutrientsPer100g = estimate;
      nutrientSource = "ai_estimate";
    }
    if (!portions.some((p) => p.label.toLowerCase() === ai.unit.toLowerCase())) {
      portions.unshift({ label: ai.unit, grams: gramsPerUnit });
    }
    const known: Partial<Record<string, number>> = {};
    for (const [k, v] of Object.entries(nutrientsPer100g)) if (typeof v === "number") known[k] = v;
    return {
      key: randomUUID(),
      name: ai.name,
      quantity,
      unit: ai.unit,
      gramsPerUnit,
      nutrientsPer100g: known,
      nutrientSource,
      quantitySource: ai.quantity_source === "user_stated" ? "user_stated" : "ai_estimate",
      manualNutrients: [],
      foodId: food?.id ?? null,
      sourceRef,
      confidence: ai.confidence,
      cookingMethod: ai.cooking_method,
      isAssumed: ai.is_assumed,
      notes: ai.notes,
      warnings,
      portions: portions.slice(0, 12),
      aiOriginal: ai as unknown as Record<string, unknown>,
    };
  });
}

export async function analyzeMeal(db: DbOrTx, input: AnalyzeInput, client?: AnthropicLike): Promise<AnalyzeResult> {
  if (!input.text?.trim() && !input.images?.length) throw new AppError(400, "empty_input", "Describe the meal or add a photo.");
  const { output, cands, usage } = await runMealModel(db, input, client);
  const ids = output.items.map((i) => cands.get(i.food_ref)?.id).filter((x): x is string => !!x);
  const foodsById = await getFoodsByIds(db, ids);
  const items = resolveItems(output.items, cands, foodsById);
  const questions: DraftQuestion[] = output.questions.map((q) => ({ id: randomUUID(), question: q.question, options: q.options }));
  const category = output.suggested_category ? output.suggested_category[0].toUpperCase() + output.suggested_category.slice(1) : null;
  return {
    draft: {
      title: output.meal_title,
      suggestedCategory: category,
      items,
      questions,
      uncertaintyNotes: output.uncertainty_notes,
      isFood: output.is_food,
      model: env.anthropicModel,
    },
    usage,
  };
}
