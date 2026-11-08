import { expect, request as pwRequest, test } from "@playwright/test";
import { apiCall, login, today } from "./helpers";

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3200";

function liftlogBackup() {
  const t = "2026-09-01T10:00:00.000Z";
  return {
    format: "liftlog-backup",
    version: 1,
    exportedAt: "2026-10-01T00:00:00.000Z",
    data: {
      exercises: [{ id: "cx-e2e-landmine", name: "E2E Landmine Press", primaryMuscle: "shoulders", secondaryMuscles: [], equipment: "barbell", category: "compound", instructions: "", isCustom: true, isFavorite: true, archived: false, createdAt: t, updatedAt: t }],
      workouts: [
        { id: "w-e2e-1", name: "E2E Leg day", status: "completed", startedAt: "2026-09-10T22:30:00.000Z", endedAt: "2026-09-10T23:40:00.000Z", notes: "", templateId: null, unit: "lb", celebratedRecordKeys: [], createdAt: t, updatedAt: "2026-09-10T23:40:00.000Z" },
        { id: "w-e2e-2", name: "E2E Press", status: "completed", startedAt: "2026-09-12T15:00:00.000Z", endedAt: null, notes: "", templateId: null, unit: "lb", celebratedRecordKeys: [], createdAt: t, updatedAt: "2026-09-12T16:00:00.000Z" },
      ],
      workoutExercises: [
        { id: "we-e2e-1", workoutId: "w-e2e-1", exerciseId: "bi-barbell-back-squat", position: 0, notes: "", restSeconds: 180 },
        { id: "we-e2e-2", workoutId: "w-e2e-2", exerciseId: "cx-e2e-landmine", position: 0, notes: "", restSeconds: null },
      ],
      sets: [
        { id: "s-e2e-1", workoutId: "w-e2e-1", workoutExerciseId: "we-e2e-1", exerciseId: "bi-barbell-back-squat", position: 0, setNumber: 1, manualSetNumber: false, weightKg: 100, reps: 5, rpe: null, notes: "", kind: "working", completed: true, completedAt: null, targetWeightKg: null, targetReps: null, createdAt: t, updatedAt: t },
        { id: "s-e2e-2", workoutId: "w-e2e-2", workoutExerciseId: "we-e2e-2", exerciseId: "cx-e2e-landmine", position: 0, setNumber: 1, manualSetNumber: false, weightKg: 30, reps: 10, rpe: null, notes: "", kind: "working", completed: true, completedAt: null, targetWeightKg: null, targetReps: null, createdAt: t, updatedAt: t },
      ],
      templates: [],
      settings: { id: "settings", unit: "lb", theme: "dark", weekStartsOn: 1, oneRmFormula: "epley", maxRepsFor1RM: 12, defaultRestSeconds: 120, autoStartRest: true, restSound: true, restVibrate: true, weightStepKg: 2.5, weightStepLb: 5, weeklyTarget: 3, showRpe: false, createdAt: t, updatedAt: t },
    },
  };
}

test("LiftLog history imports through Settings and never duplicates", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  const card = page.locator("#import-liftlog");
  const file = { name: "liftlog-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(liftlogBackup())) };
  await card.locator('input[type="file"]').setInputFiles(file);
  await expect(card.getByText("Import complete")).toBeVisible();
  await expect(card.getByText(/Workouts: 2 added/)).toBeVisible();
  await expect(card.getByText(/durations and rest timers/)).toBeVisible();
  await card.locator('input[type="file"]').setInputFiles(file);
  await expect(card.getByText(/Workouts: 0 added, 0 updated, 2 already up to date/)).toBeVisible();
  const list = await (await page.request.get("/api/workouts")).json();
  expect(list.workouts.filter((w: { name: string }) => w.name.startsWith("E2E")).length).toBe(2);
  const goals = await (await page.request.get("/api/user-goals")).json();
  expect(goals.goals.some((g: { metric: string; targetValue: number }) => g.metric === "workouts" && g.targetValue === 3)).toBe(true);
});

test("phone health sync: token-only ingest, scopes, de-duplication and revocation", async ({ page }) => {
  await login(page);
  const day = await today(page);
  const created = await apiCall(page.request, "POST", "/api/vitals/connections", { name: "E2E iPhone", platform: "ios_shortcut", scopes: ["steps", "sleep"] });
  expect(created.ok()).toBeTruthy();
  const { token, connection } = await created.json();
  expect(token).toMatch(/^hk_/);

  // The phone has no browser session: only the bearer token.
  const phone = await pwRequest.newContext({ baseURL: BASE });
  const bad = await phone.post("/api/ingest/health", { data: { steps: [{ date: day, value: 100 }] }, headers: { authorization: "Bearer hk_wrong" } });
  expect(bad.status()).toBe(401);
  const payload = { days: [{ date: day, steps: "8,123", restingHeartRate: 55, sleepScore: 90 }] };
  const first = await phone.post("/api/ingest/health", { data: payload, headers: { authorization: `Bearer ${token}` } });
  expect(first.status()).toBe(200);
  const body = await first.json();
  expect(body.byMetric).toEqual({ steps: 1 });
  expect(body.ignored.map((i: { reason: string }) => i.reason).join(" ")).toMatch(/not allowed|provider/);
  await phone.post("/api/ingest/health", { data: payload, headers: { authorization: `Bearer ${token}` } });
  const vitals = await (await page.request.get(`/api/vitals?start=${day}&end=${day}`)).json();
  expect(vitals.metrics.steps.days[0].value).toBe(8123);
  expect(vitals.metrics.steps.loggedDays).toBe(1);
  expect(vitals.metrics.sleep_score.loggedDays).toBe(0); // never invented

  await page.goto("/");
  await expect(page.getByText("8,123").first()).toBeVisible();

  const revoked = await apiCall(page.request, "DELETE", `/api/vitals/connections/${connection.id}`);
  expect(revoked.ok()).toBeTruthy();
  const after = await phone.post("/api/ingest/health", { data: payload, headers: { authorization: `Bearer ${token}` } });
  expect(after.status()).toBe(401);
  await phone.dispose();
});

test("dashboard: default routines tick off from Today and sections can be hidden", async ({ page }) => {
  await login(page);
  await page.goto("/");
  const routines = page.getByRole("region", { name: "Routines" });
  await expect(routines.getByText("Stretching & mobility").first()).toBeVisible();
  await expect(routines.getByText("0/4 required").first()).toBeVisible();
  await routines.getByRole("checkbox", { name: /Stretching & mobility not done/ }).first().click();
  await expect(routines.getByText("1/4 required").first()).toBeVisible();
  // Routine goals update from the same log.
  const goals = await (await page.request.get("/api/user-goals")).json();
  const morning = goals.goals.find((g: { metric: string; params: { slot?: string } }) => g.metric === "routine_completion" && g.params.slot === "morning");
  expect(morning.current.value).toBeCloseTo(1 / 4, 5);

  await page.getByRole("button", { name: "Customize dashboard" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Hide Activity log" }).click();
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("region", { name: "Activity log" })).toHaveCount(0);
  await page.getByRole("button", { name: "Customize dashboard" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Show Activity log" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("region", { name: "Activity log" })).toHaveCount(1);
});

test("running: log a run, mark rest days, streak and goal update", async ({ page }) => {
  await login(page);
  const day = await today(page);
  const yesterday = new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const rest = await apiCall(page.request, "POST", "/api/runs/day-off", { localDate: yesterday, kind: "recovery", notes: null });
  expect(rest.ok()).toBeTruthy();
  const run = await apiCall(page.request, "POST", "/api/runs", { clientRequestId: "e2e-run-0001", localDate: day, distance: { value: 3.1, unit: "mi" }, runType: "Easy", effort: 4, notes: null });
  expect(run.status()).toBe(201);
  const again = await apiCall(page.request, "POST", "/api/runs", { clientRequestId: "e2e-run-0001", localDate: day, distance: { value: 3.1, unit: "mi" }, runType: "Easy", effort: 4, notes: null });
  expect(again.status()).toBe(200); // retried request, not a duplicate
  const overview = await (await page.request.get("/api/runs?range=7d")).json();
  expect(overview.days.find((d: { date: string }) => d.date === yesterday).status).toBe("recovery");
  expect(overview.days.find((d: { date: string }) => d.date === day).status).toBe("done");
  expect(overview.entries.filter((e: { kind: string }) => e.kind === "run").length).toBe(1);
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Running" }).getByText(/Run complete/)).toBeVisible();
  const goals = await (await page.request.get("/api/user-goals")).json();
  expect(goals.goals.find((g: { metric: string }) => g.metric === "run_completed").current.status).toBe("met");
});

test("training: log a workout set by set, finish it, and see records and goals update", async ({ page }) => {
  await login(page);
  const logBench = async (weight: string, reps: string) => {
    await page.goto("/training?start=1");
    await page.getByRole("dialog").getByRole("button", { name: /Start empty workout/ }).click();
    await page.waitForURL(/\/training\/workouts\//);
    await page.getByRole("button", { name: /Add exercise/ }).first().click();
    await page.getByLabel("Search exercises").fill("Barbell Bench");
    await page.getByRole("dialog").getByRole("button", { name: /^\S*\s*Barbell Bench Press/ }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: /^Add( \d+)?$/ }).click();
    await page.getByLabel(/Set 1 weight/).fill(weight);
    await page.getByLabel(/Set 1 reps/).fill(reps);
    await page.getByRole("button", { name: /Complete set 1/ }).click();
    await expect(page.getByText("Saved").first()).toBeVisible();
    await page.getByRole("button", { name: "Finish workout" }).click();
    await expect(page.getByText("Workout complete")).toBeVisible();
    return page.url().split("/").pop()!;
  };
  await logBench("185", "5");
  const second = await logBench("195", "5");
  await expect(page.getByText(/New record: Barbell Bench Press/).first()).toBeVisible();
  const w = (await (await page.request.get(`/api/workouts/${second}`)).json()).workout;
  expect(w.status).toBe("completed");
  expect(w.exercises[0].sets[0].reps).toBe(5);
  expect(Object.keys(w)).not.toContain("startedAt"); // no time tracking
  const goals = await (await page.request.get("/api/user-goals")).json();
  expect(goals.goals.find((g: { metric: string }) => g.metric === "workouts").current.value).toBeGreaterThanOrEqual(2);
  await page.goto("/training/exercises/bi-barbell-bench-press");
  await expect(page.getByRole("heading", { name: "Barbell Bench Press" }).first()).toBeVisible();
});

test("goals: create from a preset, see live progress, pause and delete", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await login(page);
  const day = await today(page);
  await apiCall(page.request, "POST", "/api/vitals", { localDate: day, metric: "steps", value: 9000 });
  await page.goto("/goals?new=1");
  await page.getByRole("dialog").getByRole("button", { name: /8,000 steps daily/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Create goal" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const goals = await (await page.request.get("/api/user-goals")).json();
  const steps = goals.goals.find((g: { metric: string }) => g.metric === "steps");
  expect(steps.current).toMatchObject({ value: 9000, status: "met" });
  await page.getByRole("button", { name: `Actions for ${steps.title}` }).click();
  await page.getByRole("menuitem", { name: "Pause" }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/user-goals/${steps.id}`)).json()).goal.status).toBe("paused");
  const paused = (await (await page.request.get(`/api/user-goals/${steps.id}`)).json()).goal;
  expect(paused.targetValue).toBe(8000); // a status-only change keeps every other field
  expect(paused.showOnDashboard).toBe(steps.showOnDashboard);
  const del = await apiCall(page.request, "DELETE", `/api/user-goals/${steps.id}`);
  expect(del.ok()).toBeTruthy();
});

test("Claude connector: sign-in requires the owner, consent issues a code, settings can disconnect", async ({ page, browser }) => {
  const { createHash, randomBytes } = await import("node:crypto");
  const REDIRECT = "http://localhost:5599/callback";
  const anon = await pwRequest.newContext({ baseURL: BASE });
  // Claude's side: unauthenticated call → 401 with discovery pointer → register.
  const challengeRes = await anon.post("/api/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" }, headers: { accept: "application/json, text/event-stream" } });
  expect(challengeRes.status()).toBe(401);
  expect(challengeRes.headers()["www-authenticate"]).toContain("/.well-known/oauth-protected-resource");
  const reg = await (await anon.post("/api/oauth/register", { data: { client_name: "Claude", redirect_uris: [REDIRECT] } })).json();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = `/oauth/authorize?response_type=code&client_id=${reg.client_id}&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${challenge}&code_challenge_method=S256&state=xyz&scope=momentum%20offline_access`;

  // A visitor without the password lands on the login page, not the consent screen.
  const stranger = await browser.newContext();
  const sp = await stranger.newPage();
  await sp.goto(authorize);
  await expect(sp).toHaveURL(/\/login\?next=/);
  await stranger.close();

  // The owner signs in, sees what is being connected, and allows it.
  await login(page);
  // Skip the first-run welcome screen when this test runs on its own.
  expect((await apiCall(page.request, "PATCH", "/api/settings", { onboarded: true })).ok()).toBeTruthy();
  await page.goto(authorize);
  await expect(page.getByText("wants to connect to your Momentum account")).toBeVisible();
  await expect(page.getByText("localhost:5599")).toBeVisible();
  // Nothing listens on the callback port; read the redirect the consent POST answers with.
  const [decision] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/oauth/authorize") && r.request().method() === "POST"), page.getByRole("button", { name: "Allow" }).click()]);
  expect(decision.status()).toBe(303);
  const cb = new URL(decision.headers()["location"]);
  expect(`${cb.origin}${cb.pathname}`).toBe(REDIRECT);
  expect(cb.searchParams.get("state")).toBe("xyz");

  const tokenRes = await anon.post("/api/oauth/token", { form: { grant_type: "authorization_code", code: cb.searchParams.get("code")!, code_verifier: verifier, client_id: reg.client_id, redirect_uri: REDIRECT } });
  expect(tokenRes.ok()).toBeTruthy();
  const tokens = await tokenRes.json();
  const list = await anon.post("/api/mcp", { data: { jsonrpc: "2.0", id: 2, method: "tools/list" }, headers: { accept: "application/json, text/event-stream", authorization: `Bearer ${tokens.access_token}` } });
  expect(list.ok()).toBeTruthy();
  expect(JSON.stringify(await list.json())).toContain("log_meal");

  // Settings shows the URL to paste into Claude and the connection, which can be disconnected.
  await page.goto("/settings#claude-connector");
  await expect(page.getByTestId("connector-url")).toHaveText(`${BASE}/api/mcp`);
  const section = page.locator("#claude-connector");
  await expect(section.getByText("Claude", { exact: true })).toBeVisible();
  await section.getByRole("button", { name: "Disconnect" }).click();
  await expect(section.getByText("None yet.")).toBeVisible();
  const after = await anon.post("/api/mcp", { data: { jsonrpc: "2.0", id: 3, method: "tools/list" }, headers: { accept: "application/json, text/event-stream", authorization: `Bearer ${tokens.access_token}` } });
  expect(after.status()).toBe(401);
  await anon.dispose();
});
