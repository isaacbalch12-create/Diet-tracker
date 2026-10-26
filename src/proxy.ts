import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./lib/auth";
import { authMode } from "./lib/env";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/health", "/manifest.webmanifest", "/icon.svg"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // CSRF defense in depth (the session cookie is also SameSite=Lax): state-changing
  // API requests must come from this origin.
  if (isApi && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    let originHost: string | null = null;
    try {
      originHost = origin ? new URL(origin).host : null;
    } catch {
      originHost = "invalid";
    }
    if (originHost && originHost !== host) {
      return NextResponse.json({ error: { code: "bad_origin", message: "Cross-origin request blocked" } }, { status: 403 });
    }
  }

  const mode = authMode();
  if (mode === "open" || isPublic(pathname)) return NextResponse.next();

  if (mode === "misconfigured") {
    const message = "Server is missing APP_PASSWORD and/or SESSION_SECRET (32+ characters). Set them and restart.";
    if (isApi) return NextResponse.json({ error: { code: "auth_not_configured", message } }, { status: 503 });
    return new NextResponse(`<!doctype html><meta charset="utf-8"><title>Setup required</title><body style="font-family:system-ui;padding:2rem;max-width:40rem"><h1>Setup required</h1><p>${message}</p></body>`, {
      status: 503,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const ok = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();
  if (isApi) return NextResponse.json({ error: { code: "unauthorized", message: "Please sign in" } }, { status: 401 });
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
