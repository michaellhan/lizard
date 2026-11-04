// The kept doc: what's read back from it (keep.ts), and the Room writing it and coming back from it, on fake-indexeddb, a
// fake clock and a solver that answers at once. A "reload" is a new Room on what's in the browser. multitable.test.js's
// `:299` (one score, over a reload) and `:345` (fewer tables set aside) are here, the first changed as a Lizard score counts
// at each decision and its tallies as a hand ends.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kvGet, kvSet, putSession } from "@/data/db";
import { emptyTally, type PotTally } from "@/features/history/history";
import { noLines, recordOf, seeded, type Move } from "@/poker/table";
import type { AdvisorResponse, AdvisorState, PlayMove } from "@/solver/protocol";
import type { Provenance, SolveMode, SolveResult } from "@/solver/types";
import { useSettings } from "@/state/settings";
import { KEPT_KEY, keptHand, keptTables, sameKept, type KeptTable, type KeptTables } from "./keep";
import {
  dealNext,
  decide,
  decideUngraded,
  finish,
  newHand,
  phaseOf,
  runKind,
  setupOf,
  simOf,
  withVillain,
  type HandOptions,
  type PracticeHand,
} from "./practice";
import { Room, type RoomClient, type RoomOptions } from "./room";
import { freshSession, type PracticeSession } from "./session";

vi.mock("@/data/db", async (orig) => {
  const db = await orig<typeof import("@/data/db")>();
  return { ...db, kvSet: vi.fn(db.kvSet), putSession: vi.fn(db.putSession) };
});

const OPTS: Required<HandOptions> = { seat: "moves", preflopOnly: false, pot: null, ante: 0, straddle: false, carry: false, sizes: null, rake: 0, rakeCap: 0 };

const prov = (source: Provenance["source"]): Provenance => ({ source, approximate: source === "charts", mode: "quick", transport: "worker", solverVersion: "test", partial: false, receivedAt: 0 });

/** The solver almost never calls: each of your calls is a mistake giving up 1 bb (multitable.test.js:299). */
const BAD: AdvisorResponse = {
  street: "flop",
  recommended: "fold",
  actions: [
    { action: "fold", freq: 0.6, ev_bb: 0 },
    { action: "check", freq: 0.39, ev_bb: 0 },
    { action: "call", freq: 0.01, ev_bb: -1 },
    { action: "bet 50%", amount_bb: 3, freq: 0, ev_bb: -1 },
  ],
};
const CALL = 2;

const hands = (s: { tables: readonly { hand: PracticeHand }[] }) => s.tables.map((t) => t.hand);
const totals = (ts: readonly PotTally[]) => ({
  hands: ts.reduce((x, t) => x + t.hands, 0),
  n: ts.reduce((x, t) => x + t.n, 0),
  ok: ts.reduce((x, t) => x + t.ok, 0),
  ne: ts.reduce((x, t) => x + t.ne, 0),
  played: ts.reduce((x, t) => x + t.played, 0),
});

describe("keptHand", () => {
  /** A hand played from its deal to its end, by whatever's legal, each stage as the doc would hold it. */
  function playOut(start: PracticeHand, seed: number, stage: (h: PracticeHand) => void) {
    const rnd = seeded(seed);
    let h = start;
    for (let i = 0; i < 300; i += 1) {
      const sim = simOf(h);
      const ph = phaseOf(h, sim);
      // (a hand that's over is settled in the same step: the doc never sees it without its result)
      if (ph.kind !== "over" || h.result) stage(h);
      if (ph.kind === "over") {
        if (h.result) return;
        h = { ...h, result: finish(h, sim) };
        stage(h);
        const run = runKind(h, sim);
        if (!run || rnd() < 0.5) return;
        h = { ...h, run };
      } else if (ph.kind === "deal") {
        h = dealNext(h, ph.street);
      } else {
        const action = ["fold", "check", "call", "call", "raise", "all-in"][Math.floor(rnd() * 6)]!;
        const m: Move | string = recordOf(setupOf(h), sim, { action, to: 1 + rnd() * 60, clamp: true });
        const move = typeof m === "string" ? (recordOf(setupOf(h), sim, { action: "call" }) as Move) : m;
        const taken = ph.kind === "hero" ? decideUngraded(h, move, sim) : withVillain(h, move, sim);
        if (typeof taken === "string") throw new Error(taken);
        h = taken;
      }
    }
    throw new Error("the hand never ended");
  }

  const chips = (players: number, seed: number) => {
    const rnd = seeded(seed);
    const hand = newHand(players, 100, 0, seed, { seat: "moves", carry: true });
    return { stacks: Object.fromEntries(Object.keys(hand.hands).map((p) => [p, Math.round((30 + rnd() * 140) * 100) / 100])), rebuys: [] };
  };

  it("takes every hand there can be, at every stage of it, as the doc holds it: no hand is lost for being unusual", () => {
    let stages = 0;
    const check = (h: PracticeHand) => {
      stages += 1;
      expect(keptHand(structuredClone(h))).toEqual(h);
    };
    for (let seed = 1; seed <= 400; seed += 1) {
      const players = 2 + (seed % 8);
      playOut(newHand(players, 100, seed, seed, OPTS), seed, check);
      playOut(newHand(players, 40, seed, seed, { ...OPTS, ante: 0.5, straddle: true, rake: 5, rakeCap: 3 }), seed + 1000, check);
      playOut(newHand(players, 100, seed, seed, { ...OPTS, preflopOnly: true }), seed + 2000, check);
      // (chips carried: sizes off the half bb)
      playOut(newHand(players, 100, seed, seed, { seat: "moves", carry: true }, chips(players, seed)), seed + 3000, check);
    }
    expect(stages).toBeGreaterThan(5000);
  }, 30000);

  it("takes a drill's hand, and a graded decision with what graded it", () => {
    const h = newHand(2, 100, 0, 7, { ...OPTS, pot: "srp" });
    expect(keptHand({ ...h, tries: 3 })).not.toBeNull();
    const lib = { ...newHand(6, 100, 0, 9, { seat: "BTN", pot: "lib" }), tries: 2 };
    expect(keptHand(structuredClone(lib))).toEqual(lib);
    const lines = { ...lib, cands: [["UTG:f", "BTN:c"], []] };
    expect(keptHand(structuredClone(lines))).toEqual(lines);
    const dealt = newHand(2, 100, 0, 7, OPTS);
    const r = decide(dealt, BAD, CALL, prov("live"));
    if ("error" in r) throw new Error(r.error);
    expect(keptHand(structuredClone(r.hand))).toEqual(r.hand);
  });

  // heads-up on the flop: the small blind raised to 2.5, the big blind called, checked, and the small blind bet 3
  const flop = (): PracticeHand => ({
    ...newHand(2, 100, 0, 7, OPTS),
    shown: 3,
    lines: {
      preflop: [
        { pos: "SB", action: "raise", to: 2.5 },
        { pos: "BB", action: "call" },
      ],
      flop: [
        { pos: "BB", action: "check" },
        { pos: "SB", action: "bet", to: 3 },
      ],
      turn: [],
      river: [],
    },
  });
  const over = { net: 1, folded: false, winners: [], says: "", pays: {} };
  const other = (h: PracticeHand) => Object.keys(h.hands).find((p) => p !== h.hero)!;
  const graded = () => {
    const r = decide(newHand(2, 100, 0, 7, OPTS), BAD, CALL, prov("live"));
    if ("error" in r) throw new Error(r.error);
    return r.decision;
  };
  type Bad = (h: PracticeHand & Record<string, unknown>) => unknown;
  const bad: [string, Bad][] = [
    ["nothing", () => null],
    ["a list", () => []],
    ["a word", () => "hand"],
    ["no seed", (h) => ({ ...h, seed: "1" })],
    ["a seed that's no number", (h) => ({ ...h, seed: NaN })],
    ["a number below zero", (h) => ({ ...h, n: -1 })],
    ["a number that's not whole", (h) => ({ ...h, n: 1.5 })],
    ["no players", (h) => ({ ...h, players: undefined })],
    ["a table that doesn't exist", (h) => ({ ...h, players: 10 })],
    ["no stack", (h) => ({ ...h, stack: 0 })],
    ["a stack that's no number", (h) => ({ ...h, stack: "100" })],
    ["no hero", (h) => ({ ...h, hero: 1 })],
    ["a hero not at the table", (h) => ({ ...h, hero: "CO" })],
    ["no hands", (h) => ({ ...h, hands: [] })],
    ["a seat with no cards", ({ hands: { SB }, ...h }) => ({ ...h, hands: { SB } })],
    ["a seat too many", (h) => ({ ...h, hands: { ...h.hands, CO: ["2c", "2d"] } })],
    ["a seat with one card", (h) => ({ ...h, hands: { ...h.hands, BB: [h.hands.BB![0]] } })],
    ["a seat's cards as a word", (h) => ({ ...h, hands: { ...h.hands, BB: "AhKh" } })],
    // eslint-disable-next-line no-sparse-arrays
    ["a seat's cards with a hole in them", (h) => ({ ...h, hands: { ...h.hands, BB: [, h.hands.BB![1]] } })],
    ["a card not in the deck", (h) => ({ ...h, hands: { ...h.hands, BB: ["Zz", h.hands.BB![1]] } })],
    ["two seats holding one card", (h) => ({ ...h, hands: { ...h.hands, BB: [h.hands.SB![0], h.hands.BB![1]] } })],
    ["a board card a seat holds", (h) => ({ ...h, board: [h.hands.SB![0], ...h.board.slice(1)] })],
    ["a board card not in the deck", (h) => ({ ...h, board: ["Zz", ...h.board.slice(1)] })],
    ["no board", (h) => ({ ...h, board: "AhKh" })],
    ["a short board", (h) => ({ ...h, board: h.board.slice(0, 4) })],
    ["a street that's no street", (h) => ({ ...h, shown: 2 })],
    ["more cards out than a board has", (h) => ({ ...h, shown: 6 })],
    ["no lines", (h) => ({ ...h, lines: null })],
    ["a street missing", ({ lines: { river: _, ...lines }, ...h }) => ({ ...h, lines })],
    ["a street that's not a list", (h) => ({ ...h, lines: { ...h.lines, turn: "x" } })],
    ["a move that's no move", (h) => ({ ...h, lines: { ...h.lines, flop: [...h.lines.flop, "call"] } })],
    // eslint-disable-next-line no-sparse-arrays
    ["a street with a hole in it", (h) => ({ ...h, lines: { ...h.lines, turn: [,] } })],
    ["a move of no kind", (h) => ({ ...h, lines: { ...h.lines, flop: [...h.lines.flop, { pos: "BB", action: "shove" }] } })],
    ["a move by nobody", (h) => ({ ...h, lines: { ...h.lines, flop: [...h.lines.flop, { action: "call" }] } })],
    ["a size that's no number", (h) => ({ ...h, lines: { ...h.lines, flop: [...h.lines.flop, { pos: "BB", action: "raise", to: "9" }] } })],
    ["a move by a seat not at the table", (h) => ({ ...h, lines: { ...h.lines, flop: [...h.lines.flop, { pos: "CO", action: "call" }] } })],
    ["a move out of turn", (h) => ({ ...h, lines: { ...h.lines, flop: [...h.lines.flop, { pos: "SB", action: "call" }] } })],
    ["a check facing a bet", (h) => ({ ...h, lines: { ...h.lines, flop: [...h.lines.flop, { pos: "BB", action: "check" }] } })],
    ["a call with nothing to call", (h) => ({ ...h, lines: { ...h.lines, flop: [{ pos: "BB", action: "call" }] } })],
    ["a raise under the minimum", (h) => ({ ...h, lines: { ...h.lines, flop: [...h.lines.flop, { pos: "BB", action: "raise", to: 3.5 }] } })],
    ["a raise with no size", (h) => ({ ...h, lines: { ...h.lines, flop: [...h.lines.flop, { pos: "BB", action: "raise" }] } })],
    ["a move on a street not dealt", (h) => ({ ...h, shown: 0 })],
    ["a move on the turn with no turn", (h) => ({ ...h, lines: { ...h.lines, flop: [{ pos: "BB", action: "check" }, { pos: "SB", action: "check" }], turn: [{ pos: "BB", action: "check" }] } })],
    ["a move on a street before the last is done", (h) => ({ ...h, lines: { ...h.lines, preflop: [{ pos: "SB", action: "raise", to: 2.5 }], flop: [{ pos: "BB", action: "check" }] } })],
    ["a move after the hand ended", (h) => ({ ...h, lines: { ...h.lines, preflop: [{ pos: "SB", action: "fold" }, { pos: "BB", action: "check" }], flop: [] } })],
    ["no decisions", (h) => ({ ...h, decisions: null })],
    ["a decision that's no decision", (h) => ({ ...h, decisions: ["call"] })],
    // eslint-disable-next-line no-sparse-arrays
    ["decisions with a hole in them", (h) => ({ ...h, decisions: [,] })],
    ["a decision on no street", (h) => ({ ...h, decisions: [{ ...graded(), street: "showdown" }] })],
    ["a decision with no choice", (h) => ({ ...h, decisions: [{ ...graded(), chose: 1 }] })],
    ["a decision with no move", (h) => ({ ...h, decisions: [{ ...graded(), move: {} }] })],
    ["a decision with no mix", (h) => ({ ...h, decisions: [{ ...graded(), mix: null }] })],
    ["a decision's mix with nothing in it", (h) => ({ ...h, decisions: [{ ...graded(), mix: [null] }] })],
    // eslint-disable-next-line no-sparse-arrays
    ["a decision's mix with a hole in it", (h) => ({ ...h, decisions: [{ ...graded(), mix: [, { action: "call", freq: 1, ev: 0 }] }] })],
    ["a mix's action that's no word", (h) => ({ ...h, decisions: [{ ...graded(), mix: [{ action: {}, freq: 1, ev: 0 }] }] })],
    ["a mix with no frequency", (h) => ({ ...h, decisions: [{ ...graded(), mix: [{ action: "call", ev: 0 }] }] })],
    ["a mix's EV that's no number", (h) => ({ ...h, decisions: [{ ...graded(), mix: [{ action: "call", freq: 1, ev: "1" }] }] })],
    ["a mix with no EV, not even none", (h) => ({ ...h, decisions: [{ ...graded(), mix: [{ action: "call", freq: 1 }] }] })],
    ["a mix's size that's no number", (h) => ({ ...h, decisions: [{ ...graded(), mix: [{ action: "call", freq: 1, ev: null, amount: "3" }] }] })],
    ["a decision with no pot", (h) => ({ ...h, decisions: [{ ...graded(), pot: "5" }] })],
    ["a decision with no line in Study", (h) => ({ ...h, decisions: [{ ...graded(), study: null }] })],
    ["a grade with no source", (h) => ({ ...h, decisions: [{ ...graded(), provenance: null }] })],
    ["a source there are no words for", (h) => ({ ...h, decisions: [{ ...graded(), provenance: { ...prov("live"), source: "oracle" } }] })],
    ["a source named as what every object has", (h) => ({ ...h, decisions: [{ ...graded(), provenance: { ...prov("live"), source: "toString" } }] })],
    ...["exploitabilityPct", "targetPct", "iterations", "seconds", "mbbPerHand"].map((k): [string, Bad] => [`a source's ${k} that's no number`, (h) => ({ ...h, decisions: [{ ...graded(), provenance: { ...prov("live"), [k]: "1" } }] })]),
    ["a grade with a source that says nothing", (h) => ({ ...h, decisions: [{ ...graded(), provenance: { approximate: false } }] })],
    ["a source that doesn't say if it's approximate", (h) => ({ ...h, decisions: [{ ...graded(), provenance: { source: "charts" } }] })],
    ["a grade with no verdict", (h) => ({ ...h, decisions: [{ ...graded(), grade: { ...graded().grade, verdict: 3 } }] })],
    ["a grade with a verdict the scale doesn't have", (h) => ({ ...h, decisions: [{ ...graded(), grade: { ...graded().grade, verdict: "Good" } }] })],
    ["a grade with no action", (h) => ({ ...h, decisions: [{ ...graded(), grade: { ...graded().grade, a: "x" } }] })],
    ["a grade with no best", (h) => ({ ...h, decisions: [{ ...graded(), grade: { ...graded().grade, best: -1 } }] })],
    ["a grade that's not ok or not", (h) => ({ ...h, decisions: [{ ...graded(), grade: { ...graded().grade, ok: 1 } }] })],
    ["a grade with no loss", (h) => ({ ...h, decisions: [{ ...graded(), grade: { ...graded().grade, loss: null } }] })],
    ["a grade with no share of the pot", (h) => ({ ...h, decisions: [{ ...graded(), grade: { ...graded().grade, lossPct: null } }] })],
    ["a grade not by EV or not", (h) => ({ ...h, decisions: [{ ...graded(), grade: { ...graded().grade, byEv: 1 } }] })],
    ["a source with no grade", (h) => ({ ...h, decisions: [{ ...graded(), grade: null }] })],
    ["a result that's no result", (h) => ({ ...h, result: 1 })],
    ["a result with no net", (h) => ({ ...h, result: { folded: false, winners: [], says: "", pays: {} } })],
    ["a result not folded or not", (h) => ({ ...h, result: { net: 1, winners: [], says: "", pays: {} } })],
    ["a result with no winners", (h) => ({ ...h, result: { net: 1, folded: false, says: "", pays: {} } })],
    ["a result with no words", (h) => ({ ...h, result: { net: 1, folded: false, winners: [], pays: {} } })],
    ["a result with no pays", (h) => ({ ...h, result: { net: 1, folded: false, winners: [], says: "" } })],
    ["a result's winner that's no seat", (h) => ({ ...h, result: { ...over, winners: [1] } })],
    // eslint-disable-next-line no-sparse-arrays
    ["a result's winners with a hole in them", (h) => ({ ...h, result: { ...over, winners: [,] } })],
    ["a result's pay that's no chips", (h) => ({ ...h, result: { ...over, pays: { SB: "1" } } })],
    ["an ante that's no number", (h) => ({ ...h, ante: "1" })],
    ["a pot drill that doesn't exist", (h) => ({ ...h, pot: "nope" })],
    ["Instant flops' lines that are no list", (h) => ({ ...h, pot: "lib", cands: "UTG:f" })],
    ["Instant flops' lines of something else", (h) => ({ ...h, pot: "lib", cands: [["UTG:f"], [7]] })],
    ["a pot drill named as what every object has", (h) => ({ ...h, pot: "toString" })],
    ["a drill's deals not counted", (h) => ({ ...h, tries: -1 })],
    ["stacks that aren't chips", (h) => ({ ...h, stacks: { SB: "100", BB: 100 } })],
    ["stacks that are no stacks", (h) => ({ ...h, stacks: 100 })],
    ["sizes that are no sizes", (h) => ({ ...h, sizes: 33 })],
    ["sizes with no list", (h) => ({ ...h, sizes: { flop: 5 } })],
    ["sizes on a street that has none", (h) => ({ ...h, sizes: { preflop: [33] } })],
    ["a size that's a word", (h) => ({ ...h, sizes: { flop: ["33"] } })],
    ["a size that's no number", (h) => ({ ...h, sizes: { flop: [NaN] } })],
    // eslint-disable-next-line no-sparse-arrays
    ["sizes with a hole in them", (h) => ({ ...h, sizes: { flop: [,] } })],
    ["a rake that's no rake", (h) => ({ ...h, rake: { cap: 3 } })],
    ["a rake that's a number", (h) => ({ ...h, rake: 5 })],
    ["a rake cap that's no number", (h) => ({ ...h, rake: { pct: 5, cap: "3" } })],
    ["a run-out of no kind", (h) => ({ ...h, run: "walked" })],
    ["rebuys that are no list", (h) => ({ ...h, rebuys: 1 })],
    ["rebuys that are no seats", (h) => ({ ...h, rebuys: [1] })],
    // eslint-disable-next-line no-sparse-arrays
    ["rebuys with a hole in them", (h) => ({ ...h, rebuys: [,] })],
    ["a decision's move with no seat", (h) => ({ ...h, decisions: [{ ...graded(), move: { action: "call" } }] })],
    ["a decision's move of no kind", (h) => ({ ...h, decisions: [{ ...graded(), move: { pos: "SB", action: "dance" } }] })],
    ["a result with a rake that's no number", (h) => ({ ...h, result: { ...over, rake: "1" } })],
    // (one card is a word of two characters, as long as a seat's two cards)
    ["a seat's cards as a word", (h) => ({ ...h, hands: { ...h.hands, [other(h)]: h.hands[other(h)]![0] } })],
    [
      "a flop played before the preflop has closed",
      (h) => ({ ...h, lines: { preflop: [{ pos: "SB", action: "raise", to: 2.5 }], flop: [{ pos: "BB", action: "call" }], turn: [], river: [] } }),
    ],
    // (a hand over has no move left to give these away)
    ["a finished hand of a seat not at the table", (h) => ({ ...h, hero: "UTG", result: over })],
    ["a finished hand with no chips", () => ({ ...newHand(2, 100, 0, 7, OPTS), stack: 0, result: over })],
    ["a finished hand at a table size that's a word", () => ({ ...newHand(2, 100, 0, 7, OPTS), players: "2", result: over })],
    [
      "a hand with nothing left to happen and no result, which would wait for ever",
      (h) => ({ ...h, shown: 0, lines: { preflop: [{ pos: "SB", action: "fold" }], flop: [], turn: [], river: [] } }),
    ],
  ];

  it("takes the hand the cases below are made from", () => {
    expect(keptHand(flop())).not.toBeNull();
    expect(keptHand({ ...flop(), lines: { ...flop().lines, flop: [...flop().lines.flop, { pos: "BB", action: "raise", to: 6 }] } })).not.toBeNull();
    expect(keptHand({ ...flop(), lines: { ...flop().lines, flop: [...flop().lines.flop, { pos: "BB", action: "call" }] } })).not.toBeNull();
    expect(keptHand({ ...flop(), rake: { pct: 5 }, stacks: { SB: 100, BB: 100 }, rebuys: ["SB"], sizes: { flop: [33] }, ante: 0, run: "shown" })).not.toBeNull();
    expect(keptHand({ ...flop(), result: { ...over, rake: 0.5, winners: ["SB"], pays: { SB: 3 } } })).not.toBeNull();
    expect(keptHand({ ...flop(), rake: { pct: 5, cap: 3 }, sizes: { flop: [33, 75], turn: [50], river: [100], raise: [300] } })).not.toBeNull();
    expect(keptHand({ ...flop(), decisions: [{ ...graded(), mix: [{ action: "fold", freq: 0.5, ev: null }, { action: "bet 33%", freq: 0.5, ev: null, amount: 3 }] }] })).not.toBeNull();
    expect(keptHand({ ...flop(), decisions: [{ ...graded(), provenance: { ...prov("live"), exploitabilityPct: 1.2, targetPct: 2, iterations: 500, seconds: 3.1, mbbPerHand: 1 } }] })).not.toBeNull();
    expect(keptHand({ ...flop(), decisions: [{ ...graded(), provenance: prov("library-turn") }] })).not.toBeNull();
  });

  it.each(bad)("won't take %s", (_, spoil) => {
    expect(keptHand(spoil(flop() as PracticeHand & Record<string, unknown>))).toBeNull();
  });

  it("takes a size the table rounded, and no size it wouldn't have", () => {
    const raised = (to: number) => ({ ...flop(), lines: { ...flop().lines, flop: [...flop().lines.flop, { pos: "BB", action: "raise" as const, to }] } });
    expect(keptHand(raised(7.2))).not.toBeNull();
    expect(keptHand(raised(7.3))).not.toBeNull();
    expect(keptHand(raised(6.2))).not.toBeNull();
    expect(keptHand(raised(5.8))).not.toBeNull();
    // (the minimum is 6, and a clamped replay lifts these to it, which is no rounding)
    expect(keptHand(raised(5.7))).toBeNull();
    expect(keptHand(raised(4))).toBeNull();
  });

  // (each came from a fuzz: raises asked for under the minimum, lifted to it off the half bb, with all-in within a quarter
  // bb past that minimum's nearest half, so the table's rounding sends the size to the all-in it stopped short of)
  const short = (players: number, stack: number, seed: number, seat: string, o: HandOptions, stacks: Record<string, number>, preflop: Move[]): PracticeHand => ({
    ...newHand(players, stack, 0, seed, { ...OPTS, ...o, seat }),
    stacks,
    lines: { ...noLines(), preflop },
  });
  const sevenFold = (to: number) =>
    short(7, 40, 8139, "SB", { ante: 1, rake: 5 }, { UTG: 31.9, LJ: 7.64, HJ: 6.4, CO: 21.27, BTN: 17.41, SB: 16.93, BB: 1.94 }, [
      { pos: "UTG", action: "call" },
      { pos: "LJ", action: "call" },
      { pos: "HJ", action: "raise", to: 2 },
      { pos: "CO", action: "fold" },
      { pos: "BTN", action: "all-in" },
      { pos: "SB", action: "all-in" },
      { pos: "UTG", action: "raise", to },
    ]);

  it.each<[string, PracticeHand]>([
    ["a seven-max hand with an ante", sevenFold(30.82)],
    [
      "a straddled hand",
      short(7, 20, 22208, "BTN", { ante: 0.25, straddle: true }, { UTG: 5.54, LJ: 12.6, HJ: 3.5, CO: 23.21, BTN: 2.86, SB: 16.58, BB: 15.81 }, [
        { pos: "LJ", action: "call" },
        { pos: "HJ", action: "all-in" },
        { pos: "CO", action: "fold" },
        { pos: "BTN", action: "all-in" },
        { pos: "SB", action: "call" },
        { pos: "BB", action: "call" },
        { pos: "UTG", action: "raise", to: 5.25 },
      ]),
    ],
    [
      "a raise on the way back round",
      short(6, 20, 28549, "HJ", { straddle: true }, { UTG: 20.57, HJ: 4.52, CO: 26.38, BTN: 16.64, SB: 16.2, BB: 20.22 }, [
        { pos: "HJ", action: "call" },
        { pos: "CO", action: "raise", to: 7 },
        { pos: "BTN", action: "all-in" },
        { pos: "SB", action: "all-in" },
        { pos: "BB", action: "fold" },
        { pos: "UTG", action: "call" },
        { pos: "HJ", action: "call" },
        { pos: "CO", action: "raise", to: 26.28 },
      ]),
    ],
  ])("takes a minimum raise just short of all-in, in %s", (_, h) => {
    expect(keptHand(structuredClone(h))).toEqual(h);
  });

  it("takes a raise on the half bb, with all-in less than a half bb past it", () => {
    const h = short(7, 40, 8139, "SB", { ante: 1, rake: 5 }, { UTG: 31.9, LJ: 7.64, HJ: 6.4, CO: 21.27, BTN: 17.41, SB: 16.93, BB: 1.94 }, [{ pos: "UTG", action: "raise", to: 30.5 }]);
    expect(keptHand(h)).toEqual(h);
  });

  it("takes what's after a minimum raise just short of all-in", () => {
    const h = sevenFold(30.82);
    expect(keptHand({ ...h, lines: { ...h.lines, preflop: [...h.lines.preflop, { pos: "LJ", action: "fold" }, { pos: "HJ", action: "fold" }] } })).not.toBeNull();
  });

  it.each([
    ["past it", 30.95],
    ["past it by the half bb the table would round to", 31],
    ["at it, which the table calls an all-in", 30.9],
    ["past the chips by far", 45],
  ])("won't take a raise %s", (_, to) => {
    expect(keptHand(sevenFold(to))).toBeNull();
  });

  it("says null, not an exception, whatever the doc holds", () => {
    const h = flop();
    Object.defineProperty(h, "lines", {
      get() {
        throw new Error("gone");
      },
    });
    expect(keptHand(h)).toBeNull();
  });
});

describe("keptTables", () => {
  const hand = (n: number) => newHand(6, 100, n, n + 1, OPTS);
  const kept = (h: PracticeHand, o: Partial<KeptTable> = {}): KeptTable => ({ hand: h, stats: emptyTally(), sources: {}, last: null, lastHand: null, ...o });
  const doc = (o: Record<string, unknown> = {}) => ({ v: 1, n: 2, focus: 1, session: { ...freshSession(6, 100, OPTS), dealt: 2, tables: 2 }, tables: [kept(hand(0)), kept(hand(1))], ...o });
  const spoiled = (session: Record<string, unknown>) => doc({ session: { ...doc().session, ...session } });

  it("reads a table's sources, and as none where they're missing or aren't sources, no version change", () => {
    const sources = { live: 3, charts: 1 };
    const read = (o: object) => keptTables(doc({ tables: [kept(hand(0), o as Partial<KeptTable>), kept(hand(1))] }))!.tables[0]!.sources;
    expect(read({ sources })).toEqual(sources);
    expect(read({ sources: undefined })).toEqual({});
    expect(read({ sources: { live: -1 } })).toEqual({});
    expect(read({ sources: { live: "3" } })).toEqual({});
    expect(read({ sources: { guessed: 3 } })).toEqual({});
    expect(read({ sources: [3] })).toEqual({});
    expect(read({ sources: "live" })).toEqual({});
  });

  it("reads a doc as it was written, four places long", () => {
    const d = doc();
    const k = keptTables(structuredClone(d))!;
    expect(k).toMatchObject({ v: 1, n: 2, focus: 1 });
    expect(k.session).toEqual(d.session);
    expect(k.tables).toEqual([...d.tables, null, null]);
  });

  it.each<[string, unknown]>([
    ["nothing", undefined],
    ["null", null],
    ["a list", []],
    ["another version", doc({ v: 2 })],
    ["no version", doc({ v: undefined })],
    ["one table, which is never kept", doc({ n: 1 })],
    ["no table", doc({ n: 0 })],
    ["five tables", doc({ n: 5 })],
    ["a number of tables that's no number", doc({ n: "2" })],
    ["no session", doc({ session: null })],
    ["no tables", doc({ tables: {} })],
    ["a session with no id", spoiled({ id: 1 })],
    ["a session with no start", spoiled({ startedAt: "now" })],
    ["a session of no table", spoiled({ players: 10 })],
    ["a session with no players", spoiled({ players: "6" })],
    ["a session with no stack", spoiled({ stack: 0 })],
    ["a session with a stack that's no number", spoiled({ stack: "100" })],
    ["a session with no setup", spoiled({ opts: null })],
    ["a setup with no seat", spoiled({ opts: { ...OPTS, seat: 1 } })],
    ["a setup not preflop-only or not", spoiled({ opts: { ...OPTS, preflopOnly: 0 } })],
    ["a setup with a pot that doesn't exist", spoiled({ opts: { ...OPTS, pot: "x" } })],
    ["a setup on Instant flops, which only the tables deal", spoiled({ opts: { ...OPTS, pot: "lib" } })],
    ["a setup with no ante", spoiled({ opts: { ...OPTS, ante: "0" } })],
    ["a setup not straddled or not", spoiled({ opts: { ...OPTS, straddle: 0 } })],
    ["a setup not carrying chips or not", spoiled({ opts: { ...OPTS, carry: 0 } })],
    ["a setup with a pot named as what every object has", spoiled({ opts: { ...OPTS, pot: "toString" } })],
    ["a setup with sizes that are no sizes", spoiled({ opts: { ...OPTS, sizes: 3 } })],
    ["a setup with sizes with no list", spoiled({ opts: { ...OPTS, sizes: { flop: 5 } } })],
    ["a setup with no rake", spoiled({ opts: { ...OPTS, rake: "0" } })],
    ["a setup with no rake cap", spoiled({ opts: { ...OPTS, rakeCap: "0" } })],
    ["a session with no count of deals", spoiled({ dealt: -1 })],
    ["a session with no count of tables", spoiled({ tables: "2" })],
    ["a session with no count of hands", spoiled({ hands: 0.5 })],
    ["a session with no net", spoiled({ net: NaN })],
    ["a session with no score", spoiled({ score: {} })],
    ["a score with no decisions", spoiled({ score: { ...doc().session.score, n: -1 } })],
    ["a score with no loss", spoiled({ score: { ...doc().session.score, loss: "1" } })],
    ["a score with no share of the pot", spoiled({ score: { ...doc().session.score, lossPct: "1" } })],
    ["a score with no recent decisions", spoiled({ score: { ...doc().session.score, recent: 1 } })],
    ["a session with no pots", spoiled({ byPot: [] })],
    ["a pot that's no tally", spoiled({ byPot: { SRP: { hands: 1 } } })],
    ["a pot with no net", spoiled({ byPot: { SRP: { ...emptyTally(), net: "1" } } })],
    ["a pot with a count that's no count", spoiled({ byPot: { SRP: { ...emptyTally(), hands: -1 } } })],
    ["a session with no sources", spoiled({ sources: null })],
    ["a session counting no number of a source", spoiled({ sources: { live: "1" } })],
    ["a session counting a source there are no words for", spoiled({ sources: { oracle: 1 } })],
    ["a session with no review", spoiled({ review: {} })],
    ["a review entry with nothing in it", spoiled({ review: [{}] })],
    // eslint-disable-next-line no-sparse-arrays
    ["a review with a hole in it", spoiled({ review: [,] })],
  ])("has nothing to use in %s", (_, x) => {
    expect(keptTables(x)).toBeNull();
  });

  it("reads a review entry with its decision, and none without", () => {
    const h = newHand(2, 100, 0, 7, OPTS);
    const r = decide(h, BAD, CALL, prov("live"));
    if ("error" in r) throw new Error(r.error);
    const e = { n: 1, table: 2, seat: h.hero, players: 2, hole: h.hands[h.hero], board: ["Ah", "Kd", "2c"], line: "first to act", d: r.decision };
    expect(keptTables(spoiled({ review: [e] }))?.session.review).toEqual([e]);
    const ungraded = { ...r.decision, grade: null, provenance: null };
    for (const spoil of [{ n: "1" }, { table: "2" }, { seat: 1 }, { players: "2" }, { hole: "AhKh" }, { hole: ["ZZ", "YY"] }, { hole: ["Ah"] }, { hole: ["Ah", "Kd", "2c"] }, { board: "" }, { board: ["ZZ"] }, { line: 1 }, { d: null }, { d: ungraded }]) {
      expect(keptTables(spoiled({ review: [{ ...e, ...spoil }] }))).toBeNull();
    }
  });

  it("loses only the hand that won't replay, its table's results kept", () => {
    const stats = { ...emptyTally(), hands: 5, n: 7, ok: 6, played: 5, net: 12.5 };
    const lost = kept({ ...hand(1), board: [] }, { stats });
    const k = keptTables(doc({ tables: [kept(hand(0)), lost] }))!;
    expect(k.tables[0]!.hand).not.toBeNull();
    expect(k.tables[1]).toEqual({ hand: null, stats, sources: {}, last: null, lastHand: null });
  });

  it("takes as lost a hand of another game, as the table deals on from it", () => {
    const k = keptTables(doc({ tables: [kept(newHand(2, 100, 0, 1, OPTS)), kept({ ...hand(1), stack: 50 })] }))!;
    expect(k.tables.map((t) => t?.hand ?? null)).toEqual([null, null, null, null]);
    expect(k.tables.slice(0, 2).every((t) => t !== null)).toBe(true);
  });

  it("reads what's wrong in a place as nothing: no tally, no decision, no last hand, no place at all", () => {
    const k = keptTables(doc({ tables: [{ hand: hand(0), stats: { hands: "x" }, last: { chose: 1 }, lastHand: { n: 1 } }, "x", null] }))!;
    expect(k.tables[0]).toEqual({ hand: hand(0), stats: emptyTally(), sources: {}, last: null, lastHand: null });
    expect(k.tables[1]).toBeNull();
  });

  it("reads a last decision with nothing in its mix as none, the table's hand and results kept", () => {
    const h = newHand(2, 100, 0, 7, OPTS);
    const r = decide(h, BAD, CALL, prov("live"));
    if ("error" in r) throw new Error(r.error);
    const k = keptTables(doc({ tables: [kept(hand(0), { last: { ...r.decision, mix: [null] } as unknown as KeptTable["last"] }), kept(hand(1))] }))!;
    expect(k.tables[0]).toEqual({ hand: hand(0), stats: emptyTally(), sources: {}, last: null, lastHand: null });
  });

  it("keeps a tally, a last decision and a last hand that are sound", () => {
    const h = newHand(2, 100, 0, 7, OPTS);
    const r = decide(h, BAD, CALL, prov("live"));
    if ("error" in r) throw new Error(r.error);
    const lastHand = { n: 3, seat: "BTN", result: { net: 2, folded: false, winners: ["BTN"], says: "", pays: {} } };
    expect(keptTables(doc({ tables: [kept(hand(0), { last: r.decision, lastHand }), kept(hand(1))] }))!.tables[0]).toMatchObject({ last: r.decision, lastHand });
    for (const spoil of [{ n: "3" }, { seat: 1 }, { result: null }]) {
      expect(keptTables(doc({ tables: [kept(hand(0), { lastHand: { ...lastHand, ...spoil } as unknown as KeptTable["lastHand"] })] }))!.tables[0]!.lastHand).toBeNull();
    }
  });

  it.each([
    ["past the tables", 2],
    ["below them", -1],
    ["not a place", "1"],
  ])("puts a focus %s at the first table", (_, focus) => {
    expect(keptTables(doc({ focus }))!.focus).toBe(0);
  });

  it("holds the count of deals past every hand on the tables, as a number names one hand", () => {
    const d = doc({ session: { ...doc().session, dealt: 1 }, tables: [kept(hand(0)), kept(hand(1)), kept(hand(6))] });
    expect(keptTables(d)!.session.dealt).toBe(7);
    expect(keptTables(doc({ session: { ...doc().session, dealt: 9 } }))!.session.dealt).toBe(9);
  });

  it("says null, not an exception, whatever the doc holds", () => {
    const d = doc();
    Object.defineProperty(d, "session", {
      get() {
        throw new Error("gone");
      },
    });
    expect(keptTables(d)).toBeNull();
  });
});

describe("sameKept", () => {
  const h = newHand(6, 100, 0, 1, OPTS);
  const place = (o: Partial<KeptTable> = {}): KeptTable => ({ hand: h, stats: emptyTally(), sources: undefined, last: null, lastHand: null, ...o });
  const a: KeptTables = { v: 1, n: 2, focus: 0, session: freshSession(6, 100, OPTS), tables: [place(), place(), null, null] };

  it("sees no change where only the wrapping is new", () => {
    expect(sameKept({ ...a, tables: a.tables.map((t) => t && { ...t }) }, a)).toBe(true);
  });

  it.each<[string, KeptTables]>([
    ["the number of tables", { ...a, n: 3 }],
    ["the table in front", { ...a, focus: 1 }],
    ["the session", { ...a, session: { ...a.session } }],
    ["a hand", { ...a, tables: [{ ...a.tables[0]!, hand: { ...h } }, ...a.tables.slice(1)] }],
    ["a table's results", { ...a, tables: [{ ...a.tables[0]!, stats: emptyTally() }, ...a.tables.slice(1)] }],
    ["what graded them", { ...a, tables: [{ ...a.tables[0]!, sources: {} }, ...a.tables.slice(1)] }],
    ["a last decision", { ...a, tables: [{ ...a.tables[0]!, last: {} as KeptTable["last"] }, ...a.tables.slice(1)] }],
    ["a last hand", { ...a, tables: [{ ...a.tables[0]!, lastHand: {} as KeptTable["lastHand"] }, ...a.tables.slice(1)] }],
    ["a table gone", { ...a, tables: [null, ...a.tables.slice(1)] }],
    ["a table come", { ...a, tables: [a.tables[0]!, a.tables[1]!, place(), null] }],
  ])("sees a change of %s", (_, b) => {
    expect(sameKept(b, a)).toBe(false);
  });

  it("sees a change from nothing kept", () => {
    expect(sameKept(a, null)).toBe(false);
    expect(sameKept(a, undefined)).toBe(false);
  });
});

describe("Room's kept doc", () => {
  const flush = () => vi.advanceTimersByTimeAsync(0);
  const pass = (ms: number) => vi.advanceTimersByTimeAsync(ms);
  const stored = () => kvGet<KeptTables | null>(KEPT_KEY);
  const writes = () => vi.mocked(kvSet).mock.calls.filter(([k]) => k === KEPT_KEY).map(([, v]) => v as KeptTables | null);

  interface Answers {
    client: RoomClient;
    /** what's been asked, in order: "advise <seat>", "play <seat>", with the mode */
    calls: string[];
    prefetched: AdvisorState[];
  }

  /** A solver that answers at once: your spot by BAD, each opponent calls or checks. `quiet`: it never answers. */
  function solver({ quiet = false } = {}): Answers {
    const calls: string[] = [];
    const prefetched: AdvisorState[] = [];
    const answer = <T,>(data: T): Promise<SolveResult<T>> => (quiet ? new Promise(() => {}) : Promise.resolve({ data, provenance: prov("live") }));
    const said = (what: string, mode?: SolveMode) => calls.push(`${what} ${mode ?? ""}`.trim());
    const client: RoomClient = {
      solve: (req) => {
        said(`advise ${req.state.hero}`, req.mode);
        return answer(BAD);
      },
      play: (_, p, o) => {
        said(`play ${p.seat}`, o?.mode);
        return answer<PlayMove>({ pos: p.seat, action: "call", name: "call", freq: 1 });
      },
      prefetch: (state) => prefetched.push(state),
    };
    return { client, calls, prefetched };
  }

  let rooms: Room[] = [];
  let seeds = 0;

  /** A Room on what's in the browser. */
  function open(o: RoomOptions = {}, answers = solver()) {
    seeds += 1000;
    const base = seeds;
    const room = new Room({ pace: 0, pause: 100, guard: 0, now: () => Date.now(), seedOf: (n) => base + n, ...o });
    room.setSolver(async () => answers.client);
    rooms.push(room);
    return { room, ...answers };
  }

  /** The page opened: a Room started, once its read has answered. */
  async function reload(o: RoomOptions = {}, answers = solver()) {
    const r = open(o, answers);
    r.room.start();
    // (a read after the Room's answers after it)
    await stored();
    await flush();
    return r;
  }

  /** You play on: option `i` wherever it's your turn in front, the clock moving between. */
  async function play(room: Room, until: () => boolean, i = CALL) {
    for (let k = 0; k < 4000 && !until(); k += 1) {
      await pass(10);
      const s = room.snapshot();
      const t = s.tables[s.focus];
      if (t?.answer && t.turnKey) room.choose(s.focus, t.turnKey, i);
    }
    expect(until()).toBe(true);
  }

  const hand = (n: number, seat: string, o: Partial<PracticeHand> = {}) => ({ ...newHand(6, 100, n, n + 1, { ...OPTS, seat }), ...o });
  const kept = (h: PracticeHand, o: Partial<KeptTable> = {}): KeptTable => ({ hand: h, stats: emptyTally(), last: null, lastHand: null, ...o });
  const session = (dealt: number, o: Partial<PracticeSession> = {}): PracticeSession => ({ ...freshSession(6, 100, OPTS), dealt, tables: dealt, ...o });
  const doc = (tables: KeptTable[], o: Partial<KeptTables> = {}): KeptTables => ({ v: 1, n: tables.length as KeptTables["n"], focus: 0, session: session(tables.length), tables, ...o });
  /** A doc in the browser, and nothing written since. */
  async function put(d: unknown) {
    await kvSet(KEPT_KEY, d);
    vi.mocked(kvSet).mockClear();
  }

  beforeEach(async () => {
    // (the clock is faked and the database's own turns aren't, so a read answers by itself)
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    useSettings.setState({ mode: "fast", keepHands: false, loaded: true, practiceSpot: "any" });
    await put(null);
    vi.mocked(putSession).mockClear();
  });

  afterEach(() => {
    for (const r of rooms) r.stop();
    rooms = [];
    vi.useRealTimers();
    useSettings.setState({ mode: "fast", keepHands: false, loaded: false, practiceSpot: null });
  });

  describe("across tables", () => {
    it("scores every decision into one session, each table's results adding up to it, and a reload brings back all of it (multitable.test.js:299)", async () => {
      const { room } = open({ tables: 2 });
      room.start();
      await play(room, () => room.snapshot().session.hands >= 6);
      const s = room.snapshot();
      const stats = s.tables.map((t) => t.stats);

      expect(stats.every((t) => t.hands >= 1)).toBe(true);
      expect(s.session.hands).toBe(totals(stats).hands);
      expect(s.session.net).toBeCloseTo(stats.reduce((x, t) => x + t.net, 0), 6);
      expect(totals(Object.values(s.session.byPot))).toEqual(totals(stats));
      // (the score counts at each decision and a table's results as a hand ends, so they differ by what's in play)
      const inPlay = s.tables.flatMap((t) => (t.hand.result ? [] : t.hand.decisions.filter((d) => d.grade)));
      expect(s.session.score.n).toBe(totals(stats).n + inPlay.length);

      expect([...new Set(s.session.review.map((e) => e.table))].sort()).toEqual([1, 2]);
      expect(s.session.review.every((e) => e.d.grade && e.hole.length === 2 && e.n >= 1)).toBe(true);
      expect(s.session.review.some((e) => e.d.grade!.loss === 1)).toBe(true);
      // (each table's sources count what its stats count, so its row's figures carry their source)
      for (const t of s.tables) expect(Object.values(t.sources).reduce((x, n) => x + n!, 0)).toBe(t.stats.n);

      room.stop();
      const { room: back } = await reload({}, solver({ quiet: true }));
      const q = back.snapshot();
      expect(q.tables.map((t) => t.sources)).toEqual(s.tables.map((t) => t.sources));
      expect(q.session).toEqual(s.session);
      expect(q.session.id).toBe(s.session.id);
      expect(hands(q)).toEqual(hands(s));
      expect(q.tables.map((t) => t.stats)).toEqual(stats);
      expect(q.tables.map((t) => t.last)).toEqual(s.tables.map((t) => t.last));
      expect(q.tables.map((t) => t.lastHand)).toEqual(s.tables.map((t) => t.lastHand));
      expect(q.focus).toBe(s.focus);

      // New session: the session cleared, every table dealt again, and the doc says so
      back.startSession(6, 100, OPTS);
      expect(back.snapshot().session.score.n).toBe(0);
      expect(back.snapshot().session.review).toEqual([]);
      expect(back.snapshot().session.id).not.toBe(s.session.id);
      expect(back.snapshot().tables.map((t) => t.stats)).toEqual([emptyTally(), emptyTally()]);
      expect(back.snapshot().tables.map((t) => t.lastHand)).toEqual([null, null]);
      expect(back.snapshot().tables.map((t) => t.sources)).toEqual([{}, {}]);
      expect((await stored())!.session.score.n).toBe(0);
      expect((await stored())!.session.id).toBe(back.snapshot().session.id);
    });

    it("keeps the tables set aside, hands and results, over a reload, for when there are as many again (multitable.test.js:345)", async () => {
      const four = ["UTG", "HJ", "CO", "BTN"].map((seat, n) => hand(n, seat));
      const stats = { ...emptyTally(), hands: 5, n: 7, ok: 6, ne: 7, played: 5, net: 12.5 };
      await put(doc([kept(four[0]!), kept(four[1]!), kept(four[2]!), kept(four[3]!, { stats })]));

      const { room } = await reload({}, solver({ quiet: true }));
      expect(hands(room.snapshot()).map((h) => h.hands[h.hero])).toEqual(four.map((h) => h.hands[h.hero]));
      room.setTables(2);
      expect(hands(room.snapshot()).map((h) => h.hands[h.hero])).toEqual(four.slice(0, 2).map((h) => h.hands[h.hero]));
      const d = (await stored())!;
      expect(d.n).toBe(2);
      expect(d.tables[3]!.hand!.hands).toEqual(four[3]!.hands);
      expect(d.tables[3]!.stats).toEqual(stats);
      room.stop();

      const { room: back } = await reload({}, solver({ quiet: true }));
      expect(back.snapshot().tables).toHaveLength(2);
      back.setTables(4);
      expect(hands(back.snapshot()).map((h) => h.hands[h.hero])).toEqual(four.map((h) => h.hands[h.hero]));
      expect(back.snapshot().tables[3]!.stats).toEqual(stats);
      expect(back.snapshot().session.dealt).toBe(4);
    });

    it("takes up a table set aside over a reload with the error it was dealt again with, and deals where nothing was set aside", async () => {
      const stats = { ...emptyTally(), hands: 2 };
      await put(doc([kept(hand(0, "UTG")), kept(hand(1, "UTG")), kept({ ...hand(2, "UTG"), board: [] }, { stats })], { n: 2 }));
      const { room } = await reload({}, solver({ quiet: true }));
      expect(room.snapshot().tables).toHaveLength(2);
      room.setTables(4);
      const [, , lost, fresh] = room.snapshot().tables;
      expect(lost!.stats).toEqual(stats);
      expect(lost!.error).toMatch(/dealt again/);
      expect(fresh!.error).toBeNull();
      expect(fresh!.stats).toEqual(emptyTally());
      // (one for the lost hand as it was read, and one for the place nothing was)
      expect(room.snapshot().session.dealt).toBe(5);
    });

    it("keeps how many tables a session has been played at, for History", async () => {
      await put(doc([kept(hand(0, "UTG")), kept(hand(1, "UTG"))], { session: session(2, { tables: 4 }) }));
      const { room } = await reload({}, solver({ quiet: true }));
      expect(room.snapshot().session.tables).toBe(4);
    });
  });

  describe("saving", () => {
    it("writes nothing at one table, and a reload there starts fresh", async () => {
      const { room } = open();
      room.start();
      await play(room, () => room.snapshot().session.hands >= 1);
      room.stop();
      const first = room.snapshot().session;
      const { room: back } = await reload();
      expect(writes()).toEqual([]);
      expect(back.snapshot().tables).toHaveLength(1);
      expect(back.snapshot().session.id).not.toBe(first.id);
      expect(back.snapshot().session.hands).toBe(0);
    });

    it("saves as soon as you've decided", async () => {
      const { room } = open({ tables: 2 });
      room.start();
      await play(room, () => {
        const t = room.snapshot().tables[room.snapshot().focus];
        return !!t?.answer && !!t.turnKey;
      }, CALL);
      await pass(1000);
      const s = room.snapshot();
      // (a plain change, so the half second has begun and one waits)
      room.pick(1 - s.focus);
      room.pick(s.focus);
      vi.mocked(kvSet).mockClear();
      room.choose(s.focus, s.tables[s.focus]!.turnKey!, CALL);
      expect(writes()).toHaveLength(1);
      expect(writes()[0]!.session.score.n).toBe(s.session.score.n + 1);
    });

    it("saves as soon as you've moved with no answer to grade it against", async () => {
      const { room, client } = open({ tables: 2, seat: "UTG" });
      client.solve = () => Promise.reject(new Error("no answer"));
      room.start();
      await play(room, () => room.snapshot().tables.some((t) => !!t.turnKey && !!t.failed), CALL);
      await pass(1000);
      vi.mocked(kvSet).mockClear();
      const at = room.snapshot().tables.findIndex((t) => !!t.turnKey && !!t.failed);
      room.pick(at);
      await pass(1000);
      room.pick(1 - at);
      room.pick(at);
      vi.mocked(kvSet).mockClear();
      // (a call: a fold would end the hand, which goes at once by itself)
      room.ungraded({ action: "call" }, at);
      expect(writes()).toHaveLength(1);
      expect(writes()[0]!.tables[at]!.hand!.decisions.at(-1)!.move.action).toBe("call");
      expect(writes()[0]!.tables[at]!.hand!.result).toBeNull();
    });

    it("writes a hand's end at once, its result and its tallies in the one doc", async () => {
      const { room } = open({ tables: 2 });
      room.start();
      await play(room, () => room.snapshot().session.hands >= 1, 0);
      const d = writes().at(-1)!;
      const over = d.tables.findIndex((t) => t?.hand?.result);
      expect(over).toBeGreaterThanOrEqual(0);
      expect(d.session.hands).toBe(1);
      expect(d.tables[over]!.stats.hands).toBe(1);
      expect(d.tables[over]!.lastHand).toEqual({ n: d.tables[over]!.hand!.n, seat: d.tables[over]!.hand!.hero, result: d.tables[over]!.hand!.result });
      expect(room.snapshot().tables[over]!.lastHand).toEqual(d.tables[over]!.lastHand);
      expect(Object.values(d.session.byPot).reduce((x, t) => x + t.hands, 0)).toBe(1);
    });

    it("writes a hand that ends on an opponent's move at once, inside the half second a plain change waits", async () => {
      await put(doc([kept(hand(0, "BB", { lines: { preflop: ["UTG", "HJ", "CO", "BTN"].map((pos) => ({ pos, action: "fold" as const })), flop: [], turn: [], river: [] } })), kept(hand(1, "UTG"))]));
      const answers = solver();
      let fold = () => {};
      answers.client.play = (_, p) =>
        new Promise((done) => {
          fold = () => done({ data: { pos: p.seat, action: "fold", name: "fold", freq: 1 }, provenance: prov("live") });
        });
      const { room } = await reload({}, answers);
      vi.mocked(kvSet).mockClear();
      fold();
      await flush();
      expect(room.snapshot().session.hands).toBe(1);
      expect(writes().map((d) => d!.session.hands)).toEqual([1]);
    });

    it("otherwise saves at most twice a second, with a steady stream of changes not putting it off", async () => {
      const { room } = open({ tables: 2 }, solver({ quiet: true }));
      room.start();
      await pass(1000);
      vi.mocked(kvSet).mockClear();
      for (let i = 0; i < 30; i += 1) {
        room.pick(i % 2);
        await pass(100);
      }
      expect(writes().length).toBeGreaterThanOrEqual(5);
      expect(writes().length).toBeLessThanOrEqual(7);
      await pass(1000);
      expect((await stored())!.focus).toBe(room.snapshot().focus);
    });

    it("waits out what's left of the half second, not all of it", async () => {
      const { room } = open({ tables: 2 }, solver({ quiet: true }));
      room.start();
      await pass(1000);
      room.pick(1);
      vi.mocked(kvSet).mockClear();
      await pass(400);
      room.pick(0);
      expect(writes()).toEqual([]);
      await pass(99);
      expect(writes()).toEqual([]);
      await pass(1);
      expect(writes().map((d) => d!.focus)).toEqual([0]);
    });

    it("counts the half second from a save that went at once, with one that was waiting gone with it", async () => {
      const { room } = open({ tables: 2 }, solver({ quiet: true }));
      room.start();
      await pass(1000);
      room.pick(1);
      await pass(300);
      room.pick(0);
      room.setTables(3);
      vi.mocked(kvSet).mockClear();
      room.pick(1);
      await pass(499);
      expect(writes()).toEqual([]);
      await pass(1);
      expect(writes().map((d) => d!.focus)).toEqual([1]);
    });

    it("sets no timer where nothing has changed", async () => {
      const { room } = open({ tables: 2 }, solver({ quiet: true }));
      room.start();
      await pass(1000);
      room.setTables(3);
      const timers = vi.getTimerCount();
      room.pump();
      expect(vi.getTimerCount()).toBe(timers);
    });

    it("writes nothing where nothing has changed", async () => {
      const { room } = open({ tables: 2 }, solver({ quiet: true }));
      room.start();
      await pass(1000);
      vi.mocked(kvSet).mockClear();
      room.pump();
      room.pump();
      await pass(2000);
      expect(writes()).toEqual([]);
    });

    it("flushes a save still waiting when it stops, and leaves no timer", async () => {
      const { room } = open({ tables: 2 }, solver({ quiet: true }));
      room.start();
      await pass(1000);
      room.pick(1);
      vi.mocked(kvSet).mockClear();
      room.pick(0);
      expect(writes()).toEqual([]);
      room.stop();
      expect(writes().map((d) => d!.focus)).toEqual([0]);
      expect((await stored())!.focus).toBe(0);
      await pass(2000);
      expect(writes()).toHaveLength(1);
    });

    it("writes nothing as it stops with no save waiting", async () => {
      const { room } = open({ tables: 2 }, solver({ quiet: true }));
      room.start();
      await pass(1000);
      vi.mocked(kvSet).mockClear();
      room.stop();
      expect(writes()).toEqual([]);
    });

    it("writes null at once going to one table, with a save waiting or not, and a reload is then fresh", async () => {
      const { room } = open({ tables: 2 }, solver({ quiet: true }));
      room.start();
      await pass(1000);
      room.pick(1);
      room.pick(0);
      vi.mocked(kvSet).mockClear();
      const id = room.snapshot().session.id;
      room.setTables(1);
      expect(writes()).toEqual([null]);
      await pass(2000);
      expect(writes()).toEqual([null]);
      expect(await stored()).toBeNull();
      room.stop();
      const { room: back } = await reload();
      expect(back.snapshot().tables).toHaveLength(1);
      expect(back.snapshot().session.id).not.toBe(id);
    });

    it("writes at once on any change of tables above one, with a session at one table going on", async () => {
      const { room } = open({}, solver({ quiet: true }));
      room.start();
      await pass(1000);
      const id = room.snapshot().session.id;
      room.setTables(3);
      expect(writes().map((d) => d!.n)).toEqual([3]);
      room.setTables(2);
      expect(writes().map((d) => d!.n)).toEqual([3, 2]);
      expect(writes()[1]!.session.id).toBe(id);
    });

    it("writes a New session above one table at once", async () => {
      const { room } = open({ tables: 2 }, solver({ quiet: true }));
      room.start();
      await pass(100);
      vi.mocked(kvSet).mockClear();
      room.startSession(6, 100, OPTS);
      expect(writes().map((d) => d!.session.id)).toEqual([room.snapshot().session.id]);
    });

    it("clears a kept session with a New session at one table, once", async () => {
      await put(doc([kept(hand(0, "UTG")), kept(hand(1, "UTG"))]));
      const { room } = await reload({}, solver({ quiet: true }));
      room.setTables(1);
      vi.mocked(kvSet).mockClear();
      room.startSession(6, 100, OPTS);
      room.startSession(6, 100, OPTS);
      expect(writes()).toEqual([]);
    });

    it.each([
      ["null", null],
      ["nothing", undefined],
    ])("doesn't touch the doc with a New session at one table where the read says %s", async (_, x) => {
      const { room } = open({ readKept: async () => x }, solver({ quiet: true }));
      room.start();
      await flush();
      room.startSession(6, 100, OPTS);
      await pass(2000);
      expect(writes()).toEqual([]);
    });

    it("clears with a New session at one table a doc it read and couldn't use: that session is given up", async () => {
      await put({ ...doc([kept(hand(0, "UTG")), kept(hand(1, "UTG"))]), v: 2 });
      const { room } = await reload({}, solver({ quiet: true }));
      room.startSession(6, 100, OPTS);
      expect(writes()).toEqual([null]);
    });

    it("waits for a start to write what was done before it", async () => {
      const { room } = open({ tables: 2, readKept: async () => undefined }, solver({ quiet: true }));
      room.setTables(3);
      await pass(1000);
      expect(writes()).toEqual([]);
      room.start();
      await flush();
      expect(writes().map((d) => d!.n)).toEqual([3]);
    });

    it("writes what happened while it was stopped once it starts again", async () => {
      const { room } = open({ tables: 2 }, solver({ quiet: true }));
      room.start();
      await pass(1000);
      room.stop();
      vi.mocked(kvSet).mockClear();
      room.setTables(1);
      expect(writes()).toEqual([]);
      room.start();
      expect(writes()).toEqual([null]);
    });

    describe("a write the browser refuses", () => {
      const refuseOnce = () => vi.mocked(kvSet).mockImplementationOnce(() => Promise.reject(new Error("full")));

      it("goes out again at the next save, though nothing has changed since", async () => {
        const { room } = open({ tables: 2 }, solver({ quiet: true }));
        room.start();
        await pass(1000);
        refuseOnce();
        room.setTables(3);
        await pass(1000);
        expect((await stored())!.n).toBe(2);
        room.pump();
        expect((await stored())!.n).toBe(3);
      });

      it("goes out at the half second like any other, and isn't asked for twice", async () => {
        const { room } = open({ tables: 2 }, solver({ quiet: true }));
        room.start();
        await pass(1000);
        refuseOnce();
        room.setTables(3);
        await flush();
        vi.mocked(kvSet).mockClear();
        room.pump();
        room.pump();
        await pass(499);
        expect(writes()).toEqual([]);
        await pass(1);
        expect(writes().map((d) => d!.n)).toEqual([3]);
      });

      it("goes out as the Room stops, with nothing else to send it", async () => {
        const { room } = open({ tables: 2 }, solver({ quiet: true }));
        room.start();
        await pass(1000);
        refuseOnce();
        room.setTables(3);
        await flush();
        room.stop();
        expect((await stored())!.n).toBe(3);
      });

      it("has a decision's save go out in the end, so a reload has the last of it", async () => {
        const { room } = open({ hands: [hand(0, "UTG"), hand(1, "UTG")] });
        room.start();
        await pass(1000);
        refuseOnce();
        await play(room, () => room.snapshot().session.score.n >= 1);
        const { score } = room.snapshot().session;
        await flush();
        room.stop();
        expect((await stored())!.session.score).toEqual(score);
      });

      it("isn't tried over and over by itself", async () => {
        const { room } = open({ tables: 2 }, solver({ quiet: true }));
        room.start();
        await pass(1000);
        refuseOnce();
        room.setTables(3);
        vi.mocked(kvSet).mockClear();
        await pass(5000);
        expect(writes()).toEqual([]);
      });

      it("leaves a later write that went through as written", async () => {
        const { room } = open({ tables: 2 }, solver({ quiet: true }));
        room.start();
        await pass(1000);
        let refuse = (_: Error) => {};
        vi.mocked(kvSet).mockImplementationOnce(() => new Promise((_, no) => (refuse = no)));
        room.setTables(3);
        room.setTables(4);
        vi.mocked(kvSet).mockClear();
        refuse(new Error("full"));
        await flush();
        room.pump();
        await pass(2000);
        expect(writes()).toEqual([]);
      });

      it("clears the doc after all when going to one table was refused, and a reload is then fresh", async () => {
        const { room } = open({ tables: 2 }, solver({ quiet: true }));
        room.start();
        await pass(1000);
        const { id } = room.snapshot().session;
        refuseOnce();
        room.setTables(1);
        await pass(1000);
        expect(await stored()).not.toBeNull();
        room.pump();
        expect(await stored()).toBeNull();
        room.stop();
        const { room: back } = await reload({}, solver({ quiet: true }));
        expect(back.snapshot().tables).toHaveLength(1);
        expect(back.snapshot().session.id).not.toBe(id);
      });

      it("clears the doc as the Room stops, with nothing else to send it", async () => {
        const { room } = open({ tables: 2 }, solver({ quiet: true }));
        room.start();
        await pass(1000);
        refuseOnce();
        room.setTables(1);
        await flush();
        room.stop();
        expect(await stored()).toBeNull();
      });

      it("clears a doc it couldn't use after all where a New session's clearing was refused", async () => {
        await put({ ...doc([kept(hand(0, "UTG")), kept(hand(1, "UTG"))]), v: 2 });
        const { room } = await reload({}, solver({ quiet: true }));
        refuseOnce();
        room.startSession(6, 100, OPTS);
        await flush();
        expect(await stored()).not.toBeNull();
        room.stop();
        expect(await stored()).toBeNull();
      });
    });

    it("lives with a browser that won't take the doc", async () => {
      const { room } = open({ tables: 2 }, solver({ quiet: true }));
      room.start();
      await pass(1000);
      const refused = Promise.reject(new Error("full"));
      const handled = vi.spyOn(refused, "catch");
      vi.mocked(kvSet).mockImplementationOnce(() => refused);
      room.setTables(3);
      await flush();
      expect(handled).toHaveBeenCalled();
      expect(room.snapshot().tables).toHaveLength(3);
    });
  });

  describe("reload", () => {
    it("can't count a hand twice: a finished hand comes back finished, and its next is dealt with nothing added", async () => {
      const { room } = open({ tables: 2 });
      room.start();
      await play(room, () => room.snapshot().session.hands >= 2, 0);
      const s = room.snapshot();
      expect(hands(s).some((h) => h.result)).toBe(true);
      room.stop();

      const { room: back } = await reload({}, solver({ quiet: true }));
      const q = back.snapshot();
      expect(hands(q)).toEqual(hands(s));
      expect(q.session.hands).toBe(s.session.hands);
      await pass(200);
      const after = back.snapshot();
      expect(after.session.hands).toBe(s.session.hands);
      expect(after.session.net).toBe(s.session.net);
      expect(after.session.byPot).toEqual(s.session.byPot);
      expect(after.tables.map((t) => t.stats)).toEqual(s.tables.map((t) => t.stats));
      expect(after.session.dealt).toBeGreaterThan(s.session.dealt);
      expect(hands(after).every((h) => !h.result)).toBe(true);
    });

    it("doesn't take a finished hand's pause from before the reload", async () => {
      const over = { net: 2, folded: false, winners: ["UTG"], says: "", pays: { UTG: 3.5 } };
      const finished = hand(0, "UTG", { lines: { preflop: [{ pos: "UTG", action: "raise", to: 2.5 }, ...["HJ", "CO", "BTN", "SB", "BB"].map((pos) => ({ pos, action: "fold" as const }))], flop: [], turn: [], river: [] }, result: over });
      await put(doc([kept(finished), kept(hand(1, "UTG"))], { session: session(2, { hands: 1 }) }));
      const { room } = await reload({}, solver({ quiet: true }));
      await pass(99);
      expect(room.snapshot().tables[0]!.hand.result).toEqual(over);
      await pass(1);
      expect(room.snapshot().tables[0]!.hand.result).toBeNull();
      expect(room.snapshot().session.hands).toBe(1);
    });

    it("only ever writes a doc that reads back whole: no hand of its own is lost, whatever stage it was saved at", async () => {
      const { room } = open({ tables: 3 });
      room.start();
      await play(room, () => room.snapshot().session.hands >= 6, CALL);
      await play(room, () => room.snapshot().session.hands >= 12, 0);
      expect(writes().length).toBeGreaterThan(20);
      for (const d of writes()) {
        const k = keptTables(structuredClone(d))!;
        expect(k.session).toEqual(d!.session);
        expect(k.tables).toEqual(d!.tables);
      }
    });

    it("writes nothing for reading a doc, so a tab opened beside another leaves its doc alone, until something changes", async () => {
      await put(doc([kept(hand(0, "UTG")), kept(hand(1, "UTG"))]));
      const { room } = await reload({}, solver({ quiet: true }));
      await pass(2000);
      expect(writes()).toEqual([]);
      room.pick(1);
      expect(writes().map((d) => d!.focus)).toEqual([1]);
    });

    it("keeps the session's one row in History, and leaves it alone until you move", async () => {
      const { room } = open({ tables: 2 });
      room.start();
      await play(room, () => room.snapshot().session.score.n >= 2);
      const { id } = room.snapshot().session;
      room.stop();
      vi.mocked(putSession).mockClear();

      const { room: back, calls } = await reload({});
      await flush();
      expect(calls.length).toBeGreaterThan(0);
      expect(putSession).not.toHaveBeenCalled();

      const before = back.snapshot().session.score.n;
      await play(back, () => back.snapshot().session.score.n > before);
      expect(vi.mocked(putSession).mock.calls.every(([r]) => r.id === id)).toBe(true);
      expect(vi.mocked(putSession).mock.calls.at(-1)![0].meta).toMatchObject({ tables: 2 });
    });

    it("has each table ask what it needs from where its hand stands", async () => {
      await put(doc([kept(hand(0, "UTG")), kept(hand(1, "BB")), kept(hand(2, "HJ", { lines: { preflop: [{ pos: "UTG", action: "fold" }], flop: [], turn: [], river: [] } }))]));
      const { calls } = await reload();
      // (your spots first; an opponent's move is drawn afresh, as none is kept)
      expect(calls.slice(0, 3)).toEqual(["advise UTG quick", "advise HJ quick", "play UTG quick"]);
    });

    it("has asked nothing until the read has answered, and sends nothing twice under StrictMode", async () => {
      await put(doc([kept(hand(0, "UTG")), kept(hand(1, "UTG"))]));
      const answers = solver({ quiet: true });
      const reads: (() => void)[] = [];
      const { room, calls } = open(
        {
          readKept: () =>
            new Promise((done) => {
              reads.push(() => void stored().then(done));
            }),
        },
        answers,
      );
      room.start();
      room.stop();
      room.start();
      await pass(100);
      expect(calls).toEqual([]);
      expect(reads).toHaveLength(2);
      reads[1]!();
      await stored();
      await flush();
      reads[0]!();
      await stored();
      await flush();
      expect(room.snapshot().tables).toHaveLength(2);
      expect(calls).toEqual(["advise UTG quick"]);
    });

    it("goes by the read after a stop, however those before it end", async () => {
      useSettings.setState({ loaded: false });
      const d = doc([kept(hand(0, "UTG")), kept(hand(1, "UTG"))]);
      const reads: { ok: (x: unknown) => void; no: (e: Error) => void }[] = [];
      const { room, calls } = open({ readKept: () => new Promise((ok, no) => reads.push({ ok, no })) });
      room.start();
      room.stop();
      room.start();
      room.stop();
      room.start();
      reads[0]!.no(new Error("gone"));
      await flush();
      expect(calls).toEqual([]);
      // (the one in front of the wait for Settings stays there, with an old read answering behind it)
      reads[2]!.ok(d);
      await flush();
      reads[1]!.ok(d);
      await flush();
      useSettings.setState({ loaded: true });
      await flush();
      expect(room.snapshot().session.id).toBe(d.session.id);
      expect(calls.length).toBeGreaterThan(0);
    });

    it("tells the client the flops of the hands it brought back", async () => {
      const preflop: Move[] = [...["UTG", "HJ", "CO", "BTN"].map((pos) => ({ pos, action: "fold" as const })), { pos: "SB", action: "call" }, { pos: "BB", action: "check" }];
      const onFlop = hand(0, "SB", { shown: 3, lines: { preflop, flop: [], turn: [], river: [] } });
      await put(doc([kept(onFlop), kept(hand(1, "UTG"))]));
      const { prefetched } = await reload();
      expect(prefetched.map((s) => s.board)).toEqual([onFlop.board.slice(0, 3).join("")]);
    });

    it("deals a hand that won't replay again, keeps its results, says so, and says so until you've moved there", async () => {
      const stats = { ...emptyTally(), hands: 5, n: 7, ok: 6, ne: 7, played: 5, net: 12.5 };
      const good = hand(0, "UTG");
      await put(doc([kept(good), kept({ ...hand(1, "UTG"), hero: "nobody" }, { stats })], { focus: 1 }));
      const { room } = await reload({ seat: "UTG" });
      const [first, second] = room.snapshot().tables;
      expect(first!.hand).toEqual(good);
      expect(first!.error).toBeNull();
      expect(second!.stats).toEqual(stats);
      expect(second!.error).toMatch(/dealt again/);
      expect(second!.hand.n).toBe(2);
      expect(second!.hand.hero).toBe("UTG");
      expect(room.snapshot().session.dealt).toBe(3);
      await flush();
      expect(writes().at(-1)!.tables[1]!.hand).toEqual(second!.hand);

      await play(room, () => room.snapshot().session.score.n >= 2);
      expect(room.snapshot().tables[1]!.error).toBeNull();
    });

    it("brings back a hand dealing an instant flop, with its lines, or the index read for them", async () => {
      useSettings.setState({ practiceSpot: null });
      const lines = [["UTG:f", "HJ:f", "CO:f", "BTN:r2.5", "SB:f", "BB:c"]];
      const dealing = hand(1, "BTN", { pot: "lib", cands: lines });
      await put(doc([kept(hand(0, "UTG")), kept(dealing)]));
      const { room } = await reload({ readIndex: async () => new Promise(() => {}) }, solver({ quiet: true }));
      expect(room.snapshot().tables[1]!.hand).toEqual(dealing);

      const waiting = hand(1, "BTN", { pot: "lib" });
      await put(doc([kept(hand(0, "UTG")), kept(waiting)]));
      const back = await reload({ readIndex: async () => null }, solver({ quiet: true }));
      expect(back.room.snapshot().tables[1]!.hand.pot).toBeUndefined();
      expect(back.room.snapshot().tables[1]!.hand.n).toBe(waiting.n);
    });

    it("deals a place that has nothing in it, at the tables in play", async () => {
      await put(doc([kept(hand(0, "UTG")), null as unknown as KeptTable]));
      const { room } = await reload({}, solver({ quiet: true }));
      expect(room.snapshot().tables).toHaveLength(2);
      expect(room.snapshot().tables[1]!.error).toMatch(/dealt again/);
      expect(room.snapshot().tables[1]!.stats).toEqual(emptyTally());
    });

    it("starts fresh on another version of the doc, and leaves it there", async () => {
      const d = { ...doc([kept(hand(0, "UTG")), kept(hand(1, "UTG"))]), v: 2 };
      await put(d);
      const { room, calls } = await reload();
      expect(room.snapshot().tables).toHaveLength(1);
      expect(room.snapshot().session.id).not.toBe(d.session.id);
      expect(calls.length).toBeGreaterThan(0);
      await play(room, () => room.snapshot().session.score.n >= 1);
      room.stop();
      expect(writes()).toEqual([]);
      expect(await stored()).toEqual(d);
    });

    it("starts fresh on a doc that's junk", async () => {
      await put({ v: 1, n: 2, session: "x", tables: [] });
      const { room } = await reload({}, solver({ quiet: true }));
      expect(room.snapshot().tables).toHaveLength(1);
    });

    it("starts fresh on a read that fails, and leaves the doc alone", async () => {
      const d = doc([kept(hand(0, "UTG")), kept(hand(1, "UTG"))]);
      await put(d);
      const { room, calls } = open({ readKept: () => Promise.reject(new Error("no database")) });
      room.start();
      await flush();
      expect(room.snapshot().tables).toHaveLength(1);
      expect(calls.length).toBeGreaterThan(0);
      await play(room, () => room.snapshot().session.score.n >= 1);
      room.stop();
      expect(writes()).toEqual([]);
      expect(await stored()).toEqual(d);
    });

    it("starts fresh on a read that hangs, at KEPT_WAIT, and leaves the doc alone", async () => {
      const d = doc([kept(hand(0, "UTG")), kept(hand(1, "UTG"))]);
      await put(d);
      const { room, calls } = open({ readKept: () => new Promise(() => {}) });
      room.start();
      await pass(999);
      expect(calls).toEqual([]);
      await pass(1);
      expect(calls.length).toBeGreaterThan(0);
      expect(room.snapshot().tables).toHaveLength(1);
      expect(room.snapshot().session.id).not.toBe(d.session.id);
      await play(room, () => room.snapshot().session.score.n >= 1);
      room.stop();
      await pass(2000);
      expect(writes()).toEqual([]);
      expect(await stored()).toEqual(d);
    });

    describe.each<[string, () => RoomOptions["readKept"]]>([
      ["hangs", () => () => new Promise(() => {})],
      ["fails", () => () => Promise.reject(new Error("no database"))],
      ["holds another version", () => () => Promise.resolve({ v: 2 })],
    ])("where the read %s", (_, read) => {
      it("leaves the doc alone through a hand played out at one table and the start of the next", async () => {
        const d = doc([kept(hand(0, "UTG")), kept(hand(1, "UTG"))]);
        await put(d);
        const { room } = open({ readKept: read() });
        room.start();
        await pass(1000);
        await play(room, () => room.snapshot().session.hands >= 1, 0);
        room.nextHand();
        await pass(2000);
        room.stop();
        expect(writes()).toEqual([]);
        expect(await stored()).toEqual(d);
      });

      it("leaves the doc alone through a move with no answer to grade it against", async () => {
        const d = doc([kept(hand(0, "UTG")), kept(hand(1, "UTG"))]);
        await put(d);
        const answers = solver();
        answers.client.solve = () => Promise.reject(new Error("no answer"));
        const { room } = open({ readKept: read() }, answers);
        room.start();
        await pass(1000);
        await play(room, () => !!room.snapshot().tables[0]!.failed && !!room.snapshot().tables[0]!.turnKey);
        room.ungraded({ action: "call" });
        await pass(2000);
        room.stop();
        expect(room.snapshot().tables[0]!.hand.decisions).toHaveLength(1);
        expect(writes()).toEqual([]);
        expect(await stored()).toEqual(d);
      });

      it("gives the doc up all the same with a New session", async () => {
        await put(doc([kept(hand(0, "UTG")), kept(hand(1, "UTG"))]));
        const { room } = open({ readKept: read() }, solver({ quiet: true }));
        room.start();
        await pass(1000);
        room.startSession(6, 100, OPTS);
        expect(writes()).toEqual([null]);
      });
    });

    it("ignores a read that answers after KEPT_WAIT: the fresh session has begun", async () => {
      const d = doc([kept(hand(0, "UTG")), kept(hand(1, "UTG"))]);
      let answer = (_: unknown) => {};
      const { room } = open({ readKept: () => new Promise((r) => (answer = r)) });
      room.start();
      await pass(1000);
      const { id } = room.snapshot().session;
      answer(d);
      await flush();
      expect(room.snapshot().tables).toHaveLength(1);
      expect(room.snapshot().session.id).toBe(id);
    });

    it("leaves the doc alone after a hung read even with a change of tables undone during it", async () => {
      await put(doc([kept(hand(0, "UTG")), kept(hand(1, "UTG"))]));
      const { room } = open({ readKept: () => new Promise(() => {}) });
      room.start();
      room.setTables(2);
      room.setTables(1);
      await pass(2000);
      room.stop();
      expect(writes()).toEqual([]);
    });

    it("brings a session back in place of a change of tables made during the read, which held nothing yet", async () => {
      const d = doc([kept(hand(0, "UTG")), kept(hand(1, "UTG")), kept(hand(2, "UTG"))]);
      await put(d);
      let answer = (_: unknown) => {};
      const { room } = open({ readKept: () => new Promise((r) => (answer = r)) }, solver({ quiet: true }));
      room.start();
      room.setTables(2);
      answer(d);
      await flush();
      expect(room.snapshot().tables).toHaveLength(3);
      expect(room.snapshot().session.id).toBe(d.session.id);
    });

    it("lets a New session during the read win, and the old doc go with it", async () => {
      const d = doc([kept(hand(0, "UTG")), kept(hand(1, "UTG"))]);
      await put(d);
      let answer = (_: unknown) => {};
      const { room, calls } = open({ readKept: () => new Promise((r) => (answer = r)) });
      room.start();
      room.startSession(2, 100, OPTS);
      const { id } = room.snapshot().session;
      answer(d);
      await flush();
      expect(room.snapshot().tables).toHaveLength(1);
      expect(room.snapshot().session.id).toBe(id);
      expect(calls.length).toBeGreaterThan(0);
      expect(writes()).toEqual([null]);
      expect(await stored()).toBeNull();
    });

    it("waits for Settings before a restored session deals or asks, then plays at their mode", async () => {
      useSettings.setState({ loaded: false });
      const d = doc([kept(hand(0, "UTG")), kept(hand(1, "UTG"))]);
      await put(d);
      const { room, calls } = await reload();
      await pass(500);
      expect(calls).toEqual([]);
      expect(room.snapshot().session.id).not.toBe(d.session.id);
      useSettings.setState({ mode: "accurate", loaded: true });
      await flush();
      expect(room.snapshot().session.id).toBe(d.session.id);
      expect(calls[0]).toBe("advise UTG accurate");
    });

    it("waits for Settings on the read's own bound, no longer", async () => {
      useSettings.setState({ loaded: false });
      const d = doc([kept(hand(0, "UTG")), kept(hand(1, "UTG"))]);
      let answer = (_: unknown) => {};
      const { room, calls } = open({ readKept: () => new Promise((r) => (answer = r)) });
      room.start();
      await pass(900);
      answer(d);
      await flush();
      await pass(99);
      expect(calls).toEqual([]);
      await pass(1);
      expect(room.snapshot().session.id).toBe(d.session.id);
      expect(calls[0]).toBe("advise UTG quick");
    });

    it("doesn't wait for Settings where nothing came back, as only App loads them", async () => {
      useSettings.setState({ loaded: false });
      const { calls } = await reload();
      expect(calls.length).toBeGreaterThan(0);
    });

    it("isn't woken by Settings changing before they've loaded", async () => {
      useSettings.setState({ loaded: false });
      const d = doc([kept(hand(0, "UTG")), kept(hand(1, "UTG"))]);
      await put(d);
      const { room, calls } = await reload();
      useSettings.setState({ mode: "accurate" });
      await flush();
      expect(calls).toEqual([]);
      expect(room.snapshot().session.id).not.toBe(d.session.id);
    });

    it("lets a New session win while a restored session waits for Settings", async () => {
      useSettings.setState({ loaded: false });
      const d = doc([kept(hand(0, "UTG")), kept(hand(1, "UTG"))]);
      await put(d);
      const { room } = await reload({}, solver({ quiet: true }));
      room.startSession(6, 100, OPTS);
      const { id } = room.snapshot().session;
      useSettings.setState({ loaded: true });
      await pass(2000);
      expect(room.snapshot().session.id).toBe(id);
      expect(room.snapshot().tables).toHaveLength(1);
    });

    it("reads again after a stop during the wait for Settings, and brings the session back then", async () => {
      useSettings.setState({ loaded: false });
      const d = doc([kept(hand(0, "UTG")), kept(hand(1, "UTG"))]);
      await put(d);
      const { room } = await reload({}, solver({ quiet: true }));
      room.stop();
      useSettings.setState({ loaded: true });
      await flush();
      expect(room.snapshot().session.id).not.toBe(d.session.id);
      room.start();
      await stored();
      await flush();
      expect(room.snapshot().session.id).toBe(d.session.id);
    });

    it("holds to the tables it was told to start with, whatever is kept", async () => {
      await put(doc([kept(hand(0, "UTG")), kept(hand(1, "UTG")), kept(hand(2, "UTG"))]));
      const { room } = await reload({ tables: 2 }, solver({ quiet: true }));
      expect(room.snapshot().tables).toHaveLength(2);
      expect(room.snapshot().session.dealt).toBe(2);
      const test = hand(5, "UTG");
      const { room: spots } = await reload({ hands: [test] }, solver({ quiet: true }));
      expect(hands(spots.snapshot())).toEqual([test]);
    });

    it("touches nothing with persist off", async () => {
      await put(doc([kept(hand(0, "UTG")), kept(hand(1, "UTG"))]));
      const readKept = vi.fn(async () => undefined);
      const { room } = open({ persist: false, readKept, tables: 2 });
      room.start();
      await play(room, () => room.snapshot().session.hands >= 1);
      room.pick(1);
      room.setTables(1);
      room.stop();
      expect(readKept).not.toHaveBeenCalled();
      expect(writes()).toEqual([]);
      expect(putSession).not.toHaveBeenCalled();
    });

    it("reads this key by itself", async () => {
      const d = doc([kept(hand(0, "UTG")), kept(hand(1, "UTG"))]);
      await kvSet("practice.tables.v1", d);
      const { room } = await reload({}, solver({ quiet: true }));
      expect(room.snapshot().session.id).toBe(d.session.id);
    });
  });
});
