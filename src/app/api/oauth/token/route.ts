import { getDb } from "@/lib/db";
import { corsPreflight, oauthErrorResponse, oauthJson, rateLimited } from "@/lib/oauth-http";
import { exchangeToken, OAuthError } from "@/lib/services/oauth";

/** Token endpoint: authorization_code (with PKCE) and refresh_token grants. */
export async function POST(req: Request) {
  try {
    if (rateLimited(req, "token", 120)) throw new OAuthError("temporarily_unavailable", "Too many requests; try again later.", 429);
    const type = req.headers.get("content-type") ?? "";
    let form: URLSearchParams;
    if (type.includes("application/x-www-form-urlencoded")) form = new URLSearchParams(await req.text());
    else if (type.includes("application/json")) form = new URLSearchParams(Object.entries((await req.json()) as Record<string, string>).map(([k, v]) => [k, String(v)]));
    else throw new OAuthError("invalid_request", "Use application/x-www-form-urlencoded.");
    return oauthJson(await exchangeToken(await getDb(), form));
  } catch (err) {
    return oauthErrorResponse(err);
  }
}
export const OPTIONS = corsPreflight;
