import { describe, expect, it } from "vitest";
import { noLines, type Move } from "@/poker/table";
import type { AdvisorResponse } from "@/solver/protocol";
import {
  decide,
  decideUngraded,
  dealNext,
  finish,
  heroSeat,
  newHand,
  offDrill,
  phaseOf,
  redeal,
  seeking,
  shownCards,
  simOf,
  stateFor,
  villainMove,
  withVillain,
  type PracticeHand,
} from "./practice";

// a hand dealt by hand: your seat, everyone's cards, the board
function fixed(players: number, hero: string, hands: Record<string, string>, board: string, stack = 100): PracticeHand {
  return {
    seed: 0,
    n: 0,
    players,
    stack,
    hero,
    hands: Object.fromEntries(Object.entries(hands).map(([p, c]) => [p, [c.slice(0, 2), c.slice(2, 4)] as [string, string]])),
    board: board.match(/../g)!,
    shown: 0,
    lines: noLines(),
    decisions: [],
    result: null,
  };
}
const play = (h: PracticeHand, ...ms: Move[]) => ms.reduce((x, m) => withVillain(x, m), h);

// the preflop chart's answer for the button: frequencies, no EVs
const CHART: AdvisorResponse = {
  street: "preflop",
  pot_bb: 1.5,
  actions: [
    { action: "fold", freq: 0.3 },
    { action: "call", freq: 0.05 },
    { action: "raise 2.5", freq: 0.65, amount_bb: 2.5 },
  ],
};

describe("seats and dealing", () => {
  it("moves your seat one place each hand, from the button", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((n) => heroSeat(n, 6))).toEqual(["BTN", "CO", "HJ", "UTG", "BB", "SB", "BTN"]);
    expect([0, 1, 2].map((n) => heroSeat(n, 2))).toEqual(["SB", "BB", "SB"]);
    expect([2, 3].map((n) => heroSeat(n, 9))).toEqual(["HJ", "LJ"]);
  });

  it("your seat as chosen: moving, at random from the seed, or one seat (one the table lacks moves)", () => {
    expect(newHand(6, 100, 3, 5, { seat: "BB" }).hero).toBe("BB");
    expect([5, 7, 12].map((seed) => newHand(6, 100, 0, seed, { seat: "random" }).hero)).toEqual(["BB", "HJ", "UTG"]);
    expect(newHand(6, 100, 2, 5, { seat: "LJ" }).hero).toBe("HJ");
    expect(newHand(6, 100, 2, 5).hero).toBe("HJ");
  });

  it("preflop only: the hand stops as the preflop closes, nothing settled and no card shown; a walk is played out", () => {
    let h = newHand(3, 100, 0, 9, { preflopOnly: true });
    h = play(h, { pos: "BTN", action: "raise", to: 2.5 }, { pos: "SB", action: "fold" }, { pos: "BB", action: "call" });
    expect(phaseOf(h)).toEqual({ kind: "over" });
    const r = finish(h);
    expect(r).toEqual({ net: 0, folded: false, winners: [], says: "", pays: {}, cut: true });
    expect(shownCards({ ...h, result: r }, "BB")).toBeNull();
    // in the big blind, folded to
    const w = play(newHand(3, 100, 0, 9, { seat: "BB", preflopOnly: true }), { pos: "BTN", action: "fold" }, { pos: "SB", action: "fold" });
    expect(finish(w)).toMatchObject({ net: 0.5, winners: ["BB"] });
    expect(finish(w).cut).toBeUndefined();
  });

  it("pot drills: your preflop played for you, the hand off course where it goes another way, dealt again", () => {
    const f = (x: string) => ({ pos: x, action: "fold" as const });
    // a 3-bet pot from the button: the cutoff opens, you 3-bet (played for you), it calls
    let h = newHand(6, 100, 0, 9, { seat: "BTN", pot: "3bet" });
    expect(h).toMatchObject({ hero: "BTN", pot: "3bet" });
    expect(h.preflopOnly).toBeUndefined();
    h = play(h, f("UTG"), f("HJ"), { pos: "CO", action: "raise", to: 2.5 });
    expect(phaseOf(h)).toEqual({ kind: "auto", street: "preflop", seat: "BTN" });
    expect(seeking(h)).toBe(true);
    h = play(h, { pos: "BTN", action: "raise", to: 7.5 }, f("SB"), f("BB"));
    expect(offDrill(h)).toBe(false);
    const on = play(h, { pos: "CO", action: "call" });
    expect(offDrill(on)).toBe(false);
    expect(phaseOf(on)).toEqual({ kind: "deal", street: "flop" });
    const flop = dealNext(on, "flop");
    expect(seeking(flop)).toBe(false);
    expect(phaseOf(flop)).toEqual({ kind: "villain", street: "flop", seat: "CO" });
    // a 4-bet, a fold, an all-in, three to the flop: off course
    expect(offDrill(play(h, { pos: "CO", action: "raise", to: 20 }))).toBe(true);
    expect(offDrill(play(h, f("CO")))).toBe(true);
    expect(offDrill(play(h, { pos: "CO", action: "all-in" }))).toBe(true);
    const srp = play(newHand(6, 100, 0, 9, { seat: "BB", pot: "srp" }), f("UTG"), f("HJ"), { pos: "CO", action: "raise", to: 2.5 }, f("BTN"), { pos: "SB", action: "call" });
    expect(offDrill(srp)).toBe(false);
    expect(offDrill(play(srp, { pos: "BB", action: "call" }))).toBe(true);
    expect(offDrill(play(srp, f("BB")))).toBe(true);
    // blind vs blind: you're in a blind (the chosen one, else moving from the small blind); anyone else in is off course
    expect([0, 1, 2].map((n) => newHand(6, 100, n, 9, { pot: "bvb" }).hero)).toEqual(["SB", "BB", "SB"]);
    expect(newHand(6, 100, 0, 9, { seat: "BB", pot: "bvb" }).hero).toBe("BB");
    expect(newHand(6, 100, 0, 9, { seat: "CO", pot: "bvb" }).hero).toBe("SB");
    const bvb = play(newHand(6, 100, 1, 9, { pot: "bvb" }), f("UTG"), f("HJ"), f("CO"), f("BTN"), { pos: "SB", action: "call" }, { pos: "BB", action: "check" });
    expect(offDrill(bvb)).toBe(false);
    expect(phaseOf(bvb)).toEqual({ kind: "deal", street: "flop" });
    expect(offDrill(play(newHand(6, 100, 1, 9, { pot: "bvb" }), f("UTG"), { pos: "HJ", action: "call" }))).toBe(true);
    // dealt again: the same hand number and seat, another deal, the tries counted
    const again = redeal(redeal(h, 77, { seat: "BTN", pot: "3bet" }), 78, { seat: "BTN", pot: "3bet" });
    expect(again).toMatchObject({ n: 0, hero: "BTN", pot: "3bet", tries: 2, seed: 78 });
    expect(again.lines.preflop).toEqual([]);
  });

  it("deals every seat and the board from the hand's seed, the same again", () => {
    const h = newHand(6, 100, 0, 42);
    expect(Object.keys(h.hands)).toEqual(["UTG", "HJ", "CO", "BTN", "SB", "BB"]);
    expect(h.board).toHaveLength(5);
    expect(newHand(6, 100, 0, 42)).toEqual(h);
    expect(newHand(6, 100, 0, 43).hands).not.toEqual(h.hands);
  });

  it("asks the solver from your seat, with the action so far", () => {
    let h = fixed(6, "BTN", { BTN: "AhKd" }, "Ks7d2c9h3s");
    h = play(h, { pos: "UTG", action: "fold" }, { pos: "HJ", action: "raise", to: 2.5 });
    expect(stateFor(h)).toEqual({
      players: 6,
      hero: "BTN",
      hole: "AhKd",
      board: "",
      stack: 100,
      preflop: [
        { pos: "UTG", action: "fold" },
        { pos: "HJ", action: "raise", to: 2.5 },
      ],
      flop: [],
      turn: [],
      river: [],
    });
  });
});

describe("the hand's flow", () => {
  it("opponents act, then you; cards are dealt as streets close", () => {
    let h = fixed(6, "BTN", { BTN: "AhKd" }, "Ks7d2c9h3s");
    expect(phaseOf(h)).toEqual({ kind: "villain", street: "preflop", seat: "UTG" });
    h = play(h, { pos: "UTG", action: "fold" }, { pos: "HJ", action: "fold" }, { pos: "CO", action: "fold" });
    expect(phaseOf(h)).toEqual({ kind: "hero", street: "preflop" });
    const r = decide(h, CHART, 2, null);
    if ("error" in r) throw new Error(r.error);
    expect(r.decision.move).toEqual({ pos: "BTN", action: "raise", to: 2.5 });
    h = play(r.hand, { pos: "SB", action: "fold" }, { pos: "BB", action: "call" });
    expect(phaseOf(h)).toEqual({ kind: "deal", street: "flop" });
    h = dealNext(h, "flop");
    expect([h.shown, phaseOf(h)]).toEqual([3, { kind: "villain", street: "flop", seat: "BB" }]);
  });

  it("grades a chart decision by frequency, a solved one by EV given up", () => {
    const h = play(fixed(6, "BTN", { BTN: "AhKd" }, "Ks7d2c9h3s"), ...["UTG", "HJ", "CO"].map((pos) => ({ pos, action: "fold" }) as Move));
    const best = decide(h, CHART, 2, null);
    const rare = decide(h, CHART, 1, null);
    if ("error" in best || "error" in rare) throw new Error();
    expect([best.decision.grade?.verdict, best.decision.grade?.byEv]).toEqual(["Best", false]);
    expect(rare.decision.grade?.verdict).toBe("Inaccuracy"); // played 5% of the time
    expect(rare.decision.move).toEqual({ pos: "BTN", action: "call" });
    // on the flop, with EVs: 1bb given up in a 5.5bb pot is a Blunder (18%)
    let f = play(rare.hand, { pos: "SB", action: "fold" }, { pos: "BB", action: "check" });
    f = play(dealNext(f, "flop"), { pos: "BB", action: "check" });
    const solved: AdvisorResponse = {
      street: "flop",
      pot_bb: 5.5,
      actions: [
        { action: "check", freq: 0.95, ev_bb: 3 },
        { action: "bet 33%", freq: 0.05, ev_bb: 2, amount_bb: 1.8 },
      ],
    };
    const bet = decide(f, solved, 1, null);
    if ("error" in bet) throw new Error(bet.error);
    expect(bet.decision.grade).toMatchObject({ verdict: "Blunder", byEv: true, loss: 1 });
    expect(bet.decision.move).toEqual({ pos: "BTN", action: "bet", to: 2 }); // (to the half big blind)
    expect(bet.decision.mix.map((x) => x.ev)).toEqual([3, 2]);
  });

  it("records an ungraded move where the solve failed, refusing an illegal one", () => {
    const h = fixed(2, "SB", { SB: "AhKd" }, "Ks7d2c9h3s");
    expect(decideUngraded(h, { action: "check" })).toBe("SB can't check, there's 0.5bb to call.");
    const next = decideUngraded(h, { action: "call" });
    if (typeof next === "string") throw new Error(next);
    expect(next.decisions[0]).toMatchObject({ grade: null, chose: "call" });
  });

  it("takes an opponent's move as the table allows it", () => {
    const h = fixed(2, "BB", { SB: "QcQd" }, "Ks7d2c9h3s");
    expect(villainMove(h, { action: "raise", to: 1.6 })).toEqual({ pos: "SB", action: "raise", to: 2 }); // lifted to the minimum
    expect(villainMove(h, { action: "raise", to: 400 })).toEqual({ pos: "SB", action: "all-in" });
    expect(villainMove(h, { action: "check" })).toEqual({ pos: "SB", action: "call" }); // (can't check facing the blind)
  });
});

describe("the hand's end", () => {
  it("your fold: what you put in is lost, the others' cards stay hidden", () => {
    let h = fixed(2, "BB", { SB: "QcQd", BB: "7h2c" }, "Ks7d2c9h3s");
    h = play(h, { pos: "SB", action: "raise", to: 3 }, { pos: "BB", action: "fold" });
    expect(phaseOf(h)).toEqual({ kind: "over" });
    const r = finish(h);
    expect(r).toMatchObject({ net: -1, folded: true });
    expect(shownCards({ ...h, result: r }, "SB")).toBeNull();
    expect(shownCards({ ...h, result: r }, "BB")).toEqual(["7h", "2c"]);
  });

  it("a showdown: the pot to the best hand, said in a line, the cards shown", () => {
    let h = fixed(3, "BTN", { BTN: "Qh4h", SB: "Kc7c", BB: "2d3s" }, "Kd7d9h2hJh");
    const checks = (...ps: string[]) => ps.map((pos) => ({ pos, action: "check" }) as Move);
    h = play(h, { pos: "BTN", action: "call" }, { pos: "SB", action: "call" }, { pos: "BB", action: "check" });
    for (const st of ["flop", "turn", "river"] as const) h = play(dealNext(h, st), ...checks("SB", "BB", "BTN"));
    expect(phaseOf(h)).toEqual({ kind: "over" });
    const r = finish(h);
    expect([r.net, r.winners, r.says]).toEqual([2, ["BTN"], "Your Q-high flush beats SB's two pair, kings and sevens"]);
    expect(shownCards({ ...h, result: r }, "SB")).toEqual(["Kc", "7c"]);
  });

  it("an all-in runs the board out to the river, then settles", () => {
    let h = fixed(2, "SB", { SB: "AhAd", BB: "KhKd" }, "2c7d9hJs3s", 20);
    h = play(h, { pos: "SB", action: "all-in" }, { pos: "BB", action: "call" });
    const steps: string[] = [];
    for (let p = phaseOf(h); p.kind === "deal"; p = phaseOf(h)) {
      steps.push(p.street);
      h = dealNext(h, p.street);
    }
    expect(steps).toEqual(["flop", "turn", "river"]);
    expect(simOf(h).handOver).toBe(true);
    expect(finish(h)).toMatchObject({ net: 20, winners: ["SB"], says: "Your pair of aces beats BB's pair of kings" });
  });
});
