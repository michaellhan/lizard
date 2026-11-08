// @vitest-environment node
// Live drills: what's dealt from a stored turn file, on entries of the solver snapshot's library, and which answers can
// grade it, the provenance said in words.
import { describe, expect, it } from "vitest";
import { readMistake } from "@/data/mistakes";
import { cellsOf } from "@/features/history/progress";
import { linePot, POT_ORDER, rowOf } from "@/features/history/history";
import { spotKey } from "@/features/review/mistakes";
import { madeCategory } from "@/features/study/categories";
import { fromSearch } from "@/features/study/studyState";
import { emptyScore } from "@/grading/grade";
import { cardInt, COMBOS, decodeEntry, flopCards, SUITS, type LibraryRanges } from "@/library/entry";
import type { LibraryReport } from "@/library/files";
import { decodeTurns, type TurnFile } from "@/library/turns";
import { seeded } from "@/poker/table";
import type { AdvisorResponse } from "@/solver/protocol";
import { describe as describeProvenance, provenanceOf, sourceOf } from "@/solver/provenance";
import { libFile, libJson } from "@/test/library";
import { liveDrillText } from "./copyForAi";
import { lineReach } from "./drills";
import { handTest } from "./handFilter";
import { liveHint } from "./hint";
import {
  afterLive,
  flopMoves,
  freshLiveSession,
  gradeLive,
  isLiveTurnView,
  isRiverView,
  liveActionLabel,
  liveMistake,
  liveMode,
  liveProblem,
  liveDrillKey,
  liveRecord,
  liveRefusal,
  liveStudyLink,
  liveViewLabel,
  RARE_LINE,
  readLive,
  treeBet,
  type LiveAnswer,
  type LiveProblem,
} from "./liveDeal";

const SID = "srp_btn_bb";
const report = (sid: string) => libJson<LibraryReport>(`${sid}/report.json`);
const ranges = (sid: string) => libJson<LibraryRanges>(`${sid}/ranges.json`);
const load = (sid: string, f: string) => decodeEntry(libFile(`${sid}/${f}.bin`));
const loadTurns = (sid: string, f: string) => decodeTurns(libFile(`${sid}/${f}.turn.bin`));
const FLOP = "Ac4d3h";
const rep = report(SID);
const rg = ranges(SID);
const T = await loadTurns(SID, FLOP);
const E0 = await load(SID, FLOP);
const unshown = (c: string, perm: readonly number[]) => c[0]! + SUITS[perm.indexOf(SUITS.indexOf(c[1]!))]!;
/** a copy to change frequencies on */
const copy = (t: TurnFile): TurnFile => structuredClone(t);
const lineOf = (pr: LiveProblem, t: TurnFile) => t.lines.find((l) => l.path.join() === pr.path.join())!;
const ctx = { mode: "fast" as const, transport: "worker" as const, solverVersion: "9b907bd6/abc", partial: false, now: 1 };
const LIVE: AdvisorResponse = {
  street: "river",
  pot_bb: 16.5,
  to_call_bb: 4.13,
  actions: [
    { action: "fold", freq: 0.02, ev_bb: 0 },
    { action: "call", freq: 0.98, ev_bb: 2.5, amount_bb: 4 },
    { action: "raise to 21", freq: 0, ev_bb: -1, amount_bb: 21, rough_ev: true },
  ],
  solver: { iterations: 111, exploitability_pct: 0.63 },
  off_solution: [],
  widened: [],
  hero_range_combos: 40,
  villain_range_combos: 30,
};
const res = (over: Partial<AdvisorResponse> = {}, partial = false) => {
  const data = { ...LIVE, ...over };
  return { data, provenance: provenanceOf(data, { ...ctx, partial }) };
};
const answered = (over: Partial<AdvisorResponse> = {}): LiveAnswer => {
  const r = readLive(res(over), { pot: 9, bet: 3 });
  if (r.st !== "answer") throw new Error(r.words);
  return r.answer;
};

describe("what a live drill says it is", () => {
  it("names its decisions apart from the stored ones, so an older link still means the stored turn", () => {
    expect(liveViewLabel("turn", "checkfaces", rep.seats)).toBe("BB checks the turn, faces a bet");
    expect(liveViewLabel("turn", "ipfaces", rep.seats)).toBe("BTN faces BB's turn bet");
    expect(liveViewLabel("river", "oop", rep.seats)).toBe("BB first to act on the river");
    expect(liveViewLabel("river", "ip", rep.seats)).toBe("BTN after BB checks the river");
    for (const old of ["oop", "ip", "vsbet", "ipvsbet", null]) expect(isLiveTurnView(old)).toBe(false);
    expect(isRiverView("vsbet")).toBe(false);
    expect(isRiverView("ip")).toBe(true);
  });

  it("asks for Fast at least: a Quick solve's earlier streets are the rules'", () => {
    expect(liveMode("quick")).toBe("fast");
    expect(liveMode("fast")).toBe("fast");
    expect(liveMode("accurate")).toBe("accurate");
  });
});

describe("the moves of a stored line", () => {
  it("are the tree's chips, to the half big blind, adding up to the pot stored for every line", async () => {
    expect(treeBet(0.33, 5.5)).toBe(2);
    expect(treeBet(0.75, 5.5)).toBe(4);
    expect(treeBet(0.1, 2)).toBe(1);
    // (solver.py's round goes half to the even: 75% of 35bb is 26bb in the tree, 75% of 33bb is 25bb, 75% of 37bb 28bb)
    expect(treeBet(0.75, 35)).toBe(26);
    expect(treeBet(0.75, 33)).toBe(25);
    expect(treeBet(0.75, 37)).toBe(28);
    expect(treeBet(0.75, 7)).toBe(5);
    expect(treeBet(0.75, 9)).toBe(7);
    for (const [sid, f] of [[SID, FLOP], ["3bp_bb_btn", "2h2d2c"]] as const) {
      const r = report(sid);
      for (const line of (await loadTurns(sid, f)).lines) {
        const moves = flopMoves(r, line.path)!;
        expect(moves.map((m) => m.pos)).toEqual(line.path.map((_, i) => r.seats[i % 2]));
        const street: Record<string, number> = {};
        for (const m of moves) street[m.pos] = m.action === "call" ? Math.max(...Object.values(street)) : (m.to ?? 0);
        expect(r.pot + Object.values(street).reduce((a, b) => a + b, 0)).toBeCloseTo(line.pot, 6);
      }
    }
    expect(flopMoves(rep, ["check", "all-in"])).toBeNull();
  });
});

describe("a deal facing a turn bet", () => {
  const e = E0;
  const t = T;

  it("is a stored line, turn card and bet, out of position after checking, with a hand that gets there", () => {
    const r = seeded(5);
    for (let i = 0; i < 40; i++) {
      const pr = liveProblem(rep, e, t, "turn", "checkfaces", rg, r)!;
      const line = lineOf(pr, t);
      expect(pr).toMatchObject({ street: "turn", view: "checkfaces", player: 0, hero: "BB", bet: treeBet(0.75, line.pot), pot: line.pot + treeBet(0.75, line.pot) });
      expect(pr.moves.turn).toEqual([{ pos: "BB", action: "check" }, { pos: "BTN", action: "bet", to: pr.bet }]);
      expect(pr.moves.river).toEqual([]);
      expect(pr.board).toHaveLength(4);
      expect(new Set([...pr.board, ...pr.hand]).size).toBe(6);
      // the shown cards are one relabelling of the stored flop and played turn card, and it's those that are asked about
      expect(pr.board.map((c) => unshown(c, pr.perm))).toEqual([...flopCards(FLOP), pr.cards[0]]);
      expect(t.played).toContain(cardInt(pr.cards[0]!));
      expect(pr.state).toMatchObject({ players: 6, hero: "BB", stack: 100, hole: pr.hand.join(""), board: pr.board.join(""), flop: pr.moves.flop, turn: pr.moves.turn, river: [] });
      expect(pr.state.preflop!.at(-1)).toEqual({ pos: "BB", action: "call" });
      // on the line, with some of its own checks
      const k = t.played.indexOf(cardInt(pr.cards[0]!));
      const node = line.nodes.find((n) => n.at.length === 0)!;
      const ci = COMBOS.findIndex(([a, b]) => a === pr.combo[0] && b === pr.combo[1]);
      const j = node.classes[k]!.combos.indexOf(ci);
      expect(j).toBeGreaterThanOrEqual(0);
      expect(node.classes[k]!.strat[node.names.indexOf("check")]![j]!).toBeGreaterThan(0);
      expect(lineReach(e, line.path, 0, rg)!.get(ci)!).toBeGreaterThan(0);
    }
  });

  it("says the spot and the price from the table's chips", () => {
    const pr = liveProblem(rep, e, t, "turn", "checkfaces", rg, seeded(5))!;
    expect(pr.words).toMatch(/^On the flop .*\. BB checks the turn, BTN bets 75% \(\d+(\.\d+)?bb\) · pot \d+(\.\d+)?bb$/);
    expect(liveHint(pr)).toMatch(/^Turn, heads-up, BB out of position\. A call is \d+(\.\d+)?bb to win \d+(\.\d+)?bb: pot odds of /);
    expect(liveHint({ ...pr, street: "river", bet: 0 })).toBe(`River, heads-up, BB out of position. Nothing to call: the pot is ${pr.pot}bb.`);
  });

  it("in position, it's the first bet of the turn", () => {
    const r = seeded(7);
    for (let i = 0; i < 20; i++) {
      const pr = liveProblem(rep, e, t, "turn", "ipfaces", rg, r)!;
      expect(pr).toMatchObject({ player: 1, hero: "BTN" });
      expect(pr.moves.turn).toEqual([{ pos: "BB", action: "bet", to: pr.bet }]);
      expect(pr.words).toMatch(/BB bets 75% \(.*bb\) on the turn · pot/);
    }
  });

  it("draws a bet by how often it's made, and never one the opponent rarely makes", () => {
    // every hand of one class bets `at`, on one line and class only, the rest never: nothing else can be dealt
    const only = (at: number) => {
      const c = copy(t);
      c.lines.forEach((l, li) =>
        l.nodes.filter((n) => n.at.join() === "check").forEach((n) => {
          const b = n.names.indexOf("bet 75%");
          n.classes.forEach((cl, k) => cl.strat[b]!.forEach((_, j) => {
            const x = li === 0 && k === 0 ? at : 0;
            cl.strat[b]![j] = x;
            cl.strat[1 - b]![j] = 1 - x;
          }));
        }),
      );
      return c;
    };
    expect(liveProblem(rep, e, only(RARE_LINE - 0.01), "turn", "checkfaces", rg, seeded(1))).toBeNull();
    const pr = liveProblem(rep, e, only(RARE_LINE), "turn", "checkfaces", rg, seeded(1))!;
    expect(pr.path).toEqual(t.lines[0]!.path);
    expect(pr.cards[0]).toBe(lineCard(t, 0));

    // two classes of a line, one betting four times as often as the other: dealt four to one
    const c = only(0);
    const nodes = c.lines[0]!.nodes.find((n) => n.at.join() === "check")!;
    const b = nodes.names.indexOf("bet 75%");
    nodes.classes[0]!.strat[b] = nodes.classes[0]!.strat[b]!.map(() => 0.8);
    nodes.classes[1]!.strat[b] = nodes.classes[1]!.strat[b]!.map(() => 0.2);
    const sized = { ...c, sizes: c.sizes.map(() => 1) };
    const r = seeded(3);
    const seen = [0, 0];
    for (let i = 0; i < 1200; i++) seen[liveProblem(rep, e, sized, "turn", "checkfaces", rg, r)!.cards[0] === lineCard(t, 0) ? 0 : 1]! += 1;
    expect(seen[0]! / seen[1]!).toBeGreaterThan(3.2);
    expect(seen[0]! / seen[1]!).toBeLessThan(4.8);
  });

  it("in position, draws the first bet the same way", () => {
    const leads = (x: number) => {
      const c = copy(t);
      for (const l of c.lines)
        for (const n of l.nodes.filter((m) => m.at.length === 0)) {
          const b = n.names.indexOf("bet 75%");
          for (const cl of n.classes) cl.strat.forEach((row, i) => (cl.strat[i] = row.map(() => (i === b ? x : 1 - x))));
        }
      return c;
    };
    expect(liveProblem(rep, e, leads(RARE_LINE - 0.01), "turn", "ipfaces", rg, seeded(1))).toBeNull();
    expect(liveProblem(rep, e, leads(RARE_LINE), "turn", "ipfaces", rg, seeded(1))).not.toBeNull();
  });

  it("deals your hand by how often it checks to the bet: one that never checks isn't dealt", () => {
    const c = copy(t);
    const first = c.lines[0]!.nodes.find((n) => n.at.length === 0)!;
    const a = first.names.indexOf("check");
    const kept = first.classes[0]!.strat[a]!.map((_, j) => j);
    for (const j of kept.slice(1)) first.classes[0]!.strat[a]![j] = 0;
    const r = seeded(9);
    const combo = COMBOS[first.classes[0]!.combos[0]!]!;
    for (let i = 0; i < 300; i++) {
      const pr = liveProblem(rep, e, c, "turn", "checkfaces", rg, r)!;
      if (pr.path.join() === t.lines[0]!.path.join() && pr.cards[0] === lineCard(t, 0)) expect(pr.combo).toEqual(combo);
    }
  });

  it("skips a line it can't write, and a bet that would be all-in", () => {
    const c = copy(t);
    c.lines = c.lines.map((l) => ({ ...l, path: ["check", "all-in"] }));
    expect(liveProblem(rep, e, c, "turn", "checkfaces", rg, seeded(1))).toBeNull();
    const short = { ...rep, stack: 3 };
    expect(liveProblem(short, e, t, "turn", "checkfaces", rg, seeded(1))).toBeNull();
    expect(liveProblem(short, e, t, "turn", "ipfaces", rg, seeded(1))).toBeNull();
  });

  it("reads a hand filter on the turn's board, and says none where there's none", () => {
    const r = seeded(4);
    for (let i = 0; i < 20; i++) {
      const pr = liveProblem(rep, e, t, "turn", "checkfaces", rg, r, "m:middle")!;
      const board = pr.board.map((c) => cardInt(unshown(c, pr.perm)));
      expect(madeCategory([pr.combo[0], pr.combo[1]], board)).toBe("middle");
    }
    expect(liveProblem(rep, e, t, "turn", "checkfaces", rg, r, "m:flush")).toBeNull();
  });
});

const lineCard = (t: TurnFile, k: number) => {
  const c = t.played[k]!;
  return "23456789TJQKA"[c >> 2]! + "cdhs"[c & 3]!;
};

describe("a deal on the river", () => {
  const e = E0;
  const t = T;

  it("comes after the turn checks through, a card off the deck that isn't in your hand", () => {
    const r = seeded(6);
    const rivers = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const pr = liveProblem(rep, e, t, "river", "oop", rg, r)!;
      expect(pr).toMatchObject({ street: "river", player: 0, hero: "BB", bet: 0, pot: lineOf(pr, t).pot });
      expect(pr.board).toHaveLength(5);
      expect(pr.cards).toHaveLength(2);
      expect(new Set([...pr.board, ...pr.hand]).size).toBe(7);
      expect(pr.moves.turn).toEqual([{ pos: "BB", action: "check" }, { pos: "BTN", action: "check" }]);
      expect(pr.moves.river).toEqual([]);
      expect(pr.board.map((c) => unshown(c, pr.perm))).toEqual([...flopCards(FLOP), ...pr.cards]);
      expect(pr.words).toMatch(/^On the flop .*\. The turn checks through\. BB to act first on the river · pot \d+(\.\d+)?bb$/);
      rivers.add(pr.cards[1]!);
    }
    expect(rivers.size).toBeGreaterThan(30);
  });

  it("in position, it's after the river check", () => {
    const pr = liveProblem(rep, e, t, "river", "ip", rg, seeded(6))!;
    expect(pr).toMatchObject({ player: 1, hero: "BTN" });
    expect(pr.moves.river).toEqual([{ pos: "BB", action: "check" }]);
    expect(pr.words).toMatch(/The turn checks through\. BB checks the river · pot/);
    expect(pr.state.river).toEqual(pr.moves.river);
  });

  it("never comes where the turn wouldn't check through, and only the hands that check get there", () => {
    const c = copy(t);
    for (const l of c.lines.slice(1))
      for (const n of l.nodes) for (const cl of n.classes) cl.strat[n.names.indexOf("check")] = cl.strat[n.names.indexOf("check")]!.map(() => 0);
    const r = seeded(2);
    for (let i = 0; i < 30; i++) expect(liveProblem(rep, e, c, "river", "ip", rg, r)!.path).toEqual(t.lines[0]!.path);
    const none = copy(t);
    for (const l of none.lines) for (const n of l.nodes.filter((x) => x.at.length)) for (const cl of n.classes) cl.strat[n.names.indexOf("check")] = cl.strat[n.names.indexOf("check")]!.map(() => 0);
    expect(liveProblem(rep, e, none, "river", "ip", rg, r)).toBeNull();
    expect(liveProblem(rep, e, none, "river", "oop", rg, r)).toBeNull();
  });

  it("draws a line and card by how often the turn checks through there", () => {
    // one line, two of its classes: both seats check at 0.8 on one, at 0.4 on the other, so four to one by the product
    const c = copy(t);
    c.lines = c.lines.slice(0, 1).map((l) => ({ ...l, share: 1 }));
    c.sizes = c.sizes.map(() => 1);
    for (const n of c.lines[0]!.nodes) {
      const a = n.names.indexOf("check");
      n.classes.forEach((cl, k) => cl.strat.forEach((row, i) => (cl.strat[i] = row.map(() => {
        const x = k === 0 ? 0.8 : k === 1 ? 0.4 : 0;
        return i === a ? x : (1 - x) / (n.names.length - 1);
      }))));
    }
    const r = seeded(3);
    const seen = [0, 0];
    for (let i = 0; i < 1200; i++) seen[liveProblem(rep, e, c, "river", "oop", rg, r)!.cards[0] === lineCard(t, 0) ? 0 : 1]! += 1;
    expect(seen[0]! / seen[1]!).toBeGreaterThan(3.2);
    expect(seen[0]! / seen[1]!).toBeLessThan(4.8);
  });

  it("isn't dealt where the opponent's check is rare, your own check not counting", () => {
    const checking = (at: string, x: number) => {
      const c = copy(t);
      for (const l of c.lines)
        for (const n of l.nodes.filter((m) => m.at.join() === at)) {
          const a = n.names.indexOf("check");
          for (const cl of n.classes) cl.strat.forEach((row, i) => (cl.strat[i] = row.map(() => (i === a ? x : (1 - x) / (n.names.length - 1)))));
        }
      return c;
    };
    const r = seeded(2);
    expect(liveProblem(rep, e, checking("", RARE_LINE - 0.01), "river", "ip", rg, r)).toBeNull();
    expect(liveProblem(rep, e, checking("", RARE_LINE - 0.01), "river", "oop", rg, r)).not.toBeNull();
    expect(liveProblem(rep, e, checking("", RARE_LINE), "river", "ip", rg, r)).not.toBeNull();
    expect(liveProblem(rep, e, checking("check", RARE_LINE - 0.01), "river", "oop", rg, r)).toBeNull();
    expect(liveProblem(rep, e, checking("check", RARE_LINE - 0.01), "river", "ip", rg, r)).not.toBeNull();
  });

  it("reads a hand filter on all five cards; a draw is nothing on a river", () => {
    const r = seeded(8);
    for (let i = 0; i < 15; i++) {
      const pr = liveProblem(rep, e, t, "river", "oop", rg, r, "m:two_pair")!;
      expect(madeCategory([pr.combo[0], pr.combo[1]], pr.board.map((c) => cardInt(unshown(c, pr.perm))))).toBe("two_pair");
    }
    expect(liveProblem(rep, e, t, "river", "oop", rg, r, "d:gutshot")).toBeNull();
    expect(handTest("d:gutshot", [0, 5, 10, 15, 20])(30, 40)).toBe(false);
  });

  it("keeps a spot's own game in what it asks", () => {
    const heads = { ...rep, game: { players: 2, stack: 40, ante: 0.5, straddle: true } };
    const pr = liveProblem(heads, e, t, "river", "oop", rg, seeded(1))!;
    expect(pr.state).toMatchObject({ players: 2, stack: 40, ante: 0.5, straddle: true });
    expect(liveProblem(rep, e, t, "river", "oop", rg, seeded(1))!.state).not.toHaveProperty("ante");
  });
});

describe("the same spot in Study", () => {
  it("is the line to the decision, the board out", () => {
    const pr = liveProblem(rep, E0, T, "river", "ip", rg, seeded(6))!;
    const h = fromSearch(liveStudyLink(rep, pr)!.replace(/^\/study\?/, ""))!;
    expect(h).toMatchObject({ players: 6, stack: 100, board: pr.board.join("") });
    expect(h.flop).toEqual(pr.moves.flop);
    expect(h.turn).toEqual(pr.moves.turn);
    expect(h.river).toEqual(pr.moves.river);
  });
});

describe("what grades a live drill", () => {
  it("takes a live solve, measured, with an EV for every action", () => {
    expect(liveRefusal(res())).toBeNull();
    const a = answered();
    expect(describeProvenance(a.provenance)).toBe("Live solve · 0.63% pot from equilibrium in the solved game (converged) · 111 iterations");
    expect(a).toMatchObject({ pot: 16.5, toCall: 4.13, off: null, capped: false });
    expect(a.mix.map((x) => x.ev)).toEqual([0, 2.5, -1]);
  });

  it.each([
    ["the betting rules", { fallback: "rules", solver: undefined }, /^This answer is from Heuristic rules \(not a solve\), not a live solve of this spot, so it isn't graded here\.$/],
    ["an equity estimate", { fallback: "equity", solver: undefined }, /^This answer is from Equity estimate \(not a solve\), not a live solve/],
    ["the charts", { street: "preflop", solver: undefined }, /^This answer is from Preflop charts.*not a live solve/],
    ["a stored flop", { precomputed: { spot: "srp_btn_bb" } }, /not a live solve/],
    ["an error", { error: "no such node" }, /^The solver couldn't answer this spot: no such node$/],
    ["a skip", { skipped: "too deep" }, /^The solver skipped this spot: too deep$/],
    ["no actions", { actions: [] }, /no actions/],
    ["an action with no EV", { actions: [{ action: "check", freq: 1, ev_bb: 1 }, { action: "bet 75%", freq: 0 }] }, /no EV for every action/],
    ["no measured distance", { solver: { iterations: 40 } }, /measured no distance/],
    ["a rough solve", { solver: { iterations: 40, exploitability_pct: 12.5 } }, /^The solve stopped 12\.5% of the pot from equilibrium, too far to grade on\.$/],
    ["a rough solve that also reads as approximate, as these do past ten times their target", { solver: { iterations: 40, exploitability_pct: 25, approximate: true, target_pct: 0.3 } }, /^The solve stopped 25\.0% of the pot from equilibrium, too/],
    ["an earlier street from the rules", { off_solution: [{ street: "turn", pos: "BTN", why: "rules" }] }, /^This spot leans on the betting rules, so it isn't graded here: the turn is narrowed by the betting rules, not solved\.$/],
    ["an unresolved rare line", { off_solution: [{ street: "flop", pos: "BTN", why: "rare", action: "check", share: 0 }] }, /BTN's check on the flop is never in the solve/],
    ["a widened range", { widened: ["BTN"] }, /an opponent's range comes from them/],
    ["an empty range", { hero_range_combos: 0 }, /Almost no hands/],
    ["no opposing range", { villain_range_combos: 0.04 }, /Almost no hands/],
  ] as [string, Partial<AdvisorResponse>, RegExp][])("refuses %s, in words", (_, over, words) => {
    const said = liveRefusal(res(over))!;
    expect(said).toMatch(words);
    expect(said).not.toMatch(/a solved answer/);
    expect(readLive(res(over), { pot: 9, bet: 0 })).toEqual({ st: "refused", words: said });
  });

  it("refuses a solve cut short", () => {
    expect(liveRefusal(res({}, true))).toBe("The solve was cut short, so this spot isn't graded.");
  });

  it("says what's off a resolved line or a filled range, and caps its grade", () => {
    const a = answered({ off_solution: [{ street: "preflop", pos: "BTN", why: "filled" }] });
    expect(a.off).toBe("BTN's preflop line isn't in the charts, so their range is the hands that take its last action");
    expect(a.capped).toBe(true);
    expect(gradeLive(a, 0)).toMatchObject({ verdict: "Inaccuracy", capped: true, loss: 2.5 });
    const rare = answered({ off_solution: [{ street: "flop", pos: "BTN", why: "rare", action: "check", share: 3, resolved: true }] });
    expect(rare.off).toContain("solved again from there");
    expect(rare.capped).toBe(true);
    expect(answered({ solver: { iterations: 80, exploitability_pct: 1, approximate: true } }).capped).toBe(true);
  });

  it("grades on the one scale: EV lost in % of the answer's pot, uncapped on a clean solve", () => {
    const a = answered();
    expect(gradeLive(a, 1)).toMatchObject({ verdict: "Best", byEv: true, loss: 0 });
    const g = gradeLive(a, 0);
    expect(g).toMatchObject({ byEv: true, loss: 2.5 });
    expect(g.lossPct).toBeCloseTo((2.5 / 16.5) * 100, 5);
    expect(g.verdict).toBe("Blunder");
    expect(g.capped).toBeUndefined();
    expect(sourceOf(res().data)).toBe("live");
  });

  it("falls back to the deal's chips only where the answer has none", () => {
    const a = readLive(res({ pot_bb: undefined, to_call_bb: undefined }), { pot: 9, bet: 3 });
    expect(a).toMatchObject({ st: "answer", answer: { pot: 9, toCall: 3 } });
  });

  it("labels a call by what it costs and a bet by its chips", () => {
    const a = answered();
    expect(a.mix.map((x) => liveActionLabel(a, x))).toEqual(["fold", "call 4.13bb", "raise to 21"]);
    const b = answered({ actions: [{ action: "bet 75%", freq: 1, ev_bb: 1, amount_bb: 7 }] });
    expect(liveActionLabel(b, b.mix[0]!)).toBe("bet 75% (7bb)");
  });
});

describe("what's kept", () => {
  const pr = liveProblem(rep, E0, T, "river", "oop", rg, seeded(6))!;
  const a = answered();

  it("History reads the session as live solves, never as the stored library", () => {
    const g = gradeLive(a, 0);
    let s = freshLiveSession();
    s = afterLive(s, pr, g, a.provenance);
    s = afterLive(s, pr, gradeLive(a, 1), a.provenance);
    const rec = liveRecord(s, rep, "BB");
    expect(rec).toMatchObject({ kind: "practice", decisions: 2 });
    expect(rec.meta.liveDrill).toBeUndefined();
    expect(liveRecord(s, rep, "BB", liveDrillKey("srp_btn_bb", "river", "oop")).meta.liveDrill).toBe("srp_btn_bb|river|oop");
    const row = rowOf(rec);
    expect(row.graded).toBe("Live solve 2");
    expect(row.what).toBe("6 players · 100bb · seat BB");
    expect(cellsOf(rec)).toEqual([expect.objectContaining({ street: "river", source: "live", byEv: true, n: 2 })]);
    expect(s.sources).toEqual({ live: 2 });
    expect(emptyScore().n).toBe(0);
  });

  it("keeps the seat you held and the spot's pot with each decision", () => {
    const p = liveProblem(rep, E0, T, "river", "ip", rg, seeded(6))!;
    expect(rep.line).toMatch(/:r/);
    const both = [pr, p].reduce((s, x) => afterLive(s, x, gradeLive(a, 0), a.provenance), freshLiveSession());
    expect(cellsOf(liveRecord(both, rep, "BB"))?.map((c) => [c.seat, c.pot, c.n])).toEqual([
      [pr.hero, linePot(pr.state.preflop!), 1],
      [p.hero, linePot(pr.state.preflop!), 1],
    ]);
    expect(pr.hero).not.toBe(p.hero);
    expect(POT_ORDER).toContain(linePot(pr.state.preflop!));
  });

  it("a miss is a mistake asked again through the solver, one a spot, and a kept record that reads back", () => {
    const g = gradeLive(a, 0);
    const m = liveMistake("s1", rep, pr, a, g, 1000)!;
    expect(m).toMatchObject({ from: "drill", street: "river", seat: "BB", chose: "fold", pot: 16.5, line: pr.words, ask: { via: "solver", state: pr.state }, grade: { verdict: "Blunder", byEv: true } });
    expect(m.study).toBe(liveStudyLink(rep, pr)!.replace(/^\/study\?/, ""));
    expect(m.provenance).toEqual(a.provenance);
    expect(readMistake(m)).not.toBeNull();
    expect(spotKey(m)).toBeNull();
    expect(liveMistake("s1", rep, { ...pr, cards: [pr.cards[0]!, "Xx"] }, a, g, 1000)!.id).not.toBe(m.id);
    expect(liveMistake("s1", rep, pr, a, gradeLive(a, 1), 1000)).toBeNull();
  });

  it("Copy for AI names the live solve and all five cards", () => {
    const text = liveDrillText(rep, pr, gradeLive(a, 0), a);
    expect(text).toContain(`Board: ${pr.board.join(" ")}`);
    expect(text).toContain(`Decision: river, ${pr.words}`);
    expect(text).toContain("You took: fold.");
    expect(text).toContain("call 4.13bb");
    expect(text).toContain("Live solve");
    expect(text).not.toMatch(/library/i);
  });
});
