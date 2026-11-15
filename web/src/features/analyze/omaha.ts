// Omaha hands in Analyze: a four-card pot-limit Omaha history (PokerStars, GGPoker and the other sites the parser reads,
// in its Omaha mode) kept as a PLO hand, apart from Hold'em's, and each street you acted on said as what can grade it.
// Preflop: nothing, PLO preflop isn't solved. A street two players saw with chips behind: a solve you run in Study, from
// ranges you type, opened by a link that carries the spot as it was, the sizes played among the tree's, your cards and
// the street's actions (features/plo/mine.ts grades them there and keeps the grade). Anything else is said ungraded.
import type { PloHandRecord, PloStreetGrade } from "@/data/ploHands";
import { parseHandHistory } from "@/hh/parse";
import type { Lines, Street } from "@/poker/table";
import { spotsFromHistory, type HistoryRead, type HistorySpot } from "@/features/plo/fromHistory";
import { DEFAULT_SPOT, spotToParams, type PloSpot } from "@/features/plo/spot";
import { handNumber, hash, playedOf } from "./analyze";

const r2 = (x: number) => Math.round(x * 100) / 100;
const r1 = (x: number) => Math.round(x * 10) / 10;

/** A history as a PLO hand to keep, or why not in words. */
export function readOmaha(text: string, imp: { name: string; at: number }): PloHandRecord | string {
  const read = spotsFromHistory(text);
  if (typeof read === "string") return read;
  if (!read.acted.length) return "You made no decision in this hand.";
  const h = parseHandHistory(text, { omaha: true });
  const number = handNumber(text);
  const when = playedOf(text);
  return {
    id: `${h.site}|${number || `text:${hash(text)}`}|${h.hole.join("")}`,
    site: h.site,
    number,
    played: when?.played ?? "",
    playedAt: when?.at ?? 0,
    hero: h.hero,
    players: h.players,
    hole: h.hole.join(""),
    board: h.board.join(""),
    text,
    importName: imp.name,
    importedAt: imp.at,
  };
}

/** A street's actions as played, as the solve's tokens (x, f, c, b<to>, r<to>, the street's totals in bb), and the bet
 * and raise sizes they were, in % of the pot as the PLO tree reads a size (a raise's of the pot after the call). */
export function streetLine(lines: Lines, spot: HistorySpot): { act: string[]; bets: number[]; raises: number[]; raiseCount: number } {
  const behind: Record<string, number> = { [spot.seats[0]]: spot.stacks[0], [spot.seats[1]]: spot.stacks[1] };
  const bets: Record<string, number> = { [spot.seats[0]]: 0, [spot.seats[1]]: 0 };
  let cur = 0;
  let raiseCount = 0;
  const act: string[] = [];
  const betPct: number[] = [];
  const raisePct: number[] = [];
  for (const m of lines[spot.street]) {
    const pot = spot.pot + Object.values(bets).reduce((a, b) => a + b, 0);
    const mine = bets[m.pos] ?? 0;
    if (m.action === "fold") act.push("f");
    else if (m.action === "check") act.push("x");
    else if (m.action === "call") {
      act.push("c");
      bets[m.pos] = cur;
    } else {
      const to = m.action === "all-in" ? (behind[m.pos] ?? 0) : (m.to ?? 0);
      if (cur > 0 && to <= cur) {
        act.push("c");
        bets[m.pos] = Math.min(cur, to);
        continue;
      }
      if (cur > 0) {
        raisePct.push(r1(((to - cur) / (pot + cur - mine)) * 100));
        raiseCount++;
        act.push(`r${r2(to)}`);
      } else {
        betPct.push(r1((to / pot) * 100));
        act.push(`b${r2(to)}`);
      }
      bets[m.pos] = to;
      cur = to;
    }
  }
  const uniq = (xs: number[], n: number) => [...new Set(xs)].slice(0, n);
  return { act, bets: uniq(betPct, 3), raises: uniq(raisePct, 2), raiseCount: Math.min(raiseCount, 3) };
}

/** Study's link for a street of a kept PLO hand: the spot as it was, the sizes played among the tree's, your cards, seat
 * and the street's actions, and the hand's id to keep the grade under. The ranges are left for you to type: a history
 * shows one hand, not a range. */
export function studyLinkFor(rec: Pick<PloHandRecord, "id" | "number">, read: HistoryRead, spot: HistorySpot): string {
  const line = streetLine(read.lines, spot);
  const fmt = (xs: number[]) => xs.join(", ");
  const s: PloSpot = {
    ...DEFAULT_SPOT,
    board: spot.board,
    pot: String(spot.pot),
    stacks: [String(spot.stacks[0]), String(spot.stacks[1])],
    sizes: { bets: line.bets.length ? fmt(line.bets) : "75", raises: fmt(line.raises), cap: line.raiseCount, allIn: true },
  };
  const q = spotToParams(s);
  q.set("game", "plo4");
  q.set("hand", read.hole);
  q.set("seat", String(spot.hero));
  q.set("act", line.act.join(","));
  q.set("from", `${rec.number ? `hand #${rec.number}` : "a hand you played"}, the ${spot.street}`);
  q.set("plo", rec.id);
  return `/study?${q.toString()}`;
}

export interface PloStreetRow {
  street: Street;
  /** graded on a solve; to solve (a link to Study); or ungraded, with why */
  status: "graded" | "solve" | "ungraded";
  why?: string;
  link?: string;
  grade?: PloStreetGrade;
}

/** Each street you acted on, with what can grade it. */
export function streetRows(rec: PloHandRecord): PloStreetRow[] {
  const read = spotsFromHistory(rec.text);
  if (typeof read === "string") return [{ street: "preflop", status: "ungraded", why: read }];
  return read.acted.map((street): PloStreetRow => {
    if (street === "preflop") return { street, status: "ungraded", why: "PLO preflop isn't solved." };
    const spot = read.spots.find((s) => s.street === street);
    if (!spot || spot.hero === null) return { street, status: "ungraded", why: read.skipped.find((w) => w.includes(street)) ?? "Not a heads-up street with chips behind: the PLO solver can't answer it." };
    const link = studyLinkFor(rec, read, spot);
    const grade = rec.grades?.[street];
    return grade ? { street, status: "graded", link, grade } : { street, status: "solve", link };
  });
}
