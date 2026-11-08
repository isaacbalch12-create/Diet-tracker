import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getDb } from "@/lib/db";
import { buildMcpServer } from "@/lib/mcp/server";
import { CORS_HEADERS, corsPreflight } from "@/lib/oauth-http";
import { authenticateBearer, MCP_SCOPE, publicOrigin } from "@/lib/services/oauth";
import { getSettings, settingsToday } from "@/lib/services/settings";

export const maxDuration = 60;

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** 401 with a pointer to the OAuth metadata: this is how Claude discovers the sign-in. */
function unauthorized(req: Request, description: string): Response {
  const origin = publicOrigin(req);
  return withCors(
    Response.json(
      { jsonrpc: "2.0", error: { code: -32001, message: description }, id: null },
      {
        status: 401,
        headers: {
          "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="${MCP_SCOPE} offline_access", error="invalid_token", error_description="${description}"`,
        },
      },
    ),
  );
}

/**
 * The Momentum connector (MCP over Streamable HTTP, stateless: one server per
 * request, JSON responses). Authenticated with OAuth access tokens issued to
 * connections the owner approved.
 */
async function handle(req: Request): Promise<Response> {
  const db = await getDb();
  const grant = await authenticateBearer(db, req.headers.get("authorization"));
  if (!grant) return unauthorized(req, "Sign in to Momentum to use this connector");
  if (req.method !== "POST") {
    return withCors(Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }, { status: 405, headers: { allow: "POST" } }));
  }
  const settings = await getSettings(db);
  const server = buildMcpServer({ db, settings, today: settingsToday(settings) });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return withCors(await transport.handleRequest(req));
  } finally {
    await server.close().catch(() => undefined);
  }
}

export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (err) {
    console.error("MCP endpoint error", err);
    return withCors(Response.json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }, { status: 500 }));
  }
}
export const GET = POST;
export const DELETE = POST;
export const OPTIONS = corsPreflight;
