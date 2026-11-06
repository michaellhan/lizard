// The Room asking the stored preflop solve beside the chart, as one flight: what's asked, what's graded, and that nothing
// that goes wrong with the solve stops the table.
import { afterEach, describe, expect, it, vi } from "vitest";
import nodes from "@/test/fixtures/pf_nodes.json";
import type { AdvisorResponse } from "@/solver/protocol";
import { provenanceOf } from "@/solver/provenance";
import { SolverError, type Provenance, type SolveRequest, type SolveResult } from "@/solver/types";
import { optionsAt } from "./pfGrade";
import { following, newHand, withVillain, type PracticeHand } from "./practice";
import { Room, type RoomClient } from "./room";

const NODE = (nodes as unknown as { first: AdvisorResponse }).first;
const CHART: AdvisorResponse = { street: "preflop", pot_bb: 1.5, actions: [{ action: "raise", freq: 0, amount_bb: 2.5 }, { action: "fold", freq: 1 }] };
const CHART_P: Provenance = { source: "charts", approximate: true, mode: "quick", transport: "worker", solverVersion: "1", partial: false, receivedAt: 0 };
const ctx = { mode: "fast" as const, transport: "worker" as const, solverVersion: "1", partial: false, now: 1 };

const yours = (pfSolve: boolean): PracticeHand => ({ ...newHand(6, 100, 0, 7, pfSolve ? { pfSolve } : {}), hero: "UTG" });

function table(hand: PracticeHand, pf: (req: SolveRequest) => Promise<SolveResult>, chart: () => Promise<SolveResult> = async () => ({ data: CHART, provenance: CHART_P })) {
  const solve = vi.fn((req: SolveRequest) => (req.state.preflop_solve ? pf(req) : chart()));
  const client: RoomClient = { solve, play: async () => ({ data: { pos: "", action: "fold", name: "fold", freq: 1 }, provenance: CHART_P }), transport: { kind: "worker" }, stopCost: () => "cheap" };
  const room = new Room({ pace: 0, guard: 0, now: () => Date.now(), persist: false, seedOf: (n) => n + 1, readIndex: async () => null, hands: [hand], askAhead: false });
  room.setSolver(async () => client);
  room.start();
  rooms.push(room);
  return { room, solve };
}
const rooms: Room[] = [];
const settled = () => vi.waitFor(() => expect(rooms.at(-1)!.snapshot().tables[0]!.answer).toBeTruthy());
const solved = async () => ({ data: NODE, provenance: provenanceOf(NODE, ctx) });

afterEach(() => {
  for (const r of rooms.splice(0)) r.stop();
});

describe("a table graded by the preflop solve", () => {
  it("goes on from hand to hand, and stands aside for a hand dealt to a pot", () => {
    const opts = { pfSolve: true };
    expect(following(yours(true), 3, opts).pfSolve).toBe(true);
    expect(following(yours(true), 3, { ...opts, pot: "lib" }).pfSolve).toBeUndefined();
  });
  it("asks the chart for your options, then reads the solve's node, untimed, and never runs one", async () => {
    const { solve } = table(yours(true), solved);
    await settled();
    expect(solve).toHaveBeenCalledTimes(2);
    expect(solve.mock.calls[0]![0].state).not.toHaveProperty("preflop_solve");
    expect(solve.mock.calls[1]![0]).toMatchObject({ state: { study: true, preflop_solve: true }, untimed: true });
    expect(solve.mock.calls[1]![0].state).not.toHaveProperty("run");
  });
  it("keeps the chart's options on the buttons, and grades by the solve", async () => {
    const { room } = table(yours(true), solved);
    await settled();
    expect(room.snapshot().tables[0]!.answer!.data.actions).toEqual(CHART.actions);
    room.choose(1);
    const t = room.snapshot().tables[0]!;
    expect(t.last!.grade!.byEv).toBe(true);
    expect(t.last!.provenance!.source).toBe("preflop-solve");
    expect(t.lastRange!.grid).toBe(NODE.grid);
    expect(room.snapshot().session.sources).toEqual({ "preflop-solve": 1 });
  });
  it("takes the chart's grade and says why where the solve fails, and the table goes on", async () => {
    const { room } = table(yours(true), async () => {
      throw new SolverError("solver-error", "the bin wouldn't load");
    });
    await settled();
    expect(room.snapshot().tables[0]!.failed).toBeNull();
    room.choose(1);
    const t = room.snapshot().tables[0]!;
    expect(t.last!.grade!.byEv).toBe(false);
    expect(t.last!.provenance!.source).toBe("charts");
    expect(t.last!.pfWhy).toMatch(/couldn't be read: the bin wouldn't load/);
  });
  it("takes the chart's grade where a stored solve isn't there to be read", async () => {
    const { room } = table(yours(true), async () => ({ data: { study: "pf_unsolved", key: "6max_100bb" }, provenance: CHART_P }));
    await settled();
    room.choose(0);
    expect(room.snapshot().tables[0]!.last!.pfWhy).toMatch(/no decision here/);
  });
  it("doesn't ask the solve of a spot the chart couldn't answer", async () => {
    const { room, solve } = table(yours(true), solved, async () => ({ data: { error: "no chart" }, provenance: CHART_P }));
    await vi.waitFor(() => expect(room.snapshot().tables[0]!.failed).toBe("no chart"));
    expect(solve).toHaveBeenCalledTimes(1);
  });
  it("asks one thing of a table without the option", async () => {
    const { room, solve } = table(yours(false), solved);
    await settled();
    expect(solve).toHaveBeenCalledTimes(1);
    room.choose(1);
    expect(room.snapshot().tables[0]!.last!.grade!.byEv).toBe(false);
  });
  it("doesn't hand a retry the pair it holds: each request gets its own answer", async () => {
    const { room, solve } = table(yours(true), solved);
    await settled();
    const need = room.snapshot().tables[0]!.hand;
    const client = await room.retryClient();
    const state = solve.mock.calls[1]![0].state;
    const r = await client.solve({ state, mode: "quick" });
    expect(r.data).toBe(NODE);
    expect(need.pfSolve).toBe(true);
  });
  it("offers the solve's sizes at a table with the second box, on the buttons and in the keys, and plays what it offered", async () => {
    const oppo = (nodes as unknown as { offSize: AdvisorResponse }).offSize;
    const line = [{ pos: "UTG", action: "raise", to: 2.5 }, { pos: "HJ", action: "fold" }, { pos: "CO", action: "fold" }, { pos: "BTN", action: "fold" }, { pos: "SB", action: "fold" }] as const;
    let h: PracticeHand = { ...newHand(6, 100, 0, 7, { pfSolve: true, pfSizes: true }), hero: "BB" };
    for (const m of line) h = withVillain(h, m);
    const three: AdvisorResponse = { street: "preflop", pot_bb: 4, actions: [{ action: "raise", freq: 0.2, amount_bb: 10 }, { action: "call", freq: 0.7 }, { action: "fold", freq: 0.1 }] };
    const chart = async () => ({ data: three, provenance: CHART_P });
    const { room } = table(h, async () => ({ data: oppo, provenance: provenanceOf(oppo, ctx) }), chart);
    await settled();
    const t = room.snapshot().tables[0]!;
    expect(optionsAt(t.hand, t.answer)[0]!.amount_bb).toBe(12);
    room.choose(0);
    const after = room.snapshot().tables[0]!;
    expect(after.last!.move).toEqual({ pos: "BB", action: "raise", to: 12 });
    expect(after.last!.grade!.byEv).toBe(true);
    expect(after.last!.provenance!.source).toBe("preflop-solve");
  });
  it("shows Reveal what would have graded you, and keeps that with the ungraded move", async () => {
    const { room } = table(yours(true), solved);
    await settled();
    room.reveal();
    room.choose(1);
    const d = room.snapshot().tables[0]!.last!;
    expect(d.grade).toBeNull();
    expect(d.revealed).toBe(true);
    expect(d.provenance!.source).toBe("preflop-solve");
  });
});
