// The Practice session (session.ts): the totals the page has always kept, one number a hand, and History's record.
import { describe, expect, it } from "vitest";
import { emptyScore, type Grade } from "@/grading/grade";
import type { Move } from "@/poker/table";
import type { ResultSource } from "@/solver/types";
import { practiceNumber } from "./history";
import { handPot } from "@/features/history/history";
import { following, newHand, redeal, simOf, withVillain, type Decision, type HandOptions, type HandResult, type PracticeHand } from "./practice";
import { afterDeal, afterDecision, afterHand, atTables, freshSession, keyOf, toRecord } from "./session";

const OPTS: Required<HandOptions> = { seat: "moves", preflopOnly: false, pot: null, ante: 0, straddle: false, carry: false, sizes: null, rake: 0, rakeCap: 0 };

const grade = (g: Partial<Grade> = {}): Grade => ({ a: 0, best: 0, verdict: "Best", ok: true, mixed: false, loss: 0, lossPct: 0, byEv: true, ...g });
const dec = (g: Grade | null, source?: ResultSource): Decision => ({
  street: "preflop",
  chose: "call",
  move: { pos: "BTN", action: "call" },
  grade: g,
  mix: [],
  pot: 10,
  provenance: source ? { source, approximate: source === "charts", mode: "quick", transport: "worker", solverVersion: "test", partial: false, receivedAt: 0 } : null,
  study: "",
});
const won = (net: number): HandResult => ({ net, folded: false, winners: [], says: "", pays: {} });

const mv = (pos: string, action: Move["action"], to?: number): Move => ({ pos, action, ...(to !== undefined ? { to } : {}) });
const played = (h: PracticeHand, ms: Move[]) => ms.reduce((x, m) => withVillain(x, m), h);
// a single-raised pot, and one folded round to the big blind
const SRP = [mv("UTG", "raise", 2.5), mv("HJ", "fold"), mv("CO", "fold"), mv("BTN", "call"), mv("SB", "fold"), mv("BB", "fold")];
const WALK = [mv("UTG", "fold"), mv("HJ", "fold"), mv("CO", "fold"), mv("BTN", "fold"), mv("SB", "fold")];

describe("the session's totals", () => {
  it("counts each graded decision and finished hand as the page always has", () => {
    const chart = dec(grade({ byEv: false }), "charts");
    const live = dec(grade({ verdict: "Inaccuracy", ok: false, loss: 0.4, lossPct: 8 }), "live");
    const first = { ...played(newHand(6, 100, 0, 1), SRP), decisions: [chart, live] };
    const second = played(newHand(6, 100, 1, 2), WALK);

    let s = freshSession(6, 100, OPTS);
    s = afterDecision(s, first, chart);
    s = afterDecision(s, first, live);
    s = afterHand(s, first, won(0.1));
    s = afterHand(s, second, won(0.2));

    expect(s.hands).toBe(2);
    // (rounded as it adds up, not 0.30000000000000004)
    expect(s.net).toBe(0.3);
    expect(s.score).toEqual({ ...emptyScore(), n: 2, ok: 1, ne: 1, loss: 0.4, lossPct: 8, best: 1, recent: [1, 0] });
    expect(s.sources).toEqual({ charts: 1, live: 1 });
    expect(s.byPot).toMatchObject({
      SRP: { hands: 1, n: 2, ok: 1, ne: 1, loss: 0.4, lossPct: 8, played: 1, net: 0.1 },
      Unopened: { hands: 1, n: 0, ok: 0, ne: 0, loss: 0, lossPct: 0, played: 1, net: 0.2 },
    });
    expect(s.review.map((e) => e.d)).toEqual([chart, live]);
  });

  it("scores every table in one session: hands, net and tallies add up, `score.n` ahead of them while a hand is on", () => {
    const one = dec(grade(), "live");
    const two = dec(grade({ verdict: "Mistake", ok: false, loss: 1, lossPct: 20 }), "live");
    const a = { ...played(newHand(6, 100, 0, 1), SRP), decisions: [one] };
    const b = { ...played(newHand(6, 100, 1, 2), WALK), decisions: [two] };

    let s = freshSession(6, 100, OPTS);
    s = afterDecision(s, a, one, 1);
    s = afterDecision(s, b, two, 2);
    s = afterHand(s, b, won(-1));
    expect(s.score.n).toBe(2);
    expect(Object.values(s.byPot).reduce((n, t) => n + t.n, 0)).toBe(1);

    s = afterHand(s, a, won(3));
    expect(s).toMatchObject({ hands: 2, net: 2 });
    expect(Object.values(s.byPot).map((t) => t.hands)).toEqual([1, 1]);
    expect(Object.values(s.byPot).reduce((n, t) => n + t.n, 0)).toBe(s.score.n);
    expect(Object.values(s.byPot).reduce((n, t) => n + t.net, 0)).toBe(s.net);
    expect(s.review.map((e) => [e.table, e.n])).toEqual([[1, 1], [2, 2]]);
  });

  it("counts no net preflop only, where no hand is played out", () => {
    const h = played(newHand(6, 100, 0, 1, { preflopOnly: true }), SRP);
    const s = afterHand(freshSession(6, 100, { ...OPTS, preflopOnly: true }), h, won(1.5));
    expect(s).toMatchObject({ hands: 1, net: 0 });
    expect(s.byPot.SRP).toMatchObject({ hands: 1, played: 0, net: 0 });
  });

  it("leaves a decision with no grade out: the session is the same one", () => {
    const s = freshSession(6, 100, OPTS);
    expect(afterDecision(s, newHand(6, 100, 0, 1), dec(null))).toBe(s);
  });

  it("counts a decision after Reveal apart: no score, streak, source, review or lifetime tally, only how many", () => {
    const s = freshSession(6, 100, OPTS);
    const after = afterDecision(s, newHand(6, 100, 0, 1), { ...dec(null), revealed: true });
    expect(after).toEqual({ ...s, revealed: 1 });
    expect(after.review).toEqual([]);
    expect(after.score).toBe(s.score);
    expect(after.sources).toBe(s.sources);
    expect(toRecord(after, 1).meta).toMatchObject({ revealed: 1 });
    expect(toRecord(s, 1).meta).not.toHaveProperty("revealed");
  });

  it("numbers a reviewed decision by its own hand, and marks its table only where there are several", () => {
    const h = newHand(6, 100, 6, 1);
    const s = freshSession(6, 100, OPTS);
    const one = afterDecision(s, h, dec(grade(), "charts")).review[0]!;
    expect(one.n).toBe(7);
    expect(one).not.toHaveProperty("table");
    // (a later hand at another table may already have ended: `hands` doesn't number this one)
    const ahead = { ...s, hands: 3 };
    expect(afterDecision(ahead, h, dec(grade(), "charts"), 2).review[0]).toMatchObject({ n: 7, table: 2 });
  });
});

describe("dealt", () => {
  it("numbers hands from 0, today's numbers at one table", () => {
    let s = freshSession(6, 100, OPTS);
    expect(s.dealt).toBe(0);
    const a = newHand(6, 100, s.dealt, 1, OPTS);
    s = afterDeal(s);
    const b = following(a, 2, OPTS, false, s.dealt);
    s = afterDeal(s);
    const c = following(b, 3, OPTS, false, s.dealt);
    s = afterDeal(s);
    expect([a.n, b.n, c.n]).toEqual([0, 1, 2]);
    expect(s.dealt).toBe(3);
    // (the same as a hand's own count, where `following` isn't told a number)
    expect(following(b, 3, OPTS).n).toBe(c.n);
  });

  it("keeps a pot drill's hand filter in its record, at one table only", () => {
    const s = freshSession(6, 100, { ...OPTS, pot: "srp", hand: "m:set" });
    expect(toRecord(s).meta.hand).toBe("m:set");
    expect(toRecord(s, 3).meta.hand).toBeUndefined();
    expect(toRecord(freshSession(6, 100, OPTS)).meta).not.toHaveProperty("hand");
    expect(toRecord(freshSession(6, 100, { ...OPTS, hand: "m:set" })).meta).not.toHaveProperty("hand");
  });

  it("keeps a pot-type mode's board filter in its record, at one table only", () => {
    const s = freshSession(6, 100, { ...OPTS, pot: "srp", board: { suits: "mono" } });
    expect(toRecord(s).meta.board).toEqual({ suits: "mono" });
    expect(toRecord(s, 3).meta.board).toBeUndefined();
    expect(toRecord(freshSession(6, 100, OPTS)).meta).not.toHaveProperty("board");
  });

  it("gives two hands dealt alike their own numbers, so their keys and hand histories don't collide", () => {
    const h = newHand(6, 100, 0, 1, OPTS);
    const s = afterDeal(afterDeal(freshSession(6, 100, OPTS)));
    const a = following(h, 7, OPTS, false, s.dealt);
    const b = following(h, 7, OPTS, false, afterDeal(s).dealt);
    expect(a.hands).toEqual(b.hands);
    expect(keyOf(s, a)).not.toBe(keyOf(s, b));
    expect(practiceNumber(a, s.startedAt)).not.toBe(practiceNumber(b, s.startedAt));
  });

  it("isn't moved by a drill's hand dealt again: the same hand, under the same number", () => {
    const s = afterDeal(freshSession(6, 100, { ...OPTS, pot: "srp" }));
    const h = newHand(6, 100, 0, 1, s.opts);
    expect(redeal(h, 2, s.opts).n).toBe(h.n);
    expect(s.dealt).toBe(1);
  });
});

describe("where a decision is kept", () => {
  const cells = (s: ReturnType<typeof freshSession>) => Object.values(s.cells ?? {}).map((c) => [c.street, c.seat, c.pot, c.n]);
  const at = (h: PracticeHand, street: Decision["street"] = "preflop") => cells(afterDecision(freshSession(6, 100, OPTS), h, { ...dec(grade(), "live"), street }));

  it("takes the seat from the hand, whatever the session's setting, each table's its own", () => {
    const a = newHand(6, 100, 0, 1);
    const b = newHand(6, 100, 1, 2);
    expect(a.hero).not.toBe(b.hero);
    let s = freshSession(6, 100, { ...OPTS, seat: "moves" });
    s = afterDecision(s, a, dec(grade(), "live"), 1);
    s = afterDecision(s, b, dec(grade(), "live"), 2);
    s = afterDecision(s, a, dec(grade(), "live"), 1);
    expect(cells(s)).toEqual([
      ["preflop", a.hero, "Unopened", 2],
      ["preflop", b.hero, "Unopened", 1],
    ]);
    expect(cells(afterDecision(freshSession(6, 100, { ...OPTS, seat: "BB" }), a, dec(grade(), "live")))[0]![1]).toBe(a.hero);
  });

  it("names the pot as it stood when you decided, your own move not in it", () => {
    const h = newHand(6, 100, 0, 1);
    expect(h.hero).toBe("BTN");
    const before = (ms: Move[]) => at(played(h, ms))[0]![2];
    // first in, your open not yet made
    expect(before([mv("UTG", "fold"), mv("HJ", "fold"), mv("CO", "fold")])).toBe("Unopened");
    // a limper ahead
    expect(before([mv("UTG", "call"), mv("HJ", "fold"), mv("CO", "fold")])).toBe("Limped");
    // facing an open, and facing a 3-bet
    expect(before([mv("UTG", "raise", 2.5), mv("HJ", "fold"), mv("CO", "fold")])).toBe("SRP");
    expect(before([mv("UTG", "raise", 2.5), mv("HJ", "raise", 8), mv("CO", "fold")])).toBe("3bet pot");
    expect(before([mv("UTG", "raise", 2.5), mv("HJ", "raise", 8), mv("CO", "raise", 20)])).toBe("4bet+ pot");
  });

  it("names a postflop decision by the pot the preflop made, as the hand's own pot is", () => {
    const h = { ...played(newHand(6, 100, 0, 1), SRP), shown: 3 };
    expect(at(h, "flop")).toEqual([["flop", "BTN", "SRP", 1]]);
    expect(handPot(h.lines.preflop, simOf(h))).toBe("SRP");
  });

  it("keeps an ungraded decision out, and leaves a cell kept before seats and pots as it was", () => {
    const h = newHand(6, 100, 0, 1);
    expect(cells(afterDecision(freshSession(6, 100, OPTS), h, dec(null)))).toEqual([]);
    const old = { street: "preflop", source: "live", byEv: true, n: 2, ok: 1, loss: 0, lossPct: 0 };
    const s = afterDecision({ ...freshSession(6, 100, OPTS), cells: { "preflop|live|ev": old } }, h, dec(grade(), "live"));
    expect(s.cells?.["preflop|live|ev"]).toEqual(old);
    expect(cells(s)).toEqual([
      ["preflop", undefined, undefined, 2],
      ["preflop", "BTN", "Unopened", 1],
    ]);
  });
});

describe("History's record", () => {
  const session = (opts: Partial<Required<HandOptions>>) => {
    let s = freshSession(6, 100, { ...OPTS, ...opts });
    s = afterDecision(s, newHand(6, 100, 0, 1), dec(grade({ loss: 0.2, lossPct: 4 }), "live"));
    return afterHand(s, played(newHand(6, 100, 0, 1), SRP), won(1));
  };

  it("keeps one table's session as it always has", () => {
    const s = session({ seat: "BTN", pot: "srp", ante: 0.5, straddle: true, sizes: { flop: [33] }, rake: 5, rakeCap: 3 });
    expect(toRecord(s)).toEqual({
      id: s.id,
      kind: "practice",
      startedAt: s.startedAt,
      endedAt: expect.any(Number),
      decisions: 1,
      evLossBb: 0.2,
      meta: {
        hands: 1,
        net: 1,
        ok: 1,
        graded: 1,
        lossPct: 4,
        players: 6,
        stack: 100,
        seat: "BTN",
        pot: "srp",
        ante: 0.5,
        straddle: true,
        sizes: { flop: [33] },
        rake: 5,
        rakeCap: 3,
        byPot: s.byPot,
        sources: { live: 1 },
        cells: { "preflop|live|ev|BTN|Unopened": { street: "preflop", source: "live", byEv: true, seat: "BTN", pot: "Unopened", n: 1, ok: 1, loss: 0.2, lossPct: 4, versions: { "build:test": 1 } } },
      },
    });
    expect(toRecord(session({ carry: true })).meta).toMatchObject({ seat: "moves", carry: true });
    expect(toRecord(session({ preflopOnly: true })).meta).toMatchObject({ preflopOnly: true });
  });

  it("says the tables only above one, and leaves out the seat, pot and carry they didn't deal by", () => {
    const one = session({ carry: true });
    expect(toRecord(one).meta).not.toHaveProperty("tables");
    expect(toRecord(one, 1).meta).not.toHaveProperty("tables");

    const many = toRecord(session({ carry: true }), 2).meta;
    expect(many).toMatchObject({ tables: 2, players: 6, stack: 100, hands: 1 });
    expect(many).not.toHaveProperty("seat");
    expect(many).not.toHaveProperty("carry");
    const drill = toRecord(session({ pot: "srp", ante: 0.5 }), 4).meta;
    expect(drill).toMatchObject({ tables: 4, ante: 0.5 });
    expect(drill).not.toHaveProperty("pot");
  });

  it("holds the most tables played, for the record, also once there are fewer", () => {
    const s = freshSession(6, 100);
    expect(s.tables).toBe(1);
    const four = atTables(s, 4);
    expect(four.tables).toBe(4);
    expect(atTables(four, 1)).toBe(four);
    expect(atTables(four, 2)).toBe(four);
  });
});
