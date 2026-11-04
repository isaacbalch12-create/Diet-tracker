/**
 * Tests for the deterministic parts around the AI: the tool loop, database
 * resolution, validation, idempotency and quick-save. The Anthropic client is
 * replaced by a scripted stub — this exercises our code paths, not the model.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AnthropicLike } from "@/lib/ai/client";
import { Candidates, resolveItems } from "@/lib/ai/meal-analysis";
import { lookupRestaurantNutrition } from "@/lib/ai/restaurant-lookup";
import { itemNutrients } from "@/lib/nutrition/calc";
import { createMeal } from "@/lib/services/meals";
import { createMealSchema } from "@/lib/validation";
import { createMemoryDb, type Db } from "@/lib/db";
import type { Settings } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { upsertUsdaFoods } from "@/lib/foods/repo";
import { getAnalysis, refineAnalysis, startAnalysis } from "@/lib/services/analysis";
import { daySummary } from "@/lib/services/stats";
import { updateSettings } from "@/lib/services/settings";

type Resp = { stop_reason: string; content: unknown[] };

function scripted(responses: Resp[]) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: Record<string, unknown>) => {
          calls.push(JSON.parse(JSON.stringify(params)));
          const r = responses.shift();
          if (!r) throw new Error("no more scripted responses");
          return { ...r, usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 } };
        },
      },
    },
  } as unknown as AnthropicLike;
  return { client, calls };
}

const toolUse = (queries: string[]): Resp => ({
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id: "tu_1", name: "search_foods", input: { queries } }],
});

const item = (over: Record<string, unknown>) => ({
  name: "Food",
  quantity: 1,
  unit: "serving",
  grams_per_unit: 100,
  quantity_source: "estimated",
  food_ref: null,
  estimate_per_100g: { calories: 100, protein: 5, carbs: 10, fat: 3, fiber: null, sugar: null, saturated_fat: null, sodium_mg: null },
  confidence: "medium",
  cooking_method: null,
  is_assumed: false,
  notes: null,
  ...over,
});

const final = (items: unknown[], questions: unknown[] = []): Resp => ({
  stop_reason: "end_turn",
  content: [
    {
      type: "text",
      text: JSON.stringify({ meal_title: "Eggs & toast", suggested_category: "breakfast", is_food: true, items, questions, uncertainty_notes: "Butter amount estimated." }),
    },
  ],
});

let db: Db;
let s: Settings;

beforeEach(async () => {
  db = await createMemoryDb();
  s = await updateSettings(db, { timezone: "America/New_York" });
  await upsertUsdaFoods(db, [
    { externalId: "100", dataType: "fndds", description: "Egg, whole, fried with butter", brand: null, category: "Eggs", nutrientsPer100g: { calories: 182, protein: 12.4, carbs: 0.8, fat: 14.2, sodium: 200 }, portions: [{ label: "large", grams: 50 }] },
    { externalId: "200", dataType: "fndds", description: "Bread, white, toasted", brand: null, category: "Bread", nutrientsPer100g: { calories: 293, protein: 9, carbs: 54, fat: 4 }, portions: [{ label: "medium or regular slice", grams: 25 }] },
  ]);
});

describe("AI meal analysis pipeline", () => {
  it("uses database values for matched foods and AI estimates otherwise", async () => {
    const { client, calls } = scripted([
      toolUse(["egg whole fried", "bread white toasted"]),
      final([
        item({ name: "Fried eggs", quantity: 2, unit: "large", grams_per_unit: 50, quantity_source: "user_stated", food_ref: "F1", estimate_per_100g: { calories: 190, protein: 13, carbs: 1, fat: 15, fiber: null, sugar: null, saturated_fat: null, sodium_mg: null }, confidence: "high", cooking_method: "fried" }),
        item({ name: "Toast", quantity: 2, unit: "slice", grams_per_unit: 25, food_ref: "F99" }),
        item({ name: "Butter", quantity: 1, unit: "tsp", grams_per_unit: 5, is_assumed: true, estimate_per_100g: { calories: 717, protein: 0.9, carbs: 0.1, fat: 81, fiber: 0, sugar: 0.1, saturated_fat: 51, sodium_mg: 11 } }),
      ], [{ question: "Was the toast buttered?", options: ["Yes", "No"] }]),
    ]);
    const { analysis, meal } = await startAnalysis(db, { requestId: "req-aaaaaaaa", text: "2 fried eggs and 2 slices of toast", imageIds: [] }, s, client);
    expect(meal).toBeNull();
    expect(analysis.status).toBe("completed");
    const [egg, toast, butter] = analysis.draft!.items;

    expect(egg.nutrientSource).toBe("database");
    expect(egg.nutrientsPer100g).toEqual({ calories: 182, protein: 12.4, carbs: 0.8, fat: 14.2, sodium: 200 });
    expect(egg.sourceRef).toMatchObject({ provider: "usda", fdcId: "100" });
    expect(egg.quantitySource).toBe("user_stated");

    expect(toast.nutrientSource).toBe("ai_estimate");
    expect(toast.warnings.join(" ")).toMatch(/wasn't in its search results/);

    expect(butter.isAssumed).toBe(true);
    expect(butter.nutrientsPer100g.saturatedFat).toBe(51);
    expect(analysis.draft!.questions[0].options).toEqual(["Yes", "No"]);

    // The tool result returned to the model contains candidate refs from the local DB.
    const second = calls[1].messages as { role: string; content: { type: string; content?: string }[] }[];
    const toolResult = second.at(-1)!.content[0].content!;
    expect(toolResult).toContain("Egg, whole, fried with butter");
    expect(toolResult).toContain('"ref":"F1"');
    // Nothing counts toward totals until confirmed.
    expect((await daySummary(db, "2026-10-26")).meals).toHaveLength(0);
  });

  it("flags database matches that disagree sharply with the AI estimate", async () => {
    const { client } = scripted([
      toolUse(["bread"]),
      final([item({ name: "Salad", food_ref: "F1", estimate_per_100g: { calories: 20, protein: 1, carbs: 3, fat: 0, fiber: null, sugar: null, saturated_fat: null, sodium_mg: null } })]),
    ]);
    const { analysis } = await startAnalysis(db, { requestId: "req-bbbbbbbb", text: "salad", imageIds: [] }, s, client);
    expect(analysis.draft!.items[0].warnings.join(" ")).toMatch(/differs a lot/);
  });

  it("returns the stored result when a request is retried (no second AI call, no duplicates)", async () => {
    const { client, calls } = scripted([final([item({ name: "Apple" })])]);
    const first = await startAnalysis(db, { requestId: "req-cccccccc", text: "an apple", imageIds: [], quickSave: true, eatenAt: new Date("2026-10-26T14:00:00Z") }, s, client);
    expect(first.meal).not.toBeNull();
    const again = await startAnalysis(db, { requestId: "req-cccccccc", text: "an apple", imageIds: [], quickSave: true, eatenAt: new Date("2026-10-26T14:00:00Z") }, s, client);
    expect(calls).toHaveLength(1);
    expect(again.analysis.id).toBe(first.analysis.id);
    expect(again.analysis.status).toBe("confirmed");
    expect((await daySummary(db, "2026-10-26")).meals).toHaveLength(1);
  });

  it("records failures, surfaces refusals clearly, and allows a retry", async () => {
    const { client } = scripted([{ stop_reason: "refusal", content: [] }, final([item({ name: "Apple" })])]);
    await expect(startAnalysis(db, { requestId: "req-dddddddd", text: "x", imageIds: [] }, s, client)).rejects.toMatchObject({ code: "ai_refused" });
    const retry = await startAnalysis(db, { requestId: "req-dddddddd", text: "x", imageIds: [] }, s, client);
    expect(retry.analysis.status).toBe("completed");
  });

  it("rejects malformed model output instead of guessing", async () => {
    const { client } = scripted([{ stop_reason: "end_turn", content: [{ type: "text", text: '{"meal_title": "x"}' }] }]);
    await expect(startAnalysis(db, { requestId: "req-eeeeeeee", text: "x", imageIds: [] }, s, client)).rejects.toBeInstanceOf(AppError);
  });

  it("forces a final answer on the last turn of the tool loop", async () => {
    const { client, calls } = scripted([toolUse(["a"]), toolUse(["b"]), toolUse(["c"]), toolUse(["d"]), final([item({ name: "Apple" })])]);
    await startAnalysis(db, { requestId: "req-ffffffff", text: "apple", imageIds: [] }, s, client);
    expect((calls[4].tool_choice as { type: string }).type).toBe("none");
    expect((calls[0].tool_choice as { type: string }).type).toBe("auto");
  });

  it("refines a draft with the user's answers", async () => {
    const { client, calls } = scripted([
      final([item({ name: "Soda", unit: "can", grams_per_unit: 355 })], [{ question: "Regular or diet?", options: ["Regular", "Diet"] }]),
      final([item({ name: "Diet soda", unit: "can", grams_per_unit: 355, estimate_per_100g: { calories: 1, protein: 0, carbs: 0, fat: 0, fiber: null, sugar: null, saturated_fat: null, sodium_mg: 10 } })]),
    ]);
    const { analysis } = await startAnalysis(db, { requestId: "req-gggggggg", text: "a can of soda", imageIds: [] }, s, client);
    const refined = await refineAnalysis(db, analysis.id, { answers: [{ question: "Regular or diet?", answer: "Diet" }] }, s, client);
    expect(refined.draft!.items[0].name).toBe("Diet soda");
    expect(refined.answers).toHaveLength(1);
    const prompt = JSON.stringify(calls[1].messages);
    expect(prompt).toContain("Regular or diet?");
    expect(prompt).toContain("Diet");
    expect((await getAnalysis(db, analysis.id)).draft!.questions).toHaveLength(0);
  });
});

describe("restaurant nutrition lookup", () => {
  const lookupCall = (items: { restaurant: string; item: string }[], id = "tu_r"): Resp => ({
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id, name: "lookup_restaurant_nutrition", input: { items } }],
  });
  const searchResults = (urls: { url: string; title: string }[]) => ({
    type: "web_search_tool_result",
    tool_use_id: "srvtoolu_1",
    content: urls.map((u) => ({ type: "web_search_result", url: u.url, title: u.title, encrypted_content: "enc", page_age: null })),
  });
  const lookupReply = (results: Record<string, unknown>[], urls = [{ url: "https://www.chipotle.com/nutrition-calculator", title: "Chipotle Nutrition" }]): Resp => ({
    stop_reason: "end_turn",
    content: [
      { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "chipotle nutrition" } },
      searchResults(urls),
      // Web search answers come back split into cited text blocks; the app joins them.
      { type: "text", text: '```json\n{"results":' },
      { type: "text", text: `${JSON.stringify(results)}}\n\`\`\``, citations: [{ type: "web_search_result_location", url: urls[0].url, title: urls[0].title, cited_text: "…", encrypted_index: "x" }] },
    ],
  });
  const burrito = {
    index: 0,
    found: true,
    restaurant: "Chipotle",
    item: "Chicken Burrito",
    serving: "1 burrito",
    serving_grams: null,
    calories: 1055,
    protein_g: 58,
    carbs_g: 115,
    fat_g: 39,
    fiber_g: 15,
    sugar_g: null,
    saturated_fat_g: null,
    sodium_mg: 2380,
    source_url: "https://chipotle.com/nutrition-calculator/",
    notes: null,
  };

  it("uses verified published values so totals match the restaurant's numbers", async () => {
    const { client, calls } = scripted([
      lookupCall([{ restaurant: "Chipotle", item: "chicken burrito" }]),
      lookupReply([burrito]),
      final([item({ name: "Chipotle chicken burrito", quantity: 1, unit: "burrito", grams_per_unit: 550, food_ref: "R1", estimate_per_100g: { calories: 190, protein: 10, carbs: 21, fat: 7, fiber: null, sugar: null, saturated_fat: null, sodium_mg: null } })]),
    ]);
    const { analysis } = await startAnalysis(db, { requestId: "req-rrrrrrr1", text: "chipotle chicken burrito", imageIds: [] }, s, client);
    const [b] = analysis.draft!.items;
    expect(b.nutrientSource).toBe("restaurant");
    expect(b.sourceRef).toMatchObject({ provider: "restaurant", url: "https://www.chipotle.com/nutrition-calculator" });
    expect(b.sourceRef!.description).toContain("Chicken Burrito");
    const n = itemNutrients(b);
    expect(n.calories).toBeCloseTo(1055, 6);
    expect(n.protein).toBeCloseTo(58, 6);
    expect(n.sodium).toBeCloseTo(2380, 6);

    // The lookup is its own request: web search only (direct calls), plain text output, no JSON schema.
    const lookup = calls[1] as { tools: { type: string; allowed_callers?: string[]; max_uses?: number }[]; output_config: { format?: unknown } };
    expect(lookup.tools).toEqual([expect.objectContaining({ type: "web_search_20260209", name: "web_search", allowed_callers: ["direct"] })]);
    expect(lookup.output_config.format).toBeUndefined();
    // The main request offers the lookup tool, and gets a compact result back.
    expect((calls[0].tools as { name: string }[]).map((t) => t.name)).toEqual(["search_foods", "lookup_restaurant_nutrition"]);
    const toolResult = (calls[2].messages as { content: { content?: string }[] }[]).at(-1)!.content[0].content!;
    expect(toolResult).toContain('"ref":"R1"');
    expect(toolResult).toContain('"source":"chipotle.com"');

    // Two burritos are exactly twice the published numbers.
    expect(itemNutrients({ ...b, quantity: 2 }).calories).toBeCloseTo(2110, 6);
    // The user can save the draft as-is; the source survives the round trip.
    const { meal } = await createMeal(db, createMealSchema.parse({ eatenAt: "2026-10-26T18:00:00Z", category: "Dinner", title: "Burrito", source: "text", analysisId: analysis.id, items: [b] }), s);
    expect(meal.items[0]).toMatchObject({ nutrientSource: "restaurant", sourceRef: { provider: "restaurant", url: "https://www.chipotle.com/nutrition-calculator" } });
    expect(() => createMealSchema.parse({ eatenAt: "2026-10-26T18:00:00Z", category: "Dinner", title: "x", source: "manual", items: [{ ...b, sourceRef: { ...b.sourceRef, url: "javascript:alert(1)" } }] })).toThrow();
  });

  it("rejects numbers whose source page wasn't in the search results, and implausible values", async () => {
    const facts = await lookupRestaurantNutrition(
      [
        { restaurant: "Chipotle", item: "chicken burrito" },
        { restaurant: "Chipotle", item: "chips" },
        { restaurant: "Nowhere Diner", item: "pie" },
      ],
      scripted([
        lookupReply([
          { ...burrito, source_url: "https://made-up.example.com/burrito" },
          { ...burrito, index: 1, item: "Chips", calories: 99_999, source_url: "https://www.chipotle.com/nutrition-calculator" },
          { index: 2, found: false, notes: "No published nutrition found." },
        ]),
      ]).client,
    );
    expect(facts.facts.map((f) => f.found)).toEqual([false, false, false]);
    expect(facts.facts[0].notes).toMatch(/without a source page/);
    expect(facts.facts[1].notes).toMatch(/implausible/);
    expect(facts.facts[2].notes).toMatch(/No published/);
  });

  it("resumes a paused search turn and flags calories that don't match the macros", async () => {
    const paused: Resp = { stop_reason: "pause_turn", content: [{ type: "server_tool_use", id: "srvtoolu_0", name: "web_search", input: { query: "q" } }] };
    const { client, calls } = scripted([paused, lookupReply([{ ...burrito, calories: 400 }])]);
    const { facts } = await lookupRestaurantNutrition([{ restaurant: "Chipotle", item: "chicken burrito" }], client);
    expect(calls).toHaveLength(2);
    // The paused assistant turn is sent back unchanged, with no extra user message.
    const resumed = calls[1].messages as { role: string }[];
    expect(resumed.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(facts[0].found).toBe(true);
    expect(facts[0].warnings.join(" ")).toMatch(/don't match the macros/);
  });

  it("falls back cleanly when the lookup fails or finds nothing", async () => {
    const failing = {
      beta: {
        messages: {
          create: (() => {
            let n = 0;
            return async () => {
              n += 1;
              if (n === 2) throw new AppError(503, "ai_unavailable", "web search is disabled for this organization");
              return n === 1
                ? { ...lookupCall([{ restaurant: "Chipotle", item: "bowl" }]), usage: { input_tokens: 1, output_tokens: 1 } }
                : { ...final([item({ name: "Burrito bowl", food_ref: "R1" })]), usage: { input_tokens: 1, output_tokens: 1 } };
            };
          })(),
        },
      },
    } as unknown as AnthropicLike;
    const { analysis } = await startAnalysis(db, { requestId: "req-rrrrrrr2", text: "chipotle bowl", imageIds: [] }, s, failing);
    const [bowl] = analysis.draft!.items;
    // R1 was never issued, so the item falls back to the AI estimate and says so.
    expect(bowl.nutrientSource).toBe("ai_estimate");
    expect(bowl.warnings.join(" ")).toMatch(/wasn't in its search results/);
  });

  it("converts gram amounts using the published serving weight", () => {
    const cands = new Candidates();
    const ref = cands.addRestaurant({ query: { restaurant: "Chobani", item: "vanilla" }, found: true, restaurant: "Chobani", item: "Vanilla Greek Yogurt", serving: "1 cup", servingGrams: 150, perServing: { calories: 120, protein: 12, carbs: 15, fat: 0 }, sourceUrl: "https://www.chobani.com/products/vanilla", sourceTitle: null, notes: null, warnings: [] });
    const [y] = resolveItems([item({ name: "Yogurt", quantity: 300, unit: "g", grams_per_unit: 1, food_ref: ref }) as never], cands, new Map());
    expect(y).toMatchObject({ unit: "g", quantity: 300, gramsPerUnit: 1, nutrientSource: "restaurant" });
    expect(itemNutrients(y).calories).toBeCloseTo(240, 6);
  });
});
