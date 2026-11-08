// What the system's own settings ask of the page, in a real browser: forced colours, reduced motion, and the first Tab
// from Study's heading, with a table's scroll cue, which only a real layout can show.
import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures";

const hh = (name: string) => readFileSync(new URL(`../../solver/tests/data/hh/${name}`, import.meta.url), "utf8");

test.skip(({ viewport }) => viewport?.width !== 1440, "these set their own size or mode");

test("Forced colours keep the grid's fills and draw each cell's edge and the selected cell", async ({ page, problems }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/lizard/study/?p=6&s=100");
  const cell = page.getByRole("gridcell").first();
  await expect(cell).toBeVisible({ timeout: 45_000 });
  const look = async (el: typeof cell) => el.evaluate((n) => ({ outline: getComputedStyle(n).outlineStyle, width: getComputedStyle(n).outlineWidth }));
  expect(await look(cell)).toEqual({ outline: "solid", width: "1px" });
  await cell.click();
  await page.getByRole("button", { name: "Back" }).first().focus().catch(() => undefined);
  await expect(page.getByRole("gridcell", { selected: true }).first()).toBeVisible();
  expect((await look(page.getByRole("gridcell", { selected: true }).first())).width).toBe("3px");
  const fill = await page.locator('[style*="--fill-act"]').first().evaluate((n) => getComputedStyle(n).forcedColorAdjust);
  expect(fill).toBe("none");
  await page.screenshot({ path: "e2e-results/shots/desktop/forced-colors.png" });
  expect(problems.errors).toEqual([]);
});

test("Reduced motion stops transitions and keeps the scroll cue, which only follows the reader", async ({ page, problems }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/lizard/analyze/");
  await page.getByLabel("Paste hand histories").fill([hh("stars_6max_srp.txt"), hh("stars_3bet_pot.txt")].join("\n\n\n"));
  await page.getByRole("button", { name: "Import pasted hands" }).click();
  await page.getByRole("tab", { name: "Results" }).click();
  await expect(page.getByRole("region", { name: "Your results" })).toBeVisible();
  expect(await page.getByRole("tab", { name: "Results" }).evaluate((n) => getComputedStyle(n).transitionDuration)).toMatch(/^0s/);
  // (the hands table, the widest)
  await page.getByRole("tab", { name: "Hands" }).click();

  const box = page.locator(".scroll-x").filter({ has: page.locator("table") });
  await expect(box.first()).toBeVisible();
  const cue = await box.evaluateAll(async (els) => {
    const el = els.find((e) => e.scrollWidth > e.clientWidth + 4);
    if (!el) return null;
    const more = () => getComputedStyle(el).getPropertyValue("--scroll-more").trim();
    const at = more();
    el.scrollLeft = el.scrollWidth;
    const mask = getComputedStyle(el).maskImage;
    return { at, mask, end: await new Promise<string>((go) => requestAnimationFrame(() => requestAnimationFrame(() => go(more())))) };
  });
  expect(cue, "a table wider than its box at 375px").not.toBeNull();
  expect(cue!.at).toBe("28px");
  expect(cue!.mask).toContain("linear-gradient");
  expect(cue!.end).toBe("0px");
  expect(problems.errors).toEqual([]);
});

test("From Study's heading the first Tab goes on to the page, and one Tab crosses the grid", async ({ page, problems }) => {
  await page.goto("/lizard/study/?p=6&s=100");
  await expect(page.getByRole("gridcell").first()).toBeVisible({ timeout: 45_000 });
  await page.getByRole("heading", { level: 1 }).first().evaluate((h) => {
    (h as HTMLElement).tabIndex = -1;
    (h as HTMLElement).focus();
  });
  const seen: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    seen.push(await page.evaluate(() => {
      const e = document.activeElement as HTMLElement | null;
      return e?.getAttribute("role") ?? e?.tagName ?? "";
    }));
  }
  // (past the last stop the browser goes to its own controls, and the page has no focus)
  expect(seen[0]).not.toBe("BODY");
  expect(seen.filter((x) => x === "gridcell").length).toBeLessThanOrEqual(1);
  expect(problems.errors).toEqual([]);
});

test("Copy for AI puts the spot and its source on the real clipboard", async ({ page, context, problems }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/lizard/study/?p=6&s=100");
  const copy = page.getByRole("button", { name: "Copy for AI" });
  await expect(copy).toBeVisible({ timeout: 45_000 });
  await copy.click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/UTG/);
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/raise/);
  expect(text).toMatch(/preflop chart/i);
  expect(problems.errors).toEqual([]);
});

test("The web manifest is linked from a deep page and names the app under its own path", async ({ page, request, problems }) => {
  await page.goto("/lizard/study/");
  const href = await page.locator('link[rel="manifest"]').evaluate((l: HTMLLinkElement) => l.href);
  expect(new URL(href).pathname).toBe("/lizard/manifest.webmanifest");
  const icon = await page.locator('link[rel="icon"]').evaluate((l: HTMLLinkElement) => l.href);
  expect(new URL(icon).pathname).toBe("/lizard/lizard.svg");
  const m = await (await request.get(href)).json();
  expect([m.start_url, m.scope, m.display]).toEqual(["/lizard/", "/lizard/", "standalone"]);
  expect((await request.get(new URL(m.icons[0].src, href).href)).ok()).toBe(true);
  expect(problems.errors).toEqual([]);
});

