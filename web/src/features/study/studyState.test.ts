import { describe, expect, it } from "vitest";
import type { AdvisorResponse } from "@/solver/protocol";
import {
  back,
  deal,
  randomReplacement,
  readReplacement,
  replaceCards,
  describeLine,
  encodeLine,
  forward,
  freshHand,
  fromSearch,
  lineOf,
  lineSteps,
  onLine,
  parseLine,
  play,
  potOdds,
  randomCards,
  readCards,
  streetOf,
  studyKey,
  studyRequest,
  toSearch,
  type StudyHand,
} from "./studyState";

const LINE = "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c";

describe("study line encoding", () => {
  it("reads the library index's preflop line format and writes it back unchanged", () => {
    const acts = parseLine(LINE);
    expect(acts[3]).toEqual({ pos: "BTN", action: "raise", to: 2.5 });
    expect(acts[5]).toEqual({ pos: "BB", action: "call" });
    expect(encodeLine(acts)).toBe(LINE);
  });

  it("round-trips a whole hand through the URL", () => {
    const h = { ...freshHand(6, 100), preflop: parseLine(LINE), board: "Ks7d2c", flop: parseLine("BB:x,BTN:b1.8,BB:c") };
    const back2 = fromSearch(toSearch(h));
    expect(back2).toEqual(h);
  });

  it("rejects malformed URLs instead of guessing", () => {
    expect(fromSearch("")).toBeNull();
    expect(fromSearch("p=1")).toBeNull();
    expect(fromSearch("p=10")).toBeNull();
    expect(fromSearch("p=2&s=100&b=ks%207D%202c")?.board).toBe("Ks7d2c"); // separators and case normalized
    expect(fromSearch("p=6&s=-5")).toBeNull();
    expect(fromSearch("p=6&b=KsKs")).toBeNull();
  });
});

describe("study navigation", () => {
  const node = (actor: string, street: AdvisorResponse["street"] = "preflop"): AdvisorResponse => ({ study: "node", actor, street });

  it("plays a raise as raise-to amount_bb on the node's street", () => {
    const h = play(freshHand(6, 100), node("UTG"), { action: "raise 2.5", amount_bb: 2.5, freq: 0.2 });
    expect(h.preflop).toEqual([{ pos: "UTG", action: "raise", to: 2.5 }]);
    const h2 = play(h, node("HJ"), { action: "fold", freq: 0.8 });
    expect(h2.preflop[1]).toEqual({ pos: "HJ", action: "fold" });
  });

  it("steps back over actions, then over the street's cards", () => {
    let h = { ...freshHand(2, 100), preflop: parseLine("SB:c,BB:x") };
    h = deal(h, "Ks7d2c");
    expect(streetOf(h)).toBe("flop");
    h = play(h, node("BB", "flop"), { action: "check" });
    h = back(h)!;
    expect(h.flop).toEqual([]);
    h = back(h)!;
    expect(h.board).toBe("");
    expect(back(freshHand())).toBeNull();
  });

  it("validates typed cards against the board", () => {
    const h = deal(freshHand(), "Ks7d2c");
    expect(readCards(h, "5s", 1)).toEqual({ cards: "5s" });
    expect(readCards(h, "10h", 1)).toEqual({ cards: "Th" });
    expect(readCards(h, "Ks", 1)).toEqual({ error: "that card is already on the board" });
    expect("error" in readCards(h, "5s6s", 1)).toBe(true);
  });

  it("deals random cards not already out", () => {
    const h = deal(freshHand(), "Ks7d2c");
    let i = 0;
    const seq = [0, 0, 0];
    const cards = randomCards(h, 3, () => seq[i++]!);
    expect(cards).toBe("AsAhAd");
    expect(randomCards(deal(h, "As"), 1, () => 0)).toBe("Ah");
  });

  it("asks the Advisor for a study answer and describes the line", () => {
    const h = { ...freshHand(6, 100), preflop: parseLine(LINE), board: "Ks7d2c" };
    expect(studyRequest(h)).toMatchObject({ players: 6, study: true, board: "Ks7d2c" });
    expect(describeLine(h)).toEqual(["BTN raise 2.5", "BB call", "Ks7d2c"]);
  });
});

describe("moving along a line", () => {
  const f = (pos: string) => ({ pos, action: "fold" });
  const line: StudyHand = {
    ...freshHand(6, 100),
    board: "Ks7d2c",
    preflop: [f("UTG"), f("HJ"), f("CO"), { pos: "BTN", action: "raise", to: 2.5 }, f("SB"), { pos: "BB", action: "call" }],
    flop: [{ pos: "BB", action: "check" }],
  };

  it("lists every node from the start, each one step on", () => {
    const nodes = lineOf(line);
    expect(nodes).toHaveLength(9);
    expect(nodes[0]).toEqual(freshHand(6, 100));
    expect(nodes.at(-1)).toEqual(line);
    expect(nodes[7]).toMatchObject({ board: "Ks7d2c", flop: [] });
    expect(nodes[6]).toMatchObject({ board: "" });
  });

  it("walks forward along the line, undoing each Back, and stops at its end", () => {
    let at: StudyHand = line;
    for (let i = 0; i < 8; i++) at = back(at)!;
    for (let i = 0; i < 8; i++) at = forward(at, line)!;
    expect(at).toEqual(line);
    expect(forward(line, line)).toBeNull();
  });

  it("has nothing ahead of a node off the line", () => {
    const other = { ...freshHand(6, 100), preflop: [{ pos: "UTG", action: "raise", to: 2.5 }] };
    expect(onLine(other, line)).toBe(false);
    expect(forward(other, line)).toBeNull();
    expect(onLine({ ...freshHand(6, 100) }, line)).toBe(true);
    expect(onLine(freshHand(6, 50), line)).toBe(false); // another game's start
  });

  it("names the steps, with a run of folds as one, and says where the node shown is", () => {
    const at = back(line)!; // (BB's check undone: the flop's cards are the node shown)
    const s = lineSteps(at, line);
    expect(s.map((x) => x.label)).toEqual(["3 folds", "BTN raise 2.5", "SB fold", "BB call", "Ks7d2c", "BB check"]);
    expect(s[0]?.detail).toBe("UTG, HJ, CO fold");
    expect(s.map((x) => x.at)).toEqual(["past", "past", "past", "past", "here", "ahead"]);
    expect(s[1]?.hand.preflop).toHaveLength(4);
    expect(s[4]?.hand).toEqual(at);
  });

  it("splits a run of folds where the node shown stands in it", () => {
    const at = lineOf(line)[1]!; // after UTG's fold
    const s = lineSteps(at, line);
    expect(s.slice(0, 2).map((x) => [x.label, x.at])).toEqual([["UTG fold", "here"], ["2 folds", "ahead"]]);
  });
});

describe("studyKey", () => {
  const key = (k: string, mods = {}) => studyKey({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

  it("reads the arrows and 1-9", () => {
    expect(key("ArrowLeft")).toEqual({ kind: "back" });
    expect(key("Backspace")).toEqual({ kind: "back" });
    expect(key("ArrowRight")).toEqual({ kind: "forward" });
    expect(key("b")).toEqual({ kind: "build" });
    expect(key("B")).toEqual({ kind: "build" });
    expect(key("1")).toEqual({ kind: "play", index: 0 });
    expect(key("9")).toEqual({ kind: "play", index: 8 });
  });

  it("leaves everything else alone, the browser's alt+left among it", () => {
    for (const k of ["0", "a", "Enter", "ArrowUp"]) expect(key(k)).toBeNull();
    expect(key("ArrowLeft", { altKey: true })).toBeNull();
    expect(key("ArrowLeft", { metaKey: true })).toBeNull();
    expect(key("1", { ctrlKey: true })).toBeNull();
  });
});

describe("potOdds", () => {
  const h = freshHand(6, 100);

  it("is the call's share of the pot it makes (the engine's pot holds the bet faced)", () => {
    expect(potOdds(h, { actor: "BB", pot_bb: 4, to_call_bb: 1.5 })).toBeCloseTo(1.5 / 5.5);
    expect(potOdds(h, { actor: "SB", pot_bb: 3.5, to_call_bb: 1.5 })).toBeCloseTo(0.3);
  });

  it("has none with nothing to call", () => {
    expect(potOdds(h, { actor: "BB", pot_bb: 4, to_call_bb: 0 })).toBeNull();
    expect(potOdds(h, { actor: "BB", pot_bb: 4 })).toBeNull();
    expect(potOdds(h, { actor: "BB", to_call_bb: 1 })).toBeNull();
  });

  it("has none for a stack someone left in covers, whose pot holds chips it can't win", () => {
    const short: StudyHand = { ...h, setup: { stacks: { BTN: 200, BB: 30 } } };
    expect(potOdds(short, { actor: "BB", pot_bb: 101.5, to_call_bb: 29 })).toBeNull();
    expect(potOdds(short, { actor: "BTN", pot_bb: 40, to_call_bb: 10 })).toBeCloseTo(0.2);
    const gone: StudyHand = { ...short, preflop: [{ pos: "BTN", action: "fold" }] }; // (the big stack has folded)
    expect(potOdds({ ...gone, stack: 30 }, { actor: "BB", pot_bb: 4, to_call_bb: 1 })).toBeCloseTo(0.2);
  });
});

describe("changing the cards on screen", () => {
  const turn = fromSearch("p=2&s=100&pre=SB:c,BB:x&b=Ks7d2c5h&flop=BB:x,SB:x&turn=BB:x")!;

  it("swaps only that street's cards and keeps the line", () => {
    const h = replaceCards(turn, "9d");
    expect(h.board).toBe("Ks7d2c9d");
    expect(h.flop).toEqual(turn.flop);
    expect(h.turn).toEqual(turn.turn);
    expect(replaceCards({ ...turn, board: "Ks7d2c" }, "Ah8h3c").board).toBe("Ah8h3c");
    expect(replaceCards({ ...turn, board: "Ks7d2c5h9c" }, "Td").board).toBe("Ks7d2c5hTd");
  });

  it("lets the street's own card come back, and no other card on the board", () => {
    expect(readReplacement(turn, "5h", 1)).toEqual({ cards: "5h" });
    expect(readReplacement(turn, "Ks", 1)).toEqual({ error: "that card is already on the board" });
    expect(readReplacement(turn, "9", 1)).toMatchObject({ error: expect.stringMatching(/type a card/) });
    expect(readReplacement({ ...turn, board: "Ks7d2c" }, "Ks7d2c", 3)).toEqual({ cards: "Ks7d2c" });
  });

  it("deals at random from what's left, the street's own card included", () => {
    expect(randomReplacement(turn, 1, () => 0)).toBe("As");
    for (let i = 0; i < 52; i += 1) expect(["Ks", "7d", "2c"]).not.toContain(randomReplacement(turn, 1, () => i / 52));
  });
});
