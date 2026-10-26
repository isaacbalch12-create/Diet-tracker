/** Executes assistant-proposed changes — only when the user explicitly confirms. */
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db";
import { assistantActions, type AssistantAction, type Settings } from "../db/schema";
import { AppError, notFound } from "../errors";
import type { LocalDate } from "../time";
import { zonedToInstant } from "../time";
import { deleteMeal } from "./meals";
import { setGoals } from "./settings";
import { createWeight, deleteWeight } from "./weights";

export async function resolveAction(db: Db, id: string, decision: "confirm" | "dismiss", s: Settings, today: LocalDate): Promise<AssistantAction> {
  const [action] = await db.select().from(assistantActions).where(eq(assistantActions.id, id));
  if (!action) throw notFound("Proposed action");
  if (action.status !== "pending") throw new AppError(409, "already_resolved", `This proposal was already ${action.status}.`);

  if (decision === "dismiss") {
    const [row] = await db.update(assistantActions).set({ status: "dismissed", resolvedAt: new Date() }).where(eq(assistantActions.id, id)).returning();
    return row;
  }

  let result: Record<string, unknown>;
  try {
    const p = action.payload;
    switch (action.type) {
      case "log_weight": {
        const input = z.object({ value: z.number().positive(), unit: z.enum(["kg", "lb"]), period: z.enum(["morning", "night"]), localDate: z.string() }).parse(p);
        const isToday = input.localDate === today;
        const entry = await createWeight(
          db,
          {
            value: input.value,
            unit: input.unit,
            period: input.period,
            localDate: input.localDate,
            measuredAt: isToday ? new Date() : zonedToInstant(input.localDate, input.period === "morning" ? "07:00" : "22:00", s.timezone),
          },
          s,
        );
        result = { weightEntryId: entry.id };
        break;
      }
      case "update_goals": {
        const input = z.object({ calories: z.number().nullable(), protein: z.number().nullable(), carbs: z.number().nullable(), fat: z.number().nullable() }).parse(p);
        const goal = await setGoals(db, input, today);
        result = { effectiveFrom: goal.effectiveFrom };
        break;
      }
      case "delete_meal":
        await deleteMeal(db, z.object({ mealId: z.uuid() }).parse(p).mealId);
        result = { deleted: true };
        break;
      case "delete_weight_entry":
        await deleteWeight(db, z.object({ weightEntryId: z.uuid() }).parse(p).weightEntryId);
        result = { deleted: true };
        break;
      case "open_food_logger": {
        const input = z.object({ text: z.string(), date: z.string().nullable().optional() }).parse(p);
        const qs = new URLSearchParams({ text: input.text });
        if (input.date) qs.set("date", input.date);
        result = { redirect: `/log?${qs.toString()}` };
        break;
      }
      default:
        throw new AppError(400, "unknown_action", "Unknown action type");
    }
  } catch (err) {
    const message = err instanceof AppError ? err.message : "The change could not be applied.";
    await db.update(assistantActions).set({ status: "failed", result: { error: message }, resolvedAt: new Date() }).where(eq(assistantActions.id, id));
    throw err instanceof AppError ? err : new AppError(400, "action_failed", message);
  }
  const [row] = await db.update(assistantActions).set({ status: "confirmed", result, resolvedAt: new Date() }).where(eq(assistantActions.id, id)).returning();
  return row;
}
