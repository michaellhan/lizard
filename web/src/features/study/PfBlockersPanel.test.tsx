// Preflop blockers on the page (PfBlockersPanel.tsx), on a stubbed solver: the seats after our raise read in turn, each
// under its own badge; the ranking and a hand picked; the raiser's range; and the charts' reason.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SolverClient } from "@/solver/client";
import type { AdvisorResponse, AdvisorState, GridCell } from "@/solver/protocol";
import { provenanceOf } from "@/solver/provenance";
import { PfBlockersPanel } from "./PfBlockersPanel";
import { freshHand, withPf, type StudyHand } from "./studyState";

const CTX = { mode: "fast" as const, transport: "worker" as const, solverVersion: "t", partial: false };
const node = (actor: string, cells: Record<string, Pick<GridCell, "w" | "f">>, actions: string[]): AdvisorResponse => ({
  study: "node",
  street: "preflop",
  actor,
  pf_solve: { done: true, stored: true, mbb: 1 },
  actions: actions.map((a) => ({ action: a, ...(a.startsWith("raise to ") ? { amount_bb: Number(a.slice(9)) } : {}) })),
  grid: { actions, cells },
});
// BTN opens; SB and BB act after it: SB folds all but AA, BB all but KK (6 combos kept against 12 of 72o or 83o folding)
const BTN = node("BTN", { AA: { w: 1, f: [0, 1] }, KK: { w: 1, f: [0, 1] }, "72o": { w: 1, f: [1, 0] } }, ["fold", "raise to 2.5"]);
const SB = node("SB", { AA: { w: 1, f: [0, 0, 1] }, "72o": { w: 1, f: [1, 0, 0] } }, ["fold", "call", "raise to 9"]);
const BB = node("BB", { KK: { w: 1, f: [0, 0, 1] }, "83o": { w: 1, f: [1, 0, 0] } }, ["fold", "call", "raise to 9"]);
const at3 = (h: StudyHand): StudyHand => ({ ...withPf(h, "solver"), players: 3 });

function stub(answer: (st: AdvisorState) => AdvisorResponse) {
  const asked: AdvisorState[] = [];
  const client = {
    solve: async (req: { state: AdvisorState }) => {
      asked.push(req.state);
      const data = answer(req.state);
      return { data, provenance: provenanceOf(data, CTX) };
    },
  } as unknown as SolverClient;
  return { asked, getSolver: async () => client };
}
const show = (res: AdvisorResponse, hand: StudyHand, getSolver: () => Promise<SolverClient>) =>
  render(<PfBlockersPanel res={res} provenance={provenanceOf(res, CTX)} hand={hand} mode="fast" getSolver={getSolver} />);

afterEach(cleanup);

describe("preflop blockers", () => {
  it("reads each seat after the open in turn, ranks our hands by how often all fold, and shows a hand picked", async () => {
    const s = stub((st) => (st.preflop!.length === 1 ? SB : st.preflop!.length === 2 ? BB : { study: "over" }));
    show(BTN, at3(freshHand(3)), s.getSolver);
    const seats = await screen.findByRole("list", { name: "Ranges read" });
    // the open, then SB's fold: two nodes asked for, each under its own badge
    expect(s.asked.map((x) => x.preflop!.map((a) => `${a.pos} ${a.action}`))).toEqual([["BTN raise"], ["BTN raise", "SB fold"], ["BTN raise", "SB fold", "BB fold"]]);
    expect(within(seats).getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringMatching(/^SB18\.0 combosPreflop solve/), expect.stringMatching(/^BB18\.0 combosPreflop solve/)]);
    expect(screen.getByText(/After your raise to 2\.5, 2 seats act \(SB, BB\): all of them fold/)).toHaveTextContent("44.4%");
    const most = screen.getByRole("table", { name: "Hands that make them fold the most" });
    expect(within(most).getAllByRole("row").slice(1).map((r) => r.querySelector("th")!.textContent)).toEqual(["AA", "KK", "72o"]);
    fireEvent.click(within(most).getByRole("button", { name: "Pick AA" }));
    const d = screen.getByRole("group", { name: "What AA blocks" });
    // AA leaves SB 1 AA against 12 72o: 12 of 13 fold; BB untouched, two thirds: 0.923 x 0.667 = 61.5%
    expect(d).toHaveTextContent("all fold 61.5% of the time, against 44.4% in the solve (+17.1 points)");
    const sb = within(d).getByRole("row", { name: /^SB/ });
    expect(within(sb).getAllByRole("cell").map((c) => c.textContent)).toEqual(["5.0", "18.0", "66.7%", "92.3%", "AA 5.0 of 6.0"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Blocker combo" }), { target: { value: "AsAh" } });
    expect(screen.getByRole("group", { name: "What AsAh blocks" })).toBeInTheDocument();
  });

  it("reads the raiser's range where we face a raise, with no reply", async () => {
    const vs = node("BB", { AA: { w: 1, f: [0, 0, 1] } }, ["fold", "call"]);
    const hand = { ...at3(freshHand(3)), preflop: [{ pos: "BTN", action: "all-in" }, { pos: "SB", action: "fold" }] };
    const jam = node("BTN", { AA: { w: 1, f: [0, 1] }, "72o": { w: 1, f: [0.75, 0.25] } }, ["fold", "all-in"]);
    const s = stub((st) => (st.preflop!.length === 0 ? jam : vs));
    show(vs, hand, s.getSolver);
    expect(await screen.findByText("The range of BTN's all-in: 9.0 combos in the solve.")).toBeInTheDocument();
    expect(s.asked).toHaveLength(1);
    const most = screen.getByRole("table", { name: "Hands that take out the most" });
    expect(within(most).getAllByRole("row")[1]!.querySelector("th")!.textContent).toBe("AA");
  });

  it("says why the charts have none, and asks for nothing", () => {
    const s = stub(() => BTN);
    const charts = { ...BTN, pf_solve: undefined };
    render(<PfBlockersPanel res={charts} provenance={{ ...provenanceOf(BTN, CTX), source: "charts" }} hand={freshHand(3)} mode="fast" getSolver={s.getSolver} />);
    expect(screen.getByRole("region", { name: "Preflop blockers" })).toHaveTextContent(/^No preflop blockers here: this answer is the preflop charts/);
    expect(s.asked).toHaveLength(0);
  });
});
