// A table end to end through its messages, on stand-in connections: seats and tokens, no third seat, the other seat's
// cards and the board's next cards never sent early, moves judged by the server, reconnecting by token, the clocks, the
// limits on what a connection may send, leaving, and the table expiring.
import { beforeEach, describe, expect, it } from "vitest";
import { BANK_REFILL, BANK_SECONDS, CLOSE, IDLE_MS, MAX_MESSAGE, MESSAGE_RATE, type ClientMessage, type TableView } from "../../web/src/features/arena/protocol";
import { DECK } from "../../web/src/poker/table";
import { newTable, parseMessage, Room } from "./room";
import { FakeConn, riggedRandom } from "./test/fakes";

const T0 = Date.UTC(2026, 10, 22, 12);
const RULES = { stack: 100, clock: 30 };
// SB (seat 0 in hand 1) AsAh, BB KsKh, board 2c 7d 9h Jc 3s
const TOP = ["As", "Ah", "Ks", "Kh", "2c", "7d", "9h", "Jc", "3s"];

let conns: FakeConn[];
let room: Room;
const open = () => {
  const c = new FakeConn(T0);
  conns.push(c);
  return c;
};
const send = (c: FakeConn, m: ClientMessage | Record<string, unknown>, now = T0) => room.message(c, JSON.stringify(m), now);
const tokenOf = (c: FakeConn) => (c.sock.messages().find((m) => m.t === "seated") as { token: string } | undefined)?.token;

async function two(): Promise<[FakeConn, FakeConn]> {
  const a = open();
  const b = open();
  await send(a, { t: "join", name: "Ann" });
  await send(b, { t: "join", name: "Bob" });
  return [a, b];
}

beforeEach(() => {
  conns = [];
  room = new Room(newTable(RULES, T0), () => conns.filter((c) => c.open), riggedRandom(TOP, DECK));
});

describe("seats", () => {
  it("seats two by the link, gives each a token, and deals the first hand once both are in", async () => {
    const [a, b] = await two();
    expect(a.sock.messages()[0]).toMatchObject({ t: "seated", seat: 0 });
    expect(b.sock.messages()[0]).toMatchObject({ t: "seated", seat: 1 });
    expect(tokenOf(a)).toMatch(/^[0-9a-f]{32}$/);
    expect(tokenOf(a)).not.toBe(tokenOf(b));
    // only a hash of the token is kept
    expect(JSON.stringify(room.state)).not.toContain(tokenOf(a));
    const va = a.sock.last();
    expect(va.you).toBe(0);
    expect(va.hand).toMatchObject({ n: 1, pos: { SB: 0, BB: 1 }, cards: ["As", "Ah"], theirs: null, board: [], toAct: 0 });
    expect(va.hand!.legal).toMatchObject({ toCall: 0.5, canRaise: true, minTo: 2, allInTo: 100 });
    expect(b.sock.last().hand).toMatchObject({ cards: ["Ks", "Kh"], theirs: null, legal: null });
    expect(va.seats.map((s) => s?.name)).toEqual(["Ann", "Bob"]);
  });

  it("has no third seat and no spectators: a third page is refused and cut off", async () => {
    await two();
    const c = open();
    await send(c, { t: "join", name: "Cy" });
    expect(c.sock.messages()).toEqual([{ t: "error", code: "full" }]);
    expect(c.sock.closedWith?.code).toBe(CLOSE.full);
    // a made-up token doesn't take a seat either
    const d = open();
    await send(d, { t: "join", name: "Di", token: "0".repeat(32) });
    expect(d.sock.closedWith?.code).toBe(CLOSE.full);
  });

  it("asks for a name of 1 to 16 plain characters, and keeps two seats' names apart", async () => {
    const a = open();
    await send(a, { t: "join", name: "<script>" });
    expect(a.sock.messages()).toEqual([{ t: "error", code: "bad_name" }]);
    await send(a, { t: "join", name: "x".repeat(17) });
    expect(a.sock.messages().at(-1)).toEqual({ t: "error", code: "bad_name" });
    await send(a, { t: "join", name: "  Sam   Ho " });
    const b = open();
    await send(b, { t: "join", name: "sam ho" });
    expect(b.sock.last().seats.map((s) => s?.name)).toEqual(["Sam Ho", "sam ho 2"]);
  });

  it("sends nothing to a page that hasn't taken a seat", async () => {
    const watcher = open();
    await two();
    expect(watcher.sock.sent).toEqual([]);
  });
});

describe("hidden cards", () => {
  it("never sends a seat the other's cards or a board card before its time, through a hand that ends in a fold", async () => {
    const [a, b] = await two();
    await send(a, { t: "act", n: 1, action: "call" });
    // before the flop's dealt nobody has a board card
    for (const c of [a, b]) for (const card of ["2c", "7d", "9h"]) expect(c.sock.sent.join()).not.toContain(`"${card}"`);
    await send(b, { t: "act", n: 1, action: "check" });
    expect(b.sock.last().hand!.board).toEqual(["2c", "7d", "9h"]);
    for (const c of [a, b]) for (const card of ["Jc", "3s"]) expect(c.sock.sent.join()).not.toContain(`"${card}"`);
    await send(b, { t: "act", n: 1, action: "bet", to: 3 });
    await send(a, { t: "act", n: 1, action: "fold" });
    expect(a.sock.last().hand!.result).toMatchObject({ net: [-1, 1], winners: [1] });
    // the whole hand: Bob never saw As Ah, Ann never saw Ks Kh, nobody saw the turn or river
    expect(b.sock.sent.join()).not.toMatch(/"As"|"Ah"|As Ah/);
    expect(a.sock.sent.join()).not.toMatch(/"Ks"|"Kh"|Ks Kh/);
    for (const c of [a, b]) expect(c.sock.sent.join()).not.toMatch(/"Jc"|"3s"/);
    // each seat's history has its own cards only
    expect(a.sock.last().hand!.result!.history).toContain("Dealt to Ann [As Ah]");
    expect(a.sock.last().hand!.result!.history).not.toContain("Ks Kh");
    expect(b.sock.last().hand!.result!.history).toContain("Dealt to Bob [Ks Kh]");
  });

  it("shows both hands at a showdown, and only then", async () => {
    const [a, b] = await two();
    await send(a, { t: "act", n: 1, action: "all-in" });
    expect(b.sock.last().hand!.theirs).toBeNull();
    await send(b, { t: "act", n: 1, action: "call" });
    expect(b.sock.last().hand).toMatchObject({ theirs: ["As", "Ah"], board: ["2c", "7d", "9h", "Jc", "3s"] });
    expect(a.sock.last().hand!.theirs).toEqual(["Ks", "Kh"]);
    expect(a.sock.last().hand!.result!.says).toBe("Ann wins 200bb with pair of aces.");
    expect(a.sock.last().seats.map((s) => s?.score)).toEqual([100, -100]);
  });
});

describe("moves", () => {
  it("judges every move on the server: out of turn, for an old hand, too small, or unreadable", async () => {
    const [a, b] = await two();
    await send(b, { t: "act", n: 1, action: "check" });
    expect(b.sock.messages().at(-1)).toEqual({ t: "error", code: "not_your_turn" });
    await send(a, { t: "act", n: 0, action: "call" });
    expect(a.sock.messages().at(-1)).toEqual({ t: "error", code: "stale" });
    await send(a, { t: "act", n: 1, action: "raise", to: 1.5 });
    expect(a.sock.messages().at(-1)).toEqual({ t: "error", code: "illegal" });
    await send(a, { t: "act", n: 1, action: "shove" });
    expect(a.sock.messages().at(-1)).toEqual({ t: "error", code: "bad_message" });
    const before = a.sock.sent.length;
    await room.message(a, "not json", T0);
    expect(a.sock.sent.length).toBe(before + 1);
    expect(room.state!.hand!.lines.preflop).toEqual([]);
  });

  it("deals the next hand when both ask, the button moving, the banks topped up", async () => {
    const [a, b] = await two();
    await send(a, { t: "act", n: 1, action: "fold" });
    expect(a.sock.last().hand!.result).not.toBeNull();
    await send(a, { t: "next" });
    expect(room.state!.hand!.n).toBe(1);
    expect(b.sock.last().seats[0]!.ready).toBe(true);
    await send(b, { t: "next" });
    expect(room.state!.hand!.n).toBe(2);
    expect(b.sock.last().hand!.pos).toEqual({ SB: 1, BB: 0 });
    expect(b.sock.last().hand!.toAct).toBe(1);
  });

  it("parses only the messages a page may send", () => {
    expect(parseMessage('{"t":"join","name":"A","token":"zz"}')).toBeNull();
    expect(parseMessage('{"t":"act","n":1,"action":"raise","to":-1}')).toBeNull();
    expect(parseMessage('{"t":"act","n":1.5,"action":"call"}')).toBeNull();
    expect(parseMessage("[1]")).toBeNull();
    expect(parseMessage('{"t":"next"}')).toEqual({ t: "next" });
  });
});

describe("reconnecting", () => {
  it("gives a seat back to its token after the page drops, mid-hand, cards and all", async () => {
    const [a, b] = await two();
    await send(a, { t: "act", n: 1, action: "raise", to: 3 });
    const token = tokenOf(a)!;
    a.sock.close(1001, "gone");
    expect(room.closed(a)).toBe(true);
    room.broadcast(T0);
    expect(b.sock.last().seats[0]!.connected).toBe(false);
    const a2 = open();
    await send(a2, { t: "join", name: "whoever", token });
    expect(a2.sock.messages()[0]).toEqual({ t: "seated", seat: 0, token });
    expect(a2.sock.last().hand).toMatchObject({ n: 1, cards: ["As", "Ah"] });
    expect(b.sock.last().seats[0]).toMatchObject({ name: "Ann", connected: true });
    await send(b, { t: "act", n: 1, action: "call" });
    expect(a2.sock.last().hand!.board).toHaveLength(3);
  });

  it("moves a seat to the newest page with its token, cutting off the old one", async () => {
    const [a] = await two();
    const a2 = open();
    await send(a2, { t: "join", name: "Ann", token: tokenOf(a)! });
    expect(a.sock.closedWith?.code).toBe(CLOSE.replaced);
    expect(a2.sock.last().you).toBe(0);
  });
});

describe("the clocks", () => {
  it("runs each decision's clock, then the bank; out of time it checks or folds, and the bank tops up next hand", async () => {
    const [a, b] = await two();
    const clock = RULES.clock * 1000;
    const bank = BANK_SECONDS * 1000;
    expect(room.deadline()).toBe(T0 + clock + bank);
    expect(room.nextAlarm()).toBe(T0 + clock + bank);
    expect(a.sock.last().hand!.bankFrom).toBe(T0 + clock);
    expect(room.tick(T0 + clock + bank - 1)).toBe(false);
    // Ann takes 40s: 10s off her bank
    await send(a, { t: "act", n: 1, action: "call" }, T0 + clock + 10_000);
    expect(room.state!.seats[0]!.bank).toBe(bank - 10_000);
    // Bob never answers: out of time he checks (he may), then on the flop he's first and checks again by the clock...
    const t1 = T0 + clock + 10_000;
    expect(room.tick(t1 + clock + bank)).toBe(true);
    expect(room.state!.hand!.lines.preflop.at(-1)).toEqual({ pos: "BB", action: "check" });
    expect(room.state!.seats[1]!.bank).toBe(0);
    // ...and with no bank left his next clock is the decision's alone
    expect(room.deadline()).toBe(t1 + clock + bank + clock);
    await send(b, { t: "act", n: 1, action: "bet", to: 2 }, t1 + clock + bank + 1000);
    // Ann out of time facing a bet: she folds
    const t2 = t1 + clock + bank + 1000;
    room.tick(t2 + clock + (bank - 10_000));
    room.broadcast(t2);
    expect(b.sock.last().hand!.result).toMatchObject({ timedOut: 0, winners: [1] });
    await send(a, { t: "next" }, t2 + 200_000);
    await send(b, { t: "next" }, t2 + 200_000);
    expect(room.state!.seats.map((s) => s!.bank)).toEqual([0 + BANK_REFILL * 1000, BANK_REFILL * 1000]);
  });

  it("closes and forgets a table nobody has sent anything to for a while", async () => {
    const [a, b] = await two();
    await send(a, { t: "act", n: 1, action: "fold" });
    expect(room.nextAlarm()).toBe(T0 + IDLE_MS);
    expect(room.alarm(T0 + IDLE_MS - 1)).toBe("none");
    expect(room.alarm(T0 + IDLE_MS)).toBe("expired");
    expect(room.state).toBeNull();
    for (const c of [a, b]) expect(c.sock.closedWith?.code).toBe(CLOSE.expired);
    const late = open();
    await send(late, { t: "join", name: "Late" });
    expect(late.sock.messages()).toEqual([{ t: "error", code: "no_table" }]);
    expect(late.sock.closedWith?.code).toBe(CLOSE.noTable);
  });
});

describe("limits on a connection", () => {
  it("cuts off a message over the size cap, or one that isn't text", async () => {
    const a = open();
    await room.message(a, "x".repeat(MAX_MESSAGE + 1), T0);
    expect(a.sock.closedWith?.code).toBe(CLOSE.abuse);
    const b = open();
    await room.message(b, new ArrayBuffer(8), T0);
    expect(b.sock.closedWith?.code).toBe(CLOSE.abuse);
    // (a name of many-byte characters counts in bytes)
    const c = open();
    await room.message(c, JSON.stringify({ t: "join", name: "é".repeat(260) }), T0);
    expect(c.sock.closedWith?.code).toBe(CLOSE.abuse);
  });

  it("slows a connection that sends too often, and cuts it off at twice the rate", async () => {
    const [a] = await two();
    for (let i = 1; i < MESSAGE_RATE.max; i++) await send(a, { t: "next" }, T0 + 1);
    expect(a.sock.messages().some((m) => m.t === "error" && m.code === "slow_down")).toBe(false);
    await send(a, { t: "next" }, T0 + 2);
    expect(a.sock.messages().at(-1)).toEqual({ t: "error", code: "slow_down" });
    for (let i = 0; i < MESSAGE_RATE.max; i++) await send(a, { t: "next" }, T0 + 3);
    expect(a.sock.closedWith?.code).toBe(CLOSE.abuse);
    // a new window starts clean
    const b = conns[1]!;
    await send(b, { t: "next" }, T0 + MESSAGE_RATE.ms + 5);
    expect(b.open).toBe(true);
  });
});

describe("leaving", () => {
  it("frees a seat between hands for someone else with the link", async () => {
    const [a, b] = await two();
    await send(a, { t: "act", n: 1, action: "fold" });
    await send(b, { t: "leave" });
    expect(b.sock.closedWith?.code).toBe(CLOSE.left);
    expect(room.state!.seats[1]).toBeNull();
    const c = open();
    await send(c, { t: "join", name: "Cy" });
    expect(c.sock.messages()[0]).toMatchObject({ t: "seated", seat: 1 });
    expect((a.sock.last() as TableView).seats[1]).toMatchObject({ name: "Cy", ready: false });
  });

  it("plays out a hand left in the middle by the clock at once, then frees the seat", async () => {
    const [a, b] = await two();
    await send(b, { t: "leave" });
    // Ann acts; Bob's turn is taken for him at once: he checks his option
    await send(a, { t: "act", n: 1, action: "call" });
    expect(room.state!.hand!.lines.preflop.at(-1)).toEqual({ pos: "BB", action: "check" });
    await send(a, { t: "act", n: 1, action: "bet", to: 2 }, T0 + 1);
    expect(room.state!.hand!.result).toMatchObject({ winners: [0] });
    expect(room.state!.seats[1]).toBeNull();
    expect(a.sock.last().seats[1]).toBeNull();
  });
});
