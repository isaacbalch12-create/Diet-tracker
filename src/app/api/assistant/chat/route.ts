import { z } from "zod";
import { assertAuthorized, errorResponse } from "@/lib/api";
import { runAssistant, type AssistantEvent } from "@/lib/ai/assistant";
import { getAnthropic } from "@/lib/ai/client";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getSettings, settingsToday } from "@/lib/services/settings";

export const maxDuration = 300;

const schema = z.object({
  conversationId: z.uuid().nullable().optional(),
  message: z.string().trim().min(1).max(4000),
});

/** Streams newline-delimited JSON events (see AssistantEvent). */
export async function POST(req: Request) {
  let input: z.infer<typeof schema>;
  try {
    await assertAuthorized(req);
    input = schema.parse(await req.json());
    getAnthropic(); // fail fast with a clear error when AI is not configured
  } catch (err) {
    return errorResponse(err);
  }
  const db = await getDb();
  const settings = await getSettings(db);
  const today = settingsToday(settings);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AssistantEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      try {
        await runAssistant(db, input, settings, today, emit);
      } catch (err) {
        const message = err instanceof AppError ? err.message : "The assistant hit an unexpected error.";
        if (!(err instanceof AppError)) console.error("assistant error", err);
        emit({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
