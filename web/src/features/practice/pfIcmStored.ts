// The tournament spots the worker answers from a stored preflop solve in prize equity (engine/pf_icm_stored.py, built by
// scripts/pf_icm/build_stored.py into engine/pf_icm/): the stage and format presets, and the final-table set. A Practice
// session set to one of these, as it sets the table and not played out, has its preflop graded by the solve as a cash
// session's is by the stored grid, and so does Analyze for a hand kept from one. pfIcmStored.test.ts holds these lists to
// the manifest (engine/pf_icm/stages.json), each one's request as Practice sends it to the one stored.
//
// Left out: the spin, which is one prize, so chip EV, sent as a cash game the grid answers. The 8- and 9-player presets are
// stored on the 7-9 handed tree (nobody cold 4bets or cold-calls a 3bet, at most two see a flop), said in the answer.
import { FINAL_TABLE_SET, FORMAT_PRESETS, presetAnte, STAGE_PRESETS, type StagePreset } from "@/features/tournaments/tournament";
import { seatsOf } from "@/poker/seats";

/** The stage and format presets stored, in the manifest's order. */
export const PF_ICM_STAGES = [
  "Final-table bubble",
  "Three left",
  "Heads-up",
  "Sit & go bubble",
  "Sit & go, 6 players",
  "Double or nothing",
  "Early",
  "Bubble",
  "Final table",
  "Sit & go, 9 players",
] as const;

const PRESETS = [...STAGE_PRESETS, ...FORMAT_PRESETS];

/** Every spot stored: the presets, as tournament.ts has them, then the final-table set. */
export const PF_ICM_PRESETS: readonly StagePreset[] = [...PF_ICM_STAGES.map((n) => PRESETS.find((p) => p.name === n)!), ...FINAL_TABLE_SET];

/** A tournament session's game, as far as the stored solve's key goes. */
export interface IcmGame {
  model: "icm" | "chips";
  stacks: Record<string, number>;
  payouts?: number[];
  field?: { players: number; avg: number };
  bounty?: unknown;
}

const same = (a: readonly number[] | undefined, b: readonly number[] | undefined) => (a ?? []).length === (b ?? []).length && (a ?? []).every((x, i) => Math.abs(x - b![i]!) < 1e-9);

/** The stored spot this session's game is, or null: the same table, every seat's chips, ante, prizes and other tables,
 * and no bounties (none is stored with them). */
export function pfIcmStage(players: number, stack: number, ante: number | undefined, t: IcmGame | undefined): StagePreset | null {
  if (!t || t.model !== "icm" || t.bounty) return null;
  const seats = seatsOf(players);
  return (
    PF_ICM_PRESETS.find(
      (p) =>
        p.players === players &&
        Math.abs(Math.max(...p.stacks) - stack) < 1e-9 &&
        Math.abs(presetAnte(p) - (ante ?? 0)) < 1e-9 &&
        same(p.payouts, t.payouts) &&
        (p.field ? !!t.field && t.field.players === p.field.players && Math.abs(t.field.avg - p.field.avg) < 1e-9 : !t.field) &&
        seats.every((s, i) => Math.abs((t.stacks[s] ?? stack) - p.stacks[i]!) < 1e-9),
    ) ?? null
  );
}

/** The stored spots in words: "the presets Final-table bubble, …, Sit & go, 9 players, and the final-table set". */
export const PF_ICM_WORDS = `the presets ${PF_ICM_STAGES.join(", ")}, and the final-table set (${FINAL_TABLE_SET.length} spots, on the Tournaments page)`;
