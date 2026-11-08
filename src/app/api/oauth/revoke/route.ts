import { getDb } from "@/lib/db";
import { corsPreflight, oauthErrorResponse, oauthJson } from "@/lib/oauth-http";
import { revokeToken } from "@/lib/services/oauth";

/** RFC 7009 token revocation. Always answers 200, even for unknown tokens. */
export async function POST(req: Request) {
  try {
    const form = new URLSearchParams(await req.text());
    const token = form.get("token");
    if (token) await revokeToken(await getDb(), token);
    return oauthJson({});
  } catch (err) {
    return oauthErrorResponse(err);
  }
}
export const OPTIONS = corsPreflight;
