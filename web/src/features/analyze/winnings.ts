// Your results as played, from the hand histories kept (hh/results.ts): what you won or lost, in big blinds, over
// the hands the filters show. Cash games, tournaments (whose chips aren't money) and the hands played at Practice's
// tables (and the classic app's) apart, each with its total, bb/100, the share won at showdown and
// without, the all-in EV (hh/allin.ts), by your seat, and the running total in the order played. Nothing here is
// graded or solved.
import type { HandRecord } from "@/data/db";
import { allInOf, type AllIn } from "@/hh/allin";
import { parseHandHistory } from "@/hh/parse";
import { resultOf, type ResultWhy } from "@/hh/results";
import { SEATS } from "@/poker/seats";
import { byPlayed, handKind } from "./sessions";

export interface HandWin {
  net: number | null;
  why?: ResultWhy;
  /** a heads-up all-in with cards to come, both hands shown */
  allIn?: AllIn;
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
  /** the all-in EV: each all-in at its EV (your equity's share of the pot), every other hand as it went; and how many
   * all-ins */
  ev: number;
  allIns: number;
  /** the all-ins, by hand */
  allIn: Record<string, AllIn>;
  /** cash games' money, by currency ("$", "€", …), in the order first met */
  money: { unit: string; net: number }[];
  byPos: { pos: string; hands: number; net: number }[];
  /** the running totals after each hand, in the order played: in all, at showdown, without */
  ids: string[];
  total: number[];
  atSd: number[];
  noSd: number[];
  evRun: number[];
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
    const r = resultOf(h, text);
    const allIn = r.net != null ? allInOf(h, text) : null;
    return { ...r, bb: h.bb, ...(allIn ? { allIn } : {}) };
  } catch {
    return { net: null, why: "unread", bb: NaN };
  }
}

// (the nine-handed table names every seat, in preflop order)
const seatRank = (p: string) => {
  const i = SEATS[9]!.indexOf(p);
  return i < 0 ? 99 : i;
};
/** "$0.50" → "$"; a tournament's "300 chips" or a bare "1" has none */
export const unitOf = (bb: string) => bb.match(/^\s*([^\d\s.,]+)/)?.[1] ?? "";
/** The sign an amount has as shown to `d` places: none for what rounds to nothing, its own for what rounds to a tenth. */
export function signOf(x: number, d = 1): string {
  const r = Number(x.toFixed(d));
  return r > 0 ? "+" : r < 0 ? "−" : "";
}
export const signed = (x: number, d = 1) => `${signOf(x, d)}${Math.abs(x).toFixed(d)}`;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

function group(list: { h: HandRecord; w: HandWin }[]): WinGroup | null {
  if (!list.length) return null;
  const pos = new Map<string, { hands: number; net: number }>();
  const money = new Map<string, number>();
  let sq = 0;
  const g: WinGroup = { hands: 0, net: 0, bb100: 0, range: null, sd: 0, nonSd: 0, ev: 0, allIns: 0, allIn: {}, money: [], byPos: [], ids: [], total: [], atSd: [], noSd: [], evRun: [] };
  for (const { h, w } of [...list].sort((a, b) => byPlayed(a.h, b.h))) {
    const net = w.net!;
    g.hands++;
    g.net += net;
    sq += net * net;
    g.ev += w.allIn ? w.allIn.ev : net;
    if (w.allIn) {
      g.allIns++;
      g.allIn[h.id] = w.allIn;
    }
    if (/showdown/.test(h.end)) g.sd += net;
    else if (!/^stopped/.test(h.end)) g.nonSd += net;
    const p = pos.get(h.hero) ?? { hands: 0, net: 0 };
    p.hands++;
    p.net += net;
    pos.set(h.hero, p);
    const unit = h.tournament !== undefined ? "" : unitOf(h.bb);
    if (unit) money.set(unit, (money.get(unit) ?? 0) + net * w.bb);
    g.ids.push(h.id);
    g.total.push(r4(g.net));
    g.atSd.push(r4(g.sd));
    g.noSd.push(r4(g.nonSd));
    g.evRun.push(r4(g.ev));
  }
  g.net = r4(g.net);
  g.sd = r4(g.sd);
  g.nonSd = r4(g.nonSd);
  g.ev = r4(g.ev);
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

/** The least and the most of some long lines. (A loop: a spread of Math.min's arguments overflows the stack at some
 * 120,000 values, which four lines reach at 30,000 hands.) */
export function extent(lines: readonly (readonly number[])[]): [number, number] {
  let [lo, hi] = [0, 0];
  for (const ys of lines)
    for (const y of ys) {
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  return [lo, hi];
}

export function tallyWinnings(list: readonly { h: HandRecord; w: HandWin }[]): Winnings {
  const known = list.filter((x) => x.w.net != null);
  const left = new Map<ResultWhy, number>();
  for (const { w } of list) if (w.net == null) left.set(w.why ?? "unread", (left.get(w.why ?? "unread") ?? 0) + 1);
  return {
    cash: group(known.filter((x) => handKind(x.h) === "cash")),
    tour: group(known.filter((x) => handKind(x.h) === "tour")),
    practice: group(known.filter((x) => handKind(x.h) === "practice")),
    left: [...left].map(([why, n]) => ({ why, n })),
  };
}

// (a hand's text never changes under its id: its result is read once a page)
const cache = new Map<string, HandWin>();

/** Each kept hand's result, a chunk at a time so a large database doesn't hold the page; null on the signal. */
export async function readWins(
  hands: readonly HandRecord[],
  opts: { signal?: AbortSignal; onProgress?: (done: number) => void; chunk?: number } = {},
): Promise<{ h: HandRecord; w: HandWin }[] | null> {
  const chunk = opts.chunk ?? 200;
  const list: { h: HandRecord; w: HandWin }[] = [];
  let last = performance.now();
  for (let i = 0; i < hands.length; i++) {
    const h = hands[i]!;
    if (!cache.has(h.id)) {
      cache.set(h.id, handWin(h.text));
      // (a preflop all-in's equity takes some 50ms: the page is let go every chunk of hands or 40ms, whichever first)
      if (i % chunk === chunk - 1 || performance.now() - last > 40) {
        opts.onProgress?.(i + 1);
        await new Promise((r) => setTimeout(r, 0));
        if (opts.signal?.aborted) return null;
        last = performance.now();
      }
    }
    list.push({ h, w: cache.get(h.id)! });
  }
  return list;
}

/** The kept hands' results told up. */
export async function winningsOf(hands: readonly HandRecord[], opts: Parameters<typeof readWins>[1] = {}): Promise<Winnings | null> {
  const list = await readWins(hands, opts);
  return list && tallyWinnings(list);
}
