import { getDb } from "@/lib/db";
import { corsPreflight, oauthErrorResponse, oauthJson, rateLimited } from "@/lib/oauth-http";
import { OAuthError, registerClient } from "@/lib/services/oauth";

/** RFC 7591 dynamic client registration. Only Claude's redirect URLs are accepted. */
export async function POST(req: Request) {
  try {
    if (rateLimited(req, "register", 20)) throw new OAuthError("temporarily_unavailable", "Too many registrations; try again later.", 429);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new OAuthError("invalid_client_metadata", "Body must be JSON.");
    }
    return oauthJson(await registerClient(await getDb(), body), 201);
  } catch (err) {
    return oauthErrorResponse(err);
  }
}
export const OPTIONS = corsPreflight;
