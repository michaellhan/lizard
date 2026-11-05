// The street split and the trend: decisions by street where they were kept, the rest counted apart, EV and frequency
// grades never added, and no line through too few.
import { describe, expect, it } from "vitest";
import type { SessionRecord } from "@/data/db";
import { addCell, type GradeCell } from "./history";
import { basisTrend, BLOCK, cellsOf, MIN_BLOCKS, MIN_SHARE, shareText, streetTotals, trends } from "./progress";

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
    expect(t.rows.map((r) => r.street)).toEqual(["preflop", "flop"]);
    expect(t.rows[1]).toMatchObject({ n: 3, ok: 1, ne: 2, loss: 0.5, lossPct: 8, sources: { live: 2, charts: 1 } });
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
    expect(t.why).toMatch(/20/);
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
