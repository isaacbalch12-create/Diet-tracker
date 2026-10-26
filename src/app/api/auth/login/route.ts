import { NextResponse } from "next/server";
import { z } from "zod";
import { checkPassword, createSessionToken, loginRateLimited, resetLoginAttempts, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/auth";
import { authMode, env } from "@/lib/env";

export async function POST(req: Request) {
  if (authMode() !== "password") {
    return NextResponse.json({ error: { code: "auth_disabled", message: "Password login is not configured on this server." } }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (loginRateLimited(ip)) {
    return NextResponse.json({ error: { code: "rate_limited", message: "Too many attempts. Wait 15 minutes and try again." } }, { status: 429 });
  }
  const body = z.object({ password: z.string().min(1).max(500) }).safeParse(await req.json().catch(() => null));
  if (!body.success || !checkPassword(body.data.password)) {
    return NextResponse.json({ error: { code: "invalid_password", message: "Incorrect password" } }, { status: 401 });
  }
  resetLoginAttempts(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
}
