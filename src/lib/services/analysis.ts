/**
 * Persistence and idempotency around AI meal analyses. An analysis is a draft:
 * it never affects totals until the user confirms it (or explicitly chose
 * quick-save), which creates a meal through the normal meal service.
 */
import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { mealAnalyses, type MealAnalysis, type Settings } from "../db/schema";
import type { AnalysisView, MealDraft } from "../drafts";
import { AppError, notFound } from "../errors";
import { analyzeMeal } from "../ai/meal-analysis";
import type { AnthropicLike } from "../ai/client";
import { formatTimeInZone, logicalDate } from "../time";
import { getImagesForAnalysis } from "./images";
import { createMeal, type MealView } from "./meals";

export function analysisView(row: MealAnalysis): AnalysisView {
  return {
    id: row.id,
    requestId: row.requestId,
    status: row.status,
    inputType: row.inputType,
    inputText: row.inputText,
    imageIds: row.imageIds,
    draft: (row.result as MealDraft | null) ?? null,
    answers: row.answers,
    error: row.error,
    mealId: row.mealId,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface StartAnalysisInput {
  requestId: string;
  text?: string | null;
  imageIds: string[];
  category?: string | null;
  eatenAt?: Date;
  quickSave?: boolean;
}

/** A pending analysis older than this is considered abandoned and may be re-run. */
const STALE_PENDING_MS = 4 * 60_000;

function localLabel(when: Date, s: Settings): string {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: s.timezone, weekday: "long" }).format(when);
  return `${day} ${formatTimeInZone(when, s.timezone)}`;
}

export async function startAnalysis(
  db: Db,
  input: StartAnalysisInput,
  s: Settings,
  client?: AnthropicLike,
): Promise<{ analysis: AnalysisView; meal: MealView | null }> {
  // Idempotency: a retried request with the same id returns the stored result
  // instead of calling the AI again or creating a second entry.
  const [existing] = await db.select().from(mealAnalyses).where(eq(mealAnalyses.requestId, input.requestId));
  if (existing) {
    const fresh = Date.now() - existing.updatedAt.getTime() < STALE_PENDING_MS;
    if (existing.status === "pending" && fresh) {
      throw new AppError(409, "analysis_in_progress", "This analysis is still running.", { analysisId: existing.id });
    }
    if (existing.status !== "failed" && existing.status !== "pending") {
      return { analysis: analysisView(existing), meal: null };
    }
  }

  const inputType = input.imageIds.length ? "photo" : "text";
  const [row] = existing
    ? await db.update(mealAnalyses).set({ status: "pending", error: null, updatedAt: new Date() }).where(eq(mealAnalyses.id, existing.id)).returning()
    : await db
        .insert(mealAnalyses)
        .values({ requestId: input.requestId, inputType, inputText: input.text ?? null, imageIds: input.imageIds, status: "pending" })
        .onConflictDoNothing({ target: mealAnalyses.requestId })
        .returning();
  if (!row) throw new AppError(409, "analysis_in_progress", "This analysis is already running.");

  try {
    const images = await getImagesForAnalysis(db, input.imageIds);
    const when = input.eatenAt ?? new Date();
    const { draft, usage } = await analyzeMeal(
      db,
      { text: input.text, images, category: input.category, localTimeLabel: localLabel(when, s) },
      client,
    );
    const [done] = await db
      .update(mealAnalyses)
      .set({ status: "completed", result: draft as unknown as Record<string, unknown>, model: draft.model, usage, updatedAt: new Date() })
      .where(eq(mealAnalyses.id, row.id))
      .returning();

    let meal: MealView | null = null;
    if (input.quickSave && draft.items.length > 0) {
      meal = await confirmDraft(db, done, { eatenAt: when, category: input.category ?? draft.suggestedCategory ?? "Snack", title: draft.title, items: draft.items, imageIds: input.imageIds }, s);
    }
    const [final] = await db.select().from(mealAnalyses).where(eq(mealAnalyses.id, row.id));
    return { analysis: analysisView(final), meal };
  } catch (err) {
    const message = err instanceof AppError ? err.message : "Analysis failed";
    await db.update(mealAnalyses).set({ status: "failed", error: message, updatedAt: new Date() }).where(eq(mealAnalyses.id, row.id));
    throw err;
  }
}

export async function getAnalysis(db: Db, id: string): Promise<AnalysisView> {
  const [row] = await db.select().from(mealAnalyses).where(eq(mealAnalyses.id, id));
  if (!row) throw notFound("Analysis");
  return analysisView(row);
}

/** Re-run the analysis with the user's answers to clarifying questions. */
export async function refineAnalysis(
  db: Db,
  id: string,
  input: { answers: { question: string; answer: string }[]; note?: string | null; currentDraft?: MealDraft | null; eatenAt?: Date; category?: string | null },
  s: Settings,
  client?: AnthropicLike,
): Promise<AnalysisView> {
  const [row] = await db.select().from(mealAnalyses).where(eq(mealAnalyses.id, id));
  if (!row) throw notFound("Analysis");
  if (row.status === "confirmed") throw new AppError(409, "already_saved", "This meal was already saved; edit it from the meal page instead.");
  const images = await getImagesForAnalysis(db, row.imageIds);
  const previous = input.currentDraft ?? (row.result as MealDraft | null);
  const when = input.eatenAt ?? new Date();
  const { draft, usage } = await analyzeMeal(
    db,
    { text: row.inputText, images, previous, answers: input.answers, extraNote: input.note, category: input.category, localTimeLabel: localLabel(when, s) },
    client,
  );
  const [updated] = await db
    .update(mealAnalyses)
    .set({ status: "completed", result: draft as unknown as Record<string, unknown>, answers: [...row.answers, ...input.answers], usage, error: null, updatedAt: new Date() })
    .where(eq(mealAnalyses.id, id))
    .returning();
  return analysisView(updated);
}

export async function discardAnalysis(db: Db, id: string): Promise<void> {
  const rows = await db.update(mealAnalyses).set({ status: "discarded", updatedAt: new Date() }).where(eq(mealAnalyses.id, id)).returning({ id: mealAnalyses.id });
  if (rows.length === 0) throw notFound("Analysis");
}

async function confirmDraft(
  db: Db,
  row: MealAnalysis,
  input: { eatenAt: Date; category: string; title: string; items: MealDraft["items"]; imageIds: string[] },
  s: Settings,
): Promise<MealView> {
  const draft = row.result as MealDraft | null;
  const unanswered = draft?.questions.length ? `Unanswered AI questions: ${draft.questions.map((q) => q.question).join(" ")}` : null;
  const { meal } = await createMeal(
    db,
    {
      clientRequestId: `analysis:${row.requestId}`,
      eatenAt: input.eatenAt,
      localDate: logicalDate(input.eatenAt, s.timezone, s.dayStartHour),
      category: input.category,
      title: input.title,
      description: row.inputText,
      source: row.inputType,
      analysisId: row.id,
      notes: [draft?.uncertaintyNotes, unanswered].filter(Boolean).join("\n") || null,
      imageIds: input.imageIds,
      items: input.items.map(({ key: _key, ...rest }) => {
        void _key;
        return rest;
      }),
    },
    s,
  );
  return meal;
}
