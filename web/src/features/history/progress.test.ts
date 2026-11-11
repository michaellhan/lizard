// The street split and the trend: decisions by street where they were kept, the rest counted apart, EV and frequency
// grades never added, and no line through too few.
import { describe, expect, it } from "vitest";
import type { SessionRecord } from "@/data/db";
import { addCell, kindTotals, type CellAt, type GradeCell } from "./history";
import { basisTrend, BLOCK, cellsOf, MIN_BLOCKS, MIN_SHARE, shareText, splitTotals, streetTotals, trends } from "./progress";

const cell = (street: string, source: string, byEv: boolean, n: number, ok: number, loss = 0, lossPct = 0): GradeCell => ({ street, source, byEv, n, ok, loss, lossPct });
const cells = (...xs: GradeCell[]) => Object.fromEntries(xs.map((c) => [`${c.street}|${c.source}|${c.byEv ? "ev" : "freq"}`, c]));
const practice = (id: string, startedAt: number, decisions: number, ...xs: GradeCell[]): SessionRecord => ({ id, kind: "practice", startedAt, decisions, evLossBb: 0, meta: { cells: cells(...xs) } });
const OLD: SessionRecord = { id: "old", kind: "practice", startedAt: 1, decisions: 8, evLossBb: 0.4, meta: { hands: 3, ok: 5, graded: 6, lossPct: 3 } };
const DRILL: SessionRecord = { id: "d", kind: "drill", startedAt: 2, decisions: 10, evLossBb: 1, meta: { spot: "srp", ok: 7, graded: 10, lossPct: 12 } };
const TURN: SessionRecord = { id: "t", kind: "drill", startedAt: 3, decisions: 6, evLossBb: 0, meta: { spot: "srp", street: "turn", ok: 4, graded: 0, lossPct: 0 } };
const LEAK: SessionRecord = { id: "l", kind: "analysis", startedAt: 4, decisions: 5, evLossBb: 0, meta: { score: { n: 5 } } };

describe("what graded a session", () => {
  const g = { ok: true, byEv: true, loss: 0, lossPct: 0 } as never;

  it("counts a cell's decisions by version, a spot's without its flop, and those with none aren't counted", () => {
    let c = addCell(undefined, "flop", "library", g, "library:s:1:Ac4d3h:aa");
    c = addCell(c, "flop", "library", g, "library:s:1:Kd7c2h:bb");
    c = addCell(c, "flop", "library", g);
    expect(Object.values(c)[0]).toMatchObject({ n: 3, versions: { "library:s:1": 2 } });
    expect(Object.values(addCell(undefined, "flop", "live", g))[0]).not.toHaveProperty("versions");
  });

  it("reads a session's counts back, a damaged one's decisions unknown, and a drill's from its own", () => {
    expect(cellsOf(practice("a", 1, 2, { ...cell("flop", "live", true, 2, 1), versions: { "build:a/1": 2 } }))![0]!.versions).toEqual({ "build:a/1": 2 });
    expect(cellsOf(practice("a", 1, 2, { ...cell("flop", "live", true, 2, 1), versions: "no" as never }))![0]).not.toHaveProperty("versions");
    expect(cellsOf({ ...DRILL, meta: { ...DRILL.meta, versions: { "library:srp:1": 10 } } })![0]!.versions).toEqual({ "library:srp:1": 10 });
    expect(cellsOf({ ...TURN, meta: { ...TURN.meta, versions: { "library:srp:1": 6 } } })![0]!.versions).toEqual({ "library:srp:1": 6 });
    expect(cellsOf(DRILL)![0]).not.toHaveProperty("versions");
  });

  it("sets the last stretch against those before it, and keeps a session from before versions unknown", () => {
    const at = (i: number, version?: string) => practice(`s${i}`, i, BLOCK, { ...cell("flop", "live", true, BLOCK, BLOCK / 2), ...(version ? { versions: { [version]: BLOCK } } : {}) });
    const lined = basisTrend([at(1, "build:a/1"), at(2, "build:a/1"), at(3, "build:a/1"), at(4, "build:b/2")].slice(0, Math.max(MIN_BLOCKS, 4)), "ev");
    expect(lined.line).toBe(true);
    expect(lined.versions).toMatchObject({ changed: [{ what: "solver build", before: ["a/1"], later: ["b/2"] }], unknown: [0, 0] });
    const old = basisTrend([at(1), at(2, "build:a/1"), at(3, "build:a/1"), at(4, "build:a/1")], "ev");
    expect(old.versions).toMatchObject({ changed: [], unknown: [BLOCK, 0] });
  });

  it("reads one set where there's no line yet", () => {
    const t = basisTrend([practice("a", 1, 5, { ...cell("flop", "live", true, 5, 2), versions: { "build:a/1": 3 } })], "ev");
    expect(t.line).toBe(false);
    expect(t.versions).toMatchObject({ changed: [], unknown: [2, 0], n: [5, 0] });
  });
});

describe("a decision's cell", () => {
  it("adds by street, source and how it was graded", () => {
    let c: Record<string, GradeCell> | undefined;
    c = addCell(c, "flop", "live", { ok: true, byEv: true, loss: 0, lossPct: 0 } as never);
    c = addCell(c, "flop", "live", { ok: false, byEv: true, loss: 0.5, lossPct: 8 } as never);
    c = addCell(c, "preflop", "charts", { ok: false, byEv: false, loss: 0, lossPct: 0 } as never);
    expect(Object.values(c)).toEqual([cell("flop", "live", true, 2, 1, 0.5, 8), cell("preflop", "charts", false, 1, 0)]);
  });
});

describe("the street split", () => {
  it("sums each street, EV lost only over what was graded by EV", () => {
    const t = streetTotals([practice("a", 1, 7, cell("preflop", "charts", false, 4, 3), cell("flop", "live", true, 2, 1, 0.5, 8), cell("flop", "charts", false, 1, 0))]);
    expect(t.rows.map((r) => [r.street, r.basis])).toEqual([["preflop", undefined], ["flop", "ev"], ["flop", "freq"]]);
    expect(t.rows[1]).toMatchObject({ n: 2, ok: 1, ne: 2, loss: 0.5, lossPct: 8, sources: { live: 2 } });
    expect(t.rows[2]).toMatchObject({ n: 1, ok: 0, ne: 0, loss: 0, sources: { charts: 1 } });
    expect(t.rows[0]).toMatchObject({ n: 4, ne: 0, loss: 0 });
    expect(t.apartSessions).toBe(0);
  });

  it("counts apart the sessions from before streets were kept, and the part of one that was", () => {
    const part = practice("p", 2, 5, cell("river", "live", true, 2, 2));
    const t = streetTotals([OLD, part]);
    expect(t.rows.map((r) => [r.street, r.n])).toEqual([["river", 2]]);
    expect([t.apartSessions, t.apartDecisions]).toEqual([2, 11]);
    expect(cellsOf(OLD)).toBeNull();
  });

  it("puts a flop drill on the flop by EV, a turn drill on the turn by frequency, and a leak drill apart", () => {
    const t = streetTotals([DRILL, TURN, LEAK]);
    expect(t.rows.map((r) => [r.street, r.n, r.ne])).toEqual([["flop", 10, 10], ["turn", 6, 0]]);
    expect(t.rows[1]!.sources).toEqual({ "library-turn": 6 });
    expect(t.leakDecisions).toBe(5);
    expect(t.apartSessions).toBe(0);
  });

  it("survives damaged cells", () => {
    const bad = { id: "b", kind: "practice", startedAt: 1, decisions: 2, evLossBb: 0, meta: { cells: { x: null, y: { street: 3 } } } } as unknown as SessionRecord;
    expect(() => streetTotals([bad])).not.toThrow();
    expect(streetTotals([bad]).apartDecisions).toBe(2);
  });

  it("gives a count, not a percent, under the sample a percent needs", () => {
    expect(shareText(3, 5)).toBe("3 of 5");
    expect(shareText(MIN_SHARE - 1, MIN_SHARE - 1)).toBe(`${MIN_SHARE - 1} of ${MIN_SHARE - 1}`);
    expect(shareText(MIN_SHARE, MIN_SHARE)).toBe("100%");
    expect(shareText(0, 0)).toBe("–");
  });
});

describe("the trend", () => {
  const run = (k: number, n: number, ok: number, byEv = true) => Array.from({ length: k }, (_, i) => practice(`s${i}-${byEv}`, i + 1, n, cell("flop", byEv ? "live" : "charts", byEv, n, ok, byEv ? 1 : 0, byEv ? 5 : 0)));

  it("draws nothing from a handful, and says why", () => {
    const t = basisTrend(run(2, 10, 5), "ev");
    expect(t.line).toBe(false);
    expect(t.n).toBe(20);
    expect(t.why).toMatch(/280 more decisions/);
    expect(t.change).toBeNull();
  });

  it("draws nothing from one long session, and says why", () => {
    const t = basisTrend(run(1, BLOCK * 5, BLOCK * 3), "ev");
    expect(t.line).toBe(false);
    expect(t.why).toBeTruthy();
  });

  it("draws with enough stretches of enough decisions, and says the change only where it's clear", () => {
    const flat = basisTrend(run(MIN_BLOCKS, BLOCK, 60), "ev");
    expect(flat.line).toBe(true);
    expect(flat.blocks).toHaveLength(MIN_BLOCKS);
    expect(flat.change).toBeNull();
    const up = [...run(MIN_BLOCKS - 1, BLOCK, 30), practice("last", 99, BLOCK, cell("flop", "live", true, BLOCK, 95, 1, 5))];
    expect(basisTrend(up, "ev").change).not.toBeNull();
  });

  it("never mixes EV grades and frequency grades", () => {
    const s = [...run(3, BLOCK, 60, true), ...run(3, 10, 5, false)];
    const [ev, freq] = trends(s);
    expect(ev).toMatchObject({ basis: "ev", n: BLOCK * 3, line: true });
    expect(freq).toMatchObject({ basis: "freq", n: 30, line: false });
    expect(freq!.blocks.every((b) => b.ne === 0 && b.lossPct === 0)).toBe(true);
  });

  it("leaves out sessions from before streets were kept", () => {
    expect(basisTrend([OLD], "ev").n).toBe(0);
  });
});

describe("rates by seat and by pot", () => {
  type One = { street: string; source: "live" | "charts" | "library"; byEv: boolean; ok: boolean; loss: number; version: string; at: CellAt };
  const SEATS = ["UTG", "CO", "BTN", "SB", "BB"];
  const POTS = ["Unopened", "Limped", "SRP", "3bet pot", "4bet+ pot"];
  const STREETS = ["preflop", "flop", "turn", "river"];

  /** A session's decisions, seeded. `step` is the loss's grain: 1/8 adds up exactly in any order. */
  function deal(seed: number, n: number, step: number): One[] {
    let x = seed;
    const r = (k: number) => {
      x = (x * 1664525 + 1013904223) % 2 ** 32;
      return Math.floor((x / 2 ** 32) * k);
    };
    return Array.from({ length: n }, () => {
      const street = STREETS[r(4)]!;
      const byEv = street !== "preflop" || r(2) === 0;
      const source = byEv ? (r(2) ? "live" : "library") : "charts";
      return { street, source, byEv, ok: r(3) > 0, loss: byEv ? r(9) * step : 0, version: `build:v${r(2)}/1`, at: { seat: SEATS[r(5)]!, pot: POTS[r(5)]! } };
    });
  }
  const record = (i: number, ds: One[], split: boolean): SessionRecord => {
    let c: Record<string, GradeCell> | undefined;
    for (const d of ds) c = addCell(c, d.street, d.source, { ok: d.ok, byEv: d.byEv, loss: d.loss, lossPct: d.loss * 10 }, d.version, split ? d.at : undefined);
    return { id: `s${i}`, kind: "practice", startedAt: i * 1000, decisions: ds.length, evLossBb: 0, meta: { hands: 1, ok: ds.filter((d) => d.ok).length, graded: ds.filter((d) => d.byEv).length, lossPct: 0, cells: c } };
  };
  const pair = (step: number) => {
    const ds = [40, 150, 3, 220, 90, 310].map((n, i) => deal(i + 1, n, step));
    return [ds.map((d, i) => record(i, d, false)), ds.map((d, i) => record(i, d, true))] as const;
  };

  it("keeps a seat and a pot on a cell, one cell each, and none where it isn't given", () => {
    const g = { ok: true, byEv: true, loss: 0.5, lossPct: 5 };
    let c = addCell(undefined, "flop", "live", g, undefined, { seat: "BTN", pot: "SRP" });
    c = addCell(c, "flop", "live", g, undefined, { seat: "BTN", pot: "SRP" });
    c = addCell(c, "flop", "live", g, undefined, { seat: "BB", pot: "SRP" });
    c = addCell(c, "flop", "live", g, undefined, { seat: "BTN", pot: "3bet pot" });
    expect(Object.values(c).map((x) => [x.seat, x.pot, x.n])).toEqual([
      ["BTN", "SRP", 2],
      ["BB", "SRP", 1],
      ["BTN", "3bet pot", 1],
    ]);
    const plain = addCell(undefined, "flop", "live", g);
    expect(Object.keys(plain)).toEqual(["flop|live|ev"]);
    expect(plain["flop|live|ev"]).not.toHaveProperty("seat");
    expect(plain["flop|live|ev"]).not.toHaveProperty("pot");
  });

  it("changes no total: by street, over time, by kind, to the last digit where the sums can't round", () => {
    const [plain, split] = pair(1 / 8);
    expect(Object.keys(split[3]!.meta!.cells as object).length).toBeGreaterThan(Object.keys(plain[3]!.meta!.cells as object).length);
    expect(streetTotals(split)).toEqual(streetTotals(plain));
    expect(trends(split)).toEqual(trends(plain));
    expect(basisTrend(split, "ev").change).toEqual(basisTrend(plain, "ev").change);
    expect(kindTotals(split)).toEqual(kindTotals(plain));
    expect(streetTotals(split).rows.map((r) => r.n).reduce((a, b) => a + b)).toBe(813);
  });

  it("changes no total on real losses either, past rounding that no page can show", () => {
    const [plain, split] = pair(0.0737);
    const a = streetTotals(plain), b = streetTotals(split);
    expect(b.rows.map(({ loss: _l, lossPct: _p, ...r }) => r)).toEqual(a.rows.map(({ loss: _l, lossPct: _p, ...r }) => r));
    b.rows.forEach((r, i) => {
      expect(r.loss).toBeCloseTo(a.rows[i]!.loss, 9);
      expect(r.lossPct).toBeCloseTo(a.rows[i]!.lossPct, 9);
    });
    const strip = (ts: ReturnType<typeof trends>) => ts.map((t) => ({ ...t, blocks: t.blocks.map(({ lossPct: _p, ...x }) => x) }));
    expect(strip(trends(split))).toEqual(strip(trends(plain)));
    trends(split).forEach((t, i) => t.blocks.forEach((x, j) => expect(x.lossPct).toBeCloseTo(trends(plain)[i]!.blocks[j]!.lossPct, 9)));
  });

  it("puts every decision in one row or says it wasn't kept, and adds up to the street totals", () => {
    const [, split] = pair(1 / 8);
    const all = [...split, OLD, DRILL, TURN, LEAK];
    const streets = streetTotals(all);
    const count = streets.rows.reduce((a, r) => a + r.n, 0) + streets.apartDecisions;
    for (const by of ["seat", "pot"] as const) {
      const t = splitTotals(all, by);
      const rows = [...t.ev, ...t.freq];
      expect(rows.reduce((a, r) => a + r.n, 0) + t.notKept).toBe(count);
      expect(rows.reduce((a, r) => a + r.ok, 0)).toBe(split.reduce((a, s) => a + Object.values(s.meta!.cells as Record<string, GradeCell>).reduce((x, c) => x + c.ok, 0), 0));
      expect(t.ev.reduce((a, r) => a + r.loss, 0)).toBe(streets.rows.reduce((a, r) => a + r.loss, 0) - DRILL.evLossBb);
      expect(t.notKept).toBe(OLD.decisions + DRILL.decisions + TURN.decisions);
      expect(t.notKeptSessions).toBe(3);
      expect(t.leakDecisions).toBe(5);
    }
  });

  it("never adds a basis into the other: a seat graded both ways is two rows, and frequency counts no EV", () => {
    const at = { seat: "BTN", pot: "SRP" };
    const s = practice("a", 1, 7, { ...cell("flop", "live", true, 3, 2, 0.6, 9), ...at }, { ...cell("preflop", "charts", false, 4, 1), ...at });
    const t = splitTotals([s], "seat");
    expect(t.ev).toEqual([{ name: "BTN", n: 3, ok: 2, ne: 3, loss: 0.6, lossPct: 9, sources: { live: 3 } }]);
    expect(t.freq).toEqual([{ name: "BTN", n: 4, ok: 1, ne: 0, loss: 0, lossPct: 0, sources: { charts: 4 } }]);
    // (a loss on a frequency cell, as a damaged one might have, is never summed)
    const damaged = practice("b", 1, 2, { ...cell("flop", "charts", false, 2, 1, 5, 50), ...at });
    expect(splitTotals([damaged], "pot").freq[0]).toMatchObject({ ne: 0, loss: 0, lossPct: 0 });
  });

  it("orders seats by the action and pots as History does, whatever was played first", () => {
    const of = (street: string, seat: string, pot: string) => ({ ...cell(street, "live", true, 1, 1), seat, pot });
    const s = practice("a", 1, 3, of("preflop", "BB", "4bet+ pot"), of("flop", "UTG", "Unopened"), of("turn", "BTN", "SRP"));
    expect(splitTotals([s], "seat").ev.map((r) => r.name)).toEqual(["UTG", "BTN", "BB"]);
    expect(splitTotals([s], "pot").ev.map((r) => r.name)).toEqual(["Unopened", "SRP", "4bet+ pot"]);
  });

  it("keeps a cell from before seats and pots readable, in every total, out of the split, with no seat made up", () => {
    const s = practice("a", 1, 3, cell("flop", "live", true, 3, 2, 0.3, 3));
    expect(cellsOf(s)![0]).not.toHaveProperty("seat");
    expect(cellsOf(s)![0]).not.toHaveProperty("pot");
    expect(streetTotals([s]).rows[0]).toMatchObject({ street: "flop", n: 3, ok: 2 });
    expect(splitTotals([s], "seat")).toMatchObject({ ev: [], freq: [], notKept: 3, notKeptSessions: 1 });
  });

  it("splits a session begun before seats and pots were kept only as far as they were", () => {
    const old = cell("flop", "live", true, 3, 2);
    const s = { ...practice("a", 1, 5, old), meta: { cells: { "flop|live|ev": old, "flop|live|ev|BB|SRP": { ...old, seat: "BB", pot: "SRP", n: 2, ok: 1 } } } };
    expect(streetTotals([s]).rows).toEqual([expect.objectContaining({ street: "flop", n: 5, ok: 3 })]);
    expect(splitTotals([s], "seat")).toMatchObject({ ev: [{ name: "BB", n: 2 }], notKept: 3, notKeptSessions: 1 });
  });

  it("counts a seat kept without a pot under the one and not the other", () => {
    const s = practice("a", 1, 2, { ...cell("flop", "live", true, 2, 1), seat: "BB" });
    expect(splitTotals([s], "seat")).toMatchObject({ ev: [{ name: "BB", n: 2 }], notKept: 0 });
    expect(splitTotals([s], "pot")).toMatchObject({ ev: [], notKept: 2 });
  });

  it("reads tournaments and exploit sessions into neither, as the street table", () => {
    const c = { ...cell("flop", "live", true, 2, 1), seat: "BB", pot: "SRP" };
    const others = (["tournament", "tournament-chips", "exploit"] as const).map((kind) => ({ ...practice("a", 1, 2, c), kind }));
    expect(splitTotals(others, "seat")).toMatchObject({ ev: [], freq: [], notKept: 0 });
  });

  describe("crafted cells", () => {
    const good = { ...cell("flop", "live", true, 2, 1, 0.5, 5), seat: "BB", pot: "SRP" };
    const stored = (c: unknown, decisions = 5) => ({ ...practice("a", 1, decisions), meta: { cells: { good, bad: c } } }) as unknown as SessionRecord;

    it.each([
      ["a negative count", { ...good, n: -50 }],
      ["a part of a decision", { ...good, n: 1.5 }],
      ["a count in text", { ...good, n: "3" }],
      ["no count", { ...good, n: null }],
      ["more right than made", { ...good, ok: 3 }],
      ["fewer right than none", { ...good, ok: -1 }],
      ["EV gained", { ...good, loss: -40 }],
      ["EV lost in text", { ...good, loss: "lots" }],
      ["EV lost as nothing", { ...good, lossPct: null }],
      ["a basis in text", { ...good, byEv: "true" }],
      ["a street that isn't one", { ...good, street: "showdown" }],
      ["a source that's an object", { ...good, source: { a: 1 } }],
      ["nothing", null],
      ["a list", [good]],
    ])("drops %s: its decisions count apart, never as made", (_, bad) => {
      const s = stored(bad);
      expect(cellsOf(s)).toEqual([good]);
      expect(streetTotals([s]).rows).toEqual([expect.objectContaining({ n: 2, ok: 1, loss: 0.5 })]);
      expect(streetTotals([s]).apartDecisions).toBe(3);
      expect(splitTotals([s], "seat")).toMatchObject({ ev: [{ name: "BB", n: 2, ok: 1 }], notKept: 3 });
    });

    it.each([
      ["an object", { a: 1 }],
      ["a number", 7],
      ["a name no table has", "Dealer"],
      ["a key of every object", "constructor"],
      ["the prototype", "__proto__"],
    ])("reads %s for a seat or a pot as not kept, and the decisions still count", (_, bad) => {
      const s = stored({ ...good, street: "turn", n: 3, ok: 2, seat: bad, pot: bad });
      expect(cellsOf(s)![1]).not.toHaveProperty("seat");
      expect(cellsOf(s)![1]).not.toHaveProperty("pot");
      expect(streetTotals([s]).rows.map((r) => r.n)).toEqual([2, 3]);
      for (const by of ["seat", "pot"] as const) expect(splitTotals([s], by)).toMatchObject({ ev: [{ n: 2 }], notKept: 3 });
    });

    it("takes no cell at all where they add up to more than the session graded", () => {
      const s = stored({ ...good, street: "turn", n: 1_000_000, ok: 1_000_000 });
      expect(cellsOf(s)).toEqual([]);
      expect(streetTotals([s])).toMatchObject({ rows: [], apartDecisions: 5, apartSessions: 1 });
      expect(trends([s])).toEqual([]);
      expect(splitTotals([s], "pot")).toMatchObject({ ev: [], freq: [], notKept: 5 });
    });

    it("draws a source named for an object's own keys without harm", () => {
      for (const source of ["__proto__", "constructor", "toString"]) {
        const s = stored({ ...good, street: "turn", source, n: 3, ok: 2 });
        expect(() => [streetTotals([s]), trends([s])]).not.toThrow();
        expect(splitTotals([s], "seat").ev[0]).toMatchObject({ n: 5, ok: 3 });
      }
    });

    it.each([["a list", [good]], ["text", "cells"], ["a number", 3]])("reads %s for the cells as none kept", (_, bad) => {
      const s = { id: "a", kind: "practice", startedAt: 1, decisions: 4, evLossBb: 0, meta: { cells: bad } } as unknown as SessionRecord;
      expect(cellsOf(s)).toBeNull();
      expect(splitTotals([s], "seat")).toMatchObject({ ev: [], notKept: 4, notKeptSessions: 1 });
    });
  });
});
