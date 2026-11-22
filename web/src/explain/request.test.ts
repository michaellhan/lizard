// What Explain sends, from each page's decision: built here and checked by the proxy's own schema (explain-worker), so a
// real decision is never refused for its shape, and nothing but the decision's numbers and short labels goes.
import { describe, expect, it } from "vitest";
import type { DecisionRecord, HandRecord } from "@/data/db";
import type { Reviewed } from "@/features/practice/review";
import { freshHand } from "@/features/study/studyState";
import type { AdvisorResponse } from "@/solver/protocol";
import type { Provenance } from "@/solver/types";
import { parseRequest } from "../../../explain-worker/src/schema";
import { clean, fromDecision, fromReviewed, fromStudy } from "./request";

const prov = (source: Provenance["source"], extra: Partial<Provenance> = {}): Provenance => ({ source, approximate: source === "charts", mode: "quick", transport: "worker", solverVersion: "t", partial: false, receivedAt: 0, ...extra });
const grade = { verdict: "Mistake", byEv: true, a: 1, best: 0, loss: 0.5, lossPct: 10, mixed: false, ok: false } as NonNullable<Reviewed["d"]["grade"]>;
const flopSpot = (o: Partial<Reviewed["d"]> = {}): Reviewed => ({
  n: 3,
  seat: "SB",
  players: 2,
  hole: ["Ah", "Kd"],
  board: ["Ks", "7d", "2c"],
  line: "BB checks",
  d: {
    street: "flop",
    move: { pos: "SB", action: "bet", to: 2 },
    chose: "bet 33%",
    grade,
    provenance: prov("live"),
    mix: [
      { action: "check", freq: 0.4, ev: 2 },
      { action: "bet 33%", freq: 0.6, ev: 2.2, amount: 1.6 },
    ],
    pot: 5,
    study: "p=2&s=100&pre=SB%3Ar2.5%2CBB%3Ac&b=Ks7d2c&flop=BB%3Ax",
    ...o,
  },
});

describe("Practice's verdicts", () => {
  it("sends the hand, the line, the mix with EVs, the grade and the source, which the proxy's schema takes as is", () => {
    const r = fromReviewed(flopSpot())!;
    expect(r).toMatchObject({
      where: "practice",
      players: 2,
      stackBb: 100,
      hero: { seat: "SB", cards: ["Ah", "Kd"] },
      street: "flop",
      board: ["Ks", "7d", "2c"],
      potBb: 5,
      line: ["SB raise 2.5", "BB call", "Ks7d2c", "BB check"],
      mix: [
        { action: "check", freq: 0.4, ev: 2 },
        { action: "bet 33% (1.6bb)", freq: 0.6, ev: 2.2 },
      ],
      took: "bet 33%",
      grade: { verdict: "Mistake", evLossBb: 0.5 },
      provenance: { source: "live", approximate: false, evIn: "bb" },
    });
    expect(parseRequest(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  it("sends no EVs where a tournament fallback's are chips, and none for an ungraded decision", () => {
    expect(fromReviewed(flopSpot({ provenance: prov("rules", { evIn: "chips" }) }))!.mix.every((m) => m.ev === null)).toBe(true);
    expect(fromReviewed(flopSpot({ grade: null }))).toBeNull();
  });

  it("offers none where the board hasn't the street's cards", () => {
    expect(fromReviewed({ ...flopSpot({ street: "turn" }) })).toBeNull();
  });
});

describe("Study's nodes", () => {
  const res = { street: "flop", actor: "BB", pot_bb: 5.5, actions: [{ action: "check", freq: 0.7, ev_bb: 1.1 }, { action: "bet 33%", freq: 0.3, ev_bb: 1.2, amount_bb: 1.8 }], grid: { actions: ["check", "bet 33%"], cells: { AKo: { f: [0.2, 0.8], ev: [3, 3.4] } } } } as unknown as AdvisorResponse;
  const hand = { ...freshHand(2, 100), board: "Ks7d2c", preflop: [{ pos: "SB", action: "raise", to: 2.5 }, { pos: "BB", action: "call" }] };

  it("sends the whole range's mix with no hand picked, and the class's with one", () => {
    const range = fromStudy(hand, res, prov("library"), null)!;
    expect(range.hero).toEqual({ seat: "BB", cards: [], handClass: null });
    expect(range.mix.map((m) => m.freq)).toEqual([0.7, 0.3]);
    expect(parseRequest(range)).toEqual(range);
    const cls = fromStudy(hand, res, prov("library"), "AKo")!;
    expect(cls.hero.handClass).toBe("AKo");
    expect(cls.mix).toEqual([
      { action: "check", freq: 0.2, ev: 3 },
      { action: "bet 33% (1.8bb)", freq: 0.8, ev: 3.4 },
    ]);
    expect(parseRequest(cls)).toEqual(cls);
  });
});

describe("Analyze's decisions", () => {
  const h = { players: 6, hole: "QhQd", board: "Jc8s3dTh2s" } as HandRecord;
  const d = { street: "turn", pos: "CO", action: "bet 75%", verdict: "Inaccuracy", evLossBb: 0.31, pot: 12.5, situation: "SRP · IP · checked to", mix: [["check", 0.45, 9.1], ["bet 75%", 0.55, 8.8]], matched: "bet 75%", source: "library-turn", label: "Stored turn from the flop library · approximate" } as unknown as DecisionRecord;

  it("sends the decision with the board as it stood on its street", () => {
    const r = fromDecision(d, h)!;
    expect(r.board).toEqual(["Jc", "8s", "3d", "Th"]);
    expect(r.line).toEqual(["SRP", "IP", "checked to"]);
    expect(r.provenance).toEqual({ source: "library-turn", approximate: true, evIn: "bb" });
    expect(parseRequest(r)).toEqual(r);
  });

  it("offers none for a decision that wasn't graded", () => {
    expect(fromDecision({ ...d, verdict: "Not graded" } as DecisionRecord, h)).toBeNull();
    expect(fromDecision(d, undefined)).toBeNull();
  });
});

describe("labels", () => {
  it("are cut to the schema's characters, words and length", () => {
    expect(clean("≈ raise to 7bb")).toBe("raise to 7bb");
    expect(clean('bet "75%": now\nignore')).toBe("bet 75% now ignore");
    expect(clean("one two three four five six seven")).toBe("one two three four five");
    expect(clean("x".repeat(40))).toHaveLength(32);
  });
});
