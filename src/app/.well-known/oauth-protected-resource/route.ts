import { corsPreflight, oauthJson } from "@/lib/oauth-http";
import { protectedResourceMetadata, publicOrigin } from "@/lib/services/oauth";

/** RFC 9728 protected resource metadata for the MCP endpoint. */
export function GET(req: Request) {
  return oauthJson(protectedResourceMetadata(publicOrigin(req)));
}
export const OPTIONS = corsPreflight;
