/** HTTP helpers for the public OAuth / MCP endpoints (no cookies, so open CORS is safe). */
import { NextResponse } from "next/server";
import { OAuthError } from "./services/oauth";

export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "access-control-expose-headers": "www-authenticate, mcp-session-id",
};

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function oauthJson(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return NextResponse.json(body, { status, headers: { ...CORS_HEADERS, "cache-control": "no-store", pragma: "no-cache", ...extra } });
}

export function oauthErrorResponse(err: unknown): Response {
  if (err instanceof OAuthError) return oauthJson({ error: err.error, error_description: err.description }, err.status);
  console.error("OAuth endpoint error", err);
  return oauthJson({ error: "server_error", error_description: "Something went wrong on the server." }, 500);
}

/** Tiny per-IP limiter for the unauthenticated OAuth endpoints. */
const hits = new Map<string, { count: number; resetAt: number }>();
export function rateLimited(req: Request, bucket: string, max: number, windowMs = 10 * 60_000, now = Date.now()): boolean {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const key = `${bucket}:${ip}`;
  const entry = hits.get(key);
  if (!entry || entry.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}
