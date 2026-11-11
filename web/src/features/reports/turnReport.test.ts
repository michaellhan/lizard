// @vitest-environment node
// The turn report's numbers, on real fixture files (src/test/library.ts) and on small made-up flops whose averages can be
// worked by hand: what a flop keeps, how flops are drawn, what's weighted by what, the margin, and reading with a stop.
import { describe, expect, it } from "vitest";
import { describe as describeProvenance } from "@/solver/provenance";
import { lineReach } from "@/features/practice/drills";
import { cardClass, type CardClass } from "@/features/study/runouts";
import type { LibraryIndex } from "@/library/catalog";
import { storedTurnFlops } from "@/library/catalog";
import { decodeEntry, type LibraryRanges } from "@/library/entry";
import { LibraryFiles, type LibraryReport } from "@/library/files";
import { decodeTurns } from "@/library/turns";
import { libFile, libJson } from "@/test/library";
import {
  eligibleFlops,
  lineChoices,
  MIN_FLOPS_FOR_MARGIN,
  ratioMargin,
  readFlops,
  readingOrder,
  sampleText,
  standsOn,
  summarize,
  t95,
  textureCover,
  TURN_READ_AT_ONCE,
  turnCsv,
  turnCsvName,
  turnProvenance,
  turnTable,
  type ClassSum,
  type FlopTurns,
} from "./turnReport";

const INDEX = libJson<LibraryIndex>("index.json");
const spotOf = (id: string) => INDEX.spots.find((s) => s.id === id)!;
const REP = libJson<LibraryReport>("srp_btn_bb/report.json");
const RANGES = libJson<LibraryRanges>("srp_btn_bb/ranges.json");
const files = async (sid: string, f: string) => ({ e: await decodeEntry(libFile(`${sid}/${f}.bin`)), t: await decodeTurns(libFile(`${sid}/${f}.turn.bin`)) });
const sumOf = async (f: string) => {
  const { e, t } = await files("srp_btn_bb", f);
  return summarize(f, REP.flops.find((x) => x.f === f)!.w, e, t, RANGES);
};

/** a class's sum at a frequency of "bet 75%" */
const cell = (weight: number, bet: number, combos = 10): ClassSum => ({ weight, took: { check: weight * (1 - bet), "bet 75%": weight * bet }, combos: weight * combos });
const flop = (f: string, w: number, share: number, first: Partial<Record<CardClass, ClassSum>>, path = ["check", "check"]): FlopTurns => ({ f, w, lines: [{ path, share, first, after: null }], unread: [] });

describe("what a flop keeps", () => {
  it("is each class's mix by reach: the range's combos by how much of each reaches the line", async () => {
    const { e, t } = await files("srp_btn_bb", "Ac4d3h");
    const s = await sumOf("Ac4d3h");
    const line = t.lines[0]!;
    const node = line.nodes.find((n) => n.at.length === 0)!;
    const reach = lineReach(e, line.path, 0, RANGES)!;
    // worked here for the overcards' only class on Ac4d3h: none; the kings pair nothing and sit under the ace
    const k = t.head.classes.findIndex(([c]) => c[0] === "K");
    expect(cardClass("Ac4d3h", t.head.classes[k]![0])).toBe("under");
    const cls = node.classes[k]!;
    const a = node.names.indexOf("bet 75%");
    let all = 0;
    let bet = 0;
    cls.combos.forEach((ci, j) => {
      all += reach.get(ci) ?? 0;
      bet += (reach.get(ci) ?? 0) * cls.strat[a]![j]!;
    });
    // (a plain mean of the stored combos isn't this)
    const plain = cls.strat[a]!.reduce((x, y) => x + y, 0) / cls.combos.length;
    expect(Math.abs(plain - bet / all)).toBeGreaterThan(0.002);
    const under = s.lines[0]!.first!.under!;
    const others = t.head.classes.flatMap(([c], i) => (cardClass("Ac4d3h", c) === "under" ? [i] : []));
    let w = 0;
    let took = 0;
    for (const i of others) {
      const c2 = node.classes[i]!;
      const tot = c2.combos.reduce((x, ci) => x + (reach.get(ci) ?? 0), 0);
      const b = c2.combos.reduce((x, ci, j) => x + (reach.get(ci) ?? 0) * c2.strat[a]![j]!, 0);
      w += t.sizes[i]!;
      took += (t.sizes[i]! * b) / tot;
    }
    expect(under.weight).toBeCloseTo(w, 9);
    expect(under.took["bet 75%"]!).toBeCloseTo(took, 9);
  });

  it("gives every card off the flop to a class, 49 at the first decision, and each class's mix adds up", async () => {
    const s = await sumOf("Ac8c6c");
    const first = s.lines[0]!.first!;
    const classes = Object.values(first);
    expect(classes.reduce((a, c) => a + c.weight, 0)).toBeCloseTo(49, 9);
    for (const c of classes) expect(Object.values(c.took).reduce((a, x) => a + x, 0)).toBeCloseTo(c.weight, 9);
    // (a monotone flop's flush cards)
    expect(first.flush!.weight).toBe(10);
  });

  it("weighs in position's decision by how often out of position checks there, class by class", async () => {
    const { e, t } = await files("srp_btn_bb", "Ac4d3h");
    const s = await sumOf("Ac4d3h");
    const ln = s.lines[0]!;
    const line = t.lines[0]!;
    const first = line.nodes.find((n) => n.at.length === 0)!;
    const oop = lineReach(e, line.path, 0, RANGES)!;
    let want = 0;
    t.head.classes.forEach(([c], k) => {
      if (cardClass("Ac4d3h", c) !== "pair") return;
      const cls = first.classes[k]!;
      const tot = cls.combos.reduce((a, ci) => a + (oop.get(ci) ?? 0), 0);
      const chk = cls.combos.reduce((a, ci, j) => a + (oop.get(ci) ?? 0) * cls.strat[first.names.indexOf("check")]![j]!, 0);
      want += (t.sizes[k]! * chk) / tot;
    });
    expect(ln.after!.pair!.weight).toBeCloseTo(want, 9);
    expect(ln.after!.pair!.weight).toBeLessThan(ln.first!.pair!.weight);
  });

  it("leaves out and names a line whose reach the entry can't give, rather than guessing", async () => {
    const { e, t } = await files("srp_btn_bb", "Ac4d3h");
    const cut = { ...e, nodes: e.nodes.filter((n) => n.path.join("|") !== "check|bet 33%") };
    const s = summarize("Ac4d3h", 24, cut, t, RANGES);
    expect(s.unread).toContainEqual(["check", "bet 33%", "call"]);
    expect(s.lines.map((l) => l.path.join("|"))).not.toContain("check|bet 33%|call");
    expect(s.lines.map((l) => l.path.join("|"))).toContain("check|check");
  });
});

describe("which flops", () => {
  const stored = storedTurnFlops(spotOf("srp_btn_bb"));

  it("takes the texture's flops with stored turns and weight, alike ones together", () => {
    expect(eligibleFlops(REP, stored, {}).map((x) => x.f)).toHaveLength(7);
    expect(eligibleFlops(REP, stored, { suits: "mono" }).map((x) => x.f).sort()).toEqual(["9c8c7c", "Ac8c6c"]);
    expect(eligibleFlops(REP, ["Ac4d3h"], {}).map((x) => x.f)).toEqual(["Ac4d3h"]);
    const none = { flops: REP.flops.map((f) => ({ ...f, w: f.f === "Ac4d3h" ? 0 : f.w })) };
    expect(eligibleFlops(none, stored, {}).map((x) => x.f)).not.toContain("Ac4d3h");
    // (sorted by suits first: monotone, rainbow, two-tone in the string's order)
    const suits = eligibleFlops(REP, stored, {}).map((x) => x.f);
    expect(suits.slice(0, 2).sort()).toEqual(["9c8c7c", "Ac8c6c"]);
    // each keeps its own weight
    expect(eligibleFlops(REP, stored, { suits: "mono" }).find((x) => x.f === "Ac8c6c")!.w).toBe(REP.flops.find((x) => x.f === "Ac8c6c")!.w);
  });

  it("says how much of a texture has stored turns, by count and by weight", () => {
    const rep = { flops: [{ f: "Ac4d3h", w: 24, n: {} }, { f: "Kc7d2h", w: 24, n: {} }, { f: "Ks7s2h", w: 12, n: {} }, { f: "Qc7d2h", w: 0, n: {} }] };
    expect(textureCover(rep, [{ w: 24 }], { suits: "rainbow" })).toEqual({ flops: 2, share: 0.5 });
    expect(textureCover(rep, [{ w: 24 }, { w: 12 }], {})).toEqual({ flops: 3, share: 0.6 });
  });

  it("reads every flop once, the same way for a seed and another way for another seed", () => {
    const xs = Array.from({ length: 1755 }, (_, i) => i);
    const order = readingOrder(xs, 1);
    expect([...order].sort((a, b) => a - b)).toEqual(xs);
    expect(readingOrder(xs, 1)).toEqual(order);
    expect(readingOrder(xs, 2).slice(0, 40)).not.toEqual(order.slice(0, 40));
    for (const n of [0, 1, 2, 3, 7, 8, 9]) expect(new Set(readingOrder(Array.from({ length: n }, (_, i) => i), 5)).size).toBe(n);
  });

  it("is evenly spread from the first flop on, so a stop part way leaves a fair sample", () => {
    const N = 1755;
    const order = readingOrder(Array.from({ length: N }, (_, i) => i), 3);
    for (const n of [10, 25, 40, 57, 160]) {
      const got = order.slice(0, n).sort((a, b) => a - b);
      const gaps = got.map((x, i) => (i ? x - got[i - 1]! : x + N - got[n - 1]!));
      // (an even walk leaves no gap past twice the even gap, and a little for the rounding)
      expect(Math.max(...gaps)).toBeLessThanOrEqual((2 * N) / n + 2);
    }
  });

  it("gives each flop the same chance of a sample, whatever the seed", () => {
    const N = 97;
    const hits = new Array<number>(N).fill(0);
    const xs = Array.from({ length: N }, (_, i) => i);
    const seeds = 3000;
    for (let s = 1; s <= seeds; s++) for (const x of readingOrder(xs, s).slice(0, 10)) hits[x]!++;
    const want = (seeds * 10) / N;
    for (const h of hits) expect(Math.abs(h - want) / want).toBeLessThan(0.3);
  });
});

describe("the table", () => {
  const path = ["check", "check"];

  it("weighs each flop by what it stands for: its weight, its line's share and the class's cards", () => {
    // worked by hand: 24 x 0.5 x 3 x 0.2 + 4 x 0.1 x 9 x 0.8 over 24 x 0.5 x 3 + 4 x 0.1 x 9
    const t = turnTable([flop("Ac4d3h", 24, 0.5, { over: cell(3, 0.2) }), flop("Kc7d2h", 4, 0.1, { over: cell(9, 0.8) })], path, "first", 2);
    const over = t.rows.find((r) => r.cls === "over")!;
    expect(over.mix[t.cols.indexOf("bet 75%")]).toBeCloseTo((24 * 0.5 * 3 * 0.2 + 4 * 0.1 * 9 * 0.8) / (24 * 0.5 * 3 + 4 * 0.1 * 9), 9);
    expect(over.mix[0]! + over.mix[1]!).toBeCloseTo(1, 9);
    // (and not the plain mean of the two flops' 20% and 80%)
    expect(Math.abs(over.mix[1]! - 0.5)).toBeGreaterThan(0.1);
  });

  it("averages the combos as the mix is, counts the flops behind each row, and gives each class's share of turns", () => {
    const t = turnTable([flop("Ac4d3h", 1, 1, { over: cell(1, 0.5, 10), pair: cell(3, 0.5, 20) }), flop("Kc7d2h", 3, 1, { pair: cell(3, 0.5, 40) })], path, "first", 2);
    const pair = t.rows.find((r) => r.cls === "pair")!;
    expect(pair.flops).toBe(2);
    expect(pair.combos).toBeCloseTo((3 * 20 + 9 * 40) / 12, 9);
    expect(t.rows.find((r) => r.cls === "over")!.flops).toBe(1);
    expect(t.rows[0]!.cls).toBe("all");
    expect(t.rows[0]!.turns).toBeCloseTo(1, 9);
    expect(pair.turns).toBeCloseTo(12 / 13, 9);
  });

  it("the classes with an All turns row: it's the classes' own average", () => {
    const t = turnTable([flop("Ac4d3h", 2, 0.5, { over: cell(4, 0.1), brick: cell(8, 0.7) })], path, "first", 9);
    const i = t.cols.indexOf("bet 75%");
    const [all, a, b] = t.rows;
    expect(all!.mix[i]).toBeCloseTo((a!.turns * a!.mix[i]! + b!.turns * b!.mix[i]!) / (a!.turns + b!.turns), 9);
    expect(t.rows.map((r) => r.cls)).toEqual(["all", "over", "brick"]);
  });

  it("counts an action a flop doesn't have as not taken, and puts check first", () => {
    const a = flop("Ac4d3h", 1, 1, { over: { weight: 1, took: { check: 0.5, "bet 75%": 0.25, "all-in": 0.25 }, combos: 1 } });
    const b = flop("Kc7d2h", 1, 1, { over: { weight: 1, took: { "bet 75%": 0.5, check: 0.5 }, combos: 1 } });
    const t = turnTable([a, b], path, "first", 2);
    expect(t.cols).toEqual(["check", "bet 75%", "all-in"]);
    expect(t.rows[0]!.mix).toEqual([0.5, 0.375, 0.125]);
  });

  it("only takes the line and decision asked for, and a flop without the line adds nothing", () => {
    const fl: FlopTurns = { f: "Ac4d3h", w: 1, unread: [], lines: [{ path, share: 1, first: { over: cell(1, 0.2) }, after: { over: cell(1, 0.9) } }] };
    const other = flop("Kc7d2h", 1, 1, { over: cell(1, 0.7) }, ["bet 75%", "call"]);
    expect(turnTable([fl, other], path, "first", 2).rows[0]!.mix[1]).toBeCloseTo(0.2, 9);
    expect(turnTable([fl, other], path, "after", 2).rows[0]!.mix[1]).toBeCloseTo(0.9, 9);
    expect(turnTable([fl, other], path, "first", 2).rows[0]!.flops).toBe(1);
    expect(turnTable([other], path, "first", 2).rows).toEqual([]);
  });

  it("has no margin when every flop is read, none behind too few flops, and shrinks as more are read", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => flop(`F${i}`, 1, 1, { over: cell(1, i % 2 ? 0.1 : 0.9) }));
    expect(turnTable(many(10), path, "first", 10).rows[0]!.margin).toBe(0);
    expect(turnTable(many(MIN_FLOPS_FOR_MARGIN - 1), path, "first", 50).rows[0]!.margin).toBeNull();
    const at = (n: number) => turnTable(many(n), path, "first", 500).rows[0]!.margin!;
    expect(at(MIN_FLOPS_FOR_MARGIN)).toBeGreaterThan(0);
    expect(at(40)).toBeLessThan(at(MIN_FLOPS_FOR_MARGIN));
    expect(at(160)).toBeLessThan(at(40));
  });

  it("works the margin as a ratio's: by the worst action, with the finite population's correction", () => {
    // equal denominators: the textbook interval on a mean, t x sd/sqrt(n) x sqrt(1 - n/N)
    const y = [0.1, 0.5, 0.9, 0.2, 0.4, 0.6, 0.3, 0.8];
    const n = y.length;
    const mean = y.reduce((a, b) => a + b, 0) / n;
    const s2 = y.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
    expect(ratioMargin(y.map(() => 1), y, 40)).toBeCloseTo(t95(n - 1) * Math.sqrt((s2 / n) * (1 - n / 40)), 9);
    expect(ratioMargin(y.map(() => 1), y, 400)).toBeGreaterThan(ratioMargin(y.map(() => 1), y, 40));
    expect(ratioMargin([1, 1], [1, 0], 2)).toBe(0);
    // flops read with none of a class still count, and it's the flops carrying the weight that say how well the spread
    // is known: worked by hand, R 0.5, the mean denominator 2/8, two flops carrying it
    expect(ratioMargin([1, 1, 0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0, 0, 0], 100)).toBeCloseTo((t95(1) * Math.sqrt(((1 - 8 / 100) * 0.5) / 7 / 8)) / 0.25, 9);
    // (one big flop among small ones: as if there were about two)
    const big = [9, 1, 1, 1, 1, 1, 1, 1];
    const carried = (9 + 7) ** 2 / (81 + 7);
    const ys = [0.9, 0.5, 0.1, 0.6, 0.2, 0.4, 0.7, 0.3];
    const R = ys.reduce((a, b) => a + b, 0) / 16;
    const ss = big.reduce((a, b, i) => a + (ys[i]! - R * b) ** 2, 0);
    expect(ratioMargin(big, ys, 100)).toBeCloseTo((t95(carried - 1) * Math.sqrt(((1 - 8 / 100) * ss) / 7 / 8)) / 2, 9);
    expect(t95(10)).toBeCloseTo(2.228, 2);
    expect(t95(39)).toBeCloseTo(2.023, 2);
  });

  it("offers the lines read, biggest first, and says where a stored line couldn't be read", () => {
    const a = flop("Ac4d3h", 3, 0.1, { over: cell(1, 0.5) });
    const b: FlopTurns = { ...flop("Kc7d2h", 1, 0.6, { over: cell(1, 0.5) }, ["bet 75%", "call"]), unread: [["check", "check"]] };
    const c: FlopTurns = { f: "Qc7d2h", w: 1, lines: [], unread: [["bet 33%", "call"]] };
    const got = lineChoices([a, b, c]);
    expect(got.map((l) => l.key)).toEqual(["bet 75%|call", "check|check"]);
    expect(got[1]!).toMatchObject({ flops: 1, unread: 1 });
    expect(got[1]!.share).toBeCloseTo((3 * 0.1) / 5, 9);
    expect(got[0]!.share).toBeCloseTo((1 * 0.6) / 5, 9);
  });
});

describe("reading", () => {
  const sp = spotOf("srp_btn_bb");
  const stub = (over: (path: string) => Response | Promise<Response> | null = () => null, seen: string[] = []) =>
    (async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^lib\//, "").split("?")[0]!;
      seen.push(path);
      const r = await over(path);
      if (init?.signal?.aborted) throw new DOMException("stopped", "AbortError");
      return r ?? new Response(new Uint8Array(libFile(path)));
    }) as unknown as typeof fetch;
  const flops = eligibleFlops(REP, storedTurnFlops(sp), {});

  it("reads a flop's entry and turn file and the ranges once, and nothing else", async () => {
    const seen: string[] = [];
    const got: string[] = [];
    await readFlops(new LibraryFiles("lib/", stub(undefined, seen)), sp, flops.slice(0, 2), { onFlop: (r) => got.push(r.f), onFail: () => {} });
    expect(got.sort()).toEqual(flops.slice(0, 2).map((x) => x.f).sort());
    expect(seen.filter((p) => p.endsWith(".turn.bin"))).toHaveLength(2);
    expect(seen.filter((p) => /\/\w+\.bin$/.test(p) && !p.endsWith(".turn.bin"))).toHaveLength(2);
    expect(seen.filter((p) => p.endsWith("ranges.json"))).toHaveLength(1);
  });

  it("hands the stop to the fetches themselves, so what's in flight is cancelled", async () => {
    const signals = new Map<string, AbortSignal | null | undefined>();
    const spy = (async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^lib\//, "").split("?")[0]!;
      signals.set(path, init?.signal);
      return new Response(new Uint8Array(libFile(path)));
    }) as unknown as typeof fetch;
    const ac = new AbortController();
    await readFlops(new LibraryFiles("lib/", spy), sp, [flops[0]!], { signal: ac.signal, onFlop: () => {}, onFail: () => {} });
    expect(signals.get(`srp_btn_bb/${flops[0]!.f}.turn.bin`)).toBe(ac.signal);
    expect(signals.get(`srp_btn_bb/${flops[0]!.f}.bin`)).toBe(ac.signal);
  });

  it("tells a failed flop and goes on with the rest", async () => {
    const bad = flops[1]!.f;
    const got: string[] = [];
    const failed: [string, string][] = [];
    await readFlops(new LibraryFiles("lib/", stub((p) => (p.endsWith(`${bad}.turn.bin`) ? new Response("no", { status: 404 }) : null))), sp, flops, { onFlop: (r) => got.push(r.f), onFail: (f, w) => failed.push([f, w]) });
    expect(got).toHaveLength(flops.length - 1);
    expect(failed).toHaveLength(1);
    expect(failed[0]![0]).toBe(bad);
    expect(failed[0]![1]).toContain("404");
  });

  it("refuses a turn file that isn't its entry's, as a failure", async () => {
    const f = flops[0]!.f;
    const moved = { ...sp, flops: { ...sp.flops, [f]: "0000000000" } };
    const failed: string[] = [];
    await readFlops(new LibraryFiles("lib/", stub()), moved, [flops[0]!], { onFlop: () => {}, onFail: (x, w) => failed.push(`${x}: ${w}`) });
    expect(failed[0]).toContain("isn't its entry's");
  });

  it("reads a few flops at a time, and a stop starts nothing more and counts nothing as failed", async () => {
    let inFlight = 0;
    let most = 0;
    const seen: string[] = [];
    const ac = new AbortController();
    const fails: string[] = [];
    const got: string[] = [];
    const slow = (async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^lib\//, "").split("?")[0]!;
      seen.push(path);
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      init?.signal?.throwIfAborted();
      return new Response(new Uint8Array(libFile(path)));
    }) as unknown as typeof fetch;
    await readFlops(new LibraryFiles("lib/", slow), sp, flops, {
      signal: ac.signal,
      onFlop: (r) => {
        got.push(r.f);
        ac.abort();
      },
      onFail: (f) => fails.push(f),
    });
    expect(most).toBeLessThanOrEqual(2 * TURN_READ_AT_ONCE);
    expect(got.length).toBeLessThan(flops.length);
    expect(fails).toEqual([]);
    expect(seen.filter((p) => p.endsWith(".turn.bin")).length).toBeLessThanOrEqual(TURN_READ_AT_ONCE + 3);
  });
});

describe("what the numbers are", () => {
  const s = { read: 40, of: 412, seed: 7, failed: 0, partial: false, stopped: false };

  it("is the library's stored turns, approximate, naming the sample", () => {
    expect(describeProvenance(turnProvenance("srp_btn_bb", s, "fast"))).toBe("Stored turn from the flop library · srp_btn_bb · turn report over 40 of 412 flops with stored turns, seed 7, built in the page from their files · approximate");
    expect(describeProvenance(turnProvenance("srp_btn_bb", { ...s, partial: true, stopped: true }, "fast"))).toContain("partial, stopped before it finished");
    expect(describeProvenance(turnProvenance("srp_btn_bb", { ...s, partial: true }, "fast"))).toContain("in progress");
    expect(turnProvenance("srp_btn_bb", s, "fast", "abc")).toMatchObject({ source: "library-turn", transport: "file", solverVersion: "library turn report abc" });
  });

  it("says how many, of how many, how picked, the margin, what failed, and when it's partial", () => {
    expect(sampleText(s, 0.0214)).toBe("40 of 412 flops read (seed 7). Margin on All turns: ±2.1 points.");
    expect(sampleText({ ...s, read: 412 }, 0)).toBe("All 412 flops read; no sampling margin.");
    expect(sampleText({ ...s, read: 3 }, null)).toContain("Too few flops for a margin.");
    expect(sampleText({ ...s, failed: 2 }, 0.03)).toContain("2 couldn't be read.");
    expect(sampleText({ ...s, failed: 1 }, 0.03)).toContain("1 couldn't be read.");
    expect(sampleText({ ...s, partial: true, stopped: true }, 0.03)).toContain("Stopped early: partial.");
    expect(sampleText({ ...s, partial: true }, 0.03)).toContain("Still reading: partial.");
  });
});

describe("the turn report's CSV and what the chart says it stands on", () => {
  const flops = [flop("Ac4d3h", 24, 1, { over: cell(4, 0.5), pair: cell(9, 0.25) }), flop("Kc7d2h", 24, 1, { pair: cell(9, 0.75) })];
  const table = turnTable(flops, ["check", "check"], "first", 7);
  const whole = { read: 40, of: 40, seed: 1, failed: 0, partial: false, stopped: false };
  const sample = { ...whole, read: 2, of: 7, seed: 3 };
  const stopped = { ...sample, partial: true, stopped: true };
  const reading = { ...sample, partial: true };
  const csv = (s: typeof sample, unread = 0) => turnCsv({ spot: "srp_btn_bb", line: "BB and BTN check", decision: "BB first on the turn", table, sample: s, unread, provenance: turnProvenance("srp_btn_bb", s, "fast") });
  /** the fields of a line, by the CSV's own quoting */
  const fields = (l: string) => [...l.matchAll(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)].map((m) => m[1]!.replace(/^"|"$/g, "").replace(/""/g, '"')).slice(0, -1);

  it("says how many flops it stands on, each way a read can stand", () => {
    expect(standsOn(whole)).toBe("All 40 flops.");
    expect(standsOn(sample)).toBe("Sample: 2 of 7 flops.");
    expect(standsOn(stopped)).toBe("Stopped early: 2 of 7 flops.");
    expect(standsOn(reading)).toBe("Still reading: 2 of 7 flops.");
  });

  it("writes the table shown, its numbers worked by hand, with the flops and the source on every row", () => {
    const rows = csv(sample).trim().split("\n");
    expect(rows[0]).toBe("spot,flop line,decision,turn card,share of turns,check,bet 75%,\"margin (points of frequency, 95%)\",flops behind the row,combos,flops read,flops with stored turns,seed,sample,source");
    expect(rows).toHaveLength(1 + table.rows.length);
    const all = fields(rows[1]!);
    // (22 cards weighed: 4 at a half, 9 at a quarter, 9 at three quarters)
    expect(all.slice(0, 7)).toEqual(["srp_btn_bb", "BB and BTN check", "BB first on the turn", "All turns", "1.000", "0.500", "0.500"]);
    expect(all.slice(7, 14)).toEqual(["too few", "2", "10.0", "2", "7", "3", "sample"]);
    expect(all[14]).toMatch(/^Stored turn from the flop library · srp_btn_bb · turn report over 2 of 7 flops with stored turns, seed 3, built in the page from their files · approximate 2 of 7 flops read \(seed 3\)/);
    expect(all[14]).toContain("not a solve of these turns");
    expect(all[14]).toContain("says nothing of the solves' own error");
    expect(fields(rows[2]!).slice(3, 7)).toEqual(["Overcards", "0.182", "0.500", "0.500"]);
    expect(new Set(rows.slice(1).map((r) => fields(r)[14])).size).toBe(1);
  });

  it("says a stopped read and one still going on every row, and in the file's name", () => {
    for (const r of csv(stopped).trim().split("\n").slice(1)) {
      const f = fields(r);
      expect(f[13]).toBe("partial, stopped");
      expect(f[14]).toContain("partial, stopped before it finished");
      expect(f[14]).toContain("Stopped early: partial.");
    }
    const going = fields(csv(reading).trim().split("\n")[1]!);
    expect(going[13]).toBe("partial, still reading");
    expect(going[14]).toContain("in progress");
    expect(going[14]).toContain("Still reading: partial.");
    expect(turnCsvName("srp_btn_bb", "after", ["check", "bet 75%", "call"], stopped)).toBe("lizard-turn-report-srp_btn_bb-after-check-bet75-call-2-of-7-partial.csv");
    expect(turnCsvName("srp_btn_bb", "first", [], sample)).toBe("lizard-turn-report-srp_btn_bb-first-line-2-of-7.csv");
  });

  it("names flops left out of the line, and has no margin once every flop is read", () => {
    expect(fields(csv(sample, 3).trim().split("\n")[1]!)[14]).toContain("3 more flops store this line but are left out");
    expect(csv(sample)).not.toContain("left out");
    const all = fields(turnCsv({ spot: "s", line: "l", decision: "d", table: turnTable(flops, ["check", "check"], "first", 2), sample: { ...whole, read: 2, of: 2 }, unread: 0, provenance: turnProvenance("s", { ...whole, read: 2, of: 2 }, "fast") }).trim().split("\n")[1]!);
    expect(all[7]).toBe("none");
    expect(all[13]).toBe("every flop");
    expect(all[14]).toContain("All 2 flops read; no sampling margin.");
  });
});
