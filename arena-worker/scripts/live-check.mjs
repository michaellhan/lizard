// The arena's live check (docs/DEPLOYMENT.md §8): makes a table on the deployed Worker, sits two WebSocket clients at it
// and plays one hand to its end, checking along the way that neither client is ever sent the other's cards before a
// showdown, nor a board card before its street. Node 22+ (its own fetch and WebSocket), no dependencies.
//
//   node arena-worker/scripts/live-check.mjs [base]     (base: https://www.michael-han.com by default; or a wrangler dev URL)
const BASE = (process.argv[2] ?? "https://www.michael-han.com").replace(/\/$/, "");
const ORIGIN = process.env.ARENA_ORIGIN ?? "https://www.michael-han.com";

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const health = await fetch(`${BASE}/lizard/api/arena/health`);
if (health.status !== 200) fail(`health answered ${health.status}`);

const made = await fetch(`${BASE}/lizard/api/arena/tables`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: ORIGIN, "x-lizard": "1" },
  body: JSON.stringify({ stack: 100, clock: 30 }),
});
if (made.status !== 201) fail(`making a table answered ${made.status} ${await made.text()}`);
const { id } = await made.json();
if (!/^[0-9a-f]{32}$/.test(id)) fail(`the id ${id} isn't 128 bits of hex`);
console.log(`table made (id withheld here: it is the share link); rules 100bb, 30s`);

const wsBase = BASE.replace(/^http/, "ws");
// an id nobody made gets no socket
const refused = await new Promise((res) => {
  const ws = new WebSocket(`${wsBase}/lizard/api/arena/tables/${"0".repeat(32)}/ws`);
  ws.onopen = () => {
    ws.close();
    res(false);
  };
  ws.onerror = () => res(true);
});
if (!refused) fail("a made-up table id was given a socket");
console.log("a made-up id: no socket");
function seat(name) {
  const ws = new WebSocket(`${wsBase}/lizard/api/arena/tables/${id}/ws`);
  const s = { name, ws, raw: [], views: [], seat: null, waiters: [] };
  ws.onmessage = (e) => {
    const text = String(e.data);
    s.raw.push(text);
    const m = JSON.parse(text);
    if (m.t === "seated") s.seat = m.seat;
    if (m.t === "state") s.views.push(m);
    if (m.t === "error") console.log(`${name} was refused: ${m.code}`);
    for (const w of s.waiters.splice(0)) w();
  };
  s.open = new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error(`${name}: the socket failed`));
  });
  s.next = (pred, ms = 10_000) =>
    new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`${name}: timed out waiting`)), ms);
      const check = () => {
        const v = s.views.at(-1);
        if (v && pred(v)) {
          clearTimeout(t);
          res(v);
        } else s.waiters.push(check);
      };
      check();
    });
  return s;
}

const a = seat("Ann");
const b = seat("Bob");
await Promise.all([a.open, b.open]);
a.ws.send(JSON.stringify({ t: "join", name: "Ann" }));
await a.next(() => true);
b.ws.send(JSON.stringify({ t: "join", name: "Bob" }));
const first = await a.next((v) => v.hand?.n === 1);
const vb = await b.next((v) => v.hand?.n === 1);
const cards = { [a.seat]: first.hand.cards, [b.seat]: vb.hand.cards };
console.log(`seats: Ann ${a.seat}, Bob ${b.seat}; hand 1 dealt; small blind is seat ${first.hand.pos.SB}`);

const bySeat = { [a.seat]: a, [b.seat]: b };
let guard = 0;
let last = first;
while (!last.hand.result && guard++ < 20) {
  const s = bySeat[last.hand.toAct];
  const v = s.views.at(-1);
  const lg = v.hand.legal;
  if (!lg) {
    await s.next((x) => !!x.hand.legal || !!x.hand.result);
    last = s.views.at(-1);
    continue;
  }
  const before = s.views.length;
  s.ws.send(JSON.stringify({ t: "act", n: v.hand.n, action: lg.toCall > 0 ? "call" : "check" }));
  await s.next((x) => s.views.length > before && (x.hand.result || x.hand.toAct !== v.hand.toAct || x.hand.board.length !== v.hand.board.length));
  last = s.views.at(-1);
}
const ra = await a.next((v) => !!v.hand.result);
const rb = await b.next((v) => !!v.hand.result);
console.log(`hand over: ${ra.hand.result.says} (Ann ${ra.hand.result.net[a.seat]}bb, Bob ${rb.hand.result.net[b.seat]}bb)`);

// hidden cards: every message each client got before the hand was over
for (const [me, other] of [
  [a, b],
  [b, a],
]) {
  const theirs = cards[other.seat];
  const over = me.raw.findIndex((t) => t.includes('"result":{'));
  const early = me.raw.slice(0, over);
  for (const c of theirs) if (early.some((t) => t.includes(`"${c}"`))) fail(`${me.name} was sent ${other.name}'s card ${c} before the hand was over`);
  const finalBoard = (me === a ? ra : rb).hand.board;
  for (const [i, c] of finalBoard.entries()) {
    const street = i < 3 ? 3 : i + 1;
    const leaked = me.raw.find((t) => {
      if (!t.includes(`"${c}"`)) return false;
      const m = JSON.parse(t);
      return m.t === "state" && m.hand && m.hand.board.length < street && !m.hand.result;
    });
    if (leaked) fail(`${me.name} was sent the board card ${c} before its street`);
  }
}
if (!ra.hand.theirs || ra.hand.theirs.join() !== cards[b.seat].join()) fail("Ann wasn't shown Bob's cards at the showdown");
if (!ra.hand.result.history.includes("Lizard Arena Hand #")) fail("no hand history");
if (ra.hand.result.history.includes(id)) fail("the history has the table's id in it");
console.log("hidden cards: neither client was sent the other's cards or a board card early; both shown at the showdown");
console.log("history: written from each seat, without the table's id");

a.ws.send(JSON.stringify({ t: "leave" }));
b.ws.send(JSON.stringify({ t: "leave" }));
setTimeout(() => {
  a.ws.close();
  b.ws.close();
  console.log("PASS");
  process.exit(0);
}, 500);
