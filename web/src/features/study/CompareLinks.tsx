// "Compare this spot" (ROADMAP Phase 8): the same spot and line with one thing changed, opened on the Compare page.
// A tournament in chip EV; preflop, the charts against the preflop solve (or the solve against the charts); postflop
// (where the rake is taken), a raked pot without rake or an unraked one with 5% capped at 3bb; and the table at
// another stack (seats with a stack of their own keep it).
import { useState } from "react";
import { Link } from "react-router";
import { compareLink } from "@/features/compare/compare";
import { tidySetup, type SpotSetup } from "@/features/solve/setup";
import { chipHand } from "./ChipCompare";
import { withPf, type StudyHand } from "./studyState";

const withSetup = (h: StudyHand, s: SpotSetup): StudyHand => {
  const out = { ...h };
  delete out.setup;
  const t = tidySetup(s);
  return t ? { ...out, setup: t } : out;
};

/** The variants offered for a spot: [what changes, spot B]. */
export function variantsOf(h: StudyHand): [string, StudyHand][] {
  const s = h.setup ?? {};
  if (s.tournament) return [["in chip EV", chipHand(h)]];
  // (a tournament's preflop isn't solved: the solve plays chips)
  if (!h.board) return h.pf === "solver" ? [["against the charts", withPf(h, "charts")]] : [["against the preflop solve", withPf(h, "solver")]];
  return s.rake ? [["without rake", withSetup(h, { ...s, rake: undefined, rakeCap: undefined })]] : [["with 5% rake, capped at 3bb", withSetup(h, { ...s, rake: 5, rakeCap: 3 })]];
}

export function CompareLinks({ hand, min, max }: { hand: StudyHand; min: number; max: number }) {
  const [typed, setTyped] = useState(() => String(hand.stack > 2 * min ? Math.round(hand.stack / 2) : Math.min(max, hand.stack * 2)));
  const n = Number(typed);
  const ok = Number.isFinite(n) && n >= min && n <= max && n !== hand.stack;
  const link = "underline hover:text-text";
  return (
    <nav aria-label="Compare this spot" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
      <span>Compare this spot:</span>
      {variantsOf(hand).map(([label, b]) => (
        <Link key={label} to={compareLink(hand, b)} className={link}>
          {label}
        </Link>
      ))}
      <span className="flex items-center gap-1">
        at
        <input
          aria-label="Another stack"
          type="number"
          inputMode="decimal"
          step="any"
          min={min}
          max={max}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-invalid={!ok}
          className="w-16 rounded border border-border bg-surface px-1.5 py-0.5 text-text"
        />
        bb{" "}
        {ok ? (
          <Link to={compareLink(hand, { ...hand, stack: n })} className={link}>
            compare
          </Link>
        ) : (
          <span title={`Another stack, ${min}–${max}bb`}>(another stack, {min}–{max}bb)</span>
        )}
      </span>
    </nav>
  );
}
