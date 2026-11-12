// The tournament presets the worker answers from a stored preflop solve in prize equity (engine/pf_icm_stored.py, built by
// scripts/pf_icm/build_stored.py into engine/pf_icm/): a Practice session set to one of these, as the preset sets it and
// not played out, has its preflop graded by the solve as a cash session's is by the stored grid. pfIcmStored.test.ts holds
// this list to the manifest (engine/pf_icm/stages.json), each one's request as Practice sends it to the one stored.
//
// Left out: the 8- and 9-player presets (Early, Bubble, Final table, the 9-player sit & go's start), too big for the browser
// to hold (2-5 GB to build natively); and the spin, which is one prize, so chip EV, sent as a cash game the grid answers.
import { FORMAT_PRESETS, presetAnte, STAGE_PRESETS, type StagePreset } from "@/features/tournaments/tournament";
import { seatsOf } from "@/poker/seats";

export const PF_ICM_STAGES = ["Final-table bubble", "Three left", "Heads-up", "Sit & go bubble", "Sit & go, 6 players", "Double or nothing"] as const;

/** The presets stored, as tournament.ts has them. */
export const PF_ICM_PRESETS: readonly StagePreset[] = [...STAGE_PRESETS, ...FORMAT_PRESETS].filter((p) => (PF_ICM_STAGES as readonly string[]).includes(p.name));

/** A tournament session's game, as far as the stored solve's key goes. */
interface Game {
  model: "icm" | "chips";
  stacks: Record<string, number>;
  payouts?: number[];
  field?: { players: number; avg: number };
  bounty?: unknown;
}

const same = (a: readonly number[] | undefined, b: readonly number[] | undefined) => (a ?? []).length === (b ?? []).length && (a ?? []).every((x, i) => Math.abs(x - b![i]!) < 1e-9);

/** The stored preset this session's game is, or null: the same table, every seat's chips, ante, prizes and other tables,
 * and no bounties (none is stored with them). */
export function pfIcmStage(players: number, stack: number, ante: number | undefined, t: Game | undefined): StagePreset | null {
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

/** The stored presets in words: "Final-table bubble, Three left, … or Double or nothing". */
export const PF_ICM_WORDS = `${PF_ICM_STAGES.slice(0, -1).join(", ")} or ${PF_ICM_STAGES.at(-1)}`;
