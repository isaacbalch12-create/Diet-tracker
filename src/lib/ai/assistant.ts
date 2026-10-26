/**
 * Nutrition assistant: a Claude tool-use loop over the user's own data. Read
 * tools return stored data and deterministic statistics; changes are only ever
 * *proposed* and require the user's confirmation in the UI.
 *
 * The conversation history is stored verbatim (exact content blocks, including
 * thinking blocks) and replayed append-only, with a fixed system prompt and
 * tool list, so the prompt cache and thinking-block validity are preserved.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { asc, desc, eq, max } from "drizzle-orm";
import type { Db } from "../db";
import { assistantActions, chatConversations, chatMessages, type AssistantAction, type Settings } from "../db/schema";
import { env } from "../env";
import { AppError, notFound } from "../errors";
import { dayOfWeek, type LocalDate } from "../time";
import { ASSISTANT_TOOLS, runAssistantTool } from "./assistant-tools";
import { type AnthropicLike, fallbackParams, getAnthropic, toAiError } from "./client";

type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
type BetaContentBlockParam = Anthropic.Beta.BetaContentBlockParam;

export const ASSISTANT_SYSTEM_PROMPT = `You are the nutrition assistant inside a person's private diet, macro and weight tracker. You help them understand their own logged data: food logs, nutrient totals, goals, weigh-ins and long-term trends.

Ground rules:
- Every number about the person (intake, weights, averages, trends, rankings) must come from a tool result in this conversation. Never estimate, invent or "fill in" their data. If a tool shows no data or too little data, say so plainly and suggest what to log.
- Call tools with explicit dates. Each user message starts with a context line giving today's date, weekday, time zone and weight unit; resolve "today", "yesterday", "this week", "last 30 days" etc. from it. "This week" means the current calendar week so far unless they say otherwise.
- Days without logged meals are missing data, not zero-calorie days; averages cover logged days only. Mention how complete the data is (e.g. "18 of 30 days logged") whenever it affects the answer.
- Treat patterns as tentative when data are limited, and never present a correlation as proof of cause. Calorie-expenditure or weight-change figures are rough estimates, not measurements.
- Suggestions should be practical, specific to their own goals and data, encouraging and non-judgmental. Don't push extreme restriction, and don't give medical advice — suggest a doctor or registered dietitian for medical questions.
- You cannot change records yourself. To log a weight, change goals, delete an entry, or start logging food, call propose_action; the app shows the person a Confirm button. Then tell them it's waiting for their confirmation — never say it has been done. For deletions, look up the exact meal or entry id with a read tool first.
- Weights in tool results are already in the person's preferred unit.

Style: lead with the direct answer, then the supporting numbers. Be concise; use short markdown lists or a small table when comparing. Round sensibly (calories to the nearest 10, grams to whole numbers, weight to 0.1).`;

export type AssistantEvent =
  | { type: "conversation"; id: string; title: string }
  | { type: "text"; delta: string }
  | { type: "turn" }
  | { type: "tool"; id: string; name: string; status: "start" | "done" | "error" }
  | { type: "action"; action: AssistantAction }
  | { type: "done" }
  | { type: "error"; message: string };

const MAX_TURNS = 8;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function contextLine(today: LocalDate, s: Settings): string {
  return `[Context: today is ${WEEKDAYS[dayOfWeek(today)]} ${today}; time zone ${s.timezone}; weight unit ${s.weightUnit}; weeks start on ${s.weekStartsOn === 0 ? "Sunday" : "Monday"}.]`;
}

async function nextSeq(db: Db, conversationId: string): Promise<number> {
  const [row] = await db.select({ m: max(chatMessages.seq) }).from(chatMessages).where(eq(chatMessages.conversationId, conversationId));
  return (row?.m ?? -1) + 1;
}

async function loadHistory(db: Db, conversationId: string): Promise<BetaMessageParam[]> {
  const rows = await db.select().from(chatMessages).where(eq(chatMessages.conversationId, conversationId)).orderBy(asc(chatMessages.seq));
  return rows.map((r) => ({ role: r.role, content: JSON.parse(r.content) as BetaContentBlockParam[] }));
}

export async function listConversations(db: Db) {
  return db.select().from(chatConversations).orderBy(desc(chatConversations.updatedAt)).limit(50);
}

/** Transcript for display: visible messages, with consecutive assistant turns merged. */
export async function getConversation(db: Db, id: string) {
  const [conv] = await db.select().from(chatConversations).where(eq(chatConversations.id, id));
  if (!conv) throw notFound("Conversation");
  const rows = await db.select().from(chatMessages).where(eq(chatMessages.conversationId, id)).orderBy(asc(chatMessages.seq));
  const messages: { role: "user" | "assistant"; text: string; createdAt: Date }[] = [];
  for (const r of rows) {
    if (!r.visible) continue;
    const last = messages.at(-1);
    if (r.role === "assistant" && last?.role === "assistant") {
      if (r.displayText) last.text = last.text ? `${last.text}\n\n${r.displayText}` : r.displayText;
    } else {
      messages.push({ role: r.role, text: r.displayText, createdAt: r.createdAt });
    }
  }
  const actions = await db.select().from(assistantActions).where(eq(assistantActions.conversationId, id)).orderBy(asc(assistantActions.createdAt));
  return { conversation: conv, messages, actions };
}

export async function deleteConversation(db: Db, id: string) {
  const rows = await db.delete(chatConversations).where(eq(chatConversations.id, id)).returning({ id: chatConversations.id });
  if (rows.length === 0) throw notFound("Conversation");
}

export async function runAssistant(
  db: Db,
  input: { conversationId?: string | null; message: string },
  s: Settings,
  today: LocalDate,
  emit: (e: AssistantEvent) => void,
  client?: AnthropicLike,
): Promise<void> {
  const anthropic = client ?? getAnthropic();
  let conversationId = input.conversationId ?? null;
  if (conversationId) {
    const [conv] = await db.select().from(chatConversations).where(eq(chatConversations.id, conversationId));
    if (!conv) throw notFound("Conversation");
    emit({ type: "conversation", id: conv.id, title: conv.title });
  } else {
    const title = input.message.trim().replace(/\s+/g, " ").slice(0, 60) || "New conversation";
    const [conv] = await db.insert(chatConversations).values({ title }).returning();
    conversationId = conv.id;
    emit({ type: "conversation", id: conv.id, title });
  }

  const history = await loadHistory(db, conversationId);
  const userContent: BetaContentBlockParam[] = [{ type: "text", text: `${contextLine(today, s)}\n\n${input.message.trim()}` }];
  let seq = await nextSeq(db, conversationId);
  await db.insert(chatMessages).values({ conversationId, seq: seq++, role: "user", content: JSON.stringify(userContent), displayText: input.message.trim(), visible: true });
  const messages: BetaMessageParam[] = [...history, { role: "user", content: userContent }];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (turn > 0) emit({ type: "turn" });
    let final: Anthropic.Beta.BetaMessage;
    try {
      const stream = anthropic.beta.messages.stream({
        model: env.anthropicModel,
        max_tokens: 32000,
        cache_control: { type: "ephemeral" },
        system: ASSISTANT_SYSTEM_PROMPT,
        tools: ASSISTANT_TOOLS,
        // On the last allowed turn, require a written answer from what has been gathered.
        tool_choice: turn === MAX_TURNS - 1 ? { type: "none" } : { type: "auto" },
        output_config: { effort: "medium" },
        messages,
        ...fallbackParams(),
      });
      stream.on("text", (delta: string) => emit({ type: "text", delta }));
      final = await stream.finalMessage();
    } catch (err) {
      throw toAiError(err);
    }

    const assistantContent = final.content as BetaContentBlockParam[];
    const text = final.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    const toolUses = final.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");

    if (final.stop_reason === "refusal") {
      emit({ type: "error", message: "The assistant couldn't answer that request. Try rephrasing it." });
      // Do not persist a refused (possibly partial) turn.
      break;
    }
    const runTools = final.stop_reason === "tool_use" && toolUses.length > 0;
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    if (runTools) {
      for (const tu of toolUses) {
        emit({ type: "tool", id: tu.id, name: tu.name, status: "start" });
        try {
          const out = (await runAssistantTool({ db, settings: s, today, conversationId }, tu.name, tu.input)) as Record<string, unknown>;
          if (tu.name === "propose_action" && out && "_action" in out) {
            emit({ type: "action", action: out._action as AssistantAction });
            delete out._action;
          }
          results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) });
          emit({ type: "tool", id: tu.id, name: tu.name, status: "done" });
        } catch (err) {
          const msg = err instanceof AppError ? err.message : err instanceof Error && err.name === "ZodError" ? `Invalid tool input: ${err.message.slice(0, 400)}` : "Tool failed";
          results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: msg });
          emit({ type: "tool", id: tu.id, name: tu.name, status: "error" });
        }
      }
    }

    // Persist the assistant turn together with its tool results so history is never left with an unanswered tool call.
    await db.insert(chatMessages).values({ conversationId, seq: seq++, role: "assistant", content: JSON.stringify(assistantContent), displayText: text, visible: true });
    messages.push({ role: "assistant", content: assistantContent });
    if (runTools) {
      await db.insert(chatMessages).values({ conversationId, seq: seq++, role: "user", content: JSON.stringify(results), displayText: "", visible: false });
      messages.push({ role: "user", content: results });
      continue;
    }
    if (final.stop_reason === "max_tokens") emit({ type: "error", message: "The answer was cut off because it was too long. Ask a narrower question." });
    break;
  }
  await db.update(chatConversations).set({ updatedAt: new Date() }).where(eq(chatConversations.id, conversationId));
  emit({ type: "done" });
}
