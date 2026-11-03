// The one-size view, ported from the classic solver/tests/js/simple.test.js: a spot's run (the full menu first, then
// each size, one request a solve), its verdict (the best size, what each gives up), stopping and carrying on, the
// panel, and Study offering it heads-up after the flop where the player can bet or raise.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { freshHand, studyRequest } from "@/features/study/studyState";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import type { SolverClient } from "@/solver/client";
import { SolverError, type Provenance } from "@/solver/types";
import { OneSizePanel } from "./OneSizePanel";
import { baseKey, etaOf, EST, kindOf, merge, nextOf, offersOneSize, runOf, runs, start, stop, summarize, type Ask, type OneSizeAnswer, type OneSizeRow } from "./oneSize";

const grid = (n: string[]) => ({ actions: n, cells: { AKs: { w: 1, f: n.map((_, i) => (i === n.length - 1 ? 1 : 0)) } } });
const row = (size: string, ev: number, x = 0.05): OneSizeRow => ({
  size,
  actions: ["check", `bet ${size}`],
  freq: [0.4, 0.6],
  ev_bb: ev,
  iterations: 300,
  exploitability_pct: x,
  seconds: 0.5,
  grid: grid(["check", `bet ${size}`]),
});
const FULL: OneSizeRow = { ...row("full", 3.0), actions: ["check", "bet 33%", "bet 75%"], freq: [0.4, 0.2, 0.4], grid: grid(["check", "bet 33%", "bet 75%"]) };
const META: OneSizeAnswer = { street: "turn", actor: "BTN", pot_bb: 10, stack_bb: 95, candidates: ["33%", "75%", "150%"], target_pct: 0.1 };
const EV: Record<string, number> = { "33%": 2.9, "75%": 2.99, "150%": 2.95 };
const PROV: Provenance = { source: "unknown", approximate: false, mode: "fast", transport: "worker", solverVersion: "t", partial: false, receivedAt: 0 };
// a solver answering one_size requests: each its row and every row asked before (as the advisor keeps them)
function solver() {
  const asked: string[] = [], kept: Record<string, OneSizeRow> = {};
  const ask: Ask = async (st) => {
    const label = String(st.one_size);
    asked.push(label);
    kept[label] = label === "full" ? FULL : row(label, EV[label]!);
    const { full, ...rows } = kept;
    return { data: { one_size: { ...META, full: full ?? null, rows: Object.values(rows) } }, provenance: PROV };
  };
  return { ask, asked };
}
const STATE = { hero: "BTN", board: "Ks7d2cTh" } as unknown as AdvisorState;

describe("the one-size view's run", () => {
  it("asks the full menu first, then each size, once; the same spot at another speed is the same run", async () => {
    runs.clear();
    expect(baseKey({ ...STATE, speed: "accurate", budget: 60, prior_budget: 12 } as AdvisorState)).toBe(JSON.stringify(STATE));
    expect(baseKey({ hero: "BTN", one_size: "50%", speed: "fast", quick: true })).toBe(JSON.stringify({ hero: "BTN" }));
    const sv = solver(), seen: string[] = [];
    const run = await start(runOf(STATE), STATE, sv.ask, (r) => seen.push(r.status));
    expect(sv.asked).toEqual(["full", "33%", "75%", "150%"]);
    expect(run.status).toBe("done");
    expect([seen[0], seen.at(-1)]).toEqual(["running", "done"]);
    await start(runOf({ ...STATE, speed: "fast", budget: 8 }), STATE, sv.ask);
    expect(sv.asked).toHaveLength(4);
    const sum = summarize(run);
    expect(sum.best).toBe("75%");
    // ((3.0 - EV) / 10 bb pot, % of it)
    expect(sum.rows.map((r) => r.loss_pct)).toEqual([1, 0.1, 0.5]);
    expect(sum.tied).toEqual([]);
  });

  it("calls sizes within the solves' precision a tie, and nothing given up before the full menu", () => {
    const run = runOf({ t: 1 });
    merge(run, { ...META, full: null, rows: [row("33%", 2.9), { ...row("75%", 2.995), loss_pct: 9 }] });
    let s = summarize(run);
    expect(s.best).toBe("75%");
    expect(s.rows.map((r) => r.loss_pct)).toEqual([null, null]);
    expect(nextOf(run)).toBe("full");
    merge(run, { ...META, full: FULL, rows: [row("150%", 2.99)] });
    s = summarize(run);
    // (0.005 bb apart: inside 0.05% of a 10 bb pot)
    expect(s.tied).toEqual(["150%"]);
    expect(s.rows.map((r) => r.size)).toEqual(["33%", "75%", "150%"]);
    expect(nextOf(run)).toBeNull();
  });

  it("solves the sizes in the answer's order (the likely best first), else the candidates'", () => {
    const run = runOf({ order: 1 });
    merge(run, { ...META, full: FULL, rows: [] });
    expect(nextOf(run)).toBe("33%");
    merge(run, { ...META, order: ["150%", "75%", "33%"], full: FULL, rows: [] });
    expect(nextOf(run)).toBe("150%");
    merge(run, { ...META, order: ["150%", "75%", "33%"], full: FULL, rows: [row("150%", 2.95)] });
    expect(nextOf(run)).toBe("75%");
  });

  it("stops the request in flight, keeps what's in hand, and carries on from there; a failed request says so", async () => {
    runs.clear();
    const sv = solver();
    let hold: ((e: unknown) => void) | null = null;
    const ask: Ask = (st, signal) => {
      if (st.one_size === "75%" && !hold)
        return new Promise((_, reject) => {
          hold = reject;
          signal.addEventListener("abort", () => reject(new SolverError("cancelled", "stopped")));
        });
      return sv.ask(st, signal);
    };
    const run = runOf(STATE);
    const going = start(run, STATE, ask);
    await waitFor(() => expect(run.cur).toBe("75%"));
    stop(run, true);
    await going;
    expect(run.status).toBe("stopped");
    expect(run.userStopped).toBe(true);
    expect(Object.keys(run.rows)).toEqual(["33%"]);
    await start(run, STATE, ask);
    expect(sv.asked).toEqual(["full", "33%", "75%", "150%"]);
    expect(run.status).toBe("done");
    // stopped and started again before the stopped request's answer is back: the late answer is the old loop's
    runs.clear();
    const sv2 = solver();
    let late: ((e: unknown) => void) | null = null;
    const ask2: Ask = (st, signal) => (st.one_size === "75%" && !late ? new Promise((_, reject) => (late = reject)) : sv2.ask(st, signal));
    const run2 = runOf(STATE);
    const first = start(run2, STATE, ask2);
    await waitFor(() => expect(run2.cur).toBe("75%"));
    stop(run2);
    const again = start(run2, STATE, ask2);
    late!(new SolverError("cancelled", "stopped"));
    await first;
    await again;
    expect(run2.status).toBe("done");
    expect(Object.keys(run2.rows).sort()).toEqual(["150%", "33%", "75%"]);
    const bad = runOf({ bad: 1 });
    await start(bad, STATE, async () => ({ data: { error: "the one-size view is for heads-up pots: 3 players are in" }, provenance: PROV }));
    expect(bad.status).toBe("error");
    expect(bad.error).toMatch(/heads-up pots/);
  });

  it("estimates the time left first, then goes by the pace of the answers", () => {
    const run = runOf({ eta: 1 }, "flop");
    // (7 sizes and the full menu)
    expect(etaOf(run)).toBe(8 * EST.wasm.flop!);
    merge(run, { ...META, street: "flop", full: FULL, rows: [row("33%", 2.9)] });
    run.secs = [5, 1];
    expect(etaOf(run)).toBe(2 * 1);
  });

  it("is offered heads-up after the flop where the player can bet or raise, on a solved answer", () => {
    const acts = (...names: string[]) => names.map((action) => ({ action, freq: 0 }));
    expect(offersOneSize({ street: "turn", actions: acts("check", "bet 75%") })).toBe(true);
    for (const raise of ["raise to 16.5", "all-in"]) expect(offersOneSize({ street: "turn", actions: acts("fold", "call", raise) })).toBe(true);
    expect(offersOneSize({ street: "turn", actions: acts("fold", "call") })).toBe(false);
    expect(offersOneSize({ street: "turn", multiway: true, actions: acts("check", "bet 75%") })).toBe(false);
    expect(offersOneSize({ street: "turn", approximate: { label: "x" }, actions: acts("check", "bet 75%") })).toBe(false);
    expect(offersOneSize({ street: "preflop", actions: acts("fold", "raise 2.5") })).toBe(false);
    expect(kindOf(acts("fold", "call", "raise to 20.3"))).toBe("raise");
    expect(kindOf(acts("check", "bet 33%"))).toBe("bet");
  });
});

// ---- the panel, on a fake solver client answering each request as the solver above
function clientOf(ask: Ask, asked: AdvisorState[]) {
  return { solve: ({ state, signal, mode }: { state: AdvisorState; signal: AbortSignal; mode: string }) => (asked.push({ ...state, mode } as AdvisorState), ask(state, signal)) } as unknown as SolverClient;
}
const HAND = { ...freshHand(2, 100), preflop: [{ pos: "SB", action: "raise", to: 2.5 }, { pos: "BB", action: "call" }], board: "Ks7d2cTh", flop: [{ pos: "BB", action: "check" }, { pos: "SB", action: "check" }] };
const NODE: AdvisorResponse = { study: "node", street: "turn", actor: "BB", actions: [{ action: "check", freq: 0.6 }, { action: "bet 75%", freq: 0.4 }] };

describe("Study's one-size panel", () => {
  it("opens on a turn and solves every size at Fast, one a request: progress, the verdict, the sizes, the strategy, its badge", async () => {
    runs.clear();
    const sv = solver(), asked: AdvisorState[] = [];
    const client = clientOf(sv.ask, asked);
    render(<OneSizePanel hand={HAND} res={NODE} getSolver={async () => client} />);
    fireEvent.click(screen.getByRole("button", { name: "One bet size" }));
    const panel = await screen.findByRole("region", { name: "One bet size" });
    await within(panel).findByText(/Best single size/);
    expect(asked.map((s) => [s.one_size, (s as unknown as { mode: string }).mode])).toEqual([
      ["full", "fast"],
      ["33%", "fast"],
      ["75%", "fast"],
      ["150%", "fast"],
    ]);
    expect(baseKey(asked[0]!)).toBe(baseKey({ ...studyRequest(HAND), mode: "fast" } as AdvisorState));
    expect(panel).toHaveTextContent("Best single size: 75% · gives up 0.10% of the pot against every size mixed");
    const rows = within(within(panel).getByRole("table")).getAllByRole("row").map((r) => r.textContent);
    expect(rows).toEqual(["SizeBetsEVGives up", "Every size, mixed60%+3.00–", "33%60%+2.901.00%", "75%best60%+2.990.10%", "150%60%+2.950.50%"]);
    // the best's strategy is shown first; another row picked shows its own
    expect(within(panel).getByText(/: check 40% · bet 75% 60%/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Every size, mixed" }));
    expect(within(panel).getByText(/: check 40% · bet 33% 20% · bet 75% 40%/)).toBeInTheDocument();
    expect(within(panel).getByRole("grid", { name: /BTN range, every size/ })).toBeInTheDocument();
    expect(panel).toHaveTextContent("each solve is within 0.1% of the pot of equilibrium, so sizes closer than that are a tie");
    expect(within(panel).getByText(/^Live solve · one-size view, 4 of 4 solves at Fast \(the widest's distance shown\) · 0\.05% pot from equilibrium/)).toBeInTheDocument();
  });

  it("waits to be asked on a flop, shows progress with Stop, and carries on with Continue", async () => {
    runs.clear();
    const sv = solver(), asked: AdvisorState[] = [];
    let hold: (() => void) | null = null;
    const ask: Ask = (st, signal) =>
      st.one_size === "75%" && !hold
        ? new Promise((_, reject) => {
            hold = () => reject(new SolverError("cancelled", "stopped"));
            signal.addEventListener("abort", hold);
          })
        : sv.ask(st, signal);
    const flop = { ...HAND, board: "Ks7d2c", flop: [] };
    render(<OneSizePanel hand={flop} res={{ ...NODE, street: "flop" }} getSolver={async () => clientOf(ask, asked)} />);
    fireEvent.click(screen.getByRole("button", { name: "One bet size" }));
    const panel = screen.getByRole("region", { name: "One bet size" });
    expect(panel).toHaveTextContent(`A flop solve per size: 8 solves of the flop (every size alone and all of them mixed), about ${Math.round(8 * EST.wasm.flop!)} s in all.`);
    expect(asked).toEqual([]);
    fireEvent.click(within(panel).getByRole("button", { name: "Find the best size" }));
    await within(panel).findByText(/Solving 75% · 2 of 4 done/);
    expect(panel).toHaveTextContent("Best so far: 33%");
    expect(within(panel).getByRole("progressbar", { name: "Solves done" })).toHaveAttribute("aria-valuenow", "2");
    fireEvent.click(within(panel).getByRole("button", { name: "Stop" }));
    await within(panel).findByText(/Stopped: 2 of 4 solved/);
    fireEvent.click(within(panel).getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(panel).toHaveTextContent("Best single size: 75%"));
    expect(asked.map((st) => st.one_size)).toEqual(["full", "33%", "75%", "75%", "150%"]);
  });

  it("facing a bet, the raise view: multiples of the bet, each with what it raises to; a tournament's EVs in prize equity", () => {
    runs.clear();
    const R = (size: string, ev: number, to: number): OneSizeRow => ({
      size,
      actions: ["fold", "call", `raise to ${to}`],
      freq: [0.3, 0.5, 0.2],
      ev_bb: ev,
      exploitability_pct: 0.05,
      grid: grid(["fold", "call", `raise to ${to}`]),
    });
    const full = { ...R("full", 2.0, 16.8), actions: ["fold", "call", "raise to 16.8", "raise to 20.3"], freq: [0.3, 0.5, 0.1, 0.1], grid: grid(["fold", "call", "raise to 16.8", "raise to 20.3"]) };
    const res: AdvisorResponse = { ...NODE, actions: [{ action: "fold", freq: 0.3 }, { action: "call", freq: 0.5 }, { action: "raise to 20.3", freq: 0.2 }] };
    const run = runOf(studyRequest(HAND), "turn", "raise");
    merge(run, {
      ...META,
      kind: "raise",
      candidates: ["2.5x", "3x"],
      order: ["3x", "2.5x"],
      raises: { "2.5x": { to: 16.8, pct: 44 }, "3x": { to: 20.3, pct: 59 } },
      tournament: ["tournament: ICM, your prize equity 16.7% of what's left to pay"],
      full,
      rows: [R("2.5x", 1.9, 16.8), R("3x", 1.99, 20.3)],
    });
    run.status = "done";
    render(<OneSizePanel hand={HAND} res={res} getSolver={async () => clientOf(solver().ask, [])} />);
    fireEvent.click(screen.getByRole("button", { name: "One raise size" }));
    const panel = screen.getByRole("region", { name: "One raise size" });
    expect(panel).toHaveTextContent("Best single raise size: 3x to 20.3 · gives up 0.10% of the pot against every raise size mixed");
    expect(within(within(panel).getByRole("table")).getAllByRole("row").map((r) => r.textContent)).toEqual(["RaiseRaisesEVGives up", "Every size, mixed20%+2.00–", "2.5x to 16.820%+1.901.00%", "3x to 20.3best20%+1.990.10%"]);
    expect(panel).toHaveTextContent("Sizes are multiples of the bet faced");
    expect(panel).toHaveTextContent("Best: the raise size that keeps the most EV for the player facing the bet");
    expect(panel).toHaveTextContent("3x: fold 30% · call 50% · raise to 20.3 20%");
    expect(panel).toHaveTextContent("In a tournament every solve pays prize equity (ICM), so EVs are chips worth as much prize equity. tournament: ICM, your prize equity 16.7%");
  });

  it("marks a size stopped early, once clearly behind the best, as approximate", () => {
    runs.clear();
    const run = runOf(studyRequest(HAND), "turn");
    merge(run, { ...META, full: FULL, rows: [row("75%", 2.99), { ...row("33%", 2.77, 0.42), cut: true }, row("150%", 2.95)] });
    run.status = "done";
    render(<OneSizePanel hand={HAND} res={NODE} getSolver={async () => clientOf(solver().ask, [])} />);
    fireEvent.click(screen.getByRole("button", { name: "One bet size" }));
    const panel = screen.getByRole("region", { name: "One bet size" });
    expect(within(panel).getByTitle("Stopped once clearly behind the best: within 0.42% of the pot")).toHaveTextContent("≈2.3%");
    expect(panel).toHaveTextContent("; ≈: a size whose solve stopped early, once it was clearly behind the best.");
  });
});
