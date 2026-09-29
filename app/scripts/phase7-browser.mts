import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve("../validation/screenshots");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results: { page: string; theme: string; width: number; status: number | undefined; overflow: boolean; loginShown: boolean }[] = [];
const errors: string[] = [];
let blockedWrites = 0;
try {
  for (const width of [1920, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: width === 1920 ? 1080 : 900 } });
    const page = await context.newPage();
    page.on("pageerror", () => errors.push("pageerror"));
    page.on("console", m => { if (m.type() === "error") errors.push("console error"); });
    await page.route("**/*", route => {
      if (!["GET", "HEAD"].includes(route.request().method())) { blockedWrites++; return route.abort(); }
      return route.continue();
    });
    for (const theme of ["light", "dark"]) {
      await page.goto("http://127.0.0.1:3100/");
      if (await page.locator("html").getAttribute("data-theme") !== theme) await page.getByRole("button", { name: `Switch to ${theme} theme` }).click();
      for (const [name, path] of [["Home", "/"], ["AI Videos", "/ai-videos"], ["Clipper", "/clipper"], ["Outreach", "/outreach"], ["Settings", "/settings"]]) {
        const response = await page.goto(`http://127.0.0.1:3100${path}`);
        await page.waitForLoadState("networkidle");
        assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
        await page.screenshot({ path: resolve(output, `phase7-live-${name.toLowerCase().replaceAll(" ", "-")}-${theme}-${width}.png`), fullPage: true });
        results.push({ page: name, theme, width, status: response?.status(), overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), loginShown: await page.getByLabel("Password", { exact: true }).count() > 0 });
      }
      assert.match(await page.locator("body").innerText(), /Outreach Sending: Disabled/);
      await page.reload();
      assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
    }
    await context.close();
  }
} finally { await browser.close(); }
const report = { results, consoleErrors: errors.length, blockedWrites };
await writeFile(resolve("../validation/phase7-live-browser.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ pagesChecked: results.length, consoleErrors: errors.length, blockedWrites, failures: results.filter(r => r.status !== 200 || r.overflow || r.loginShown).length }));
assert.equal(errors.length, 0);
assert.equal(blockedWrites, 0);
assert.ok(results.every(r => r.status === 200 && !r.overflow && !r.loginShown));
