import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { notComparable } from "@/features/compare/ComparePage";
import { pfSourceOf, sourceWarning, whatDiffers } from "@/features/compare/compare";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import { describe as describeProvenance, provenanceOf } from "@/solver/provenance";
import type { SolveResult } from "@/solver/types";
import { askNode, newRun, pfCache, pfCacheKey, pfFraction, pfGame, runPf } from "./pfSolve";
import { StudyPage } from "./StudyPage";
import { freshHand, fromSearch, play, studyRequest, toSearch, withPf, type StudyHand } from "./studyState";

// the engine's preflop solve stubbed (Advisor._study_pf, pf_study.Solve): one heads-up game, solved 500 iterations a
// chunk to 1,000; every request kept in `pf.asked`; a chunk waits on `pf.hold` where a test sets one
const pf = vi.hoisted(() => {
  const s = {
    iters: 0,
    cached: false,
    asked: [] as AdvisorState[],
    hold: null as Promise<void> | null,
    // (each answer's provenance as the client derives it: set below, once provenanceOf is imported)
    prov: null as ((d: AdvisorResponse) => SolveResult["provenance"]) | null,
    getSolver: null as unknown as () => Promise<unknown>,
  };
  const status = () => ({
    key: "2max_100bb",
    label: "heads-up, 100bb, no rake",
    iterations: s.iters,
    done: s.iters >= 1000,
    stalled: false,
    max_iterations: 2000,
    target_mbb: 0,
    stored: false,
    cached: s.cached,
    mbb: s.iters ? 4 / (s.iters / 500) : null,
  });
  const node = (): AdvisorResponse => ({
    study: "node",
    street: "preflop",
    actor: "SB",
    pot_bb: 1.5,
    actions: [
      { action: "raise", amount_bb: 2.5, freq: 0.7, combos: 930, ev_bb: 0.4 },
      { action: "call", freq: 0.2, combos: 265, ev_bb: 0.2 },
      { action: "fold", freq: 0.1, combos: 131, ev_bb: 0 },
    ],
    grid: { actions: ["raise", "call", "fold"], cells: { AA: { w: 1, f: [1, 0, 0], ev: [2.1, 1.5, 0], evm: 2.1, eq: null }, "72o": { w: 1, f: [0, 0.2, 0.8], ev: [-0.2, -0.05, 0], evm: -0.01, eq: null } } },
    range_combos: 1326,
    range_ev_bb: 0.3,
    range_eq: null,
    solver: { by: "the preflop solve", iterations: s.iters, mbb: status().mbb } as AdvisorResponse["solver"],
    pf_solve: status(),
    source: "solver",
    notes: [],
    regret_bb: 0.001,
    rough: false,
  });
  const answer = (st: AdvisorState): AdvisorResponse => {
    const q = st.preflop_solve as boolean | { run?: number; export?: boolean; load?: string; iterations?: number } | undefined;
    if (!q) return { study: "node", street: "preflop", actor: "SB", pot_bb: 1.5, actions: [{ action: "raise", amount_bb: 2.5, freq: 1, combos: 1326 }], grid: { actions: ["raise"], cells: {} }, range_combos: 1326 };
    if (typeof q === "object" && q.run) return { study: "pf_progress", street: "preflop", pf_solve: ((s.iters += 500), status()) };
    if (typeof q === "object" && q.export) return { study: "pf_export", street: "preflop", key: "2max_100bb", iterations: s.iters, mbb: status().mbb, blob: "UEZTMQ==" };
    if (typeof q === "object" && q.load && !s.iters) {
      if (q.load !== "UEZTMQ==") return { study: "pf_unsolved", street: "preflop", game: status().label, key: "2max_100bb", estimate_s: 12 };
      s.iters = q.iterations ?? 0;
      s.cached = true;
    }
    return s.iters ? node() : { study: "pf_unsolved", street: "preflop", game: status().label, key: "2max_100bb", estimate_s: 12 };
  };
  const client = {
    solverVersion: "test",
    solve: async ({ state }: { state: AdvisorState }): Promise<SolveResult> => {
      s.asked.push(state);
      const q = state.preflop_solve;
      if (s.hold && typeof q === "object" && q && "run" in q) await s.hold;
      const data = answer(state);
      return { data, provenance: s.prov!(data) };
    },
  };
  s.getSolver = async () => client;
  return s;
});
vi.mock("@/solver/useSolver", () => ({ useSolver: () => pf.getSolver }));

afterEach(async () => {
  pf.iters = 0;
  pf.cached = false;
  pf.asked = [];
  pf.hold = null;
  await pfCache.del(pfCacheKey("test", "2max_100bb"));
});

const HU: StudyHand = freshHand(2, 100);
const asks = (k: string) => pf.asked.filter((s) => typeof s.preflop_solve === "object" && s.preflop_solve !== null && k in s.preflop_solve);
const ctx = { mode: "fast" as const, transport: "worker" as const, solverVersion: "test", partial: false, now: 0 };
pf.prov = (d) => provenanceOf(d, ctx);

describe("the preflop Solver source's state", () => {
  it("asks the preflop solve's node preflop only, and keeps the source in the link", () => {
    const h = withPf(HU, "solver");
    expect(studyRequest(h).preflop_solve).toBe(true);
    expect(studyRequest(HU).preflop_solve).toBeUndefined();
    expect(studyRequest({ ...h, board: "Ks7d2c" }).preflop_solve).toBeUndefined();
    expect(toSearch(h)).toContain("pf=solver");
    expect(fromSearch(toSearch(h))).toEqual(h);
    expect(withPf(h, "charts")).toEqual(HU);
    // every preflop node of one table is one game; another stack another
    const after = play(h, { street: "preflop", actor: "SB" }, { action: "raise", amount_bb: 2.5 });
    expect(pfGame(after)).toBe(pfGame(h));
    expect(pfGame(HU)).toBe(pfGame(h));
    expect(pfGame({ ...h, stack: 50 })).not.toBe(pfGame(h));
  });

  it("fills the bar toward the target from the last measure, else by iterations", () => {
    expect(pfFraction({ done: true, mbb: 9, target: 1.5, it: 100 })).toBe(1);
    expect(pfFraction({ done: false, mbb: 3, target: 1.5, it: 300 })).toBeCloseTo(Math.pow(0.5, 1 / 1.2));
    expect(pfFraction({ done: false, mbb: null, target: 1.5, it: 250 })).toBe(0.25);
    // a small tree has no target: it runs to its max
    expect(pfFraction({ done: false, mbb: 2, target: 0, it: 500, max: 2000 })).toBe(0.25);
  });

  it("labels a node from the solve: the class-level model, its distance in mbb/hand, approximate until finished", () => {
    pf.iters = 1000;
    const pv = (r: AdvisorResponse) => provenanceOf(r, ctx);
    const done = { study: "node", street: "preflop", source: "solver", solver: { iterations: 1500 }, pf_solve: { done: true, stored: true, mbb: 1.07 } } as AdvisorResponse;
    expect(describeProvenance(pv(done))).toBe("Preflop solve (class-level model) · precomputed · 1.07 mbb/hand from equilibrium (a seat's average) · 1500 iterations");
    expect(pv(done).approximate).toBe(false);
    const half = { ...done, pf_solve: { done: false, mbb: 4 } } as AdvisorResponse;
    expect(pv(half).approximate).toBe(true);
    expect(describeProvenance(pv(half))).toContain("the solve isn't finished: the numbers can still move");
    expect(describeProvenance(pv({ ...done, rough: true, regret_bb: 0.08 } as AdvisorResponse))).toContain("a line the solve rarely plays");
  });
});

describe("running and keeping a preflop solve", () => {
  it("runs chunk after chunk until done, asking the node again after each, then keeps the solve", async () => {
    const client = (await pf.getSolver()) as { solve: (r: { state: AdvisorState }) => Promise<SolveResult> };
    const ask = (state: AdvisorState) => client.solve({ state });
    const run = newRun(withPf(HU, "solver"));
    const refresh = vi.fn(async () => {});
    const seen: number[] = [];
    await runPf(run, ask, "test", { onUpdate: (r) => seen.push(r.it), refresh });
    expect(run).toMatchObject({ it: 1000, done: true, running: false, err: null });
    expect(asks("run")).toHaveLength(2);
    // once between the chunks, once at the end
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(seen).toContain(500);
    expect(await pfCache.get(pfCacheKey("test", "2max_100bb"))).toMatchObject({ blob: "UEZTMQ==", it: 1000 });

    // the worker no longer holds it (a reload): the node's answer is the kept solve, handed back
    pf.iters = 0;
    const r = await askNode(ask, studyRequest(withPf(HU, "solver")), "test");
    expect(r.data.study).toBe("node");
    expect(asks("load")).toHaveLength(1);
    expect(describeProvenance(provenanceOf(r.data, ctx))).toContain("solved earlier in this browser");
  });

  it("drops a kept solve the worker won't take, and offers the game as unsolved", async () => {
    const client = (await pf.getSolver()) as { solve: (r: { state: AdvisorState }) => Promise<SolveResult> };
    await pfCache.put(pfCacheKey("test", "2max_100bb"), { blob: "bad", it: 1000, mbb: 1, at: 1 });
    const r = await askNode((state) => client.solve({ state }), studyRequest(withPf(HU, "solver")), "test");
    expect(r.data.study).toBe("pf_unsolved");
    expect(await pfCache.get(pfCacheKey("test", "2max_100bb"))).toBeNull();
  });
});

function renderAt(h: StudyHand) {
  return render(
    <MemoryRouter initialEntries={[`/study?${toSearch(h)}`]}>
      <StudyPage />
    </MemoryRouter>,
  );
}

describe("Study's preflop Solver source", () => {
  it("offers to solve a game it doesn't hold, runs only on Solve, shows progress, and the solve's node", async () => {
    renderAt(withPf(HU, "solver"));
    const offer = await screen.findByRole("region", { name: "Solve this game's preflop" });
    expect(offer).toHaveTextContent("heads-up, 100bb, no rake");
    expect(offer).toHaveTextContent("About 10 s in your browser");
    // never started by itself
    expect(asks("run")).toHaveLength(0);
    expect(screen.getByRole("radio", { name: "Solver" })).toHaveAttribute("aria-checked", "true");

    let go!: () => void;
    pf.hold = new Promise((r) => (go = r));
    fireEvent.click(within(offer).getByRole("button", { name: "Solve" }));
    const prog = await screen.findByRole("status", { name: "Preflop solve" });
    expect(within(prog).getByRole("progressbar")).toBeInTheDocument();
    pf.hold = null;
    go();
    // the node from the solve, labelled as such, once it's done
    await waitFor(() => expect(screen.getByText(/^Preflop solve \(class-level model\) · 2\.00 mbb\/hand/)).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole("status", { name: "Preflop solve" })).toBeNull());
    expect(screen.getByLabelText("About the preflop solve")).toHaveTextContent("1000 iterations, 2.00 mbb/hand from equilibrium (a seat's average)");
    expect(screen.getByLabelText("About the preflop solve")).not.toHaveTextContent("Not finished");
    // the solve's EVs: the EV view is offered
    expect(screen.getByRole("button", { name: "EV" })).toBeInTheDocument();
    await waitFor(() => expect(asks("export")).toHaveLength(1));

    // back to the charts: no preflop solve asked
    pf.asked = [];
    fireEvent.click(screen.getByRole("radio", { name: "Charts" }));
    await waitFor(() => expect(pf.asked.length).toBeGreaterThan(0));
    expect(pf.asked.every((s) => s.preflop_solve === undefined)).toBe(true);
  });

  it("stops after the chunk running on Stop, keeps what's solved, and goes on with Continue", async () => {
    renderAt(withPf(HU, "solver"));
    const offer = await screen.findByRole("region", { name: "Solve this game's preflop" });
    let go!: () => void;
    pf.hold = new Promise((r) => (go = r));
    fireEvent.click(within(offer).getByRole("button", { name: "Solve" }));
    const prog = await screen.findByRole("status", { name: "Preflop solve" });
    fireEvent.click(within(prog).getByRole("button", { name: "Stop" }));
    expect(prog).toHaveTextContent("Stopping after this chunk");
    go();
    await waitFor(() => expect(screen.getByLabelText("About the preflop solve")).toHaveTextContent("Not finished: the numbers can still move."));
    expect(asks("run")).toHaveLength(1);
    expect(screen.getByText(/the solve isn't finished/)).toBeInTheDocument();
    pf.hold = null;
    fireEvent.click(screen.getByRole("button", { name: "Continue the solve" }));
    await waitFor(() => expect(screen.getByLabelText("About the preflop solve")).not.toHaveTextContent("Not finished"));
    expect(asks("run")).toHaveLength(2);
  });

  it("says when the solve doesn't take a game, and offers the charts", async () => {
    const client = (await pf.getSolver()) as { solve: (r: { state: AdvisorState }) => Promise<SolveResult> };
    const solve = client.solve;
    client.solve = async (r) => (r.state.preflop_solve ? { ...(await solve(r)), data: { study: "pf_none", street: "preflop", reason: "a tournament's preflop isn't solved here (the solve plays chips)" } } : solve(r));
    try {
      renderAt(withPf(HU, "solver"));
      expect(await screen.findByText(/The preflop solve doesn't take this game: a tournament's preflop/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Use the charts" }));
      await waitFor(() => expect(screen.getByRole("radio", { name: "Charts" })).toHaveAttribute("aria-checked", "true"));
    } finally {
      client.solve = solve;
    }
  });
});

describe("Compare: the charts against the preflop solve", () => {
  it("says the source is what differs, warns the sources differ by design, and says when a side isn't solved", () => {
    const b = withPf(HU, "solver");
    expect(whatDiffers(HU, b)).toEqual(["preflop source the charts → the preflop solve"]);
    expect(pfSourceOf({ ...b, board: "Ks7d2c" })).toBeNull();
    const charts = provenanceOf({ street: "preflop", study: "node" }, ctx);
    const solve = provenanceOf({ study: "node", street: "preflop", source: "solver", pf_solve: { done: true, mbb: 1 } } as AdvisorResponse, ctx);
    expect(sourceWarning(charts, solve, true)).toBe(
      "The two sides are two sources of the same spot (A: Preflop charts; B: Preflop solve (class-level model)): the differences are theirs, not the spot's. A (Preflop charts) is approximate: read small differences as noise.",
    );
    expect(notComparable({ study: "pf_unsolved", estimate_s: 200 })).toBe("This game's preflop isn't solved yet (about 3 min in your browser): open it in Study, solve it there, then come back.");
    expect(notComparable({ study: "node", grid: { actions: [], cells: {} } })).toBeNull();
  });
});
