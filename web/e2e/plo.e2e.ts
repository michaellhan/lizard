// The PLO4 river solve in a real browser, on the real worker: what jsdom can't run, as it has no worker to transfer a
// result from or to cancel. A narrow default spot is solved, a wide one is cancelled partway, and a spot over the limits
// is refused before any work.
import { expect, overflow, test } from "./fixtures";

test.skip(({ viewport }) => viewport?.width !== 1440, "this sets its own sizes");

test("A turn solves in the worker with every river after it, and its tables add up", async ({ page, problems }) => {
  await page.goto("/lizard/plo/");
  await page.getByLabel("OOP range").fill("AAxx");
  await page.getByLabel("IP range").fill("JT98");
  await page.getByLabel("Board").fill("Js9s4d2h");
  await page.getByLabel("Bet sizes", { exact: true }).fill("75");
  await page.getByLabel("Raise sizes", { exact: true }).fill("");
  await page.getByLabel("Raise cap", { exact: true }).selectOption("0");
  await page.getByLabel("Target exploitability").fill("0.5");
  await page.getByRole("button", { name: "Solve this turn" }).click();
  const answer = page.getByRole("region", { name: "Turn solution" });
  await expect(answer).toBeVisible({ timeout: 120_000 });
  await expect(answer.getByRole("button", { name: /a turn and its 48 river cards from the ranges typed/ })).toBeVisible();
  await expect(answer).toContainText("Reached the target of 0.5% of the pot.");
  await expect(answer).toContainText("through the turn and all 48 rivers");
  for (const line of ["OOP to start", "IP after OOP Check"]) {
    await answer.getByLabel("Decision", { exact: true }).selectOption({ label: line });
    const evs = await page.getByRole("table", { name: "Ranges on this line" }).locator("tbody td:last-child").allTextContents();
    expect(Math.abs(evs.reduce((t, x) => t + Number(x), 0) - 20)).toBeLessThan(0.02);
    const freqs = await page.getByRole("table", { name: "Actions at this decision" }).locator("tbody td:nth-child(2)").allTextContents();
    expect(Math.abs(freqs.reduce((t, x) => t + Number.parseFloat(x), 0) - 100)).toBeLessThan(0.3);
  }

  // the river after the turn is bet and called, asked of the job still in the worker
  const after = answer.getByRole("region", { name: "The river after the turn" });
  await after.getByLabel("Turn line").selectOption({ label: "OOP Bet 15, IP Call 15" });
  await after.getByLabel("River card").selectOption("Ah");
  await after.getByRole("button", { name: "Show this river" }).click();
  await expect(after).toContainText("Board Js9s4d2h Ah: pot 50, 85 behind");
  const evs = await after.getByRole("table", { name: "Ranges on this line" }).locator("tbody td:last-child").allTextContents();
  expect(Math.abs(evs.reduce((t, x) => t + Number(x), 0) - 50)).toBeLessThan(0.02);
  await expect(after.getByRole("table", { name: "Combos at this decision" }).locator("tbody tr").first()).toBeVisible();
  expect(problems.errors).toEqual([]);
});

test("A river solves in the worker, every table adds up, and a phone can read it", async ({ page, problems }) => {
  const workers: string[] = [];
  page.on("worker", (w) => workers.push(w.url()));
  await page.goto("/lizard/plo/");
  await expect(page.getByRole("heading", { name: "Heads-up PLO4 river and turn solve" })).toBeVisible();
  await page.getByRole("button", { name: "Solve this river" }).click();
  const answer = page.getByRole("region", { name: "River solution" });
  await expect(answer).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("status")).toBeHidden();
  expect(workers.filter((u) => u.includes("river.worker"))).toHaveLength(1);
  await expect(answer.getByRole("button", { name: /Heads-up PLO4 solve of every combo/ })).toBeVisible();
  await expect(answer).toContainText("Reached the target of 0.1% of the pot.");

  // the two ranges' EVs add to the pot on every line, and a decision's frequencies add to 100%
  const decisions = await answer.getByLabel("Decision", { exact: true }).locator("option").allTextContents();
  expect(decisions[0]).toBe("OOP to start");
  expect(decisions.length).toBeGreaterThan(5);
  for (const line of [decisions[0]!, "IP after OOP Check", "IP after OOP Bet 10"]) {
    await answer.getByLabel("Decision", { exact: true }).selectOption({ label: line });
    const evs = await page.getByRole("table", { name: "Ranges on this line" }).locator("tbody td:last-child").allTextContents();
    expect(Math.abs(evs.reduce((t, x) => t + Number(x), 0) - 20)).toBeLessThan(0.02);
    const freqs = await page.getByRole("table", { name: "Actions at this decision" }).locator("tbody td:nth-child(2)").allTextContents();
    expect(Math.abs(freqs.reduce((t, x) => t + Number.parseFloat(x), 0) - 100)).toBeLessThan(0.3);
  }
  await expect(page.getByRole("table", { name: "Actions at this decision" })).toContainText("Call 10");

  // the combos at a decision, found by a card
  const combos = page.getByRole("table", { name: "Combos at this decision" }).locator("tbody tr");
  await expect(combos.first()).toBeVisible();
  const hand = (await combos.first().locator("td").first().textContent())!;
  await answer.getByLabel("Find a hand").fill(hand.slice(0, 4));
  await expect(combos.first()).toContainText(hand.slice(0, 4));
  await expect(answer).toContainText(/\d+ of [\d,]+ combos reach this decision and match/);
  await answer.getByLabel("Find a hand").fill("");

  // at phone width the page doesn't scroll sideways, and it says what it hides
  await page.setViewportSize({ width: 375, height: 812 });
  await expect.poll(() => overflow(page)).toBeLessThanOrEqual(0);
  await expect(answer).toContainText(/Reach/);
  await page.screenshot({ path: "e2e-results/shots/desktop/plo-river-phone.png", fullPage: true });
  expect(problems.errors).toEqual([]);
});

test("Cancelling a wide river keeps the strategies as they stood and calls them approximate", async ({ page, problems }) => {
  await page.goto("/lizard/plo/");
  await page.getByLabel("OOP range").fill("Axxx");
  await page.getByLabel("IP range").fill("Kxxx");
  await page.getByLabel("Target exploitability").fill("0.001");
  await page.getByLabel("Time budget").fill("600");
  await page.getByRole("button", { name: "Solve this river" }).click();
  await expect(page.getByRole("status")).toContainText(/[\d,]+ iterations, /, { timeout: 60_000 });
  await page.getByRole("button", { name: "Cancel" }).click();
  const answer = page.getByRole("region", { name: "River solution" });
  await expect(answer).toBeVisible({ timeout: 20_000 });
  await expect(answer).toContainText("Cancelled: the strategies as they stood, short of the 0.001% target, so approximate.");
  await expect(answer.getByRole("button", { name: /short of its target: cancelled/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeHidden();

  // and it can solve again
  await page.getByLabel("OOP range").fill("AAxx");
  await page.getByLabel("IP range").fill("JT98");
  await page.getByLabel("Target exploitability").fill("1");
  await page.getByRole("button", { name: "Solve this river" }).click();
  await expect(answer).toContainText("Reached the target of 1% of the pot.", { timeout: 60_000 });
  expect(problems.errors).toEqual([]);
});

test("A spot over the limits and a bad board are refused in words, with nothing solved", async ({ page, problems }) => {
  await page.goto("/lizard/plo/");
  await page.getByLabel("OOP range").fill("random");
  await page.getByLabel("IP range").fill("random");
  await page.getByLabel("Bet sizes").fill("33, 66, 100");
  await page.getByLabel("Raise sizes").fill("50, 100");
  await page.getByLabel("Raise cap").selectOption("3");
  await page.getByRole("button", { name: "Solve this river" }).click();
  await expect(page.getByRole("alert")).toContainText("over the limit of 280,898 for this tree of 89 ways a hand can end. Nothing is sampled or grouped to fit", { timeout: 30_000 });
  await expect(page.getByRole("region", { name: "River solution" })).toBeHidden();

  await page.getByLabel("Board").fill("Js9s");
  await page.getByRole("button", { name: "Solve this river" }).click();
  await expect(page.getByRole("alert")).toContainText("The board is five cards for a river, four for a turn");
  expect(problems.errors).toEqual([]);
});
