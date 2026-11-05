// A saved answer and the recovery panel in a real browser, on a real database: what jsdom's fake one can't show. A spot
// keeps its answer and reopens it without the engine, marked as saved; a backup carries it and says so; and a database
// this page can't open (one written by a later version, which is a real refusal from the browser, not a mock) is read
// round, downloaded, deleted behind a confirm and restored.
import { readFileSync } from "node:fs";
import { expect, overflow, test, type Page } from "./fixtures";

test.skip(({ viewport }) => viewport?.width !== 1440, "this sets its own sizes");
test.describe.configure({ timeout: 240_000 });

const FLOP = "/lizard/study/?p=2&s=100&pre=SB:r2.5,BB:c&b=Kd7c2h";

async function saveSpot(page: Page, name: string) {
  await page.goto(FLOP);
  // the answer is in once the fallback or solve says where it came from
  const status = page.getByRole("status").first();
  await expect(status).toContainText(/Live solve|Precomputed/, { timeout: 120_000 });
  await page.getByRole("button", { name: /Save spot/ }).click();
  await expect(page.getByText("Keeps this answer with the spot")).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved in this browser.")).toBeVisible();
}

const openSaved = async (page: Page, name: string) => {
  await page.goto("/lizard/saved");
  const row = page.getByRole("listitem", { name });
  await expect(row).toBeVisible();
  return row;
};

test("A spot keeps its answer, reopens it marked as saved, and Re-solve asks the engine", async ({ page, problems }) => {
  await saveSpot(page, "Kd flop");
  const row = await openSaved(page, "Kd flop");

  // reopened without the engine: nothing loads the core
  const engine: string[] = [];
  page.on("request", (r) => {
    if (/solver\.zip|pyodide/.test(r.url())) engine.push(r.url());
  });
  await row.getByRole("link", { name: "Open in Study" }).click();
  const note = page.getByRole("group", { name: "Saved answer" });
  await expect(note).toContainText(/^Saved answer of \d{4}-\d{2}-\d{2}, not solved again\./, { timeout: 30_000 });
  await expect(note).toContainText("the one this page runs");
  await expect(page.getByRole("status").first()).toContainText("saved answer of");
  await expect(page.getByRole("grid").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Actions" })).toContainText("check");
  expect(engine).toEqual([]);
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  // Re-solve is one press, and the link stops naming the saved answer
  await note.getByRole("button", { name: "Re-solve" }).click();
  await expect(note).toBeHidden();
  await expect(page).not.toHaveURL(/saved=/);
  await expect(page.getByRole("status").first()).toContainText(/Live solve|Precomputed/, { timeout: 120_000 });
  expect(problems.errors).toEqual([]);
});

test("An answer changed by hand can't call itself solved, and a missing one is asked afresh", async ({ page, problems }) => {
  await saveSpot(page, "Kd flop");
  // the record says a library solve; the answer inside is cut off: nothing of it is drawn
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const q = indexedDB.open("lizard");
        q.onerror = () => reject(new Error("open"));
        q.onsuccess = () => {
          const tx = q.result.transaction("savedAnswers", "readwrite");
          const s = tx.objectStore("savedAnswers");
          const all = s.getAll();
          all.onsuccess = () => {
            for (const r of all.result as { json: string }[]) s.put({ ...r, json: r.json.slice(0, 200) });
          };
          tx.oncomplete = () => {
            q.result.close();
            resolve();
          };
        };
      }),
  );
  const row = await openSaved(page, "Kd flop");
  await expect(row).toContainText(/can.t be read/);
  expect(problems.errors).toEqual([]);
});

test("A backup carries the answer and the restore says it came from a file", async ({ page, problems }) => {
  await saveSpot(page, "Kd flop");
  await page.goto("/lizard/saved");
  const wait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download backup" }).click();
  const path = await (await wait).path();
  const file = JSON.parse(readFileSync(path, "utf8")) as { counts: Record<string, number> };
  expect(file.counts.savedAnswers).toBe(1);

  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const q = indexedDB.open("lizard");
        q.onerror = () => reject(new Error("open"));
        q.onsuccess = () => {
          const tx = q.result.transaction(["savedAnswers", "savedSpots"], "readwrite");
          tx.objectStore("savedAnswers").clear();
          tx.objectStore("savedSpots").clear();
          tx.oncomplete = () => {
            q.result.close();
            resolve();
          };
        };
      }),
  );
  await page.reload();
  await expect(page.getByRole("listitem", { name: "Kd flop" })).toBeHidden();
  await page.getByLabel("Backup file to restore").setInputFiles(path);
  const row = page.getByRole("listitem", { name: "Kd flop" });
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: "Open in Study" }).click();
  await expect(page.getByRole("group", { name: "Saved answer" })).toContainText("It came in from a backup file.", { timeout: 30_000 });
  expect(problems.errors).toEqual([]);
});

test("A database this page can't open is read round, deleted behind a confirm and restored", async ({ page, problems }) => {
  await saveSpot(page, "Kd flop");
  // a later Lizard's database: the browser itself refuses this page's open
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const q = indexedDB.open("lizard", 99);
        q.onerror = () => reject(new Error("open"));
        q.onsuccess = () => {
          q.result.close();
          resolve();
        };
      }),
  );
  await page.goto("/lizard/saved");
  const panel = page.getByRole("region", { name: "Saved data recovery" });
  await expect(panel).toContainText("written by a newer Lizard");
  await expect(panel).toContainText("It can still read 1 saved spot, 1 saved answer.");

  const wait = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Download what can be read" }).click();
  const path = await (await wait).path();
  await expect(panel).toContainText("Downloaded 2 records.");

  // Keep it is what a slip lands on, and it keeps everything
  await panel.getByRole("button", { name: /^Start fresh/ }).click();
  await expect(panel.getByRole("alert")).toContainText("It can't be undone".replace("'", "’"));
  await expect(panel.getByRole("button", { name: "Keep it" })).toBeFocused();
  await panel.getByRole("button", { name: "Keep it" }).click();
  await expect(panel).toContainText("It can still read 1 saved spot");

  await panel.getByRole("button", { name: /^Start fresh/ }).click();
  await panel.getByRole("button", { name: "Delete everything and start fresh" }).click();
  await expect(panel).toContainText("Started fresh");
  await panel.getByLabel("Backup file to restore").setInputFiles(path);
  await expect(panel.getByRole("status")).toBeVisible();
  await panel.getByRole("button", { name: "Reload the page" }).click();
  await expect(page.getByRole("region", { name: "Saved data recovery" })).toBeHidden();
  await expect(page.getByRole("listitem", { name: "Kd flop" })).toBeVisible();

  // the console said the database wouldn't open, and nothing else went wrong
  expect(problems.errors.filter((e) => !/database wouldn.t open/.test(e) && !/VersionError/.test(e))).toEqual([]);
});
