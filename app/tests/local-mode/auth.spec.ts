import { test, expect } from "@playwright/test";

test("all pages open without login or account controls", async ({ page }) => {
  for (const path of ["/", "/ai-videos", "/clipper", "/outreach", "/settings"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(path);
    await expect(page.locator(".operator-account")).toHaveCount(0);
    await expect(page.locator(".sidebar-bottom")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Log Out", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  }
  await expect(page.locator("body")).not.toContainText("Authentication disabled for local testing");
  await expect(page.locator("body")).not.toContainText("Authenticated session");
  await expect(page.locator("body")).not.toContainText("Operator login required");
  await page.goto("/login");
  await expect(page).toHaveURL("/");
});

test("real API reads bypass sessions, writes retain origin and input validation", async ({ request }) => {
  const session = await request.get("/api/auth/session");
  expect(session.status()).toBe(200);
  expect(await session.json()).toEqual({ user: null, authEnabled: false });
  for (const path of ["/api/ai-video/status", "/api/ai-video/bridge/status", "/api/ai-video/jobs", "/api/clipper/overview", "/api/outreach/status", "/api/outreach/overview"]) {
    const response = await request.get(path);
    expect([200, 503]).toContain(response.status());
    expect(response.headers()["content-type"]).toContain("application/json");
  }
  // Deliberately invalid input never reaches external mutations or generation.
  for (const path of ["/api/ai-video/jobs", "/api/ai-video/jobs/invalid", "/api/outreach/draft", "/api/outreach/send-campaign", "/api/outreach/campaigns/invalid/discover", "/api/outreach/campaigns/invalid/freeze"]) {
    expect((await request.post(path, { headers: { Origin: "http://127.0.0.1:3102" }, data: {} })).status()).toBe(400);
  }
  for (const path of ["/api/ai-video/jobs", "/api/outreach/draft", "/api/outreach/send-campaign", "/api/outreach/campaigns/invalid/discover", "/api/outreach/campaigns/invalid/freeze", "/api/outreach/campaigns/invalid/confirm"]) {
    for (const headers of [{ Origin: "https://foreign.invalid" }, {}] as Record<string, string>[]) {
      expect((await request.post(path, { headers, data: {} })).status()).toBe(403);
    }
  }
  const redirect = await request.get("/login", { maxRedirects: 0 });
  expect(redirect.status()).toBe(307);
  expect(new URL(redirect.headers().location, "http://127.0.0.1:3102").href).toBe("http://127.0.0.1:3102/");
  const queue = await request.post("/api/outreach/campaigns/invalid/confirm", {
    headers: { Origin: "http://127.0.0.1:3102" }, data: { version: 4, confirm: true, queueEnabled: true, nativeUrl: "https://other.invalid", senderAvailable: true },
  });
  expect(queue.status()).toBe(400);
  expect((await queue.json()).error).toContain("Invalid campaign ID");
});

for (const width of [1920, 1440]) for (const theme of ["light", "dark"]) {
  test(`no-login ${width}px ${theme}: pages, theme persistence and one-click form`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 900 });
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    await page.route("**/api/ai-video/bridge/status", route => route.fulfill({ json: { state: "connected", readyToGenerate: false, generation: "disabled", validation: "ready", comfy: "idle", creative: "idle" } }));
    await page.route("**/api/ai-video/jobs", route => { expect(route.request().method()).toBe("GET"); return route.fulfill({ json: { jobs: [] } }); });
    await page.route("**/api/clipper/overview", route => route.fulfill({ json: { state: "disconnected", sources: [], jobs: [], results: [] } }));
    await page.route("**/api/outreach/overview", route => route.fulfill({ json: { state: "connected", campaigns: [] } }));
    await page.route("**/api/outreach/status", route => route.fulfill({ json: { state: "connected", sender: "available", worker: "RUNNING", message: "Platform queueing is enabled." } }));
    await page.goto("/");
    if (theme === "dark") await page.getByRole("button", { name: "Switch to dark theme" }).click();
    for (const [name, path] of [["Home", "/"], ["AI Videos", "/ai-videos"], ["Clipper", "/clipper"], ["Outreach", "/outreach"], ["Settings", "/settings"]]) {
      await page.getByRole("navigation").getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await page.screenshot({ path: `../validation/screenshots/phase7-local-${name.toLowerCase().replaceAll(" ", "-")}-${theme}-${width}.png`, fullPage: true });
    }
    await expect(page.locator("body")).toContainText("Outreach Sending — Enabled");
    await expect(page.locator("body")).not.toContainText("Authenticated session");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.goto("/outreach/new");
    await expect(page.getByRole("button", { name: "Send Campaign", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Confirm & Queue", exact: true })).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
