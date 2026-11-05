// The review queue's schedule, a plain spaced repetition on the local calendar: a mistake waits REVIEW_DAYS[step] days
// from the day it was missed or last retried. Best or Correct on a retry takes it one step on, past the last step it's
// finished; any other grade takes it one step back, never below the first. A retry before its day, or of a finished
// one, moves nothing: an answer you've just seen would only teach the date. Missing the spot again in play starts it
// over. Days are calendar days, so a mistake made at night is due the next day from midnight, not 24 hours later, and a
// clock change can't move a date.
import type { MistakeRecord } from "@/data/db";

export const REVIEW_DAYS = [1, 3, 7, 21] as const;
/** the step past the last: nothing more to come */
export const FINISHED = REVIEW_DAYS.length;

export const midnight = (t: number, plus = 0) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + plus).getTime();
};

/** The day (its midnight) a mistake at `step` falls due counted from `t`; null once finished. */
export const dueAfter = (t: number, step: number): number | null => (step >= FINISHED ? null : midnight(t, REVIEW_DAYS[step]));

export const isDue = (m: Pick<MistakeRecord, "due">, now: number) => m.due !== null && m.due <= now;

/** The step after a retry that counts. */
export const stepAfter = (step: number, ok: boolean) => (ok ? Math.min(step + 1, FINISHED) : Math.max(step - 1, 0));

/** The schedule after a retry: moved only where it was due. */
export function afterRetry(m: Pick<MistakeRecord, "step" | "due">, ok: boolean, now: number): { step: number; due: number | null; moved: boolean } {
  if (!isDue(m, now)) return { step: m.step, due: m.due, moved: false };
  const step = stepAfter(m.step, ok);
  return { step, due: dueAfter(now, step), moved: true };
}

const RANK: Record<string, number> = { Blunder: 0, Mistake: 1, Inaccuracy: 2 };

/** The queue: what's due, the longest overdue first, then the worst grade, then the latest missed. */
export const dueQueue = (list: readonly MistakeRecord[], now: number): MistakeRecord[] =>
  list
    .filter((m) => isDue(m, now))
    .sort((a, b) => a.due! - b.due! || (RANK[a.grade.verdict] ?? 3) - (RANK[b.grade.verdict] ?? 3) || b.lastAt - a.lastAt || a.id.localeCompare(b.id));

/** Calendar days from `now` to `t` (a clock change in between doesn't count). */
const daysTo = (t: number, now: number) => Math.round((midnight(t) - midnight(now)) / 86_400_000);

/** When it's due, in words. */
export function dueWords(m: Pick<MistakeRecord, "due">, now: number): string {
  if (m.due === null) return "Finished";
  const d = daysTo(m.due, now);
  if (d < 0) return `Due, ${-d} day${d === -1 ? "" : "s"} overdue`;
  if (d === 0) return m.due <= now ? "Due today" : "Due today, later";
  return d === 1 ? "Due tomorrow" : `Due in ${d} days`;
}

/** The schedule in words, for the page. */
export const SCHEDULE_WORDS = `A mistake comes due ${REVIEW_DAYS[0]} day after you make it. Retried Best or Correct, it waits ${REVIEW_DAYS[1]} days, then ${REVIEW_DAYS[2]}, then ${REVIEW_DAYS[3]}, and after that it's finished. Any other grade takes it back one step, so ${REVIEW_DAYS[0]} day is the shortest wait. Retrying before its day is fine, but it doesn't move the date. Missing the same spot again in play starts it over.`;
