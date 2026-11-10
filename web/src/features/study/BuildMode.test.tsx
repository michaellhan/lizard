import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { actionColors } from "@/components/actions";
import { putSession, recentSessions } from "@/data/db";
import type { AdvisorResponse, ComboRow, RangeGridData } from "@/solver/protocol";
import { describe as describeProvenance } from "@/solver/provenance";
import type { Provenance } from "@/solver/types";

import { useSettings } from "@/state/settings";
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
  useSettings.setState({ studyKeys: true });
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
});

describe("BuildMode", () => {
  it("is one tab stop that walks through hands out of the range, and a key on a hand paints it and says so", () => {
    renderBuild({ lineKey: "keys" });
    const cells = screen.getAllByRole("gridcell");
    expect(cells.filter((c) => c.tabIndex === 0)).toEqual([cell("AA")]);
    cell("AA").focus();
    fireEvent.keyDown(cell("AA"), { key: "Home", ctrlKey: true });
    // (a hand out of the range takes focus as any other, and a key on it paints nothing)
    const off = screen.getByRole("gridcell", { name: "QJs: not in range" });
    off.focus();
    expect(off).toHaveFocus();
    fireEvent.click(off);
    expect(screen.getByLabelText("Your range")).toHaveTextContent("check 100.0%");
    fireEvent.keyDown(off, { key: "ArrowRight" });
    expect(off).not.toHaveFocus();

    cell("AA").focus();
    fireEvent.keyDown(cell("AA"), { key: "2" }); // (the brushes' keys work from the grid)
    expect(within(brushes()).getByRole("button", { name: "bet 33%" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(cell("AA"));
    expect(screen.getByText("AA: yours bet 33% 100%", { selector: "[role=status]" })).toBeInTheDocument();
  });

  it("leaves the brush keys to other controls, and off in Settings", () => {
    renderBuild({ lineKey: "off" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Reset" }), { key: "2" });
    expect(within(brushes()).getByRole("button", { name: "check" })).toHaveAttribute("aria-pressed", "true");
    act(() => useSettings.setState({ studyKeys: false }));
    fireEvent.keyDown(document.body, { key: "2" });
    expect(within(brushes()).getByRole("button", { name: "check" })).toHaveAttribute("aria-pressed", "true");
  });

  it("paints with brushes and keys, undoes and redoes each stroke, and skips locked hands", () => {
    renderBuild({ lineKey: "paint" });
    expect(screen.getByText(/Unpainted hands check\./)).toBeInTheDocument();
    expect(within(brushes()).getAllByRole("button").map((b) => b.textContent)).toEqual(["check", "bet 33%", "bet 75%", "Lock"]);
    expect(within(brushes()).getByRole("button", { name: "check" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Your range")).toHaveTextContent("Your range: check 100.0% · bet 33% 0.0% · bet 75% 0.0%");
    expect(screen.getByRole("gridcell", { name: "QJs: not in range" })).toHaveAttribute("aria-disabled", "true");

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

  // AKs on As7d2c: AsKs blocked, three live combos at their reach, with their own mixes and EVs
  const COMBOS: BuildRes = {
    study: "node",
    street: "flop",
    actor: "BTN",
    pot_bb: 10,
    board: "As7d2c",
    grid: { actions: ["check", "bet"], cells: { AKs: { w: 0.5, f: [0.375, 0.625], ev: [0.5, 1.25], evm: 1, eq: 0.65 }, QQ: { w: 1 / 6, f: [1, 0], ev: [1, 1], evm: 1, eq: 0.5 } } },
    combos: {
      AKs: [
        ["AhKh", 1, [0, 1], [0, 2], 0.7, 0, 0],
        ["AdKd", 0.5, [1, 0], [1, 0], 0.6, 0, 0],
        ["AcKc", 0.5, [0.5, 0.5], [1, 1], 0.6, 0, 0],
      ],
      QQ: [["QsQh", 1, [1, 0], [1, 1], 0.5, 0, 0]],
    },
  };
  const combos = () => screen.getByRole("region", { name: "AKs combos" });
  const share = (name: string, value: string) => {
    const box = screen.getByRole("spinbutton", { name });
    fireEvent.change(box, { target: { value } });
    fireEvent.blur(box);
  };

  it("opens a hand to paint each legal combo, a blocked one out of it, one undo step a change", () => {
    renderBuild({ res: COMBOS, lineKey: "combos" });
    fireEvent.click(screen.getByRole("button", { name: "Open combos" }));
    expect(screen.getByRole("button", { name: "Open combos" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(cell("AKs")); // (a keyboard's click; nothing painted)
    expect(cell("AKs")).toHaveAccessibleName("AKs: yours check 100%");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(combos()).toHaveTextContent("3 of 3 legal combos in the range · 1 blocked by the board");
    expect(within(combos()).getByText(describeProvenance(LIVE))).toBeInTheDocument();
    expect(within(combos()).getByText(/^AsKs$/).parentElement).toHaveTextContent("AsKs blocked by the board: not painted, not counted");
    expect(screen.queryByRole("spinbutton", { name: "AsKs bet %" })).toBeNull();
    expect(within(combos()).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["AhKh", "AdKd", "AcKc"]);

    // half the class by reach, of its live combos: 50%, not 25% of 4
    share("AhKh bet %", "100");
    expect(cell("AKs")).toHaveAccessibleName("AKs: yours check 50%, bet 50%; 1 combo painted apart");
    expect(screen.getByLabelText("AKs as painted")).toHaveTextContent("Over its 3 live combos, by reach: check 50.0% · bet 50.0%");
    expect(screen.getByRole("spinbutton", { name: "AhKh check %" })).toHaveValue(0);
    // a fractional mix, the rest of it following
    share("AdKd check %", "75");
    expect(screen.getByRole("spinbutton", { name: "AdKd bet %" })).toHaveValue(25);

    // each change one step: back to AhKh alone, then to nothing
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("spinbutton", { name: "AdKd bet %" })).toHaveValue(0);
    expect(screen.getByRole("spinbutton", { name: "AhKh bet %" })).toHaveValue(100);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(cell("AKs")).toHaveAccessibleName("AKs: yours check 100%");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByRole("spinbutton", { name: "AhKh bet %" })).toHaveValue(100);

    // leaving a box unchanged, or with nothing sensible in it, is no step; Enter is one
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    share("AhKh bet %", "0");
    share("AhKh bet %", "");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    const box = screen.getByRole("spinbutton", { name: "AhKh bet %" });
    fireEvent.change(box, { target: { value: "250" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box).toHaveValue(100);
    fireEvent.blur(box);
    fireEvent.click(screen.getByRole("button", { name: "AhKh back to the class" }));
    expect(cell("AKs")).toHaveAccessibleName("AKs: yours check 100%");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(cell("AKs")).toHaveAccessibleName("AKs: yours check 50%, bet 50%; 1 combo painted apart");

    // the undo keys from inside a box: with nothing typed they take back the step, with a draft they're the box's
    fireEvent.keyDown(box, { key: "z", ctrlKey: true });
    expect(cell("AKs")).toHaveAccessibleName("AKs: yours check 100%");
    fireEvent.keyDown(box, { key: "z", metaKey: true, shiftKey: true });
    expect(cell("AKs")).toHaveAccessibleName("AKs: yours check 50%, bet 50%; 1 combo painted apart");
    fireEvent.keyDown(box, { key: "y", ctrlKey: true }); // (the step after that one: back to the class)
    expect(cell("AKs")).toHaveAccessibleName("AKs: yours check 100%");
    fireEvent.keyDown(box, { key: "z", ctrlKey: true });
    expect(box).toHaveValue(100);
    fireEvent.change(box, { target: { value: "40" } });
    fireEvent.keyDown(box, { key: "z", ctrlKey: true });
    expect(cell("AKs")).toHaveAccessibleName("AKs: yours check 50%, bet 50%; 1 combo painted apart");
    expect(box).toHaveValue(40);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box).toHaveValue(100);

    fireEvent.click(screen.getByRole("button", { name: "Close combos" }));
    expect(screen.queryByRole("region", { name: "AKs combos" })).toBeNull();
  });

  it("opens one hand on a drag, keeps a typed share ahead of the press, and a brush still paints the class", () => {
    renderBuild({ res: COMBOS, lineKey: "open-drag" });
    fireEvent.click(screen.getByRole("button", { name: "Open combos" }));
    const grid = screen.getByRole("grid", { name: "BTN range, being painted" });
    const qq = cell("QQ");
    document.elementFromPoint = () => qq;
    fireEvent.pointerDown(cell("AKs"), { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(grid, { clientX: 6, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(grid, { pointerId: 1 });
    expect(combos()).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "QQ combos" })).toBeNull();

    // typed and not left, then a press on another hand: it goes in, as one step
    const box = screen.getByRole("spinbutton", { name: "AhKh bet %" });
    box.focus();
    fireEvent.change(box, { target: { value: "100" } });
    fireEvent.pointerDown(qq, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(grid, { pointerId: 1 });
    expect(screen.getByRole("region", { name: "QQ combos" })).toHaveTextContent("1 of 6 legal combos in the range");
    expect(cell("AKs")).toHaveAccessibleName("AKs: yours check 50%, bet 50%; 1 combo painted apart");

    // the brush on a hand with a combo of its own: the combo goes with it
    fireEvent.keyDown(window, { key: "2" });
    fireEvent.click(cell("AKs"));
    expect(cell("AKs")).toHaveAccessibleName("AKs: yours bet 100%");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(cell("AKs")).toHaveAccessibleName("AKs: yours check 50%, bet 50%; 1 combo painted apart");
  });

  it("holds a locked hand's combos", () => {
    renderBuild({ res: COMBOS, lineKey: "combo-lock" });
    fireEvent.click(within(brushes()).getByRole("button", { name: "Lock" }));
    fireEvent.click(cell("AKs"));
    fireEvent.click(screen.getByRole("button", { name: "Open combos" }));
    fireEvent.click(cell("AKs"));
    expect(combos()).toHaveTextContent("Locked: unlock the hand to paint its combos.");
    expect(screen.getByRole("spinbutton", { name: "AhKh bet %" })).toBeDisabled();
  });

  it("locks a combo painted apart, by name and in words, and anything that paints its class leaves it", () => {
    renderBuild({ res: COMBOS, lineKey: "combo-locks" });
    fireEvent.click(screen.getByRole("button", { name: "Open combos" }));
    fireEvent.click(cell("AKs"));
    // only a combo painted apart has anything of its own to hold
    expect(screen.queryByRole("button", { name: "Lock AhKh" })).toBeNull();
    share("AhKh bet %", "75");
    share("AdKd bet %", "25");
    const lock = screen.getByRole("button", { name: "Lock AhKh" });
    expect(lock).toHaveAttribute("aria-pressed", "false");
    lock.focus();
    fireEvent.click(lock);

    // the lock says so in words, in the row, on the hand and in the range's note, and focus stays on it
    expect(lock).toHaveAttribute("aria-pressed", "true");
    expect(lock).toHaveFocus();
    const row = within(combos()).getByRole("group", { name: "AhKh, locked" });
    expect(row).toHaveTextContent("Locked");
    expect(within(combos()).getByRole("group", { name: "AdKd" })).not.toHaveTextContent("Locked");
    expect(cell("AKs")).toHaveAccessibleName("AKs: yours check 56%, bet 44%; 2 combos painted apart, 1 locked");
    expect(screen.getByLabelText("Your range")).toHaveTextContent("1 combo locked");
    expect(screen.getByRole("spinbutton", { name: "AhKh bet %" })).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: "AdKd bet %" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "AhKh back to the class" })).toBeDisabled();

    const ahkh = () => (screen.getByRole("spinbutton", { name: "AhKh bet %" }) as HTMLInputElement).value;
    const adkd = () => (screen.getByRole("spinbutton", { name: "AdKd bet %" }) as HTMLInputElement).value;
    const steps = () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      expect(adkd()).toBe("25");
      fireEvent.click(screen.getByRole("button", { name: "Redo" }));
      expect(adkd()).toBe("100");
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    };
    // Fill all
    fireEvent.click(within(brushes()).getByRole("button", { name: "bet" }));
    fireEvent.click(screen.getByRole("button", { name: "Fill all" }));
    expect(ahkh()).toBe("75");
    steps();
    // a press on its hand
    fireEvent.click(cell("AKs"));
    expect(ahkh()).toBe("75");
    steps();
    // a shape: suited hands
    fireEvent.change(screen.getByLabelText("Hands to paint at once"), { target: { value: "s:suited" } });
    fireEvent.click(screen.getByRole("button", { name: "Paint 1 hand" }));
    expect(ahkh()).toBe("75");
    steps();
    // range text: the class goes on around it, and the combo by name is held and counted
    fireEvent.change(screen.getByLabelText(/^Hands that play bet/), { target: { value: "AhKh" } });
    fireEvent.click(screen.getByRole("button", { name: "Paint these" }));
    expect(ahkh()).toBe("75");
    expect(screen.getByText("Painted 0 hands bet; 1 locked, left as it was.")).toBeInTheDocument();
  });

  it("undoes and redoes a combo's lock as one step, from the button and the keys", () => {
    renderBuild({ res: COMBOS, lineKey: "combo-lock-undo" });
    fireEvent.click(screen.getByRole("button", { name: "Open combos" }));
    fireEvent.click(cell("AKs"));
    share("AhKh bet %", "75");
    fireEvent.click(screen.getByRole("button", { name: "Lock AhKh" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: "Lock AhKh" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("spinbutton", { name: "AhKh bet %" })).toHaveValue(75);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("button", { name: "Lock AhKh" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("button", { name: "Lock AhKh" })).toBeNull();
    // Reset takes the locks with it, in one step
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.queryByRole("button", { name: "Lock AhKh" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: "Lock AhKh" })).toHaveAttribute("aria-pressed", "true");
  });

  it("makes a class's lock one undo step: a press, a group, or a drag over hands", () => {
    renderBuild({ res: COMBOS, lineKey: "class-lock-undo" });
    fireEvent.click(within(brushes()).getByRole("button", { name: "Lock" }));
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    fireEvent.click(cell("AKs"));
    expect(cell("AKs")).toHaveAccessibleName("AKs: yours check 100%; locked");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(cell("AKs")).toHaveAccessibleName("AKs: yours check 100%");
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(cell("AKs")).toHaveAccessibleName("AKs: yours check 100%; locked");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    const grid = screen.getByRole("grid", { name: "BTN range, being painted" });
    const qq = cell("QQ");
    document.elementFromPoint = () => qq;
    fireEvent.pointerDown(cell("AKs"), { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(grid, { clientX: 5, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(grid, { pointerId: 1 });
    expect(screen.getByLabelText("Your range")).toHaveTextContent("2 locked");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Your range")).not.toHaveTextContent("locked");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Hands to paint at once"), { target: { value: "s:pairs" } });
    fireEvent.click(screen.getByRole("button", { name: "Lock 1 hand" }));
    expect(cell("QQ")).toHaveAccessibleName("QQ: yours check 100%; locked");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(cell("QQ")).toHaveAccessibleName("QQ: yours check 100%");
  });

  it("holds the whole hand under a class lock, and a combo's own lock comes back through it", () => {
    renderBuild({ res: COMBOS, lineKey: "both-locks" });
    fireEvent.click(screen.getByRole("button", { name: "Open combos" }));
    fireEvent.click(cell("AKs"));
    share("AhKh bet %", "75");
    share("AdKd bet %", "25");
    fireEvent.click(screen.getByRole("button", { name: "Lock AhKh" }));
    fireEvent.click(within(brushes()).getByRole("button", { name: "Lock" }));
    fireEvent.click(cell("AKs"));
    expect(cell("AKs")).toHaveAccessibleName(/; 2 combos painted apart, 1 locked; locked$/);
    fireEvent.click(screen.getByRole("button", { name: "Open combos" }));
    fireEvent.click(cell("AKs"));
    expect(combos()).toHaveTextContent("Locked: unlock the hand to paint its combos.");
    expect(screen.getByRole("spinbutton", { name: "AdKd bet %" })).toBeDisabled();
    expect(screen.getByRole("group", { name: "AhKh, locked" })).toBeInTheDocument();

    // the brush reaches none of it
    fireEvent.click(within(brushes()).getByRole("button", { name: "bet" }));
    fireEvent.click(screen.getByRole("button", { name: "Fill all" }));
    expect(screen.getByRole("spinbutton", { name: "AdKd bet %" })).toHaveValue(25);

    // unlocked: the class's paint reaches AdKd and not AhKh, whose own lock is as it was
    fireEvent.click(within(brushes()).getByRole("button", { name: "Lock" }));
    fireEvent.click(cell("AKs"));
    fireEvent.click(screen.getByRole("button", { name: "Open combos" }));
    fireEvent.click(cell("AKs"));
    expect(screen.getByRole("group", { name: "AhKh, locked" })).toBeInTheDocument();
    fireEvent.click(within(brushes()).getByRole("button", { name: "bet" }));
    fireEvent.click(screen.getByRole("button", { name: "Fill all" }));
    expect(screen.getByRole("spinbutton", { name: "AhKh bet %" })).toHaveValue(75);
    expect(screen.getByRole("spinbutton", { name: "AdKd bet %" })).toHaveValue(100);
  });

  it("scores and saves the same with a lock as without, and shows it on the scored hand", async () => {
    const attempt = async (lineKey: string, lock: boolean) => {
      const view = renderBuild({ res: COMBOS, lineKey });
      fireEvent.click(screen.getByRole("button", { name: "Open combos" }));
      fireEvent.click(cell("AKs"));
      share("AhKh bet %", "75");
      if (lock) {
        fireEvent.click(screen.getByRole("button", { name: "Lock AhKh" }));
        fireEvent.click(within(brushes()).getByRole("button", { name: "Lock" }));
        fireEvent.click(cell("AKs"));
      }
      fireEvent.click(screen.getByRole("button", { name: "Check my range" }));
      const shown = screen.getByRole("region", { name: "Your score" }).textContent;
      await screen.findByRole("region", { name: "Past ranges here" });
      const label = cell("AKs").getAttribute("aria-label");
      view.unmount();
      const { meta } = (await recentSessions("build", 50)).find((s) => s.meta.line === lineKey)!;
      return { shown, label, meta: { ...meta, line: "" } };
    };
    const free = await attempt("score-free", false);
    const held = await attempt("score-held", true);
    expect(held.shown).toBe(free.shown);
    expect(held.meta).toEqual(free.meta);
    expect(held.shown).toContain("83.3% accurate");
    expect(held.label).toMatch(/1 combo painted apart, 1 locked; solver /);
  });

  it("loads a builder saved before locks were part of the paint, and an attempt saved before them", async () => {
    const saved = { h: { past: [{ classes: { AKs: [1, 0], QQ: [1, 0] }, combos: {} }], now: { classes: { AKs: [0.5, 0.5], QQ: [1, 0] }, combos: { AKs: { AhKh: [0, 1] } } }, future: [] }, locked: ["QQ"], scored: false } satisfies BuildSaved;
    await putSession({ id: "build-old", kind: "build", startedAt: 1, endedAt: 1, decisions: 1, evLossBb: 0, meta: { line: "old-state", label: "L", actor: "BTN", street: "flop", acc: 0.75, evLossBb: 0.1, evLossPct: 1, comboAcc: null, source: "live", approximate: false } });
    const onStore = vi.fn<(s: BuildSaved) => void>();
    renderBuild({ res: COMBOS, lineKey: "old-state", stored: saved, onStore });
    expect(cell("QQ")).toHaveAccessibleName("QQ: yours check 100%; locked");
    expect(cell("AKs")).toHaveAccessibleName("AKs: yours check 25%, bet 75%; 1 combo painted apart");
    expect(await screen.findByRole("region", { name: "Past ranges here" })).toHaveTextContent("75.0% accurate · 0.100bb a combo");
    // as it was, the lock outlasts an undo of the paint it stood beside
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(cell("QQ")).toHaveAccessibleName("QQ: yours check 100%; locked");
    expect(cell("AKs")).toHaveAccessibleName("AKs: yours check 100%");
  });

  it("paints a category by combo: only its own combos, each apart from its class, as one undo step", () => {
    // AhKh a flush draw, the other two not: by class AKs goes whole (half its reach is in it), by combo only AhKh
    const fd = (row: ComboRow, draw: number): ComboRow => [row[0], row[1], row[2], row[3], row[4], 0, draw];
    const res: BuildRes = {
      ...COMBOS,
      categories: { made: [["top", "Top pair"]], draws: [["fd", "Flush draw"], ["none", "No draw"]] },
      combos: { AKs: COMBOS.combos!.AKs!.map((r, i) => fd(r, i === 0 ? 0 : 1)), QQ: [fd(COMBOS.combos!.QQ![0]!, 1)] },
    };
    renderBuild({ res, lineKey: "cat-combo" });
    fireEvent.change(screen.getByLabelText("Hands to paint at once"), { target: { value: "d:fd" } });
    expect(screen.getByRole("button", { name: "Paint 1 hand" })).toHaveAttribute("title", "AKs");
    fireEvent.click(screen.getByRole("checkbox", { name: "By combo" }));
    fireEvent.keyDown(window, { key: "2" });
    const paint = screen.getByRole("button", { name: "Paint 1 combo" });
    expect(paint).toHaveAttribute("title", "AhKh");
    fireEvent.click(paint);
    expect(cell("AKs")).toHaveAccessibleName("AKs: yours check 50%, bet 50%; 1 combo painted apart");
    expect(cell("QQ")).toHaveAccessibleName("QQ: yours check 100%");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(cell("AKs")).toHaveAccessibleName("AKs: yours check 100%");
    // a lock still goes by hand; a shape has no by-combo box
    fireEvent.click(within(brushes()).getByRole("button", { name: "Lock" }));
    expect(screen.getByRole("button", { name: "Lock 1 hand" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Hands to paint at once"), { target: { value: "s:pairs" } });
    expect(screen.queryByRole("checkbox", { name: "By combo" })).toBeNull();
  });

  it("grades combo by combo once a combo is painted, by reach over the live combos, and keeps it saved so", async () => {
    renderBuild({ res: COMBOS, lineKey: "combo-score" });
    fireEvent.click(screen.getByRole("button", { name: "Open combos" }));
    fireEvent.click(cell("AKs"));
    // AhKh 75% bet: off .25 of a reach of 1; AdKd right; AcKc .5 of .5; QQ right: of a reach of 3
    share("AhKh bet %", "75");
    fireEvent.click(screen.getByRole("button", { name: "Check my range" }));
    const score = screen.getByRole("region", { name: "Your score" });
    expect(score).toHaveTextContent("83.3% accurate · Good");
    // EV: AhKh .25 x 2 = .5, AcKc 0, over 3
    expect(score).toHaveTextContent("EV given up: 0.167bb a combo (1.67% of the pot)");
    expect(score).toHaveTextContent("Graded combo by combo over 3.0 live combos");
    expect(score).not.toHaveTextContent("Combo by combo:");
    // the table too: 1 x .75 + .5 x 0 + .5 x 0 of 3 bets, against the combos' own 1 + 0 + .25
    expect(within(screen.getByRole("table")).getAllByRole("row")[2]).toHaveTextContent("bet25.0%41.7%");

    fireEvent.click(cell("AKs"));
    const aks = screen.getByRole("region", { name: "AKs compared" });
    expect(aks).toHaveTextContent("1 blocked by the board, not counted.");
    const rows = within(within(aks).getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual(["AhKhcheck 25%, bet 75%bet 100%", "AdKdcheck 100%check 100%", "AcKccheck 100%check 50%, bet 50%"]);
    expect(cell("AKs")).toHaveAccessibleName(/; 1 combo painted apart; solver check 38%, bet 63%; 25% different$/);

    expect(await screen.findByRole("region", { name: "Past ranges here" })).toHaveTextContent(/83\.3% accurate · 0\.167bb a combo · by combo/);
    const saved = (await recentSessions("build", 50)).filter((s) => s.meta.line === "combo-score");
    expect(saved[0]!.meta).toMatchObject({ graded: "combo", acc: expect.closeTo(5 / 6, 9), comboAcc: expect.closeTo(5 / 6, 9) });
  });

  it("says combos can't be painted or graded on an answer without them, and text goes by class share", async () => {
    const pre: BuildRes = { study: "node", street: "preflop", actor: "BTN", pot_bb: 1.5, grid: { actions: ["fold", "raise"], cells: { AKs: { w: 1, f: [0, 1] }, "72o": { w: 1, f: [1, 0] } } } };
    const charts: Provenance = { ...LIVE, source: "charts", approximate: true, exploitabilityPct: undefined, band: undefined, iterations: undefined };
    renderBuild({ res: pre, provenance: charts, lineKey: "pre-combos" });
    expect(screen.queryByRole("button", { name: "Open combos" })).toBeNull();
    expect(screen.getByText("This answer gives hand classes, not combos, so single combos can't be painted or graded here.")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "2" });
    fireEvent.change(screen.getByLabelText(/^Hands that play raise/), { target: { value: "AhKh" } });
    fireEvent.click(screen.getByRole("button", { name: "Paint these" }));
    expect(cell("AKs")).toHaveAccessibleName("AKs: yours fold 75%, raise 25%");
    expect(screen.getByText("Painted 1 hand raise; single combos as their share of the class.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check my range" }));
    expect(screen.getByRole("region", { name: "Your score" })).toHaveTextContent("Combos can't be graded: this answer gives hand classes only, so this score is by class.");
    await act(async () => {});
  });

  it("paints a combo typed as text alone, and gives single combos back at their weights", () => {
    renderBuild({ res: COMBOS, lineKey: "combo-text" });
    fireEvent.keyDown(window, { key: "2" });
    fireEvent.change(screen.getByLabelText(/^Hands that play bet/), { target: { value: "AKs:0.25, KhAh:0.5, AsKs, QdQc" } });
    fireEvent.click(screen.getByRole("button", { name: "Paint these" }));
    expect(screen.getByText("Painted 1 hand and 1 combo bet; 1 not in this range; 1 blocked by the board.")).toBeInTheDocument();
    // by reach: AhKh's 1 at .5, the rest's 1 at .25
    expect(cell("AKs")).toHaveAccessibleName("AKs: yours check 63%, bet 38%; 1 combo painted apart");
    // one undo step
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(cell("AKs")).toHaveAccessibleName("AKs: yours check 100%");
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));

    fireEvent.click(screen.getByRole("button", { name: "Your bet hands" }));
    expect(screen.getByLabelText(/^Hands that play bet/)).toHaveValue("AKs:0.25,AhKh:0.5");
  });

  it("paints hands typed as range text with the brush, each at its weight, and gives an action's hands as text", () => {
    renderBuild({ lineKey: "text" });
    fireEvent.keyDown(window, { key: "2" });
    const box = screen.getByLabelText(/^Hands that play bet 33%/);
    fireEvent.change(box, { target: { value: "aa KQo:0.5, QJs 72o xyz" } });
    fireEvent.click(screen.getByRole("button", { name: "Paint these" }));
    expect(cell("AA")).toHaveAccessibleName("AA: yours bet 33% 100%");
    expect(cell("KQo")).toHaveAccessibleName("KQo: yours check 50%, bet 33% 50%");
    expect(screen.getByText("Painted 2 hands bet 33%; 2 not in this range; not understood: xyz.")).toBeInTheDocument();
    // one undo step
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(cell("AA")).toHaveAccessibleName("AA: yours check 100%");
    expect(cell("KQo")).toHaveAccessibleName("KQo: yours check 100%");
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));

    // locked hands stay; a single combo goes in on its own
    fireEvent.click(within(brushes()).getByRole("button", { name: "Lock" }));
    expect(screen.getByRole("button", { name: "Paint these" })).toBeDisabled();
    fireEvent.click(cell("AA"));
    fireEvent.keyDown(window, { key: "3" });
    fireEvent.change(screen.getByLabelText(/^Hands that play bet 75%/), { target: { value: "AA, 7s2s" } });
    fireEvent.click(screen.getByRole("button", { name: "Paint these" }));
    expect(cell("AA")).toHaveAccessibleName("AA: yours bet 33% 100%; locked");
    // (72s's only live combo at this node, so the class's mix is that combo's)
    expect(cell("72s")).toHaveAccessibleName("72s: yours bet 75% 100%; 1 combo painted apart");
    expect(screen.getByText("Painted 1 combo bet 75%; 1 locked, left as it was.")).toBeInTheDocument();

    // the hands that play bet 33%, as text
    fireEvent.keyDown(window, { key: "2" });
    fireEvent.click(screen.getByRole("button", { name: "Your bet 33% hands" }));
    expect(screen.getByLabelText(/^Hands that play bet 33%/)).toHaveValue("AA,KQo:0.5");
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
