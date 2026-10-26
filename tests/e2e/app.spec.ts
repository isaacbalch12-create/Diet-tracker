import { expect, test } from "@playwright/test";
import { apiCall, login, PASSWORD, today } from "./helpers";

test.describe.configure({ mode: "serial" });

test("unauthenticated access is blocked", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  const api = await request.get("/api/day");
  expect(api.status()).toBe(401);

  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect password")).toBeVisible();
});

test("cross-origin writes are rejected", async ({ page }) => {
  await login(page);
  const res = await page.request.fetch("/api/weights", { method: "POST", data: { value: 1, unit: "lb", period: "morning" }, headers: { origin: "https://evil.example" } });
  expect(res.status()).toBe(403);
});

test("onboarding sets units, time zone, weights and versioned goals", async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/\/welcome/);
  await page.getByLabel("Time zone").selectOption("America/New_York");
  await page.getByLabel("Starting weight (lb)").fill("200");
  await page.getByLabel("Target weight (lb)").fill("185");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByLabel("Calories (kcal)").fill("2000");
  await page.getByLabel("Protein (g)").fill("150");
  await page.getByLabel("Carbohydrates (g)").fill("200");
  await page.getByLabel("Fat (g)").fill("70");
  await page.getByRole("button", { name: "Save goals" }).click();
  await expect(page).toHaveURL("http://localhost:3200/");
  await expect(page.getByText("/ 2,000 kcal")).toBeVisible();
  await expect(page.getByText("150 g to go")).toBeVisible();
});

test("weight: log, conflict → replace, edit and delete", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await login(page);
  const card = page.locator("section, div").filter({ has: page.getByRole("heading", { name: "Weight", exact: true }) }).first();
  await card.getByRole("radio", { name: "Morning" }).click();
  await card.getByLabel("Weight in lb").fill("200.4");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Morning weight saved")).toBeVisible();
  await expect(card.getByText("200.4 lb", { exact: true })).toBeVisible();

  // A second morning entry for the same day must not silently duplicate.
  await card.getByRole("button", { name: "Log weight" }).click();
  await card.getByRole("radio", { name: "Morning" }).click();
  await card.getByLabel("Weight in lb").fill("199.8");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByText("is already logged for this day")).toBeVisible();
  await card.getByRole("button", { name: "Replace it" }).click();
  await expect(card.getByText("199.8 lb", { exact: true })).toBeVisible();

  await page.goto("/weight");
  const row = page.getByRole("row").filter({ hasText: "199.8 lb" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /Edit morning weight/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Weight (lb)").fill("199.6");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("row").filter({ hasText: "199.6 lb" })).toBeVisible();

  await page.getByRole("row").filter({ hasText: "199.6 lb" }).getByRole("button", { name: /Delete morning weight/ }).click();
  await expect(page.getByText("No weigh-ins yet")).toBeVisible();

  // Leave a morning + night pair for later tests.
  await page.getByRole("radio", { name: "Morning" }).click();
  await page.getByLabel("Weight in lb").fill("199.2");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Morning weight saved")).toBeVisible();
  await page.getByRole("radio", { name: "Night" }).click();
  await page.getByLabel("Weight in lb").fill("201.0");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Night weight saved")).toBeVisible();
  await expect(page.getByText("+1.8 lb").first()).toBeVisible(); // avg night − morning
});

test("food: search → review → edit → save; edits, copies and deletes update totals", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await login(page);
  const created = await apiCall(page.request, "POST", "/api/foods", {
    description: "E2E Oat Bowl",
    servingGrams: 250,
    servingLabel: "bowl",
    nutrientsPerServing: { calories: 300, protein: 12, carbs: 50, fat: 6 },
  });
  expect(created.status()).toBe(201);

  await page.goto("/log");
  await page.getByRole("radio", { name: "Search" }).click();
  await page.getByLabel("Search foods").fill("E2E Oat");
  await page.getByRole("button", { name: /E2E Oat Bowl/ }).click();

  await expect(page.getByRole("heading", { name: "Review meal" })).toBeVisible();
  await expect(page.getByText("300 kcal").first()).toBeVisible();
  await page.getByLabel("Quantity").fill("2");
  await page.getByLabel("Quantity").press("Enter");
  await expect(page.getByText("600 kcal").first()).toBeVisible();

  // Add a manual item from a nutrition label.
  await page.getByRole("button", { name: "Add food" }).click();
  await page.getByRole("radio", { name: "Enter manually" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Food name").fill("Protein bar");
  await dlg.getByLabel("Amount eaten (g)").fill("60");
  await dlg.getByLabel("Calories (kcal)").fill("210");
  await dlg.getByLabel("Protein (g)").fill("20");
  await dlg.getByRole("button", { name: "Add food" }).click();
  await expect(page.getByText("810 kcal").first()).toBeVisible();

  await page.getByLabel("Title").fill("Oat breakfast");
  await page.getByRole("button", { name: "Save meal" }).click();
  await expect(page).toHaveURL("http://localhost:3200/");
  await expect(page.getByRole("link", { name: /Oat breakfast/ }).first()).toBeVisible();
  await expect(page.getByText("1,190 kcal remaining")).toBeVisible();

  // Edit on the meal page.
  await page.getByRole("link", { name: /Oat breakfast/ }).first().click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Quantity").first().fill("1");
  await page.getByLabel("Quantity").first().press("Enter");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Meal updated")).toBeVisible();
  await expect(page.getByText("510 kcal").first()).toBeVisible();

  await page.goto("/");
  await expect(page.getByText("1,490 kcal remaining")).toBeVisible();
  // Copy, then delete the copy.
  await page.getByRole("button", { name: "Log “Oat breakfast” again now" }).click();
  await expect(page.getByText("2 meals logged")).toBeVisible();
  await expect(page.getByText("980 kcal remaining")).toBeVisible();
  await page.getByRole("button", { name: "Delete “Oat breakfast”" }).first().click();
  await expect(page.getByText("1 meal logged")).toBeVisible();
  await expect(page.getByText("1,490 kcal remaining")).toBeVisible();
});

test("saved meals log as independent copies", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: /Oat breakfast/ }).first().click();
  await page.getByRole("button", { name: "Save as favorite" }).click();
  await expect(page.getByText(/Saved to favorites/)).toBeVisible();
  await page.goto("/log");
  await page.getByRole("radio", { name: "Saved" }).click();
  await page.getByRole("button", { name: "Log", exact: true }).first().click();
  await expect(page).toHaveURL("http://localhost:3200/");
  await expect(page.getByText("2 meals logged")).toBeVisible();
});

test("AI features explain missing configuration instead of failing silently", async ({ page }) => {
  await login(page);
  await page.goto("/log");
  // Without a key the logger opens on database search; describing shows why AI is unavailable.
  await expect(page.getByRole("radio", { name: "Search" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Describe" }).click();
  await expect(page.getByText(/AI analysis isn.t configured/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Analyze" })).toBeDisabled();
  const res = await apiCall(page.request, "POST", "/api/analyze", { requestId: "e2e-request-1", text: "two eggs", imageIds: [] });
  expect(res.status()).toBe(503);
  expect((await res.json()).error.message).toMatch(/ANTHROPIC_API_KEY/);
  await page.goto("/assistant");
  await expect(page.getByText("The assistant needs an Anthropic API key")).toBeVisible();
});

test("photo uploads are validated", async ({ page }) => {
  await login(page);
  // 1×1 PNG
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const ok = await page.request.post("/api/images", { multipart: { file: { name: "a.png", mimeType: "image/png", buffer: png } }, headers: { origin: "http://localhost:3200" } });
  expect(ok.status()).toBe(201);
  const { images } = await ok.json();
  const img = await page.request.get(images[0].url);
  expect(img.headers()["content-type"]).toBe("image/png");

  const text = await page.request.post("/api/images", { multipart: { file: { name: "a.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not really an image at all") } }, headers: { origin: "http://localhost:3200" } });
  expect(text.status()).toBe(415);

  const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(32)]);
  const h = await page.request.post("/api/images", { multipart: { file: { name: "a.heic", mimeType: "image/heic", buffer: heic } }, headers: { origin: "http://localhost:3200" } });
  expect(h.status()).toBe(415);
  expect((await h.json()).error.message).toMatch(/HEIC/);

  const big = Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024)]);
  const b = await page.request.post("/api/images", { multipart: { file: { name: "big.png", mimeType: "image/png", buffer: big } }, headers: { origin: "http://localhost:3200" } });
  expect(b.status()).toBe(413);
});

test("history, analytics and exports reflect the logged data", async ({ page }) => {
  await login(page);
  const day = await today(page);
  await page.goto("/history");
  await expect(page.getByText("1 of").first()).toBeVisible();
  await page.goto("/analytics");
  await expect(page.getByText(/Food logged on/)).toContainText("1");
  await expect(page.getByRole("heading", { name: "Calories", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show Calories as a table" }).click();
  await expect(page.getByRole("cell", { name: day })).toBeVisible();

  const csv = await (await page.request.get(`/api/export?type=daily&start=${day}&end=${day}`)).text();
  expect(csv.split("\r\n")[1]).toContain(`${day},2,`);
  const items = await (await page.request.get("/api/export?type=meals")).text();
  expect(items).toContain("E2E Oat Bowl");
  expect(items).toContain("Protein bar");
  const backup = await (await page.request.get("/api/export?type=backup")).json();
  expect(backup.app).toBe("diet-tracker");
  expect(backup.meals.length).toBe(2);
});

test("mobile layout: bottom navigation and quick weight entry", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "America/New_York" });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("http://localhost:3200/");
  const nav = page.getByRole("navigation", { name: "Main" }).last();
  await expect(nav.getByRole("link", { name: "Log food" })).toBeVisible();
  const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await expect(page.getByText("kcal remaining")).toBeVisible();
  await noOverflow();
  await nav.getByRole("link", { name: "Weight" }).click();
  await expect(page.getByRole("heading", { name: "Weight", exact: true }).first()).toBeVisible();
  await noOverflow();
  for (const path of ["/log", "/history", "/analytics", "/settings"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await noOverflow();
  }
  await ctx.close();
});
