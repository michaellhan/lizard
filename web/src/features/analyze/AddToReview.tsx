// "Add to review": one graded decision kept for the review queue, by your press (schedule.ts QUEUE_RULE). Nothing is
// solved: the entry keeps the mix it was graded against.
import { useState } from "react";
import { Link } from "react-router";
import type { DecisionRecord, HandRecord } from "@/data/db";
import { addMistake } from "@/data/mistakes";
import { addedMistake, decisionOut } from "@/features/review/fromAnalyze";
import { dueWords } from "@/features/review/schedule";
import type { ReplayedHand } from "@/hh/replay";

type Kept = { st: "added"; due: string } | { st: "there" } | { st: "none" };

/** `name`: which decision, for a screen reader. A decision it can't keep says why. */
export function AddToReview({ d, hand, r, name }: { d: DecisionRecord; hand: HandRecord; r: ReplayedHand; name: string }) {
  const [kept, setKept] = useState<Kept | null>(null);
  const out = decisionOut(d);
  if (out) return <span className="text-xs text-muted">Not for Review: {out}</span>;
  if (kept?.st === "none") return <span role="alert" className="text-xs text-danger">Not added: this browser isn&rsquo;t keeping anything here (a private window?)</span>;
  if (kept)
    return (
      <span role="status" className="text-xs text-muted">
        {kept.st === "added" ? `Added, ${kept.due}: ` : "Already kept: "}
        <Link to="/review" className="underline">
          Review
        </Link>
      </span>
    );
  const add = () => {
    const now = Date.now();
    const m = addedMistake(d, hand, r, now);
    if (!m) return setKept({ st: "none" });
    addMistake(m).then(
      (st) => setKept(st === "added" ? { st, due: dueWords(m, now).toLowerCase() } : st === "there" ? { st } : { st: "none" }),
      () => setKept({ st: "none" }),
    );
  };
  return (
    <button type="button" aria-label={`Add to review: ${name}`} onClick={add} className="rounded border border-border px-1.5 text-xs hover:bg-surface-2">
      Add to review
    </button>
  );
}
