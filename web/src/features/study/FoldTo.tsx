// Study's "fold to" selector: one button per seat the folds can reach (foldTargets.ts). No numbers of the solver's, so no
// provenance of its own: the node it lands on answers under its badge as any other node does.
import { useRef } from "react";
import type { AdvisorResponse } from "@/solver/protocol";
import { describeTarget, foldTargets } from "./foldTargets";
import type { StudyHand } from "./studyState";

export function FoldTo({ hand, res, setHand }: { hand: StudyHand; res: AdvisorResponse | undefined; setHand: (h: StudyHand) => void }) {
  const group = useRef<HTMLDivElement>(null);
  const targets = foldTargets(hand, res);
  if (!targets.length) return null;
  return (
    <div ref={group} role="group" aria-label="Fold to a seat" tabIndex={-1} className="flex flex-wrap items-center gap-1.5 text-sm outline-none">
      <span className="text-muted">Fold to</span>
      {targets.map((t) => {
        const says = describeTarget(t);
        return (
          <button
            key={t.seat}
            type="button"
            aria-label={says}
            title={says}
            onClick={() => {
              setHand(t.hand);
              // (the seat pressed is the actor now and its button goes: the keyboard stays here, not back at the page's top)
              group.current?.focus({ preventScroll: true });
            }}
            className="rounded border border-border px-2 py-0.5 hover:bg-surface-2"
          >
            {t.seat}
          </button>
        );
      })}
    </div>
  );
}
