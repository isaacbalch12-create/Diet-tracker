import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const PASSWORD = "e2e-correct-horse";

export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** Same-origin JSON API call using the page's session cookie. */
export async function apiCall(request: APIRequestContext, method: string, path: string, data?: unknown) {
  const res = await request.fetch(path, {
    method,
    data,
    headers: { origin: "http://localhost:3200" },
  });
  return res;
}

export async function today(page: Page): Promise<string> {
  const res = await page.request.get("/api/settings");
  expect(res.ok()).toBeTruthy();
  return (await res.json()).today;
}
