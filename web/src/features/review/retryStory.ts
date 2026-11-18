// A kept mistake's hand up to the decision, in the drills' shape (practice/HandStory): the streets before it a line each,
// and the street you act on with its pot as it began and the price of a call. Read from the Study line the record keeps
// (studyState.ts), replayed through the table engine (poker/table.ts) with each seat's own stack, the ante and the
// straddle, so a call is never more than you have behind and a short all-in is matched only as far as it goes. Null
// where there's no line, where the line and the table part ways, or at a preflop decision in a game of your own (its
// blinds may not be the usual), and Review says the line in words instead. The lines say the action only: the retry
// draws the board's cards just above them.
import type { MistakeRecord } from "@/data/db";
import { kindOf } from "@/components/actions";
import { encodeLine, fromSearch, type StudyHand } from "@/features/study/studyState";
import { preflopWords, type Story, type StoryStep, type StoryStreet } from "@/features/practice/drills";
import { seatLabel, seatsOf } from "@/poker/seats";
import { behind, NEED, noLines, simulate, toCallOf, type Lines, type Move, type MoveKind, type TableSetup } from "@/poker/table";
import type { AdvisorAction } from "@/solver/protocol";

const fmt = (x: number) => String(Math.round(x * 100) / 100);
const r2 = (x: number) => Math.round(x * 100) / 100;
const EPS = 1e-9;
const STREETS = ["preflop", "flop", "turn", "river"] as const;
type St = (typeof STREETS)[number];
const NAME: Record<St, StoryStreet> = { preflop: "Preflop", flop: "Flop", turn: "Turn", river: "River" };

/** The hand's table as the Advisor's replay sees it: a seat's own stack or the table's, the ante, the straddle. */
function tableOf(h: StudyHand): TableSetup {
  const { stacks, ante, straddle } = h.setup ?? {};
  return {
    players: h.players,
    stacks: Object.fromEntries(seatsOf(h.players).map((p) => [p, stacks?.[p] ?? h.stack])),
    ...(ante ? { ante } : {}),
    ...(straddle ? { straddle } : {}),
  };
}

const movesOf = (acts: readonly AdvisorAction[]): Move[] =>
  acts.map((a) => {
    const to = a.to ?? a.amount;
    return { pos: a.pos, action: kindOf(a.action) as MoveKind, ...(to != null ? { to } : {}) };
  });

/** where in a street's line an all-in only calls (it doesn't cover the bet) */
function allInCalls(t: TableSetup, lines: Lines, street: St): Set<number> {
  const out = new Set<number>();
  lines[street].forEach((m, i) => {
    if (m.action !== "all-in") return;
    const sim = simulate(t, { ...lines, [street]: lines[street].slice(0, i) }, NEED[street]);
    if (sim.cur && sim.cur.bets[m.pos]! + behind(t, sim, m.pos) <= sim.cur.curBet + EPS) out.add(i);
  });
  return out;
}

/** a postflop street's action in words: "BB checks, BTN bets 4.13bb, BB calls" */
function streetWords(acts: readonly AdvisorAction[], players: number, calls: ReadonlySet<number>): string {
  return acts
    .map((a, i) => {
      const who = seatLabel(a.pos, players);
      return a.action === "bet"
        ? `${who} bets ${fmt(a.to ?? a.amount ?? 0)}bb`
        : a.action === "raise"
          ? `${who} raises to ${fmt(a.to ?? 0)}bb`
          : a.action === "all-in"
            ? calls.has(i) ? `${who} calls all-in` : `${who} goes all-in`
            : `${who} ${a.action}s`;
    })
    .join(", ");
}

/** the preflop line in words, each seat by its label ("BTN/SB" heads-up) */
const preWords = (acts: readonly AdvisorAction[], players: number, calls: ReadonlySet<number>) =>
  preflopWords(encodeLine(acts.map((a) => ({ ...a, pos: seatLabel(a.pos, players) }))), calls);

export function retryStory(m: Pick<MistakeRecord, "study" | "street" | "seat" | "players">): Story | null {
  const h: StudyHand | null = m.study ? fromSearch(m.study) : null;
  const at = STREETS.indexOf(m.street as St);
  if (!h || at < 0) return null;
  const street = STREETS[at]!;
  if (street === "preflop" && h.setup) return null;

  // the table at your decision: your turn on that street, every bet with its amount
  const t = tableOf(h);
  const lines: Lines = { ...noLines() };
  for (const s of STREETS.slice(0, at + 1)) lines[s] = movesOf(h[s]);
  if (lines[street].some((x) => (x.action === "bet" || x.action === "raise") && !Number.isFinite(x.to))) return null;
  const sim = simulate(t, lines, NEED[street]);
  if (!sim.cur || sim.current !== street || sim.toAct !== m.seat) return null;

  const steps: StoryStep[] = [];
  const pre = preWords(h.preflop, h.players, allInCalls(t, lines, "preflop"));
  if (street !== "preflop" && pre) steps.push({ street: "Preflop", pot: null, text: pre });
  for (const s of (["flop", "turn", "river"] as const).slice(0, Math.max(0, at - 1)))
    steps.push({ street: NAME[s], pot: null, text: streetWords(h[s], h.players, allInCalls(t, lines, s)) || "checked through" });

  // the pot as the street began: everything in from the streets before (and the antes); preflop, the blinds too
  const posted = street === "preflop" ? Object.values(simulate(t, noLines(), 0).cur?.bets ?? {}).reduce((x, y) => x + y, 0) : 0;
  const pot = r2(Object.values(sim.invested).reduce((x, y) => x + y, 0) + posted);
  if (!(pot > 0)) return null;
  const now = street === "preflop" ? preWords(h.preflop, h.players, allInCalls(t, lines, "preflop")) : streetWords(h[street], h.players, allInCalls(t, lines, street));
  return {
    steps,
    now: { street: NAME[street], pot, line: now, hero: seatLabel(m.seat, m.players), toCall: r2(toCallOf(t, sim, m.seat)), behind: null },
  };
}
