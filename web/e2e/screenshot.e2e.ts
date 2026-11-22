// Screenshot to spot in a real browser: a synthetic table (drawn by scripts/screenshot/make-fixtures.mjs, not a poker
// room's) picked in Analyze's import, read by the card reader and by Tesseract from this site's own ocr/ files, into the
// prefilled form, and on to Study. Nothing is sent anywhere: every OCR file comes from this origin, no request carries
// the picture, and once the reader has loaded a second picture reads with the network off.
import { join } from "node:path";
import { expect, test } from "./fixtures";

test.skip(({ viewport }) => viewport?.width !== 1440, "one width is enough for a form");
test.describe.configure({ timeout: 180_000 });

const FIXTURES = join(process.cwd(), "src/features/analyze/screenshot/fixtures");

test("A screenshot reads into the form, offline once loaded, and opens in Study", async ({ page, problems }) => {
  const sent: string[] = [];
  const ocr: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.includes("/ocr/")) ocr.push(`${u.origin}${u.pathname}`);
    const body = r.postDataBuffer();
    if (body && body.length > 4096) sent.push(`${r.method()} ${r.url()} (${body.length} bytes)`);
  });

  await page.goto("/lizard/analyze/?tab=import&from=screenshot");
  const panel = page.getByRole("region", { name: "From a screenshot" });
  await expect(panel.getByText(/never leaves it/)).toBeVisible();
  await expect(panel.getByText(/Review only, not for use while you play/)).toBeVisible();

  await panel.getByLabel("Choose a screenshot").setInputFiles(join(FIXTURES, "table-001.png"));
  const form = panel.getByRole("form", { name: "The spot" });
  await expect(form).toBeVisible({ timeout: 120_000 });
  await expect(form.getByLabel("Your cards")).toHaveValue("9dJc");
  await expect(form.getByLabel("Your cards")).toHaveAccessibleDescription(/read from the image/);
  await expect(form.getByLabel("Board")).toHaveValue("Kh5h6h");
  await expect(form.getByLabel("Players")).toHaveValue("6");
  await expect(form.getByLabel("Your seat")).toHaveValue("CO");
  // the line before the flop isn't in a picture: a default, said so
  await expect(page.getByText("A screenshot doesn’t show the betting: say how the pot was made.")).toBeVisible();

  // every OCR file from this site
  expect(ocr.length).toBeGreaterThan(0);
  for (const u of ocr) expect(u).toMatch(/^http:\/\/localhost:4176\/lizard\/ocr\/7\.0\.0\//);

  // loaded: a second picture reads with no network at all
  await page.context().setOffline(true);
  await panel.getByLabel("Choose a screenshot").setInputFiles(join(FIXTURES, "table-002.png"));
  await expect(form.getByLabel("Your cards")).toHaveValue("2d7d", { timeout: 60_000 });
  await expect(form.getByLabel("Players")).toHaveValue("2");
  await page.context().setOffline(false);

  // back to the first, confirmed into Study
  await panel.getByLabel("Choose a screenshot").setInputFiles(join(FIXTURES, "table-001.png"));
  await expect(form.getByLabel("Your cards")).toHaveValue("9dJc", { timeout: 60_000 });
  const study = form.getByRole("link", { name: "Open in Study" });
  await expect(study).toHaveAttribute("href", /\/lizard\/study\?p=6&s=\d+.*&b=Kh5h6h.*hand=9dJc/);
  await study.click();
  await expect(page).toHaveURL(/\/lizard\/study\?p=6/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  expect(sent).toEqual([]);
  expect(problems.errors).toEqual([]);
});
