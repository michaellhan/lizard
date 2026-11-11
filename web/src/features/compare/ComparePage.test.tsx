import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { betMenuOf, CompareLinks, variantsOf, withMenu } from "@/features/study/CompareLinks";
import { freshHand, fromSearch, toSearch, type StudyHand } from "@/features/study/studyState";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import type { Provenance, SolveResult } from "@/solver/types";
import { ComparePage } from "./ComparePage";
import { compareLink } from "./compare";
import { diffLabel } from "./DiffMatrix";
import { putSpot } from "@/data/saved";
import { studyQueryOf, usePin } from "./pin";

// the solver stubbed: each request (kept in `stub.asked`) answers with `stub.answerFor` and `stub.provenanceFor` of it
const stub = vi.hoisted(() => {
  const s = {
    answerFor: (() => ({})) as (st: AdvisorState) => AdvisorResponse,
    provenanceFor: null as ((st: AdvisorState) => Partial<Provenance>) | null,
    asked: [] as AdvisorState[],
    getSolver: null as unknown as () => Promise<unknown>,
  };
  const client = {
    solve: async ({ state }: { state: AdvisorState }): Promise<SolveResult> => (s.asked.push(state), {
      data: s.answerFor(state),
      provenance: {
        source: "live",
        approximate: false,
        mode: "fast",
        transport: "worker",
        solverVersion: "test",
        partial: false,
        receivedAt: 0,
        exploitabilityPct: 0.3,
        band: "converged",
        ...s.provenanceFor?.(state),
      },
    }),
  };
  s.getSolver = async () => client;
  return s;
});
vi.mock("@/solver/useSolver", () => ({ useSolver: () => stub.getSolver }));

afterEach(() => {
  stub.asked = [];
  stub.provenanceFor = null;
  usePin.getState().setPin(null);
});

const node = (bet: number, aa: number): AdvisorResponse => ({
  study: "node",
  street: "flop",
  actor: "BB",
  pot_bb: 10,
  range_combos: 400,
  range_ev_bb: 3 + bet,
  range_eq: 0.48,
  actions: [
    { action: "check", freq: 1 - bet, combos: 400 * (1 - bet), ev_bb: 3 },
    { action: "bet 33%", freq: bet, combos: 400 * bet, ev_bb: 4 },
  ],
  grid: {
    actions: ["check", "bet 33%"],
    cells: { AA: { w: 1, f: [1 - aa, aa], evm: 9 + aa }, KQs: { w: 1, f: [0.6, 0.4], evm: 4 } },
  },
});

const A: StudyHand = { ...freshHand(2, 100), board: "Ks7d2c", preflop: [], setup: { rake: 5, rakeCap: 3 } };
const B: StudyHand = { ...A, setup: undefined };

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ComparePage />
    </MemoryRouter>,
  );
}

describe("the Compare page", () => {
  it("asks A, then B, and shows how B differs: the actions, the range, each class", async () => {
    // A raked (bets 30%, AA 80%), B unraked (bets 40%, AA 90%)
    stub.answerFor = (st) => (st.rake ? node(0.3, 0.8) : node(0.4, 0.9));
    renderAt(compareLink(A, B));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(stub.asked.map((s) => s.rake ?? null)).toEqual([0.05, null]);
    expect(screen.getByLabelText("What differs")).toHaveTextContent("What differs: B drops: rake 5%, capped at 3bb.");
    const spots = screen.getByLabelText("Spots");
    expect(within(spots).getAllByText(/^Live solve · 0\.30% pot from equilibrium/)).toHaveLength(2);
    expect(within(spots).getAllByRole("link", { name: "Open in Study" }).map((l) => l.getAttribute("href"))).toEqual([`/study?${toSearch(A)}`, `/study?${toSearch(B)}`]);
    // the same source on both sides: no warning
    expect(screen.queryByLabelText("Warning")).toBeNull();
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("check70.0% · EV 3.00bb60.0% · EV 3.00bb−10.0 points · EV +0.00bb");
    expect(rows[2]).toHaveTextContent("bet 33%30.0% · EV 4.00bb40.0% · EV 4.00bb+10.0 points · EV +0.00bb");
    expect(rows[3]).toHaveTextContent("The range400.0 combos · EV 3.30bb");
    expect(rows[3]).toHaveTextContent("EV +0.10bb");
    // EV changes within the two answers' distance from equilibrium (0.6% of 10bb) are noise
    expect(screen.getByText("EV changes under 0.06bb: noise.")).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("EV +0.00bb (noise)");
    const grid = screen.getByRole("grid", { name: "Change in check" });
    expect(within(grid).getByRole("gridcell", { name: "AA: check 20.0% → 10.0% (−10.0 points), EV +0.10bb" })).toBeInTheDocument();
    expect(within(grid).getByRole("gridcell", { name: "72o: in neither range" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Biggest differences")).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["AA: 20.0% → 10.0% (−10.0 points), EV +0.10bb"]);
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "bet 33%" } });
    expect(screen.getByRole("grid", { name: "Change in bet 33%" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("gridcell", { name: /^AA:/ }));
    expect(screen.getByText("AA: bet 33% 80.0% → 90.0% (+10.0 points), EV +0.10bb")).toBeInTheDocument();
  });

  it("warns first when the two sides come from different sources", async () => {
    stub.answerFor = () => node(0.3, 0.8);
    stub.provenanceFor = (st) => (st.stack === 100 ? { source: "library", exploitabilityPct: 0.2 } : {});
    renderAt(compareLink(B, { ...B, stack: 50 }));
    expect(await screen.findByLabelText("Warning")).toHaveTextContent(
      "Different sources (A: Precomputed solution; B: Live solve): a difference may be the source's.",
    );
    expect(screen.getByLabelText("What differs")).toHaveTextContent("stack 100bb → 50bb");
  });

  it("compares two size menus: what each offers, how much bets, what each is worth, any bet or raise per class", async () => {
    // A: the engine's 33%, bet by 30% (EV 3.30bb); B: 75% only, bet by 20% (EV 3.50bb)
    const big = (): AdvisorResponse => {
      const n = node(0.2, 0.9);
      return { ...n, range_ev_bb: 3.5, actions: n.actions!.map((x) => (x.action === "check" ? x : { ...x, action: "bet 75%" })), grid: { ...n.grid!, actions: ["check", "bet 75%"] } };
    };
    stub.answerFor = (st) => (st.sizes ? big() : node(0.3, 0.8));
    const b: StudyHand = { ...B, setup: { sizes: { flop: [75] } } };
    renderAt(compareLink(B, b));
    const menus = await screen.findByRole("region", { name: "Size menus" });
    expect(stub.asked.map((st) => st.sizes ?? null)).toEqual([null, { flop: [75] }]);
    expect(screen.getByLabelText("What differs")).toHaveTextContent("B adds: flop bets 75%");
    const items = within(menus).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["A: bet 33% · BB bets or raises 30.0% of the range · the range's EV 3.30bb", "B: bet 75% · BB bets or raises 20.0% of the range · the range's EV 3.50bb"]);
    expect(menus).toHaveTextContent(
      "B's menu is worth 0.20bb more to BB here (2.0% of the 10.0bb pot), beyond noise (0.06bb). B bets or raises 10.0 points less of the range.",
    );
    // the grid: any bet or raise, the two menus' bets as one
    const grid = screen.getByRole("grid", { name: "Change in any bet or raise" });
    expect(within(grid).getByRole("gridcell", { name: /^AA: any bet or raise 80\.0% → 90\.0% \(\+10\.0 points\)/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Action")).toHaveValue("any bet or raise");
  });

  it("asks nothing for a setup that can't be solved", async () => {
    const { unmount } = renderAt(compareLink(B, { ...B, stack: 5 }));
    expect(screen.getByRole("alert")).toHaveTextContent("These setups can't be solved: B: the table's stack must be 10–250bb.");
    unmount();
    renderAt(compareLink(B, { ...B, setup: { rake: 40 } }));
    expect(screen.getByRole("alert")).toHaveTextContent("These setups can't be solved: B: the rake must be 0–25% of the pot.");
    await waitFor(() => expect(stub.asked).toEqual([]));
    expect(screen.getAllByText("Not asked.")).toHaveLength(2);
  });
});

describe("Study's Compare this spot links", () => {
  it("offers chip EV for a tournament, rake on or off postflop, and another stack", () => {
    const t: StudyHand = { ...freshHand(6, 25), setup: { tournament: { payouts: [50, 30, 20] } } };
    expect(variantsOf(t).map(([l, b]) => [l, b.setup])).toEqual([["in chip EV", undefined]]);
    expect(variantsOf(A).map(([l, b]) => [l, b.setup])).toEqual([["without rake", undefined]]);
    expect(variantsOf(B).map(([l, b]) => [l, b.setup])).toEqual([["with 5% rake, capped at 3bb", { rake: 5, rakeCap: 3 }]]);
    // preflop no rake is taken: the charts against the preflop solve instead (and back)
    expect(variantsOf(freshHand(6, 100))).toEqual([["against the preflop solve", { ...freshHand(6, 100), pf: "solver" }]]);
    expect(variantsOf({ ...freshHand(6, 100), pf: "solver" })).toEqual([["against the charts", freshHand(6, 100)]]);

    render(
      <MemoryRouter>
        <CompareLinks hand={A} min={10} max={250} />
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation", { name: "Compare this spot" });
    const href = (name: string) => new URLSearchParams(within(nav).getByRole("link", { name }).getAttribute("href")!.split("?")[1]);
    expect(fromSearch(href("without rake").get("b")!)).toEqual(B);
    expect(fromSearch(href("compare").get("b")!)!.stack).toBe(50);
    expect(fromSearch(href("compare").get("a")!)).toEqual(A);
    fireEvent.change(screen.getByLabelText("Another stack"), { target: { value: "5" } });
    expect(within(nav).queryByRole("link", { name: "compare" })).toBeNull();
  });

  it("offers another bet menu where the player to act can bet heads-up after the flop", () => {
    const flop: AdvisorResponse = { street: "flop", actions: [{ action: "check" }, { action: "bet 33%" }, { action: "bet 75%" }, { action: "all-in" }] };
    expect(betMenuOf(B, flop)).toEqual({ street: "flop", now: [33, 75] });
    expect(betMenuOf({ ...B, setup: { sizes: { flop: [50] } } }, flop)).toEqual({ street: "flop", now: [50] });
    // facing a bet, multiway, or preflop: none
    expect(betMenuOf(B, { street: "flop", actions: [{ action: "fold" }, { action: "call" }, { action: "raise to 9" }] })).toBeNull();
    expect(betMenuOf(B, { ...flop, multiway: true })).toBeNull();
    expect(betMenuOf(B, { ...flop, street: "preflop" })).toBeNull();
    expect(withMenu(A, "flop", [33, 75], "75 33%")).toEqual({ b: null, problem: "the same menu as this spot's" });
    expect(withMenu(A, "flop", [33, 75], "10, 20, 30, 40, 50, 60").problem).toBe("at most 5 flop bet sizes (each one multiplies the game tree)");
    // (a library's river can offer more sizes than a menu may be typed with: what the field starts on is no mistake)
    expect(withMenu(A, "river", [25, 50, 75, 125], "25, 50, 75, 125")).toEqual({ b: null, problem: "the same menu as this spot's" });
    expect(withMenu(A, "flop", [33, 75], "600").problem).toBe("flop bet sizes must be 5–500% of the pot");
    expect(withMenu(A, "flop", [33, 75], "big").problem).toBe("sizes are numbers, % of the pot");
    expect(withMenu(A, "flop", [33, 75], " ").problem).toBe("type flop bet sizes, % of the pot");

    render(
      <MemoryRouter>
        <CompareLinks hand={A} min={10} max={250} bets={{ street: "flop", now: [33, 75] }} />
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation", { name: "Compare this spot" });
    const input = within(nav).getByLabelText("Another flop bet menu");
    expect(input).toHaveValue("33, 75");
    expect(within(nav).queryByRole("link", { name: "compare menus" })).toBeNull();
    expect(nav).toHaveTextContent("(the same menu as this spot's)");
    fireEvent.change(input, { target: { value: "50, 125" } });
    const q = new URLSearchParams(within(nav).getByRole("link", { name: "compare menus" }).getAttribute("href")!.split("?")[1]);
    expect(fromSearch(q.get("a")!)).toEqual(A);
    // (the rest of the setup kept)
    expect(fromSearch(q.get("b")!)).toEqual({ ...A, setup: { ...A.setup, sizes: { flop: [50, 125] } } });
  });

  it("labels a grid cell in words", () => {
    expect(diffLabel(undefined, "AA", "check")).toBe("AA: in neither range");
    const only = { cls: "T9s", wa: 0, wb: 1, fa: null, fb: 0.5, dFreq: null, eva: null, evb: 2, dEv: null };
    expect(diffLabel(only, "T9s", "check")).toBe("T9s: only in B's range (check 50%)");
    expect(diffLabel({ ...only, wa: 1, wb: 0, fa: 0.5, fb: null }, "T9s", "check")).toBe("T9s: only in A's range (check 50%)");
  });
});

describe("picking any two spots", () => {
  it("reads a Study link pasted in any form, and nothing else", () => {
    expect(studyQueryOf("https://michaellhan.github.io/lizard/study?p=6&s=100&pre=UTGr2.5#x")).toBe("p=6&s=100&pre=UTGr2.5");
    expect(studyQueryOf(" ?p=2&s=50 ")).toBe("p=2&s=50");
    expect(studyQueryOf("p=2&s=50")).toBe("p=2&s=50");
    expect(studyQueryOf("/lizard/compare?a=p%3D6&b=p%3D2")).toBeNull();
    expect(studyQueryOf("hello")).toBeNull();
  });

  it("picks A from the saved spots and B from a pasted link, swaps them, and compares", async () => {
    stub.answerFor = () => node(0.3, 0.8);
    const C: StudyHand = { ...freshHand(2, 100), preflop: [{ pos: "SB", action: "raise", to: 2.5 }] };
    await putSpot({ id: "s1", title: "My flop", line: toSearch(B), state: {}, tags: [], note: "", createdAt: 1, updatedAt: 1 });
    await putSpot({ id: "s2", title: "SB raise 2.5", line: toSearch(C), state: {}, tags: [], note: "", createdAt: 2, updatedAt: 2 });
    renderAt("/compare");
    const picker = screen.getByRole("region", { name: "Pick the spots" });
    const compare = within(picker).getByRole("button", { name: "Compare" });
    expect(compare).toBeDisabled();
    // the saved spot is listed once it's read
    expect(await within(picker).findAllByRole("option", { name: /^My flop \(HU 100bb: Ks7d2c\)/ })).toHaveLength(2);
    // (a title that is the line names only the table)
    expect(within(picker).getAllByRole("option", { name: "SB raise 2.5 (HU 100bb)" })).toHaveLength(2);
    fireEvent.change(within(picker).getByLabelText("Spot A"), { target: { value: toSearch(B) } });
    fireEvent.change(within(picker).getByLabelText("Spot B as a Study link"), { target: { value: "nonsense" } });
    fireEvent.click(within(picker).getAllByRole("button", { name: "Use" })[1]!);
    expect(within(picker).getByText(/Not a Study link/)).toBeInTheDocument();
    expect(within(picker).getByLabelText("Spot B as a Study link")).toHaveAttribute("aria-invalid", "true");
    expect(within(picker).getByLabelText("Spot B as a Study link")).toHaveAccessibleDescription(/Not a Study link/);
    expect(within(picker).getByLabelText("Spot A as a Study link")).toHaveAttribute("aria-invalid", "false");
    expect(within(picker).getByLabelText("Spot A as a Study link")).not.toHaveAttribute("aria-describedby");
    fireEvent.change(within(picker).getByLabelText("Spot B as a Study link"), { target: { value: `https://example.org/lizard/study?${toSearch(C)}` } });
    fireEvent.click(within(picker).getAllByRole("button", { name: "Use" })[1]!);
    expect(within(picker).getByLabelText("Spot B")).toHaveValue(toSearch(C));
    fireEvent.click(within(picker).getByRole("button", { name: "Swap A and B" }));
    expect(within(picker).getByLabelText("Spot A")).toHaveValue(toSearch(C));
    fireEvent.click(compare);
    expect(await screen.findByLabelText("Spots")).toHaveTextContent("heads-up 100bb · SB raise 2.5");
    await waitFor(() => expect(stub.asked).toHaveLength(2));
    expect(stub.asked.map((st) => st.board)).toEqual(["", "Ks7d2c"]);
    expect(screen.getByLabelText("What differs")).toHaveTextContent("line SB raise 2.5 → Ks7d2c");
  });

  it("pins a spot in Study as A and links any other spot to a comparison with it", () => {
    const { unmount } = render(
      <MemoryRouter>
        <CompareLinks hand={A} min={10} max={250} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pin as A" }));
    expect(screen.getByRole("button", { name: "Pinned as A · unpin" })).toHaveAttribute("aria-pressed", "true");
    // (no link to compare a spot with itself)
    expect(screen.queryByRole("link", { name: "with the pinned spot" })).toBeNull();
    unmount();
    render(
      <MemoryRouter>
        <CompareLinks hand={B} min={10} max={250} />
      </MemoryRouter>,
    );
    const q = new URLSearchParams(screen.getByRole("link", { name: "with the pinned spot" }).getAttribute("href")!.split("?")[1]);
    expect(fromSearch(q.get("a")!)).toEqual(A);
    expect(fromSearch(q.get("b")!)).toEqual(B);
  });
});
