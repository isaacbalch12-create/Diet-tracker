import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { requestAuth } from "./auth";
import { getDb, type Db } from "./db";
import type { Settings } from "./db/schema";
import { AppError } from "./errors";
import { getSettings, settingsToday } from "./services/settings";
import { addDays, diffDays, presetRange, RANGE_PRESETS, type LocalDate, type RangePreset } from "./time";
import { rangeQuerySchema } from "./validation";

export interface Ctx {
  db: Db;
  settings: Settings;
  today: LocalDate;
}

export async function assertAuthorized(req: Request): Promise<void> {
  const auth = await requestAuth(req);
  if (auth === "misconfigured") throw new AppError(503, "auth_not_configured", "Server is missing APP_PASSWORD and/or SESSION_SECRET.");
  if (auth === "unauthorized") throw new AppError(401, "unauthorized", "Please sign in");
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AppError) {
    return NextResponse.json({ error: { code: err.code, message: err.message, details: err.details ?? undefined } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    const first = issues[0];
    return NextResponse.json(
      { error: { code: "invalid_input", message: first ? `${first.path ? `${first.path}: ` : ""}${first.message}` : "Invalid input", details: issues } },
      { status: 400 },
    );
  }
  console.error("Unhandled API error", err);
  return NextResponse.json({ error: { code: "internal", message: "Something went wrong on the server. Your data was not changed." } }, { status: 500 });
}

/** Wrap a route handler with DB/settings context and consistent error handling. */
export function route<P = Record<string, string>>(fn: (req: Request, ctx: Ctx, params: P) => Promise<Response | unknown>) {
  return async (req: Request, context: { params: Promise<P> }) => {
    try {
      await assertAuthorized(req);
      const db = await getDb();
      const settings = await getSettings(db);
      const params = (await context?.params) ?? ({} as P);
      const out = await fn(req, { db, settings, today: settingsToday(settings) }, params);
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError(400, "invalid_json", "Request body must be JSON");
  }
  return schema.parse(body);
}

export function query(req: Request): URLSearchParams {
  return new URL(req.url).searchParams;
}

/**
 * Date range from `?range=7d|30d|90d|6m|1y|all` or `?start=&end=`, ending today by default.
 * "all" starts at `earliest` (the first record) when given.
 */
export function rangeFromQuery(req: Request, today: LocalDate, earliest?: LocalDate | null, fallback: RangePreset = "30d"): { start: LocalDate; end: LocalDate } {
  const q = query(req);
  const preset = q.get("range");
  if (preset && (RANGE_PRESETS as readonly string[]).includes(preset)) return presetRange(preset as RangePreset, today, earliest);
  const start = q.get("start");
  const end = q.get("end");
  if (start || end) {
    const r = rangeQuerySchema.parse({ start: start ?? addDays(end ?? today, -29), end: end ?? today });
    if (r.start > r.end) throw new AppError(400, "bad_range", "Start date must be before end date");
    if (diffDays(r.start, r.end) > 3660) throw new AppError(400, "bad_range", "Range is limited to 10 years");
    return r;
  }
  return presetRange(fallback, today, earliest);
}
