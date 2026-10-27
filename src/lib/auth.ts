import { createHash, timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { authMode, env } from "./env";

export const SESSION_COOKIE = "dt_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30;

function key(): Uint8Array {
  const secret = env.sessionSecret;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return new TextEncoder().encode(secret);
}

export function checkPassword(candidate: string): boolean {
  const expected = env.appPassword;
  if (!expected) return false;
  // Compare fixed-length digests so timing does not leak the password length.
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ sub: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_S}s`)
    .sign(key());
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return payload.sub === "owner";
  } catch {
    return false;
  }
}

/** Tiny in-memory limiter for login attempts (per IP). */
const attempts = new Map<string, { count: number; resetAt: number }>();
export function loginRateLimited(ip: string, now = Date.now()): boolean {
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + 15 * 60_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > 8;
}
export function resetLoginAttempts(ip: string) {
  attempts.delete(ip);
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/**
 * Authorization for API handlers. The proxy already enforces this; handlers
 * check again so data stays protected even if a hosting platform skips the proxy.
 */
export async function requestAuth(req: Request): Promise<"ok" | "unauthorized" | "misconfigured"> {
  const mode = authMode();
  if (mode === "open") return "ok";
  if (mode === "misconfigured") return "misconfigured";
  return (await verifySessionToken(readCookie(req.headers.get("cookie"), SESSION_COOKIE))) ? "ok" : "unauthorized";
}
