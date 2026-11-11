// The range builder on a touch phone and to a screen reader (the last of Phase 4): a tap paints a hand, a finger dragged
// across the grid paints every hand on its way without scrolling the page, and with the keyboard alone each hand is
// named, painted with Space and the change said aloud in the status line. Run on the phone project only.
import { expect, overflow, test } from "./fixtures";
import type { Page } from "@playwright/test";

test.skip(({ isMobile }) => !isMobile, "a touch phone only: the desktop's drag is qa.e2e.ts 14c");
test.describe.configure({ timeout: 240_000 });

async function build(page: Page) {
  await page.goto("/lizard/study/?p=6&s=100");
  await expect(page.getByRole("region", { name: "Actions" }).getByRole("button").first()).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: /Build/ }).first().click();
  const grid = page.getByRole("grid").first();
  await expect(grid).toBeVisible();
  return grid;
}

test("A tap paints a hand and a finger dragged across the grid paints every hand on its way", async ({ page, problems }) => {
  const grid = await build(page);
  const cell = (i: number) => grid.getByRole("gridcell").nth(i);
  const label = (i: number) => cell(i).getAttribute("aria-label");

  // a tap on one hand (AA, the grid's first)
  const first = await label(0);
  await cell(0).scrollIntoViewIfNeeded();
  const a = (await cell(0).boundingBox())!;
  await page.touchscreen.tap(a.x + a.width / 2, a.y + a.height / 2);
  await expect(cell(0)).not.toHaveAttribute("aria-label", first ?? "");

  // a finger from the second hand of the second row to the fifth, as touch events: the grid takes them (touch-action
  // none), so the page doesn't scroll under the finger
  const before = await Promise.all([14, 15, 16, 17].map(label));
  const from = (await cell(14).boundingBox())!;
  const to = (await cell(17).boundingBox())!;
  const scrolled = await page.evaluate(() => window.scrollY);
  const cdp = await page.context().newCDPSession(page);
  const point = (x: number, y: number) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  const y = from.y + from.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(from.x + from.width / 2, y) });
  for (let s = 1; s <= 10; s++) {
    const x = from.x + from.width / 2 + ((to.x - from.x) * s) / 10;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(x, y) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  for (const [k, i] of [14, 15, 16, 17].entries()) await expect(cell(i)).not.toHaveAttribute("aria-label", before[k] ?? "");
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);

  // the painted range is scored, by a tap on Check. (A pause first, as a finger would make: on some CI runners a tap
  // about 70ms after the synthetic drag above landed on the button, by the trace, and gave no click, both tries of a
  // run, in two runs of five on 2026-11-11; never here, even with the CPU slowed 6x. The scoring itself is unit-tested.)
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Check my range" }).first().tap();
  await expect(grid).toHaveAccessibleName(/scored/);
  expect(await overflow(page), "sideways scroll, px").toBeLessThanOrEqual(0);
  await page.screenshot({ path: "e2e-results/shots/phone/study-build-touch.png", fullPage: true });
  expect(problems.errors).toEqual([]);
});

test("To a screen reader: the grid and every hand are named, Space paints, and the status line says what changed", async ({ page, problems }) => {
  const grid = await build(page);
  await expect(grid).toHaveAccessibleName(/range, being painted/);
  const cells = grid.getByRole("gridcell");
  await expect(cells).toHaveCount(169);
  // every hand has a name that starts with the hand
  const names = await cells.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  expect(names.filter((n) => !/^(A|K|Q|J|T|[2-9]){2}[so]?\b/.test(n))).toEqual([]);
  expect(names[0]).toMatch(/^AA/);

  // one tab stop, arrows to move, Space to paint; the status line says the hand as it's painted now
  const stop = grid.locator('[tabindex="0"]');
  await expect(stop).toHaveCount(1);
  await stop.focus();
  await page.keyboard.press("ArrowRight");
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
  expect(focused).toMatch(/^AKs/);
  await page.keyboard.press("Space");
  const status = page.getByRole("status").filter({ hasText: /^AKs/ });
  await expect(status).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "")).not.toBe(focused);
  // the brushes say which is on
  const pressed = page.locator('button[aria-pressed="true"]');
  expect(await pressed.count()).toBeGreaterThan(0);
  expect(problems.errors).toEqual([]);
});
