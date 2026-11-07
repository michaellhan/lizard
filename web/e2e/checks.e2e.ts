// Built features that had unit tests and a typecheck and no look in a browser (docs/FEATURE_MATRIX.md): each is checked
// here on the built site and the real worker, at the widths and by the keys its row names. The live-library steps read
// through to the published library; everything else stands on the page's own play. Timings go to the test's output as
// `timing: ...` lines, for the matrix.
import { readFileSync } from "node:fs";
import { expect, overflow, test, type Page, type Problems } from "./fixtures";

const hh = (name: string) => readFileSync(new URL(`../../solver/tests/data/hh/${name}`, import.meta.url), "utf8");

test.skip(({ viewport }) => viewport?.width !== 1440, "this sets its own sizes");
test.skip(Boolean(process.env.CI), "run in the local gate: several read the live library or wait on the real worker, and none should hold up a deploy");
test.describe.configure({ timeout: 300_000 });

const SITE = "https://www.michael-han.com";

const clean = async (page: Page, problems: Problems) => {
  expect(await overflow(page), "sideways scroll, px").toBeLessThanOrEqual(0);
  expect(problems.errors).toEqual([]);
};

/** The library read through from the published site. `hold` can keep a file back: it answers when it resolves. A page's
 * conditional request would be answered with an empty 304, so its headers don't go along. */
async function liveLibrary(page: Page, hold?: (path: string) => Promise<void> | undefined) {
  await page.route(/\/lizard-library\//, async (r) => {
    const u = new URL(r.request().url());
    await hold?.(u.pathname);
    try {
      const res = await page.request.get(`${SITE}${u.pathname}${u.search}`);
      await r.fulfill({ response: res });
    } catch {
      await r.abort().catch(() => {}); // (the page went away, or stopped this one, while it was held)
    }
  });
}

const timing = (what: string, ms: number) => console.log(`timing: ${what}: ${(ms / 1000).toFixed(2)} s`);

test("Turn report: a finished 40-flop sample at desktop width, its margins and columns, and 40 more", async ({ page, problems }) => {
  await liveLibrary(page);
  await page.goto("/lizard/reports/?spot=3bp_bb_btn&suits=rainbow");
  const panel = page.getByRole("region", { name: "Turn report", exact: true });
  const read = panel.getByRole("button", { name: "Read 40 flops" });
  await expect(read).toBeVisible({ timeout: 60_000 });

  // by the keyboard: the button goes for Stop as reading starts, and the keyboard must stay in the panel when it ends
  await read.focus();
  const t0 = Date.now();
  await page.keyboard.press("Enter");
  const said = panel.getByText(/^Read 40 of \d+ flops of this texture with stored turns, drawn evenly over them in an order set by seed 1/);
  await expect(said).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
  timing("40 flops read, live library, 3bp_bb_btn rainbow", Date.now() - t0);
  await expect(page.locator(":focus")).toHaveText("Read 40 more");

  const margin = /Margin on All turns: ±([\d.]+) points, 95%/;
  const first = Number(margin.exec((await said.textContent()) ?? "")?.[1]);
  expect(first).toBeGreaterThan(0);
  expect(first).toBeLessThan(6);
  await expect(panel.getByRole("button", { name: /^Stored turn from the flop library · 3bp_bb_btn · turn report over 40 of \d+ flops/ })).toBeVisible();

  // the desktop layout: every column there, nothing behind a button, the table within its box
  const box = panel.getByRole("region", { name: "Turn report table" });
  const table = box.getByRole("table");
  const heads = await table.getByRole("columnheader").allTextContents();
  for (const h of ["Turn card", "Strategy", "Margin", "Flops", "Combos"]) expect(heads).toContain(h);
  for (const h of ["Strategy", "Flops", "Combos"]) await expect(table.getByRole("columnheader", { name: h })).toBeVisible();
  await expect(panel.getByText(/Hidden at this width/)).toBeHidden();
  expect(await box.evaluate((el) => el.scrollWidth - el.clientWidth), "the table's own sideways scroll, px").toBeLessThanOrEqual(0);
  const inside = await panel.evaluate((el) => {
    const p = el.getBoundingClientRect();
    return [...el.querySelectorAll("table, select, button")].every((c) => c.getBoundingClientRect().right <= p.right + 0.5);
  });
  expect(inside, "everything inside the panel's box").toBe(true);
  await page.screenshot({ path: "e2e-results/shots/desktop/turn-report-40.png", fullPage: true });

  // each row: a mix that adds up, a margin in the head's terms, the flops and combos behind it
  const rows = table.getByRole("row");
  const n = await rows.count();
  expect(n).toBeGreaterThan(2);
  const actions = heads.slice(2, heads.indexOf("Margin"));
  expect(actions.length).toBeGreaterThan(1);
  for (let i = 1; i < n; i++) {
    const cells = await rows.nth(i).getByRole("cell").allTextContents();
    // (the row's name is a header: cell 0 is the Strategy bar)
    const mix = cells.slice(1, 1 + actions.length).map((t) => Number(t.replace("%", "")));
    expect(Math.abs(mix.reduce((a, b) => a + b, 0) - 100), `row ${i}'s mix ${cells.join(" | ")}`).toBeLessThan(0.5);
    expect(cells[1 + actions.length]).toMatch(/^(±[\d.]+|too few|none)$/);
    expect(Number(cells[2 + actions.length])).toBeLessThanOrEqual(40);
    expect(Number(cells[3 + actions.length])).toBeGreaterThan(0);
  }
  const all = await table.getByRole("row", { name: /^All turns/ }).getByRole("cell").allTextContents();
  expect(all[1 + actions.length]).toBe(`±${first.toFixed(1)}`);

  // the decision and the line are in the URL, and read nothing again
  let fetched = 0;
  page.on("request", (r) => {
    if (/\/lizard-library\//.test(r.url())) fetched++;
  });
  await panel.getByRole("group", { name: "Turn decision" }).getByRole("button").nth(1).click();
  await expect(page).toHaveURL(/twho=after/);
  await expect(table.getByRole("row", { name: /^All turns/ })).toBeVisible();
  const lines = panel.getByLabel("Flop line");
  const choices = await lines.locator("option").count();
  expect(choices).toBeGreaterThan(1);
  await lines.selectOption({ index: 1 });
  await expect(page).toHaveURL(/tline=/);
  await expect(panel.getByText(/This line is stored on \d+ of the 40 flops read/)).toBeVisible();
  expect(fetched, "files read for another decision or line").toBe(0);

  // 40 more, and the margin comes in
  await page.getByLabel("Flop line").selectOption({ index: 0 });
  await panel.getByRole("group", { name: "Turn decision" }).getByRole("button").nth(0).click();
  const t1 = Date.now();
  await panel.getByRole("button", { name: "Read 40 more" }).click();
  const more = panel.getByText(/^Read 80 of \d+ flops/);
  await expect(more).toBeVisible({ timeout: 60_000 });
  timing("40 more flops", Date.now() - t1);
  const second = Number(margin.exec((await more.textContent()) ?? "")?.[1]);
  expect(second).toBeGreaterThan(0);
  expect(second).toBeLessThan(first);
  await clean(page, problems);
});

test("Turn report: a read stopped before any flop came back, and one stopped partway, keep the keyboard and say so", async ({ page, problems }) => {
  // flop files are held until let go, and a count of them through first
  let open = 0;
  let release = () => {};
  let released = new Promise<void>((r) => (release = r));
  await liveLibrary(page, (path) => {
    if (!/\/3bp_bb_btn\/.*\.bin$/.test(path)) return undefined;
    if (open > 0) {
      open--;
      return undefined;
    }
    return released;
  });
  await page.goto("/lizard/reports/?spot=3bp_bb_btn&suits=rainbow");
  const panel = page.getByRole("region", { name: "Turn report", exact: true });
  const read = panel.getByRole("button", { name: "Read 40 flops" });
  await expect(read).toBeVisible({ timeout: 60_000 });

  // stopped with nothing back: words, one way on, and the keyboard on it
  await read.focus();
  await page.keyboard.press("Enter");
  const stop = panel.getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeFocused();
  await expect(panel.getByRole("progressbar", { name: "Flops read" })).toHaveAttribute("aria-valuenow", "0");
  await page.keyboard.press("Enter");
  await expect(panel.getByText("Stopped before a flop came back, so there’s nothing to show yet.")).toBeVisible();
  await expect(read).toBeVisible();
  await expect(read).toBeFocused();
  await expect(panel.getByRole("button")).toHaveCount(1);
  await expect(panel.getByRole("table")).toHaveCount(0);

  // again, with some flops let through: what came back stands as partial, and the rest can be asked for
  release();
  released = new Promise<void>((r) => (release = r));
  open = 12 * 2;
  await page.keyboard.press("Enter");
  await expect(stop).toBeFocused();
  const bar = panel.getByRole("progressbar", { name: "Flops read" });
  await expect.poll(async () => Number(await bar.getAttribute("aria-valuenow")), { timeout: 60_000 }).toBeGreaterThan(5);
  await expect(panel.getByText(/Still reading: these are partial results\./)).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(panel.getByText(/Stopped early: these are partial results\./)).toBeVisible();
  const left = panel.getByRole("button", { name: /^Read the \d+ left$/ });
  await expect(left).toBeFocused();
  await expect(stop).toBeHidden();
  await expect(panel.getByRole("button", { name: /stopped|partial/i }).first()).toBeVisible();
  await expect(panel.getByRole("table")).toBeVisible();
  await page.screenshot({ path: "e2e-results/shots/desktop/turn-report-stopped.png", fullPage: true });

  release();
  await page.keyboard.press("Enter");
  await expect(panel.getByText(/^Read 40 of \d+ flops of this texture/)).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByText(/partial results/)).toBeHidden();
  await clean(page, problems);
});

// ---- Practice's table, played
const options = (page: Page) => page.getByRole("group", { name: "Your options" }).getByRole("button");
const nextHand = (page: Page) => page.getByRole("button", { name: "Next hand" });

async function newSession(page: Page, set: () => Promise<unknown>) {
  await page.goto("/lizard/practice/");
  await expect(page.getByRole("button", { name: "New session" })).toBeEnabled({ timeout: 60_000 });
  await set();
  await page.getByRole("button", { name: "New session" }).click();
}

/** Plays check or call where it can, the first option where it can't, until `done` says stop; `hands` at most. */
async function playPassively(page: Page, done: () => Promise<boolean>, moves = 60) {
  const passive = options(page).filter({ hasText: /^\s*(check|call)/i }).first();
  for (let i = 0; i < moves && !(await done()); i += 1) {
    await expect(options(page).first().or(nextHand(page))).toBeVisible({ timeout: 120_000 });
    if (await nextHand(page).isVisible()) await nextHand(page).click();
    else await (await passive.isVisible() ? passive : options(page).first()).click();
    await page.waitForTimeout(150);
  }
}

/** Every street graded at Quick triage, to its end: "Forget the grades" comes back only with the run over. */
async function gradeAtQuick(page: Page) {
  await page.locator("select").filter({ has: page.locator('option[value="triage"]') }).selectOption("triage");
  await page.getByRole("button", { name: /^Grade \d/ }).click();
  await expect(page.getByRole("status", { name: "Grading progress" }).or(page.getByRole("button", { name: "Forget the grades" }))).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Forget the grades" })).toBeVisible({ timeout: 240_000 });
}

/** A record of a store, read in the page. */
const readStore = <T,>(page: Page, store: string) =>
  page.evaluate(
    (name) =>
      new Promise<T[]>((done, fail) => {
        const open = indexedDB.open("lizard");
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction(name).objectStore(name).getAll();
          all.onsuccess = () => (open.result.close(), done(all.result as T[]));
        };
      }),
    store,
  );

/** Records put in a store, in the page. */
const putStore = (page: Page, store: string, rows: readonly unknown[]) =>
  page.evaluate(
    ([name, xs]) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open("lizard");
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const s = open.result.transaction(name as string, "readwrite").objectStore(name as string);
          for (const x of xs as unknown[]) s.put(x);
          s.transaction.oncomplete = () => (open.result.close(), done());
        };
      }),
    [store, rows] as const,
  );

test("Session stats: a real session's figures in History, each way of grading apart, at 375px and by the keyboard", async ({ page, problems }) => {
  await newSession(page, async () => {
    await page.getByLabel("Players").selectOption("2");
    await page.getByLabel("Stack in big blinds").fill("40");
  });
  // a chart's frequency before the flop and a live solve's EV after it, in the one session
  const score = page.getByText(/Decisions graded/).first();
  const live = page.getByRole("button", { name: /^Live solve/ }).first();
  const charts = page.getByText(/Preflop charts/).first();
  let [sawLive, sawChart] = [false, false];
  await playPassively(page, async () => {
    sawLive ||= await live.isVisible();
    sawChart ||= await charts.isVisible();
    return sawLive && sawChart;
  });
  expect(sawLive, "a decision graded by a live solve").toBe(true);
  expect(sawChart, "a decision graded by the charts").toBe(true);
  await expect(score).toBeVisible();

  await page.goto("/lizard/history/");
  const rates = page.getByRole("region", { name: "Rates by seat and pot type" });
  await expect(rates).toBeVisible();
  // each seat's rows by EV and by frequency, in tables of their own, never one row
  for (const t of ["By seat: Graded by EV", "By seat: Graded by frequency (no EV)", "By pot type: Graded by EV", "By pot type: Graded by frequency (no EV)"])
    await expect(rates.getByRole("table", { name: t, exact: true })).toBeVisible();
  const evSeats = rates.getByRole("table", { name: "By seat: Graded by EV", exact: true });
  await expect(evSeats.locator("th", { hasText: "EV lost per decision" })).toBeVisible();
  await expect(evSeats).toContainText(/Live solve/);
  await expect(evSeats).not.toContainText(/Preflop charts/);
  const freqSeats = rates.getByRole("table", { name: "By seat: Graded by frequency (no EV)", exact: true });
  await expect(freqSeats.locator("th", { hasText: "EV lost per decision" })).toHaveCount(0);
  await expect(freqSeats).toContainText(/Preflop charts/);
  await expect(freqSeats).not.toContainText(/Live solve/);
  await expect(rates.getByRole("table", { name: "By seat: Graded by EV", exact: true }).getByRole("row").nth(1)).toContainText(/\d+ of \d+/); // (under 30: a count, not a share)

  // the session's line and the lifetime totals give a figure a way
  const lifetime = page.getByRole("table", { name: "Totals by kind" });
  const heads = await lifetime.locator("th").allTextContents();
  expect(heads.filter((h) => /by EV/i.test(h)).length, heads.join(" | ")).toBe(1);
  expect(heads.filter((h) => /frequency/i.test(h)).length, heads.join(" | ")).toBe(1);
  const line = page.getByRole("region", { name: "Sessions" }).getByRole("listitem").first();
  await expect(line).toContainText(/Best or Correct of \d+ by EV/);
  await expect(line).toContainText(/Best or Correct of \d+ by frequency/);

  // the page's kind filter, in the URL, from the keyboard
  await rates.getByLabel("Rates from").focus();
  await page.keyboard.type("Full"); // (a closed menu's own keys, on every platform: the arrows open it on a Mac)
  await expect(page).toHaveURL(/[?&]kind=practice/);
  await expect(rates.getByRole("table", { name: "By seat: Graded by EV", exact: true })).toBeVisible();
  await rates.getByLabel("Rates from").selectOption("build");
  await expect(rates).toContainText("not split by seat or pot");
  await page.reload();
  await expect(page.getByRole("region", { name: "Rates by seat and pot type" })).toContainText("not split by seat or pot");
  await page.getByRole("region", { name: "Rates by seat and pot type" }).getByLabel("Rates from").selectOption("");
  await expect(page).not.toHaveURL(/kind=/);
  await clean(page, problems);
});

test("Session stats: every seat and pot at 375px stays within the page, and the keys reach and scroll each table", async ({ page, problems }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/lizard/history/");
  await expect(page.getByText("No session kept yet.")).toBeVisible();
  const seats = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
  const pots = ["Unopened", "Limped", "SRP", "3bet pot", "4bet+ pot"];
  const cells = seats.flatMap((seat, i) =>
    pots.flatMap((pot, j) => [
      { street: "preflop", source: "charts", byEv: false, seat, pot, n: 3 + i, ok: 2 + j % 2, loss: 0, lossPct: 0 },
      { street: "flop", source: "library", byEv: true, seat, pot, n: 40 + i, ok: 30, loss: 12.5, lossPct: 120 },
      { street: "preflop", source: "preflop-solve", byEv: true, seat, pot, n: 2, ok: 1, loss: 0.4, lossPct: 9 },
    ]),
  );
  const n = cells.reduce((a, c) => a + c.n, 0);
  await putStore(page, "sessions", [
    { id: "wide", kind: "practice", startedAt: Date.now() - 3_600_000, decisions: n + 7, evLossBb: 40, meta: { hands: 400, net: -12, ok: 300, graded: 200, lossPct: 900, players: 6, stack: 100, seat: "moves", cells: Object.fromEntries(cells.map((c, i) => [i, c])) } },
    { id: "leak-drill|pf:RFI", kind: "analysis", startedAt: Date.now() - 7_200_000, decisions: 2, evLossBb: 0, meta: { drill: "leak", leak: "pf:RFI", label: "RFI", total: 5, done: ["a", "b"], score: { n: 2, ok: 1, loss: 0, lossPct: 0, ne: 0, streak: 0, best: 1, recent: [1, 0] } } },
  ]);
  await page.reload();
  const rates = page.getByRole("region", { name: "Rates by seat and pot type" });
  await expect(rates).toBeVisible();
  await expect(rates).toContainText("Seat not kept: 7 decisions in 1 session");
  await expect(rates).toContainText("2 leak drill decisions aren't split");
  expect(await overflow(page), "sideways scroll at 375px, px").toBeLessThanOrEqual(0);
  await page.screenshot({ path: "e2e-results/shots/phone/history-rates.png", fullPage: true });

  // a table too wide for the phone is its own stop for the keys, and they scroll it
  const box = rates.getByRole("group", { name: "By seat: Graded by EV, scrolls sideways" });
  // (these few columns fit at 375px, so it's narrowed here to the width where they wouldn't)
  await box.evaluate((el) => void ((el as HTMLElement).style.maxWidth = "160px"));
  expect(await box.evaluate((el) => el.scrollWidth - el.clientWidth), "the seat table scrolls in its box").toBeGreaterThan(0);
  await rates.getByLabel("Rates from").focus();
  await page.keyboard.press("Tab");
  await expect(box).toBeFocused();
  const ring = await box.evaluate((el) => {
    const s = getComputedStyle(el);
    return s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0 ? "outline" : s.boxShadow !== "none" ? "shadow" : "none";
  });
  expect(ring, "the focused box shows it").not.toBe("none");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => box.evaluate((el) => el.scrollLeft), "the keys scroll the table").toBeGreaterThan(0);

  // every scroller on the page can be reached the same way, each by one Tab
  const groups = rates.getByRole("group", { name: /scrolls sideways$/ });
  expect(await groups.count()).toBe(4); // seat and pot, each by EV and by frequency
  for (let i = 1; i < 4; i++) {
    await page.keyboard.press("Tab");
    await expect(groups.nth(i)).toBeFocused();
  }
  const unreachable = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".scroll-x")].filter((el) => el.scrollWidth > el.clientWidth && el.tabIndex < 0 && !el.querySelector("a, button, select, input, [tabindex]")).map((el) => el.querySelector("table")?.getAttribute("aria-label")),
  );
  expect(unreachable, "tables too wide for the page that the keys can't reach").toEqual([]);
  expect(problems.errors).toEqual([]);
});

test("Filters in Study: a category and an equity bucket narrow the grid and the numbers, say so, and save nothing of it", async ({ page, problems }) => {
  const FLOP = "/lizard/study/?p=2&s=100&pre=SB:r2.5,BB:c&b=Kd7c2h";
  await page.goto(FLOP);
  const filter = page.getByLabel("Show only the hands of one category");
  await expect(filter).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("status").first()).toContainText(/Live solve|Precomputed/, { timeout: 120_000 });
  const actions = page.getByRole("region", { name: "Actions" });
  const totals = page.getByText(/[\d.]+ combos · equity /).first();
  const whole = (await totals.textContent())!;
  const wholeCombos = Number(/([\d.]+) combos/.exec(whole)![1]);
  const before = await actions.innerText();
  const inRange = () => page.getByRole("grid").first().getByRole("gridcell").evaluateAll((cs) => cs.filter((c) => !/not in range|: 0% in range/.test(c.getAttribute("aria-label") ?? "")).length);
  const allClasses = await inRange();
  expect(allClasses).toBeGreaterThan(40);

  // the menu: made hands, draws and equity, each with its share of the range
  const groups = await filter.locator("optgroup").evaluateAll((gs) => gs.map((g) => g.getAttribute("label")));
  expect(groups).toEqual(["Made hands", "Draws", "Equity against their whole range"]);
  const shares = await filter.locator('optgroup[label^="Equity"] option').evaluateAll((os) => os.map((o) => Number(/([\d.]+)%$/.exec(o.textContent ?? "")?.[1])));
  expect(shares.length).toBeGreaterThan(1);
  expect(Math.abs(shares.reduce((a, b) => a + b, 0) - 100), `the buckets' shares ${shares.join(", ")}`).toBeLessThan(1);

  // a made-hand category
  await filter.selectOption((await filter.locator('optgroup[label="Made hands"] option').first().getAttribute("value"))!);
  const name = (await filter.locator("option:checked").textContent())!.split(" · ")[0]!;
  await expect(filter).not.toHaveValue("");
  await expect(actions.getByText(`These numbers are over ${name} alone, not the whole range.`)).toBeVisible();
  await expect(totals).toContainText(new RegExp(`^${name}: [\\d.]+ of ${wholeCombos.toFixed(1)} combos`));
  expect(Number(/: ([\d.]+) of/.exec((await totals.textContent())!)![1])).toBeLessThan(wholeCombos);
  await expect(page.getByRole("grid", { name: `BB range (${name})` })).toBeVisible();
  expect(await inRange(), "the classes left in the grid").toBeLessThan(allClasses);
  const narrowed = await actions.innerText();
  expect(narrowed.replace(/These numbers.*\n?/, "")).not.toBe(before);

  // the EV gap panel says the same
  await page.getByRole("button", { name: "Compare two actions' EV" }).click();
  const gap = page.getByRole("region", { name: "Two actions' EV" });
  await expect(gap.getByText(`These numbers are over ${name} alone, not the whole range.`)).toBeVisible();

  // the opponent's grid isn't filtered, and doesn't name it
  await page.getByRole("group", { name: "Whose range" }).getByRole("button", { name: "SB" }).click();
  await expect(page.getByRole("grid", { name: "SB range" })).toBeVisible();
  await expect(filter).toBeHidden();
  await expect(page.getByText(new RegExp(`^${name}: `))).toHaveCount(0);
  await page.getByRole("group", { name: "Whose range" }).getByRole("button", { name: "BB" }).click();
  await expect(filter).toHaveValue(/^m:/);

  // an equity bucket recounts the same way
  const bucket = await filter.locator('optgroup[label^="Equity"] option').last().getAttribute("value");
  await filter.selectOption(bucket!);
  const label = (await filter.locator("option:checked").textContent())!.split(" · ")[0]!;
  expect(label).toMatch(/^\d+–\d+% equity$/);
  await expect(actions.getByText(`These numbers are over ${label} alone, not the whole range.`)).toBeVisible();
  await expect(totals).toContainText(new RegExp(`^${label}: [\\d.]+ of ${wholeCombos.toFixed(1)} combos`));
  const high = await page.getByRole("grid").first().getByRole("gridcell").evaluateAll((cs) => cs.map((c) => c.getAttribute("aria-label") ?? "").flatMap((l) => (/: 0% in range|not in range/.test(l) ? [] : [Number(/equity (\d+)%/.exec(l)?.[1])])));
  expect(high.length).toBeGreaterThan(0);
  expect(Math.min(...high), `equities in the ${label} grid`).toBeGreaterThanOrEqual(Number(/^(\d+)/.exec(label)![1]) - 0.5);

  // at a phone's width
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(actions.getByText(`These numbers are over ${label} alone, not the whole range.`)).toBeVisible();
  expect(await overflow(page), "sideways scroll at 375px, px").toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1440, height: 900 });

  // a spot saved under a filter keeps the whole range, as a spot saved without one does
  await page.getByRole("button", { name: /Save spot/ }).click();
  await expect(page.getByText("Keeps this answer with the spot")).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Name").fill("Filtered flop");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved in this browser.")).toBeVisible();

  // All hands puts back the very numbers
  await filter.selectOption("");
  await expect(actions.getByText(/These numbers are over/)).toHaveCount(0);
  await expect(totals).toHaveText(whole);
  await expect.poll(() => actions.innerText()).toBe(before);
  expect(await inRange()).toBe(allClasses);

  await page.goto("/lizard/saved");
  await page.getByRole("listitem", { name: "Filtered flop" }).getByRole("link", { name: "Open in Study" }).click();
  await expect(page.getByRole("group", { name: "Saved answer" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Show only the hands of one category")).toHaveValue("");
  await expect(page.getByRole("region", { name: "Actions" }).getByText(/These numbers are over/)).toHaveCount(0);
  await expect(page.getByText(/[\d.]+ combos · equity /).first()).toHaveText(whole);
  await clean(page, problems);
});

test("Leak drills on every street: turn and river decisions dealt from what Quick kept, graded with nothing solved, and what can't be dealt counted", async ({ page, problems }) => {
  await page.goto("/lizard/analyze/");
  await page.getByLabel("Paste hand histories").fill([hh("stars_6max_srp.txt"), hh("stars_9max_mtt_ante.txt")].join("\n\n\n"));
  await page.getByRole("button", { name: "Import pasted hands" }).click();
  await gradeAtQuick(page);

  interface Dec { id: string; handId: string; street: string; situation?: string; mix?: [string, number, number | null][]; verdict: string; pos: string; label: string }
  interface Hand { id: string; tournament?: unknown; board: string }
  const decisions = await readStore<Dec>(page, "decisions");
  const hands = await readStore<Hand>(page, "hands");
  const cash = hands.find((h) => h.tournament === undefined)!;
  const ofCash = decisions.filter((d) => d.handId === cash.id);
  const turn = ofCash.find((d) => d.street === "turn")!;
  const river = ofCash.find((d) => d.street === "river")!;
  expect(turn, "the cash hand's turn decision").toBeTruthy();
  expect(river, "the cash hand's river decision").toBeTruthy();
  expect(turn.mix?.length, `the turn's kept mix (${turn.verdict}, ${turn.label})`).toBeGreaterThan(1);
  expect(river.mix?.length, `the river's kept mix (${river.verdict}, ${river.label})`).toBeGreaterThan(1);

  // dealt on the turn, in a fresh page that never starts the engine
  const engine: string[] = [];
  page.on("request", (r) => {
    if (/solver\.zip|pyodide/.test(r.url())) engine.push(r.url());
  });
  const drillOf = (street: string, d: Dec) => `/lizard/analyze/?drill=${encodeURIComponent(`spot:${street} · ${d.situation}`)}`;
  await page.goto(drillOf("Turn", turn));
  const drill = page.getByRole("region", { name: "Leak drill" });
  const decision = drill.getByRole("group", { name: "Decision" });
  await expect(decision).toBeVisible({ timeout: 30_000 });
  await expect(decision).toContainText(/Decision 1 of 1 · Turn · /);
  await expect(decision.getByRole("img", { name: "queen of spades" })).toBeVisible();
  await expect(decision.getByRole("img", { name: "7 of hearts" })).toBeVisible();
  await expect(decision.getByRole("img", { name: "2 of spades" })).toHaveCount(0); // (the river isn't dealt yet)
  const before = decision.getByRole("list", { name: "The action before" });
  await expect(before).toContainText(/flop/i);
  await expect(before).toContainText(/You bet 1.8|You raise/);
  const picks = decision.getByRole("group", { name: "Your options" }).getByRole("button");
  await expect(picks).toHaveCount(turn.mix!.length);
  await picks.last().click();
  await expect(decision.getByText(/^(Best|Correct|Inaccuracy|Mistake|Blunder)$/).first()).toBeVisible();
  await expect(decision.getByRole("table", { name: "The answer for your hand" }).getByRole("row")).toHaveCount(turn.mix!.length + 1);
  const graded = decision.getByRole("group", { name: "What graded it" });
  await expect(graded).toContainText("kept with the grade: nothing is solved here");
  await expect(graded).toContainText("Version:");
  await expect(graded).toContainText(/Live solve|Stored turn|Answer at once/);
  expect(engine, "the engine, loaded for a drill").toEqual([]);

  // its Study link stands at that decision
  const study = decision.getByRole("link", { name: "Open in Study" });
  await expect(study).toHaveAttribute("href", /b=Qs8d3c7h/);

  // the progress kept: leaving and coming back resumes, and History has the line
  await page.goto(drillOf("Turn", turn));
  await expect(drill.getByRole("group", { name: "Drill score" })).toContainText("1 of 1 drilled");
  await expect(drill.getByRole("status").first()).toContainText("Every decision of this leak in these hands is drilled");

  // the river likewise
  await page.goto(drillOf("River", river));
  await expect(decision).toContainText(/Decision 1 of 1 · River · /);
  await expect(decision.getByRole("img", { name: "2 of spades" })).toBeVisible();
  await picks.first().click();
  await expect(decision.getByRole("group", { name: "What graded it" })).toContainText("nothing is solved here");
  expect(engine, "the engine, loaded for a drill").toEqual([]);

  // a rough solve stops at Inaccuracy, what's kept with no mix or no pot is counted and not dealt
  const sit = "Test spot";
  const rest = { situation: sit, source: "live", label: "Live solve", action: "check", street: "turn", pos: turn.pos, evLossBb: 0, byEv: true, verdict: "Best" };
  await putStore(page, "decisions", [
    { ...turn, ...rest, id: `${cash.id}|turn|90`, i: 0, pot: 10, capped: true, mix: [["check", 1, 10], ["bet 5", 0, 0]] },
    { ...turn, ...rest, id: `${cash.id}|turn|91`, i: 0, pot: 10, mix: undefined },
    { ...turn, ...rest, id: `${cash.id}|turn|92`, i: 0, pot: 0, mix: [["check", 1, 10], ["bet 5", 0, 0]] },
  ]);
  await page.goto(`/lizard/analyze/?drill=${encodeURIComponent(`spot:Turn · ${sit}`)}`);
  await expect(drill).toContainText("2 of this leak's graded decisions aren't dealt here, as there's nothing to grade a pick against: 1 kept no mix with the grade, 1 kept EVs with no pot to measure a pick against.");
  await expect(decision).toContainText("Decision 1 of 1");
  await picks.last().click();
  await expect(decision.getByText("Inaccuracy").first()).toBeVisible();
  await expect(decision.getByText("Blunder")).toHaveCount(0);
  await expect(decision.getByRole("group", { name: "What graded it" })).toContainText("A rough or cut-short solve can't condemn a line, so this grade stops at Inaccuracy.");

  // a tournament hand's decision, in a spot of its own, is left out of what's dealt
  const tour = hands.find((h) => h.tournament !== undefined)!;
  const theirs = decisions.find((d) => d.handId === tour.id && d.street !== "preflop" && d.mix?.length);
  if (theirs) {
    await page.goto(`/lizard/analyze/?drill=${encodeURIComponent(`spot:${theirs.street[0]!.toUpperCase()}${theirs.street.slice(1)} · ${theirs.situation}`)}`);
    await expect(drill).toContainText(/None of this leak's decisions is graded with its mix in this browser/);
  }
  await page.goto("/lizard/history/");
  const rows = page.getByRole("region", { name: "Sessions" }).getByRole("listitem").filter({ hasText: "Leak:" });
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: "Turn" }).first()).toContainText(/1 of 1 done when last drilled/);
  await clean(page, problems);
});

test("A leak drill on a Practice hand: Open in Study carries the rake and sizes it was played at", async ({ page, problems }) => {
  await newSession(page, async () => {
    await page.getByLabel("Players").selectOption("2");
    await page.getByLabel("Stack in big blinds").fill("40");
    await page.getByLabel("Rake", { exact: true }).fill("5");
    await page.getByLabel("Rake cap").fill("3");
    await page.getByLabel("Play", { exact: true }).selectOption("bvb");
    await page.getByText("Your own bet sizes").click();
    await page.getByLabel("Flop bets").fill("50");
  });
  // to a hand's end with a flop decision of yours in it
  const keep = page.getByRole("button", { name: "Keep in Analyze" });
  const flopped = async () => (await keep.isVisible()) && (await page.getByRole("group", { name: "Board" }).getByRole("img").count()) >= 3;
  await playPassively(page, flopped, 60);
  await expect(keep).toBeVisible();
  await keep.click();
  await page.getByRole("link", { name: "Open it there" }).click();
  await expect(page).toHaveURL(/\/analyze/);
  await gradeAtQuick(page);
  interface Dec { street: string; situation?: string; mix?: unknown[] }
  const d = (await readStore<Dec>(page, "decisions")).find((x) => x.street !== "preflop" && x.mix?.length);
  expect(d, "a decision after the flop, graded with its mix").toBeTruthy();
  await page.goto(`/lizard/analyze/?drill=${encodeURIComponent(`spot:${d!.street[0]!.toUpperCase()}${d!.street.slice(1)} · ${d!.situation}`)}`);
  const drill = page.getByRole("region", { name: "Leak drill" });
  await drill.getByRole("group", { name: "Your options" }).getByRole("button").first().click();
  const study = drill.getByRole("link", { name: "Open in Study" });
  await expect(study).toBeVisible();
  const href = decodeURIComponent((await study.getAttribute("href"))!);
  console.log(`study link: ${href}`);
  await study.click();
  await expect(page).toHaveURL(/\/study/);
  const actions = page.getByRole("region", { name: "Actions" });
  await expect(actions).toBeVisible({ timeout: 120_000 });
  // the answer it opens is at that rake and those sizes, and says so
  await expect(page.getByText(/rake 5%/i).first()).toBeVisible();
  await expect(actions.getByRole("button", { name: /^bet .*50%|bet 50/i }).or(actions.getByRole("button", { name: /^(fold|call|raise)/i })).first()).toBeVisible();
  await clean(page, problems);
});

test("Practice's preflop solve at tablet height, both boxes ticked: the move is on the first screen, and all three ways stay apart in History", async ({ page, problems }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/lizard/practice/");
  await expect(page.getByRole("button", { name: "New session" })).toBeEnabled({ timeout: 60_000 });
  await page.getByLabel("Play", { exact: true }).selectOption("preflop");

  // by the keyboard: space ticks each, and the second is offered only with the first
  const solve = page.getByLabel("Grade preflop by the preflop solve");
  const sizes = page.getByLabel("Offer the solve's raise sizes");
  await solve.focus();
  await page.keyboard.press("Space");
  await expect(solve).toBeChecked();
  await sizes.focus();
  await page.keyboard.press("Space");
  await expect(sizes).toBeChecked();
  await expect(page.locator("#pf-note")).toContainText("About 4% of decisions");
  await page.screenshot({ path: "e2e-results/shots/tablet/pf-both-boxes-form.png" });
  expect(await overflow(page), "sideways scroll with both boxes, px").toBeLessThanOrEqual(0);
  const start = await page.getByRole("button", { name: "New session" }).boundingBox();
  expect(start!.y + start!.height, "New session on the first screen, px").toBeLessThanOrEqual(768);

  await page.getByRole("button", { name: "New session" }).click();
  await expect.poll(() => page.evaluate(() => scrollY), "New session brings the table up, with no other click to do it").toBeGreaterThan(0);
  await expect(page.getByText(/preflop graded by the preflop solve, at its raise sizes/).first()).toBeVisible();
  await expect(options(page).first().or(nextHand(page))).toBeVisible({ timeout: 120_000 });
  for (let i = 0; i < 12 && !(await options(page).first().isVisible()); i += 1) {
    await nextHand(page).click();
    await expect(options(page).first().or(nextHand(page))).toBeVisible({ timeout: 120_000 });
  }
  await page.screenshot({ path: "e2e-results/shots/tablet/pf-both-boxes-table.png" });
  // (New session brings the table up: on this screen the open form would leave it below the fold)
  await expect.poll(async () => { const box = await options(page).last().boundingBox(); return box!.y + box!.height; }, "your options on the screen, px").toBeLessThanOrEqual(768);
  expect(await overflow(page), "sideways scroll at the table, px").toBeLessThanOrEqual(0);

  // the form changed its mind: with the first box off the second goes too, and is off again
  // (about 4% of decisions fall to the charts, so a run can end with none: History's columns follow what the page counted)
  const both = page.getByText(/Preflop so far: [1-9]\d* by the preflop solve.*; [1-9]\d* by the charts/);
  await playPassively(page, () => both.isVisible(), 80);
  await expect(page.getByText(/Preflop so far: \d+ by the preflop solve/)).toBeVisible();
  const charts = await both.isVisible();
  await page.goto("/lizard/history/");
  await expect(page.getByRole("table", { name: "Totals by kind" })).toBeVisible();
  const heads = await page.getByRole("table", { name: "Totals by kind" }).locator("th").allTextContents();
  expect(heads).toContain("By the preflop solve");
  expect(heads.includes("By frequency")).toBe(charts);
  const rates = page.getByRole("region", { name: "Rates by seat and pot type" });
  await expect(rates).toContainText(/Preflop solve/);
  await expect(page.getByRole("region", { name: "Sessions" }).getByRole("listitem").first()).toContainText(/by the preflop solve/);
  await clean(page, problems);
});

// How long a filtered search takes through the worker: the preflop of each deal is played by the charts, a solver move
// each, until it's the pot asked for. `search`: to the end of "Dealing…"; `move`: to your options, the answer's solve in it.
async function searchTimed(page: Page, what: string, set: () => Promise<unknown>) {
  await newSession(page, async () => {
    await page.getByLabel("Players").selectOption("6");
    await page.getByLabel("Stack in big blinds").fill("100");
    await set();
  });
  const t0 = Date.now();
  const out = page.getByText(/^No .* in [\d,]+ (deals|draws)/).first();
  const dealing = page.getByRole("status").filter({ hasText: /^Dealing/ });
  let [deals, search] = [0, 0];
  for (;;) {
    const words = await dealing.textContent({ timeout: 50 }).catch(() => null);
    const m = words && /\(deal (\d+)\)/.exec(words);
    if (m) deals = Math.max(deals, Number(m[1]));
    if (!words && deals && !search) search = Date.now() - t0;
    if ((await options(page).first().isVisible()) || (await nextHand(page).isVisible()) || (await out.isVisible())) break;
    if (Date.now() - t0 > 400_000) throw new Error(`${what}: nothing after ${Date.now() - t0} ms, at deal ${deals}`);
    await page.waitForTimeout(50);
  }
  const move = Date.now() - t0;
  const ranOut = await out.isVisible();
  timing(`${what}: ${ranOut ? "ran out" : "dealt"}, at deal ${deals || 1}, search ${((search || move) / 1000).toFixed(2)} s, to your move`, move);
  return { search: search || move, move, deals, ranOut };
}

const flopOf = async (page: Page) => (await page.getByRole("group", { name: "Board" }).getByRole("img").evaluateAll((cs) => cs.map((c) => c.getAttribute("aria-label") ?? ""))).filter((x) => !/face-down/.test(x));

test("Postflop trainer's board filter through the real worker: 3-bet pots on monotone flops, timed, and the flop dealt fits", async ({ page, problems }) => {
  test.setTimeout(600_000);
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    const { search, ranOut } = await searchTimed(page, `3-bet pot, monotone, try ${i + 1}`, async () => {
      await page.getByLabel("Play", { exact: true }).selectOption("3bet");
      await page.getByLabel("Flop: Suits").selectOption("mono");
      await expect(page.getByText(/^[\d,]+ of 22,100 flops fit, at one table\./)).toBeVisible();
    });
    expect(ranOut, "the search found a pot").toBe(false);
    times.push(search);
    if (await options(page).first().isVisible()) {
      const suits = new Set((await flopOf(page)).slice(0, 3).map((c) => c.split(" of ")[1]));
      expect(suits.size, "the flop's suits").toBe(1);
    }
  }
  timing("3-bet monotone, worst of three", Math.max(...times));
  await clean(page, problems);
});

test("Postflop trainer's hand filter through the real worker: a 4-bet pot, the rarest deal it asks for, timed to the deal or to running out", async ({ page, problems }) => {
  test.setTimeout(900_000);
  const plain = await searchTimed(page, "4-bet pot, no filter", () => page.getByLabel("Play", { exact: true }).selectOption("4bet"));
  const hard = await searchTimed(page, "4-bet pot, straight", async () => {
    await page.getByLabel("Play", { exact: true }).selectOption("4bet");
    await page.getByRole("combobox", { name: "Hands" }).selectOption("m:straight");
    await expect(page.locator("#hands-note")).toContainText(/straight/i);
  });
  if (plain.ranOut || hard.ranOut) await expect(page.getByText(/^No 4-bet pot/).first()).toBeVisible();
  await clean(page, problems);
});

test("Study's 3-way runout report: strategies only, solved on request, a card dealt from its row", async ({ page, problems }) => {
  await page.goto("/lizard/study/?p=3&s=100&pre=BTN:r2.5,SB:c,BB:c&b=Ac4c2d&flop=SB:x,BB:x,BTN:x");
  const panel = page.getByRole("region", { name: "Turn report" });
  await expect(panel).toBeVisible({ timeout: 120_000 });
  await expect(panel).toContainText("strategy (3-way)");
  const t0 = Date.now();
  await panel.getByRole("button", { name: "Turn report" }).click();
  const solve = panel.getByRole("button", { name: /^Solve the flop \(/ });
  const whose = panel.getByRole("group", { name: "Whose decision" });
  await expect(solve.or(whose)).toBeVisible({ timeout: 120_000 });
  if (await solve.isVisible()) {
    await expect(solve).toContainText(/up to ~\d+ s/);
    await solve.click();
    await expect(panel.getByText(/Solving the flop for the turn report/)).toBeVisible();
  }
  await expect(whose).toBeVisible({ timeout: 200_000 });
  timing("3-way turn report", Date.now() - t0);
  await expect(panel.getByRole("button", { name: /Live solve|Precomputed|Stored/ }).first()).toBeVisible();
  const table = panel.getByRole("table");
  const heads = await table.getByRole("columnheader").allTextContents();
  console.log(`3-way heads: ${heads.join(" | ")}`);
  expect(heads.join(" ")).not.toMatch(/ EV| eq/);
  await expect(panel.getByText(/Hidden at this width/)).toBeHidden();
  const avg = table.getByRole("row", { name: "Average" });
  await expect(avg).toContainText("All 49 cards");
  await expect(table.getByRole("button", { name: /^Deal / })).toHaveCount(49);
  await expect(panel.getByText(/Click a card to deal it/)).toBeVisible();
  await page.screenshot({ path: "e2e-results/shots/desktop/runout-3way.png", fullPage: true });

  // no EV anywhere: the bars say frequencies only
  const titles = await panel.locator("i[title]").evaluateAll((is) => is.map((i) => i.getAttribute("title") ?? ""));
  expect(titles.length).toBeGreaterThan(0);
  expect(titles.filter((t) => /EV/.test(t))).toEqual([]);

  // grouped, then one group
  await panel.getByLabel("Group the cards").selectOption({ index: 1 });
  await expect(table.getByRole("row").nth(2)).toBeVisible();
  await panel.getByLabel("Group the cards").selectOption("");
  await panel.getByLabel("Only cards that").selectOption({ index: 1 });
  await expect(avg).not.toContainText("All 49 cards");
  await panel.getByLabel("Only cards that").selectOption("");

  // at a phone's width
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(avg).toBeVisible();
  expect(await overflow(page), "sideways scroll at 375px, px").toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1440, height: 900 });

  // a row deals its card
  await table.getByRole("button", { name: "Deal 5h" }).click();
  await expect(page).toHaveURL(/b=Ac4c2d5h/);
  await expect(page.getByRole("region", { name: "Actions" }).getByRole("strong")).toBeVisible({ timeout: 120_000 });
  await clean(page, problems);
});

test("A 4-way flop answer in Study says what answered it, and calls nothing solved that wasn't", async ({ page, problems }) => {
  await page.goto("/lizard/study/?p=4&s=100&pre=CO:r2.5,BTN:c,SB:c,BB:c&b=Ac4c2d");
  const actions = page.getByRole("region", { name: "Actions" });
  await expect(actions.getByRole("strong")).toHaveText("SB", { timeout: 180_000 });
  await expect(actions).toContainText("to act on the flop");
  const status = page.getByRole("status").first();
  await expect(status).not.toBeEmpty({ timeout: 120_000 });
  // (Study's badge is the quiet one: a plain label, its detail in the panel)
  const badge = actions.locator("span[title]").filter({ hasText: /Live solve|Heuristic rules|Equity estimate|Answer at once|Precomputed/ }).first();
  await expect(badge).toBeVisible({ timeout: 120_000 });
  console.log(`4-way badge: ${await badge.textContent()}; title: ${await badge.getAttribute("title")}; status: ${await status.textContent()}`);
  await page.screenshot({ path: "e2e-results/shots/desktop/study-4way.png", fullPage: true });
  await actions.getByRole("button", { name: /^check/ }).first().click();
  await expect(actions.getByRole("strong")).toHaveText("BB", { timeout: 180_000 });
  await clean(page, problems);
});

test("The Saved page: sort kept across a reload, tags edited and searched, and one item exported and restored", async ({ page, problems }) => {
  await page.goto("/lizard/saved");
  await expect(page.getByRole("region", { name: "Saved spots" })).toContainText("0 saved");
  const spot = (id: string, title: string, createdAt: number, updatedAt: number) => ({ id, title, line: "p=2&s=100&pre=SB%3Ar2.5%2CBB%3Ac&b=Kd7c2h", state: {}, tags: [], note: "", createdAt, updatedAt });
  await putStore(page, "savedSpots", [spot("a", "Bravo", 1000, 9000), spot("b", "Alpha", 3000, 3000), spot("c", "Charlie", 2000, 5000)]);
  await page.reload();
  const list = page.getByRole("region", { name: "Saved spots" }).getByRole("listitem");
  const order = async () => (await list.evaluateAll((ls) => ls.map((l) => l.getAttribute("aria-label")))).join(",");
  await expect.poll(order).toBe("Bravo,Charlie,Alpha");
  const sort = page.getByLabel("Sort");
  await sort.selectOption("name");
  await expect.poll(order).toBe("Alpha,Bravo,Charlie");
  await sort.selectOption("oldest");
  await expect.poll(order).toBe("Bravo,Charlie,Alpha");
  await sort.selectOption("newest");
  await expect.poll(order).toBe("Alpha,Charlie,Bravo");
  await page.reload();
  await expect(page.getByLabel("Sort")).toHaveValue("newest");
  await expect.poll(order).toBe("Alpha,Charlie,Bravo");

  // a tag put on by hand, and found again
  const row = page.getByRole("listitem", { name: "Charlie" });
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  await row.getByLabel("Tags").fill("river, bluff");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(row).toContainText("bluff");
  const search = page.getByLabel("Search everything saved");
  await search.fill("bluff");
  await expect(list).toHaveCount(1);
  await search.fill("nothing like it");
  await expect(page.getByText("No saved spot matches “nothing like it”.")).toBeVisible();
  await search.fill("");

  // one item out, gone, and back with its tag
  const wait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Charlie" }).click();
  const download = await wait;
  expect(download.suggestedFilename()).toMatch(/saved-item/);
  const path = await download.path();
  const file = JSON.parse(readFileSync(path, "utf8")) as { counts: Record<string, number> };
  expect(file.counts.savedSpots).toBe(1);
  await page.evaluate(
    () =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open("lizard");
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const s = open.result.transaction("savedSpots", "readwrite").objectStore("savedSpots");
          s.clear();
          s.transaction.oncomplete = () => (open.result.close(), done());
        };
      }),
  );
  await page.reload();
  await expect(page.getByRole("region", { name: "Saved spots" })).toContainText("0 saved");
  await page.getByLabel("Backup file to restore").setInputFiles(path);
  await expect(page.getByRole("listitem", { name: "Charlie" })).toContainText("bluff");
  await expect(list).toHaveCount(1);
  await clean(page, problems);
});
