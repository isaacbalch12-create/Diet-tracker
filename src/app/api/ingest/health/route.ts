import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { authenticateIngest, ingestHealth, recordIngestError } from "@/lib/services/health";
import { getSettings, settingsToday } from "@/lib/services/settings";

/**
 * Token-authenticated endpoint that phone exporters (iOS Shortcut, Health Auto
 * Export, Android exporters) POST health data to. It does not use the browser
 * session: the bearer token identifies a connection created in Health → Connections.
 */
export async function POST(req: Request) {
  try {
    const db = await getDb();
    const conn = await authenticateIngest(db, req.headers.get("authorization"));
    const text = await req.text();
    if (text.length > 5_000_000) throw new AppError(413, "too_large", "Payload over 5 MB — sync fewer days at a time.");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      await recordIngestError(db, conn.id, "Body was not valid JSON");
      throw new AppError(400, "invalid_json", "Body must be JSON");
    }
    const settings = await getSettings(db);
    const result = await ingestHealth(db, conn, body, settings, settingsToday(settings));
    return NextResponse.json(result, { status: result.status === "error" ? 422 : 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
