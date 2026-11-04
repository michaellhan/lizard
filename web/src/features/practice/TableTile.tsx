// One of several tables in Practice (MultiTables.tsx): its number, hand and seat, what it's doing, the board and pot,
// your cards large, a chip for each seat rather than an oval, and at its foot your made hand and last verdict. A tile
// never holds your options: there's one dock, for the table in front, so a press can't land on a table you weren't
// reading. Its state is said in words beside its colour, here and on the phone's tabs, and a verdict always says what
// answered it, on one line, since a phone has no tooltip.
import { PlayingCard } from "@/components/PlayingCard";
import { bb } from "@/components/actions";
import { handName, rank7 } from "@/poker/evaluate";
import { seatLabel, seatsOf } from "@/poker/seats";
import { behind, type Sim } from "@/poker/table";
import { describe as describeProvenance, sourceLabel } from "@/solver/provenance";
import { fmt, signed } from "./PracticeParts";
import { boardShown, needsIndex, phaseOf, potLabel, runEnd, seeking, setupOf, shownCards, simOf, type Decision, type HandResult, type PracticeHand } from "./practice";
import type { RoomTable } from "./room";

/** A hand's end in a line. */
export function resultLine(r: HandResult): string {
  if (r.cut) return "You see the flop";
  const net = `${signed(r.net)}bb`;
  if (r.folded) return r.net ? `You folded ${net}` : "You folded";
  return r.net > 0 ? `You win ${net}` : r.net < 0 ? `You lose ${net}` : "You break even";
}

/** A decision in a line, as a tile's foot and the phone's say it: the verdict's own word, the street, your move, what it
 * gave up, and what answered, `≈` where that's approximate. `title`: the whole of the answer's provenance. */
export function verdictLine(d: Decision): { text: string; title?: string } {
  const g = d.grade;
  if (!g) return { text: `Not graded · ${d.street} · ${d.chose}` };
  const p = d.provenance;
  const source = p ? `${p.approximate ? "≈ " : ""}${describeProvenance(p).split(" · ")[0]}` : sourceLabel("unknown");
  const gave = !g.byEv ? "by frequency" : g.loss > 0.005 ? `−${bb(g.loss)}bb` : "no EV lost";
  return { text: `${g.verdict} · ${d.street} · ${d.chose} · ${gave} · ${source}`, ...(p ? { title: describeProvenance(p) } : {}) };
}

/** What a table is doing, for its tile, its tab and the dock. `place`: its place in the queue, where there is one. */
export interface TableState {
  tone: "wait" | "think" | "seek" | "over" | "fail";
  text: string;
  spin: boolean;
  place: number;
}

export function stateOf(t: RoomTable, i: number, queue: readonly number[]): TableState {
  const { hand: h, failed } = t;
  const ph = phaseOf(h);
  const moving = ph.kind === "villain" || ph.kind === "auto" ? ph : null;
  const state = (tone: TableState["tone"], text: string, spin = false, place = 0): TableState => ({ tone, text, spin, place });
  if (t.spent) return state("fail", t.error ?? "Nothing more to deal.");
  if (failed) return state("fail", moving ? `${seatLabel(moving.seat, h.players)}'s move failed: ${failed}` : `No answer to grade this spot against: ${failed}`);
  if (h.result) return state("over", resultLine(h.result));
  if (needsIndex(h)) return state("seek", "Loading the flop library…", true);
  if (seeking(h)) return state("seek", `Dealing ${potLabel(h.pot!)}…`, true);
  const q = queue.indexOf(i);
  if (q >= 0) return state("wait", "Your turn", false, queue.length > 1 ? q + 1 : 0);
  if (ph.kind === "hero") return state("think", "Solving your spot…", true);
  return state("think", moving ? `${seatLabel(moving.seat, h.players)} is thinking…` : "Dealing…", true);
}

const EDGE: Record<TableState["tone"], string> = {
  wait: "border-warn",
  think: "border-border",
  seek: "border-border opacity-60",
  over: "border-border",
  fail: "border-danger",
};

export const Spinner = () => <span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />;

function SeatChip({ hand, sim, p }: { hand: PracticeHand; sim: Sim; p: string }) {
  const you = p === hand.hero;
  const folded = !sim.active.has(p);
  const cards = you ? null : shownCards(hand, p, sim);
  const bet = sim.cur?.bets[p] ?? 0;
  const won = (runEnd(hand, sim) ?? hand.result)?.pays[p];
  const toAct = !hand.result && sim.toAct === p;
  return (
    <li
      aria-label={`${seatLabel(p, hand.players)}${you ? " (you)" : ""}`}
      aria-current={toAct ? "true" : undefined}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${toAct ? "border-accent" : "border-border"} ${you ? "bg-surface-2" : ""} ${folded ? "opacity-50" : ""}`}
    >
      <span className="font-medium">{seatLabel(p, hand.players)}</span>
      <span className="font-mono text-muted">{fmt(behind(setupOf(hand), sim, p))}</span>
      <span className="font-mono">{won ? <span className="text-accent">won {fmt(won)}</span> : folded ? "folded" : sim.allin.has(p) ? "all-in" : bet > 0 ? `bet ${fmt(bet)}` : ""}</span>
      {cards?.map((c) => <PlayingCard key={c} card={c} size="sm" />)}
    </li>
  );
}

/** `i`: its place, from 0. `front`: it's the table in front (on a phone the only one drawn). */
export function TableTile({ i, t, state, front, onPick, onRetry }: { i: number; t: RoomTable; state: TableState; front: boolean; onPick: () => void; onRetry: () => void }) {
  const h = t.hand;
  const sim = simOf(h);
  const out = h.board.slice(0, h.shown);
  const made = out.length >= 3 && !h.result?.folded ? handName(rank7([...h.hands[h.hero]!, ...out])) : null;
  const decided = h.decisions.at(-1);
  const verdict = decided && verdictLine(decided);
  const charted = !!h.pot && h.shown >= 3;
  return (
    <section
      id={`practice-table-${i}`}
      aria-label={`Table ${i + 1}`}
      aria-current={front ? "true" : undefined}
      onClick={onPick}
      className={`space-y-2 rounded-lg border bg-surface p-2.5 text-sm ${front ? "border-accent ring-2 ring-accent" : EDGE[state.tone]} ${front && state.tone === "seek" ? "opacity-60" : ""} ${front ? "" : "hidden sm:block"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {/* (a click anywhere on the tile picks it: this is the keyboard's way there) */}
        <button type="button" className="font-medium hover:underline">
          Table {i + 1} · #{h.n + 1} · {seatLabel(h.hero, h.players)}
        </button>
        {state.tone !== "fail" && (
          <span className="flex items-center gap-1.5 text-xs">
            {state.spin && <Spinner />}
            {state.text}
            {state.place > 0 && (
              <span title="Your place in the queue" className="rounded-full bg-warn/15 px-1.5 font-mono text-warn">
                {state.place}
              </span>
            )}
          </span>
        )}
      </div>
      {state.tone === "fail" && (
        <p role="alert" className="text-xs text-danger">
          {state.text}{" "}
          <button
            type="button"
            className="underline"
            onClick={(e) => {
              // (not a pick: you may be asking again in passing)
              e.stopPropagation();
              onRetry();
            }}
          >
            Retry
          </button>
        </p>
      )}
      {t.error && !t.spent && (
        <p role="alert" className="text-xs text-danger">
          {t.error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div role="group" aria-label="Board" className="flex gap-1">
          {h.board.map((c, k) => (k < boardShown(h) ? <PlayingCard key={k} card={c} /> : <span key={k} aria-hidden className="inline-block h-11 w-8 rounded border border-dashed border-border" />))}
        </div>
        <span>
          <span className="text-muted">Pot </span>
          <span className="font-mono">{fmt(sim.pot)}bb</span>
        </span>
      </div>
      <div role="group" aria-label="Your cards" className="flex gap-1">
        {h.hands[h.hero]!.map((c) => (
          <PlayingCard key={c} card={c} size="lg" />
        ))}
      </div>
      <ul aria-label="Seats" className="flex flex-wrap gap-1">
        {seatsOf(h.players).map((p) => (
          <SeatChip key={p} hand={h} sim={sim} p={p} />
        ))}
      </ul>
      {(made || verdict || charted) && (
        <div className="space-y-0.5 text-xs">
          {made && <p className="text-muted">{made}</p>}
          {verdict && <p title={verdict.title}>{verdict.text}</p>}
          {charted && <p className="text-muted">≈ {sourceLabel("charts")}: the preflop was played for you, not solved</p>}
        </div>
      )}
    </section>
  );
}
