// Pages with something on them, on the real worker: what the route sweep's empty pages can't show. Each ends on the
// same checks: nothing scrolls sideways, nothing was logged as an error, and a screenshot for a person to look at.
import { readFileSync } from "node:fs";
import { expect, overflow, test, type Problems } from "./fixtures";
import type { Page, TestInfo } from "@playwright/test";

const HANDS = readFileSync(new URL("../../solver/tests/data/hh/gg_allin_preflop.txt", import.meta.url), "utf8");

async function done(page: Page, problems: Problems, info: TestInfo, name: string) {
  await page.screenshot({ path: `e2e-results/shots/${info.project.name}/${name}.png`, fullPage: true });
  expect(await overflow(page), "sideways scroll, px").toBeLessThanOrEqual(0);
  expect(problems.errors).toEqual([]);
}

test("Study: a preflop spot, an action played, back, and the link reloaded", async ({ page, problems }, info) => {
  await page.goto("/lizard/study/?p=6&s=100");
  const actions = page.getByRole("region", { name: "Actions" }).getByRole("button");
  await expect(actions.first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/preflop chart/i).first()).toBeVisible();
  await actions.first().click();
  await expect(page).toHaveURL(/pre=/);
  const link = page.url();
  await page.reload();
  await expect(page).toHaveURL(link);
  await expect(actions.first()).toBeVisible({ timeout: 45_000 });
  await done(page, problems, info, "study-spot");
  await page.getByRole("button", { name: /Back/ }).click();
  await expect(page).not.toHaveURL(link);
});

test("Practice: a decision made and graded", async ({ page, problems }, info) => {
  await page.goto("/lizard/practice/");
  const options = page.getByRole("group", { name: "Your options" }).getByRole("button");
  await expect(options.first()).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: `e2e-results/shots/${info.project.name}/practice-turn.png` }); // (what you see first)
  const seen = await page.getByRole("region", { name: "Your move" }).boundingBox();
  expect(seen?.y, "your move starts on the first screen, without scrolling past the setup").toBeLessThan(
    page.viewportSize()?.height ?? 0,
  );
  await options.first().click();
  await expect(page.getByText(/Decisions graded/i)).toBeVisible();
  await done(page, problems, info, "practice-graded");
});

test("Analyze: a hand history imported and opened", async ({ page, problems }, info) => {
  await page.goto("/lizard/analyze/");
  await page.getByLabel("Paste hand histories").fill(HANDS);
  await page.getByRole("button", { name: "Import pasted hands" }).click();
  await expect(page.getByRole("status", { name: "Import result" })).toBeVisible();
  await done(page, problems, info, "analyze-imported");
});

test("a worker that goes quiet while booting is started again", async ({ page, problems }, info) => {
  test.skip(info.project.name !== "desktop", "the same at every width");
  test.setTimeout(90_000);
  let starts = 0;
  await page.route(/\/solver\/worker\.js/, async (route) => {
    starts += 1;
    if (starts === 1) await route.fulfill({
        contentType: "text/javascript",
        headers: { "Cross-Origin-Embedder-Policy": "require-corp" },
        body: "self.onmessage = () => {};",
      });
    else await route.continue();
  });
  // (a version this browser has booted: the short wait)
  const manifest = await (await page.request.get("/lizard/solver/manifest.json")).json();
  await page.addInitScript((v) => localStorage.setItem("lizard.solver.booted", v), manifest.version as string);
  await page.goto("/lizard/study/?p=6&s=100");
  await expect(page.getByRole("region", { name: "Actions" }).getByRole("button").first()).toBeVisible({ timeout: 70_000 });
  expect(starts).toBe(2);
  expect(problems.errors).toEqual([]);
});
