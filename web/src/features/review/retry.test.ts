// Asking a kept spot again: the solver by the request Practice sent, the library read as the drill was.
import { describe, expect, it, vi } from "vitest";
import { COMBOS, nodeAt } from "@/library/entry";
import { LibraryFiles } from "@/library/files";
import { libFile } from "@/test/library";
import { LIVE, mistake } from "@/test/mistake";
import type { MistakeAsk } from "@/data/db";
import { askLibrary, askSolver, storedTurnAnswer } from "./retry";

const fakeFetch = (async (url: string) => {
  const path = String(url).replace(/^lib\//, "").split("?")[0]!;
  try {
    return new Response(new Uint8Array(libFile(path)));
  } catch {
    return new Response("missing", { status: 404 });
  }
}) as unknown as typeof fetch;
const lib = () => new LibraryFiles("lib/", fakeFetch);

describe("the solver's answer", () => {
  it("asks by the kept request, and gives the current answer's own provenance", async () => {
    const data = { actions: [{ action: "check", freq: 0.2, ev_bb: 1 }, { action: "bet 33%", freq: 0.8, ev_bb: 1.2, amount_bb: 2 }], pot_bb: 6 };
    const solve = vi.fn(async () => ({ data, provenance: { ...LIVE, seconds: 2 } }));
    const ask = mistake().ask as Extract<MistakeAsk, { via: "solver" }>;
    const a = await askSolver(ask, 5.5, async () => ({ solve }) as never, "quick");
    expect(solve).toHaveBeenCalledOnce();
    expect((solve.mock.calls[0] as unknown[])[0]).toMatchObject({ mode: "quick" });
    expect(a.provenance).toMatchObject({ source: "live", seconds: 2 });
    expect(a.pot).toBe(6);
    expect(a.mix).toEqual([{ action: "check", freq: 0.2, ev: 1 }, { action: "bet 33%", freq: 0.8, ev: 1.2, amount: 2 }]);
  });

  it("says so where the answer has no actions", async () => {
    const solve = vi.fn(async () => ({ data: { error: "no spot" }, provenance: LIVE }));
    await expect(askSolver(mistake().ask as never, 5.5, async () => ({ solve }) as never, "quick")).rejects.toThrow("no spot");
  });
});

describe("the library's answer", () => {

  it("reads your hand's stored mix and EVs at the node, under the stored solve's provenance", async () => {
    const f = lib();
    const spot = (await f.index()).spots.find((s) => s.id === "srp_btn_bb")!;
    const flop = Object.keys(spot.flops)[0]!;
    const e = await f.entry(spot, flop);
    const nd = nodeAt(e, [])!;
    const j = nd.strat[0]!.findIndex((x) => x > 0);
    const combo = COMBOS[e.combos[nd.player][j]!]!;
    const a = await askLibrary({ via: "library", spot: spot.id, flop, path: [], combo: [combo[0], combo[1]] }, "quick", f);
    expect(a.provenance).toMatchObject({ source: "library", librarySpot: "srp_btn_bb" });
    expect(a.version).toBe(spot.flops[flop]);
    expect(a.provenance.libraryVersion).toMatch(new RegExp(`^library:srp_btn_bb:[0-9a-f]{8}:${flop}:${spot.flops[flop]}$`));
    expect(a.mix.map((m) => m.action)).toEqual(nd.names);
    expect(a.mix[0]!.freq).toBeCloseTo(nd.strat[0]![j]!);
    expect(a.mix[0]!.ev).toBeCloseTo(nd.evs[0]![j]!);
    expect(a.pot).toBeGreaterThan(0);
  });

  it("says so where the library no longer holds the spot or your hand", async () => {
    const f = lib();
    await expect(askLibrary({ via: "library", spot: "gone", flop: "Ac8c6c", path: [], combo: [0, 1] }, "quick", f)).rejects.toThrow(/doesn't hold gone/);
    const spot = (await f.index()).spots.find((s) => s.id === "srp_btn_bb")!;
    const flop = Object.keys(spot.flops)[0]!;
    await expect(askLibrary({ via: "library", spot: spot.id, flop: "2c2d2h", path: [], combo: [0, 1] }, "quick", f)).rejects.toThrow(/doesn't hold/);
    await expect(askLibrary({ via: "library", spot: spot.id, flop, path: ["nope"], combo: [0, 1] }, "quick", f)).rejects.toThrow(/no longer stores/);
  });

  it("reads a turn drill's spot from the turn file, by frequency, under the stored turn's provenance", async () => {
    const f = lib();
    const spot = (await f.index()).spots.find((s) => s.id === "srp_btn_bb")!;
    const flop = "Ac8c6c";
    const t = await f.turns(spot, flop);
    const line = t.lines[0]!;
    const node = line.nodes[0]!;
    const cls = node.classes[0]!;
    const combo = COMBOS[cls.combos[0]!]!;
    const { cardStr } = await import("@/library/entry");
    const ask: Extract<MistakeAsk, { via: "library" }> = { via: "library", spot: spot.id, flop, path: line.path, combo: [combo[0], combo[1]], turn: { card: cardStr(t.played[0]!), at: node.at } };
    const a = await askLibrary(ask, "quick", f);
    expect(a.provenance).toMatchObject({ source: "library-turn", approximate: true });
    expect(a.provenance.libraryVersion).toMatch(new RegExp(`^library:${spot.id}:[0-9a-f]{8}:${flop}:`));
    expect(a.pot).toBe(line.pot);
    expect(a.mix.map((m) => m.action)).toEqual(node.names);
    expect(a.mix.every((m) => m.ev === null)).toBe(true);
    expect(a.mix[0]!.freq).toBeCloseTo(cls.strat[0]![0]!);
    const e = await f.entry(spot, flop);
    expect(storedTurnAnswer(e, t, { ...ask, path: ["none"] }, "quick")).toBeNull();
    expect(storedTurnAnswer(e, t, { ...ask, turn: undefined }, "quick")).toBeNull();
  });
});
