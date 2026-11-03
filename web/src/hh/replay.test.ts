/// <reference types="node" />
// Imported hands replayed through the table engine: the classic suite's cases (solver/tests/js/hh.test.js "imports
// …" and "a short all-in"), each history's setup, every street's actions and the pot won.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Move, Street } from "@/poker/table";
import { finalSim, importHand } from "./replay";

const HH_DIR = join(process.cwd(), "..", "solver", "tests", "data", "hh");
const HH = (f: string) => readFileSync(join(HH_DIR, /\.\w+$/.test(f) ? f : f + ".txt"), "utf8");
// "UTG f, HJ f, CO a, BTN c" -> moves (the classic suites' acts())
const acts = (s: string): Move[] =>
  s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const [pos = "", a = ""] = t.split(/\s+/);
      const action = ({ f: "fold", x: "check", c: "call", a: "all-in", r: "raise", b: "bet" } as Record<string, Move["action"]>)[a[0] ?? ""]!;
      return action === "raise" || action === "bet" ? { pos, action, to: parseFloat(a.slice(1)) } : { pos, action };
    });

interface Case {
  players: number;
  hero: string;
  stack: number;
  /** the seats whose stacks aren't the hero's */
  stacks?: Record<string, number>;
  ante?: number;
  straddle?: boolean;
  cards: (string | null)[];
  preflop: string;
  flop: string;
  turn: string;
  river: string;
  /** the pot won, as the history's "Total pot": a bet nobody called goes back */
  pot: number;
}
// (the classic suite's CASES, as they are there)
const CASES: Record<string, Case> = {
  stars_6max_srp: { players: 6, hero: "BTN", stack: 100, cards: ["Ah", "Qd", "Qs", "8d", "3c", "7h", "2s"],
    preflop: "UTG f, HJ f, CO f, BTN r2.5, SB f, BB c", flop: "BB x, BTN b1.8, BB c", turn: "BB x, BTN b6.1, BB c", river: "BB x, BTN b14.5, BB f", pot: 2.5 + 2.5 + 0.5 + 3.6 + 12.2 },
  stars_3bet_pot: { players: 5, hero: "BB", stack: 120, stacks: { HJ: 100, CO: 100, BTN: 156.2, SB: 94 }, cards: ["Ac", "Kh", "Kd", "9c", "4h", "2s", "7c"],
    preflop: "HJ f, CO r2.5, BTN f, SB f, BB r11, CO c", flop: "BB b7, CO r22, BB c", turn: "BB x, CO a, BB c", river: "", pot: 200.5 },
  gg_limped_multiway: { players: 6, hero: "BB", stack: 100, cards: ["7s", "6s", "Ts", "8h", "2s", "Kd", null],
    preflop: "UTG c, HJ f, CO c, BTN f, SB c, BB x", flop: "SB x, BB x, UTG b2, CO f, SB c, BB r10.5, UTG f, SB c", turn: "SB x, BB b16, SB f", river: "", pot: 4 + 2 + 21 },
  gg_allin_preflop: { players: 6, hero: "SB", stack: 124, cards: ["Ks", "Kh", "Jd", "5c", "2h", "9s", "Kc"],
    preflop: "UTG f, HJ r2.5, CO f, BTN r7.5, SB r18, BB f, HJ f, BTN a, SB c", flop: "", turn: "", river: "", pot: 201 + 2.5 },
  stars_9max_mtt_ante: { players: 9, hero: "CO", stack: 80, ante: 0.1, cards: ["Ah", "Td", "Ac", "9h", "9d", "5s", "Qh"],
    preflop: "UTG f, UTG1 f, UTG2 f, LJ r2.2, HJ f, CO c, BTN f, SB f, BB c", flop: "BB x, LJ b2, CO c, BB f", turn: "LJ x, CO b5, LJ c", river: "LJ x, CO x", pot: 22 },
  stars_heads_up: { players: 2, hero: "BB", stack: 100, cards: ["9c", "9d", "Ts", "8s", "2c", "4h", "3d"],
    preflop: "SB r2.5, BB r9, SB c", flop: "BB x, SB b6, BB c", turn: "BB x, SB x", river: "BB b20, SB f", pot: 30 },
  gg_straddle: { players: 6, hero: "BB", stack: 124, straddle: true, cards: ["Jc", "Jd", "8c", "4d", "2s", "Ah", null],
    preflop: "HJ f, CO r7, BTN f, SB f, BB r26, UTG f, CO c", flop: "BB b17.5, CO c", turn: "BB x, CO b39, BB f", river: "", pot: 26 + 26 + 0.5 + 2 + 35 },
  stars_zoom_names: { players: 6, hero: "UTG", stack: 128, cards: ["Td", "Tc", "9s", "4c", "2d", "Kh", null],
    preflop: "UTG r2.6, HJ f, CO r9, BTN f, SB f, BB f, UTG c", flop: "UTG x, CO b6, UTG c", turn: "UTG x, CO a, UTG f", river: "", pot: 19.5 + 12 },
  gg_run_twice_cashout: { players: 6, hero: "HJ", stack: 100, stacks: { CO: 90, BTN: 125, BB: 45 }, cards: ["Ah", "Ad", "2c", "7d", "9s", "Jh", "Kd"],
    preflop: "UTG f, HJ r2.5, CO f, BTN r8.5, SB f, BB a, HJ a, BTN c", flop: "", turn: "", river: "", pot: 245.5 },
  stars_run_twice: { players: 4, hero: "BTN", stack: 100, cards: ["As", "Ks", "Kd", "8s", "3s", "2h", "9c"],
    preflop: "CO r2.5, BTN r7.5, SB f, BB f, CO c", flop: "CO x, BTN b5, CO a, BTN c", turn: "", river: "", pot: 201.5 },
  gg_all_cards_shown: { players: 4, hero: "SB", stack: 100, cards: ["Ks", "Kh", "Jd", "5c", "2h", null, null],
    preflop: "CO f, BTN f, SB r3, BB c", flop: "SB b2, BB f", turn: "", river: "", pot: 6 },
  stars_bounty_allin: { players: 5, hero: "BB", stack: 50, ante: 0.12, cards: ["Jh", "Js", "3d", "5h", "9c", "Td", "Ad"],
    preflop: "HJ f, CO a, BTN f, SB f, BB c", flop: "", turn: "", river: "", pot: 50.86 },
};
// the other sites: the same hands in each site's format become the same hand
const SAME: Record<string, string> = {
  "888_6max_srp": "stars_6max_srp", ignition_6max_srp: "stars_6max_srp", "888_9max_mtt_ante": "stars_9max_mtt_ante",
  winamax_mtt_ante: "stars_9max_mtt_ante", acr_9max_mtt_ante: "stars_9max_mtt_ante", party_6max_allin: "gg_allin_preflop",
  party_mtt_bounty_allin: "stars_bounty_allin", ignition_mtt_allin: "stars_bounty_allin", winamax_3bet_pot: "stars_3bet_pot",
  "ipoker_3bet_pot.xml": "stars_3bet_pot", acr_run_twice: "stars_run_twice",
};
const ALL: [string, Case][] = [...Object.entries(CASES), ...Object.entries(SAME).map(([f, like]): [string, Case] => [f, CASES[like]!])];
const STREETS: Street[] = ["preflop", "flop", "turn", "river"];

describe("importHand", () => {
  it.each(ALL)("replays %s: the setup, every street's actions and the pot won", (f, c) => {
    const r = importHand(HH(f));
    const h = r.hand;
    const stack = r.setup.stacks[h.hero]!;
    const own = Object.fromEntries(Object.entries(r.setup.stacks).filter(([, v]) => v !== stack));
    expect([h.players, h.hero, stack, r.setup.ante || undefined, !!r.setup.straddle]).toEqual([c.players, c.hero, c.stack, c.ante, !!c.straddle]);
    if (c.stacks) expect(own).toEqual(c.stacks);
    expect([...h.hole, ...h.board, null, null, null, null, null].slice(0, 7)).toEqual(c.cards);
    for (const s of STREETS) expect(r.lines[s], s).toEqual(acts(c[s]));
    expect(r.stopped).toBeNull();
    const sim = finalSim(r);
    expect(sim.handOver).toBe(true);
    expect(sim.pot).toBeCloseTo(c.pot, 9);
  });

  it("a short all-in: every seat plays its own stack, the all-in player is out of the betting", () => {
    // a third player all-in for 30bb with two 100bb players behind; the hero (BTN) folds the turn
    const text = HH("stars_6max_srp")
      .replace("tilt_proof: folds", "tilt_proof: raises $27 to $30 and is all-in")
      .replace("Seat 3: tilt_proof ($100 in chips)", "Seat 3: tilt_proof ($30 in chips)")
      .replace("HeroName: raises $1.50 to $2.50", "HeroName: calls $30")
      .replace("OldTAG: calls $1.50", "OldTAG: calls $29")
      .replace(
        /\*\*\* FLOP \*\*\*[\s\S]*\*\*\* SUMMARY/,
        "*** FLOP *** [Qs 8d 3c]\nOldTAG: checks\nHeroName: checks\n*** TURN *** [Qs 8d 3c] [7h]\nOldTAG: bets $20\nHeroName: folds\n*** SUMMARY",
      );
    const r = importHand(text);
    const stack = r.setup.stacks.BTN!;
    expect(Object.fromEntries(Object.entries(r.setup.stacks).filter(([, v]) => v !== stack))).toEqual({ CO: 30, HJ: 143.27, SB: 62.4 });
    expect(r.lines.preflop).toEqual(acts("UTG f, HJ f, CO a, BTN c, SB f, BB c"));
    expect(r.lines.flop).toEqual(acts("BB x, BTN x"));
    expect(r.lines.turn).toEqual(acts("BB b20, BTN f"));
    // BB's uncalled turn bet comes back; BB and CO go to showdown for the 90.5bb pot
    const sim = finalSim({ ...r, hand: { ...r.hand, board: r.hand.board.slice(0, 4) } });
    expect([sim.waiting, sim.pot, [...sim.allin], [...sim.active]]).toEqual(["river", 90.5, ["CO"], ["CO", "BB"]]);
  });

  it("stops where the history and the table part ways, and says so", () => {
    // the big blind acts out of turn on the flop
    const text = HH("stars_6max_srp").replace(/(\*\*\* FLOP \*\*\* \[[^\]]*\]\n)([^\n]+\n)([^\n]+\n)/, "$1$3$2");
    const r = importHand(text);
    expect(r.stopped).toEqual({ street: "flop", pos: "BTN" });
    expect(r.warnings.at(-1)).toBe("The table and the history part ways at BTN's flop action: the hand stops there.");
    expect(r.lines.flop).toEqual([]);
    expect(r.lines.preflop).toHaveLength(6);
  });
});
