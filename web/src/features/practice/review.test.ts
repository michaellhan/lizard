// Review mistakes (review.ts): your graded decisions kept with their spots, the costliest picked out.
import { describe, expect, it } from "vitest";
import type { Grade, Verdict } from "@/grading/grade";
import { noLines, type Move } from "@/poker/table";
import { withVillain, type Decision, type PracticeHand } from "./practice";
import { mistakes, RECENT, recent, REVIEW_KEEP, REVIEW_SHOW, reviewed, withReviewed, type Reviewed } from "./review";

function fixed(players: number, hero: string, hands: Record<string, string>, board: string): PracticeHand {
  return {
    seed: 0,
    n: 0,
    players,
    stack: 100,
    hero,
    hands: Object.fromEntries(Object.entries(hands).map(([p, c]) => [p, [c.slice(0, 2), c.slice(2, 4)] as [string, string]])),
    board: board.match(/../g)!,
    shown: 0,
    lines: noLines(),
    decisions: [],
    result: null,
  };
}

// a decision you took (the mix's second action, or the first where `best`), graded as given
function dec(verdict: Verdict | null, loss = 0, freq = 0.2, street: Decision["street"] = "flop"): Decision {
  const grade: Grade | null = verdict && {
    a: verdict === "Best" ? 0 : 1,
    best: 0,
    verdict,
    ok: verdict === "Best" || verdict === "Correct",
    mixed: false,
    loss,
    lossPct: loss * 10,
    byEv: street !== "preflop",
  };
  return {
    street,
    chose: "check",
    move: { pos: "BB", action: "check" },
    grade,
    mix: [
      { action: "bet 33%", freq: 1 - freq, ev: 1 },
      { action: "check", freq, ev: 1 - loss },
    ],
    pot: 10,
    provenance: null,
    study: "",
  };
}
const entry = (d: Decision, n = 1): Reviewed => ({ n, seat: "BB", players: 2, hole: ["Ah", "Kd"], board: [], line: "first to act", d });

describe("Review mistakes", () => {
  it("keeps a decision with its spot: your seat and cards, the board out, the street's action before you", () => {
    let h = fixed(6, "BTN", { UTG: "2c3d", HJ: "4c5d", CO: "6c7d", BTN: "AhKd", SB: "8c9d", BB: "TcJd" }, "Ks7d2c9h3s");
    expect(reviewed(h, dec("Best", 0, 0.7, "preflop"), 3)).toMatchObject({ n: 3, seat: "BTN", players: 6, hole: ["Ah", "Kd"], board: [], line: "folded to you" });
    const mv = (pos: string, action: Move["action"], to?: number): Move => ({ pos, action, ...(to !== undefined ? { to } : {}) });
    h = [mv("UTG", "raise", 2.5), mv("HJ", "fold"), mv("CO", "call")].reduce((x, m) => withVillain(x, m), h);
    expect(reviewed(h, dec("Best", 0, 0.7, "preflop"), 3).line).toBe("UTG raises to 2.5, CO calls");
    expect(reviewed(h, dec("Best", 0, 0.7, "preflop"), 3)).not.toHaveProperty("dealtTo");
    expect(reviewed({ ...h, dealtTo: "m:set" }, dec("Best", 0, 0.7, "preflop"), 3).dealtTo).toBe("m:set");
    // on the flop, first to act; then facing a bet after your check
    h = { ...h, shown: 3, lines: { ...h.lines, preflop: [...h.lines.preflop, mv("BTN", "call"), mv("SB", "fold"), mv("BB", "fold")] } };
    const flop = { ...h, lines: { ...h.lines, flop: [mv("UTG", "check"), mv("CO", "bet", 4)] } };
    expect(reviewed(flop, dec("Correct"), 3)).toMatchObject({ board: ["Ks", "7d", "2c"], line: "UTG checks, CO bets 4" });
  });

  it("keeps the last REVIEW_KEEP graded decisions, not the ungraded ones", () => {
    let list: Reviewed[] = [];
    list = withReviewed(list, entry(dec(null)));
    expect(list).toEqual([]);
    for (let n = 1; n <= REVIEW_KEEP + 5; n++) list = withReviewed(list, entry(dec("Best"), n));
    expect(list).toHaveLength(REVIEW_KEEP);
    expect(list[0]!.n).toBe(6);
  });

  it("lists the last RECENT decisions, newest first", () => {
    const list = Array.from({ length: RECENT + 3 }, (_, k) => entry(dec("Best"), k + 1));
    expect(recent(list).map(({ e, i }) => [e.n, i])).toEqual(Array.from({ length: RECENT }, (_, k) => [RECENT + 3 - k, RECENT + 2 - k]));
    expect(recent(list.slice(0, 2)).map(({ e }) => e.n)).toEqual([2, 1]);
  });

  it("picks the costliest: EV given up first, then the rarest in the mix, then the newest; never a best move", () => {
    const list = [
      entry(dec("Best"), 1),
      // in the mix and nothing given up: not a mistake
      entry(dec("Correct", 0, 0.4), 2),
      // in the mix but EV given up: one
      entry(dec("Correct", 0.3, 0.4), 3),
      entry(dec("Blunder", 2), 4),
      entry(dec("Mistake", 0.8), 5),
      // by frequency only (the preflop charts): rarer first
      entry(dec("Mistake", 0, 0.01, "preflop"), 6),
      entry(dec("Inaccuracy", 0, 0.05, "preflop"), 7),
      entry(dec("Inaccuracy", 0, 0.05, "preflop"), 8),
    ];
    expect(mistakes(list).map(({ e }) => e.n)).toEqual([4, 5, 3, 6, 8, 7]);
    expect(mistakes(list).map(({ i }) => i)).toEqual([3, 4, 2, 5, 7, 6]);
    expect(mistakes([...list, entry(dec("Mistake", 0.1), 9)])).toHaveLength(REVIEW_SHOW);
    expect(mistakes(list.slice(0, 2))).toEqual([]);
  });
});
