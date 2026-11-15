// A preflop drill's spot: the decisions on a line, the request of the stored solve's node, a hand dealt from the range at
// it (the engine's own node, test/fixtures/pf_nodes.json), its read, and the hand so far in words.
import { describe, expect, it } from "vitest";
import nodes from "@/test/fixtures/pf_nodes.json";
import type { AdvisorResponse } from "@/solver/protocol";
import { provenanceOf } from "@/solver/provenance";
import { classCombos, pfActionLabel, pfDeal, pfDecisions, pfDrillable, pfDrillState, pfStory, SURE_FOLD_SHARE } from "./pfDrill";
import { PF_MODEL, pfNodeRead } from "./pfGrade";

const NODES = nodes as unknown as Record<"first" | "opened" | "offSize", AdvisorResponse>;
const ctx = { mode: "fast" as const, transport: "worker" as const, solverVersion: "1", partial: false };
const asked = (data: AdvisorResponse) => ({ data, provenance: provenanceOf(data, ctx) });

describe("a preflop drill's spot", () => {
  it("is dealt only on games the worker stores", () => {
    expect(pfDrillable({})).toBe(true);
    expect(pfDrillable({ game: { players: 2, stack: 100, ante: 0, straddle: false } })).toBe(true);
    expect(pfDrillable({ game: { players: 6, stack: 100, ante: 0.12, straddle: false } })).toBe(false);
    expect(pfDrillable({ game: { players: 6, stack: 70, ante: 0, straddle: false } })).toBe(false);
    expect(pfDrillable({ game: { players: 8, stack: 100, ante: 0, straddle: false } })).toBe(false);
  });

  it("takes every action on the line as a decision, with the ones before it played", () => {
    const ds = pfDecisions("UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c");
    expect(ds.map((d) => d.hero)).toEqual(["UTG", "HJ", "CO", "BTN", "SB", "BB"]);
    expect(ds[4]).toMatchObject({ k: 4, line: "UTG:f,HJ:f,CO:f,BTN:r2.5", before: [{ pos: "UTG", action: "fold" }, { pos: "HJ", action: "fold" }, { pos: "CO", action: "fold" }, { pos: "BTN", action: "raise", to: 2.5 }] });
    expect(pfDrillState({ game: { players: 6, stack: 100, ante: 0, straddle: false } }, ds[3]!)).toEqual({
      players: 6,
      hero: "BTN",
      board: "",
      stack: 100,
      preflop: ds[3]!.before,
      flop: [],
      turn: [],
      river: [],
      study: true,
      preflop_solve: true,
    });
  });

  it("knows a class's combos", () => {
    expect(classCombos("QQ")).toHaveLength(6);
    expect(classCombos("AKs")).toEqual([["As", "Ks"], ["Ah", "Kh"], ["Ad", "Kd"], ["Ac", "Kc"]]);
    expect(classCombos("AKo")).toHaveLength(12);
    expect(classCombos("AKo").every(([a, b]) => a[1] !== b[1])).toBe(true);
  });

  it("deals a class by its combos in the range, the ones always folded less often", () => {
    // (a draw just under the first class's share picks it; the first cell, 22, is always folded at UTG)
    const cells = NODES.first.grid!.cells;
    const classes = Object.keys(cells);
    expect(classes[0]).toBe("22");
    expect(cells["22"]!.f[1]).toBe(1);
    const total = classes.reduce((t, c) => t + cells[c]!.w * classCombos(c).length * (cells[c]!.f[1]! >= 0.995 ? SURE_FOLD_SHARE : 1), 0);
    const share = (6 * SURE_FOLD_SHARE) / total;
    const dealt = pfDeal(NODES.first, (() => {
      const xs = [share * 0.99, 0];
      return () => xs.shift() ?? 0;
    })());
    expect(dealt).toEqual({ cls: "22", hole: ["2s", "2h"] });
    expect(pfDeal(NODES.first, (() => {
      const xs = [share * 1.01, 0];
      return () => xs.shift() ?? 0;
    })())!.cls).not.toBe("22");
    expect(pfDeal({ actions: [], grid: { actions: [], cells: {} } }, () => 0)).toBeNull();
  });

  it("reads the node for your class as the solve's options, under the simplified model's label", () => {
    const read = pfNodeRead(asked(NODES.opened), "BTN", "AsKd");
    if ("why" in read) throw new Error(read.why);
    const cell = NODES.opened.grid!.cells.AKo!;
    expect(read.data.actions!.map((a) => [a.action, a.freq, a.ev_bb])).toEqual(NODES.opened.actions!.map((a, i) => [a.action, cell.f[i], cell.ev![i]]));
    expect(read.provenance).toMatchObject({ source: "preflop-solve", approximate: true, approximateLabel: PF_MODEL });
    expect(pfNodeRead(asked(NODES.opened), "CO", "AsKd")).toEqual({ why: expect.stringMatching(/another seat/) });
  });

  it("says the hand so far: the line before you, the price where calling is an option, the stack behind", () => {
    expect(pfStory({ hero: "UTG", line: "", k: 0 }, NODES.first)).toEqual({ steps: [], now: { street: "Preflop", pot: 1.5, line: "", hero: "UTG", toCall: 0, behind: 100 } });
    expect(pfStory({ hero: "BTN", line: "UTG:f,HJ:f,CO:f", k: 3 }, NODES.first).now.line).toBe("Folds to BTN");
    expect(pfStory({ hero: "BTN", line: "UTG:f,HJ:f,CO:r2.5", k: 3 }, NODES.opened).now).toMatchObject({ line: "Folds to CO. CO raises to 2.5bb", toCall: 2.5 });
    expect(pfActionLabel(2.5, { action: "call" })).toBe("call 2.5bb");
    expect(pfActionLabel(2.5, { action: "raise", amount: 7.5 })).toBe("raise to 7.5bb");
    expect(pfActionLabel(2.5, { action: "fold" })).toBe("fold");
  });
});
