// The presolved final-table set on the Tournaments page: pick the players left, the average stack and the shape of the
// stacks, then set the form up with it or open its stored preflop solve in Study (engine/pf_icm_stored.py
// FINAL_TABLE_SET; tournament.ts finalTableSpot). The coverage is said in full, as it's all there is.
import { useState } from "react";
import { freshHand, toSearch, type StudyHand } from "@/features/study/studyState";
import { seatsOf } from "@/poker/seats";
import { FT_COVERAGE, FT_DEPTHS, FT_PLAYERS, FT_SHAPES, FT_SHAPE_WORDS, finalTableSpot, presetAnte, type FtShape, type StagePreset } from "./tournament";

/** A stored spot opened in Study on its preflop solve: the table's stack the biggest, the seats with fewer chips their own,
 * the preset's ante and prizes, as the Tournaments form sets it up. */
export function storedSpotHand(st: StagePreset): StudyHand {
  const top = Math.max(...st.stacks);
  const own = Object.fromEntries(seatsOf(st.players).flatMap((p, i) => (st.stacks[i] !== top ? [[p, st.stacks[i]!]] : [])));
  const ante = presetAnte(st);
  return {
    ...freshHand(st.players, top),
    setup: {
      ...(Object.keys(own).length ? { stacks: own } : {}),
      ...(ante ? { ante } : {}),
      tournament: { payouts: st.payouts, ...(st.field ? { field: st.field } : {}) },
    },
    pf: "solver",
  };
}

export const storedSpotLink = (st: StagePreset) => `/study?${toSearch(storedSpotHand(st))}`;

const SEL = "rounded-md border border-border bg-surface-2 px-2 py-1 text-sm";

export function FinalTableSet({ onSetUp, onOpen }: { onSetUp: (st: StagePreset) => void; onOpen: (st: StagePreset) => void }) {
  const [players, setPlayers] = useState<number>(6);
  const [avg, setAvg] = useState<number>(20);
  const [shape, setShape] = useState<FtShape>("equal");
  const st = finalTableSpot(players, avg, shape);
  return (
    <div className="space-y-1 text-sm" role="group" aria-label="Final-table set">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted text-xs">Final-table set (stored):</span>
        <select aria-label="Players left" className={SEL} value={players} onChange={(e) => setPlayers(Number(e.target.value))}>
          {FT_PLAYERS.map((n) => (
            <option key={n} value={n}>
              {n} left
            </option>
          ))}
        </select>
        <select aria-label="Average stack" className={SEL} value={avg} onChange={(e) => setAvg(Number(e.target.value))}>
          {FT_DEPTHS.map((d) => (
            <option key={d} value={d}>
              {d}bb average
            </option>
          ))}
        </select>
        <select aria-label="Stacks" className={SEL} value={shape} onChange={(e) => setShape(e.target.value as FtShape)}>
          {FT_SHAPES.map((s) => (
            <option key={s} value={s}>
              {FT_SHAPE_WORDS[s]}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => onSetUp(st)} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2">
          Set up
        </button>
        <button type="button" onClick={() => onOpen(st)} className="rounded border border-accent bg-accent/15 px-2 py-0.5 text-xs hover:bg-accent/25">
          Open its preflop solve
        </button>
      </div>
      <p className="text-xs text-muted">
        Stacks {seatsOf(st.players).map((p, i) => `${p} ${st.stacks[i]}`).join(" · ")}bb. {FT_COVERAGE}. Preflop only, solved once in prize equity (class-level model,
        approximate); every flop is solved live.
      </p>
    </div>
  );
}
