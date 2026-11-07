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

test("Study: the line walked by its breadcrumb, Forward and the keys, and a call's pot odds", async ({ page, problems }, info) => {
  await page.goto("/lizard/study/?p=6&s=100&pre=UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f");
  const actions = page.getByRole("region", { name: "Actions" });
  await expect(actions.getByText("to call 1.5bb · pot odds 27.3%")).toBeVisible({ timeout: 45_000 });
  const line = page.getByRole("navigation", { name: "Line" });
  await expect(line.getByRole("button", { name: "3 folds" })).toBeVisible();
  const here = line.locator('[aria-current="step"]');
  await expect(here).toHaveText("SB fold");
  const forward = line.getByRole("button", { name: /Forward/ });
  await expect(forward).toBeDisabled();

  await page.keyboard.press("ArrowLeft");
  await expect(here).toHaveText("BTN raise 2.5");
  await line.getByRole("button", { name: "3 folds" }).click();
  await expect(here).toHaveText("3 folds");
  await expect(page).toHaveURL(/pre=UTG%3Af%2CHJ%3Af%2CCO%3Af(&|$)/);
  await forward.click();
  await expect(here).toHaveText("BTN raise 2.5");
  await page.keyboard.press("ArrowRight");
  await expect(here).toHaveText("SB fold");
  await expect(forward).toBeDisabled();

  // a number plays that action; what was ahead on another line is gone
  await page.keyboard.press("ArrowLeft");
  await expect(here).toHaveText("BTN raise 2.5"); // (first, or the last node's answer could pass for this one's)
  await expect(actions.getByText(/to act on the preflop/)).toBeVisible({ timeout: 45_000 });
  await page.keyboard.press("1");
  await expect(here).not.toHaveText("BTN raise 2.5");
  await expect(here).not.toHaveText("SB fold");
  await expect(forward).toBeDisabled();

  // not while typing
  const url = page.url();
  await page.getByLabel("Stack in big blinds").focus();
  await page.keyboard.press("ArrowLeft");
  expect(page.url()).toBe(url);
  await done(page, problems, info, "study-line");
});

test("Study: a river's breakdown, with its categories, its equity chart and a category shown in the grid", async ({ page, problems }, info) => {
  await page.goto("/lizard/study/?p=2&s=100&pre=SB:c,BB:x&b=Ks7d2c5h9d&flop=BB:x,SB:x&turn=BB:x,SB:x");
  const panel = page.locator("details", { hasText: "Breakdown and equity" });
  await expect(panel).toBeVisible({ timeout: 90_000 });
  await panel.locator("summary").click();
  const cats = panel.getByRole("region", { name: "Hand categories" });
  await expect(cats.getByRole("row").nth(1)).toBeVisible({ timeout: 45_000 });
  await expect(cats.getByRole("button", { name: /^Live solve|solve/i }).or(cats.getByText(/solve/i)).first()).toBeVisible();
  const chart = panel.getByRole("region", { name: "Equity distribution" });
  await expect(chart.getByText(/range advantage/)).toBeVisible();
  await expect(chart.getByText("on the river, no cards to come", { exact: false })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Compare this spot" })).toHaveCount(1);
  await chart.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `e2e-results/shots/${info.project.name}/study-breakdown.png`, fullPage: false });
  await cats.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `e2e-results/shots/${info.project.name}/study-breakdown-cats.png`, fullPage: false });

  await cats.getByRole("group", { name: "What an action is made of" }).getByRole("button").nth(1).click();
  await expect(cats.getByRole("columnheader", { name: /^Share of bet/ })).toBeVisible();
  await cats.getByRole("group", { name: "What an action is made of" }).getByRole("button").nth(1).click();

  await cats.getByRole("row").nth(1).getByRole("button").click();
  await cats.getByRole("button", { name: "Show these hands in the grid" }).click();
  await expect(page.getByRole("combobox", { name: /one category/ })).not.toHaveValue("");
  expect(await overflow(page), "sideways scroll, px").toBeLessThanOrEqual(0);
  expect(problems.errors).toEqual([]);
});

test("Study: a bet split into value and bluff, and what a hand blocks, on the real engine", async ({ page, problems }, info) => {
  await page.goto("/lizard/study/?p=2&s=100&pre=SB:c,BB:x&b=Ks7d2c5h9d&flop=BB:x,SB:x&turn=BB:x,SB:x");
  const panel = page.locator("details", { hasText: "Breakdown and equity" });
  await expect(panel).toBeVisible({ timeout: 90_000 });
  await panel.locator("summary").click();
  const cats = panel.getByRole("region", { name: "Hand categories" });
  await expect(cats.getByRole("row").nth(1)).toBeVisible({ timeout: 45_000 });
  await cats.getByRole("group", { name: "What an action is made of" }).getByRole("button", { name: /^bet/ }).first().click();
  await expect(cats.getByRole("group", { name: "Value and bluff" }).getByText(/value \(/)).toBeVisible();
  await expect(cats.getByRole("columnheader", { name: "Value" })).toBeVisible();

  const blockers = panel.getByRole("region", { name: "Blockers" });
  await blockers.getByRole("combobox", { name: "Hand" }).selectOption({ index: 1 });
  await expect(blockers.getByText(/continues .* of the time/)).toBeVisible({ timeout: 45_000 });
  await blockers.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `e2e-results/shots/${info.project.name}/study-blockers.png`, fullPage: false });
  expect(await overflow(page), "sideways scroll, px").toBeLessThanOrEqual(0);
  expect(problems.errors).toEqual([]);
});

test("Study: the folds to a seat in one step, and the split beside the grid that lasts", async ({ page, problems }, info) => {
  await page.goto("/lizard/study/?p=6&s=100");
  const seats = page.getByRole("group", { name: "Fold to a seat" });
  await expect(seats).toBeVisible({ timeout: 90_000 });
  await seats.getByRole("button", { name: /CO to act/ }).click();
  await expect.poll(() => new URL(page.url()).search).toContain("UTG");
  await expect(page.getByText(/Preflop charts/).first()).toBeVisible({ timeout: 45_000 });

  const split = page.getByRole("separator", { name: "Resize the range and the panel beside it" });
  if (info.project.name === "phone") {
    await expect(split).toHaveCount(0);
  } else {
    await split.focus();
    await page.keyboard.press("Home");
    const at = await split.getAttribute("aria-valuenow");
    await page.waitForTimeout(500); // (the Setting is written as it moves)
    await page.reload();
    await expect(split).toBeVisible({ timeout: 90_000 });
    await expect(split).toHaveAttribute("aria-valuenow", at ?? "");
    await page.screenshot({ path: `e2e-results/shots/${info.project.name}/study-split.png`, fullPage: false });

    // Build's grid is that same split: at the size it was left, moved by a real drag, and put back by a real key
    await page.getByRole("button", { name: "✎ Build" }).click();
    await expect(page.getByRole("region", { name: "Build" })).toBeVisible();
    await expect(split).toHaveAttribute("aria-valuenow", at ?? "");
    await expect(split).toHaveAccessibleDescription(/Press Enter or double-click to reset/);
    const bar = (await split.boundingBox())!;
    await page.mouse.move(bar.x + bar.width / 2, bar.y + 100);
    await page.mouse.down();
    await page.mouse.move(bar.x + bar.width / 2 + 120, bar.y + 100, { steps: 4 });
    await page.mouse.up();
    await expect(split).not.toHaveAttribute("aria-valuenow", at ?? "");
    await split.dblclick();
    await expect(split).toHaveAttribute("aria-valuenow", "58");
    await split.focus();
    await page.keyboard.press("End");
    await expect(split).not.toHaveAttribute("aria-valuenow", "58");
    await page.keyboard.press("Enter");
    await expect(split).toHaveAttribute("aria-valuenow", "58");
    await expect(split).toBeFocused();
  }
  expect(await overflow(page), "sideways scroll, px").toBeLessThanOrEqual(0);
  expect(problems.errors).toEqual([]);
});

test("The engine runs on files from this site alone: the page and its workers ask no other host", async ({ page, problems }, info) => {
  const elsewhere: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.protocol.startsWith("http") && u.hostname !== "localhost") elsewhere.push(r.url());
  });
  await page.goto("/lizard/study/?p=6&s=100");
  await expect(page.getByRole("region", { name: "Actions" }).getByRole("button").first()).toBeVisible({ timeout: 45_000 });
  expect(elsewhere).toEqual([]);
  await done(page, problems, info, "own-host");
});

test("A page that can't draw what's stored keeps the way out: the backup, whichever page threw", async ({ page, problems }) => {
  await page.goto("/lizard/saved/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // (what an old restore could have left: a tag a page can't draw)
  await page.evaluate(
    () =>
      new Promise<void>((ok, no) => {
        const open = indexedDB.open("lizard");
        open.onerror = () => no(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("savedSpots", "readwrite");
          tx.objectStore("savedSpots").put({ id: "bad", title: "Bad", line: "p=6&s=100", state: {}, tags: [{ a: 1 }], note: "", createdAt: 1, updatedAt: 1 });
          tx.oncomplete = () => {
            db.close();
            ok();
          };
        };
      }),
  );
  await page.reload();
  const trouble = page.getByRole("alert", { name: "This page stopped" });
  await expect(trouble).toBeVisible();
  const file = page.waitForEvent("download");
  await trouble.getByRole("button", { name: "Download backup" }).click();
  expect((await file).suggestedFilename()).toMatch(/\.json$/);
  await expect(trouble.getByText(/^Backup made/)).toBeVisible();
  await page.getByRole("link", { name: "Go to the home page" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // (the page said what threw, on purpose here)
  problems.errors.length = 0;
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
