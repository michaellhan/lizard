// A custom report's run: every flop kept as it's solved, a pause that keeps what's done, a resume that goes on from there,
// one run at a time, and the worker told to keep little of a report's solves.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/data/db";
import { getFlopReport } from "@/data/flopReports";
import type { StudyHand } from "@/features/study/studyState";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import { SolverError, type Provenance, type SolveResult } from "@/solver/types";
import { newFlopReport } from "./customReport";
import { adopt, pauseRun, REPORT_CACHE_MB, runningReport, runOf, startRun, type RunClient } from "./customRun";

const base: StudyHand = {
  players: 6,
  stack: 100,
  board: "",
  preflop: [
    { pos: "UTG", action: "fold" },
    { pos: "HJ", action: "fold" },
    { pos: "CO", action: "fold" },
    { pos: "BTN", action: "raise", to: 2.5 },
    { pos: "SB", action: "fold" },
    { pos: "BB", action: "call" },
  ],
  flop: [],
  turn: [],
  river: [],
};
const prov: Provenance = { source: "live", approximate: false, mode: "fast", transport: "worker", solverVersion: "t", partial: false, receivedAt: 0, exploitabilityPct: 0.2, iterations: 300 };

/** A stand-in solver: each root checks or bets; `gate` holds a root until let go, so a test can pause mid-flop. */
function client(seen: AdvisorState[] = [], opts: { gate?: () => Promise<void>; rulesOn?: string } = {}): RunClient {
  return {
    async solve({ state, signal }) {
      seen.push(state);
      if (!state.flop?.length && opts.gate) await opts.gate();
      if (signal.aborted) throw new SolverError("cancelled", "stopped");
      const data: AdvisorResponse = !state.flop?.length
        ? { street: "flop", actor: "BB", opponent: "BTN", pot_bb: 5.5, range_ev_bb: 2, range_eq: 0.45, opponent_eq: 0.55, actions: [{ action: "check", freq: 1 }] }
        : { street: "flop", actor: "BTN", actions: [{ action: "check", freq: 1 }] };
      const source = opts.rulesOn === state.board ? "rules" : "live";
      return { data, provenance: { ...prov, source } } as SolveResult<AdvisorResponse>;
    },
  };
}

beforeEach(async () => {
  await (await db())!.clear("flopReports");
});

describe("a report's run", () => {
  it("solves every flop of the set, keeps each as it goes, and ends done", async () => {
    const rec = newFlopReport(base, { id: "r1", name: "x", from: "solve", mode: "fast", size: 9, now: 1 });
    adopt(rec);
    const seen: AdvisorState[] = [];
    const kept: number[] = [];
    const c = client(seen);
    const watch: RunClient = {
      async solve(req) {
        // (what's kept before each root: the flops already solved)
        if (!req.state.flop?.length) kept.push((await getFlopReport("r1"))?.done.length ?? -1);
        return c.solve(req);
      },
    };
    expect(await startRun(rec, watch, () => 5)).toBe(true);
    const got = (await getFlopReport("r1"))!;
    expect(got.status).toBe("done");
    expect(got.done.map((d) => d.f)).toEqual(rec.flops);
    expect(got.seats).toEqual(["BB", "BTN"]);
    expect(got.pot).toBe(5.5);
    expect(got.done[0]).toMatchObject({ source: "live", exploitabilityPct: 0.2, iterations: 300, ev: [2, 3.5] });
    // (the first root found nothing kept, each after it one more)
    expect(kept).toEqual([-1, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(seen.every((s) => s.cache_mb === REPORT_CACHE_MB)).toBe(true);
    expect(runOf("r1")).toMatchObject({ running: false, current: null, error: null });
  });

  it("pauses with the flop in hand dropped and the rest kept, and resumes from there", async () => {
    const rec = newFlopReport(base, { id: "r2", name: "x", from: "study", mode: "fast", size: 9, now: 1 });
    adopt(rec);
    let roots = 0;
    let release: () => void = () => undefined;
    const gate = () =>
      new Promise<void>((res) => {
        roots++;
        // (the third root waits; a pause lets it go, cancelled)
        if (roots === 3) release = res;
        else res();
      });
    const run = startRun(rec, client([], { gate }));
    await expect.poll(() => roots).toBe(3);
    expect(runningReport()).toBe("r2");
    expect(runOf("r2")).toMatchObject({ running: true, current: rec.flops[2] });
    // (one run at a time)
    expect(await startRun(newFlopReport(base, { id: "r3", name: "y", from: "study", mode: "fast", size: 9, now: 1 }), client())).toBe(false);
    pauseRun("r2");
    release();
    await run;
    expect(runningReport()).toBeNull();
    const paused = (await getFlopReport("r2"))!;
    expect(paused.status).toBe("paused");
    expect(paused.done.map((d) => d.f)).toEqual(rec.flops.slice(0, 2));

    const seen: AdvisorState[] = [];
    await startRun(paused, client(seen));
    const done = (await getFlopReport("r2"))!;
    expect(done.status).toBe("done");
    expect(done.done.map((d) => d.f)).toEqual(rec.flops);
    // (nothing solved twice)
    expect(seen.filter((s) => !s.flop?.length).map((s) => s.board)).toEqual(rec.flops.slice(2));
  });

  it("leaves out and counts a flop the rules answered, and stops on the solver failing, keeping what's done", async () => {
    const rec = newFlopReport(base, { id: "r4", name: "x", from: "study", mode: "fast", size: 9, now: 1 });
    adopt(rec);
    await startRun(rec, client([], { rulesOn: rec.flops[1] }));
    const got = (await getFlopReport("r4"))!;
    expect(got.left).toEqual([{ f: rec.flops[1], why: "answered by rules, not a solve" }]);
    expect(got.done).toHaveLength(8);

    const rec2 = newFlopReport(base, { id: "r5", name: "x", from: "study", mode: "fast", size: 9, now: 1 });
    adopt(rec2);
    let n = 0;
    const failing: RunClient = {
      async solve(req) {
        if (!req.state.flop?.length && ++n === 2) throw new SolverError("boot-failed", "the runtime didn't load");
        return client().solve(req);
      },
    };
    await startRun(rec2, failing);
    expect(runOf("r5")).toMatchObject({ running: false, error: "the runtime didn't load" });
    expect((await getFlopReport("r5"))!).toMatchObject({ status: "paused", done: [{ f: rec2.flops[0] }] });
  });
});
