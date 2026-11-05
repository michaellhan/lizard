// The plan's QA list (IMPLEMENTATION_PLAN.md section 10), each scenario named by its number, on the built site and the
// real worker. Scenario 1 (every route and deep link, refreshed) is routes.e2e.ts. These are long flows, so they run at
// one width: routes.e2e.ts and content.e2e.ts carry the three widths of scenario 14.
import { readFileSync } from "node:fs";
import { expect, overflow, test, type Problems } from "./fixtures";
import type { Page } from "@playwright/test";

const hh = (name: string) => readFileSync(new URL(`../../solver/tests/data/hh/${name}`, import.meta.url), "utf8");

test.skip(({ viewport }) => viewport?.width !== 1440, "one width: see the top of this file");
test.describe.configure({ timeout: 240_000 });

const clean = async (page: Page, problems: Problems) => {
  expect(await overflow(page), "sideways scroll, px").toBeLessThanOrEqual(0);
  expect(problems.errors).toEqual([]);
};

const actions = (page: Page) => page.getByRole("region", { name: "Actions" });

/** plays the action whose name starts with `name`, once the seat named has been answered */
async function act(page: Page, seat: string, name: RegExp) {
  await expect(actions(page).getByRole("strong")).toHaveText(seat, { timeout: 120_000 });
  await actions(page).getByRole("button", { name }).first().click();
}

async function deal(page: Page, street: string, cards: string) {
  const box = page.getByLabel(new RegExp(`^Deal the ${street}`));
  await expect(box).toBeVisible({ timeout: 120_000 });
  await box.fill(cards);
  await page.getByRole("button", { name: "Deal", exact: true }).click();
}

test("2. A 6-max hand built from the form and walked to the river", async ({ page, problems }) => {
  await page.goto("/lizard/study/");
  await page.getByLabel("Players").selectOption("6");
  await page.getByLabel("Stack in big blinds").fill("100");
  await page.getByRole("button", { name: "New hand" }).click();
  for (const seat of ["UTG", "HJ", "CO"]) await act(page, seat, /^fold/);
  await act(page, "BTN", /^raise/);
  await act(page, "SB", /^fold/);
  await act(page, "BB", /^call/);
  await deal(page, "flop", "Ks7d2c");
  await act(page, "BB", /^check/);
  await act(page, "BTN", /^check/);
  await deal(page, "turn", "5h");
  await act(page, "BB", /^check/);
  await act(page, "BTN", /^check/);
  await deal(page, "river", "9d");
  await expect(actions(page).getByText(/to act on the river/)).toBeVisible({ timeout: 120_000 });
  await expect(page).toHaveURL(/b=Ks7d2c5h9d/);
  await clean(page, problems);
});

test("3. A class picked in the grid shows its exact combos, without the ones the board blocks", async ({ page, problems }) => {
  await page.goto("/lizard/study/?p=2&s=100&pre=SB:c,BB:x&b=Ks7d2c5h9d&flop=BB:x,SB:x&turn=BB:x,SB:x");
  await expect(actions(page)).toBeVisible({ timeout: 120_000 });
  // (a suited class in this range with a nine: the board's 9d takes one of its four combos)
  await page.getByRole("gridcell", { name: /^(?:[AKQJT]9|9[2-8])s: [\d.]+% in range/ }).first().click();
  const combos = page.locator("table").filter({ hasText: "Combo" }).first();
  const each = combos.getByRole("cell", { name: /^[2-9TJQKA][shdc][2-9TJQKA][shdc]/ });
  await expect(each.first()).toBeVisible();
  expect(await each.count()).toBeLessThanOrEqual(3);
  await expect(combos.getByRole("cell", { name: /9d/ })).toHaveCount(0);
  await clean(page, problems);
});

test("4. A heads-up postflop solve from the Solve page, and a 3-way one", async ({ page, problems }) => {
  await page.goto("/lizard/solve/");
  await page.getByRole("combobox").first().selectOption("2");
  await page.getByRole("button", { name: "Open in Study" }).click();
  await expect(page).toHaveURL(/\/study/);
  await act(page, "SB", /^call/);
  await act(page, "BB", /^check/);
  await deal(page, "flop", "Ks7d2c");
  await expect(actions(page).getByText(/to act on the flop/)).toBeVisible({ timeout: 120_000 });
  await expect(actions(page).getByText(/solve/i).first()).toBeVisible();

  await page.goto("/lizard/study/?p=3&s=100&pre=BTN:c,SB:c,BB:x&b=Ks7d2c");
  await expect(actions(page).getByText(/to act on the flop/)).toBeVisible({ timeout: 180_000 });
  await expect(actions(page).getByText(/solve/i).first()).toBeVisible();
  await clean(page, problems);
});

test("5. Rake, a straddle, an ante and separate stacks reach Study, and say so", async ({ page, problems }) => {
  await page.goto("/lizard/solve/");
  await page.getByLabel("Ante").fill("0.5");
  await page.getByLabel("Straddle").check();
  await page.getByLabel("Rake %").or(page.getByLabel("Rake", { exact: true })).first().fill("5");
  await page.getByLabel("Rake cap").fill("3");
  await page.getByLabel("UTG stack").fill("30");
  await page.getByLabel("BTN stack").fill("60");
  await page.getByRole("button", { name: "Open in Study" }).click();
  await expect(page).toHaveURL(/\/study/);
  await expect(actions(page).getByText(/to act on the preflop/)).toBeVisible({ timeout: 120_000 });
  const setup = page.getByLabel("Setup");
  await expect(setup).toContainText("Your setup:");
  for (const word of ["rake 5%, capped at 3bb", "straddle", "ante 0.5bb", "UTG 30bb", "BTN 60bb"]) await expect(setup).toContainText(word);
  await clean(page, problems);
});

test("6. A final table's ICM says what it is and what model it stands on", async ({ page, problems }) => {
  await page.goto("/lizard/tournaments/");
  await page.getByLabel("Payouts").fill("50 30 20");
  await page.getByLabel("UTG stack").fill("15");
  await page.getByLabel("BTN stack").fill("60");
  await page.getByRole("button", { name: "Open in Study" }).click();
  await expect(page).toHaveURL(/\/study/);
  await expect(actions(page)).toBeVisible({ timeout: 120_000 });
  await expect(actions(page).getByText(/icm|prize/i).first()).toBeVisible();
  await clean(page, problems);
});

test("7. A bad Practice decision is told what it cost", async ({ page, problems }) => {
  await page.goto("/lizard/practice/");
  const options = page.getByRole("group", { name: "Your options" }).getByRole("button");
  let lost = false;
  for (let step = 0; step < 40 && !lost; step += 1) {
    await expect(options.first().or(page.getByRole("button", { name: /next hand|deal/i }).first())).toBeVisible({ timeout: 120_000 });
    if (await options.first().isVisible()) {
      const names = await options.allTextContents();
      const i = names.findIndex((n) => /call|check/i.test(n));
      await options.nth(i < 0 ? names.length - 1 : i).click();
    } else {
      await page.getByRole("button", { name: /next hand|deal/i }).first().click();
    }
    lost = await page.getByText(/\d bb lost|\dbb lost|no EV lost/).first().isVisible();
  }
  expect(lost, "a graded decision with its EV").toBe(true);
  await clean(page, problems);
});

test("8. A range built, saved and loaded again", async ({ page, problems }) => {
  await page.goto("/lizard/ranges/");
  const text = page.getByLabel("Range text");
  await text.fill("QQ+, AKs");
  await page.getByRole("button", { name: "Apply text" }).click();
  await expect(page.getByText(/22\.0 combos|^22\.0$/).first()).toBeVisible();
  await page.getByLabel("Save this range").fill("QA premium");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("form", { name: "Save range" }).getByRole("status")).toContainText(/saved/i);
  await page.reload();
  await page.getByRole("button", { name: "Clear" }).click();
  await page.getByLabel("Open a saved range").selectOption({ index: 1 });
  await expect(page.getByText(/22\.0/).first()).toBeVisible();
  await page.goto("/lizard/saved/");
  await expect(page.getByRole("region", { name: "Saved ranges" }).getByText("QA premium")).toBeVisible();
  await clean(page, problems);
});

test("9. PokerStars and GGPoker histories come in, and a malformed one is turned away", async ({ page, problems }) => {
  await page.goto("/lizard/analyze/");
  const box = page.getByLabel("Paste hand histories");
  const result = page.getByRole("status", { name: "Import result" });
  await box.fill(hh("stars_6max_srp.txt"));
  await page.getByRole("button", { name: "Import pasted hands" }).click();
  await expect(result).toContainText(/1|imported/);
  await box.fill(hh("gg_allin_preflop.txt"));
  await page.getByRole("button", { name: "Import pasted hands" }).click();
  await expect(result).toContainText(/1|imported/);
  await box.fill("This isn't a hand history.\nNor is this.");
  await page.getByRole("button", { name: "Import pasted hands" }).click();
  await expect(result).toContainText(/no hands|0|not/i);
  await clean(page, problems);
});

test("10. A session graded, and its biggest mistake opened in Study", async ({ page, problems }) => {
  await page.goto("/lizard/analyze/");
  const box = page.getByLabel("Paste hand histories");
  // (a button open with the worst hand there is: nothing a chart plays)
  const bad = hh("stars_6max_srp.txt").replace("[Ah Qd]", "[7c 2d]");
  await box.fill([bad, hh("stars_3bet_pot.txt"), hh("gg_limped_multiway.txt")].join("\n\n\n"));
  await page.getByRole("button", { name: "Import pasted hands" }).click();
  await page.getByRole("button", { name: /^Grade \d/ }).click();
  const report = page.getByRole("region", { name: "Report" });
  await expect(report).toBeVisible({ timeout: 180_000 });
  const list = report.getByRole("list", { name: /most EV lost|Off the chart|Off the read/ }).first();
  await expect(list).toBeVisible({ timeout: 180_000 });
  await list.getByRole("link").first().click();
  await page.getByRole("link", { name: /^Study preflop decision/ }).first().click();
  await expect(page).toHaveURL(/\/study/);
  await expect(actions(page)).toBeVisible({ timeout: 120_000 });
  await clean(page, problems);
});

test("12. A spot saved, a backup taken, and everything restored from it", async ({ page, problems }) => {
  await page.goto("/lizard/study/?p=6&s=100");
  await expect(actions(page)).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: /Save spot/ }).click();
  const form = page.getByRole("form", { name: "Save spot" }).or(page.getByRole("dialog", { name: "Save spot" }));
  await form.getByRole("textbox").first().fill("QA spot");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved in this browser.")).toBeVisible();
  await page.goto("/lizard/saved/");
  await expect(page.getByRole("region", { name: "Saved spots" }).getByText("QA spot")).toBeVisible();

  const backup = page.getByRole("region", { name: "Backup" });
  const taken = page.waitForEvent("download");
  await backup.getByRole("button", { name: /Download/ }).click();
  const path = await (await taken).path();

  await page.getByRole("listitem", { name: "QA spot" }).getByRole("button", { name: "Delete" }).click();
  await page.getByRole("listitem", { name: "QA spot" }).getByRole("button", { name: /Delete|Yes/ }).first().click();
  await expect(page.getByRole("listitem", { name: "QA spot" })).toHaveCount(0);
  await backup.getByLabel("Backup file to restore").setInputFiles(path);
  await expect(page.getByRole("region", { name: "Saved spots" }).getByText("QA spot")).toBeVisible();
  await clean(page, problems);
});

test("13. PLO4 equity, labelled as equity, with Monte Carlo seeded", async ({ page, problems }) => {
  await page.goto("/lizard/equity/");
  await page.getByLabel("Player 1: hand or range").fill("AsAhKdKc");
  await page.getByLabel("Player 2: hand or range").fill("Jc9d8h7s");
  await page.getByLabel("Board").fill("");
  await page.getByRole("button", { name: /^(Run|Calculate|Work)/ }).click();
  const equity = page.getByRole("region", { name: "Equity" });
  await expect(equity.getByText(/\d\d\.\d+%/).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/isn.t a strategy/)).toBeVisible();
  await clean(page, problems);
});

test("14. A solve stopped halfway, and a solver that fails, leave the page working", async ({ page, problems }) => {
  await page.goto("/lizard/study/?p=2&s=100&pre=SB:c,BB:x&b=Ks7d2c");
  const stop = page.getByRole("button", { name: "Stop" });
  await expect(stop).toBeVisible({ timeout: 120_000 });
  await stop.click();
  await expect(stop).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await clean(page, problems);

  // the worker falls over on the first thing it's asked
  await page.route(/\/solver\/worker\.js/, (r) =>
    r.fulfill({
      contentType: "text/javascript",
      headers: { "Cross-Origin-Embedder-Policy": "require-corp" },
      body: 'self.onmessage = () => { throw new Error("broken on purpose"); };',
    }),
  );
  await page.goto("/lizard/study/?p=6&s=100");
  await expect(page.getByText(/broken on purpose|engine|couldn.t|failed/i).first()).toBeVisible({ timeout: 90_000 });
  await page.getByRole("link", { name: "Ranges" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  problems.errors.length = 0; // (the page said what threw, on purpose here)
});

// (needs the real library, which this preview server hasn't got: read through from the live site, so not in CI)
test("11. A texture-filtered flop report says how many flops it stands on", async ({ page, problems }) => {
  test.skip(Boolean(process.env.CI), "reads the live library");
  await page.route(/\/lizard-library\//, async (r) => {
    const u = new URL(r.request().url());
    await r.fulfill({ response: await r.fetch({ url: `https://www.michael-han.com${u.pathname}${u.search}` }) });
  });
  await page.goto("/lizard/reports/");
  await expect(page.getByText(/\d+ of 1,755 flops stored, standing for \d/)).toBeVisible({ timeout: 60_000 });
  const shown = page.getByRole("row", { name: "Average" }).first();
  await expect(shown).toBeVisible();
  const all = await shown.textContent();
  await page.getByLabel("Suits").selectOption({ index: 1 });
  await expect(shown).not.toHaveText(all ?? "");
  await expect(page.getByText(/\d+ of 1,755 flops stored, standing for \d/)).toBeVisible();
    await clean(page, problems);
});

// (Practice's two modes that aren't cash, on the real worker)
async function session(page: Page, play: string, then?: () => Promise<unknown>) {
  await page.goto("/lizard/practice/");
  await expect(page.getByRole("button", { name: "New session" })).toBeEnabled({ timeout: 60_000 });
  await page.getByLabel("Play", { exact: true }).selectOption(play);
  await then?.();
  await page.getByRole("button", { name: "New session" }).click();
}

const options = (page: Page) => page.getByRole("group", { name: "Your options" }).getByRole("button");

test("7b. Push/fold: all-in or fold, graded by frequency, and named a model", async ({ page, problems }) => {
  await session(page, "pushfold");
  await expect(options(page).first()).toBeVisible({ timeout: 120_000 });
  const names = (await options(page).allTextContents()).join(" ").toLowerCase();
  expect(names).toMatch(/fold/);
  expect(names).toMatch(/all-in|call/);
  await options(page).first().click();
  await expect(page.getByText("Decisions graded")).toBeVisible();
  await expect(page.getByText(/Push\/fold model \(not a solve\)/).first()).toBeVisible();
  await expect(page.getByText(/by how often/i).first()).toBeVisible();
  await clean(page, problems);
});

test("7c. A tournament session in prize equity says so, with chip EV apart from it", async ({ page, problems }) => {
  await session(page, "tournament", () => page.getByLabel("Stack at UTG").fill("10"));
  await expect(options(page).first()).toBeVisible({ timeout: 120_000 });
  await page.screenshot({ path: "e2e-results/shots/desktop/practice-tournament.png" });
  await options(page).first().click();
  await expect(page.getByText("Decisions graded")).toBeVisible();
  await expect(page.getByText(/chip chart with a risk premium|prize equity · /).first()).toBeVisible();
  await page.screenshot({ path: "e2e-results/shots/desktop/practice-tournament-graded.png", fullPage: true });

  await session(page, "tournament", () => page.getByLabel("Answers in").selectOption("chips"));
  await expect(options(page).first()).toBeVisible({ timeout: 120_000 });
  await options(page).first().click();
  await expect(page.getByText("Decisions graded")).toBeVisible();
  await clean(page, problems);
});

test("14b. The keyboard alone: a page change moves focus, the grid is one tab stop, and playing an action keeps your place", async ({ page, problems }) => {
  await page.goto("/lizard/");
  await page.getByRole("link", { name: "Ranges" }).first().focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveTitle(/Ranges/);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();

  await page.goto("/lizard/study/?p=6&s=100");
  await expect(actions(page).getByRole("button").first()).toBeVisible({ timeout: 120_000 });
  const grid = page.getByRole("grid").first();
  await expect(grid.locator('[tabindex="0"]')).toHaveCount(1);
  await grid.locator('[tabindex="0"]').focus();
  const from = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  await page.keyboard.press("ArrowRight");
  const to = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  expect(to).not.toBe(from);
  await expect(page).not.toHaveURL(/pre=/); // (the grid's arrows, not the line's)
  await page.keyboard.press("End");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.closest('[role="grid"]') === null)).toBe(true);

  await actions(page).getByRole("button", { name: /^fold/ }).first().focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/pre=/);
  await expect(actions(page).getByRole("strong")).toHaveText("HJ");
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest('[aria-label="Actions"]') !== null), { timeout: 10_000 })
    .toBe(true);
  await clean(page, problems);
});

test("14c. Painting a range by dragging still paints, in Study's build mode", async ({ page, problems }) => {
  await page.goto("/lizard/study/?p=6&s=100");
  await expect(actions(page).getByRole("button").first()).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: /Build/ }).first().click();
  const grid = page.getByRole("grid").first();
  await expect(grid).toBeVisible();
  const cell = (i: number) => grid.getByRole("gridcell").nth(i);
  const before = await Promise.all([0, 1, 2, 3].map((i) => cell(i).getAttribute("aria-label")));
  const a = await cell(0).boundingBox();
  const b = await cell(3).boundingBox();
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 8 });
  await page.mouse.up();
  for (const i of [0, 1, 2, 3]) await expect(cell(i)).not.toHaveAttribute("aria-label", before[i] ?? "");
  await page.screenshot({ path: "e2e-results/shots/desktop/study-build-drag.png" });
  await clean(page, problems);
});

test("7d. An exploit drill against an assumed profile, on the real worker, and the scenario saved and started again", async ({ page, problems }) => {
  await session(page, "srp", async () => {
    await page.getByLabel("Exploit").selectOption("station");
    await page.getByRole("button", { name: "Save scenario" }).click();
    const form = page.getByRole("form", { name: "Save scenario" });
    await form.getByRole("textbox").first().fill("QA station");
    // (Enter saves: it's inside the New session form, and must not start a session)
    await form.getByRole("textbox").first().press("Enter");
    await expect(page.getByText(/Saved in this browser/)).toBeVisible();
    await expect(options(page)).toHaveCount(0);
    await form.getByRole("button", { name: "Close" }).click();
  });
  await expect(options(page).first()).toBeVisible({ timeout: 120_000 });
  await page.screenshot({ path: "e2e-results/shots/desktop/practice-exploit.png" });
  await options(page).first().click();
  await expect(page.getByText(/^Graded against the best response to the assumed profile/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/^Graded against: Exploiting an assumed profile \(best response, not a solve\)/)).toBeVisible();
  await page.screenshot({ path: "e2e-results/shots/desktop/practice-exploit-graded.png", fullPage: true });
  // The next decision is its own live solve at Quick.
  const next = page.getByRole("button", { name: /next/i }).first();
  if (await next.isVisible().catch(() => false)) await next.click();
  await expect(options(page).first()).toBeEnabled({ timeout: 120_000 });

  await page.goto("/lizard/saved/");
  await page.getByRole("link", { name: "Start QA station" }).click();
  await expect(page).toHaveURL(/\/practice/);
  await expect(page.getByLabel("Play", { exact: true })).toHaveValue("srp");
  await expect(options(page).first()).toBeVisible({ timeout: 120_000 });
  await clean(page, problems);
});

test("10b. The filters narrow every report, in the URL, and a breakdown's row opens its decisions", async ({ page, problems }) => {
  await page.goto("/lizard/analyze/");
  await page.getByLabel("Paste hand histories").fill([hh("stars_6max_srp.txt"), hh("stars_3bet_pot.txt"), hh("gg_limped_multiway.txt")].join("\n\n\n"));
  await page.getByRole("button", { name: "Import pasted hands" }).click();
  await page.getByRole("button", { name: /^Grade \d/ }).click();
  const report = page.getByRole("region", { name: "Report" });
  await expect(report).toBeVisible({ timeout: 180_000 });
  const filters = page.getByRole("region", { name: "Filters" });
  await expect(filters).toBeVisible();

  const breaks = page.getByRole("group", { name: "Breakdowns" });
  await expect(breaks).toBeVisible({ timeout: 120_000 });
  await page.screenshot({ path: "e2e-results/shots/desktop/analyze-reports.png", fullPage: true });
  for (const by of ["Street", "Bet size faced", "Effective stack", "Flop: suits"]) {
    await breaks.getByLabel("Break decisions down by").selectOption({ label: by });
    await expect(breaks.getByRole("table").or(breaks.getByText(/can be broken down this way/)).first()).toBeVisible({ timeout: 60_000 });
  }
  await breaks.getByLabel("Break decisions down by").selectOption({ label: "Street" });
  const open = breaks.getByRole("button", { name: /^Decisions: / }).first();
  await open.click();
  await expect(open).toHaveAttribute("aria-expanded", "true");

  const pot = filters.getByLabel("Pot", { exact: true });
  const pots = (await pot.locator("option").allTextContents()).filter((t) => t !== "Any");
  expect(pots.length).toBeGreaterThan(1);
  await pot.selectOption(pots[0]);
  await expect(page).toHaveURL(/[?&]pot=/);
  await expect(filters.getByRole("status", { name: "Sample after filtering" })).toContainText(/1 hand of 3/);
  await page.reload();
  await expect(page.getByRole("region", { name: "Filters" }).getByLabel("Pot", { exact: true })).toHaveValue(pots[0]);

  // The filters saved as a report, and opened again from Saved
  await page.getByRole("button", { name: "Save this report" }).click();
  const save = page.getByRole("form", { name: "Save this report" });
  await save.getByRole("textbox", { name: "Name" }).fill("QA report");
  await save.getByRole("button", { name: "Save" }).click();
  await expect(save.getByRole("status")).toContainText("Saved in this browser.");
  await page.goto("/lizard/saved/");
  await page.getByRole("link", { name: "Open QA report" }).click();
  await expect(page).toHaveURL(/\/analyze\?pot=/);
  await expect(page.getByRole("region", { name: "Filters" }).getByRole("status", { name: "Sample after filtering" })).toContainText(/1 hand of 3/);
  await clean(page, problems);
});

test("14d. A single combo painted apart from its class, graded by combo, on a real river answer, with EQR by combo", async ({ page, problems }) => {
  await page.goto("/lizard/study/?p=2&s=100&pre=SB:c,BB:x&b=Ks7d2c5h9d&flop=BB:x,SB:x&turn=BB:x,SB:x");
  await expect(actions(page)).toBeVisible({ timeout: 120_000 });
  const nine = /^(?:[AKQJT]9|9[2-8])s: [\d.]+% in range/;
  await page.getByRole("gridcell", { name: nine }).first().click();
  await expect(page.getByRole("columnheader", { name: "EQR" })).toBeVisible();
  await page.screenshot({ path: "e2e-results/shots/desktop/study-combo-eqr.png", fullPage: true });

  await page.getByRole("button", { name: /Build/ }).first().click();
  await page.getByRole("button", { name: "Open combos" }).click();
  await page.getByRole("gridcell", { name: /^(?:[AKQJT]9|9[2-8])s: yours / }).first().click();
  const panel = page.getByRole("region", { name: /^[2-9TJQKA]{2}s combos$/ });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(/1 blocked by the board/);
  await expect(panel.getByRole("group").getByRole("spinbutton")).not.toHaveCount(0);
  const share = panel.getByRole("spinbutton").first();
  await share.fill("40");
  await share.press("Enter");
  await expect(panel.getByRole("button", { name: /back to the class$/ })).toBeVisible();
  await expect(page.getByRole("gridcell", { name: /combos? painted apart/ })).toHaveCount(1);
  await page.screenshot({ path: "e2e-results/shots/desktop/study-combo-paint.png", fullPage: true });

  await page.getByRole("button", { name: "Check my range" }).click();
  await expect(page.getByText(/Graded combo by combo over [\d.]+ live combos/)).toBeVisible();
  await page.screenshot({ path: "e2e-results/shots/desktop/study-combo-graded.png", fullPage: true });
  await clean(page, problems);
});
