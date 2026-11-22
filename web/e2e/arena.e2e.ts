// "Play a friend" in two browsers at once: Ann makes a table, Bob opens its link, and they play a hand to a showdown,
// each seeing only their own cards until then; then Ann keeps the hand in Analyze. Needs a build with VITE_ARENA=on
// (skipped otherwise: CI builds without it until the owner sets LIZARD_ARENA).
//
// The server: by default the pages' sockets are routed (Playwright's routeWebSocket) to an in-test server running the
// Worker's own table code (arena-worker/src/room.ts, the code its Durable Object runs, dealing with crypto randomness),
// so no Worker runs in CI. With ARENA_E2E_URL set (`npx wrangler@4 dev` from arena-worker/, with
// `--var DEV_ORIGINS:http://localhost:4176`, at e.g. http://127.0.0.1:8787) the same test goes to that real Worker
// instead, the sockets piped through to it.
import type { Browser, Page, WebSocketRoute } from "@playwright/test";
import { newTable, Room, freshMeta, type Conn, type ConnMeta } from "../../arena-worker/src/room";
import { cryptoRandom, randomHex } from "../../arena-worker/src/rng";
import { expect, test } from "./fixtures";

test.skip(({ viewport }) => viewport?.width !== 1440, "one width is enough");

const REAL = process.env.ARENA_E2E_URL?.replace(/\/$/, "");
const ORIGIN = "http://localhost:4176";

/** The in-test server: one table, its connections the pages' routed sockets. */
function localServer() {
  let room: Room | null = null;
  const conns: { conn: Conn; open: boolean }[] = [];
  return {
    async create(route: import("@playwright/test").Route) {
      const rules = JSON.parse(route.request().postData() ?? "{}");
      room = new Room(newTable(rules, Date.now()), () => conns.filter((c) => c.open).map((c) => c.conn), cryptoRandom);
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: randomHex(cryptoRandom), rules }) });
    },
    socket(ws: WebSocketRoute) {
      let meta: ConnMeta = freshMeta(Date.now());
      const entry = {
        open: true,
        conn: {
          send: (t: string) => ws.send(t),
          close: (code: number, reason: string) => {
            entry.open = false;
            void ws.close({ code, reason });
          },
          meta: () => ({ ...meta }),
          setMeta: (m: ConnMeta) => {
            meta = { ...m };
          },
        } satisfies Conn,
      };
      conns.push(entry);
      ws.onMessage((m) => void room!.message(entry.conn, String(m), Date.now()));
      ws.onClose(() => {
        entry.open = false;
        if (room?.closed(entry.conn)) room.broadcast(Date.now());
      });
    },
  };
}

/** Each page's requests and sockets to the arena, sent to the in-test server or piped to the real Worker. */
async function wire(page: Page, server: ReturnType<typeof localServer>) {
  await page.route("**/lizard/api/arena/tables", async (route) => {
    if (!REAL) return server.create(route);
    const res = await route.fetch({ url: `${REAL}/lizard/api/arena/tables`, headers: { ...route.request().headers(), origin: ORIGIN, "x-lizard": "1" } });
    await route.fulfill({ response: res });
  });
  await page.routeWebSocket(/\/lizard\/api\/arena\/tables\/[0-9a-f]{32}\/ws$/, (ws) => {
    if (!REAL) return server.socket(ws);
    const path = new URL(ws.url()).pathname;
    const up = new WebSocket(`${REAL.replace(/^http/, "ws")}${path}`);
    const queue: string[] = [];
    up.onopen = () => queue.splice(0).forEach((m) => up.send(m));
    up.onmessage = (e) => ws.send(String(e.data));
    up.onclose = (e) => void ws.close({ code: e.code === 1005 ? 1000 : e.code, reason: e.reason });
    ws.onMessage((m) => (up.readyState === 1 ? up.send(String(m)) : queue.push(String(m))));
    ws.onClose(() => up.close());
  });
}

async function player(browser: Browser, server: ReturnType<typeof localServer>) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  const page = await context.newPage();
  await page.route(/\/(lizard-library|gto-solver-library)\//, (r) => r.fulfill({ status: 404, body: "" }));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await wire(page, server);
  return { context, page, errors };
}

const seat = (page: Page, name: string) => page.getByRole("listitem", { name });
const cardsOf = async (page: Page, name: string) =>
  (await seat(page, name).getByRole("img").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""))).filter((l) => l !== "face-down card");

test("two players play a hand by share link, each seeing only their own cards until the showdown", async ({ browser, page: probe }) => {
  test.setTimeout(120_000);
  await probe.goto("/lizard/arena/");
  const built = await probe
    .getByRole("heading", { name: "Play a friend" })
    .waitFor({ timeout: 15_000 })
    .then(() => true, () => false);
  test.skip(!built, "this build has no arena (VITE_ARENA isn't on)");

  const server = localServer();
  const ann = await player(browser, server);
  const bob = await player(browser, server);

  await ann.page.goto("/lizard/arena/");
  await expect(ann.page.getByText(/No real money, prizes or wagering of any kind/)).toBeVisible();
  await ann.page.getByRole("textbox", { name: "Your name at the table" }).fill("Ann");
  await ann.page.getByRole("button", { name: "Make a table" }).click();
  const link = await ann.page.getByRole("textbox", { name: "Invite link" }).inputValue();
  expect(link).toMatch(/\/lizard\/arena#[0-9a-f]{32}$/);
  await expect(ann.page.getByText(/Waiting for your friend/)).toBeVisible();

  await bob.page.goto(link.replace(/^https?:\/\/[^/]+/, ""));
  await bob.page.getByRole("textbox", { name: "Your name at the table" }).fill("Bob");
  await bob.page.getByRole("button", { name: "Sit down" }).click();

  // the first hand: Ann (seat 1) on the button
  await expect(seat(ann.page, "Ann (you)")).toContainText("button, small blind");
  await expect(seat(bob.page, "Bob (you)")).toContainText("big blind");
  const annCards = await cardsOf(ann.page, "Ann (you)");
  const bobCards = await cardsOf(bob.page, "Bob (you)");
  expect(annCards).toHaveLength(2);
  expect(bobCards).toHaveLength(2);
  // each sees the other's two cards face down, and nothing of them anywhere on the page
  await expect(seat(bob.page, "Ann").getByRole("img", { name: "face-down card" })).toHaveCount(2);
  await expect(seat(ann.page, "Bob").getByRole("img", { name: "face-down card" })).toHaveCount(2);

  const move = (p: Page, name: RegExp) => p.getByRole("group", { name: "Your move" }).getByRole("button", { name }).click();
  await move(ann.page, /^Call 0\.5$/);
  await move(bob.page, /^Check$/);
  // flop, turn, river: Bob (big blind) first, both check; until the showdown Bob's page never shows Ann's cards
  const board = bob.page.getByRole("listitem", { name: "Board" });
  for (const street of [3, 4, 5]) {
    await expect(board.locator("[role=img]:not([aria-label='face-down card'])")).toHaveCount(street);
    for (const l of annCards) await expect(bob.page.getByRole("img", { name: l, exact: true })).toHaveCount(0);
    for (const l of bobCards) await expect(ann.page.getByRole("img", { name: l, exact: true })).toHaveCount(0);
    await move(bob.page, /^Check$/);
    await move(ann.page, /^Check$/);
  }

  // the showdown: both hands face up on both pages, the same outcome, the score moved
  for (const p of [ann.page, bob.page]) await expect(p.getByRole("region", { name: "Hand over" })).toBeVisible();
  expect(await cardsOf(bob.page, "Ann")).toEqual(annCards);
  expect(await cardsOf(ann.page, "Bob")).toEqual(bobCards);
  const says = await ann.page.getByRole("region", { name: "Hand over" }).locator("p").first().innerText();
  await expect(bob.page.getByRole("region", { name: "Hand over" }).locator("p").first()).toContainText(says.split(" (")[0]!);

  // Review in Analyze, offered once the hand is over: the hand kept in this browser's Analyze
  await ann.page.getByRole("button", { name: "Review in Analyze" }).click();
  const kept = ann.page.getByRole("link", { name: "Kept in Analyze: open it there" });
  await expect(kept).toBeVisible();
  const href = (await kept.getAttribute("href"))!;
  expect(href).toMatch(/\/lizard\/analyze\?hand=Lizard%20Arena/);

  // the next hand needs both; then the button moves to Bob
  await ann.page.getByRole("button", { name: "Next hand" }).click();
  await expect(ann.page.getByText(/Waiting for Bob to deal the next hand/)).toBeVisible();
  await bob.page.getByRole("button", { name: "Next hand" }).click();
  await expect(seat(bob.page, "Bob (you)")).toContainText("button, small blind");
  await expect(seat(ann.page, "Ann (you)")).toContainText("big blind");

  // and Analyze opens the kept hand, replayed to its showdown
  await ann.page.goto(href);
  await expect(ann.page.getByText(/Pot 2bb \(showdown\)/)).toBeVisible({ timeout: 30_000 });
  expect([...ann.errors, ...bob.errors]).toEqual([]);
  await ann.context.close();
  await bob.context.close();
});
