// A hand played in Practice written as a hand history, so Analyze keeps it as it keeps an imported hand (the
// classic page keeps each table hand in My hands, hands.js). The layout is PokerStars' under Lizard's own header
// (the parser reads it as a site it doesn't name: "generic"); the record is marked as Practice's. The seats are named
// by position and you are "You"; every seat has a "Dealt to" line, so the seats still to act when you folded are
// dealt in. Only what the table showed is written: the board as far as it was dealt, an opponent's cards where it
// reached a showdown, who collected what (nothing after your fold unless the others ran it out, or after the preflop
// in a preflop-only hand: the hand isn't played out).
import type { HandRecord } from "@/data/db";
import { PRACTICE_SITE } from "@/data/hands";
import { recordOf } from "@/features/analyze/analyze";
import { importHand } from "@/hh/replay";
import { seatsOf } from "@/poker/seats";
import { noLines, simulate, withMove, NEED, STREETS, type Move, type Sim, type Street, type TableSetup } from "@/poker/table";
import { runEnd, setupOf, shownCards, type PracticeHand } from "./practice";

export { PRACTICE_SITE };
/** your name in the history */
export const YOU = "You";

const EPS = 1e-9;
const amt = (x: number) => String(Math.round(x * 100) / 100);
const two = (x: number) => String(x).padStart(2, "0");
const stamp = (d: Date) =>
  `${d.getFullYear()}/${two(d.getMonth() + 1)}/${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;

/** The hand's number: the session's start and the hand's place in it ("L1793700000000-4"). */
export const practiceNumber = (h: Pick<PracticeHand, "n">, startedAt: number) => `L${startedAt}-${h.n + 1}`;

/** One move as a history writes it: what a call or bet adds, a raise's size and total, "and is all-in". */
function moveText(m: Move, sim: Sim, street: Street, stack: number): string {
  const info = sim.streets[street]!;
  const mine = info.bets[m.pos] ?? 0;
  // (the street total that puts every chip in)
  const cap = stack - (sim.invested[m.pos] ?? 0);
  const all = (to: number) => (to >= cap - EPS ? " and is all-in" : "");
  if (m.action === "fold") return "folds";
  if (m.action === "check") return "checks";
  const to = m.action === "all-in" ? cap : m.action === "call" ? Math.min(info.curBet, cap) : m.to!;
  if (m.action === "call" || to <= info.curBet + EPS) return `calls ${amt(to - mine)}${all(to)}`;
  if (info.curBet <= EPS) return `bets ${amt(to)}${all(to)}`;
  return `raises ${amt(to - info.curBet)} to ${amt(to)}${all(to)}`;
}

/** The finished hand (its `result` set) as a hand history. `at`: when it was played. */
export function practiceHistory(h: PracticeHand, startedAt: number, at: Date): string {
  return handHistory(h, { site: PRACTICE_SITE, number: practiceNumber(h, startedAt), at });
}

/** A hand written as Practice's are, under another site's header (the classic app's hands, features/analyze/classic.ts):
 * `setup` gives each seat's stack, and the ante and straddle posted (Practice's own). Without a `result` nothing is
 * settled. */
export function handHistory(h: PracticeHand, head: { site: string; number: string; at: Date }, t: TableSetup = setupOf(h)): string {
  const pos = seatsOf(h.players);
  const name = (p: string) => (p === h.hero ? YOU : p);
  const button = h.players === 2 ? "SB" : "BTN";
  const out = [
    `${head.site} Hand #${head.number}: Hold'em No Limit (0.5/1) - ${stamp(head.at)}`,
    `Table '${head.site}' ${h.players}-max Seat #${pos.indexOf(button) + 1} is the button`,
    ...pos.map((p, i) => `Seat ${i + 1}: ${name(p)} (${amt(t.stacks[p] ?? h.stack)} in chips)`),
    ...(t.ante ? pos.map((p) => `${name(p)}: posts the ante ${amt(Math.min(t.ante!, t.stacks[p] ?? h.stack))}`) : []),
    `${name("SB")}: posts small blind 0.5`,
    `${name("BB")}: posts big blind 1`,
    ...(t.straddle && h.players >= 3 ? [`${name(pos[0]!)}: posts straddle 2`] : []),
    "*** HOLE CARDS ***",
    ...pos.map((p) => (p === h.hero ? `Dealt to ${YOU} [${h.hands[p]!.join(" ")}]` : `Dealt to ${p}`)),
  ];
  const board = h.board.slice(0, h.shown);
  let lines = noLines();
  for (const s of STREETS) {
    if (h.shown < NEED[s]) break;
    if (s === "flop") out.push(`*** FLOP *** [${board.slice(0, 3).join(" ")}]`);
    if (s === "turn") out.push(`*** TURN *** [${board.slice(0, 3).join(" ")}] [${board[3]}]`);
    if (s === "river") out.push(`*** RIVER *** [${board.slice(0, 4).join(" ")}] [${board[4]}]`);
    for (const m of h.lines[s]) {
      out.push(`${name(m.pos)}: ${moveText(m, simulate(t, lines, NEED[s]), s, t.stacks[m.pos]!)}`);
      lines = withMove(lines, s, m);
    }
    // (the bet nobody matched, back to its bettor as the street closes: the table leaves it out of the pot)
    const back = simulate(t, lines, h.shown).streets[s]?.returned;
    for (const [p, x] of Object.entries(back ?? {})) out.push(`Uncalled bet (${amt(x)}) returned to ${name(p)}`);
  }
  const sim = simulate(t, h.lines, h.shown);
  const res = h.result;
  // (after your fold, a run-out played to its end is settled as it went)
  const run = h.run === "played" ? runEnd(h, sim) : null;
  const end = res && !res.folded && !res.cut ? res : run;
  if (end) {
    const shows = pos.filter((p) => sim.active.has(p) && sim.active.size > 1 && shownCards(h, p, sim));
    if (shows.length) out.push("*** SHOW DOWN ***", ...shows.map((p) => `${name(p)}: shows [${h.hands[p]!.join(" ")}]`));
    for (const p of pos) if ((end.pays[p] ?? 0) > EPS) out.push(`${name(p)} collected ${amt(end.pays[p]!)} from pot`);
  }
  out.push("*** SUMMARY ***");
  if (end) out.push(`Total pot ${amt(Object.values(end.pays).reduce((a, b) => a + b, 0) + (end.rake ?? 0))} | Rake ${amt(end.rake ?? 0)}`);
  if (board.length) out.push(`Board [${board.join(" ")}]`);
  if (res?.folded) out.push(run ? `${YOU} folded: the others played the rest of the hand by their strategies.` : `${YOU} folded: the rest of the hand wasn't played.`);
  if (res?.cut) out.push("Preflop only: the hand stopped as the preflop closed.");
  return out.join("\n") + "\n";
}

/** The finished hand as Analyze keeps it: under Practice's site, kept with the session's other hands. */
export function practiceRecord(h: PracticeHand, session: { id: string; startedAt: number }, at: Date): HandRecord {
  const text = practiceHistory(h, session.startedAt, at);
  const r = recordOf(text, importHand(text), {
    id: `practice:${session.id}`,
    name: `Practice, ${new Date(session.startedAt).toLocaleString()}`,
    at: at.getTime(),
  });
  return { ...r, id: `${PRACTICE_SITE}|${r.number}|${r.hole}`, site: PRACTICE_SITE, bb: "1bb", ...(h.result?.cut ? { end: "preflop only" } : {}) };
}
