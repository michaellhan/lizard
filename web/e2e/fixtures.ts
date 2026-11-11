// What every browser test shares: no library behind the preview server, so the pages run on what a miss gives them,
// and a list of what the page said went wrong.
import { test as base, expect, type Page } from "@playwright/test";

/** Text the page's console may print with nothing wrong: the libraries this server doesn't have. */
const EXPECTED = [/lizard-library|gto-solver-library/, /Failed to load resource.*404/];

export interface Problems {
  errors: string[];
}

export const test = base.extend<{ problems: Problems }>({
  problems: [
    async ({ page }, use) => {
      const problems: Problems = { errors: [] };
      await page.route(/\/(lizard-library|gto-solver-library)\//, (r) => r.fulfill({ status: 404, body: "" }));
      page.on("pageerror", (e) => problems.errors.push(`pageerror: ${e.message}`));
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const text = m.text();
        if (!EXPECTED.some((p) => p.test(text))) problems.errors.push(`console: ${text}`);
      });
      await use(problems);
    },
    { auto: true },
  ],
});

/** Sideways scroll on the page itself, in px (a table scrolling inside its own box doesn't count). */
export function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

export { expect };
export type { Page } from "@playwright/test";

/** Practice's Game form, folded at first so the table comes first, opened for a test to fill (once: a second call leaves it). */
export async function openGame(page: Page): Promise<void> {
  // (by CSS: a role query doesn't see into a closed <details>)
  const game = page.locator('details:has(form[aria-label="New session"])');
  if (!(await game.evaluate((d) => (d as HTMLDetailsElement).open))) await game.locator("summary").first().click();
}

/** Practice's score: what graded the session, and its notes, are on a fold under the figures; opened if it's closed. */
export async function openScoreNotes(page: Page): Promise<void> {
  const fold = page.locator("details").filter({ has: page.locator(":scope > summary", { hasText: /^(Graded against:|Where these numbers come from)/ }) }).first();
  if (!(await fold.evaluate((d) => (d as HTMLDetailsElement).open))) await fold.locator(":scope > summary").click();
}
