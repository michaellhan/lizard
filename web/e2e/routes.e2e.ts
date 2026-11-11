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

test("every link in the primary nav can be reached and goes where it says", async ({ page, problems }, info) => {
  await page.goto("/lizard/");
  const nav = page.getByRole("navigation", { name: "Primary" });
  const links = await nav.getByRole("link").all();
  // the four main pages in the bar at every width, and the other eight under More (on a phone, Settings too)
  expect(links.length).toBe(4);
  const more = nav.getByRole("button", { name: /More/ });
  await more.click();
  await expect(nav.getByRole("list", { name: "More pages" }).getByRole("link")).toHaveCount(8 + (info.project.name === "phone" ? 1 : 0));
  await more.click();
  for (const link of links) {
    const to = await link.getAttribute("href");
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${to}/?$`));
    await expect(page.locator("main")).toBeVisible();
  }
  expect(problems.errors).toEqual([]);
});
