/**
 * Assistant loop tests with a scripted streaming client: verifies tools read real
 * stored data, history is persisted/replayed verbatim, and record changes only
 * happen after explicit confirmation.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { runAssistant, getConversation, type AssistantEvent } from "@/lib/ai/assistant";
import { runAssistantTool } from "@/lib/ai/assistant-tools";
import type { AnthropicLike } from "@/lib/ai/client";
import { createMemoryDb, type Db } from "@/lib/db";
import type { Settings } from "@/lib/db/schema";
import { createMeal } from "@/lib/services/meals";
import { resolveAction } from "@/lib/services/assistant-actions";
import { setGoals, updateSettings } from "@/lib/services/settings";
import { daySummary } from "@/lib/services/stats";
import { createWeight, listWeights } from "@/lib/services/weights";
import { createMealSchema, weightInputSchema } from "@/lib/validation";

type Msg = { stop_reason: string; content: Record<string, unknown>[] };

function scriptedStream(responses: Msg[]) {
  const calls: { messages: unknown[]; tool_choice: unknown }[] = [];
  const client = {
    beta: {
      messages: {
        stream: (params: { messages: unknown[]; tool_choice: unknown }) => {
          calls.push(JSON.parse(JSON.stringify(params)));
          const r = responses.shift();
          const handlers: ((t: string) => void)[] = [];
          return {
            on(event: string, cb: (t: string) => void) {
              if (event === "text") handlers.push(cb);
              return this;
            },
            async finalMessage() {
              if (!r) throw new Error("no scripted response");
              for (const b of r.content) if (b.type === "text") handlers.forEach((h) => h(b.text as string));
              return { ...r, usage: { input_tokens: 1, output_tokens: 1 } };
            },
          };
        },
      },
    },
  } as unknown as AnthropicLike;
  return { client, calls };
}

const thinking = { type: "thinking", thinking: "", signature: "sig-abc123" };

let db: Db;
let s: Settings;
const today = "2026-10-26";

async function seed() {
  await setGoals(db, { calories: 2200, protein: 160 }, "2026-10-01");
  const meal = (title: string, eatenAt: string, items: { name: string; grams: number; kcal: number; protein: number }[]) =>
    createMeal(
      db,
      createMealSchema.parse({
        eatenAt,
        category: "Lunch",
        title,
        source: "manual",
        items: items.map((i) => ({ name: i.name, quantity: 1, unit: "serving", gramsPerUnit: i.grams, nutrientsPer100g: { calories: i.kcal, protein: i.protein }, nutrientSource: "database", quantitySource: "user_stated" })),
      }),
      s,
    );
  await meal("Chicken bowl", "2026-10-26T17:00:00Z", [{ name: "Grilled chicken", grams: 200, kcal: 165, protein: 31 }, { name: "Rice", grams: 200, kcal: 130, protein: 2.7 }]);
  await meal("Bagel", "2026-10-25T13:00:00Z", [{ name: "Bagel", grams: 100, kcal: 250, protein: 10 }]);
  await meal("Chicken bowl", "2026-10-24T17:00:00Z", [{ name: "Grilled chicken", grams: 150, kcal: 165, protein: 31 }, { name: "Rice", grams: 150, kcal: 130, protein: 2.7 }]);
}

beforeEach(async () => {
  db = await createMemoryDb();
  s = await updateSettings(db, { timezone: "America/Chicago", weightUnit: "lb" });
  await seed();
});

describe("assistant tools", () => {
  const ctx = () => ({ db, settings: s, today, conversationId: null });

  it("reports today's actual protein and remaining goal", async () => {
    const out = (await runAssistantTool(ctx(), "get_day", { date: today })) as { totals: Record<string, number>; goals: Record<string, { remaining: number }> };
    expect(out.totals.protein_g).toBeCloseTo(62 + 5.4, 1);
    expect(out.goals.protein.remaining).toBeCloseTo(160 - 67.4, 1);
  });

  it("ranks meals by protein per calorie and by frequency", async () => {
    const byDensity = (await runAssistantTool(ctx(), "get_food_rankings", { start_date: "2026-10-01", end_date: today, level: "meal", sort_by: "protein_per_100kcal", limit: 5 })) as { results: { name: string }[] };
    expect(byDensity.results[0].name).toBe("Chicken bowl");
    const byFreq = (await runAssistantTool(ctx(), "get_food_rankings", { start_date: "2026-10-01", end_date: today, level: "food", sort_by: "frequency", limit: 5 })) as { results: { name: string; times_logged: number }[] };
    expect(byFreq.results[0].times_logged).toBe(2);
  });

  it("states missing data instead of inventing it", async () => {
    const out = (await runAssistantTool(ctx(), "get_nutrition_stats", { start_date: "2026-01-01", end_date: "2026-01-31" })) as { logged_days: number; note: string };
    expect(out.logged_days).toBe(0);
    expect(out.note).toMatch(/No meals logged/);
  });

  it("compares periods and validates tool input", async () => {
    const out = (await runAssistantTool(ctx(), "compare_periods", { a_start: "2026-10-24", a_end: "2026-10-25", b_start: "2026-10-26", b_end: "2026-10-26" })) as { period_a: { logged_days: number } };
    expect(out.period_a.logged_days).toBe(2);
    await expect(runAssistantTool(ctx(), "get_meals", { start_date: "2026-10-30", end_date: "2026-10-01", search: null })).rejects.toThrow();
  });
});

describe("assistant conversation loop", () => {
  it("answers from tool data, streams text, and replays history verbatim", async () => {
    const { client, calls } = scriptedStream([
      { stop_reason: "tool_use", content: [thinking, { type: "tool_use", id: "tu1", name: "get_day", input: { date: today } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "You've had **67 g** of protein today." }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Yesterday you had a bagel." }] },
    ]);
    const events: AssistantEvent[] = [];
    await runAssistant(db, { message: "How much protein have I eaten today?" }, s, today, (e) => events.push(e), client);
    const conv = events.find((e) => e.type === "conversation") as { id: string };
    expect(events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("")).toContain("67 g");
    expect(events.some((e) => e.type === "tool" && e.status === "done")).toBe(true);

    // The tool result sent back to the model carries the real totals.
    const toolResultMsg = (calls[1].messages as { content: { type: string; content: string }[] }[]).at(-1)!;
    expect(toolResultMsg.content[0].content).toContain('"protein_g":67.4');
    expect((calls[0].messages as { content: { text: string }[] }[])[0].content[0].text).toMatch(/^\[Context: today is Monday 2026-10-26/);

    await runAssistant(db, { conversationId: conv.id, message: "And yesterday?" }, s, today, () => undefined, client);
    // Second exchange replays the first one verbatim, including the thinking block and its signature.
    const replay = calls[2].messages as { role: string; content: Record<string, unknown>[] }[];
    expect(replay).toHaveLength(5);
    expect(replay[1].content[0]).toEqual(thinking);

    const transcript = await getConversation(db, conv.id);
    expect(transcript.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("only proposes changes; records change after explicit confirmation", async () => {
    const day = await daySummary(db, "2026-10-25");
    const mealId = day.meals[0].id;
    const { client } = scriptedStream([
      {
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tu1",
            name: "propose_action",
            input: { action: "delete_meal", summary: "Delete the bagel from Oct 25", weight_value: null, weight_unit: null, period: null, date: null, meal_id: mealId, weight_entry_id: null, calories: null, protein: null, carbs: null, fat: null, food_text: null },
          },
          {
            type: "tool_use",
            id: "tu2",
            name: "propose_action",
            input: { action: "log_weight", summary: "Log 181.2 lb this morning", weight_value: 181.2, weight_unit: "lb", period: "morning", date: null, meal_id: null, weight_entry_id: null, calories: null, protein: null, carbs: null, fat: null, food_text: null },
          },
        ],
      },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Press Confirm to apply these." }] },
    ]);
    const events: AssistantEvent[] = [];
    await runAssistant(db, { message: "delete the bagel and log 181.2 this morning" }, s, today, (e) => events.push(e), client);
    const actions = events.filter((e) => e.type === "action").map((e) => (e as { action: { id: string; status: string } }).action);
    expect(actions).toHaveLength(2);
    expect(actions.every((a) => a.status === "pending")).toBe(true);

    // Nothing changed yet.
    expect((await daySummary(db, "2026-10-25")).meals).toHaveLength(1);
    expect(await listWeights(db)).toHaveLength(0);

    await resolveAction(db, actions[0].id, "confirm", s, today);
    expect((await daySummary(db, "2026-10-25")).meals).toHaveLength(0);
    await resolveAction(db, actions[1].id, "dismiss", s, today);
    expect(await listWeights(db)).toHaveLength(0);
    await expect(resolveAction(db, actions[1].id, "confirm", s, today)).rejects.toThrow(/already dismissed/);
  });

  it("reports a weight conflict instead of overwriting on confirm", async () => {
    await createWeight(db, weightInputSchema.parse({ value: 180, unit: "lb", period: "morning", localDate: today, measuredAt: "2026-10-26T12:00:00Z" }), s);
    const { client } = scriptedStream([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu1", name: "propose_action", input: { action: "log_weight", summary: "Log 182 lb", weight_value: 182, weight_unit: "lb", period: "morning", date: today, meal_id: null, weight_entry_id: null, calories: null, protein: null, carbs: null, fat: null, food_text: null } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Confirm to log it." }] },
    ]);
    const events: AssistantEvent[] = [];
    await runAssistant(db, { message: "log 182" }, s, today, (e) => events.push(e), client);
    const action = (events.find((e) => e.type === "action") as { action: { id: string } }).action;
    await expect(resolveAction(db, action.id, "confirm", s, today)).rejects.toThrow(/already logged/);
    expect((await listWeights(db))[0].inputValue).toBe(180);
  });
});
