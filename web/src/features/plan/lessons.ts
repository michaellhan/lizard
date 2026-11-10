// Lessons: a short course of Lizard's own, in four units, beside the rule-made plan. Each lesson is one decision of one
// flop-library spot: a report to read across the flops (Reports), a question to answer from it, and a drill of that
// decision (Practice's Drills), answered at once from the stored solves and graded by EV. The lessons ask; every number
// is the library's, shown under its badge on those pages, so nothing here claims what a solve says.
//
// A lesson is done by what's kept, never by a press: LESSON_TARGET decisions drilled at its spot, decision and flops
// (texture filter) with no hand filter, over any drill sessions, counted from each session's `byDeal` (sessions kept
// before 2026-11-10 have none, and a session without it counts only where its filter can't have mattered: never).
import type { SessionRecord } from "@/data/db";
import type { DrillView } from "@/features/practice/drills";
import { TEXTURE_GROUPS, textureKey, type TextureFilter, type TextureKey } from "@/features/practice/texture";

export const LESSON_TARGET = 20;

export interface Lesson {
  id: string;
  unit: string;
  title: string;
  /** the spot and decision, in words */
  idea: string;
  /** what to look for in the report */
  look: string;
  /** a library spot both libraries hold */
  spot: string;
  view: DrillView;
  texture?: TextureFilter;
  /** the report's grouping */
  group: TextureKey;
  /** to ask yourself while drilling */
  check: string;
}

const U1 = "Single-raised pots in position";
const U2 = "Defending the big blind";
const U3 = "Seats and ranges";
const U4 = "3-bet pots";

export const LESSONS: readonly Lesson[] = [
  {
    id: "btn-bet",
    unit: U1,
    title: "The button's flop bet after a check",
    idea: "BTN opened, BB called, and BB checks the flop to the button.",
    look: "Group the report by high card. On which high cards does the button bet most often, and on which does it check most? Does the size it prefers change with them?",
    spot: "srp_btn_bb",
    view: "ip",
    group: "hi",
    check: "Before you answer, say which range the flop suits better, then check it against the answer.",
  },
  {
    id: "btn-paired",
    unit: U1,
    title: "Paired flops",
    idea: "BTN opened, BB called and checks to the button, on paired flops only.",
    look: "Group the report by pairing. How do the button's bet frequency and size on paired flops compare with unpaired ones?",
    spot: "srp_btn_bb",
    view: "ip",
    texture: { pair: "paired" },
    group: "pair",
    check: "Which of your hands bet and which check here? Notice where a hand with nothing still bets.",
  },
  {
    id: "btn-mono",
    unit: U1,
    title: "Monotone flops",
    idea: "BTN opened, BB called and checks to the button, on flops of one suit.",
    look: "Group the report by suits. What happens to the button's bet frequency and size when all three cards share a suit?",
    spot: "srp_btn_bb",
    view: "ip",
    texture: { suits: "mono" },
    group: "suits",
    check: "Does holding a card of the flop's suit change what your hand does?",
  },
  {
    id: "bb-facing",
    unit: U2,
    title: "Facing the button's bet",
    idea: "BTN opened, BB called; BB checks and the button bets.",
    look: "Group the report by connectedness. Where does the big blind fold most, and where does it raise most?",
    spot: "srp_btn_bb",
    view: "vsbet",
    group: "conn",
    check: "Price it first: what share of the pot must you put in to call, and does your hand win that often with what's to come?",
  },
  {
    id: "bb-low",
    unit: U2,
    title: "Low flops against a bet",
    idea: "BTN opened, BB called; BB checks and the button bets, on flops with no card above a nine.",
    look: "Group the report by high card. How does the big blind's defence on 9-high or lower flops compare with ace-high ones?",
    spot: "srp_btn_bb",
    view: "vsbet",
    texture: { hi: "9-" },
    group: "hi",
    check: "Which of your hands raise here, and which call? Look at the draws.",
  },
  {
    id: "bb-first",
    unit: U2,
    title: "First to act as the caller",
    idea: "BTN opened, BB called, and the big blind acts first on the flop.",
    look: "Group the report by high card. Does the big blind ever bet first into the raiser here, and on which flops most?",
    spot: "srp_btn_bb",
    view: "oop",
    group: "hi",
    check: "When the answer checks a strong hand, ask what it expects the button to do next.",
  },
  {
    id: "sb-first",
    unit: U3,
    title: "The raiser out of position",
    idea: "SB opened, BB called, and the small blind, the raiser, acts first on the flop.",
    look: "Group the report by high card. Compare the small blind's betting here with the button's in lesson 1: what changes when the raiser acts first?",
    spot: "srp_sb_bb",
    view: "oop",
    group: "hi",
    check: "Which hands that bet in position check here instead?",
  },
  {
    id: "utg-bet",
    unit: U3,
    title: "An early open's flop bet",
    idea: "UTG opened, BB called, and BB checks to UTG.",
    look: "Group the report by high card and compare it with lesson 1's: how does the earliest seat's bet differ from the button's, and on which flops most?",
    spot: "srp_utg_bb",
    view: "ip",
    group: "hi",
    check: "Think of the hands UTG opens and the button would too: which ones does the flop help?",
  },
  {
    id: "utg-btn",
    unit: U3,
    title: "Out of position against a caller on the button",
    idea: "UTG opened, BTN called, and UTG acts first on the flop.",
    look: "Group the report by connectedness. How often does UTG bet first here, and on which flops does it check most?",
    spot: "srp_utg_btn",
    view: "oop",
    group: "conn",
    check: "The button called an early open: which of its hands are left, and which flops suit them?",
  },
  {
    id: "bb-3bet",
    unit: U4,
    title: "The 3-bettor first to act",
    idea: "BTN opened, BB 3-bet, BTN called, and the big blind acts first on the flop.",
    look: "Group the report by high card. How often does the 3-bettor bet first, and which size does it use on which flops?",
    spot: "3bp_bb_btn",
    view: "oop",
    group: "hi",
    check: "The stacks are shorter against this bigger pot: notice which hands are glad to get all the chips in."
  },
  {
    id: "btn-vs-3bet",
    unit: U4,
    title: "Facing the 3-bettor's flop bet",
    idea: "BTN opened, BB 3-bet, BTN called; BB bets the flop into the button.",
    look: "Group the report by connectedness. Where does the button fold most to the bet, and where does it raise?",
    spot: "3bp_bb_btn",
    view: "ipvsbet",
    group: "conn",
    check: "Price the call, then ask what your hand does on the turn if you call.",
  },
  {
    id: "btn-3bet-ip",
    unit: U4,
    title: "The 3-bettor in position",
    idea: "CO opened, BTN 3-bet, CO called and checks the flop to the button.",
    look: "Group the report by high card and compare it with lesson 10's: what changes when the 3-bettor acts last?",
    spot: "3bp_btn_co",
    view: "ip",
    group: "hi",
    check: "Which hands check behind here, and why might they?",
  },
];

const params = (o: Record<string, string>, texture: TextureFilter = {}) => {
  const q = new URLSearchParams(o);
  for (const g of TEXTURE_GROUPS) if (texture[g.key]) q.set(g.key, texture[g.key]!);
  return q.toString();
};

/** The drill that is the lesson, as Practice's Drills tab takes it. */
export const lessonDrill = (l: Lesson): string => `/practice?${params({ tab: "drills", spot: l.spot, view: l.view }, l.texture)}`;

/** The report to read, grouped as the lesson asks, over the lesson's flops but for the group it compares (a lesson on
 * monotone flops reads every suit's row, to set them side by side). */
export const lessonReport = (l: Lesson): string => {
  const rest: TextureFilter = { ...l.texture };
  delete rest[l.group];
  return `/reports?${params({ spot: l.spot, view: l.view, group: l.group }, rest)}`;
};

export interface LessonProgress {
  /** decisions drilled in it, and how many were Best or Correct */
  n: number;
  ok: number;
  done: boolean;
}

/** A lesson's decisions drilled, over every drill session kept: its spot, its decision on the flop, dealt from exactly its
 * flops and with no hand asked for. */
export function lessonProgress(l: Lesson, sessions: readonly SessionRecord[]): LessonProgress {
  const key = textureKey(l.texture ?? {});
  let n = 0;
  let ok = 0;
  for (const s of sessions) {
    const m = s.meta ?? {};
    if (s.kind !== "drill" || m.spot !== l.spot || m.view !== l.view || (m.street ?? "flop") !== "flop") continue;
    const c = (m.byDeal as Record<string, { n: number; ok: number }> | undefined)?.[key];
    if (!c) continue;
    n += c.n;
    ok += c.ok;
  }
  return { n, ok, done: n >= LESSON_TARGET };
}

/** Every lesson's progress, and the first one not done (null when all are). */
export function course(sessions: readonly SessionRecord[]): { progress: Record<string, LessonProgress>; next: Lesson | null; done: number } {
  const progress = Object.fromEntries(LESSONS.map((l) => [l.id, lessonProgress(l, sessions)]));
  const next = LESSONS.find((l) => !progress[l.id]!.done) ?? null;
  return { progress, next, done: LESSONS.filter((l) => progress[l.id]!.done).length };
}
