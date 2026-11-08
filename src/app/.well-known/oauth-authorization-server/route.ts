import { corsPreflight, oauthJson } from "@/lib/oauth-http";
import { authorizationServerMetadata, publicOrigin } from "@/lib/services/oauth";

/** RFC 8414 authorization server metadata. */
export function GET(req: Request) {
  return oauthJson(authorizationServerMetadata(publicOrigin(req)));
}
export const OPTIONS = corsPreflight;
