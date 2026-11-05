import { describe, expect, it } from "vitest";
import { legal, simulate } from "@/poker/table";
import { headsUpRiver } from "../betting";
import { buildTree, checkSizes, type ActionNode, type RiverSizes } from "./tree";

const sizes = (over: Partial<RiverSizes> = {}): RiverSizes => ({ bets: [50, 100], raises: [100], raiseCap: 1, allIn: true, ...over });
const tokens = (t: ReturnType<typeof buildTree>, path: string) => (t.nodes.find((n) => n.path === path) as ActionNode).actions.map((a) => a.token);

describe("the river on the table engine", () => {
  it("puts the pot and the stacks on the table, the big blind first", () => {
    const { table, lines } = headsUpRiver(12.35, 40);
    const s = simulate(table, lines, 5);
    expect(s.current).toBe("river");
    expect(s.pot).toBeCloseTo(12.35, 9);
    expect(legal(table, s)).toMatchObject({ toAct: "BB", toCall: 0, minTo: 1, maxTo: 12.35 });
  });

  it("refuses a pot under the blinds", () => {
    expect(() => headsUpRiver(1, 10)).toThrow(/two blinds/);
  });
});

describe("the tree", () => {
  it("bets half and pot, raises the pot, and stops at the cap", () => {
    const t = buildTree(20, 100, sizes());
    expect(tokens(t, "")).toEqual(["x", "b1000", "b2000"]);
    expect(tokens(t, "x")).toEqual(["x", "b1000", "b2000"]);
    // 10 into 20: pot 30, call 10 (40), raise 40, to 50 (the table's own answer, not worked out here)
    expect(tokens(t, "b1000")).toEqual(["f", "c", "r5000"]);
    expect(tokens(t, "b1000.r5000")).toEqual(["f", "c"]);
    // 20 into 20: pot 40, call 20 (60), raise 60, to 80
    expect(tokens(t, "b2000")).toEqual(["f", "c", "r8000"]);
  });

  it("lands a pot raise on the table's largest raise, at every node", () => {
    const t = buildTree(20, 1000, sizes({ raiseCap: 3 }));
    const { table, lines } = headsUpRiver(20, 1000);
    const moveOf = (tok: string, seat: string) => (tok[0] === "x" ? { pos: seat, action: "check" as const } : tok[0] === "c" ? { pos: seat, action: "call" as const } : { pos: seat, action: tok[0] === "b" ? ("bet" as const) : ("raise" as const), to: Number(tok.slice(1)) / 100 });
    let seen = 0;
    for (const n of t.nodes) {
      if (n.kind !== "action" || !n.path.split(".").at(-1)?.match(/^[br]/) || !n.path) continue;
      const toks = n.path.split(".");
      const river = toks.map((x, i) => moveOf(x, (toks[0] === "x" ? i + 1 : i) % 2 ? "SB" : "BB"));
      const s = simulate(table, { ...lines, river }, 5);
      const raise = n.actions.find((a) => a.kind === "raise");
      if (!raise) continue;
      expect(raise.amount).toBe(legal(table, s)!.maxTo);
      seen++;
    }
    expect(seen).toBeGreaterThan(3);
  });

  it("merges sizes a short stack makes the same, as all-in", () => {
    const t = buildTree(20, 13, sizes({ raiseCap: 2 }));
    expect(tokens(t, "")).toEqual(["x", "b1000", "b1300"]);
    const root = t.nodes[0] as ActionNode;
    expect(root.actions[2]).toMatchObject({ allIn: true, label: "All-in 13" });
    expect(tokens(t, "b1000")).toEqual(["f", "c", "r1300"]); // all-in for under a full raise
    expect(tokens(t, "b1300")).toEqual(["f", "c"]);
    expect(buildTree(20, 5, sizes()).nodes[0]).toMatchObject({ actions: [{ token: "x" }, { token: "b500", allIn: true }] });
  });

  it("offers all-in only where the limit reaches it", () => {
    expect(tokens(buildTree(20, 100, sizes({ bets: [50] })), "")).toEqual(["x", "b1000"]);
    expect(tokens(buildTree(20, 15, sizes({ bets: [50] })), "")).toEqual(["x", "b1000", "b1500"]);
    expect(tokens(buildTree(20, 15, sizes({ bets: [50], allIn: false })), "")).toEqual(["x", "b1000"]);
  });

  it("lifts a small bet to the table's smallest", () => {
    expect(tokens(buildTree(3, 100, sizes({ bets: [10] })), "")).toEqual(["x", "b100"]);
  });

  it("merges sizes that come to the same amount", () => {
    expect(tokens(buildTree(3, 100, sizes({ bets: [10, 20] })), "")).toEqual(["x", "b100"]);
  });

  it("rounds a size down to the cent", () => {
    expect(tokens(buildTree(12.35, 40, sizes({ bets: [33] })), "")).toEqual(["x", "b407"]);
  });

  it("has fold chips and showdown chips as the table has them", () => {
    const t = buildTree(20, 100, sizes());
    expect(t.nodes.find((n) => n.path === "b1000.f")).toMatchObject({ kind: "fold", folded: 1, bets: [0, 0] });
    expect(t.nodes.find((n) => n.path === "b1000.r5000.f")).toMatchObject({ kind: "fold", folded: 0, bets: [10, 10] });
    expect(t.nodes.find((n) => n.path === "b1000.c")).toMatchObject({ kind: "showdown", bets: [10, 10] });
    expect(t.nodes.find((n) => n.path === "x.x")).toMatchObject({ kind: "showdown", bets: [0, 0] });
  });

  it("gives each seat its own actions' numbers, without a gap", () => {
    const t = buildTree(20, 100, sizes());
    const seen: [number, number] = [0, 0];
    for (const n of t.nodes) {
      if (n.kind !== "action") continue;
      expect(n.offset).toBe(seen[n.player]);
      seen[n.player] += n.actions.length;
    }
    expect(seen).toEqual(t.slots);
  });

  it("says what's wrong with sizes", () => {
    expect(checkSizes(sizes({ bets: [150] }))).toMatch(/up to 100/);
    expect(checkSizes(sizes({ bets: [50, 50] }))).toMatch(/twice/);
    expect(checkSizes(sizes({ bets: [25, 50, 75, 100] }))).toMatch(/At most 3 bet/);
    expect(checkSizes(sizes({ raises: [33, 50, 100] }))).toMatch(/At most 2 raise/);
    expect(checkSizes(sizes({ raiseCap: 4 }))).toMatch(/raise cap/);
    expect(checkSizes(sizes())).toBeNull();
  });
});
