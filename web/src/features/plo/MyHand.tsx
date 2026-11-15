// "Your hand" under a PLO solve opened from a hand you played (mine.ts): each action of the street as played, yours graded
// against this solve for your combo, under the solve's provenance like every other number on the page.
import { useEffect, useState } from "react";
import { putPloGrade } from "@/data/ploHands";
import type { Verdict } from "@/grading/grade";
import { SEAT_NAMES, type RiverResult } from "@/engine/plo/river/run";
import { VerdictTag } from "@/components/VerdictTag";
import { mixAt } from "./drill";
import { walkMine, type Mine } from "./mine";

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const chips = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "–");

export function MyHand({ mine, result, band, ranges }: { mine: Mine; result: RiverResult; band: string | undefined; ranges?: [string, string] }) {
  const walk = walkMine(result, mine, band);
  const me = SEAT_NAMES[mine.seat];
  // a hand kept in Analyze keeps this street's grade, with what graded it
  const [kept, setKept] = useState(false);
  const graded = walk.steps.flatMap((s) => (s.grade ? [s.grade] : []));
  const verdicts = graded.map((g) => g.verdict).join(",");
  const loss = graded.reduce((t, g) => t + g.loss, 0);
  useEffect(() => {
    if (!mine.plo || !verdicts) return;
    let alive = true;
    void putPloGrade(mine.plo, result.street, {
      verdicts: verdicts.split(",") as Verdict[],
      loss: Math.round(loss * 1000) / 1000,
      exploitabilityPct: result.exploitability.pct,
      ...(band ? { band } : {}),
      ranges: ranges ?? ["", ""],
    }).then((ok) => alive && setKept(ok));
    return () => {
      alive = false;
    };
  }, [mine.plo, verdicts, loss, result, band, ranges]);
  return (
    <section aria-label="Your hand" className="space-y-2 rounded border border-border p-3 text-sm">
      <h2 className="font-semibold">Your hand</h2>
      <p>
        You were {me} with <span className="font-mono">{mine.hand}</span>
        {mine.from ? `, ${mine.from}` : ""}. Graded against this solve, from the ranges typed above.
      </p>
      {walk.combo === null && <p>Your hand isn&apos;t in the {me} range typed, so nothing is graded: add it to the range.</p>}
      {!mine.act.length && <p className="text-muted">No action of yours on this street was passed in.</p>}
      {walk.steps.length > 0 && (
        <ol aria-label="Your line" className="space-y-1">
          {walk.steps.map((s) => {
            const yours = s.node.player === mine.seat;
            const label = s.node.actions[s.taken]!.label;
            if (!yours)
              return (
                <li key={s.node.id} className="text-muted">
                  {SEAT_NAMES[s.node.player]}: {label}
                </li>
              );
            const mix = walk.combo !== null ? mixAt(s.node, walk.combo) : null;
            return (
              <li key={s.node.id} className="space-y-0.5">
                <span className="block">
                  You: {label}{" "}
                  {s.grade ? (
                    <>
                      <VerdictTag v={s.grade.verdict} />
                      {s.grade.loss > 0 ? ` ${chips(s.grade.loss)}bb given up, ${s.grade.lossPct.toFixed(1)}% of the pot` : ""}
                      {s.grade.capped ? " (capped: the solve is short of converged)" : ""}
                    </>
                  ) : (
                    <span className="text-muted">ungraded: {s.why}</span>
                  )}
                </span>
                {s.grade && mix && (
                  <span className="block text-xs text-muted">
                    The solve, for your hand: {s.node.actions.map((a, k) => `${a.label} ${pct(mix[k]!.freq)} (EV ${chips(mix[k]!.ev)})`).join(", ")}.
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {walk.stop && <p role="note">{walk.stop}</p>}
      {kept && <p className="text-xs text-muted">Kept with the hand in Analyze (PLO), with this solve&apos;s exploitability.</p>}
    </section>
  );
}
