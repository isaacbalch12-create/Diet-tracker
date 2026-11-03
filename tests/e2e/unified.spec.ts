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
  await expect(routines.getByText("0/3 required").first()).toBeVisible();
  await routines.getByRole("checkbox", { name: /Stretching & mobility not done/ }).first().click();
  await expect(routines.getByText("1/3 required").first()).toBeVisible();
  // Routine goals update from the same log.
  const goals = await (await page.request.get("/api/user-goals")).json();
  const morning = goals.goals.find((g: { metric: string; params: { slot?: string } }) => g.metric === "routine_completion" && g.params.slot === "morning");
  expect(morning.current.value).toBeCloseTo(1 / 3, 5);

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
