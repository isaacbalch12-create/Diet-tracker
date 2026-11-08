/**
 * The Claude connector end to end, through the real route handlers: OAuth
 * discovery, client registration, owner consent, PKCE token exchange, refresh
 * rotation and revocation, then MCP initialize / tools/list / tools/call
 * against an in-memory database.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, setDbOverride, type Db } from "@/lib/db";
import type { Settings } from "@/lib/db/schema";
import { upsertUsdaFoods } from "@/lib/foods/repo";
import { listMeals } from "@/lib/services/meals";
import { listConnections, revokeConnection } from "@/lib/services/oauth";
import { updateSettings } from "@/lib/services/settings";
import { itemNutrients } from "@/lib/nutrition/calc";
import { GET as protectedResource } from "@/app/.well-known/oauth-protected-resource/route";
import { GET as asMetadata } from "@/app/.well-known/oauth-authorization-server/route";
import { POST as register } from "@/app/api/oauth/register/route";
import { POST as consent } from "@/app/api/oauth/authorize/route";
import { POST as token } from "@/app/api/oauth/token/route";
import { POST as revoke } from "@/app/api/oauth/revoke/route";
import { POST as mcp } from "@/app/api/mcp/route";

const ORIGIN = "http://localhost:3000";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
let db: Db;
let s: Settings;
let rpcId = 0;

beforeEach(async () => {
  db = await createMemoryDb();
  setDbOverride(db);
  s = await updateSettings(db, { timezone: "America/New_York", onboarded: true });
  await upsertUsdaFoods(db, [
    { externalId: "100", dataType: "fndds", description: "Egg, whole, fried with butter", brand: null, category: "Eggs", nutrientsPer100g: { calories: 182, protein: 12.4, carbs: 0.8, fat: 14.2 }, portions: [{ label: "large", grams: 50 }] },
  ]);
});
afterEach(() => setDbOverride(null));

const verifierPair = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

async function registerClient(redirect = CALLBACK) {
  const res = await register(new Request(`${ORIGIN}/api/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: [redirect] }) }));
  return { res, body: (await res.json()) as { client_id: string; error?: string } };
}

async function approve(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  const form = new FormData();
  const fields = { response_type: "code", client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256", state: "st-123", scope: "momentum offline_access", resource: `${ORIGIN}/api/mcp`, decision: "allow", ...extra };
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const res = await consent(new Request(`${ORIGIN}/api/oauth/authorize`, { method: "POST", body: form }));
  return res;
}

async function tokenCall(params: Record<string, string>) {
  const res = await token(new Request(`${ORIGIN}/api/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() }));
  return { status: res.status, body: (await res.json()) as Record<string, string> };
}

async function connect() {
  const { body } = await registerClient();
  const { verifier, challenge } = verifierPair();
  const res = await approve(body.client_id, challenge);
  const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
  const t = await tokenCall({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: body.client_id, redirect_uri: CALLBACK });
  return { clientId: body.client_id, access_token: t.body.access_token, refresh_token: t.body.refresh_token };
}

async function rpc(accessToken: string | null, method: string, params: Record<string, unknown> = {}) {
  const res = await mcp(
    new Request(`${ORIGIN}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    }),
  );
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

async function callTool(accessToken: string, name: string, args: Record<string, unknown>) {
  const r = await rpc(accessToken, "tools/call", { name, arguments: args });
  const result = r.body.result as { isError?: boolean; content: { text: string }[] };
  return { isError: !!result.isError, data: result.isError ? result.content[0].text : JSON.parse(result.content[0].text) };
}

describe("OAuth for the Claude connector", () => {
  it("advertises discovery metadata and challenges unauthenticated MCP calls", async () => {
    const prm = await (await protectedResource(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`))).json();
    expect(prm).toMatchObject({ resource: `${ORIGIN}/api/mcp`, authorization_servers: [ORIGIN] });
    const as = await (await asMetadata(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`))).json();
    expect(as).toMatchObject({ issuer: ORIGIN, code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], registration_endpoint: `${ORIGIN}/api/oauth/register` });
    expect(as.scopes_supported).toContain("offline_access");
    expect(as.client_id_metadata_document_supported).toBeUndefined();

    const r = await rpc(null, "tools/list");
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`);
  });

  it("only registers Claude's redirect URLs", async () => {
    expect((await registerClient("https://evil.example.com/callback")).res.status).toBe(400);
    expect((await registerClient("http://localhost:4123/callback")).res.status).toBe(201);
    expect((await registerClient(CALLBACK)).res.status).toBe(201);
  });

  it("issues tokens only with the right PKCE verifier, and a reused code revokes the connection", async () => {
    const { body } = await registerClient();
    const { verifier, challenge } = verifierPair();
    const res = await approve(body.client_id, challenge);
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get("location")!);
    expect(`${loc.origin}${loc.pathname}`).toBe(CALLBACK);
    expect(loc.searchParams.get("state")).toBe("st-123");
    const code = loc.searchParams.get("code")!;

    const wrong = await tokenCall({ grant_type: "authorization_code", code, code_verifier: verifierPair().verifier, client_id: body.client_id, redirect_uri: CALLBACK });
    expect(wrong).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
    const ok = await tokenCall({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: body.client_id, redirect_uri: CALLBACK });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "momentum offline_access" });
    expect(ok.body.refresh_token).toBeTruthy();
    expect((await rpc(ok.body.access_token, "tools/list")).status).toBe(200);

    const replay = await tokenCall({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: body.client_id, redirect_uri: CALLBACK });
    expect(replay.body.error).toBe("invalid_grant");
    expect((await rpc(ok.body.access_token, "tools/list")).status).toBe(401);
  });

  it("denies, and refuses unknown clients or mismatched redirects without redirecting", async () => {
    const { body } = await registerClient();
    const denied = await approve(body.client_id, verifierPair().challenge, { decision: "deny" });
    expect(new URL(denied.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
    expect((await approve("mc_unknown", verifierPair().challenge)).status).toBe(400);
    expect((await approve(body.client_id, verifierPair().challenge, { redirect_uri: "https://claude.ai/elsewhere" })).status).toBe(400);
    // Missing PKCE goes back to the client as an OAuth error.
    const noPkce = await approve(body.client_id, "short");
    expect(new URL(noPkce.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
  });

  it("rotates refresh tokens; a reused old refresh token revokes the connection", async () => {
    const c = await connect();
    const r1 = await tokenCall({ grant_type: "refresh_token", refresh_token: c.refresh_token, client_id: c.clientId });
    expect(r1.status).toBe(200);
    expect(r1.body.refresh_token).not.toBe(c.refresh_token);
    expect((await rpc(c.access_token, "tools/list")).status).toBe(401); // old access token replaced
    expect((await rpc(r1.body.access_token, "tools/list")).status).toBe(200);

    // Two refreshes racing (old token again right away) fail without ending the connection…
    const race = await tokenCall({ grant_type: "refresh_token", refresh_token: c.refresh_token, client_id: c.clientId });
    expect(race.body.error).toBe("invalid_grant");
    expect((await rpc(r1.body.access_token, "tools/list")).status).toBe(200);
    // …but an old refresh token showing up later means it leaked: the connection is revoked.
    vi.useFakeTimers({ now: Date.now() + 5 * 60_000, toFake: ["Date"] });
    try {
      const reuse = await tokenCall({ grant_type: "refresh_token", refresh_token: c.refresh_token, client_id: c.clientId });
      expect(reuse.body.error).toBe("invalid_grant");
      expect((await rpc(r1.body.access_token, "tools/list")).status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
    const after = await tokenCall({ grant_type: "refresh_token", refresh_token: r1.body.refresh_token, client_id: c.clientId });
    expect(after.body.error).toBe("invalid_grant");
  });

  it("lists connections for settings and revokes them there or via RFC 7009", async () => {
    const a = await connect();
    const b = await connect();
    const list = await listConnections(db);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ clientName: "Claude" });
    expect(JSON.stringify(list)).not.toMatch(/Hash/);
    expect(await revokeConnection(db, list.find((x) => x)!.id)).toBe(true);
    await revoke(new Request(`${ORIGIN}/api/oauth/revoke`, { method: "POST", body: new URLSearchParams({ token: a.access_token }).toString() }));
    expect(await listConnections(db)).toHaveLength(0);
    expect((await rpc(b.access_token, "tools/list")).status).toBe(401);
  });
});

describe("MCP tools", () => {
  it("initializes with logging instructions and lists read and write tools", async () => {
    const { access_token } = await connect();
    const init = await rpc(access_token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe("momentum");
    expect(init.body.result.instructions).toMatch(/search_foods/);
    const tools = (await rpc(access_token, "tools/list")).body.result.tools as { name: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }[];
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["get_day", "get_goals_progress", "search_foods", "log_meal", "copy_meal", "delete_meal"]));
    expect(names).not.toContain("propose_action");
    expect(tools.find((t) => t.name === "get_day")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "delete_meal")?.annotations?.destructiveHint).toBe(true);
  });

  it("logs a meal with database, restaurant and estimated items; totals are Momentum's own", async () => {
    const { access_token } = await connect();
    const found = await callTool(access_token, "search_foods", { queries: ["egg fried"] });
    const egg = found.data["egg fried"][0];
    expect(egg.description).toContain("Egg, whole, fried");

    const args = {
      title: "Eggs, burrito & juice",
      category: "lunch",
      eaten_at: "2026-11-06T17:00:00Z",
      items: [
        { name: "Fried eggs", quantity: 2, unit: "large", grams_per_unit: 50, quantity_source: "user_stated", food_id: egg.food_id },
        {
          name: "Chicken burrito",
          quantity: 1,
          unit: "burrito",
          grams_per_unit: 550,
          restaurant: { restaurant: "Chipotle", item: "Chicken Burrito", serving: "1 burrito", serving_grams: null, per_serving: { calories: 1055, protein_g: 58, carbs_g: 115, fat_g: 39, sodium_mg: 2380 }, source_url: "https://www.chipotle.com/nutrition-calculator" },
        },
        { name: "Orange juice", quantity: 1, unit: "cup", grams_per_unit: 248, estimate_per_100g: { calories: 45, protein_g: 0.7, carbs_g: 10.4, fat_g: 0.2 } },
      ],
    };
    const logged = await callTool(access_token, "log_meal", args);
    expect(logged.isError).toBe(false);
    expect(logged.data.status).toBe("logged");
    expect(logged.data.meal.category).toBe("Lunch");
    expect(logged.data.meal.date).toBe("2026-11-06");
    const sources = logged.data.meal.items.map((i: { source: string }) => i.source);
    expect(sources[0]).toMatch(/^USDA database: Egg, whole, fried/);
    expect(sources[1]).toMatch(/^Restaurant data: Chipotle — Chicken Burrito .*\(chipotle\.com\)/);
    expect(sources[2]).toBe("AI estimate");
    expect(logged.data.meal.items[1].calories).toBe(1055);
    expect(logged.data.meal.meal_totals.calories).toBe(Math.round(182 + 1055 + 45 * 2.48));
    expect(logged.data.day.meals_logged).toBe(1);

    const [meal] = await listMeals(db, { start: "2026-11-06", end: "2026-11-06" });
    expect(meal.source).toBe("connector");
    expect(meal.items.map((i) => i.nutrientSource)).toEqual(["database", "restaurant", "ai_estimate"]);
    expect(itemNutrients(meal.items[0]).calories).toBeCloseTo(182, 6);
    expect(meal.items[1].warnings.join(" ")).toMatch(/reported by Claude/);

    // A retry of the same call doesn't create a second meal.
    expect((await callTool(access_token, "log_meal", args)).data.status).toBe("already_logged");
    expect(await listMeals(db, { start: "2026-11-06", end: "2026-11-06" })).toHaveLength(1);

    // Copy and delete.
    const copy = await callTool(access_token, "copy_meal", { meal_id: meal.id, eaten_at: "2026-11-06T22:00:00Z" });
    expect(copy.data.day.meals_logged).toBe(2);
    const del = await callTool(access_token, "delete_meal", { meal_id: copy.data.meal.meal_id });
    expect(del.data.status).toBe("deleted");
    expect(await listMeals(db, { start: "2026-11-06", end: "2026-11-06" })).toHaveLength(1);
  });

  it("rejects invented food ids, implausible restaurant numbers and items without a source", async () => {
    const { access_token } = await connect();
    const base = { title: "x", eaten_at: "2026-11-06T17:00:00Z" };
    const bad1 = await callTool(access_token, "log_meal", { ...base, items: [{ name: "x", quantity: 1, unit: "g", grams_per_unit: 1, food_id: "00000000-0000-4000-8000-000000000000" }] });
    expect(bad1).toMatchObject({ isError: true });
    expect(bad1.data).toMatch(/Unknown food_id/);
    const bad2 = await callTool(access_token, "log_meal", { ...base, items: [{ name: "x", quantity: 1, unit: "serving", grams_per_unit: 100, restaurant: { restaurant: "R", item: "I", serving: "1", per_serving: { calories: 90_000, protein_g: 1, carbs_g: 1, fat_g: 1 }, source_url: "https://r.example.com" } }] });
    expect(bad2.data).toMatch(/implausible/);
    const bad3 = await callTool(access_token, "log_meal", { ...base, items: [{ name: "x", quantity: 1, unit: "g", grams_per_unit: 1 }] });
    expect(bad3.data).toMatch(/needs food_id, restaurant or estimate_per_100g/);
    expect(await listMeals(db, { start: "2026-11-01", end: "2026-11-30" })).toHaveLength(0);
  });

  it("answers read tools with the same data the in-app assistant sees", async () => {
    const { access_token } = await connect();
    const goals = await callTool(access_token, "get_goals_and_settings", {});
    expect(goals.isError).toBe(false);
    expect(JSON.stringify(goals.data)).toContain("America/New_York");
    void s;
  });
});
