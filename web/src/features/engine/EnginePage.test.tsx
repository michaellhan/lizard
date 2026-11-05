// The hands check on the Engine page: its controls, what a run is given, and what a report shows. The run itself is
// handsCheck.test.ts's; here it's a stand-in that goes when it's told, but for one run that's real.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kvGet, kvSet } from "@/data/db";
import { SolverError } from "@/solver/types";
import { useSettings } from "@/state/settings";
import { EnginePage } from "./EnginePage";
import { CHECK_KEY, runHandsCheck, type HandsCheckOptions, type HandsCheckReport } from "./handsCheck";

vi.mock("./handsCheck", { spy: true });

const solver = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/solver/useSolver", () => ({ useSolver: () => solver.get }));

const build = vi.hoisted(() => ({ manifest: vi.fn() }));
vi.mock("@/solver/runtime", async (orig) => ({ ...(await orig<typeof import("@/solver/runtime")>()), loadManifest: build.manifest }));

const actual = (await vi.importActual<typeof import("./handsCheck")>("./handsCheck")).runHandsCheck;
/** The real run, with nothing to wait for between moves (the page's own pace is handsCheck.test.ts's). */
const realRun: typeof runHandsCheck = (g, o) => actual(g, { ...o, pace: 0 });

const AT = Date.UTC(2026, 10, 4, 12);
const REPORT: HandsCheckReport = {
  v: 1,
  at: AT,
  passed: true,
  stopped: false,
  seed: 5,
  fingerprint: "ab12cd34",
  of: 20,
  tables: 4,
  thinkMs: 3000,
  askAhead: true,
  mode: "quick",
  transport: "worker",
  isolated: true,
  stopCost: "cheap",
  solver: "9b907bd6/abc",
  earlier: 0,
  hands: 20,
  verdicts: 63,
  requestErrors: 0,
  unlabelled: 0,
  restarts: 0,
  seconds: 108,
  bySource: { "Preflop charts": 21, "Live solve": 40, "Heuristic rules (not a solve)": 2 },
  failures: [],
  waits: { n: 42, medianS: 1.25, p90S: 4.5 },
  requests: { reached: 131, answered: 119, stopped: 12, medianS: 0.31, postflopMedianS: 2.4 },
  gap: [{ street: "flop", n: 30, estS: 2, s: 2.5 }],
  ahead: { asked: 52, used: 31, savedS: 44, spentS: 96 },
};
const MANIFEST = { version: "abc", upstream: { repo: "r", commit: "9b907bd6ffff", date: "" }, builtAt: "", files: [] };

/** A run that waits to be told how it went: `go` ends it, and a stop ends it as stopped. */
function held() {
  const seen: HandsCheckOptions[] = [];
  let go: (r: HandsCheckReport) => void = () => {};
  vi.mocked(runHandsCheck).mockImplementation((_, o) => {
    seen.push(o);
    return new Promise((resolve) => {
      go = resolve;
      o.signal?.addEventListener("abort", () => resolve({ ...REPORT, passed: false, stopped: true, hands: 3, ahead: null }));
    });
  });
  return { seen, end: (r: HandsCheckReport) => act(async () => go(r)) };
}

const show = () =>
  render(
    <MemoryRouter>
      <EnginePage />
    </MemoryRouter>,
  );

const play = () => fireEvent.click(screen.getByRole("button", { name: "Play 20 hands" }));
const report = () => screen.findByRole("region", { name: "Last report" });
/** Past the moment a press is ignored, as Play and Stop change places. */
const swapped = () => act(() => new Promise<void>((r) => setTimeout(r, 400)));

beforeEach(() => {
  build.manifest.mockResolvedValue(null);
  vi.stubGlobal("crossOriginIsolated", true);
});

afterEach(async () => {
  cleanup();
  vi.mocked(runHandsCheck).mockReset();
  useSettings.setState({ askAhead: null });
  await kvSet(CHECK_KEY, undefined);
  vi.unstubAllGlobals();
});

describe("the controls", () => {
  it("are under the self-test, at four tables, no time to think and asking ahead as Settings read", () => {
    show();
    expect(screen.getByLabelText("Tables")).toHaveValue("4");
    expect(screen.getByLabelText("Time to think")).toHaveValue("0");
    expect(screen.getByLabelText("Ask ahead")).toBeChecked();
    expect(screen.getByText("A few minutes of CPU. Nothing is saved to History or Analyze.")).toBeInTheDocument();
    const self = screen.getByRole("button", { name: "Run self-test" });
    expect(self.compareDocumentPosition(screen.getByRole("button", { name: "Play 20 hands" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offer one table or four, and none or 3 s", () => {
    show();
    const options = (name: string) => within(screen.getByLabelText(name)).getAllByRole("option").map((o) => o.textContent);
    expect(options("Tables")).toEqual(["1", "4"]);
    expect(options("Time to think")).toEqual(["None", "3 s"]);
  });

  it("take asking ahead from Settings where it's set", () => {
    useSettings.setState({ askAhead: false });
    show();
    expect(screen.getByLabelText("Ask ahead")).not.toBeChecked();
  });

  it("run with what they say, the same deals each time, and write none of it to Settings", async () => {
    const { seen, end } = held();
    show();
    play();
    await end(REPORT);
    fireEvent.change(screen.getByLabelText("Tables"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Time to think"), { target: { value: "3000" } });
    fireEvent.click(screen.getByLabelText("Ask ahead"));
    const before = { ...useSettings.getState() };
    await swapped();
    play();
    await end(REPORT);
    expect(seen[0]).toMatchObject({ hands: 20, tables: 4, thinkMs: 0, askAhead: true });
    expect(seen[1]).toMatchObject({ hands: 20, tables: 1, thinkMs: 3000, askAhead: false });
    expect(seen[1]!.seed).toBe(seen[0]!.seed);
    expect(useSettings.getState().askAhead).toBeNull();
    expect(useSettings.getState()).toEqual(before);
    expect(vi.mocked(runHandsCheck).mock.calls[0]![0]).toBe(solver.get);
  });

  it("can't ask ahead where a stop would end the solver, say why in words, and don't run it", async () => {
    vi.stubGlobal("crossOriginIsolated", false);
    useSettings.setState({ askAhead: true });
    const { seen, end } = held();
    show();
    expect(screen.getByLabelText("Ask ahead")).toBeDisabled();
    expect(screen.getByLabelText("Ask ahead")).not.toBeChecked();
    expect(screen.getByText(/this browser can.t stop a solve, so a wrong guess would hold up your next answer/i)).toBeInTheDocument();
    play();
    await end(REPORT);
    expect(seen[0]).toMatchObject({ askAhead: false });
    expect(useSettings.getState().askAhead).toBe(true);
  });

  it("keep what you've ticked over what Settings read", () => {
    useSettings.setState({ askAhead: true });
    show();
    fireEvent.click(screen.getByLabelText("Ask ahead"));
    expect(screen.getByLabelText("Ask ahead")).not.toBeChecked();
    expect(useSettings.getState().askAhead).toBe(true);
  });
});

describe("a run", () => {
  it("says how it's going, holds its settings and offers Stop", async () => {
    const { seen, end } = held();
    show();
    const line = screen.getByRole("status");
    expect(line).toBeEmptyDOMElement();
    play();
    expect(line).toHaveTextContent("Hand 1 of 20 · 0 verdicts · 0 errors");
    await act(async () => seen[0]!.onProgress!({ hands: 6, of: 20, verdicts: 18, errors: 0 }));
    expect(line).toHaveTextContent("Hand 7 of 20 · 18 verdicts · 0 errors");
    // (a verdict within a hand says nothing, or each would be read out)
    await act(async () => seen[0]!.onProgress!({ hands: 6, of: 20, verdicts: 19, errors: 0 }));
    expect(line).toHaveTextContent("Hand 7 of 20 · 18 verdicts · 0 errors");
    expect(screen.queryByRole("button", { name: "Play 20 hands" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Tables")).toBeDisabled();
    expect(screen.getByLabelText("Time to think")).toBeDisabled();
    expect(screen.getByLabelText("Ask ahead")).toBeDisabled();
    await end(REPORT);
    // (the same element, so the end is read out too)
    expect(line).toBeInTheDocument();
    expect(line).toHaveTextContent("Passed: 20 hands · 63 verdicts · 0 request errors · 0 without a label · 1 m 48 s");
    expect(line.className).toBe("sr-only");
    expect(screen.getByRole("button", { name: "Play 20 hands" })).toBeInTheDocument();
    expect(screen.getByLabelText("Tables")).toBeEnabled();
  });

  it("takes a double-click as one press, though Stop comes up under the second, and Play under one at the end", async () => {
    const { seen, end } = held();
    show();
    play();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(seen[0]!.signal!.aborted).toBe(false);
    await end(REPORT);
    play();
    expect(seen).toHaveLength(1);
    await swapped();
    play();
    expect(seen).toHaveLength(2);
    await end(REPORT);
  });

  it("stops at Stop, with a report that says so and doesn't say it passed", async () => {
    const { seen } = held();
    show();
    play();
    await swapped();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(seen[0]!.signal!.aborted).toBe(true);
    const r = await report();
    expect(within(r).getByRole("heading", { name: "Stopped" })).toBeInTheDocument();
    expect(within(r).getByText(/stopped at 3 of 20/)).toBeInTheDocument();
    expect(within(r).queryByText("Passed")).not.toBeInTheDocument();
  });

  it("ends when you leave the page", () => {
    const { seen } = held();
    const { unmount } = show();
    play();
    expect(seen[0]!.signal!.aborted).toBe(false);
    unmount();
    expect(seen[0]!.signal!.aborted).toBe(true);
  });

  it("clears the report it's replacing", async () => {
    const { end } = held();
    show();
    play();
    await end(REPORT);
    expect(screen.getByRole("region", { name: "Last report" })).toBeInTheDocument();
    await swapped();
    play();
    expect(screen.queryByRole("region", { name: "Last report" })).not.toBeInTheDocument();
    await end(REPORT);
  });

  it("marks a second run on the same solver, which has its answers, and says to reload before a timed one", async () => {
    vi.mocked(runHandsCheck).mockImplementation(realRun);
    const fail = () => Promise.reject(new SolverError("unreachable", "no server"));
    solver.get.mockResolvedValue({ solve: fail, play: fail, transport: { kind: "http" } });
    show();
    expect(screen.getByText(/Reload this page before a timed run/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Tables"), { target: { value: "1" } });
    play();
    const first = await screen.findByRole("region", { name: "Last report" }, { timeout: 30_000 });
    expect(first).not.toHaveTextContent("Not a cold run");
    await swapped();
    play();
    const second = await screen.findByRole("region", { name: "Last report" }, { timeout: 30_000 });
    expect(second).toHaveTextContent("Not a cold run: this solver had played a run already");
  }, 70_000);

  it("gets to a report on the real thing, a solver that fails included", async () => {
    vi.stubGlobal("crossOriginIsolated", false);
    vi.mocked(runHandsCheck).mockImplementation(realRun);
    const fail = () => Promise.reject(new SolverError("unreachable", "no server"));
    solver.get.mockResolvedValue({ solve: fail, play: fail, transport: { kind: "http" } });
    show();
    fireEvent.change(screen.getByLabelText("Tables"), { target: { value: "1" } });
    play();
    const r = await screen.findByRole("region", { name: "Last report" }, { timeout: 30_000 });
    expect(within(r).getByRole("heading", { name: "Failed" })).toBeInTheDocument();
    expect(within(r).getByText("Local Python server · not isolated")).toBeInTheDocument();
    expect(within(r).getAllByText(/A request failed: no server/).length).toBeGreaterThan(0);
    expect(within(r).getAllByRole("link", { name: "Open in Study" })[0]).toHaveAttribute("href", expect.stringMatching(/^\/study\?p=6&s=100/));
    await waitFor(async () => expect(await kvGet(CHECK_KEY)).toBeTruthy());
  }, 40_000);
});

describe("the report", () => {
  const shown = async (r: HandsCheckReport) => {
    const { end } = held();
    show();
    play();
    await end(r);
    return report();
  };

  it("gives everything the timed runs need", async () => {
    const r = await shown(REPORT);
    expect(within(r).getByRole("heading", { name: "Passed" })).toBeInTheDocument();
    expect(r).toHaveTextContent("20 hands · 63 verdicts · 0 request errors · 0 without a label · 1 m 48 s");
    expect(r).toHaveTextContent("4 tables · 3 s to think a decision · asking ahead on · Quick");
    expect(r).toHaveTextContent("In-browser (Python via Pyodide in a Web Worker) · cross-origin isolated");
    expect(r).toHaveTextContent("ab12cd34");
    expect(r).toHaveTextContent("median 1.25 s · p90 4.50 s · 42 spots");
    expect(r).toHaveTextContent("median 0.31 s · postflop 2.40 s");
    expect(r).toHaveTextContent("131, 12 of them stopped");
    expect(r).toHaveTextContent("31 of 52 postflop look-aheads used · about 44 s saved with no other table waiting, for 96 s of solver time");
    expect(r).toHaveTextContent("flop: estimated 2.00 s, took 2.50 s (30)");
    expect(r).toHaveTextContent("measured in this browser");
  });

  it("says what its wait is: from your turn arriving, without the pace or an opponent's own move", async () => {
    const r = await shown(REPORT);
    expect(r).toHaveTextContent("Answer after your turn arrives, postflop");
    expect(r).not.toHaveTextContent("Wait for your options");
    expect(r).toHaveTextContent("it leaves out the pace and an opponent’s own move");
  });

  it("names what answered each verdict, the rules and the unlabelled in their own words, and never as solved", async () => {
    const r = await shown({ ...REPORT, bySource: { "Preflop charts": 21, "Heuristic rules (not a solve)": 2, Unlabelled: 1 } });
    expect(within(r).getByText("Preflop charts: 21")).toBeInTheDocument();
    expect(within(r).getByText("Heuristic rules (not a solve): 2")).toBeInTheDocument();
    expect(within(r).getByText("Unlabelled: 1")).toBeInTheDocument();
    expect(within(r).queryByText(/Preflop charts.*solved|solved.*Preflop charts/)).not.toBeInTheDocument();
  });

  it("says the waits have nothing in them, not zero, and leaves out a meter it didn't run", async () => {
    const r = await shown({ ...REPORT, ahead: null, waits: { n: 0, medianS: null, p90S: null }, requests: { ...REPORT.requests, medianS: null, postflopMedianS: null }, transport: null, isolated: false });
    expect(r).toHaveTextContent("median none · p90 none · 0 spots");
    expect(r).toHaveTextContent("median none · postflop none");
    expect(r).toHaveTextContent("none reached · not isolated");
    expect(r).not.toHaveTextContent("Asked ahead");
  });

  it("says why asking ahead asked nothing", async () => {
    const r = await shown({ ...REPORT, ahead: { asked: 0, used: 0, savedS: 0, spentS: 0 }, stopCost: "kills" });
    expect(within(r).getByText("Nothing asked: this browser can't stop a solve, so a wrong guess would hold up the next answer.")).toBeInTheDocument();
  });

  it("lists each failure, with a link to Study where it has a spot", async () => {
    const r = await shown({
      ...REPORT,
      passed: false,
      failures: [
        { rule: "label", text: "Table 1, hand 2, flop, check: nothing says what answered it", study: "p=6&s=100&b=AsKd2c" },
        { rule: "restart", text: "The worker was ended 2 times, on a page where a stop shouldn't need that." },
      ],
    });
    expect(within(r).getByRole("heading", { name: "Failed" })).toBeInTheDocument();
    expect(within(r).getByText(/Table 1, hand 2, flop, check: nothing says/)).toBeInTheDocument();
    expect(within(r).getByText(/The worker was ended 2 times/)).toBeInTheDocument();
    const links = within(r).getAllByRole("link", { name: "Open in Study" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/study?p=6&s=100&b=AsKd2c");
  });

  it("copies the whole report as JSON, and says it has only once it has", async () => {
    let done: () => void = () => {};
    const writeText = vi.fn(() => new Promise<void>((resolve) => (done = resolve)));
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const r = await shown(REPORT);
    const said = within(r).getByRole("status");
    expect(said).toBeEmptyDOMElement();
    fireEvent.click(within(r).getByRole("button", { name: "Copy report" }));
    expect(JSON.parse((writeText.mock.calls[0] as unknown as [string])[0])).toEqual(REPORT);
    expect(said).toBeEmptyDOMElement();
    await act(async () => done());
    expect(said).toHaveTextContent("Copied");

    // (again, the same element: it empties, so a reader is told each time)
    fireEvent.click(within(r).getByRole("button", { name: "Copy report" }));
    expect(said).toBeEmptyDOMElement();
    await act(async () => done());
    expect(said).toHaveTextContent("Copied");
  });

  it("says it couldn't copy, where the browser refused", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: () => Promise.reject(new Error("denied")) } });
    const r = await shown(REPORT);
    fireEvent.click(within(r).getByRole("button", { name: "Copy report" }));
    await waitFor(() => expect(within(r).getByRole("status")).toHaveTextContent("Couldn't copy"));
  });

  it("says it couldn't copy, where the page has no clipboard", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    const r = await shown(REPORT);
    fireEvent.click(within(r).getByRole("button", { name: "Copy report" }));
    await waitFor(() => expect(within(r).getByRole("status")).toHaveTextContent("Couldn't copy"));
  });

  it("says when it ran and on what build, kept or not", async () => {
    build.manifest.mockResolvedValue(MANIFEST);
    await kvSet(CHECK_KEY, REPORT);
    show();
    const r = await report();
    await act(async () => {});
    expect(r).toHaveTextContent(new Date(AT).toLocaleString());
    expect(r).toHaveTextContent("on build 9b907bd6/abc");
    expect(r).not.toHaveTextContent("earlier build");
  });

  it("says a kept one ran on an earlier build where this page's is another, before any solver's been asked for", async () => {
    build.manifest.mockResolvedValue({ ...MANIFEST, version: "abd" });
    await kvSet(CHECK_KEY, REPORT);
    show();
    expect(await within(await report()).findByText(/on an earlier build, 9b907bd6\/abc/)).toBeInTheDocument();
    expect(solver.get).not.toHaveBeenCalled();
  });

  it("claims nothing of a build where this page can't read its own", async () => {
    await kvSet(CHECK_KEY, REPORT);
    show();
    const r = await report();
    await act(async () => {});
    expect(build.manifest).toHaveBeenCalled();
    expect(r).toHaveTextContent("on build 9b907bd6/abc");
  });

  it("marks a run that wasn't cold, and not one that was", async () => {
    const r = await shown({ ...REPORT, earlier: 2 });
    expect(r).toHaveTextContent("Not a cold run: this solver had played 2 runs already");
    cleanup();
    expect(await shown(REPORT)).not.toHaveTextContent("Not a cold run");
  });

  it("says the deals match only at the same number of tables", async () => {
    const r = await shown(REPORT);
    expect(r).toHaveTextContent("Runs at the same number of tables deal these same hands");
    expect(r).not.toHaveTextContent("Every run deals");
  });

  it("doesn't claim more than it can see", async () => {
    const r = await shown(REPORT);
    expect(r).toHaveTextContent("It can’t prove any grade right, or say anything about Accurate, phones or other machines.");
    expect(r).not.toHaveTextContent(/grades? (are|is|were) (right|correct)|verified|accurate grades/i);
  });

  it("is what's kept from last time when you come back", async () => {
    await kvSet(CHECK_KEY, REPORT);
    show();
    expect(await report()).toHaveTextContent("20 hands · 63 verdicts");
  });

  it("isn't replaced by an old one read late, nor shows one over a run", async () => {
    await kvSet(CHECK_KEY, { ...REPORT, verdicts: 1 });
    const { end } = held();
    show();
    play();
    await new Promise((f) => setTimeout(f, 30));
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Last report" })).not.toBeInTheDocument();
    await end({ ...REPORT, verdicts: 99 });
    await new Promise((f) => setTimeout(f, 30));
    expect(await report()).toHaveTextContent("99 verdicts");
  });
});
