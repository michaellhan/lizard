// Study for Pot-Limit Omaha (registry: PLO4): a heads-up flop, turn or river from ranges you give, solved in the browser
// by the PLO solver (engine/plo/), its spot in the link (`/study?game=plo4&board=…`) so it opens as it was. Loaded with
// its own chunk only when the link names PLO. What Study does for Hold'em and not for PLO is listed, not drawn.
import { useState } from "react";
import { useSearchParams } from "react-router";
import { GamePicker, NotForGame } from "@/components/GamePicker";
import { PLO4 } from "@/engine/registry";
import { PloSolver } from "@/features/plo/PloRiverPage";
import { PLO_PRESETS } from "@/features/plo/presets";
import { DEFAULT_SPOT, spotFromParams, spotToParams, type PloSpot } from "@/features/plo/spot";
import { mineFromParams } from "@/features/plo/mine";
import { MyHand } from "@/features/plo/MyHand";

const inputClass = "w-full min-w-0 rounded border border-border bg-surface px-2 py-1 text-sm";

/** A spot's link query, with the game and anything of the hand's (Analyze's `hand`, `seat`, `line`) kept. */
function linkOf(spot: PloSpot, keep: URLSearchParams): string {
  const q = spotToParams(spot);
  q.set("game", "plo4");
  for (const k of ["hand", "seat", "act", "from", "plo"]) {
    const v = keep.get(k);
    if (v !== null) q.set(k, v);
  }
  return q.toString();
}

export function PloStudy() {
  const [params, setParams] = useSearchParams();
  const search = params.toString();
  const spot = spotFromParams(params) ?? DEFAULT_SPOT;
  const mine = mineFromParams(params);
  // the solver starts afresh on a spot from outside (a preset, a link, Back), not on its own solve writing the link
  const [own, setOwn] = useState(search);
  const [seen, setSeen] = useState(search);
  const [gen, setGen] = useState(0);
  if (search !== seen) {
    setSeen(search);
    if (search !== own) setGen((g) => g + 1);
  }
  const [ranges, setRanges] = useState<[string, string] | undefined>(undefined);
  const preset = PLO_PRESETS.find((p) => spotToParams(p.spot).toString() === spotToParams(spot).toString())?.id ?? "";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Study</h1>
        <GamePicker page="study" current="plo4" />
      </div>
      <p className="text-sm text-muted">
        {PLO4.name}: {PLO4.solverScope}. The ranges are yours, not a solution; every number under the badge is this solve&apos;s.
      </p>
      <label className="block max-w-xl space-y-1 text-sm">
        <span className="text-muted">Spot</span>
        <select
          aria-label="PLO spot"
          value={preset}
          onChange={(e) => {
            const p = PLO_PRESETS.find((x) => x.id === e.target.value);
            if (p) setParams(linkOf(p.spot, new URLSearchParams()));
          }}
          className={inputClass}
        >
          <option value="">Your own</option>
          {PLO_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <NotForGame page="study" name="PLO" missing={PLO4.pages.study ?? []} />
      {mine && (
        <p role="note" className="text-sm">
          From a hand you played: board, pot, stacks and the sizes played are filled. Type both ranges (yours, {mine.seat === 0 ? "OOP" : "IP"}, must hold <span className="font-mono">{mine.hand}</span>), then solve to grade your line. A history shows one hand, not a range.
        </p>
      )}
      <PloSolver
        key={gen}
        initial={spot}
        autoSolve={!mine}
        fromHistory={!mine}
        onSolve={(s) => {
          setRanges([s.oop, s.ip]);
          const next = linkOf(s, params);
          setOwn(next);
          setParams(next, { replace: true });
        }}
        extra={mine ? (result, band) => <MyHand mine={mine} result={result} band={band} ranges={ranges} /> : undefined}
      />
    </div>
  );
}
