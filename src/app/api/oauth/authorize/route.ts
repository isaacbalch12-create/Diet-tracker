import { NextResponse } from "next/server";
import { assertAuthorized, errorResponse } from "@/lib/api";
import { getDb } from "@/lib/db";
import { approveAuthorization, checkAuthorizeRequest, denyAuthorization, publicOrigin } from "@/lib/services/oauth";

/**
 * The consent page posts here. Requires the owner's session (and the proxy's
 * same-origin check), so only the signed-in owner can approve a connection.
 */
export async function POST(req: Request) {
  try {
    await assertAuthorized(req);
    const form = await req.formData();
    const raw: Record<string, string | undefined> = {};
    for (const [k, v] of form.entries()) if (typeof v === "string") raw[k] = v;
    const db = await getDb();
    const check = await checkAuthorizeRequest(db, raw, publicOrigin(req));
    if (!check.ok) {
      if (check.redirect) return NextResponse.redirect(check.to, 303);
      return NextResponse.json({ error: { code: "invalid_request", message: check.message } }, { status: 400 });
    }
    const to = raw.decision === "allow" ? await approveAuthorization(db, check.params, check.scope) : denyAuthorization(check.params);
    return NextResponse.redirect(to, 303);
  } catch (err) {
    return errorResponse(err);
  }
}
