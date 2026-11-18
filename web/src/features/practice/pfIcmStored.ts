// The tournament spots the worker answers from a stored preflop solve (engine/pf_icm_stored.py, built by
// scripts/pf_icm/build_stored.py into engine/pf_icm/ on the calibrated game, engine/pf_icm_calib.py): the stage and format
// presets, the final-table set (its payout structures and shapes), the bounty set (KO and PKO), the satellite set and the
// chip EV set. A Practice session set to one of these, as it sets the table and not played out, has its preflop graded by
// the solve as a cash session's is by the stored grid, and so does Analyze for a hand kept from one (in prize equity).
//
// PF_ICM_PRESETS is every spot the build makes, in engine/pf_icm_stored.py ALL's order; pfIcmBuilt.json (written by the
// build's `index`) the ones whose files are built on the current game and class equity table. Only those are matched:
// a spot whose file is missing or stale (another game or equity table: its key is another) is said to need a solve.
// pfIcmStored.test.ts holds the lists to engine/pf_icm/sets.json and the manifest, each one's request as Practice sends it.
//
// Left out: the spin and the double or nothing in chip EV, whose games the cash grid holds (equal stacks, no ante). The 7-
// to 9-player spots are stored on the 7-9 handed tree (nobody cold 4bets or cold-calls a 3bet, at most two see a flop),
// said in the answer.
import { BOUNTY_SET, CHIP_SET, FINAL_TABLE_SET, presetAnte, SATELLITE_SET, STORED_STAGES, storedStage, type StagePreset } from "@/features/tournaments/tournament";
import { seatsOf } from "@/poker/seats";
import built from "./pfIcmBuilt.json";

/** The stage and format presets stored, in the manifest's order. */
export const PF_ICM_STAGES = STORED_STAGES;

/** Every spot the build makes, in its order: the presets, the final-table set, the bounty, satellite and chip EV sets. */
export const PF_ICM_PRESETS: readonly StagePreset[] = [
  ...PF_ICM_STAGES.map(storedStage),
  ...FINAL_TABLE_SET,
  ...BOUNTY_SET,
  ...SATELLITE_SET,
  ...CHIP_SET,
];

/** The game tag and class equity table the stored files are built on, and which spots are built (PF_ICM_PRESETS indexes). */
export const PF_ICM_BUILD: { model: string; equity: string; built: readonly number[] } = built;

/** The spots whose stored solve is built on the current game: the only ones matched. */
export const PF_ICM_STORED: readonly StagePreset[] = PF_ICM_BUILD.built.map((i) => PF_ICM_PRESETS[i]!).filter(Boolean);

/** A tournament session's game, as far as the stored solve's key goes. */
export interface IcmGame {
  model: "icm" | "chips";
  stacks: Record<string, number>;
  payouts?: number[];
  field?: { players: number; avg: number };
  /** KO or PKO: each seat's bounty (or every seat's), and the other tables' average */
  bounty?: { format: string; seats?: Record<string, number>; each?: number; field?: number };
}

/** A preset's game, as a session set to it is (one prize: chip EV, no other tables). */
export const presetGame = (st: StagePreset): IcmGame => {
  const stacks = Object.fromEntries(seatsOf(st.players).map((p, i) => [p, st.stacks[i]!]));
  if (st.payouts.length < 2) return { model: "chips", stacks };
  return {
    model: "icm",
    stacks,
    payouts: st.payouts,
    ...(st.field ? { field: st.field } : {}),
    ...(st.bounty ? { bounty: { format: st.bounty.format, each: st.bounty.each, field: st.bounty.each } } : {}),
  };
};

const same = (a: readonly number[] | undefined, b: readonly number[] | undefined) => (a ?? []).length === (b ?? []).length && (a ?? []).every((x, i) => Math.abs(x - b![i]!) < 1e-9);
const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 1e-9;

/** Whether the session's bounties are the preset's: none and none, or the same format with every seat's and the other
 * tables' average its bounty a head. */
function sameBounty(p: StagePreset, b: IcmGame["bounty"], seats: readonly string[]): boolean {
  if (!p.bounty || !b) return !p.bounty && !b;
  const each = p.bounty.each;
  return b.format === p.bounty.format && seats.every((s) => near(b.seats?.[s] ?? b.each, each)) && near(b.field ?? 0, each);
}

/** The stored spot this session's game is, or null: the same table, every seat's chips, ante, prizes (one prize: chip EV),
 * other tables and bounties, among the spots built on the current game. */
export function pfIcmStage(players: number, stack: number, ante: number | undefined, t: IcmGame | undefined, among: readonly StagePreset[] = PF_ICM_STORED): StagePreset | null {
  if (!t) return null;
  const seats = seatsOf(players);
  const chips = t.model === "chips";
  return (
    among.find(
      (p) =>
        p.players === players &&
        Math.abs(Math.max(...p.stacks) - stack) < 1e-9 &&
        Math.abs(presetAnte(p) - (ante ?? 0)) < 1e-9 &&
        (chips ? p.payouts.length === 1 && !t.bounty : p.payouts.length > 1 && same(p.payouts, t.payouts) && sameBounty(p, t.bounty, seats)) &&
        (chips || (p.field ? !!t.field && t.field.players === p.field.players && Math.abs(t.field.avg - p.field.avg) < 1e-9 : !t.field)) &&
        seats.every((s, i) => Math.abs((t.stacks[s] ?? stack) - p.stacks[i]!) < 1e-9),
    ) ?? null
  );
}

const count = (set: readonly StagePreset[]) => set.filter((p) => PF_ICM_STORED.includes(p)).length;

/** The stored spots in words: the presets, and each set with how many of its spots are built. */
export const PF_ICM_WORDS = PF_ICM_STORED.length
  ? `the presets ${PF_ICM_STAGES.filter((n) => PF_ICM_STORED.some((p) => p.name === n)).join(", ")}; the final-table set (${count(FINAL_TABLE_SET)} spots), the bounty set (${count(BOUNTY_SET)}), the satellite set (${count(SATELLITE_SET)}) and the chip EV set (${count(CHIP_SET)}), on the Tournaments page`
  : "none at the moment (the stored solves are being rebuilt on the current game)";
