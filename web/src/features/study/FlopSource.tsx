// Study's flop source (library/singleSize.ts): the library (several sizes a node, the default) or the single-size library
// (one size a node, the flop's chosen per flop by the solver's automatic sizing). The picker, the hook that reads the
// single-size index from the library in use, and the note that says what the single-size library holds for this hand:
// which flops it covers, and this flop's size, or that it doesn't hold the line or the flop (then the node is asked as
// it would be without, and its provenance says what answered).
import { useEffect, useState } from "react";
import { rowKeys } from "@/components/rowKeys";
import { LIBRARY_SOURCES } from "@/config";
import {
  coveredFlops,
  gameSpots,
  gameWords,
  loadSingleSize,
  sameGame,
  sizeWords,
  SS_FORCED,
  SS_GAME,
  ssHandGame,
  ssMatch,
  type SsHand,
  type SsIndex,
} from "@/library/singleSize";
import { useRuntime } from "@/solver/runtime";

export type FlopSourceId = "library" | "ss";

export function FlopSource({
  value,
  onChange,
}: {
  value: FlopSourceId;
  onChange: (v: FlopSourceId) => void;
}) {
  const opts: [FlopSourceId, string, string][] = [
    ["library", "Library", "The library's solves: several bet sizes a node"],
    [
      "ss",
      "Single size",
      "The single-size library: one bet size a node, the flop's chosen for each flop by the solver's automatic sizing",
    ],
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Flop source"
      onKeyDown={rowKeys("radio", (i) => onChange(opts[i]![0]))}
      className="inline-flex rounded-md border border-border bg-surface-2 p-0.5 text-sm"
    >
      {opts.map(([id, label, hint]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          tabIndex={value === id ? 0 : -1}
          title={hint}
          onClick={() => onChange(id)}
          className={`rounded px-2.5 py-1 ${value === id ? "bg-surface-3 text-text" : "text-muted hover:text-text"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Whether the picker belongs on this hand: the single-size library's game (6-max 100bb, with no setup of the hand's own
 * but one of the ante or straddle games it's built for, SS_FORCED). */
export function offersFlopSource(h: SsHand): boolean {
  if (h.players !== SS_GAME.players || h.stack !== SS_GAME.stack) return false;
  const g = ssHandGame(h.setup);
  return (
    !!g &&
    ((!g.ante && !g.straddle) ||
      SS_FORCED.some((f) => sameGame({ ...SS_GAME, ...f }, g)))
  );
}

/** The single-size index of the library in use, read once `on`: undefined while it loads, null where there is none. */
export function useSingleSize(on: boolean): SsIndex | null | undefined {
  const source = useRuntime((s) => s.librarySource);
  const base = (
    LIBRARY_SOURCES.find((s) => s.id === source) ?? LIBRARY_SOURCES[0]
  ).base;
  const [got, setGot] = useState<{ base: string; idx: SsIndex | null } | null>(
    null,
  );
  useEffect(() => {
    if (!on) return;
    let alive = true;
    void loadSingleSize(base).then((idx) => alive && setGot({ base, idx }));
    return () => {
      alive = false;
    };
  }, [on, base]);
  return on && got?.base === base ? got.idx : undefined;
}

const MAX_LISTED = 24;

/** What the single-size library holds for this hand, in a line under the line's controls. */
export function SingleSizeNote({
  hand,
  idx,
}: {
  hand: SsHand;
  idx: SsIndex | null | undefined;
}) {
  const [all, setAll] = useState(false);
  if (idx === undefined)
    return (
      <p className="text-xs text-muted">Reading the single-size library…</p>
    );
  if (idx === null || !idx.spots.length)
    return (
      <p className="text-xs text-muted">
        The single-size library isn't published yet: nodes are asked from the
        library as usual.
      </p>
    );
  const game = ssHandGame(hand.setup) ?? { ante: 0, straddle: false };
  const spots = gameSpots(idx, game);
  const forced = !!(game.ante || game.straddle);
  const words = forced ? gameWords(game, spots[0]?.pf) : "";
  if (forced && !spots.length)
    return (
      <p className="text-xs text-muted">
        The single-size library holds no lines in this game ({words}) yet: nodes
        are asked from the library as usual.
      </p>
    );
  const flops = coveredFlops(idx, game);
  const listed = all ? flops : flops.slice(0, MAX_LISTED);
  const m = ssMatch(idx, hand);
  const what = !m
    ? `It doesn't hold this preflop line (it has ${spots.length} heads-up 6-max 100bb lines${forced ? ` with a ${words}` : ""}): asked from the library as usual.`
    : m.flop === null
      ? `${m.label}: held on the flops below.`
      : m.pct === null
        ? `${m.label}: this flop isn't one of its flops, so this node is asked from the library as usual.`
        : `${m.label}: this flop is held, its one flop bet size ${sizeWords(m.pct, m.spot)} chosen by the solver's automatic sizing; turn and river bets 75%.`;
  return (
    <div
      role="group"
      aria-label="Single-size library"
      className="space-y-1 text-xs text-muted"
    >
      <p>Single-size library: {what}</p>
      {forced && (
        <p>
          In this game ({words}) its ranges entering the flop are Lizard's
          stored preflop solve of the game, not the charts; preflop is
          approximate.
        </p>
      )}
      <p>
        Covers {flops.length} representative flop{flops.length === 1 ? "" : "s"}{" "}
        on every line: <span className="font-mono">{listed.join(" ")}</span>
        {flops.length > MAX_LISTED && (
          <>
            {all ? "" : " …"}{" "}
            <button
              type="button"
              onClick={() => setAll(!all)}
              className="underline hover:text-text"
            >
              {all ? "Fewer" : `All ${flops.length}`}
            </button>
          </>
        )}
      </p>
    </div>
  );
}
