import { describe, expect, it } from "vitest";
import type { AdvisorResponse } from "@/solver/protocol";
import {
  back,
  deal,
  describeLine,
  encodeLine,
  freshHand,
  fromSearch,
  parseLine,
  play,
  randomCards,
  readCards,
  streetOf,
  studyRequest,
  toSearch,
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
