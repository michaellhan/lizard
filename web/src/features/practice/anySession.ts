// A drill session's score, and what an any-spot drill lends the drill it deals each hand. The any-spot drill deals
// stored flops and turns (DrillsPanel's SpotDrill), live turns and rivers (LiveDrill) and preflop spots graded by the
// stored preflop solve (PreflopDrill), so its session keeps its grades by street and source (`cells`, `sources`): History
// says what graded them, and counts the ones by frequency apart from the ones by EV.
import { addCell, addSource } from "@/features/history/history";
import type { GradeCell } from "@/features/history/history";
import { addScore, emptyScore, type Grade, type Score } from "@/grading/grade";
import type { ResultSource } from "@/solver/types";
import type { Candidate } from "./drills";

export interface DrillSession {
  id: string;
  startedAt: number;
  score: Score;
  /** how many stand on each version of the spot (a decision's grade has its own) */
  versions: Record<string, number>;
  /** picks made after Reveal: none of them is in the score */
  revealed?: number;
  /** the graded decisions by what was dealt: the texture filter's key, and "|" and the hand where one was asked for
   * (dealtFrom; "" for every flop and hand), each with how many were Best or Correct. Lessons count by it. */
  byDeal?: Record<string, { n: number; ok: number }>;
  /** an any-spot session's grades by street and source, and how many each source graded */
  cells?: Record<string, GradeCell>;
  sources?: Partial<Record<ResultSource, number>>;
}

export const newSession = (): DrillSession => ({
  id: `drill-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
  startedAt: Date.now(),
  score: emptyScore(),
  versions: {},
});

/** A grade added to an any-spot session: its score, and its street and source. */
export const addGraded = (s: DrillSession, g: Grade, street: string, source: ResultSource, version?: string): DrillSession => ({
  ...s,
  score: addScore(s.score, g),
  cells: addCell(s.cells, street, source, g, version),
  sources: addSource(s.sources ?? {}, source),
});

/** what an any-spot drill lends the drill it dealt for a hand: its session, the next draw, and the screened flops so far */
export interface Shared {
  session: DrillSession;
  setSession: (f: (s: DrillSession) => DrillSession) => void;
  next: () => void;
  /** the spot drawn has nothing to deal here: draw another */
  skip: () => void;
  screens: Map<string, Candidate[]>;
}
