/**
 * A small OAuth 2.1 authorization server for the Claude connector (MCP).
 *
 * Only the owner can approve a connection (the consent page requires the app
 * login), only Claude's own redirect URLs are accepted, PKCE S256 is
 * mandatory, and codes and tokens are random, short-lived where it matters,
 * and stored only as SHA-256 hashes. Refresh tokens rotate on every use; a
 * reused old refresh token revokes the whole connection.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, count, desc, eq, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "../db";
import { oauthClients, oauthCodes, oauthGrants, type OAuthGrant } from "../db/schema";
import { env } from "../env";

export const MCP_SCOPE = "momentum";
export const SCOPES_SUPPORTED = [MCP_SCOPE, "offline_access"];
export const ACCESS_TOKEN_TTL_S = 60 * 60;
export const REFRESH_TOKEN_TTL_S = 60 * 60 * 24 * 90;
const CODE_TTL_S = 5 * 60;
const MAX_CLIENTS = 50;

/** RFC 6749 error, returned as `{ error, error_description }`. */
export class OAuthError extends Error {
  constructor(
    public readonly error: string,
    public readonly description: string,
    public readonly status = 400,
  ) {
    super(description);
  }
}

export const hashSecret = (v: string) => createHash("sha256").update(v).digest("hex");
const randomToken = (prefix: string) => `${prefix}_${randomBytes(32).toString("base64url")}`;

/** The public origin the app is reached at (used as the OAuth issuer). */
export function publicOrigin(req: Request): string {
  if (env.publicUrl) return env.publicUrl.replace(/\/+$/, "");
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export const mcpResourceUrl = (origin: string) => `${origin}/api/mcp`;

export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: SCOPES_SUPPORTED,
    bearer_methods_supported: ["header"],
    resource_name: "Momentum",
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SCOPES_SUPPORTED,
  };
}

/**
 * Redirect URLs a client may register: Claude's hosted apps (web, desktop,
 * mobile) and loopback URLs for Claude Code. Nothing else can receive a code.
 */
export function isAllowedRedirectUri(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === "https:" && (u.host === "claude.ai" || u.host === "claude.com") && u.pathname === "/api/mcp/auth_callback") return true;
  if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1") && u.pathname === "/callback") return true;
  return env.oauthExtraRedirects.includes(raw);
}

/** Loopback redirects match with the port ignored (RFC 8252); everything else matches exactly. */
function redirectMatches(registered: string, presented: string): boolean {
  if (registered === presented) return true;
  try {
    const a = new URL(registered);
    const b = new URL(presented);
    const loopback = (u: URL) => u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
    return loopback(a) && loopback(b) && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
  } catch {
    return false;
  }
}

export const registrationSchema = z.object({
  client_name: z.string().trim().max(120).optional(),
  redirect_uris: z.array(z.string().max(500)).min(1).max(10),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
});

/** RFC 7591 dynamic client registration (public clients only). */
export async function registerClient(db: Db, raw: unknown) {
  const parsed = registrationSchema.safeParse(raw);
  if (!parsed.success) throw new OAuthError("invalid_client_metadata", "redirect_uris is required.");
  const input = parsed.data;
  const bad = input.redirect_uris.find((u) => !isAllowedRedirectUri(u));
  if (bad) throw new OAuthError("invalid_redirect_uri", "Only Claude's redirect URLs can be registered with this server.");
  if (input.token_endpoint_auth_method && input.token_endpoint_auth_method !== "none") {
    throw new OAuthError("invalid_client_metadata", "Only public clients (token_endpoint_auth_method \"none\") are supported.");
  }
  // Registration is open by design (the owner approves each connection), so keep the table small:
  // drop clients that never got a connection, oldest first.
  const [{ n }] = await db.select({ n: count() }).from(oauthClients);
  if (n >= MAX_CLIENTS) {
    const unused = await db
      .select({ id: oauthClients.id })
      .from(oauthClients)
      .leftJoin(oauthGrants, eq(oauthGrants.clientId, oauthClients.id))
      .where(isNull(oauthGrants.id))
      .orderBy(oauthClients.createdAt)
      .limit(n - MAX_CLIENTS + 1);
    if (!unused.length) throw new OAuthError("temporarily_unavailable", "Too many connected clients. Revoke some in Momentum settings.", 503);
    for (const u of unused) await db.delete(oauthClients).where(eq(oauthClients.id, u.id));
  }
  const id = `mc_${randomBytes(16).toString("base64url")}`;
  const [row] = await db
    .insert(oauthClients)
    .values({ id, name: input.client_name || "MCP client", redirectUris: input.redirect_uris })
    .returning();
  return {
    client_id: row.id,
    client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
    client_name: row.name,
    redirect_uris: row.redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export const authorizeParamsSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1).max(200),
  redirect_uri: z.string().min(1).max(500),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/, "code_challenge must be a base64url S256 challenge"),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(1000).optional(),
  scope: z.string().max(500).optional(),
  resource: z.string().max(500).optional(),
});
export type AuthorizeParams = z.infer<typeof authorizeParamsSchema>;

export type AuthorizeCheck =
  | { ok: true; params: AuthorizeParams; clientName: string; redirectHost: string; scope: string }
  /** Unsafe to redirect (unknown client or redirect URL): show the error on the page. */
  | { ok: false; redirect: false; message: string }
  /** Safe to send the error back to the client's redirect URL. */
  | { ok: false; redirect: true; to: string };

function errorRedirect(redirectUri: string, error: string, description: string, state?: string): string {
  const u = new URL(redirectUri);
  u.searchParams.set("error", error);
  u.searchParams.set("error_description", description);
  if (state) u.searchParams.set("state", state);
  return u.toString();
}

/** Validate an authorization request. Errors about the client or redirect URL never redirect. */
export async function checkAuthorizeRequest(db: DbOrTx, raw: Record<string, string | undefined>, origin: string): Promise<AuthorizeCheck> {
  const clientId = raw.client_id;
  const redirectUri = raw.redirect_uri;
  if (!clientId || !redirectUri) return { ok: false, redirect: false, message: "The request is missing client_id or redirect_uri." };
  const [client] = await db.select().from(oauthClients).where(eq(oauthClients.id, clientId));
  if (!client) return { ok: false, redirect: false, message: "This app isn't registered with Momentum. Remove the connector in Claude and add it again." };
  if (!client.redirectUris.some((r) => redirectMatches(r, redirectUri)) || !isAllowedRedirectUri(redirectUri)) {
    return { ok: false, redirect: false, message: "The redirect address doesn't match this app's registration." };
  }
  const parsed = authorizeParamsSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".") ?? "request";
    return { ok: false, redirect: true, to: errorRedirect(redirectUri, field === "response_type" ? "unsupported_response_type" : "invalid_request", `${field}: ${issue?.message ?? "invalid"}`, raw.state) };
  }
  const params = parsed.data;
  if (params.resource && params.resource.replace(/\/+$/, "") !== mcpResourceUrl(origin)) {
    return { ok: false, redirect: true, to: errorRedirect(redirectUri, "invalid_target", "Unknown resource.", params.state) };
  }
  // Grant only scopes this server knows; the connector always gets full access to the owner's data.
  const requested = (params.scope ?? MCP_SCOPE).split(/\s+/).filter(Boolean);
  const scope = [...new Set([MCP_SCOPE, ...requested.filter((s) => SCOPES_SUPPORTED.includes(s))])].join(" ");
  return { ok: true, params, clientName: client.name, redirectHost: new URL(redirectUri).host, scope };
}

/** The owner approved: issue a single-use code and return the redirect URL. */
export async function approveAuthorization(db: Db, params: AuthorizeParams, scope: string, now = new Date()): Promise<string> {
  const code = randomToken("mca");
  await db.delete(oauthCodes).where(lt(oauthCodes.expiresAt, now));
  await db.insert(oauthCodes).values({
    codeHash: hashSecret(code),
    clientId: params.client_id,
    redirectUri: params.redirect_uri,
    codeChallenge: params.code_challenge,
    scope,
    resource: params.resource ?? null,
    expiresAt: new Date(now.getTime() + CODE_TTL_S * 1000),
  });
  const u = new URL(params.redirect_uri);
  u.searchParams.set("code", code);
  if (params.state) u.searchParams.set("state", params.state);
  return u.toString();
}

export function denyAuthorization(params: AuthorizeParams): string {
  return errorRedirect(params.redirect_uri, "access_denied", "The owner declined the connection.", params.state);
}

function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

async function issueTokens(db: DbOrTx, grant: { id?: string; clientId: string; scope: string }, now: Date): Promise<TokenResponse> {
  const access = randomToken("mct");
  const withRefresh = grant.scope.split(" ").includes("offline_access");
  const refresh = withRefresh ? randomToken("mcr") : null;
  const values = {
    accessTokenHash: hashSecret(access),
    accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_S * 1000),
    refreshTokenHash: refresh ? hashSecret(refresh) : null,
    refreshExpiresAt: refresh ? new Date(now.getTime() + REFRESH_TOKEN_TTL_S * 1000) : null,
  };
  if (grant.id) await db.update(oauthGrants).set(values).where(eq(oauthGrants.id, grant.id));
  else await db.insert(oauthGrants).values({ clientId: grant.clientId, scope: grant.scope, ...values });
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_S, ...(refresh ? { refresh_token: refresh } : {}), scope: grant.scope };
}

/** Token endpoint (application/x-www-form-urlencoded). */
export async function exchangeToken(db: Db, form: URLSearchParams, now = new Date()): Promise<TokenResponse> {
  const grantType = form.get("grant_type");
  const clientId = form.get("client_id");
  if (!clientId) throw new OAuthError("invalid_client", "client_id is required.", 401);
  const [client] = await db.select().from(oauthClients).where(eq(oauthClients.id, clientId));
  if (!client) throw new OAuthError("invalid_client", "Unknown client.", 401);

  if (grantType === "authorization_code") {
    const code = form.get("code");
    const verifier = form.get("code_verifier");
    const redirectUri = form.get("redirect_uri");
    if (!code || !verifier) throw new OAuthError("invalid_request", "code and code_verifier are required.");
    const [used] = await db.select({ usedAt: oauthCodes.usedAt, clientId: oauthCodes.clientId }).from(oauthCodes).where(eq(oauthCodes.codeHash, hashSecret(code)));
    if (used?.usedAt && used.clientId === clientId) {
      // A code used twice means it leaked: revoke what it produced (outside any transaction that would roll back).
      await db.update(oauthGrants).set({ revokedAt: now }).where(and(eq(oauthGrants.clientId, clientId), isNull(oauthGrants.revokedAt)));
      throw new OAuthError("invalid_grant", "Authorization code already used.");
    }
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(oauthCodes).where(eq(oauthCodes.codeHash, hashSecret(code))).for("update");
      if (!row || row.clientId !== clientId) throw new OAuthError("invalid_grant", "Invalid authorization code.");
      if (row.usedAt) throw new OAuthError("invalid_grant", "Authorization code already used.");
      if (row.expiresAt < now) throw new OAuthError("invalid_grant", "Authorization code expired.");
      if (redirectUri && !redirectMatches(row.redirectUri, redirectUri)) throw new OAuthError("invalid_grant", "redirect_uri does not match.");
      if (!pkceMatches(verifier, row.codeChallenge)) throw new OAuthError("invalid_grant", "PKCE verification failed.");
      await tx.update(oauthCodes).set({ usedAt: now }).where(eq(oauthCodes.codeHash, row.codeHash));
      return issueTokens(tx, { clientId, scope: row.scope }, now);
    });
  }

  if (grantType === "refresh_token") {
    const refresh = form.get("refresh_token");
    if (!refresh) throw new OAuthError("invalid_request", "refresh_token is required.");
    const h = hashSecret(refresh);
    const [rotatedOut] = await db.select({ id: oauthGrants.id, accessExpiresAt: oauthGrants.accessExpiresAt }).from(oauthGrants).where(eq(oauthGrants.previousRefreshHash, h));
    if (rotatedOut) {
      // A rotated-out refresh token came back: someone else may hold it, so revoke the connection —
      // unless it was rotated moments ago, which is just two refreshes racing.
      const rotatedAt = rotatedOut.accessExpiresAt.getTime() - ACCESS_TOKEN_TTL_S * 1000;
      if (now.getTime() - rotatedAt > 2 * 60_000) await db.update(oauthGrants).set({ revokedAt: now }).where(eq(oauthGrants.id, rotatedOut.id));
      throw new OAuthError("invalid_grant", "Invalid refresh token.");
    }
    return db.transaction(async (tx) => {
      const [grant] = await tx.select().from(oauthGrants).where(eq(oauthGrants.refreshTokenHash, h)).for("update");
      if (!grant) throw new OAuthError("invalid_grant", "Invalid refresh token.");
      if (grant.clientId !== clientId || grant.revokedAt || !grant.refreshExpiresAt || grant.refreshExpiresAt < now) {
        throw new OAuthError("invalid_grant", "Refresh token is no longer valid.");
      }
      await tx.update(oauthGrants).set({ previousRefreshHash: h }).where(eq(oauthGrants.id, grant.id));
      return issueTokens(tx, { id: grant.id, clientId, scope: grant.scope }, now);
    });
  }

  throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
}

/** Resolve a bearer access token to its connection, or null. */
export async function authenticateBearer(db: Db, header: string | null, now = new Date()): Promise<OAuthGrant | null> {
  const m = header?.match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  const [grant] = await db.select().from(oauthGrants).where(eq(oauthGrants.accessTokenHash, hashSecret(m[1])));
  if (!grant || grant.revokedAt || grant.accessExpiresAt < now) return null;
  // Record use at most once a minute to keep writes low.
  if (!grant.lastUsedAt || now.getTime() - grant.lastUsedAt.getTime() > 60_000) {
    await db.update(oauthGrants).set({ lastUsedAt: now }).where(eq(oauthGrants.id, grant.id));
  }
  return grant;
}

/** RFC 7009: revoking either token ends the connection. Unknown tokens are not an error. */
export async function revokeToken(db: Db, token: string, now = new Date()): Promise<void> {
  const h = hashSecret(token);
  await db
    .update(oauthGrants)
    .set({ revokedAt: now })
    .where(and(or(eq(oauthGrants.accessTokenHash, h), eq(oauthGrants.refreshTokenHash, h)), isNull(oauthGrants.revokedAt)));
}

/** Active connections for the settings page (no secrets). */
export async function listConnections(db: Db) {
  const rows = await db
    .select({ id: oauthGrants.id, clientName: oauthClients.name, createdAt: oauthGrants.createdAt, lastUsedAt: oauthGrants.lastUsedAt })
    .from(oauthGrants)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
    .where(isNull(oauthGrants.revokedAt))
    .orderBy(desc(oauthGrants.createdAt));
  return rows;
}

export async function revokeConnection(db: Db, id: string, now = new Date()): Promise<boolean> {
  const rows = await db.update(oauthGrants).set({ revokedAt: now }).where(and(eq(oauthGrants.id, id), isNull(oauthGrants.revokedAt))).returning({ id: oauthGrants.id });
  return rows.length > 0;
}
