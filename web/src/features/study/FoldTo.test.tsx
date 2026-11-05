import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import { provenanceOf } from "@/solver/provenance";
import type { SolveResult } from "@/solver/types";

import { StudyPage } from "./StudyPage";
import { parseLine } from "./studyState";

// the solver stubbed: `asked` keeps every request; `answerFor` answers it, labelled as the solver client labels it, and
// `gate` (when set) holds answers back until the test lets them go.
const stub = vi.hoisted(() => {
  const s = {
    asked: [] as AdvisorState[],
    answerFor: (() => ({})) as (st: AdvisorState) => AdvisorResponse,
    provenanceOf: null as unknown as (d: AdvisorResponse) => SolveResult["provenance"],
    gate: null as Promise<void> | null,
    getSolver: null as unknown as () => Promise<unknown>,
  };
  const client = {
    solve: async (req: { state: AdvisorState }): Promise<SolveResult> => {
      s.asked.push(req.state);
      if (s.gate) await s.gate;
      const data = s.answerFor(req.state);
      return { data, provenance: s.provenanceOf(data) };
    },
  };
  s.getSolver = async () => client;
  return s;
});
vi.mock("@/solver/useSolver", () => ({ useSolver: () => stub.getSolver }));

/** A chart's node for one seat. */
function chartNode(actor: string): AdvisorResponse {
  return {
    study: "node",
    street: "preflop",
    actor,
    pot_bb: 1.5,
    to_call_bb: 1,
    actions: [
      { action: "fold", freq: 0.8, combos: 1000 },
      { action: "raise 2.5", amount_bb: 2.5, freq: 0.2, combos: 200 },
    ],
    grid: { actions: ["fold", "raise 2.5"], cells: { AA: { w: 1, f: [0, 1] } } },
    range_combos: 1200,
  };
}

function Where() {
  return <output aria-label="URL">{useLocation().search}</output>;
}

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/study?${search}`]}>
      <StudyPage />
      <Where />
    </MemoryRouter>,
  );
}

const url = () => new URLSearchParams(screen.getByLabelText("URL").textContent ?? "");
const selector = () => screen.findByRole("group", { name: "Fold to a seat" });
const labels = (g: HTMLElement) => within(g).getAllByRole("button").map((b) => b.textContent);

beforeEach(() => {
  stub.asked.length = 0;
  stub.gate = null;
  stub.provenanceOf = (d) => provenanceOf(d, { mode: "fast", transport: "worker", solverVersion: "test", partial: false });
  // (who acts: the next seat round the table after the line's last that hasn't folded)
  stub.answerFor = (st) => {
    const line = st.preflop ?? [];
    const order = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
    const out = new Set(line.filter((a) => a.action === "fold").map((a) => a.pos));
    const after = line.length ? order.indexOf(line.at(-1)!.pos) + 1 : 0;
    const actor = [...order.slice(after), ...order.slice(0, after)].find((p) => !out.has(p));
    return chartNode(actor ?? "BB");
  };
});

describe("Study's fold-to selector", () => {
  it("offers the seats the folds reach, and jumps there with one request, for that node alone", async () => {
    renderAt("p=6&s=100");
    const g = await selector();
    expect(labels(g)).toEqual(["HJ", "CO", "BTN", "SB"]);
    await screen.findByRole("region", { name: "Actions" });
    expect(stub.asked).toHaveLength(1);

    fireEvent.click(within(g).getByRole("button", { name: "UTG, HJ, CO fold, BTN to act" }));
    const actions = await screen.findByRole("region", { name: "Actions" });
    await within(actions).findByText("BTN");
    // the one request is the seat picked, with every fold in it; nothing was asked for UTG's, HJ's or CO's nodes
    expect(stub.asked).toHaveLength(2);
    expect(stub.asked[1]?.preflop).toEqual(parseLine("UTG:f,HJ:f,CO:f"));
    expect(url().get("pre")).toBe("UTG:f,HJ:f,CO:f");
    // and the node it lands on is still labelled as the charts
    expect(within(actions).getByText(/^Preflop charts/)).toBeInTheDocument();
  });

  it("leaves the line as if each fold had been clicked: breadcrumb, Back and Forward", async () => {
    renderAt("p=6&s=100");
    fireEvent.click(within(await selector()).getByRole("button", { name: "UTG, HJ, CO fold, BTN to act" }));
    const line = screen.getByRole("navigation", { name: "Line" });
    const crumb = await within(line).findByRole("button", { name: "3 folds" });
    expect(crumb).toHaveAttribute("title", "UTG, HJ, CO fold");
    expect(crumb).toHaveAttribute("aria-current", "step");

    fireEvent.click(within(line).getByRole("button", { name: /Back/ }));
    await waitFor(() => expect(url().get("pre")).toBe("UTG:f,HJ:f"));
    fireEvent.click(within(line).getByRole("button", { name: /Back/ }));
    await waitFor(() => expect(url().get("pre")).toBe("UTG:f"));
    fireEvent.click(within(line).getByRole("button", { name: /Forward/ }));
    await waitFor(() => expect(url().get("pre")).toBe("UTG:f,HJ:f"));
    fireEvent.click(within(line).getByRole("button", { name: /Forward/ }));
    await waitFor(() => expect(url().get("pre")).toBe("UTG:f,HJ:f,CO:f"));
    expect(within(line).getByRole("button", { name: /Forward/ })).toBeDisabled();
  });

  it("gets from CO's 3-bet round to CO, past the blinds", async () => {
    renderAt("p=6&s=100&pre=UTG:f,HJ:f,CO:r2.5,BTN:r8");
    const g = await selector();
    expect(labels(g)).toEqual(["BB", "CO"]);
    fireEvent.click(within(g).getByRole("button", { name: "SB, BB fold, CO to act" }));
    await waitFor(() => expect(url().get("pre")).toBe("UTG:f,HJ:f,CO:r2.5,BTN:r8,SB:f,BB:f"));
    await within(await screen.findByRole("region", { name: "Actions" })).findByText("CO");
    expect(screen.queryByRole("group", { name: "Fold to a seat" })).toBeNull(); // (CO's fold ends the hand)
  });

  it("works from the keyboard: real buttons, and the focus stays with the selector after the jump", async () => {
    renderAt("p=6&s=100");
    const g = await selector();
    const b = within(g).getByRole("button", { name: "UTG folds, HJ to act" });
    expect(b.tagName).toBe("BUTTON");
    expect(b).toHaveAttribute("type", "button");
    b.focus();
    fireEvent.click(b);
    await waitFor(() => expect(url().get("pre")).toBe("UTG:f"));
    expect(await selector()).toHaveFocus();
    expect(labels(g)).toEqual(["CO", "BTN", "SB"]);
  });

  it("can be used before the answer is in, which the jump then stops waiting for", async () => {
    let open = () => {};
    stub.gate = new Promise((r) => (open = r));
    renderAt("p=6&s=100");
    const g = await selector();
    await waitFor(() => expect(stub.asked).toHaveLength(1));
    fireEvent.click(within(g).getByRole("button", { name: "UTG folds, HJ to act" }));
    await waitFor(() => expect(stub.asked).toHaveLength(2));
    expect(stub.asked[1]?.preflop).toEqual(parseLine("UTG:f"));
    open();
    await within(await screen.findByRole("region", { name: "Actions" })).findByText("HJ");
  });

  it("isn't there where nobody can be reached: the answer disagreeing, a closed street, the flop, or a bad setup", async () => {
    const none = async (search: string, answer: AdvisorResponse) => {
      stub.answerFor = () => answer;
      const r = renderAt(search);
      await screen.findByRole("region", { name: "Actions" });
      expect(screen.queryByRole("group", { name: "Fold to a seat" })).toBeNull();
      r.unmount();
    };
    // the engine says another seat acts: not faked from the table's reckoning
    await none("p=6&s=100", chartNode("CO"));
    // a big blind with nothing to call
    await none("p=6&s=100&pre=UTG:c,HJ:f,CO:f,BTN:f,SB:f", { ...chartNode("BB"), to_call_bb: 0, actions: [{ action: "check", freq: 1 }] });
    // the flop's first decision
    await none("p=6&s=100&pre=UTG:r2.5,HJ:f,CO:f,BTN:f,SB:f,BB:c&b=Kd7c2h", { ...chartNode("BB"), street: "flop" });
    // a link edited past the limits asks nothing, so offers nothing
    renderAt("p=6&s=100&rake=40");
    expect(await screen.findByRole("alert")).toHaveTextContent("This setup can't be solved");
    expect(screen.queryByRole("group", { name: "Fold to a seat" })).toBeNull();
  });
});
