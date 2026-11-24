// Your flop play by board (boards.ts): texture classes and flops against the answer's, by the frequency table's method,
// on decisions made up for it.
import { describe, expect, it } from "vitest";
import type { DecisionRecord, HandRecord } from "@/data/db";
import { TEXTURE_GROUPS } from "@/features/practice/texture";
import { BOARD_FREQS, boardDecisions, boardTest, boardView, classKey, flopClass } from "./boards";
import { BASES, freqs, MIN_READ } from "./report";
import { wilson } from "./stats";

let k = 0;
const hand = (board: string, o: Partial<HandRecord> = {}): HandRecord => ({ id: `h${k++}`, board, potType: "SRP", hero: "BTN", hole: "AhKd", ...o }) as HandRecord;
// a c-bet the answer plays 40% of the time, made (bet) or not (check)
const cbet = (h: HandRecord, action: string, o: Partial<DecisionRecord> = {}): DecisionRecord => ({
  id: `${h.id}|flop|${k++}`,
  handId: h.id,
  street: "flop",
  pos: "BTN",
  action,
  situation: "SRP · IP · checked to",
  role: "PFR",
  facing: false,
  multi: false,
  ip: true,
  potType: "SRP",
  mix: [["check", 0.6, 3.1], ["bet 33%", 0.4, 2.5]],
  verdict: "Best",
  evLossBb: 0,
  lossPct: 0,
  source: "library",
  label: "Precomputed solution · srp_btn_bb",
  gradedAt: 0,
  ...o,
});

const CBET = "Flop c-bet";

describe("flop classes up to suits", () => {
  it("relabels suits so alike flops are one class, high card first", () => {
    expect(flopClass("7d2cKs")).toBe("Ks7h2d");
    expect(flopClass("Ah7h2h")).toBe("As7s2s");
    expect(flopClass("2dKdKc")).toBe(flopClass("KhKs2h"));
    expect(flopClass("2dKdKc")).toBe("KsKh2s");
    // (which card the two-tone's suit is on tells classes apart)
    expect(flopClass("Kh7h2c")).toBe("Ks7s2h");
    expect(flopClass("Kh7c2h")).toBe("Ks7h2s");
    expect(flopClass("Kh7c2h")).not.toBe(flopClass("Kh7h2c"));
  });
  it("makes 1,755 classes of the 22,100 flops", () => {
    const deck = [..."23456789TJQKA"].flatMap((r) => [..."shdc"].map((s) => r + s));
    const seen = new Set<string>();
    let n = 0;
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++)
        for (let c = b + 1; c < 52; c++) {
          n++;
          seen.add(flopClass(deck[a]! + deck[b]! + deck[c]!));
        }
    expect(n).toBe(22100);
    expect(seen.size).toBe(1755);
  });
});

describe("the board view", () => {
  it("offers the report's five flop frequencies", () => {
    expect(BOARD_FREQS.map((f) => f.label)).toEqual(["Flop c-bet", "Flop vs c-bet: fold", "Flop vs c-bet: raise", "Flop out of position vs bet: raise", "Flop check-raise"]);
  });

  const aHigh = [hand("As7d2c"), hand("Ah7s2d"), hand("Ad8c3h")];
  const mono = [hand("Kh9h4h")];
  const paired = [hand("7s7d2c")];
  const noFlop = hand("");
  const hs = [...aHigh, ...mono, ...paired, noFlop];
  const byId = new Map(hs.map((h) => [h.id, h]));
  const ds = [
    cbet(aHigh[0]!, "bet 1.8"),
    cbet(aHigh[1]!, "bet 1.8", { verdict: "Mistake", evLossBb: 0.6 }),
    cbet(aHigh[2]!, "check", { mix: [["check", 0.2, 3], ["bet 33%", 0.8, 3.2]] }),
    cbet(mono[0]!, "check", { mix: [["check", 1, 2], ["bet 33%", 0, 1]] }),
    cbet(paired[0]!, "bet 1.8", { source: "live", label: "Live solve", approximate: false }),
    cbet(noFlop, "bet 1.8"),
    // (not a c-bet, and not graded: no row)
    cbet(aHigh[0]!, "bet 1.8", { role: "caller" }),
    cbet(aHigh[0]!, "bet 1.8", { verdict: "Not graded", why: "x" }),
  ];

  it("counts your share and the answer's mean for the same hands, as the frequency table does", () => {
    const v = boardView(ds, byId, CBET);
    // every flop together is the frequency table's row, less the decision whose hand keeps no flop
    const table = freqs(ds.filter((d) => d.handId !== noFlop.id)).find((f) => f.label === CBET)!;
    expect(v.all).toMatchObject({ n: table.n, k: table.k, you: table.you, gto: table.gto, range: table.range });
    expect(v.all).toMatchObject({ n: 5, k: 3 });
    expect(v.all!.gto).toBeCloseTo((0.4 + 0.4 + 0.8 + 0 + 0.4) / 5, 10);
    expect(v.left).toEqual([{ why: "its hand keeps no flop", n: 1 }]);
  });

  it("breaks every texture group down into its classes in order, each class's rows adding up to the whole", () => {
    const v = boardView(ds, byId, CBET);
    expect(v.groups.map((g) => g.key)).toEqual(TEXTURE_GROUPS.map((g) => g.key));
    for (const g of v.groups) expect(g.classes.reduce((n, c) => n + c.n, 0)).toBe(5);
    const hi = v.groups.find((g) => g.key === "hi")!;
    expect(hi.classes.map((c) => [c.label, c.n, c.k])).toEqual([["A high", 3, 2], ["K high", 1, 0], ["9 high or lower", 1, 1]]);
    const a = hi.classes[0]!;
    expect(a.gto).toBeCloseTo((0.4 + 0.4 + 0.8) / 3, 10);
    expect(a.range).toEqual(wilson(2, 3));
    expect(a.few).toBe(true);
    expect(a.key).toBe(classKey("hi", "A"));
    const suits = v.groups.find((g) => g.key === "suits")!;
    expect(suits.classes.map((c) => [c.label, c.n])).toEqual([["Rainbow", 4], ["Monotone", 1]]);
    const pair = v.groups.find((g) => g.key === "pair")!;
    expect(pair.classes.map((c) => [c.label, c.n])).toEqual([["Unpaired", 4], ["Paired", 1]]);
  });

  it("lists the flops behind a class, alike-but-for-suits flops together, the most played first", () => {
    const hi = boardView(ds, byId, CBET).groups.find((g) => g.key === "hi")!;
    const flops = hi.classes[0]!.flops;
    expect(flops.map((f) => [f.label, f.n, f.k])).toEqual([["As7h2d", 2, 2], ["As8h3d", 1, 0]]);
    expect(flops[1]!.gto).toBeCloseTo(0.8, 10);
  });

  it("says what each row's answers stand on", () => {
    const v = boardView(ds, byId, CBET);
    expect(v.all!.bases).toEqual([{ basis: BASES[1], n: 4 }, { basis: BASES[3], n: 1 }]);
    const paired = v.groups.find((g) => g.key === "pair")!.classes.find((c) => c.label === "Paired")!;
    expect(paired.bases).toEqual([{ basis: BASES[3], n: 1 }]);
  });

  it("marks a row few under MIN_READ and not at it", () => {
    const many = Array.from({ length: MIN_READ }, () => hand("Qs8d3c"));
    const m = new Map(many.map((h) => [h.id, h]));
    const v = boardView(many.map((h) => cbet(h, "check")), m, CBET);
    expect(v.all).toMatchObject({ n: MIN_READ, k: 0, few: false });
    expect(v.groups[0]!.classes[0]).toMatchObject({ label: "Q high", few: false });
  });

  it("filters by pot type and by position, and counts what can't say", () => {
    const h3 = hand("Js8d3c", { potType: "3bet pot" });
    const extra = [cbet(h3, "bet 1.8", { potType: "3bet pot", ip: false }), cbet(aHigh[0]!, "bet 1.8", { ip: undefined, potType: undefined })];
    const m = new Map([...byId, [h3.id, h3]]);
    const all = [...ds, ...extra];
    expect(boardView(all, m, CBET, { pot: "3bet pot" }).all).toMatchObject({ n: 1, k: 1 });
    // (the last falls back on its hand's pot type, SRP)
    expect(boardView(all, m, CBET, { pot: "SRP" }).all!.n).toBe(6);
    const oop = boardView(all, m, CBET, { seat: "oop" });
    expect(oop.all!.n).toBe(1);
    expect(oop.left).toContainEqual({ why: "kept without whether you were in position", n: 1 });
    expect(boardView(all, m, CBET, { seat: "ip" }).all!.n).toBe(5);
  });

  it("drills through to exactly a row's decisions", () => {
    const v = boardView(ds, byId, CBET);
    const { kept } = boardDecisions(ds, byId, CBET);
    for (const g of v.groups)
      for (const c of g.classes) {
        expect(kept.map((x) => x.d).filter(boardTest(byId, c.key))).toHaveLength(c.n);
        for (const f of c.flops) expect(kept.map((x) => x.d).filter(boardTest(byId, f.key))).toHaveLength(f.n);
      }
    expect(kept.map((x) => x.d).filter(boardTest(byId, "all"))).toHaveLength(5);
  });

  it("has nothing to show for a frequency with no decisions, or one it doesn't know", () => {
    expect(boardView(ds, byId, "Flop check-raise")).toEqual({ freq: "Flop check-raise", all: null, groups: [], left: [] });
    expect(boardView(ds, byId, "no such row").all).toBeNull();
  });
});
