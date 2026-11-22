// "Review in Analyze": a finished hand's history, as the server wrote it from your seat, kept in Analyze the way Practice
// keeps its hands (features/practice/history.ts practiceRecord): read by the hand-history importer, kept under the
// arena's own site, then graded there by the solver like any imported hand. Only ever after the hand is over: nothing in
// "Play a friend" consults a solver while a hand is being played (IMPLEMENTATION_PLAN.md §0).
import { addHands } from "@/data/hands";
import { recordOf } from "@/features/analyze/analyze";
import { importHand } from "@/hh/replay";
import { ARENA_SITE } from "./protocol";

export type Kept = { id: string; had: boolean } | { error: string };

const day = (at: number) => new Date(at).toISOString().slice(0, 10);

/** Keeps the hand in Analyze: its id there (and whether it was kept already), or why it can't be. */
export async function keepForReview(history: string, at: number = Date.now()): Promise<Kept> {
  let rec;
  try {
    const r = importHand(history);
    if (r.stopped) return { error: "the history didn't replay as the table played it" };
    rec = recordOf(history, r, { id: `arena-${day(at)}`, name: `Play a friend, ${day(at)}`, at });
  } catch (e) {
    return { error: `the history couldn't be read (${e instanceof Error ? e.message : String(e)})` };
  }
  if (!rec.decisions) return { error: "you made no decision in this hand (it was folded to you before you acted)" };
  const kept = { ...rec, id: `${ARENA_SITE}|${rec.number}|${rec.hole}`, site: ARENA_SITE, bb: "1bb" };
  const res = await addHands([kept]);
  if (!res) return { error: "this browser keeps nothing (a private window, or storage turned off)" };
  return { id: kept.id, had: res.added === 0 };
}

/** Where Analyze opens a kept hand. */
export const analyzeLink = (id: string) => `/analyze?hand=${encodeURIComponent(id)}`;
