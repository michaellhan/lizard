// A kept mistake's hand up to the decision, in the drills' shape (practice/HandStory): the streets before it a line each,
// and the street you act on with its pot as it began and the price of a call. Read from the Study line the record keeps
// (studyState.ts); null where there's none, or where the money on the street can't be told (an all-in with no amount; a
// preflop decision in a game of your own, whose blinds may not be the usual), and Review says the line in words instead.
import type { MistakeRecord } from "@/data/db";
import { encodeLine, fromSearch, type StudyHand } from "@/features/study/studyState";
import { preflopWords, type Story, type StoryStep, type StoryStreet } from "@/features/practice/drills";
import { seatLabel } from "@/poker/seats";
import type { AdvisorAction } from "@/solver/protocol";

const fmt = (x: number) => String(Math.round(x * 100) / 100);
const STREETS = ["preflop", "flop", "turn", "river"] as const;
const NAME: Record<(typeof STREETS)[number], StoryStreet> = { preflop: "Preflop", flop: "Flop", turn: "Turn", river: "River" };
/** where each street's cards sit in the board string (two characters a card) */
const CARDS: Record<"flop" | "turn" | "river", [number, number]> = { flop: [0, 6], turn: [6, 8], river: [8, 10] };

const spaced = (s: string) => s.match(/../g)?.join(" ") ?? s;

/** a postflop street's action in words: "BB checks, BTN bets 4.13bb, BB calls" */
function streetWords(acts: readonly AdvisorAction[]): string {
  return acts
    .map((a) =>
      a.action === "bet"
        ? `${a.pos} bets ${fmt(a.to ?? a.amount ?? 0)}bb`
        : a.action === "raise"
          ? `${a.pos} raises to ${fmt(a.to ?? 0)}bb`
          : a.action === "all-in"
            ? `${a.pos} goes all-in`
            : `${a.pos} ${a.action}s`,
    )
    .join(", ");
}

/** what each seat has put in on a street, and the bet to match; null where an all-in leaves it unknown */
function money(acts: readonly AdvisorAction[], start: Record<string, number>): { put: Record<string, number>; cur: number } | null {
  const put = { ...start };
  let cur = Math.max(0, ...Object.values(start));
  for (const a of acts) {
    if (a.action === "bet" || a.action === "raise") {
      const to = a.to ?? a.amount;
      if (to == null || !Number.isFinite(to)) return null;
      put[a.pos] = to;
      cur = Math.max(cur, to);
    } else if (a.action === "call") put[a.pos] = cur;
    else if (a.action === "all-in") return null;
  }
  return { put, cur };
}

export function retryStory(m: Pick<MistakeRecord, "study" | "street" | "pot" | "seat" | "players">): Story | null {
  const h: StudyHand | null = m.study ? fromSearch(m.study) : null;
  const at = STREETS.indexOf(m.street as (typeof STREETS)[number]);
  if (!h || at < 0) return null;
  const street = STREETS[at]!;
  if (street === "preflop" && h.setup) return null;

  const steps: StoryStep[] = [];
  const pre = preflopWords(encodeLine(h.preflop));
  if (street !== "preflop" && pre) steps.push({ street: "Preflop", pot: null, text: pre });
  for (const s of STREETS.slice(1, at)) {
    const [a, b] = CARDS[s];
    const cards = spaced(h.board.slice(a, b));
    steps.push({ street: NAME[s], pot: null, text: `${cards} · ${streetWords(h[s]) || "checked through"}` });
  }

  const blinds = street === "preflop" ? { SB: 0.5, BB: 1 } : {};
  const mo = money(h[street], blinds);
  if (!mo) return null;
  const inStreet = Object.values(mo.put).reduce((x, y) => x + y, 0) - (street === "preflop" ? 1.5 : 0);
  const pot = Math.round((m.pot - inStreet) * 100) / 100;
  if (!(pot > 0)) return null;
  const toCall = Math.round((mo.cur - (mo.put[m.seat] ?? 0)) * 100) / 100;
  const now = street === "preflop" ? preflopWords(encodeLine(h.preflop)) : streetWords(h[street]);
  const cards = street === "preflop" ? "" : spaced(h.board.slice(...CARDS[street]));
  return {
    steps,
    now: { street: NAME[street], pot, line: [cards, now].filter(Boolean).join(" · "), hero: seatLabel(m.seat, m.players), toCall: Math.max(0, toCall), behind: null },
  };
}
