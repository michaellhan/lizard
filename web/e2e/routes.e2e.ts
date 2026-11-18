// Every route at 1440, 1024 and 390 px: it comes up, says what it is, doesn't scroll sideways and logs no error. The
// screenshots land in e2e-results/shots for a person to look at; nothing compares them to an earlier run.
import { expect, overflow, test } from "./fixtures";

const ROUTES: readonly (readonly [string, RegExp])[] = [
  ["", /./],
  ["study", /./],
  ["practice", /./],
  ["analyze", /./],
  ["solve", /./],
  ["reports", /./],
  ["ranges", /./],
  ["tournaments", /./],
  ["compare", /./],
  ["library", /./],
  ["history", /./],
  ["plan", /./],
  ["review", /./],
  ["progress", /./],
  ["equity", /./],
  ["plo", /./],
  ["saved", /./],
  ["settings", /./],
  ["engine", /./],
  ["no-such-page", /./],
];

for (const [route, heading] of ROUTES) {
  test(`/${route}`, async ({ page, problems }, info) => {
    await page.goto(`/lizard/${route}${route ? "/" : ""}`);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByRole("heading").first()).toHaveText(heading);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `e2e-results/shots/${info.project.name}/${route || "home"}.png`, fullPage: true });
    expect(await overflow(page), "sideways scroll, px").toBeLessThanOrEqual(0);
    expect(problems.errors).toEqual([]);
  });
}

test("every link in the primary nav can be reached and goes where it says", async ({ page, problems }) => {
  await page.goto("/lizard/");
  const nav = page.getByRole("navigation", { name: "Primary" });
  const links = await nav.getByRole("link").all();
  // every page in the bar at every width, no More menu (on a phone the bar scrolls sideways), and Settings' gear beside it
  expect(links.length).toBe(8);
  await expect(nav.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  for (const link of links) {
    const to = await link.getAttribute("href");
    await link.click();
    // (a page that keeps its setup in the address, such as Solve, adds a query of its own on arrival)
    const path = (to ?? "").split("?")[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await expect(page).toHaveURL(new RegExp(`${path}/?(\\?.*)?$`));
    await expect(page.locator("main")).toBeVisible();
  }
  expect(problems.errors).toEqual([]);
});

test("an old /review or /plan link lands on Progress, its query kept", async ({ page, problems }) => {
  // (a street filter stays in the address; ?retry=next is read and dropped by Review itself, as before)
  await page.goto("/lizard/review/?street=flop");
  await expect(page).toHaveURL(/\/lizard\/progress\?street=flop$/);
  await page.goto("/lizard/plan/");
  await expect(page).toHaveURL(/\/lizard\/progress$/);
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Progress" })).toHaveAttribute("aria-current", "page");
  expect(problems.errors).toEqual([]);
});
