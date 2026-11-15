// The page's stored tournament spots against the worker's: each preset and each spot of the final-table set, set up as
// Practice's form sets it (stageDraft, readDraft), dealt, and asked of the preflop solve (pfState), sends exactly the
// request engine/pf_icm/stages.json was stored for, and has its file; a session that isn't the spot as stored is refused,
// saying why.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FINAL_TABLE_SET, finalTableStacks, FORMAT_PRESETS, FT_DEPTHS, FT_PLAYERS, FT_SHAPES, STAGE_PRESETS } from "@/features/tournaments/tournament";
import nodes from "@/test/fixtures/pf_nodes.json";
import type { AdvisorResponse } from "@/solver/protocol";
import { provenanceOf } from "@/solver/provenance";
import type { Provenance } from "@/solver/types";
import { gradedOn, optionsAt, type HeldAnswer } from "./pfGrade";
import { PF_ICM_PRESETS, PF_ICM_STAGES, pfIcmStage } from "./pfIcmStored";
import { decide, newHand, pfBlocked, pfState, stateFor, withVillain, type PracticeHand, type TournamentOptions } from "./practice";
import { readDraft, stageDraft } from "./TournamentFields";

const ROOT = resolve(__dirname, "../../../..");
const manifest = JSON.parse(readFileSync(resolve(ROOT, "engine/pf_icm/stages.json"), "utf8")) as { name: string; set: string; key: string; request: Record<string, unknown>; players: number; mbb: number }[];

function session(name: string) {
  const st = [...STAGE_PRESETS, ...FORMAT_PRESETS, ...FINAL_TABLE_SET].find((p) => p.name === name)!;
  const { players, stack, ante, draft } = stageDraft(st);
  const { value, problems } = readDraft(draft, players, stack, 250);
  expect(problems).toEqual([]);
  return { players, stack, ante, tournament: value! };
}

describe("the stored tournament presets", () => {
  it("are the manifest's, in its order, every one with its file", () => {
    expect(manifest.map((e) => e.name)).toEqual(PF_ICM_PRESETS.map((p) => p.name));
    expect(PF_ICM_PRESETS.slice(0, PF_ICM_STAGES.length).map((p) => p.name)).toEqual([...PF_ICM_STAGES]);
    expect(manifest.filter((e) => e.set === "final table").map((e) => e.name)).toEqual(FINAL_TABLE_SET.map((p) => p.name));
    expect(manifest.filter((e) => !existsSync(resolve(ROOT, "engine/pf_icm", `${e.key}.bin`)))).toEqual([]);
    const py = readFileSync(resolve(ROOT, "engine/pf_icm_stored.py"), "utf8");
    for (const e of manifest) expect(py).toContain(`'${e.key}': '${e.name}'`);
  });

  it("send, set up and dealt in Practice, the very request each was stored for", () => {
    for (const e of manifest) {
      const s = session(e.name);
      const h = newHand(s.players, s.stack, 0, 7, { ante: s.ante, tournament: s.tournament });
      const asked = pfState(h) as unknown as Record<string, unknown>;
      const keys = ["players", "stack", "stacks", "ante", "payouts", "field"];
      const mine = Object.fromEntries(keys.filter((k) => asked[k] !== undefined).map((k) => [k, asked[k]]));
      expect(mine, e.name).toEqual(e.request);
      expect(asked).toMatchObject({ study: true, preflop_solve: true });
    }
  });

  it("are graded by the solve, and nothing else a tournament is", () => {
    for (const name of PF_ICM_STAGES) {
      const s = session(name);
      expect(pfBlocked(s.players, s.stack, { ante: s.ante, tournament: s.tournament }), name).toBeNull();
    }
    const ft = session("Final-table bubble");
    const words = (o: Parameters<typeof pfBlocked>[2]) => pfBlocked(ft.players, ft.stack, o) ?? "";
    // a seat's chips changed, a bounty added, or played out: not the game stored
    expect(words({ ante: ft.ante, tournament: { ...ft.tournament, stacks: { ...ft.tournament.stacks, BB: 15 } } })).toMatch(/stored only for these spots/);
    const ko: TournamentOptions = { ...ft.tournament, bounty: { format: "ko", seats: { HJ: 10, CO: 10, BTN: 10, SB: 10, BB: 10 }, field: 10 } };
    expect(pfIcmStage(ft.players, ft.stack, ft.ante, ko)).toBeNull();
    expect(words({ ante: ft.ante, tournament: ft.tournament, carry: true, seat: "moves" })).toMatch(/Played out/);
    expect(words({ ante: 0, tournament: ft.tournament })).toMatch(/stored only for these spots/);
    // the 8-player bubble is stored since 2026-11-13; one seat's chips off it isn't, and the reason names what is
    const bubble = session("Bubble");
    expect(pfBlocked(bubble.players, bubble.stack, { ante: bubble.ante, tournament: bubble.tournament })).toBeNull();
    const off = { ...bubble.tournament, stacks: { ...bubble.tournament.stacks, BB: 19 } };
    expect(pfBlocked(bubble.players, bubble.stack, { ante: bubble.ante, tournament: off })).toMatch(/Double or nothing.*final-table set/);
  });

  it("include the 8- and 9-player presets and the final-table set, each graded and near equilibrium", () => {
    for (const name of ["Early", "Bubble", "Final table", "Sit & go, 9 players", "Final table, 9 left, 40bb average, chip leader on the button"]) {
      const s = session(name);
      expect(pfBlocked(s.players, s.stack, { ante: s.ante, tournament: s.tournament }), name).toBeNull();
    }
    expect(FINAL_TABLE_SET).toHaveLength(FT_PLAYERS.length * FT_DEPTHS.length * FT_SHAPES.length);
    for (const e of manifest) expect(e.mbb, e.name).toBeLessThan(2);
    // the shapes: the button twice the average, or the big blind 0.4 of it, the rest sharing what's left (to 0.1bb, down)
    expect(finalTableStacks(6, 20, "leader")).toEqual([16, 16, 16, 40, 16, 16]);
    expect(finalTableStacks(3, 15, "short")).toEqual([19.5, 19.5, 6]);
    expect(finalTableStacks(4, 10, "equal")).toEqual([10, 10, 10, 10]);
  });

  it("send a spin, one prize, as the stored cash game it is, and refuse chip EV with unequal stacks", () => {
    const spin = session("Spin, 3 players");
    expect(spin.tournament.model).toBe("chips");
    expect(pfBlocked(spin.players, spin.stack, { ante: spin.ante, tournament: spin.tournament })).toBeNull();
    const uneven: TournamentOptions = { model: "chips", stacks: { BTN: 25, SB: 20, BB: 25 } };
    expect(pfBlocked(3, 25, { tournament: uneven })).toMatch(/equal stacks only in chip EV/);
  });
});

describe("a stored preset's preflop, played on the solve's tree", () => {
  const NODES = nodes as unknown as Record<"first" | "opened", AdvisorResponse>;
  const CHART_P: Provenance = { source: "charts", approximate: true, mode: "quick", transport: "worker", solverVersion: "1", partial: false, receivedAt: 0 };
  const ctx = { mode: "fast" as const, transport: "worker" as const, solverVersion: "1", partial: false, now: 1 };
  // the chart's buttons first in at a short stack: no jam beside its open, and its open isn't the tree's size
  const CHART: AdvisorResponse = { street: "preflop", pot_bb: 1.5, actions: [{ action: "raise", freq: 0.4, amount_bb: 2.2 }, { action: "fold", freq: 0.6 }] };

  it("is a session of a stored preset graded by the solve, and only that: the opponents are asked for its moves preflop", () => {
    const s = session("Sit & go bubble");
    const h = newHand(s.players, s.stack, 0, 7, { ante: s.ante, tournament: s.tournament, pfSolve: true });
    expect(h.pfOptions).toBe(true);
    expect(stateFor(h).pf_play).toBe(true);
    expect(stateFor({ ...h, shown: 3 }).pf_play).toBeUndefined();
    expect(newHand(s.players, s.stack, 0, 7, { ante: s.ante, tournament: s.tournament }).pfOptions).toBeUndefined();
    expect(newHand(6, 100, 0, 7, { pfSolve: true }).pfOptions).toBeUndefined();
    const spin = session("Spin, 3 players");
    expect(newHand(spin.players, spin.stack, 0, 7, { ante: spin.ante, tournament: spin.tournament, pfSolve: true }).pfOptions).toBeUndefined();
  });

  it("offers the solve's own options where it reads the spot, and grades them all by EV", () => {
    const base = newHand(6, 100, 0, 7, { pfSolve: true });
    const h: PracticeHand = { ...base, hero: "UTG", hands: { ...base.hands, UTG: ["Ah", "Kd"] }, pfOptions: true };
    const held: HeldAnswer = { data: CHART, provenance: CHART_P, pf: { data: NODES.first, provenance: provenanceOf(NODES.first, ctx) } };
    expect(optionsAt(h, held).map((a) => [a.action, a.amount_bb])).toEqual(NODES.first.actions!.map((a) => [a.action, a.amount_bb ?? undefined]));
    const on = gradedOn(h, held);
    expect(on.pfWhy).toBeUndefined();
    expect(on.provenance.source).toBe("preflop-solve");
    const r = decide(h, on.data, 0, on.provenance);
    if ("error" in r) throw new Error(r.error);
    expect(r.decision.grade!.byEv).toBe(true);
    // without it, the chart's 2.2bb is no option of the solve's
    expect(gradedOn({ ...h, pfOptions: undefined }, held).pfWhy).toMatch(/options aren't yours/);
  });

  it("takes a jam no one left can call as the tree plays it, to the deepest stack, the rest counted apart", () => {
    const s = session("Sit & go bubble");
    let h = newHand(s.players, s.stack, 0, 7, { ante: s.ante, tournament: s.tournament, pfSolve: true });
    h = { ...h, hero: "BB", hands: { ...h.hands, BB: ["Ah", "Kd"] } };
    for (const m of [{ pos: "CO", action: "all-in" }, { pos: "BTN", action: "fold" }, { pos: "SB", action: "fold" }] as const) h = withVillain(h, m);
    // CO's 23.75bb jam, played on the tree to the big blind's 17.75 (its node: scripts/engine/test_pf_icm_stored.py)
    const node = { ...NODES.first, actor: "BB", pot_bb: 20.25, uncalled_bb: 6, to_call_bb: 16.75 };
    const held = (data: AdvisorResponse): HeldAnswer => ({ data: CHART, provenance: CHART_P, pf: { data, provenance: provenanceOf(data, ctx) } });
    expect(gradedOn(h, held(node)).pfWhy).toBeUndefined();
    expect(gradedOn(h, held({ ...node, uncalled_bb: undefined })).pfWhy).toMatch(/chips in aren't/);
  });

  it("still refuses a node that isn't the spot: other chips in", () => {
    const base = newHand(6, 100, 0, 7, { pfSolve: true });
    const h: PracticeHand = { ...base, hero: "UTG", hands: { ...base.hands, UTG: ["Ah", "Kd"] }, pfOptions: true };
    const off = { ...NODES.first, pot_bb: 2.5 };
    expect(gradedOn(h, { data: CHART, provenance: CHART_P, pf: { data: off, provenance: provenanceOf(off, ctx) } }).pfWhy).toMatch(/chips in aren't/);
  });
});
