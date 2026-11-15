// Where the line stands, for the Line bar: the board as cards, and the line a street a row (Preflop's actions, then each
// street's cards heading its own), every step a button to that node, the node shown ringed and what's ahead dashed.
import { PlayingCard } from "@/components/PlayingCard";
import { parseCards } from "@/engine/nlhe/cards";
import { STREETS, type LineStep, type StudyHand } from "./studyState";

const STREET_NAME = { preflop: "Preflop", flop: "Flop", turn: "Turn", river: "River" } as const;

const chip = (at: LineStep["at"]) =>
  `rounded px-2 py-0.5 ${at === "ahead" ? "border border-dashed border-border text-muted hover:text-text" : `bg-surface-2 hover:bg-surface-3 ${at === "here" ? "ring-1 ring-accent" : ""}`}`;

/** The board of the node shown, five places, those not dealt yet an outline. Nothing before the flop. */
export function LineBoard({ board }: { board: string }) {
  const cards = parseCards(board) ?? [];
  if (!cards.length) return null;
  return (
    <div role="group" aria-label="Board" className="flex shrink-0 items-center gap-1">
      {[0, 1, 2, 3, 4].map((i) =>
        cards[i] ? (
          <span key={i} className={i === 3 || (i === 4 && cards.length > 4) ? "ml-1" : ""}>
            <PlayingCard card={cards[i]!} />
          </span>
        ) : (
          <span key={i} aria-hidden className={`inline-block h-11 w-8 rounded border border-dashed border-border ${i === 3 ? "ml-1" : ""}`} />
        ),
      )}
    </div>
  );
}

/** The line's steps a street a row; `toAct`, the seat to act at the node shown, said after its step when nothing is
 * ahead of it on its street (once the answer is in). */
export function LineRows({ steps, setHand, toAct }: { steps: LineStep[]; setHand: (h: StudyHand) => void; toAct?: string }) {
  const here = steps.findIndex((s) => s.at === "here");
  const hereStreet = here < 0 ? "preflop" : steps[here]!.street;
  const said = toAct && !steps.some((s, i) => i > here && s.street === hereStreet && !s.cards) ? toAct : null;
  const rows = STREETS.map((street) => ({ street, steps: steps.filter((s) => s.street === street) })).filter((r) => r.street === "preflop" || r.steps.length);
  return (
    <ol className="min-w-0 flex-[1_1_22rem] space-y-1">
      {rows.map(({ street, steps: row }) => {
        const deal = row.find((s) => s.cards);
        const acts = row.filter((s) => !s.cards);
        return (
          <li key={street} aria-label={STREET_NAME[street]} className="flex flex-wrap items-center gap-1.5">
            {deal ? (
              <button type="button" aria-current={deal.at === "here" ? "step" : undefined} onClick={() => setHand(deal.hand)} className={`inline-flex w-32 shrink-0 items-center gap-1.5 ${chip(deal.at)}`}>
                <span className="text-xs text-muted">{STREET_NAME[street]}</span>{" "}
                <span className="inline-flex gap-0.5">
                  {(parseCards(deal.cards!) ?? []).map((c) => (
                    <PlayingCard key={c} card={c} size="xs" />
                  ))}
                </span>
              </button>
            ) : (
              <span className="w-32 shrink-0 px-2 text-xs text-muted">{STREET_NAME[street]}</span>
            )}
            {acts.map((s, i) => (
              <button key={i} type="button" aria-current={s.at === "here" ? "step" : undefined} title={s.detail} onClick={() => setHand(s.hand)} className={`font-mono ${chip(s.at)}`}>
                {s.label}
              </button>
            ))}
            {street === hereStreet && said ? (
              <span className="text-xs text-muted">
                <span aria-hidden>→ </span>
                {said} to act
              </span>
            ) : (
              street === "preflop" && !acts.length && <span className="text-xs text-muted">the start of the hand</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
