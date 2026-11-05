// Saved scenarios: what's stored can be old, hand-edited or from a backup, so a read rebuilds the setup or calls it damaged.
import { beforeEach, describe, expect, it } from "vitest";
import { exploitOf } from "@/features/practice/exploit";
import type { SessionOptions } from "@/features/practice/practice";
import { db, type SavedScenario } from "./db";
import { deleteScenario, getScenario, listScenarios, putScenario, readScenario, scenarioWords } from "./scenarios";

const OPTS: SessionOptions = { seat: "moves", preflopOnly: false, pot: null, ante: 0, straddle: false, carry: false, sizes: null, rake: 0, rakeCap: 0, board: null };
const scenario = (id: string, updatedAt = 2, x: Partial<SavedScenario> = {}): SavedScenario => ({ id, name: `s ${id}`, players: 6, stack: 100, opts: OPTS, note: "", createdAt: 1, updatedAt, ...x });
const withOpts = (o: Record<string, unknown>) => ({ ...scenario("a"), opts: { ...OPTS, ...o } });
const read = (o: Record<string, unknown>, x: Record<string, unknown> = {}) => readScenario({ ...withOpts(o), ...x });

beforeEach(async () => {
  await (await db())!.clear("savedScenarios");
});

describe("readScenario", () => {
  it("gives every setup the form can make back as it was", () => {
    const setups: [Partial<SavedScenario>, Partial<SessionOptions>][] = [
      [{}, {}],
      [{}, { seat: "BTN", ante: 0.5, straddle: true, rake: 5, rakeCap: 3, sizes: { flop: [33, 75], raise: [300] } }],
      [{}, { seat: "random", carry: false, preflopOnly: true }],
      [{}, { carry: true }],
      [{}, { pot: "srp", board: { suits: "mono" } }],
      [{}, { pot: "3bet", exploit: exploitOf("maniac") }],
      [{ stack: 12 }, { pushFold: true }],
      [{ players: 3, stack: 20 }, { tournament: { model: "icm", stacks: { BTN: 25, SB: 8, BB: 30 }, payouts: [50, 30, 20], field: { players: 6, avg: 20 } } }],
      [{ players: 3, stack: 20 }, { preflopOnly: true, tournament: { model: "chips", stacks: { BTN: 25, SB: 8, BB: 30 } } }],
    ];
    for (const [top, o] of setups) {
      const s = scenario("a", 2, { ...top, opts: { ...OPTS, ...o } });
      expect(readScenario(structuredClone(s))).toEqual(s);
    }
  });

  it("reads an older record, giving what it never had the default", () => {
    const old = { id: "a", name: "old", players: 6, stack: 100, opts: { seat: "BTN" }, createdAt: 1, updatedAt: 2 };
    expect(readScenario(old)).toEqual({ ...old, note: "", opts: { ...OPTS, seat: "BTN" } });
  });

  it("leaves what the setup can't have as the form does", () => {
    expect(read({ straddle: true }, { players: 2 })?.opts.straddle).toBe(false);
    expect(read({ carry: true, pot: "srp" })?.opts.carry).toBe(false);
    expect(read({ rake: 0, rakeCap: 4 })?.opts.rakeCap).toBe(0);
    expect(read({ board: { suits: "mono" } })?.opts.board).toBeNull();
    expect(read({ pot: "srp", board: {} })?.opts.board).toBeNull();
    expect(read({ preflopOnly: true, sizes: { flop: [33] } })?.opts.sizes).toBeNull();
  });

  it("calls anything else damaged, and never throws", () => {
    const bad: unknown[] = [
      null,
      7,
      [],
      { ...scenario("a"), id: "" },
      { ...scenario("a"), id: 7 },
      { ...scenario("a"), name: "  " },
      { ...scenario("a"), name: { a: 1 } },
      { ...scenario("a"), note: 7 },
      { ...scenario("a"), createdAt: "x" },
      { ...scenario("a"), updatedAt: 1e20 },
      { ...scenario("a"), players: 1 },
      { ...scenario("a"), players: 10 },
      { ...scenario("a"), players: 2.5 },
      { ...scenario("a"), stack: 9 },
      { ...scenario("a"), stack: 251 },
      { ...scenario("a"), stack: "100" },
      { ...scenario("a"), opts: null },
      { ...scenario("a"), opts: "x" },
      withOpts({ seat: "UTG9" }),
      withOpts({ seat: 7 }),
      withOpts({ pot: "lib" }),
      withOpts({ preflopOnly: "yes" }),
      withOpts({ ante: 2 }),
      withOpts({ ante: "x" }),
      withOpts({ rake: 26 }),
      withOpts({ rakeCap: -1 }),
      withOpts({ straddle: 1 }),
      withOpts({ sizes: { flop: [1] } }),
      withOpts({ sizes: { flop: [25, 33, 50, 75] } }),
      withOpts({ sizes: { flop: "33" } }),
      withOpts({ sizes: { preflop: [33] } }),
      withOpts({ pot: "srp", board: { suits: "rainbowish" } }),
      withOpts({ pot: "srp", board: { pair: "trips", suits: "mono" } }),
      withOpts({ pushFold: true }),
      withOpts({ pushFold: true, pot: "srp" }),
      withOpts({ pot: "srp", preflopOnly: true }),
      withOpts({ tournament: { model: "bounties" } }),
      withOpts({ tournament: { model: "icm", stacks: {}, payouts: [100] } }),
      withOpts({ tournament: { model: "icm", stacks: {} } }),
      withOpts({ tournament: { model: "chips", stacks: { BTN: "x" } } }),
      withOpts({ tournament: { model: "chips", stacks: {} }, pot: "srp" }),
      withOpts({ exploit: { profile: "shark" } }),
      withOpts({ exploit: "nit" }),
      withOpts({ exploit: { profile: "nit" } }),
      withOpts({ pot: "srp", exploit: { profile: "shark" } }),
    ];
    for (const x of bad) expect(readScenario(x), JSON.stringify(x)).toBeNull();
  });

  it("starts a read at the profile's own numbers, whatever a record says they are", () => {
    expect(read({ pot: "srp", exploit: { profile: "nit", lock: { fold: 100 } } })?.opts.exploit).toEqual(exploitOf("nit"));
  });
});

describe("the store", () => {
  it("lists the latest changed first, gets one, deletes", async () => {
    await putScenario(scenario("a", 5));
    await putScenario(scenario("b", 9));
    expect((await listScenarios()).list.map((s) => s.id)).toEqual(["b", "a"]);
    expect(await getScenario("a")).toEqual(scenario("a", 5));
    await deleteScenario("a");
    expect(await getScenario("a")).toBeUndefined();
    expect((await listScenarios()).list.map((s) => s.id)).toEqual(["b"]);
  });

  it("counts a damaged record and leaves it out", async () => {
    await putScenario(scenario("a"));
    await (await db())!.put("savedScenarios", { ...scenario("b"), stack: "lots" } as never);
    expect(await listScenarios()).toEqual({ list: [scenario("a")], damaged: 1 });
    expect(await getScenario("b")).toBeUndefined();
  });
});

describe("scenarioWords", () => {
  it("says the setup, a profile's numbers as assumed", () => {
    expect(scenarioWords(scenario("a"))).toBe("6-max 100bb · full hands");
    const s = scenario("a", 2, { players: 2, opts: { ...OPTS, seat: "BB", pot: "srp", board: { suits: "mono" }, exploit: exploitOf("station"), ante: 0.5, rake: 5, rakeCap: 3, sizes: { flop: [33] } } });
    const words = scenarioWords(s);
    expect(words).toContain("HU 100bb · seat ");
    expect(words).toContain("single-raised pots");
    expect(words).toContain("exploiting Calling station (assumed numbers): folds -20 pts to a first bet, bluffs 50% less, raises 50% less");
    expect(words).toContain("ante 0.5bb");
    expect(words).toContain("rake 5% (cap 3bb)");
    expect(words).toContain("33%");
  });

  it("says a game's kind", () => {
    expect(scenarioWords(scenario("a", 2, { stack: 12, opts: { ...OPTS, pushFold: true } }))).toContain("push/fold");
    expect(scenarioWords(scenario("a", 2, { opts: { ...OPTS, preflopOnly: true } }))).toContain("preflop only");
    expect(scenarioWords(scenario("a", 2, { players: 3, opts: { ...OPTS, tournament: { model: "chips", stacks: {} } } }))).toContain("tournament in chip EV");
  });
});
