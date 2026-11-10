// The true node lock in a real browser, on the real worker and the wasm core: what jsdom can't run. The node on screen
// is held at a mix, the street re-solved, and the answer stands beside the unlocked one under its own label. The
// numbers themselves are benchmarked against an LP (docs/ACCURACY.md section 16); this is that they arrive, say what
// they are, and can be stopped.
import { expect, overflow, test, type Page } from "./fixtures";

test.skip(({ viewport }) => viewport?.width !== 1440, "this sets its own sizes");
test.describe.configure({ timeout: 240_000 });

const FLOP = "/lizard/study/?p=2&s=100&pre=SB:r2.5,BB:c&b=Kd7c2h";

async function openPanel(page: Page, url: string) {
  await page.goto(url);
  const summary = page.getByText("Hold this node at a mix (true node lock)");
  await expect(summary).toBeVisible({ timeout: 120_000 });
  await summary.click();
  return page.locator("details", { has: summary });
}

const mix = async (form: ReturnType<Page["locator"]>, values: Record<string, string>) => {
  for (const [action, value] of Object.entries(values)) await form.getByLabel(`${action} %`).fill(value);
};

test("A node held at a mix comes back beside the unlocked answer, labelled as a restricted game", async ({ page, problems }) => {
  const panel = await openPanel(page, FLOP);
  await mix(panel, { check: "50", "bet 33%": "50", "bet 75%": "0" });
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  const result = panel.getByRole("region", { name: "Node-locked result" });
  await expect(result).toBeVisible({ timeout: 90_000 });

  await expect(result.getByRole("button", { name: /Node-locked equilibrium of the restricted game, not the unlocked equilibrium/ })).toBeVisible();
  await expect(result).toContainText("BB holds check 50.0%, bet 33% 50.0% (whole range).");
  await expect(result.getByText(/^Live solve/)).toBeVisible();
  await expect(result).toContainText("in the restricted game: each player's best response keeps their own locks");
  await expect(result).toContainText("The lock leaves an action unplayed");
  await expect(result).toContainText("the earlier streets don't react to it");

  // the mix is what was asked for, and the two seats' values still cancel out
  const held = result.getByRole("table").nth(1).locator("tbody tr");
  await expect(held.nth(0)).toContainText(/check\s*[\d.]+%\s*50\.0%/);
  await expect(held.nth(1)).toContainText(/bet 33%\s*[\d.]+%\s*50\.0%/);
  await expect(held.nth(2)).toContainText(/bet 75%\s*[\d.]+%\s*0\.0%/);
  const values = await result.getByRole("table").nth(0).locator("tbody tr").all();
  const cells = await Promise.all(values.map((r) => r.locator("td").allTextContents()));
  expect(cells.map((c) => c[0])).toEqual(["BB", "SB"]);
  expect(Math.abs(Number(cells[0]![2]) + Number(cells[1]![2]))).toBeLessThan(0.011);
  expect(Math.abs(Number(cells[0]![3]))).toBeGreaterThan(0.05);

  // Study's own answer isn't replaced by it
  await expect(page.getByRole("status").first()).toContainText("Live solve");
  await result.getByText("The decisions around it").click();
  await expect(result).toContainText(/SB after check/);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(result).toBeVisible();
  expect(await overflow(page)).toBe(0);
  expect(problems.errors).toEqual([]);
});

test("A mix that doesn't add up and a hand outside the range are stopped before a solve, and a lock can be cancelled", async ({ page, problems }) => {
  const panel = await openPanel(page, FLOP);
  const run = panel.getByRole("button", { name: "Run", exact: true });
  await mix(panel, { check: "70", "bet 33%": "50", "bet 75%": "0" });
  await expect(panel.getByRole("alert")).toHaveText(/The mix adds up to 120%: it has to be 100%/);
  await expect(run).toBeDisabled();

  await mix(panel, { check: "100", "bet 33%": "0" });
  await panel.getByLabel("Hand classes", { exact: false }).first().check();
  await panel.getByRole("textbox", { name: "Hand classes" }).fill("AA");
  await expect(panel.getByRole("alert")).toHaveText(/AA isn't in BB's range here/);
  await expect(run).toBeDisabled();

  await panel.getByRole("textbox", { name: "Hand classes" }).fill("K9s");
  await expect(panel).toContainText("3 combos named; the rest of the range stays free");
  await run.click();
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(panel.getByRole("alert")).toHaveText("Stopped.");

  await run.click();
  const result = panel.getByRole("region", { name: "Node-locked result" });
  await expect(result).toBeVisible({ timeout: 90_000 });
  await expect(result).toContainText(/BB holds check 100\.0% \(K9s\): [\d.]+% of the range at this node\./);
  expect(problems.errors).toEqual([]);
});

test("Where a node can't be locked the panel says so before any solve", async ({ page, problems }) => {
  const three = await openPanel(page, "/lizard/study/?p=3&s=100&pre=BTN:c,SB:c,BB:x&b=Ks7d2c");
  await expect(three).toContainText("Node locking is heads-up: this pot has 3 players in it.");
  await expect(three.getByRole("button", { name: "Run", exact: true })).toHaveCount(0);
  expect(problems.errors).toEqual([]);
});

test("A lock kept at one node is held too when the next node of the street is locked", async ({ page, problems }) => {
  const panel = await openPanel(page, FLOP);
  await mix(panel, { check: "100", "bet 33%": "0", "bet 75%": "0" });
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  const result = panel.getByRole("region", { name: "Node-locked result" });
  await expect(result).toBeVisible({ timeout: 90_000 });
  await result.getByRole("button", { name: "Keep this lock" }).click();
  await expect(result.getByRole("button", { name: "Kept" })).toBeDisabled();

  // (in the page, not a reload: kept locks live in this tab)
  await page.getByRole("region", { name: "Actions" }).getByRole("button", { name: /^check/ }).first().click();
  const summary = page.getByText("Hold this node at a mix (true node lock)");
  await expect(page.getByRole("region", { name: "Actions" })).toContainText(/bet/, { timeout: 120_000 });
  await summary.click();
  const next = page.locator("details", { has: summary });
  const kept = next.getByLabel("Kept locks");
  await expect(kept).toContainText("BB holds check 100.0% (whole range) (first to act)");
  const actions = await next.getByRole("form", { name: "The lock" }).locator("label span.w-32").allTextContents();
  await next.getByLabel(`${actions[0]} %`).fill("0");
  for (const a of actions.slice(1)) await next.getByLabel(`${a} %`).fill("");
  await next.getByLabel(`${actions.find((a) => a.startsWith("bet"))} %`).fill("100");
  await next.getByRole("button", { name: "Run", exact: true }).click();
  const both = next.getByRole("region", { name: "Node-locked result" });
  await expect(both).toBeVisible({ timeout: 90_000 });
  await expect(both).toContainText("Held with it: BB holds check 100.0% (whole range) (first to act).");
  // BB's first decision, before this node, plays the kept mix in the locked solve
  await both.getByText("The decisions around it").click();
  const before = both.locator("div", { hasText: /^BB first \(before the lock\)/ }).locator("table tbody tr");
  await expect(before.nth(0)).toContainText(/check\s*[\d.]+%\s*100\.0%/);

  await kept.getByRole("button", { name: "Drop" }).click();
  await expect(next.getByLabel("Kept locks")).toHaveCount(0);
  expect(problems.errors).toEqual([]);
});
