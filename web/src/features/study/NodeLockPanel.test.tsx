// The true node lock's panel: what it asks, what it says before a solve, and the result beside the unlocked answer.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NodeLockError, type SolverClient } from "@/solver/client";
import { provenanceOf } from "@/solver/provenance";
import type { AdvisorResponse, NodeLockProgress, NodeLockRequest } from "@/solver/protocol";
import { ANSWER, BLOCK } from "@/solver/nodeLock.fixture";
import { SolverError, type SolveResult } from "@/solver/types";
import { useKeptLocks } from "./keptLocks";
import { NodeLockPanel } from "./NodeLockPanel";
import { actionRows, combosNamed, costWords, exploitWords, handsOf, memoryNote, mixOf, nodeLockRefusal, reachBack, scopeNote, startingMix, valueRows } from "./nodeLock";
import { freshHand, type StudyHand } from "./studyState";

const ctx = { mode: "fast" as const, transport: "worker" as const, solverVersion: "t", partial: false, now: 1 };

const NODE: AdvisorResponse = {
  study: "node",
  street: "river",
  actor: "BTN",
  opponent: "BB",
  actions: [
    { action: "check", freq: 0.283 },
    { action: "bet 33%", freq: 0.571 },
    { action: "bet 75%", freq: 0.146 },
  ],
  grid: { actions: ["check", "bet 33%", "bet 75%"], cells: { AQo: { w: 1, f: [1, 0, 0] }, KK: { w: 0.5, f: [0, 0, 1] }, "72o": { w: 0, f: [1, 0, 0] } } },
  combos: {
    AQo: [
      ["AhQd", 1, [1, 0, 0], null, null, 0, 0],
      ["AsQc", 0.5, [1, 0, 0], null, null, 0, 0],
      ["AdQh", 0, [1, 0, 0], null, null, 0, 0],
    ],
    KK: [["KhKd", 0.5, [0, 0, 1], null, null, 0, 0]],
  },
};
const HAND: StudyHand = { ...freshHand(), board: "Kd7c2h5s9d" };

type Asked = { lock: NodeLockRequest; mode?: string; signal?: AbortSignal; onProgress?: (p: NodeLockProgress) => void };

function clientAnswering(answer: (a: Asked) => Promise<SolveResult<never>> | SolveResult<never>) {
  const asked: Asked[] = [];
  const client = {
    nodeLock: vi.fn(async (_state: unknown, lock: NodeLockRequest, opts: Omit<Asked, "lock">) => {
      const a = { lock, ...opts };
      asked.push(a);
      return answer(a);
    }),
  } as unknown as SolverClient;
  return { client, asked };
}

const done = () => ({ data: ANSWER, provenance: provenanceOf(ANSWER, ctx) }) as unknown as SolveResult<never>;

function open(res = NODE, cls: string | null = "AQo", client: SolverClient = clientAnswering(done).client, hand = HAND) {
  render(<NodeLockPanel hand={hand} res={res} cls={cls} mode="fast" getSolver={async () => client} />);
  fireEvent.click(screen.getByText("Hold this node at a mix (true node lock)"));
  return screen.queryByRole("form", { name: "The lock" });
}

describe("nodeLock.ts", () => {
  it("says why a node can't be locked, before any solve", () => {
    expect(nodeLockRefusal(NODE, false)).toBeNull();
    expect(nodeLockRefusal({ ...NODE, street: "preflop" }, false)).toMatch(/postflop/);
    expect(nodeLockRefusal({ ...NODE, multiway: true, players: 3 }, false)).toBe("Node locking is heads-up: this pot has 3 players in it.");
    expect(nodeLockRefusal({ ...NODE, multiway: true }, false)).toMatch(/more than two players/);
    expect(nodeLockRefusal(NODE, true)).toMatch(/cash games/);
    expect(nodeLockRefusal({ ...NODE, fallback: "rules" }, false)).toMatch(/betting rules/);
    expect(nodeLockRefusal({ ...NODE, actions: [] }, false)).toMatch(/Nobody acts/);
  });

  it("starts from the range's frequencies, adding up to 100", () => {
    const m = startingMix(NODE);
    expect(m).toEqual({ check: "28.3", "bet 33%": "57.1", "bet 75%": "14.6" });
    const rounded = startingMix({ ...NODE, actions: [{ action: "a", freq: 1 / 3 }, { action: "b", freq: 1 / 3 }, { action: "c", freq: 1 / 3 }] });
    expect(Object.values(rounded).reduce((t, x) => t + Number(x), 0)).toBeCloseTo(100, 6);
  });

  it("takes a mix in percent, blanks as 0, and says what's wrong with one", () => {
    const acts = ["check", "bet 33%", "bet 75%"];
    expect(mixOf({ check: "50", "bet 33%": "50" }, acts)).toEqual({ mix: { check: 0.5, "bet 33%": 0.5, "bet 75%": 0 }, problems: [] });
    expect(mixOf({ check: "50" }, acts).problems).toEqual(["The mix adds up to 50%: it has to be 100%"]);
    expect(mixOf({ check: "x", "bet 33%": "100" }, acts).problems).toEqual(["check must be 0 to 100"]);
    expect(mixOf({ check: "101" }, acts).mix).toBeNull();
    const third = mixOf({ check: "33.3", "bet 33%": "33.3", "bet 75%": "33.4" }, acts).mix!;
    expect(Object.values(third).reduce((t, x) => t + x, 0)).toBeCloseTo(1, 12);
  });

  it("turns a scope into the engine's hands, and stops one that changes nothing", () => {
    expect(handsOf({ kind: "range" }, NODE)).toEqual({ hands: "all", problems: [] });
    expect(handsOf({ kind: "classes", text: "AQo, KK" }, NODE)).toEqual({ hands: { classes: ["AQo", "KK"] }, problems: [] });
    expect(handsOf({ kind: "classes", text: "AQ" }, NODE)).toEqual({ hands: { classes: ["AQ"] }, problems: [] });
    expect(handsOf({ kind: "classes", text: "ZZ" }, NODE).problems).toEqual(["ZZ isn't a hand class"]);
    expect(handsOf({ kind: "classes", text: "72o" }, NODE).problems).toEqual(["72o isn't in BTN's range here"]);
    expect(handsOf({ kind: "classes", text: " " }, NODE).hands).toBeNull();
    expect(handsOf({ kind: "combo", combo: "AhQd" }, NODE).hands).toEqual({ combos: ["AhQd"] });
    expect(handsOf({ kind: "combo", combo: null }, NODE).problems[0]).toMatch(/select a class/);
    expect(combosNamed({ kind: "classes", text: "AQo KK" })).toBe(18);
    expect(combosNamed({ kind: "classes", text: "K9s" }, "Kd7c2h")).toBe(3);
    expect(combosNamed({ kind: "classes", text: "AQo KK" }, "Kd7c2h")).toBe(15);
    expect(memoryNote("flop", "accurate")).toMatch(/about 1\.2 GB/);
    expect(memoryNote("turn", "accurate")).toBeNull();
    expect(memoryNote("flop", "fast")).toBeNull();
    expect(combosNamed({ kind: "combo", combo: "AhQd" })).toBe(1);
    expect(combosNamed({ kind: "range" })).toBeNull();
  });

  it("says what a hand scope means on each street", () => {
    expect(scopeNote("river", { kind: "classes", text: "KK" })).toBeNull();
    expect(scopeNote("turn", { kind: "range" })).toBeNull();
    expect(scopeNote("turn", { kind: "combo", combo: "AhQd" })).toMatch(/marked approximate/);
    expect(scopeNote("flop", { kind: "classes", text: "KK" })).toMatch(/buckets/);
  });

  it("puts the held player first and works out the changes", () => {
    const v = valueRows(BLOCK);
    expect(v.map((r) => r.seat)).toEqual(["BTN", "BB"]);
    expect(v[0]!.change).toBeCloseTo(0.7052 - 0.8055, 6);
    expect(actionRows(BLOCK.changes[1]!)[0]).toEqual({ action: "check", unlocked: 0.283, locked: 0.5, change: expect.closeTo(0.217, 6) });
    expect(actionRows(BLOCK.changes[3]!)[0]).toEqual({ action: "fold", unlocked: 0.514, locked: null, change: null });
  });

  it("offers the street before on a turn or river, whole range only and with no kept locks", () => {
    expect(reachBack("flop", { kind: "range" }, 0)).toBeNull();
    expect(reachBack("turn", { kind: "range" }, 0)).toEqual({ from: "flop", blocked: null });
    expect(reachBack("river", { kind: "range" }, 0)).toEqual({ from: "turn", blocked: null });
    expect(reachBack("river", { kind: "classes", text: "AKs" }, 0)!.blocked).toMatch(/only the whole range/);
    expect(reachBack("turn", { kind: "range" }, 1)!.blocked).toMatch(/Drop the kept locks/);
  });

  it("says what lock_cost is and isn't", () => {
    const w = costWords(BLOCK);
    expect(w).toContain("Dropping the lock would win BTN 15.67 bb more against BB as BB now plays.");
    expect(w).toContain("never trained an answer");
    expect(costWords({ ...BLOCK, untrained: false })).not.toContain("never trained");
    expect(costWords({ ...BLOCK, locked: { ...BLOCK.locked, lock_cost: [0, 0] } })).toContain("wins BTN nothing");
    expect(exploitWords(BLOCK)).toBe("0.070% of the pot in the restricted game (unlocked: 0.090%).");
  });
});

describe("NodeLockPanel", () => {
  it("shows nothing where Study has no node", () => {
    const { container } = render(<NodeLockPanel hand={HAND} res={{ study: "deal", street: "flop" }} cls={null} mode="fast" getSolver={async () => clientAnswering(done).client} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ["multiway", { ...NODE, multiway: true, players: 3 }, HAND, "Node locking is heads-up: this pot has 3 players in it."],
    ["preflop", { ...NODE, street: "preflop" as const }, HAND, "Node locking is postflop: preflop is the charts or a separate solve, not this tree."],
    ["a tournament", NODE, { ...HAND, setup: { tournament: { payouts: [50, 30, 20] } } } as unknown as StudyHand, "Node locking is for cash games: a tournament's payoffs aren't zero-sum, and a lock hasn't been checked on them."],
  ])("says so for %s, with no form and nothing asked", (_n, res, hand, words) => {
    const { client } = clientAnswering(done);
    const form = open(res, null, client, hand);
    expect(form).toBeNull();
    expect(screen.getByText(words)).toBeInTheDocument();
    expect(client.nodeLock).not.toHaveBeenCalled();
  });

  it("sends the mix, the whole range and what the page showed, then shows the result beside the unlocked answer", async () => {
    const { client, asked } = clientAnswering(done);
    const form = open(NODE, "AQo", client)!;
    expect(within(form).getByLabelText("check %")).toHaveValue("28.3");
    fireEvent.change(within(form).getByLabelText("check %"), { target: { value: "50" } });
    fireEvent.change(within(form).getByLabelText("bet 33% %"), { target: { value: "50" } });
    fireEvent.change(within(form).getByLabelText("bet 75% %"), { target: { value: "" } });
    fireEvent.click(within(form).getByRole("button", { name: "Run" }));
    const result = await screen.findByRole("region", { name: "Node-locked result" });
    expect(asked[0]!.lock).toEqual({ mix: { check: 0.5, "bet 33%": 0.5, "bet 75%": 0 }, hands: "all", expect: { actor: "BTN", actions: ["check", "bet 33%", "bet 75%"] } });
    expect(asked[0]!.mode).toBe("fast");
    expect(result).toHaveTextContent("Node-locked equilibrium of the restricted game, not the unlocked equilibrium");
    expect(result).toHaveTextContent("BTN holds check 50.0%, bet 33% 50.0% (whole range).");
    expect(result).toHaveTextContent("Unlocked column: Live solve");
    const tables = within(result).getAllByRole("table");
    const value = within(tables[0]!).getAllByRole("row");
    expect(value[1]).toHaveTextContent("BTN+0.81+0.71-0.10");
    expect(value[2]).toHaveTextContent("BB-0.81-0.71+0.10");
    const mix = within(tables[1]!).getAllByRole("row");
    expect(mix[1]).toHaveTextContent("check28.3%50.0%+21.7");
    expect(mix[3]).toHaveTextContent("bet 75%14.6%0.0%-14.6");
    expect(result).toHaveTextContent("0.070% of the pot in the restricted game (unlocked: 0.090%).");
    expect(result).toHaveTextContent("Dropping the lock would win BTN 15.67 bb more against BB as BB now plays.");
    expect(result).toHaveTextContent("The lock is on this street's solve.");
    expect(result).toHaveTextContent("Below it the turn is played as one card per class.");
    expect(result).toHaveTextContent("The flop is solved live here.");
    fireEvent.click(within(result).getByText("The decisions around it"));
    expect(result).toHaveTextContent("BB first (before the lock). Reached 100.0% of the time unlocked, 100.0% locked.");
    expect(result).toHaveTextContent("BB after check, bet 75% (after the lock). No longer reached with the lock on.");
  });

  it("keeps a lock to hold beside the next one on this street, sends it, and drops it", async () => {
    useKeptLocks.getState().clear();
    const rooted = { ...ANSWER, node_lock: { ...BLOCK, root: "abc", also: [] } };
    const first = clientAnswering(() => ({ data: rooted, provenance: provenanceOf(rooted, ctx) }) as unknown as SolveResult<never>);
    const form = open(NODE, "AQo", first.client)!;
    fireEvent.click(within(form).getByRole("button", { name: "Run" }));
    const result = await screen.findByRole("region", { name: "Node-locked result" });
    fireEvent.click(within(result).getByRole("button", { name: "Keep this lock" }));
    expect(within(result).getByRole("button", { name: "Kept" })).toBeDisabled();
    cleanup();

    // (another node of the street: the kept lock is listed and goes with the lock asked)
    const both = { ...ANSWER, node_lock: { ...BLOCK, line: ["check", "bet 33%"], root: "abc", also: [{ line: ["check"], player: 1 as const, seat: "BTN", actions: ["check", "bet 33%", "bet 75%"], mix: [0.5, 0.5, 0], hands: "all" as const, cells: 1, ignored: 0, words: BLOCK.words }] } };
    const second = clientAnswering(() => ({ data: both, provenance: provenanceOf(both, ctx) }) as unknown as SolveResult<never>);
    const form2 = open(NODE, "AQo", second.client)!;
    const kept = within(form2).getByLabelText("Kept locks");
    expect(kept).toHaveTextContent(`${BLOCK.words} (after check)`);
    fireEvent.click(within(form2).getByRole("button", { name: "Run" }));
    const result2 = await screen.findByRole("region", { name: "Node-locked result" });
    expect(second.asked[0]!.lock.also).toEqual([{ root: "abc", line: ["check"], player: 1, mix: { check: 0.5, "bet 33%": 0.5 }, hands: "all" }]);
    expect(result2).toHaveTextContent(`Held with it: ${BLOCK.words} (after check).`);
    expect(provenanceOf(both, ctx).lock).toBe(`${BLOCK.words}; ${BLOCK.words}`);
    fireEvent.click(within(kept).getByRole("button", { name: "Drop" }));
    expect(screen.queryByLabelText("Kept locks")).toBeNull();
    cleanup();

    // (another board: not offered)
    useKeptLocks.getState().keep({ root: "abc", line: [], player: 0, mix: { check: 1 }, hands: "all", seat: "BB", words: "BB holds check", street: "river", board: "Kd7c2h5s9d" });
    open(NODE, "AQo", second.client, { ...HAND, board: "Ad7c2h5s9d" });
    expect(screen.queryByLabelText("Kept locks")).toBeNull();
    useKeptLocks.getState().clear();
  });

  it("holds a river lock from the turn: sends reach back, shows the turn's moves, and labels it approximate", async () => {
    useKeptLocks.getState().clear();
    const row = (line: string[], seat: string, player: 0 | 1, actions: string[], unlocked: number[], locked: number[], moved: number, share: [number, number]) =>
      ({ line, seat, player, actions, unlocked, locked, moved, share });
    const back = {
      ...ANSWER,
      street: "river" as const,
      node_lock: {
        ...BLOCK,
        line: ["check", "check", "9s", "check"],
        root: "turn-root",
        reach: "turn" as const,
        changes: [],
        words: `${BLOCK.words}, held from the turn`,
        earlier: {
          street: "turn" as const,
          on_line: [row([], "BB", 0, ["check", "bet 33%"], [0.9, 0.1], [0.97, 0.03], 7, [1, 1]), row(["check"], "BTN", 1, ["check", "bet 33%"], [0.4, 0.6], [0.55, 0.45], 15, [1, 1])],
          moved: [row(["bet 33%"], "BTN", 1, ["fold", "call"], [0.3, 0.7], [0.2, 0.8], 10, [0.1, 0.03])],
        },
      },
    };
    const { client, asked } = clientAnswering(() => ({ data: back, provenance: provenanceOf(back, ctx) }) as unknown as SolveResult<never>);
    const form = open(NODE, "AQo", client)!;
    const box = within(form).getByRole("checkbox", { name: /Hold it from the turn/ });
    // (a hand scope can't be held from the turn)
    fireEvent.click(within(form).getByRole("radio", { name: "Hand classes" }));
    expect(box).toBeDisabled();
    expect(form).toHaveTextContent("From the turn, only the whole range can be held");
    fireEvent.click(within(form).getByRole("radio", { name: "Whole range" }));
    fireEvent.click(box);
    expect(box).toBeChecked();
    fireEvent.click(within(form).getByRole("button", { name: "Run" }));
    const result = await screen.findByRole("region", { name: "Node-locked result" });
    expect(asked[0]!.lock.reach).toBe("back");
    expect(asked[0]!.lock.also).toBeUndefined();
    expect(result).toHaveTextContent("The turn with the lock on, on this hand's line (held after check, check, 9s, check):");
    expect(result).toHaveTextContent("BTN after check");
    expect(within(result).getAllByRole("table").length).toBe(4); // the value, the turn's two decisions on the line, the one that moved
    fireEvent.click(within(result).getByText("Elsewhere on the turn, what moved most"));
    expect(result).toHaveTextContent("BTN after bet 33%: 10.0 points (reached by 10.0% of BTN's range unlocked, 3.0% locked)");
    // a lock on the turn's solve can't be kept for this street's
    expect(within(result).queryByRole("button", { name: "Keep this lock" })).toBeNull();
    const p = provenanceOf(back, ctx);
    expect(p.approximate).toBe(true);
    expect(p.approximateLabel).toMatch(/held in the turn's solve, which plays this street more coarsely/);
  });

  it("stops a mix that doesn't add up, in words, before a solve", () => {
    const { client } = clientAnswering(done);
    const form = open(NODE, null, client)!;
    fireEvent.change(within(form).getByLabelText("check %"), { target: { value: "90" } });
    expect(screen.getByRole("alert")).toHaveTextContent("The mix adds up to 161.7%: it has to be 100%.");
    expect(within(form).getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("holds hand classes, starting from the class picked, and says when one isn't in the range", async () => {
    const { client, asked } = clientAnswering(done);
    const form = open(NODE, "AQo", client)!;
    fireEvent.click(within(form).getByLabelText("Hand classes"));
    const box = within(form).getByRole("textbox", { name: "Hand classes" });
    expect(box).toHaveValue("AQo");
    expect(form).toHaveTextContent("12 combos named; the rest of the range stays free");
    fireEvent.change(box, { target: { value: "AQo, 72o" } });
    expect(screen.getByRole("alert")).toHaveTextContent("72o isn't in BTN's range here.");
    expect(within(form).getByRole("button", { name: "Run" })).toBeDisabled();
    fireEvent.change(box, { target: { value: "AQo, KK" } });
    fireEvent.click(within(form).getByRole("button", { name: "Run" }));
    await screen.findByRole("region", { name: "Node-locked result" });
    expect(asked[0]!.lock.hands).toEqual({ classes: ["AQo", "KK"] });
  });

  it("holds one combo from the class picked, and on a turn says first what that does", async () => {
    const { client, asked } = clientAnswering(done);
    const form = open({ ...NODE, street: "turn" }, "AQo", client)!;
    fireEvent.click(within(form).getByLabelText("One combo"));
    const combo = within(form).getByLabelText("Combo");
    expect(within(combo).getAllByRole("option").map((o) => o.textContent)).toEqual(["AhQd", "AsQc"]);
    fireEvent.change(combo, { target: { value: "AsQc" } });
    expect(form).toHaveTextContent("Rivers by card class: marked approximate.");
    fireEvent.click(within(form).getByRole("button", { name: "Run" }));
    await screen.findByRole("region", { name: "Node-locked result" });
    expect(asked[0]!.lock.hands).toEqual({ combos: ["AsQc"] });
  });

  it("shows progress and cancels", async () => {
    const { client, asked } = clientAnswering(
      (a) =>
        new Promise((_ok, no) => {
          a.onProgress?.({ study: "nodelock_progress", iterations: 300, of: 1000, exploitability_pct: 0.412, seconds: 2 });
          a.signal?.addEventListener("abort", () => no(new SolverError("cancelled", "cancelled")));
        }),
    );
    const form = open(NODE, null, client)!;
    fireEvent.click(within(form).getByRole("button", { name: "Run" }));
    expect(await screen.findByRole("status")).toHaveTextContent("300 of up to 1000 iterations, 0.41% of the pot exploitable…");
    expect(within(form).getByRole("button", { name: "Run" })).toBeDisabled();
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Stopped.");
    expect(asked[0]!.signal?.aborted).toBe(true);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("gives a refusal's words, and takes the live tree's actions where it's those that differ", async () => {
    const { client } = clientAnswering(() => {
      throw new NodeLockError("refused", "This node's actions in the live solve aren't the ones shown: check, bet 50%.", ["check", "bet 50%"]);
    });
    const form = open(NODE, null, client)!;
    fireEvent.click(within(form).getByRole("button", { name: "Run" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("aren't the ones shown: check, bet 50%.");
    await waitFor(() => expect(within(form).getByLabelText("bet 50% %")).toHaveValue(""));
    expect(within(form).getByLabelText("check %")).toHaveValue("100");
    expect(within(form).queryByLabelText("bet 75% %")).toBeNull();
  });

  it("says when the flop on screen is the library's", async () => {
    const form = open({ ...NODE, street: "flop", precomputed: { spot: "srp_btn_bb" } }, null)!;
    fireEvent.click(within(form).getByRole("button", { name: "Run" }));
    const result = await screen.findByRole("region", { name: "Node-locked result" });
    expect(result).toHaveTextContent("Stored flop: the unlocked column is a live");
  });

  it("stops the solve when the panel goes (another node)", async () => {
    const { client, asked } = clientAnswering(() => new Promise(() => {}));
    const { unmount } = render(<NodeLockPanel hand={HAND} res={NODE} cls={null} mode="fast" getSolver={async () => client} />);
    fireEvent.click(screen.getByText("Hold this node at a mix (true node lock)"));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]!.signal?.aborted).toBe(false);
    unmount();
    expect(asked[0]!.signal?.aborted).toBe(true);
  });
});
