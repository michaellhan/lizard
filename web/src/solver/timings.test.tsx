// Solve times measured in this browser (ROADMAP Phase 6): live answers' engine seconds by backend, mode, street and
// table, once per request, the last KEEP kept; their medians beside the modes and in Settings.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ModePicker, ModeTimes } from "@/features/study/ModePicker";
import { useSettings } from "@/state/settings";
import { SolverClient } from "./client";
import type { AdvisorResponse, AdvisorState } from "./protocol";
import { provenanceOf } from "./provenance";
import { clearTimings, KEEP, modeTimesText, recordTiming, resetTimingsForTest, timingOf, useTimings } from "./timings";
import type { PlayRequest, RuntimeStatus, SolverTransport } from "./types";

const ctx = { mode: "fast" as const, transport: "worker" as const, solverVersion: "t", partial: false, now: 1 };
const LIVE: AdvisorResponse = { street: "river", seconds: 4.2, solver: { iterations: 300, exploitability_pct: 0.1 } };

/** Answers every request at once with `answer(state)`. */
class Instant implements SolverTransport {
  readonly kind = "worker" as const;
  constructor(private answer: (s: AdvisorState) => AdvisorResponse) {}
  request(state: AdvisorState, _opts: { progressive: boolean; signal?: AbortSignal; play?: PlayRequest }) {
    return Promise.resolve(this.answer(state));
  }
  stopCost() {
    return "kills" as const;
  }
  onStatus(cb: (s: RuntimeStatus) => void) {
    cb(this.status());
    return () => {};
  }
  status(): RuntimeStatus {
    return { phase: "ready", transport: "worker", crossOriginIsolated: false };
  }
  dispose() {}
}

const store = () => {
  let s: ReturnType<typeof useTimings> = {};
  function Probe() {
    s = useTimings();
    return null;
  }
  render(<Probe />);
  return s;
};

beforeEach(() => {
  localStorage.clear();
  resetTimingsForTest();
});

describe("measured solve times", () => {
  it("counts a live answer's engine seconds once per request, and nothing that wasn't solved", () => {
    const rec = (req: string, r: AdvisorResponse) => recordTiming(req, "worker", "fast", r, provenanceOf(r, ctx));
    rec("a", LIVE);
    rec("a", { ...LIVE, seconds: 0.1 }); // the same request again: the engine's cache answers it
    rec("b", { ...LIVE, seconds: 6 });
    rec("c", { ...LIVE, precomputed: { spot: "srp" } }); // a library flop
    rec("d", { street: "preflop", seconds: 1 }); // the charts
    rec("e", { ...LIVE, seconds: undefined });
    rec("f", { ...LIVE, multiway: true, solved: true, seconds: 20 });
    expect(provenanceOf({ ...LIVE, multiway: true, solved: true }, ctx).source).toBe("live");
    const s = store();
    expect(timingOf(s, "worker", "fast", "river", false)).toEqual({ median: 5.1, n: 2 });
    expect(timingOf(s, "worker", "fast", "river", true)).toEqual({ median: 20, n: 1 });
    expect(timingOf(s, "worker", "accurate", "river", false)).toBeNull();
    expect(timingOf(s, "http", "fast", "river", false)).toBeNull();
    expect(modeTimesText(s, "worker", "fast")).toBe("river 5.1 s (2), multiway river 20 s (1)");
    expect(modeTimesText(s, "worker", "quick")).toBeNull();
    // the last KEEP only, kept in localStorage
    for (let i = 0; i < KEEP + 5; i++) rec(`k${i}`, { ...LIVE, street: "turn", seconds: i + 1 });
    expect(timingOf(store(), "worker", "fast", "turn", false)).toEqual({ median: 15.5, n: KEEP });
    resetTimingsForTest();
    expect(timingOf(store(), "worker", "fast", "turn", false)?.n).toBe(KEEP);
  });

  it("is recorded by the client for advice and Study answers at the mode they ran at, not opponents' moves", async () => {
    const c = new SolverClient(new Instant(() => LIVE), "t");
    await c.solve({ state: { players: 2, board: "Ks7d2c5h9s", study: true }, mode: "quick" }); // Study runs Quick at Fast
    await c.solve({ state: { players: 2, board: "Ks7d2c5h9s", study: true }, mode: "quick" });
    await c.solve({ state: { players: 2, board: "Ks7d2c5h9s", hero: "SB", hole: "AhQd" }, mode: "accurate" });
    await c.play({ players: 2, board: "Ks7d2c5h9s", hero: "SB", hole: "AhQd" }, { seat: "BB", hole: "KhKd" }, { mode: "quick" });
    const s = store();
    expect(timingOf(s, "worker", "fast", "river", false)?.n).toBe(1);
    expect(timingOf(s, "worker", "accurate", "river", false)?.n).toBe(1);
    expect(timingOf(s, "worker", "quick", "river", false)).toBeNull();
  });

  it("files a triage's Quick solves under Quick, whatever the request's mode, and doesn't time its reads", async () => {
    const answers: AdvisorResponse[] = [
      { ...LIVE, seconds: 1.5, triage: { source: "quick", confidence: "medium", label: "a Quick solve" } },
      { street: "river", seconds: 0.01, approximate: { source: "solve", label: "its own solve" }, triage: { source: "approx", confidence: "low", label: "a read" } },
    ];
    const c = new SolverClient(new Instant(() => answers.shift()!), "t");
    await c.solve({ state: { players: 2, board: "QsJd2c3h4s", hole: "AhAd" }, mode: "fast" });
    await c.solve({ state: { players: 2, board: "QsJd2c3h4s", hole: "KhKd" }, mode: "fast" });
    const s = store();
    expect(timingOf(s, "worker", "quick", "river", false)).toEqual({ median: 1.5, n: 1 });
    expect(timingOf(s, "worker", "fast", "river", false)).toBeNull();
  });

  it("shows the medians on the mode buttons and in Settings' table, and clears them", () => {
    useSettings.setState({ transport: "worker" });
    render(<ModePicker modes={["fast", "accurate"]} />);
    const fast = screen.getByRole("radio", { name: "Fast" });
    expect(fast.title).toMatch(/Not measured in this browser yet$/);
    render(<ModeTimes />);
    const table = screen.getByRole("table", { name: "Solve times measured in this browser" });
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("Quick–––");
    act(() => {
      recordTiming("x", "worker", "fast", LIVE, provenanceOf(LIVE, ctx));
      recordTiming("y", "worker", "fast", { ...LIVE, street: "flop", seconds: 12.4 }, provenanceOf(LIVE, ctx));
    });
    expect(fast.title).toMatch(/Measured in this browser: flop 12 s \(1\), river 4\.2 s \(1\) \(the median/);
    expect(within(table).getAllByRole("row")[2]).toHaveTextContent("Fast12 s (1)–4.2 s (1)");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(within(table).getAllByRole("row")[2]).toHaveTextContent("Fast–––");
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    act(() => clearTimings());
  });
});
