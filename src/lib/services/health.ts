/**
 * Phone health data. A web app cannot read Apple Health (HealthKit) or Android
 * Health Connect directly — both are on-device APIs available only to native
 * apps. Data therefore arrives through a token-authenticated ingest endpoint
 * that a phone-side exporter posts to (an iOS Shortcut, the Health Auto Export
 * app, or an Android/other exporter). See docs/health-integration.md.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lte, min } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "../db";
import { healthConnections, healthDaily, healthSyncEvents, type HealthConnection, type HealthDaily, type HealthMetric, type HealthPlatform, type Settings } from "../db/schema";
import { AppError, badRequest, notFound } from "../errors";
import { HEALTH_METRIC_BY_KEY, HEALTH_METRIC_KEYS } from "../health/metrics";
import { parseHealthPayload } from "../health/ingest";
import { addDays, eachDate, monthKey, startOfWeek, type LocalDate } from "../time";
import { localDateSchema } from "../validation";

export const PLATFORM_LABEL: Record<HealthPlatform, string> = {
  ios_shortcut: "Apple Health (iOS Shortcut)",
  health_auto_export: "Apple Health (Health Auto Export)",
  android: "Android Health Connect exporter",
  other: "Other exporter",
};

export const connectionInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  platform: z.enum(["ios_shortcut", "health_auto_export", "android", "other"]),
  scopes: z.array(z.enum(HEALTH_METRIC_KEYS as [HealthMetric, ...HealthMetric[]])).min(1, "Choose at least one kind of data"),
});

export const connectionPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  scopes: z.array(z.enum(HEALTH_METRIC_KEYS as [HealthMetric, ...HealthMetric[]])).min(1).optional(),
});

export const manualHealthSchema = z.object({
  localDate: localDateSchema,
  metric: z.enum(["steps", "sleep", "resting_hr", "hrv", "active_energy"]),
  value: z.number().min(0).max(200_000),
  /** Sleep stage minutes, when known. */
  stages: z.object({ deep: z.number().min(0).max(1200).nullable(), rem: z.number().min(0).max(1200).nullable(), core: z.number().min(0).max(1200).nullable(), awake: z.number().min(0).max(1200).nullable() }).partial().optional(),
});

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type PublicConnection = Omit<HealthConnection, "tokenHash">;
const publicConnection = ({ tokenHash: _t, ...c }: HealthConnection): PublicConnection => {
  void _t;
  return c;
};

/** Create a connection. The token is returned once and only its hash is stored. */
export async function createConnection(db: DbOrTx, input: z.infer<typeof connectionInputSchema>): Promise<{ connection: PublicConnection; token: string }> {
  const token = `hk_${randomBytes(24).toString("base64url")}`;
  const [row] = await db
    .insert(healthConnections)
    .values({ name: input.name, platform: input.platform, scopes: [...new Set(input.scopes)], tokenHash: hashToken(token), tokenPrefix: token.slice(0, 9) })
    .returning();
  return { connection: publicConnection(row), token };
}

export async function updateConnection(db: DbOrTx, id: string, input: z.infer<typeof connectionPatchSchema>): Promise<PublicConnection> {
  const patch: Partial<typeof healthConnections.$inferInsert> = {};
  if (input.name) patch.name = input.name;
  if (input.scopes) patch.scopes = [...new Set(input.scopes)];
  const [row] = await db.update(healthConnections).set(patch).where(eq(healthConnections.id, id)).returning();
  if (!row) throw notFound("Connection");
  return publicConnection(row);
}

/** Revoke a connection's token immediately. Its data stays unless deleted separately. */
export async function revokeConnection(db: DbOrTx, id: string): Promise<void> {
  const rows = await db.update(healthConnections).set({ revokedAt: new Date() }).where(and(eq(healthConnections.id, id), isNull(healthConnections.revokedAt))).returning({ id: healthConnections.id });
  if (!rows.length) throw notFound("Active connection");
}

/** Delete every value a source contributed (a connection id, or "manual"). */
export async function deleteSourceData(db: DbOrTx, source: string): Promise<number> {
  const rows = await db.delete(healthDaily).where(eq(healthDaily.source, source)).returning({ id: healthDaily.id });
  return rows.length;
}

export async function listConnections(db: DbOrTx) {
  const conns = await db.select().from(healthConnections).orderBy(desc(healthConnections.createdAt));
  const events = conns.length
    ? await db.select().from(healthSyncEvents).where(inArray(healthSyncEvents.connectionId, conns.map((c) => c.id))).orderBy(desc(healthSyncEvents.receivedAt)).limit(200)
    : [];
  return conns.map((c) => ({ ...publicConnection(c), platformLabel: PLATFORM_LABEL[c.platform], recentEvents: events.filter((e) => e.connectionId === c.id).slice(0, 5) }));
}

export async function authenticateIngest(db: DbOrTx, authHeader: string | null): Promise<HealthConnection> {
  const token = authHeader?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) throw new AppError(401, "missing_token", "Send the connection token as: Authorization: Bearer <token>");
  const [conn] = await db.select().from(healthConnections).where(eq(healthConnections.tokenHash, hashToken(token)));
  if (!conn) throw new AppError(401, "invalid_token", "Unknown token. Create a connection in Health → Connections.");
  if (conn.revokedAt) throw new AppError(401, "revoked_token", "This connection was revoked. Create a new one in Health → Connections.");
  return conn;
}

export interface IngestResult {
  status: "ok" | "partial" | "error";
  format: string;
  accepted: number;
  days: LocalDate[];
  byMetric: Partial<Record<HealthMetric, number>>;
  ignored: { item: string; reason: string }[];
}

/**
 * Apply a payload: values for metrics outside the connection's scopes are
 * ignored; each (day, metric, source) is upserted, so repeated syncs replace
 * rather than duplicate.
 */
export async function ingestHealth(db: DbOrTx, conn: HealthConnection, body: unknown, s: Settings, today: LocalDate): Promise<IngestResult> {
  const parsed = parseHealthPayload(body, s.timezone);
  const ignored = [...parsed.ignored];
  const accepted = parsed.records.filter((r) => {
    if (!conn.scopes.includes(r.metric)) {
      ignored.push({ item: `${r.metric} ${r.date}`, reason: "this connection is not allowed to write this kind of data (change it in Health → Connections)" });
      return false;
    }
    if (r.date > addDays(today, 1)) {
      ignored.push({ item: `${r.metric} ${r.date}`, reason: "date is in the future" });
      return false;
    }
    return true;
  });
  const source = `conn:${conn.id}`;
  const label = `${PLATFORM_LABEL[conn.platform]} · ${conn.name}`;
  const now = new Date();
  for (const r of accepted) {
    await db
      .insert(healthDaily)
      .values({ localDate: r.date, metric: r.metric, value: r.value, unit: r.unit, source, sourceLabel: label, origin: r.origin, connectionId: conn.id, details: r.details, syncedAt: now })
      .onConflictDoUpdate({
        target: [healthDaily.localDate, healthDaily.metric, healthDaily.source],
        set: { value: r.value, unit: r.unit, sourceLabel: label, origin: r.origin, details: r.details, syncedAt: now, updatedAt: now },
      });
  }
  const byMetric: IngestResult["byMetric"] = {};
  for (const r of accepted) byMetric[r.metric] = (byMetric[r.metric] ?? 0) + 1;
  const status: IngestResult["status"] = accepted.length === 0 ? "error" : ignored.length ? "partial" : "ok";
  const result: IngestResult = { status, format: parsed.format, accepted: accepted.length, days: [...new Set(accepted.map((r) => r.date))].sort(), byMetric, ignored: ignored.slice(0, 50) };
  await db.update(healthConnections).set({ lastUsedAt: now }).where(eq(healthConnections.id, conn.id));
  await db.insert(healthSyncEvents).values({
    connectionId: conn.id,
    status,
    summary: { format: result.format, accepted: result.accepted, byMetric, days: result.days.slice(-14), ignored: result.ignored.slice(0, 10) },
    message: accepted.length === 0 ? (ignored[0]?.reason ?? "No usable data in the payload") : null,
  });
  return result;
}

export async function recordIngestError(db: DbOrTx, connectionId: string, message: string) {
  await db.insert(healthSyncEvents).values({ connectionId, status: "error", summary: {}, message });
}

/** Manual entry (source "manual"); replaces an earlier manual value for that day. */
export async function saveManualHealth(db: DbOrTx, input: z.infer<typeof manualHealthSchema>, today: LocalDate): Promise<HealthDaily> {
  if (input.localDate > today) throw badRequest("Health data can't be entered for future days.");
  const def = HEALTH_METRIC_BY_KEY[input.metric];
  if (input.value < def.min || input.value > def.max) throw badRequest(`${def.label} must be between ${def.min} and ${def.max} ${def.unit}.`);
  const details =
    input.metric === "sleep" && input.stages && Object.values(input.stages).some((v) => v != null)
      ? { stages: { deep: input.stages.deep ?? null, rem: input.stages.rem ?? null, core: input.stages.core ?? null, awake: input.stages.awake ?? null, unspecified: null }, origins: ["Entered by hand"] }
      : null;
  const now = new Date();
  const [row] = await db
    .insert(healthDaily)
    .values({ localDate: input.localDate, metric: input.metric, value: input.value, unit: def.unit, source: "manual", sourceLabel: "Entered manually", origin: null, details, syncedAt: now })
    .onConflictDoUpdate({ target: [healthDaily.localDate, healthDaily.metric, healthDaily.source], set: { value: input.value, details, syncedAt: now, updatedAt: now } })
    .returning();
  return row;
}

export async function deleteHealthValue(db: DbOrTx, id: string): Promise<void> {
  const rows = await db.delete(healthDaily).where(eq(healthDaily.id, id)).returning({ id: healthDaily.id });
  if (!rows.length) throw notFound("Health value");
}

export async function earliestHealthDate(db: DbOrTx): Promise<LocalDate | null> {
  const [row] = await db.select({ d: min(healthDaily.localDate) }).from(healthDaily);
  return row?.d ?? null;
}

export async function listHealth(db: DbOrTx, range: { start: LocalDate; end: LocalDate }, metrics?: HealthMetric[]): Promise<HealthDaily[]> {
  const conds = [gte(healthDaily.localDate, range.start), lte(healthDaily.localDate, range.end)];
  if (metrics?.length) conds.push(inArray(healthDaily.metric, metrics));
  return db.select().from(healthDaily).where(and(...conds)).orderBy(asc(healthDaily.localDate));
}

/**
 * One value per day and metric. When several sources reported the same day, the
 * most recently synced value is shown (it's the most complete for phone totals)
 * and the alternatives are listed, never summed.
 */
type Alternative = { id: string; source: string; sourceLabel: string; value: number };

export function pickDaily(rows: HealthDaily[]): Map<string, HealthDaily & { alternatives: Alternative[] }> {
  const map = new Map<string, HealthDaily & { alternatives: Alternative[] }>();
  for (const r of rows) {
    const key = `${r.localDate}|${r.metric}`;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, { ...r, alternatives: [] });
      continue;
    }
    if (r.syncedAt.getTime() > cur.syncedAt.getTime()) {
      map.set(key, { ...r, alternatives: [...cur.alternatives, { id: cur.id, source: cur.source, sourceLabel: cur.sourceLabel, value: cur.value }] });
    } else {
      cur.alternatives.push({ id: r.id, source: r.source, sourceLabel: r.sourceLabel, value: r.value });
    }
  }
  return map;
}

/** Daily values for one metric (picked per day), keyed by date. */
export function metricByDate(rows: HealthDaily[], metric: HealthMetric): Map<LocalDate, number> {
  const out = new Map<LocalDate, number>();
  for (const [, r] of pickDaily(rows.filter((x) => x.metric === metric))) out.set(r.localDate, r.value);
  return out;
}

function slopePerWeek(points: { x: number; y: number }[]): number | null {
  if (points.length < 7) return null;
  const n = points.length;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  return sxx === 0 ? null : (sxy / sxx) * 7;
}

export async function healthOverview(db: DbOrTx, range: { start: LocalDate; end: LocalDate }, s: Settings, today?: LocalDate) {
  const rows = await listHealth(db, range);
  const picked = [...pickDaily(rows).values()];
  const dates = eachDate(range.start, range.end);
  const metrics = Object.fromEntries(
    HEALTH_METRIC_KEYS.map((metric) => {
      const def = HEALTH_METRIC_BY_KEY[metric];
      const byDate = new Map(picked.filter((r) => r.metric === metric).map((r) => [r.localDate, r]));
      // Today's running totals (steps, active energy) are partial, so they're left out of averages and trends.
      const partialToday = def.aggregate === "sum" && today ? today : null;
      const values = [...byDate.values()].filter((r) => r.localDate !== partialToday).map((r) => r.value);
      const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      const weekly = new Map<string, number[]>();
      const monthly = new Map<string, number[]>();
      for (const r of byDate.values()) {
        if (r.localDate === partialToday) continue;
        const wk = startOfWeek(r.localDate, s.weekStartsOn);
        weekly.set(wk, [...(weekly.get(wk) ?? []), r.value]);
        const mk = monthKey(r.localDate);
        monthly.set(mk, [...(monthly.get(mk) ?? []), r.value]);
      }
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      const pts = dates.map((d, i) => ({ x: i, y: d === partialToday ? undefined : byDate.get(d)?.value })).filter((p): p is { x: number; y: number } => p.y != null);
      return [
        metric,
        {
          label: def.label,
          unit: def.unit,
          days: dates.map((d) => {
            const r = byDate.get(d);
            return r
              ? { date: d, value: r.value, id: r.id, source: r.source, sourceLabel: r.sourceLabel, origin: r.origin, details: r.details, syncedAt: r.syncedAt, alternatives: r.alternatives }
              : { date: d, value: null };
          }),
          loggedDays: byDate.size,
          averageExcludesToday: partialToday != null && byDate.has(partialToday),
          average: avg,
          min: values.length ? Math.min(...values) : null,
          max: values.length ? Math.max(...values) : null,
          weekly: [...weekly.entries()].sort().map(([start, xs]) => ({ start, average: mean(xs), total: xs.reduce((a, b) => a + b, 0), days: xs.length })),
          monthly: [...monthly.entries()].sort().map(([month, xs]) => ({ month, average: mean(xs), total: xs.reduce((a, b) => a + b, 0), days: xs.length })),
          trendPerWeek: slopePerWeek(pts),
          lastSyncedAt: rows.filter((r) => r.metric === metric).reduce<Date | null>((m, r) => (!m || r.syncedAt > m ? r.syncedAt : m), null),
          sources: [...new Set(rows.filter((r) => r.metric === metric).map((r) => r.sourceLabel))],
        },
      ];
    }),
  );
  const [lastEvent] = await db.select().from(healthSyncEvents).orderBy(desc(healthSyncEvents.receivedAt)).limit(1);
  const conns = await db.select({ id: healthConnections.id, revokedAt: healthConnections.revokedAt, lastUsedAt: healthConnections.lastUsedAt }).from(healthConnections);
  return {
    range,
    metrics,
    sync: {
      activeConnections: conns.filter((c) => !c.revokedAt).length,
      lastSyncAt: conns.reduce<Date | null>((m, c) => (c.lastUsedAt && (!m || c.lastUsedAt > m) ? c.lastUsedAt : m), null),
      lastEvent: lastEvent ?? null,
    },
  };
}
