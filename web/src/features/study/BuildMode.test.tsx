import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { actionColors } from "@/components/actions";
import { recentSessions } from "@/data/db";
import type { AdvisorResponse, RangeGridData } from "@/solver/protocol";
import { describe as describeProvenance } from "@/solver/provenance";
import type { Provenance } from "@/solver/types";

import { BuildMode, type BuildSaved } from "./BuildMode";

const LIVE: Provenance = {
  source: "live",
  approximate: false,
  mode: "fast",
  transport: "worker",
  solverVersion: "test",
  partial: false,
  receivedAt: 0,
  exploitabilityPct: 0.3,
  band: "converged",
  iterations: 300,
};

// upstream study.test.js NODE's grid (BTN on Kd7c2h, a 5.5bb pot), one combo row a class
type BuildRes = AdvisorResponse & { grid: RangeGridData };
const NODE: BuildRes = {
  study: "node",
  street: "flop",
  actor: "BTN",
  pot_bb: 5.5,
  grid: {
    actions: ["check", "bet 33%", "bet 75%"],
    cells: {
      AA: { w: 1, f: [0.2, 0.3, 0.5], ev: [10, 11, 12], evm: 11.3, eq: 0.9 },
      KQo: { w: 0.5, f: [0.6, 0.4, 0], ev: [5, 5.5, 4], evm: 5.2, eq: 0.8 },
      "72s": { w: 1, f: [1, 0, 0], ev: [-0.02, -0.5, -1], evm: -0.02, eq: 0.6 },
      QJs: { w: 0, f: [1, 0, 0] },
    },
  },
  combos: {
    AA: [["AsAh", 1, [0.2, 0.3, 0.5], [10, 11, 12], 0.9, 0, 0]],
    KQo: [["KsQh", 1, [0.6, 0.4, 0], [5, 5.5, 4], 0.8, 0, 0]],
    "72s": [["7s2s", 1, [1, 0, 0], [-0.02, -0.5, -1], 0.6, 0, 0]],
  },
};

function renderBuild(over: Partial<Parameters<typeof BuildMode>[0]> = {}) {
  const res = over.res ?? NODE;
  return render(
    <BuildMode
      res={res}
      provenance={LIVE}
      colors={actionColors(res.grid.actions)}
      lineKey="test"
      lineLabel="SB r2.5 BB c Kd7c2h"
      onStore={() => {}}
      onExit={() => {}}
      {...over}
    />,
  );
}

const cell = (cls: string) => screen.getByRole("gridcell", { name: new RegExp(`^${cls}:`) });
const brushes = () => screen.getByRole("group", { name: "Brush" });

afterEach(() => {
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
});

describe("BuildMode", () => {
  it("paints with brushes and keys, undoes and redoes each stroke, and skips locked hands", () => {
    renderBuild({ lineKey: "paint" });
    expect(screen.getByText(/Unpainted hands check\./)).toBeInTheDocument();
    expect(within(brushes()).getAllByRole("button").map((b) => b.textContent)).toEqual(["check", "bet 33%", "bet 75%", "Lock"]);
    expect(within(brushes()).getByRole("button", { name: "check" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Your range")).toHaveTextContent("Your range: check 100.0% · bet 33% 0.0% · bet 75% 0.0%");
    expect(screen.getByRole("gridcell", { name: "QJs: not in range" })).toBeDisabled();

    // key 2: bet 33%, at half of AA (the keyboard's click paints one hand)
    fireEvent.keyDown(window, { key: "2" });
    expect(within(brushes()).getByRole("button", { name: "bet 33%" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "50%" }));
    fireEvent.click(cell("AA"));
    expect(cell("AA")).toHaveAccessibleName("AA: yours check 50%, bet 33% 50%");
    // AA is 6 of the range's 16 combos: half of it is 3
    expect(screen.getByLabelText("Your range")).toHaveTextContent(/bet 33% 18\.8%/);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(cell("AA")).toHaveAccessibleName("AA: yours check 100%");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(cell("AA")).toHaveAccessibleName("AA: yours check 50%, bet 33% 50%");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(cell("AA")).toHaveAccessibleName("AA: yours check 100%");
    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
    expect(cell("AA")).toHaveAccessibleName("AA: yours check 50%, bet 33% 50%");

    // KQo locked: Fill all with bet 75% paints the rest
    fireEvent.click(within(brushes()).getByRole("button", { name: "Lock" }));
    fireEvent.click(cell("KQo"));
    expect(cell("KQo")).toHaveAccessibleName("KQo: yours check 100%; locked");
    fireEvent.keyDown(window, { key: "3" });
    fireEvent.click(screen.getByRole("button", { name: "100%" }));
    fireEvent.click(screen.getByRole("button", { name: "Fill all" }));
    expect(cell("AA")).toHaveAccessibleName("AA: yours bet 75% 100%");
    expect(cell("72s")).toHaveAccessibleName("72s: yours bet 75% 100%");
    expect(cell("KQo")).toHaveAccessibleName("KQo: yours check 100%; locked");
    expect(screen.getByLabelText("Your range")).toHaveTextContent("1 locked");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(cell("AA")).toHaveAccessibleName("AA: yours check 50%, bet 33% 50%");
    expect(cell("72s")).toHaveAccessibleName("72s: yours check 100%");

    // a drag from 72s over KQo (locked) to AA with bet 33%, in one quick move: every hand on its path, one stroke,
    // one undo step (a mouse click after the press paints nothing more)
    fireEvent.keyDown(window, { key: "2" });
    const grid = screen.getByRole("grid", { name: "BTN range, being painted" });
    const [kqo, aa] = [cell("KQo"), cell("AA")];
    const seen: number[] = [];
    document.elementFromPoint = (x: number) => (seen.push(x), x <= 12 ? kqo : aa);
    fireEvent.pointerDown(cell("72s"), { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(grid, { clientX: 30, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(grid, { pointerId: 1 });
    fireEvent.click(cell("72s"), { detail: 1 });
    expect(seen).toEqual([6, 12, 18, 24, 30]);
    expect(cell("72s")).toHaveAccessibleName("72s: yours bet 33% 100%");
    expect(cell("AA")).toHaveAccessibleName("AA: yours bet 33% 100%");
    expect(cell("KQo")).toHaveAccessibleName("KQo: yours check 100%; locked");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(cell("72s")).toHaveAccessibleName("72s: yours check 100%");
    expect(cell("AA")).toHaveAccessibleName("AA: yours check 50%, bet 33% 50%");
  });

  it("scores the paint as upstream does, with the answer's provenance, and keeps the score", async () => {
    renderBuild({ lineKey: "score" });
    fireEvent.click(screen.getByRole("button", { name: "Check my range" }));
    const score = screen.getByRole("region", { name: "Your score" });
    expect(score).toHaveTextContent("55.0% accurate · Off");
    expect(score).toHaveTextContent("EV given up: 0.563bb a combo (10.23% of the pot)");
    expect(within(score).getByText(describeProvenance(LIVE))).toBeInTheDocument();
    // one combo a class, each playing its class's mix: the class mixes score 100% combo by combo
    expect(score).toHaveTextContent("Combo by combo: 60.0% accurate, 0.500bb a combo given up.");
    expect(score).toHaveTextContent("score 100.0% and give up 0.000bb this way.");
    expect(within(screen.getByRole("table")).getAllByRole("row")[1]).toHaveTextContent("check100.0%55.0%");

    const misses = screen.getByRole("group", { name: "Biggest differences" });
    expect(within(misses).getAllByRole("button").map((b) => b.textContent)).toEqual(["AA 80% · −1.30bb", "KQo 40% · −0.20bb"]);
    fireEvent.click(within(misses).getByRole("button", { name: /^AA/ }));
    const aa = screen.getByRole("region", { name: "AA compared" });
    expect(aa).toHaveTextContent("Yours: check 100%");
    expect(aa).toHaveTextContent("Solver: check 20% (EV 10.00), bet 33% 30% (EV 11.00), bet 75% 50% (EV 12.00)");
    expect(aa).toHaveTextContent("80% of it played differently, 1.300bb a combo given up");
    // the grid: the solver's mix above yours, outlined by the difference
    expect(cell("AA").className).toContain("ring-danger");
    expect(cell("KQo").className).toContain("ring-warn");
    expect(cell("72s").className).not.toMatch(/ring-(warn|danger)/);
    expect(cell("AA")).toHaveAccessibleName(/; solver check 20%, bet 33% 30%, bet 75% 50%; 80% different$/);

    // saved, and listed under this node
    expect(await screen.findByRole("region", { name: "Past ranges here" })).toHaveTextContent(/55\.0% accurate · 0\.563bb a combo/);
    const saved = (await recentSessions("build", 50)).filter((s) => s.meta.line === "score");
    expect(saved).toHaveLength(1);
    expect(saved[0]!.meta).toMatchObject({ actor: "BTN", street: "flop", source: "live", comboAcc: expect.closeTo(0.6, 9) });
    expect(saved[0]!.meta.acc).toBeCloseTo(0.55, 9);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("button", { name: "Check my range" })).toBeInTheDocument();
    expect(cell("AA")).toHaveAccessibleName("AA: yours check 100%");
  });

  it("says preflop chart answers are graded against charts, by accuracy alone", async () => {
    const pre: BuildRes = { study: "node", street: "preflop", actor: "BTN", pot_bb: 1.5, grid: { actions: ["fold", "raise"], cells: { AA: { w: 1, f: [0, 1] }, "72o": { w: 1, f: [1, 0] } } } };
    const charts: Provenance = { ...LIVE, source: "charts", approximate: true, exploitabilityPct: undefined, band: undefined, iterations: undefined };
    renderBuild({ res: pre, provenance: charts, lineKey: "pre" });
    expect(screen.getByText(/Unpainted hands fold\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check my range" }));
    const score = screen.getByRole("region", { name: "Your score" });
    expect(score).toHaveTextContent("66.7% accurate · Fair");
    expect(score).not.toHaveTextContent("EV given up");
    expect(score).not.toHaveTextContent("Combo by combo");
    expect(score).toHaveTextContent("Graded against the preflop charts: an approximation, not a solve.");
    await act(async () => {});
  });

  it("paints or locks a group of hands at once: a shape, or a category where the answer has one", () => {
    const res: BuildRes = {
      ...NODE,
      categories: {
        made: [
          ["overpair", "Overpair"],
          ["top", "Top pair"],
          ["air", "No made hand"],
        ],
        draws: [
          ["fd", "Flush draw"],
          ["none", "No draw"],
        ],
      },
      combos: {
        AA: [["AsAh", 1, [0.2, 0.3, 0.5], [10, 11, 12], 0.9, 0, 1]],
        KQo: [["KsQh", 1, [0.6, 0.4, 0], [5, 5.5, 4], 0.8, 1, 1]],
        "72s": [["7s2s", 1, [1, 0, 0], [-0.02, -0.5, -1], 0.6, 2, 0]],
      },
    };
    renderBuild({ res, lineKey: "group" });
    const pick = screen.getByRole("combobox", { name: "Hands to paint at once" });
    expect([...pick.querySelectorAll("optgroup")].map((o) => o.label)).toEqual(["Hand shapes", "Made hands", "Draws"]);
    expect(within(pick).getByRole("option", { name: "Flush draw" })).toBeInTheDocument();
    expect(within(pick).queryByRole("option", { name: "No draw" })).toBeNull();
    // pairs: AA (QJs is out of the range)
    expect(screen.getByRole("button", { name: "Paint 1 hand" })).toHaveAttribute("title", "AA");
    fireEvent.change(pick, { target: { value: "s:broadway" } });
    expect(screen.getByRole("button", { name: "Paint 1 hand" })).toHaveAttribute("title", "KQo");

    // top pair with bet 75%: one undo step
    fireEvent.change(pick, { target: { value: "m:top" } });
    fireEvent.keyDown(window, { key: "3" });
    fireEvent.click(screen.getByRole("button", { name: "Paint 1 hand" }));
    expect(cell("KQo")).toHaveAccessibleName("KQo: yours bet 75% 100%");
    expect(cell("AA")).toHaveAccessibleName("AA: yours check 100%");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(cell("KQo")).toHaveAccessibleName("KQo: yours check 100%");

    // the lock tool locks the flush draws, then unlocks them; a locked group has nothing left to paint
    fireEvent.change(pick, { target: { value: "d:fd" } });
    fireEvent.click(within(brushes()).getByRole("button", { name: "Lock" }));
    fireEvent.click(screen.getByRole("button", { name: "Lock 1 hand" }));
    expect(cell("72s")).toHaveAccessibleName("72s: yours check 100%; locked");
    fireEvent.keyDown(window, { key: "2" });
    expect(screen.getByRole("button", { name: "Paint 0 hands" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Fill all" }));
    expect(cell("72s")).toHaveAccessibleName("72s: yours check 100%; locked");
    fireEvent.click(within(brushes()).getByRole("button", { name: "Lock" }));
    fireEvent.click(screen.getByRole("button", { name: "Unlock 1 hand" }));
    expect(cell("72s")).toHaveAccessibleName("72s: yours check 100%");

    // an answer without categories (preflop): the shapes alone
    cleanup();
    renderBuild({ lineKey: "group2" });
    expect([...screen.getByRole("combobox", { name: "Hands to paint at once" }).querySelectorAll("optgroup")].map((o) => o.label)).toEqual(["Hand shapes"]);
  });

  it("comes back to what was painted at the node", () => {
    const onStore = vi.fn<(s: BuildSaved) => void>();
    const first = renderBuild({ lineKey: "back", onStore });
    fireEvent.keyDown(window, { key: "3" });
    fireEvent.click(cell("AA"));
    first.unmount();
    renderBuild({ lineKey: "back", stored: onStore.mock.lastCall![0] });
    expect(cell("AA")).toHaveAccessibleName("AA: yours bet 75% 100%");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(cell("AA")).toHaveAccessibleName("AA: yours check 100%");
  });
});
