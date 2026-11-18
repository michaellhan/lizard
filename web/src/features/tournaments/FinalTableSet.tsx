// The presolved sets on the Tournaments page: the final-table set (players left, average stack, shape of the stacks,
// payout structure, and the game: prize equity, a PKO's bounties, or chip EV) and the satellite set; set the form up with
// a spot or open its preflop solve in Study (engine/pf_icm_stored.py; tournament.ts). The coverage is said in full, as
// it's all there is, and a spot not built on the current game says so (Study then solves it live).
import { useState } from "react";
import { PF_ICM_STORED } from "@/features/practice/pfIcmStored";
import {
  freshHand,
  toSearch,
  type StudyHand,
} from "@/features/study/studyState";
import { seatsOf } from "@/poker/seats";
import {
  BOUNTY_FT,
  BOUNTY_SET,
  CHIP_SET,
  chipName,
  FINAL_TABLE_SET,
  FT_COVERAGE,
  FT_DEPTHS,
  FT_MORE_SHAPES,
  FT_PAY_KEYS,
  FT_PAYS,
  FT_PLAYERS,
  FT_SHAPES,
  FT_SHAPE_WORDS,
  finalTableName,
  presetAnte,
  SAT_DEPTHS,
  SAT_PLAYERS,
  SATELLITE_SET,
  satelliteName,
  type FtPay,
  type FtShape,
  type StagePreset,
} from "./tournament";

/** A stored spot opened in Study on its preflop solve: the table's stack the biggest, the seats with fewer chips their own,
 * the preset's ante, prizes and bounties, as the Tournaments form sets it up (one prize: chip EV). */
export function storedSpotHand(st: StagePreset): StudyHand {
  const top = Math.max(...st.stacks);
  const own = Object.fromEntries(
    seatsOf(st.players).flatMap((p, i) =>
      st.stacks[i] !== top ? [[p, st.stacks[i]!]] : [],
    ),
  );
  const ante = presetAnte(st);
  return {
    ...freshHand(st.players, top),
    setup: {
      ...(Object.keys(own).length ? { stacks: own } : {}),
      ...(ante ? { ante } : {}),
      tournament: {
        payouts: st.payouts,
        ...(st.field ? { field: st.field } : {}),
        ...(st.bounty
          ? {
              bounty: {
                format: st.bounty.format,
                each: st.bounty.each,
                field: st.bounty.each,
              },
            }
          : {}),
      },
    },
    pf: "solver",
  };
}

export const storedSpotLink = (st: StagePreset) =>
  `/study?${toSearch(storedSpotHand(st))}`;

const SEL = "rounded-md border border-border bg-surface-2 px-2 py-1 text-sm";
const BTN =
  "rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2 disabled:opacity-40";
const OPEN =
  "rounded border border-accent bg-accent/15 px-2 py-0.5 text-xs hover:bg-accent/25 disabled:opacity-40";

const GAMES = ["prizes", "pko2.5", "pko5", "chips"] as const;
type Game = (typeof GAMES)[number];
const GAME_WORDS: Record<Game, string> = {
  prizes: "prize equity",
  "pko2.5": "PKO, 2.5 a head",
  pko5: "PKO, 5 a head",
  chips: "chip EV",
};

const ALL = [...FINAL_TABLE_SET, ...BOUNTY_SET, ...SATELLITE_SET, ...CHIP_SET];
const byName = (name: string) => ALL.find((p) => p.name === name) ?? null;

/** The final-table spot for these choices, or why the set has none. */
export function finalTableChoice(
  players: number,
  avg: number,
  shape: FtShape,
  pay: FtPay,
  game: Game,
): { spot: StagePreset | null; why?: string } {
  const base = finalTableName(players, avg, shape, pay);
  const name =
    game === "prizes"
      ? base
      : game === "chips"
        ? chipName(base)
        : `${base}, PKO ${game === "pko5" ? 5 : 2.5} a head`;
  const spot = byName(name);
  if (spot) return { spot };
  if (pay && (FT_MORE_SHAPES as readonly string[]).includes(shape))
    return {
      spot: null,
      why: `${FT_SHAPE_WORDS[shape]} is stored on Lizard's own structure only`,
    };
  if (game === "chips" && pay)
    return {
      spot: null,
      why: "chip EV has no payouts: pick Lizard's structure",
    };
  if (game === "chips")
    return {
      spot: null,
      why: `chip EV is stored with ${FT_SHAPES.map((s) => FT_SHAPE_WORDS[s]).join(", ")}`,
    };
  return {
    spot: null,
    why: `PKO bounties are stored at ${BOUNTY_FT.players.join(" and ")} left, ${BOUNTY_FT.depths.join(" and ")}bb average, on Lizard's structure, with ${FT_SHAPES.map((s) => FT_SHAPE_WORDS[s]).join(", ")}`,
  };
}

function Actions({
  st,
  onSetUp,
  onOpen,
  why,
}: {
  st: StagePreset | null;
  onSetUp: (st: StagePreset) => void;
  onOpen: (st: StagePreset) => void;
  why?: string;
}) {
  const built = !!st && PF_ICM_STORED.includes(st);
  return (
    <>
      <button
        type="button"
        disabled={!st}
        onClick={() => st && onSetUp(st)}
        className={BTN}
      >
        Set up
      </button>
      <button
        type="button"
        disabled={!st}
        onClick={() => st && onOpen(st)}
        className={OPEN}
        title={
          st && !built
            ? "Not built on the current game yet: Study solves it live"
            : undefined
        }
      >
        {built || !st ? "Open its preflop solve" : "Solve it in Study"}
      </button>
      {why && (
        <span className="text-xs text-danger">Not in the set: {why}.</span>
      )}
    </>
  );
}

export function FinalTableSet({
  onSetUp,
  onOpen,
}: {
  onSetUp: (st: StagePreset) => void;
  onOpen: (st: StagePreset) => void;
}) {
  const [players, setPlayers] = useState<number>(6);
  const [avg, setAvg] = useState<number>(20);
  const [shape, setShape] = useState<FtShape>("equal");
  const [pay, setPay] = useState<FtPay>("");
  const [game, setGame] = useState<Game>("prizes");
  const [sp, setSp] = useState<number>(4);
  const [seatsPaid, setSeatsPaid] = useState<number>(3);
  const [sd, setSd] = useState<number>(15);
  const [ss, setSs] = useState<FtShape>("equal");
  const { spot: st, why } = finalTableChoice(players, avg, shape, pay, game);
  const sat = byName(satelliteName(sp, seatsPaid, sd, ss));
  const satSeats = [sp - 1, sp - 2].filter((k) => k >= 2);
  const built = (set: readonly StagePreset[]) =>
    set.filter((p) => PF_ICM_STORED.includes(p)).length;
  return (
    <>
      <div
        className="space-y-1 text-sm"
        role="group"
        aria-label="Final-table set"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted text-xs">Final-table set (stored):</span>
          <select
            aria-label="Players left"
            className={SEL}
            value={players}
            onChange={(e) => setPlayers(Number(e.target.value))}
          >
            {FT_PLAYERS.map((n) => (
              <option key={n} value={n}>
                {n} left
              </option>
            ))}
          </select>
          <select
            aria-label="Average stack"
            className={SEL}
            value={avg}
            onChange={(e) => setAvg(Number(e.target.value))}
          >
            {FT_DEPTHS.map((d) => (
              <option key={d} value={d}>
                {d}bb average
              </option>
            ))}
          </select>
          <select
            aria-label="Stacks"
            className={SEL}
            value={shape}
            onChange={(e) => setShape(e.target.value as FtShape)}
          >
            {[...FT_SHAPES, ...FT_MORE_SHAPES].map((s) => (
              <option key={s} value={s}>
                {FT_SHAPE_WORDS[s]}
              </option>
            ))}
          </select>
          <select
            aria-label="Payout structure (final-table set)"
            className={SEL}
            value={pay}
            onChange={(e) => setPay(e.target.value as FtPay)}
          >
            {FT_PAY_KEYS.map((k) => (
              <option key={k} value={k} title={FT_PAYS[k].about}>
                {k
                  ? `${k} (WSOP Online, as posted on 2026-11-17)`
                  : "Lizard's 9-paid structure"}
              </option>
            ))}
          </select>
          <select
            aria-label="Game (final-table set)"
            className={SEL}
            value={game}
            onChange={(e) => setGame(e.target.value as Game)}
          >
            {GAMES.map((g) => (
              <option key={g} value={g}>
                {GAME_WORDS[g]}
              </option>
            ))}
          </select>
          <Actions st={st} why={why} onSetUp={onSetUp} onOpen={onOpen} />
        </div>
        {st && (
          <p className="text-xs text-muted">
            Stacks{" "}
            {seatsOf(st.players)
              .map((p, i) => `${p} ${st.stacks[i]}`)
              .join(" · ")}
            bb{st.payouts.length > 1 ? `; prizes ${st.payouts.join("/")}` : ""}.{" "}
            {pay ? `${FT_PAYS[pay].about}. ` : ""}
          </p>
        )}
        <p className="text-xs text-muted">
          {FT_COVERAGE}. Also stored: PKO bounties of 2.5 or 5 a head at{" "}
          {BOUNTY_FT.players.join(" and ")} left (
          {BOUNTY_FT.depths.join(" and ")}bb average) and on four stage presets
          ({BOUNTY_SET.length} bounty spots), {SATELLITE_SET.length} satellite
          spots (N equal seats for N+1 or N+2 left), and {CHIP_SET.length} chip
          EV spots; built on the current game: {built(FINAL_TABLE_SET)}{" "}
          final-table, {built(BOUNTY_SET)} bounty, {built(SATELLITE_SET)}{" "}
          satellite and {built(CHIP_SET)} chip EV spots. Preflop only, solved
          once on the calibrated class-level model (approximate; bounties by the
          proportional model); every flop is solved live.
        </p>
      </div>
      <div
        className="flex flex-wrap items-center gap-1.5 text-sm"
        role="group"
        aria-label="Satellite set"
      >
        <span className="text-muted text-xs">Satellite set (stored):</span>
        <select
          aria-label="Players left (satellite)"
          className={SEL}
          value={sp}
          onChange={(e) => {
            const n = Number(e.target.value);
            setSp(n);
            if (![n - 1, n - 2].includes(seatsPaid) || seatsPaid < 2)
              setSeatsPaid(n - 1);
          }}
        >
          {SAT_PLAYERS.map((n) => (
            <option key={n} value={n}>
              {n} left
            </option>
          ))}
        </select>
        <select
          aria-label="Seats paid"
          className={SEL}
          value={seatsPaid}
          onChange={(e) => setSeatsPaid(Number(e.target.value))}
        >
          {satSeats.map((k) => (
            <option key={k} value={k}>
              {k} seats
            </option>
          ))}
        </select>
        <select
          aria-label="Average stack (satellite)"
          className={SEL}
          value={sd}
          onChange={(e) => setSd(Number(e.target.value))}
        >
          {SAT_DEPTHS.map((d) => (
            <option key={d} value={d}>
              {d}bb average
            </option>
          ))}
        </select>
        <select
          aria-label="Stacks (satellite)"
          className={SEL}
          value={ss}
          onChange={(e) => setSs(e.target.value as FtShape)}
        >
          {FT_SHAPES.map((s) => (
            <option key={s} value={s}>
              {FT_SHAPE_WORDS[s]}
            </option>
          ))}
        </select>
        <Actions st={sat} onSetUp={onSetUp} onOpen={onOpen} />
      </div>
    </>
  );
}
