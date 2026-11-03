// Your results as played, from the hand histories kept (hh/results.ts): what you won or lost, in big blinds, over
// the hands the filters show. Cash games, tournaments (whose chips aren't money) and the hands played at Practice's
// tables (and the classic app's) apart, each with its total, bb/100, the share won at showdown and
// without, by your seat, and the running total in the order played. Nothing here is graded or solved.
import type { HandRecord } from "@/data/db";
import { PRACTICE_SITE } from "@/data/hands";
import { parseHandHistory } from "@/hh/parse";
import { resultOf, type ResultWhy } from "@/hh/results";
import { SEATS } from "@/poker/seats";
import { CLASSIC_SITE } from "./classic";

export interface HandWin {
  net: number | null;
  why?: ResultWhy;
  /** the history's big blind, in its money */
  bb: number;
}

export interface WinGroup {
  hands: number;
  /** bb, in all and per 100 hands */
  net: number;
  bb100: number;
  /** bb/100's 95% interval from the hands' own spread (none under two hands) */
  range: [number, number] | null;
  /** won where the hand went to showdown, and where it didn't (a replay stopped short counts in neither) */
  sd: number;
  nonSd: number;
  /** cash games' money, by currency ("$", "€", …), in the order first met */
  money: { unit: string; net: number }[];
  byPos: { pos: string; hands: number; net: number }[];
  /** the running totals after each hand, in the order played: in all, at showdown, without */
  ids: string[];
  total: number[];
  atSd: number[];
  noSd: number[];
}

export interface Winnings {
  cash: WinGroup | null;
  tour: WinGroup | null;
  /** hands played at Practice's tables, and the classic app's */
  practice: WinGroup | null;
  /** hands whose result the history doesn't say, by why */
  left: { why: ResultWhy; n: number }[];
}

export function handWin(text: string): HandWin {
  try {
    const h = parseHandHistory(text);
    return { ...resultOf(h, text), bb: h.bb };
  } catch {
    return { net: null, why: "unread", bb: NaN };
  }
}

// (the nine-handed table names every seat, in preflop order)
const seatRank = (p: string) => {
  const i = SEATS[9]!.indexOf(p);
  return i < 0 ? 99 : i;
};
/** in the order played: the history's clock, then the site's hand number */
const byPlayed = (a: HandRecord, b: HandRecord) =>
  a.playedAt - b.playedAt || a.number.length - b.number.length || (a.number < b.number ? -1 : a.number > b.number ? 1 : 0);
/** "$0.50" → "$"; a tournament's "300 chips" or a bare "1" has none */
export const unitOf = (bb: string) => bb.match(/^\s*([^\d\s.,]+)/)?.[1] ?? "";
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

function group(list: { h: HandRecord; w: HandWin }[]): WinGroup | null {
  if (!list.length) return null;
  const pos = new Map<string, { hands: number; net: number }>();
  const money = new Map<string, number>();
  let sq = 0;
  const g: WinGroup = { hands: 0, net: 0, bb100: 0, range: null, sd: 0, nonSd: 0, money: [], byPos: [], ids: [], total: [], atSd: [], noSd: [] };
  for (const { h, w } of [...list].sort((a, b) => byPlayed(a.h, b.h))) {
    const net = w.net!;
    g.hands++;
    g.net += net;
    sq += net * net;
    if (/showdown/.test(h.end)) g.sd += net;
    else if (!/^stopped/.test(h.end)) g.nonSd += net;
    const p = pos.get(h.hero) ?? { hands: 0, net: 0 };
    p.hands++;
    p.net += net;
    pos.set(h.hero, p);
    const unit = h.tournament ? "" : unitOf(h.bb);
    if (unit) money.set(unit, (money.get(unit) ?? 0) + net * w.bb);
    g.ids.push(h.id);
    g.total.push(r4(g.net));
    g.atSd.push(r4(g.sd));
    g.noSd.push(r4(g.nonSd));
  }
  g.net = r4(g.net);
  g.sd = r4(g.sd);
  g.nonSd = r4(g.nonSd);
  g.bb100 = (g.net / g.hands) * 100;
  if (g.hands > 1) {
    const mean = g.net / g.hands;
    const half = 1.96 * Math.sqrt(Math.max(0, (sq - g.hands * mean * mean) / (g.hands - 1)) / g.hands) * 100;
    g.range = [g.bb100 - half, g.bb100 + half];
  }
  g.money = [...money].map(([unit, v]) => ({ unit, net: Math.round(v * 100) / 100 }));
  g.byPos = [...pos].sort((a, b) => seatRank(a[0]) - seatRank(b[0]) || a[0].localeCompare(b[0])).map(([p, x]) => ({ pos: p, hands: x.hands, net: r4(x.net) }));
  return g;
}

export function tallyWinnings(list: readonly { h: HandRecord; w: HandWin }[]): Winnings {
  const known = list.filter((x) => x.w.net != null);
  const left = new Map<ResultWhy, number>();
  for (const { w } of list) if (w.net == null) left.set(w.why ?? "unread", (left.get(w.why ?? "unread") ?? 0) + 1);
  const table = (h: HandRecord) => h.site === PRACTICE_SITE || h.site === CLASSIC_SITE;
  return {
    cash: group(known.filter((x) => !x.h.tournament && !table(x.h))),
    tour: group(known.filter((x) => !!x.h.tournament && !table(x.h))),
    practice: group(known.filter((x) => table(x.h))),
    left: [...left].map(([why, n]) => ({ why, n })),
  };
}

// (a hand's text never changes under its id: its result is read once a page)
const cache = new Map<string, HandWin>();

/** The kept hands' results, a chunk at a time so a large database doesn't hold the page; stops on the signal. */
export async function winningsOf(
  hands: readonly HandRecord[],
  opts: { signal?: AbortSignal; onProgress?: (done: number) => void; chunk?: number } = {},
): Promise<Winnings | null> {
  const chunk = opts.chunk ?? 200;
  const list: { h: HandRecord; w: HandWin }[] = [];
  for (let i = 0; i < hands.length; i++) {
    const h = hands[i]!;
    if (!cache.has(h.id)) {
      cache.set(h.id, handWin(h.text));
      if (i % chunk === chunk - 1) {
        opts.onProgress?.(i + 1);
        await new Promise((r) => setTimeout(r, 0));
        if (opts.signal?.aborted) return null;
      }
    }
    list.push({ h, w: cache.get(h.id)! });
  }
  return tallyWinnings(list);
}
