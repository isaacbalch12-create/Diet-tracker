/**
 * Restaurant and brand nutrition lookup. A separate Claude request with the
 * server-side web search tool finds the *published* per-serving numbers for
 * named menu items (the restaurant's own nutrition page first), and the app
 * verifies them before use: the cited page must be one the search actually
 * returned, values must be in a plausible range, and calories are checked
 * against the macros. Nothing is estimated here — "not found" is a valid answer.
 *
 * This runs as its own request (not inside the meal-analysis loop) so the
 * meal analysis keeps its strict JSON output, and any web-search failure only
 * means "no restaurant data" instead of a failed analysis.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "../env";
import type { NutrientProfile } from "../nutrition/nutrients";
import { type AnthropicLike, fallbackParams, getAnthropic, toAiError } from "./client";

type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
type BetaContentBlockParam = Anthropic.Beta.BetaContentBlockParam;

export interface RestaurantQuery {
  restaurant: string;
  item: string;
}

export interface RestaurantFact {
  query: RestaurantQuery;
  found: boolean;
  restaurant: string;
  /** The item's name as published by the source. */
  item: string;
  /** Serving as published, e.g. "1 burrito" or "grande (16 fl oz)". */
  serving: string;
  /** Serving weight, only when the source states it. */
  servingGrams: number | null;
  /** Values for one serving, in app units (g; sodium in mg). */
  perServing: NutrientProfile;
  sourceUrl: string | null;
  sourceTitle: string | null;
  notes: string | null;
  warnings: string[];
}

export const LOOKUP_SYSTEM_PROMPT = `You look up published nutrition facts for restaurant menu items and packaged branded foods, for a personal nutrition tracker.

For each requested item:
1. Search the web. Prefer the restaurant's or brand's own nutrition page or nutrition PDF. Use a reputable nutrition site that reproduces the official numbers only when the official source isn't available, and say so in notes.
2. Match the specific menu item, size and customizations as closely as the sources allow. If the size isn't given, use the regular or medium size and say so in notes. For a customizable item (bowls, salads, coffee drinks), report the item as described; if the source only lists components, report the closest standard build and say so in notes.
3. Report the values exactly as published for one serving. Do not calculate, scale or adjust them. Use null for values the source doesn't publish.
4. serving_grams: the serving weight in grams only if the source states it, otherwise null.
5. source_url must be the exact URL of the page where you found the numbers, as it appeared in your search results.
6. If you can't find published numbers, set found to false and explain briefly in notes. Never estimate or invent numbers.

Reply with only a JSON object and no other text, in this shape:
{"results":[{"index":0,"found":true,"restaurant":"Chain name","item":"Item name as published","serving":"1 burrito","serving_grams":null,"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0,"fiber_g":null,"sugar_g":null,"saturated_fat_g":null,"sodium_mg":null,"source_url":"https://...","notes":null}]}
Include one result per requested item, using its index.`;

const nnum = z.number().nullable().optional();
const resultSchema = z.object({
  index: z.number().int(),
  found: z.boolean(),
  restaurant: z.string().max(200).nullable().optional(),
  item: z.string().max(300).nullable().optional(),
  serving: z.string().max(200).nullable().optional(),
  serving_grams: nnum,
  calories: nnum,
  protein_g: nnum,
  carbs_g: nnum,
  fat_g: nnum,
  fiber_g: nnum,
  sugar_g: nnum,
  saturated_fat_g: nnum,
  sodium_mg: nnum,
  source_url: z.string().max(2000).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});
const replySchema = z.object({ results: z.array(resultSchema).max(20) });

const MAX_REQUESTS = 4;

/** Comparable form of a URL: lowercase host, no fragment, no trailing slash. */
export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.hash = "";
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.host.toLowerCase().replace(/^www\./, "")}${path}${u.search}`;
  } catch {
    return null;
  }
}

/** Every page the search actually returned (or cited), keyed by normalized URL. */
function collectSources(content: Anthropic.Beta.BetaContentBlock[], into: Map<string, { url: string; title: string | null }>) {
  for (const block of content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) {
        const key = normalizeUrl(r.url);
        if (key) into.set(key, { url: r.url, title: r.title ?? null });
      }
    } else if (block.type === "text" && block.citations) {
      for (const c of block.citations) {
        if (c.type !== "web_search_result_location") continue;
        const key = normalizeUrl(c.url);
        if (key && !into.has(key)) into.set(key, { url: c.url, title: c.title ?? null });
      }
    }
  }
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

const notFound = (query: RestaurantQuery, notes: string): RestaurantFact => ({
  query,
  found: false,
  restaurant: query.restaurant,
  item: query.item,
  serving: "",
  servingGrams: null,
  perServing: {},
  sourceUrl: null,
  sourceTitle: null,
  notes,
  warnings: [],
});

const inRange = (v: number | null | undefined, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;

/** Turn one model result into a verified fact, or "not found" with the reason. */
export function verifyResult(query: RestaurantQuery, r: z.infer<typeof resultSchema> | undefined, sources: Map<string, { url: string; title: string | null }>): RestaurantFact {
  if (!r) return notFound(query, "The lookup returned no result for this item.");
  if (!r.found) return notFound(query, r.notes ?? "No published nutrition facts found.");
  const key = r.source_url ? normalizeUrl(r.source_url) : null;
  const source = key ? sources.get(key) : undefined;
  if (!source) return notFound(query, "Numbers were reported without a source page from the search results, so they weren't used.");
  if (!inRange(r.calories, 5000) || r.calories <= 0 || !inRange(r.protein_g, 500) || !inRange(r.carbs_g, 1000) || !inRange(r.fat_g, 500)) {
    return notFound(query, "The reported values were incomplete or implausible, so they weren't used.");
  }
  const perServing: NutrientProfile = { calories: r.calories, protein: r.protein_g, carbs: r.carbs_g, fat: r.fat_g };
  if (inRange(r.fiber_g, 200)) perServing.fiber = r.fiber_g;
  if (inRange(r.sugar_g, 1000)) perServing.sugar = r.sugar_g;
  if (inRange(r.saturated_fat_g, 300)) perServing.saturatedFat = r.saturated_fat_g;
  if (inRange(r.sodium_mg, 20_000)) perServing.sodium = r.sodium_mg;
  const warnings: string[] = [];
  // Atwater check: published calories should roughly match 4/4/9 kcal per gram (alcohol is the usual exception).
  const fromMacros = 4 * r.protein_g + 4 * r.carbs_g + 9 * r.fat_g;
  if (r.calories >= 50 && Math.abs(fromMacros - r.calories) / r.calories > 0.4) {
    warnings.push(`The published calories (${Math.round(r.calories)}) don't match the macros (~${Math.round(fromMacros)} kcal) — check the source.`);
  }
  const grams = inRange(r.serving_grams, 5000) && r.serving_grams > 0 ? r.serving_grams : null;
  return {
    query,
    found: true,
    restaurant: r.restaurant?.trim() || query.restaurant,
    item: r.item?.trim() || query.item,
    serving: r.serving?.trim() || "1 serving",
    servingGrams: grams,
    perServing,
    sourceUrl: source.url,
    sourceTitle: source.title,
    notes: r.notes ?? null,
    warnings,
  };
}

/**
 * Look up published nutrition for menu items. Throws an AppError only when the
 * AI service itself fails; items without trustworthy numbers come back as not found.
 */
export async function lookupRestaurantNutrition(queries: RestaurantQuery[], client: AnthropicLike = getAnthropic()): Promise<{ facts: RestaurantFact[]; usage: Record<string, number> }> {
  const usage: Record<string, number> = { input_tokens: 0, output_tokens: 0, web_search_requests: 0 };
  if (!queries.length) return { facts: [], usage };
  const list = queries.map((q, i) => `${i}. ${q.restaurant} — ${q.item}`).join("\n");
  const messages: BetaMessageParam[] = [{ role: "user", content: `Find the published nutrition facts for:\n${list}` }];
  const tools: Anthropic.Beta.BetaWebSearchTool20260209[] = [
    // Direct calls keep the search results (and their URLs) in the response, so sources can be verified.
    { type: "web_search_20260209", name: "web_search", max_uses: Math.min(2 * queries.length + 1, 8), allowed_callers: ["direct"] },
  ];
  const sources = new Map<string, { url: string; title: string | null }>();
  let text = "";
  for (let i = 0; i < MAX_REQUESTS; i++) {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await client.beta.messages.create({
        model: env.anthropicModel,
        max_tokens: 16000,
        system: LOOKUP_SYSTEM_PROMPT,
        tools,
        output_config: { effort: "medium" },
        messages,
        ...fallbackParams(),
      });
    } catch (err) {
      throw toAiError(err);
    }
    usage.input_tokens += response.usage.input_tokens ?? 0;
    usage.output_tokens += response.usage.output_tokens ?? 0;
    usage.web_search_requests += response.usage.server_tool_use?.web_search_requests ?? 0;
    collectSources(response.content, sources);
    if (response.stop_reason === "pause_turn") {
      // The server paused a long search turn; send it back unchanged to resume.
      messages.push({ role: "assistant", content: response.content as BetaContentBlockParam[] });
      continue;
    }
    if (response.stop_reason === "refusal") return { facts: queries.map((q) => notFound(q, "The lookup was declined.")), usage };
    text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    break;
  }
  const parsed = replySchema.safeParse(extractJson(text));
  if (!parsed.success) return { facts: queries.map((q) => notFound(q, "The lookup didn't return readable results.")), usage };
  const byIndex = new Map(parsed.data.results.map((r) => [r.index, r]));
  return { facts: queries.map((q, i) => verifyResult(q, byIndex.get(i), sources)), usage };
}
