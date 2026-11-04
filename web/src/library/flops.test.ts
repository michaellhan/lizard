// The flop library as Instant flops reads it (flops.ts): multitable.test.js:423's flop names against a published spot's, a
// Lizard line's tokens against the index's, the games a spot counts for, and a chart's draw. The fixture is the index's own
// shape, cut down: all of srp_btn_bb's names, as solver/gto/static/flop_library/ is gitignored, and two spots of a few.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Move } from "@/poker/table";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import index from "./fixtures/srp_btn_bb.flops.json";
import { candsFor, chartKey, chartMove, chartState, flopIndex, flopName, gamesHeld, gameWords, heldSpots, instantSpots, isChart, libFlop, lineToken } from "./flops";

const fold = (pos: string): Move => ({ pos, action: "fold" });
const SRP: Move[] = [fold("UTG"), fold("HJ"), fold("CO"), { pos: "BTN", action: "raise", to: 2.5 }, fold("SB"), { pos: "BB", action: "call" }];
const THREE_BET: Move[] = [fold("UTG"), fold("HJ"), fold("CO"), { pos: "BTN", action: "raise", to: 2.5 }, fold("SB"), { pos: "BB", action: "raise", to: 10 }, { pos: "BTN", action: "call" }];

const spots = instantSpots(index);
const [srp, threeBet, headsUp] = spots;
const names = Object.keys(index.spots[0]!.flops);
const SIX = { players: 6, stack: 100 };

describe("flopName", () => {
  it("names each flop the library stores, and any suit swap of it, as the library does (multitable.test.js:423)", () => {
    expect(names).toHaveLength(1755);
    const swap: Record<string, string> = { c: "h", d: "s", h: "c", s: "d" };
    const off = names.filter((nm) => {
      const cs = [nm.slice(0, 2), nm.slice(2, 4), nm.slice(4, 6)];
      return flopName(cs) !== nm || flopName(cs.map((c) => c[0]! + swap[c[1]!]!).reverse()) !== nm;
    });
    expect(off).toEqual([]);
  });

  it("takes the least of the suit permutations, high card first", () => {
    expect(flopName(["2c", "Kd", "7s"])).toBe("Kc7d2h");
    expect(flopName(["Ks", "2s", "Qs"])).toBe("KcQc2c");
    expect(flopName(["Ah", "Ad", "3d"])).toBe("AdAc3c");
    expect(flopName(["2h", "2d", "2s"])).toBe("2h2d2c");
  });
});

describe("lineToken", () => {
  it("writes a move as the index's line does", () => {
    expect(lineToken(fold("UTG"))).toBe("UTG:f");
    expect(lineToken({ pos: "BB", action: "call" })).toBe("BB:c");
    expect(lineToken({ pos: "BB", action: "check" })).toBe("BB:x");
    expect(lineToken({ pos: "BTN", action: "all-in" })).toBe("BTN:a");
    expect(lineToken({ pos: "BTN", action: "raise", to: 2.5 })).toBe("BTN:r2.5");
    expect(lineToken({ pos: "BB", action: "raise", to: 10 })).toBe("BB:r10");
    expect(lineToken({ pos: "SB", action: "bet", to: 7.125 })).toBe("SB:r7.13");
  });

  it("makes a Lizard line the index's `line`", () => {
    expect(SRP.map(lineToken).join()).toBe(index.spots[0]!.line);
    expect(THREE_BET.map(lineToken).join()).toBe(index.spots[1]!.line);
  });
});

describe("instantSpots", () => {
  it("reads a spot's line, who's left in it, and its flops", () => {
    expect(spots.map((s) => s.id)).toEqual(["srp_btn_bb", "3bp_bb_btn", "srp_sb_bb_2max"]);
    expect(srp).toMatchObject({ id: "srp_btn_bb", label: "BTN vs BB single-raised pot", players: ["BTN", "BB"] });
    expect(srp!.toks).toEqual(SRP.map(lineToken));
    expect(srp!.flops.size).toBe(1755);
    expect(srp).not.toHaveProperty("game");
    expect(headsUp!.game).toEqual({ players: 2, stack: 100, ante: 0, straddle: false });
    // (a 3-bet line names a seat twice: it's still one seat in the hand, and `includes` asks no more of it)
    expect(threeBet!.players).toContain("BB");
    expect(threeBet!.players).not.toContain("SB");
  });

  it("holds nothing from what isn't an index", () => {
    for (const x of [null, undefined, "index", {}, { spots: 7 }, { spots: [null, {}, { line: "UTG:f" }, { flops: {} }] }]) expect(instantSpots(x)).toEqual([]);
  });

  it("passes over a spot whose line isn't a string, and keeps the rest", () => {
    const flops = { AhKhQh: 1 };
    for (const line of [5, true, "", ["UTG:f"], { a: 1 }]) expect(instantSpots({ spots: [{ id: "bad", line, flops }, { id: "good", line: "UTG:f", flops }] }).map((s) => s.id)).toEqual(["good"]);
  });
});

describe("heldSpots", () => {
  it("reads a spot with no `game` as 6-max 100bb", () => {
    expect(heldSpots(spots, SIX).map((s) => s.id)).toEqual(["srp_btn_bb", "3bp_bb_btn"]);
    expect(heldSpots(spots, { ...SIX, ante: 0, straddle: false, rake: 0, sizes: null }).map((s) => s.id)).toEqual(["srp_btn_bb", "3bp_bb_btn"]);
    expect(heldSpots(spots, { ...SIX, sizes: {} }).map((s) => s.id)).toEqual(["srp_btn_bb", "3bp_bb_btn"]);
  });

  it("matches a spot's own `game`", () => {
    expect(heldSpots(spots, { players: 2, stack: 100 }).map((s) => s.id)).toEqual(["srp_sb_bb_2max"]);
    const straddled = spots.map((s) => ({ ...s, game: { players: 6, stack: 100, ante: 0.5, straddle: true } }));
    expect(heldSpots(straddled, { players: 6, stack: 100, ante: 0.5, straddle: true })).toHaveLength(3);
    expect(heldSpots(straddled, { players: 6, stack: 100, ante: 0.5 })).toEqual([]);
    expect(heldSpots(straddled, { players: 6, stack: 100, straddle: true })).toEqual([]);
  });

  it("holds nothing of another game, or under a rake or your own sizes", () => {
    expect(heldSpots(spots, { players: 9, stack: 100 })).toEqual([]);
    expect(heldSpots(spots, { players: 6, stack: 40 })).toEqual([]);
    expect(heldSpots(spots, { ...SIX, ante: 0.1 })).toEqual([]);
    expect(heldSpots(spots, { ...SIX, straddle: true })).toEqual([]);
    expect(heldSpots(spots, { ...SIX, rake: 5 })).toEqual([]);
    expect(heldSpots(spots, { ...SIX, sizes: { flop: [50] } })).toEqual([]);
  });

  it("says the games held in words, once each", () => {
    expect(gamesHeld(spots)).toEqual(["6-max 100bb", "Heads-up 100bb"]);
    expect(gamesHeld([])).toEqual([]);
    expect(gameWords({ players: 9, stack: 40, ante: 0.5, straddle: true })).toBe("9-max 40bb ante 0.5 straddle");
  });
});

describe("candsFor", () => {
  const six = heldSpots(spots, SIX);
  const flop = names[100]!;
  const board = [flop.slice(0, 2), flop.slice(2, 4), flop.slice(4, 6), "2c", "3c"];

  it("gives the lines with you in them and this flop held there, as tokens", () => {
    expect(names.indexOf(flop)).toBeGreaterThanOrEqual(40);
    expect(candsFor(six, "BTN", board)).toEqual([srp!.toks]);
    expect(candsFor(six, "SB", board)).toEqual([]);
    const held = names[3]!;
    expect(candsFor(six, "BB", [held.slice(0, 2), held.slice(2, 4), held.slice(4, 6)])).toEqual([srp!.toks, threeBet!.toks]);
  });

  it("reads the flop by its name, whatever its suits and order", () => {
    const swap: Record<string, string> = { c: "d", d: "h", h: "s", s: "c" };
    const swapped = board.slice(0, 3).map((c) => c[0]! + swap[c[1]!]!).reverse();
    expect(candsFor(six, "BTN", swapped)).toEqual([srp!.toks]);
  });
});

describe("libFlop", () => {
  const six = heldSpots(spots, SIX);
  const q = (board: string, preflop = SRP): AdvisorState => ({ players: 6, board, preflop, flop: [], turn: [], river: [] });
  const [held, notThree] = [names[3]!, names[100]!];

  it("is the line and the flop held together", () => {
    expect(libFlop(six, q(held))).toBe(true);
    expect(libFlop(six, q(notThree))).toBe(true);
    expect(libFlop(six, q(held, THREE_BET))).toBe(true);
    expect(libFlop(six, q(notThree, THREE_BET))).toBe(false);
    expect(libFlop(six, q(held, SRP.slice(0, 5)))).toBe(false);
    expect(libFlop([], q(held))).toBe(false);
  });
});

describe("flopIndex", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the resolved library's index, or the first source's before there's one, never from the cache", async () => {
    const read = vi.fn(async () => new Response(JSON.stringify(index)));
    vi.stubGlobal("fetch", read);
    expect(instantSpots(await flopIndex("gto-solver-library"))).toHaveLength(3);
    expect(read).toHaveBeenLastCalledWith("/gto-solver-library/index.json", { cache: "no-cache" });
    await flopIndex(null);
    expect(read).toHaveBeenLastCalledWith("/lizard-library/index.json", { cache: "no-cache" });
  });
});

describe("a preflop chart", () => {
  const q: AdvisorState = { players: 6, hero: "BTN", hole: "AsKs", board: "", stack: 100, preflop: [fold("UTG")], flop: [], turn: [], river: [] };
  const chart = (o: Partial<AdvisorResponse> = {}): AdvisorResponse => ({
    study: "node",
    street: "preflop",
    actor: "HJ",
    actions: [
      { action: "fold", freq: 0.5 },
      { action: "call", freq: 0 },
      { action: "raise 2.5", freq: 0.5, amount_bb: 2.5 },
    ],
    grid: { actions: ["fold", "call", "raise 2.5"], cells: { AKs: { w: 1, f: [0.25, 0, 0.75] }, "72o": { w: 1, f: [0, 0, 0] } } },
    ...o,
  });

  it("is one request a node, whoever asks, in the classic's shape (multitable.test.js:503)", () => {
    expect(chartKey(q)).toBe(chartKey({ ...q, hero: "HJ", hole: "7c2d" }));
    expect(chartKey(q)).not.toBe(chartKey({ ...q, preflop: [] }));
    expect(chartKey(q)).not.toBe(chartKey({ ...q, stack: 40 }));
    expect(chartKey(q)).not.toBe(chartKey({ ...q, players: 5 }));
    expect(chartState(q)).toEqual({ players: 6, stack: 100, board: "", preflop: q.preflop, flop: [], turn: [], river: [], study: true });
  });

  it("is an answer that can be drawn from, or none", () => {
    expect(isChart(chart())).toBe(true);
    expect(isChart(chart({ error: "no chart" }))).toBe(false);
    expect(isChart(chart({ study: "pf_none" }))).toBe(false);
    expect(isChart(chart({ street: "flop" }))).toBe(false);
    expect(isChart(chart({ grid: undefined }))).toBe(false);
    expect(isChart(chart({ actions: undefined }))).toBe(false);
  });

  it("draws by the hand class's mix, not the node's, and nothing it doesn't play", () => {
    expect(chartMove(chart(), "HJ", "AsKs", () => 0)).toEqual({ pos: "HJ", action: "fold", name: "fold", freq: 0.25 });
    expect(chartMove(chart(), "HJ", "KdAd", () => 0.24)).toMatchObject({ action: "fold" });
    expect(chartMove(chart(), "HJ", "AsKs", () => 0.26)).toEqual({ pos: "HJ", action: "raise", name: "raise 2.5", freq: 0.75, to: 2.5 });
    expect(chartMove(chart(), "HJ", "AsKs", () => 0.999)).toMatchObject({ action: "raise" });
  });

  it("sizes a bet and a raise, and names an all-in or a call as it is", () => {
    const actions = [{ action: "call", freq: 0 }, { action: "bet 3", freq: 0, amount_bb: 3.333 }, { action: "all-in", freq: 0, amount_bb: 100 }];
    const only = (i: number) => chart({ actions, grid: { actions: actions.map((a) => a.action), cells: { AKs: { w: 1, f: actions.map((_, k) => (k === i ? 1 : 0)) } } } });
    expect(chartMove(only(0), "HJ", "AsKs")).toEqual({ pos: "HJ", action: "call", name: "call", freq: 1 });
    expect(chartMove(only(1), "HJ", "AsKs")).toEqual({ pos: "HJ", action: "bet", name: "bet 3", freq: 1, to: 3.33 });
    expect(chartMove(only(2), "HJ", "AsKs")).toEqual({ pos: "HJ", action: "all-in", name: "all-in", freq: 1 });
  });

  it("plays what a mix of nothing gives, from all of it, as the classic does", () => {
    expect(chartMove(chart(), "HJ", "7c2d", () => 0.5)).toMatchObject({ action: "fold", freq: 0 });
  });

  it("takes nothing the mix doesn't play ahead of what it does, on a draw of 0 too", () => {
    const actions = [{ action: "fold", freq: 0 }, { action: "raise 2.5", freq: 0, amount_bb: 2.5 }];
    const late = chart({ actions, grid: { actions: actions.map((a) => a.action), cells: { AKs: { w: 1, f: [0, 1] } } } });
    expect(chartMove(late, "HJ", "AsKs", () => 0)).toMatchObject({ action: "raise", freq: 1 });
  });

  it("gives no move where the chart can't say", () => {
    expect(chartMove(chart(), "CO", "AsKs")).toBeNull();
    expect(chartMove(chart({ grid: { actions: ["fold", "raise 2.5"], cells: { AKs: { w: 1 } as never } } }), "HJ", "AsKs")).toBeNull();
    expect(chartMove(chart(), "HJ", "QdJc")).toBeNull();
    expect(chartMove(chart({ actions: [{ action: "fold", freq: 1 }] }), "HJ", "AsKs")).toBeNull();
    expect(chartMove(chart({ grid: undefined }), "HJ", "AsKs")).toBeNull();
  });
});
