// A retry's grade beside the first: like with like, or why they aren't set side by side.
import { VerdictTag } from "@/components/VerdictTag";
import type { MistakeRecord } from "@/data/db";
import { CAPPED_WORDS } from "@/grading/grade";
import { describe as describeProvenance, evUnit } from "@/solver/provenance";
import { costWords, type Retried } from "./mistakes";

/** The first grade beside this one, like with like; or why they aren't set side by side. */
export function Compare({ m, r }: { m: Pick<MistakeRecord, "provenance" | "mix" | "chose"> & Partial<Pick<MistakeRecord, "ask">> & { grade: Pick<MistakeRecord["grade"], "verdict" | "byEv" | "loss" | "lossPct" | "a" | "best" | "capped"> }; r: Retried }) {
  const firstSource = m.provenance?.source;
  const nowSource = r.decision.provenance?.source;
  if (!r.change.length)
    return (
      <>
        <p>
          First: <VerdictTag v={m.grade.verdict} /> {costWords(m.grade, m.mix, firstSource, evUnit(m.provenance))}. This time: <VerdictTag v={r.grade.verdict} /> {costWords(r.grade, r.decision.mix, nowSource, evUnit(r.decision.provenance))}. {m.ask?.via === "kept" ? "The same answer both times." : "Same kind of answer both times."}
        </p>
        {m.grade.capped && <p className="text-muted">Your first grade: {CAPPED_WORDS}</p>}
      </>
    );
  return (
    <div className="space-y-1 rounded border border-warn/60 p-2">
      <p className="font-medium text-warn">The answer has changed, so these two grades aren&rsquo;t compared</p>
      <ul className="list-disc pl-4">
        {r.change.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <p className="text-muted">
        Your first grade, {m.grade.verdict}, stood on {m.provenance ? describeProvenance(m.provenance) : "an answer not kept"}. {m.grade.capped ? `${CAPPED_WORDS} ` : ""}This one stands on the answer named below.
        {r.first && m.chose !== r.decision.chose ? ` Under this answer your first pick, ${m.chose}, grades ${r.first.verdict}.` : ""}
        {!r.first ? ` Your first pick, ${m.chose}, isn't an option in this answer.` : ""}
      </p>
    </div>
  );
}
