import type { Verdict } from "@/grading/grade";

const TONE: Record<Verdict, string> = {
  Best: "bg-accent/20 text-accent",
  Correct: "bg-accent/10 text-accent",
  Inaccuracy: "bg-warn/15 text-warn",
  Mistake: "bg-danger/15 text-danger",
  Blunder: "bg-danger/25 text-danger",
};

/** A decision's grade (src/grading/grade.ts), in its tone. */
export function VerdictTag({ v }: { v: Verdict }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${TONE[v]}`}>{v}</span>;
}
