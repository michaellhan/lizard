// The acceptance chains of Phases 5 and 6 (IMPLEMENTATION_PLAN.md sections 8 and 9), end to end on the built site: each
// step reaches the next by what's on the page, not by a link typed in. The hands' misses are real in the first chain,
// where the app grades what's clicked; the second writes them into the browser's store, as the fixtures grade clean.
import { readFileSync } from "node:fs";
import { expect, overflow, test, type Page, openGame } from "./fixtures";

const hh = (name: string) => readFileSync(new URL(`../../solver/tests/data/hh/${name}`, import.meta.url), "utf8");

/** History's breakdown tables are under a closed Breakdown fold: opened if it's closed. */
async function openBreakdown(page: Page): Promise<void> {
  const fold = page.locator("details").filter({ has: page.locator(":scope > summary", { hasText: /^Breakdown$/ }) }).first();
  if (!(await fold.evaluate((d) => (d as HTMLDetailsElement).open))) await fold.locator(":scope > summary").click();
}

test.skip(({ viewport }) => viewport?.width !== 1440, "one width: these are long flows");
test.describe.configure({ timeout: 300_000 });

const options = (page: Page) => page.getByRole("group", { name: "Your options" }).getByRole("button");

test("Phase 5: a drill set up, played, graded with numbers, kept, opened in Study and tried again", async ({ page, problems }) => {
  await page.goto("/lizard/practice/");
  await openGame(page);
  await expect(page.getByRole("button", { name: "New session" })).toBeEnabled({ timeout: 60_000 });
  await page.getByLabel("Play", { exact: true }).selectOption("preflop");
  await page.getByRole("button", { name: "New session" }).click();

  // the biggest raise every time: a fold-chart hand raised is a real miss
  const graded = page.getByText("Decisions graded");
  const next = page.getByRole("button", { name: "Next hand" });
  const missed = page.getByText(/^(Inaccuracy|Mistake|Blunder)$/).first();
  for (let i = 0; i < 40 && !(await missed.isVisible()); i += 1) {
    await expect(options(page).first().or(next)).toBeVisible({ timeout: 60_000 });
    if (await next.isVisible()) await next.click();
    else await options(page).last().click();
    await page.waitForTimeout(200);
  }
  await expect(graded).toBeVisible();
  await expect(missed).toBeVisible();

  // the feedback stands on numbers and names its source, approximate (≈): the preflop solve where a game is stored, else the
  // charts, neither called solved (what graded the session is on a closed fold under the score: only what's shown counts)
  await expect(page.getByText(/^≈ ?Preflop (solve|charts)/).filter({ visible: true }).first()).toBeVisible();
  const study = page.getByRole("link", { name: "Open this spot in Study →" }).first();
  await expect(study).toBeVisible();
  await study.click();
  await expect(page).toHaveURL(/\/study/);
  await expect(page.getByRole("region", { name: "Actions" })).toBeVisible({ timeout: 120_000 });

  // kept across pages: the miss is in Review, and a retry grades it again
  await page.goto("/lizard/review/");
  await page.getByRole("button", { name: /^Retry early: / }).first().click();
  const retry = page.getByRole("region", { name: "Retry" });
  await retry.getByRole("group", { name: "Your options" }).getByRole("button").first().click({ timeout: 120_000 });
  await expect(retry.getByText(/^(Best|Correct|Inaccuracy|Mistake|Blunder)$/).first()).toBeVisible({ timeout: 60_000 });
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  expect(problems.errors).toEqual([]);
});

test("Phase 6: a session imported, a measured leak opened in Study, drilled, saved and resumed", async ({ page, problems }) => {
  const one = hh("stars_6max_srp.txt");
  const hands = Array.from({ length: 36 }, (_, i) => one.replace(/Hand #\d+/, `Hand #${880000 + i}`)).join("\n\n\n");
  await page.goto("/lizard/analyze/");
  await page.getByLabel("Paste hand histories").fill(hands);
  await page.getByRole("button", { name: "Import pasted hands" }).click();
  await page.getByRole("tab", { name: "Grades & leaks" }).click();
  await page.locator("select").filter({ has: page.locator('option[value="library"]') }).selectOption("library");
  await page.getByRole("button", { name: /^Grade \d/ }).click();
  await expect(page.getByRole("region", { name: "Report" })).toBeVisible({ timeout: 240_000 });
  await expect(page.getByRole("status", { name: "Grading progress" })).toBeHidden({ timeout: 240_000 });

  // every preflop decision marked out of the charts, in the store: a leak the rule can read
  await page.evaluate(
    () =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open("lizard");
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const store = open.result.transaction("decisions", "readwrite").objectStore("decisions");
          const all = store.getAll();
          all.onsuccess = () => {
            for (const d of all.result) if (d.street === "preflop") store.put({ ...d, verdict: "Mistake", freq: 0 });
            store.transaction.oncomplete = () => (open.result.close(), done());
          };
        };
      }),
  );
  await page.reload();
  const leaks = page.getByRole("list", { name: "Leaks" });
  await expect(leaks.getByRole("listitem").first()).toBeVisible({ timeout: 60_000 });
  await expect(leaks.getByRole("listitem").first()).toContainText(/\d+ decisions?|\d+%/);

  // the hands behind it, one opened in Study at that decision
  await leaks.getByRole("button", { name: "Show its decisions" }).first().click();
  await page.getByRole("tab", { name: "Hands" }).click();
  await page.getByRole("row", { name: /^Hand / }).getByRole("button", { name: /^Open the hand/ }).first().click();
  const hand = page.getByRole("region", { name: "Hand", exact: true });
  await hand.getByRole("link", { name: /^Study preflop decision/ }).first().click();
  await expect(page).toHaveURL(/\/study\?/);
  await expect(page.getByRole("region", { name: "Actions" })).toBeVisible({ timeout: 120_000 });
  await page.goBack();
  await page.getByRole("tab", { name: "Grades & leaks" }).click();

  // drilled, and the drill saved and picked up again from the Saved page
  await leaks.getByRole("link", { name: "Drill this leak" }).first().click();
  const drill = page.getByRole("region", { name: "Leak drill" });
  await expect(drill).toBeVisible();
  await drill.getByRole("group", { name: "Your options" }).getByRole("button").first().click();
  await expect(drill.getByText(/^(Best|Correct|Inaccuracy|Mistake|Blunder)$/).first()).toBeVisible();
  await drill.getByRole("button", { name: "☆ Save drill" }).click();
  await drill.getByRole("button", { name: "Save", exact: true }).click();
  await expect(drill.getByRole("button", { name: "★ Saved drill" })).toBeVisible();

  await page.goto("/lizard/saved/");
  await page.getByRole("region", { name: "Saved drills" }).getByRole("link", { name: /open|resume|drill/i }).first().click();
  const resumed = page.getByRole("region", { name: "Leak drill" });
  await expect(resumed).toBeVisible();
  await expect(resumed).toContainText(/1 of \d+|1 done|1 graded/);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  expect(problems.errors).toEqual([]);
});

test("Practice's rates by seat and pot come back in History", async ({ page, problems }) => {
  await page.goto("/lizard/practice/");
  await openGame(page);
  await expect(page.getByRole("button", { name: "New session" })).toBeEnabled({ timeout: 60_000 });
  await page.getByLabel("Players").selectOption("3");
  await page.getByLabel("Stack in big blinds").fill("40");
  await page.getByLabel("Play", { exact: true }).selectOption("preflop");
  await page.getByRole("button", { name: "New session" }).click();
  const next = page.getByRole("button", { name: "Next hand" });
  const graded = page.getByRole("button", { name: /Preflop charts/ }).first();
  for (let i = 0; i < 12; i += 1) {
    await expect(options(page).first().or(next)).toBeVisible({ timeout: 60_000 });
    if (await next.isVisible()) await next.click();
    else await options(page).last().click();
    await page.waitForTimeout(200);
  }
  await expect(graded.or(page.getByText("Decisions graded")).first()).toBeVisible();

  await page.goto("/lizard/history/");
  await openBreakdown(page);
  const rates = page.getByRole("region", { name: "Rates by seat and pot type" });
  await expect(rates).toBeVisible();
  await expect(rates.getByRole("table", { name: /seat/i }).first()).toContainText(/BTN|SB|BB/);
  await expect(rates.getByRole("table", { name: /pot/i }).first()).toContainText(/Unopened|SRP|Limped|3bet pot/);
  await expect(rates).toContainText(/Preflop charts/);
  await expect(rates).not.toContainText(/solved/i);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  expect(problems.errors).toEqual([]);
});

