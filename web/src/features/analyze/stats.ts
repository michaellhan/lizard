// Your stats as played, counted from the hand histories kept (no solver, nothing graded): the usual frequencies
// (VPIP, PFR, RFI, 3-bet, fold to 3-bet, c-bet, fold to c-bet, check-raise, barrels, went to showdown), each over its
// own opportunities, the hands where you had the chance, with a 95% interval so a small sample reads as one, and
// your bet sizes. Each move is read on the table engine (poker/table.ts) as it stood, so an all-in counts as a raise
// only where it raises.
import type { HandRecord } from "@/data/db";
import { importHand, finalSim, type ReplayedHand } from "@/hh/replay";
import { simulate, type Lines, type Move, type Street } from "@/poker/table";
import { SEATS } from "@/poker/seats";
import { STREETS } from "./analyze";

const EPS = 1e-9;

export type StatKey = "vpip" | "pfr" | "rfi" | "threebet" | "squeeze" | "fold3bet" | "fourbet" | "cbet" | "foldcbet" | "xr" | "turnbarrel" | "riverbarrel" | "wtsd";

/** Each stat: its name, its opportunity (the denominator) and what counts as taking it. */
export const STATS: readonly { key: StatKey; label: string; chance: string; took: string }[] = [
  { key: "vpip", label: "VPIP", chance: "in every hand with a preflop decision (a walk has none)", took: "you called or raised preflop" },
  { key: "pfr", label: "PFR", chance: "in every hand with a preflop decision", took: "you raised preflop" },
  { key: "rfi", label: "RFI", chance: "when folded to you preflop (no raise, no limp)", took: "you raised first in" },
  { key: "threebet", label: "3-bet", chance: "when facing one raise preflop", took: "you re-raised" },
  { key: "squeeze", label: "Squeeze", chance: "when facing one raise and a call of it", took: "you re-raised" },
  { key: "fold3bet", label: "Fold to 3-bet", chance: "when you raised first and faced a re-raise", took: "you folded" },
  { key: "fourbet", label: "4-bet", chance: "when facing a 3-bet", took: "you re-raised" },
  { key: "cbet", label: "Flop c-bet", chance: "when you made the last preflop raise and the flop was checked to you", took: "you bet" },
  { key: "foldcbet", label: "Fold to flop c-bet", chance: "when facing the preflop raiser's flop bet", took: "you folded" },
  { key: "xr", label: "Flop check-raise", chance: "when you checked the flop and then faced a bet", took: "you raised" },
  { key: "turnbarrel", label: "Turn barrel", chance: "when you c-bet the flop and the turn was checked to you", took: "you bet" },
  { key: "riverbarrel", label: "River barrel", chance: "when you bet flop and turn and the river was checked to you", took: "you bet" },
  { key: "wtsd", label: "Went to showdown", chance: "when you saw the flop", took: "you didn't fold" },
];

/** Bet sizes, in % of the pot before the bet. */
export const SIZES: readonly { label: string; max: number }[] = [
  { label: "under 30%", max: 30 },
  { label: "30–45%", max: 45 },
  { label: "45–60%", max: 60 },
  { label: "60–80%", max: 80 },
  { label: "80–110%", max: 110 },
  { label: "over 110%", max: Infinity },
];
export const sizeBucket = (pct: number) => SIZES.findIndex((s) => pct < s.max);

export interface HandStats {
  /** for each stat you had the chance at in the hand: whether you took it */
  at: Partial<Record<StatKey, boolean>>;
  /** your seat where it was folded to you */
  rfiPos?: string;
  /** your bets after the flop (not raises): street and % of the pot */
  bets: { street: Street; pct: number }[];
}

interface Step {
  street: Street;
  m: Move;
  /** facing a bet or raise */
  facing: boolean;
  /** a bet or raise (an all-in that raises included) */
  agg: boolean;
  /** the street's bets or raises before it, by whom */
  aggBefore: string[];
  /** preflop: calls before the first raise (limps), and calls of the last raise */
  limps: number;
  callers: number;
  /** the pot before it, and the move's total bet on the street (bets and raises) */
  pot: number;
  to: number;
}

const upTo = (lines: Lines, street: Street, j: number): Lines => {
  const k = STREETS.indexOf(street);
  const out = { preflop: [], flop: [], turn: [], river: [] } as Lines;
  STREETS.forEach((s, x) => (out[s] = x < k ? lines[s] : x === k ? lines[s].slice(0, j) : []));
  return out;
};

/** Every move of the hand, with the table as it stood before it. */
function steps(r: ReplayedHand): Step[] {
  const out: Step[] = [];
  const n = r.hand.board.length;
  for (const street of STREETS) {
    const aggBefore: string[] = [];
    let limps = 0;
    let callers = 0;
    r.lines[street].forEach((m, j) => {
      const sim = simulate(r.setup, upTo(r.lines, street, j), n);
      const info = sim.cur;
      const curBet = info?.curBet ?? 0;
      const facing = !!info && curBet - (info.bets[m.pos] ?? 0) > EPS;
      const cap = (r.setup.stacks[m.pos] ?? 0) - (sim.invested[m.pos] ?? 0);
      const to = m.action === "all-in" ? cap : (m.to ?? 0);
      const agg = m.action === "bet" || m.action === "raise" || (m.action === "all-in" && cap > curBet + EPS);
      out.push({ street, m, facing, agg, aggBefore: [...aggBefore], limps, callers, pot: sim.pot, to });
      if (agg) {
        aggBefore.push(m.pos);
        callers = 0;
      } else if (m.action === "call" || m.action === "all-in") {
        if (aggBefore.length) callers++;
        else limps++;
      }
    });
  }
  return out;
}

/** One hand's stats (null where the replay stopped short of the history: it's left out). `playedFor`: the record's, where
 * Practice played your preflop, so none of it counts; from the flop it's yours, on the line as it stood (c-betting a raise
 * drawn for you is a c-bet). */
export function handStats(r: ReplayedHand, playedFor?: HandRecord["playedFor"]): HandStats | null {
  if (r.stopped) return null;
  const hero = r.hand.hero;
  const all = steps(r);
  const mine = (s: Street) => all.filter((x) => x.street === s && x.m.pos === hero);
  const at: HandStats["at"] = {};
  const out: HandStats = { at, bets: [] };
  const once = (k: StatKey, took: boolean) => {
    if (!(k in at)) at[k] = took;
  };

  const pre = playedFor === "preflop" ? [] : mine("preflop");
  if (pre.length) {
    at.vpip = pre.some((x) => x.m.action !== "fold" && x.m.action !== "check");
    at.pfr = pre.some((x) => x.agg);
  }
  for (const x of pre) {
    const n = x.aggBefore.length;
    if (x === pre[0] && !n && !x.limps) {
      once("rfi", x.agg);
      out.rfiPos = hero;
    }
    if (n === 1 && x.aggBefore[0] !== hero) {
      once("threebet", x.agg);
      if (x.callers > 0) once("squeeze", x.agg);
    }
    if (n === 2 && x.aggBefore[0] === hero) once("fold3bet", x.m.action === "fold");
    if (n === 2 && x.aggBefore[1] !== hero) once("fourbet", x.agg);
  }

  const raisers = all.filter((x) => x.street === "preflop" && x.agg).map((x) => x.m.pos);
  const pfr = raisers.at(-1);
  const foldedPre = pre.some((x) => x.m.action === "fold");
  // c-bet, then the barrels while you keep betting
  const firstUnopened = (s: Street) => {
    const f = mine(s)[0];
    return f && !f.aggBefore.length ? f : null;
  };
  if (pfr === hero) {
    const f = firstUnopened("flop");
    if (f) {
      at.cbet = f.agg;
      const t = f.agg ? firstUnopened("turn") : null;
      if (t) {
        at.turnbarrel = t.agg;
        const rv = t.agg ? firstUnopened("river") : null;
        if (rv) at.riverbarrel = rv.agg;
      }
    }
  } else if (pfr) {
    // the flop's first bet is the preflop raiser's, and you're next to answer it before any raise
    const flop = all.filter((x) => x.street === "flop");
    const k = flop.findIndex((x) => x.agg);
    if (k >= 0 && flop[k]!.m.pos === pfr) {
      const next = flop.slice(k + 1).find((x) => x.m.pos === hero);
      if (next && next.aggBefore.length === 1) at.foldcbet = next.m.action === "fold";
    }
  }
  const flopMine = mine("flop");
  if (flopMine[0]?.m.action === "check") {
    const later = flopMine.slice(1).find((x) => x.facing);
    if (later) at.xr = later.agg;
  }
  if (!foldedPre && r.hand.board.length >= 3) {
    const folded = all.some((x) => x.m.pos === hero && x.m.action === "fold");
    at.wtsd = !folded && finalSim(r).active.size >= 2;
  }
  for (const x of all)
    if (x.street !== "preflop" && x.m.pos === hero && x.agg && !x.facing && x.pot > EPS) out.bets.push({ street: x.street, pct: (x.to / x.pot) * 100 });
  return out;
}

/** The Wilson score interval for k of n (95% by default): where the true rate likely is. */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (!n) return [0, 1];
  const p = k / n;
  const z2 = z * z;
  const d = 1 + z2 / n;
  const c = p + z2 / (2 * n);
  const h = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}

export interface Count {
  /** opportunities, and of them taken */
  n: number;
  k: number;
  /** the hands: taken and not */
  yes: string[];
  no: string[];
}
const count = (): Count => ({ n: 0, k: 0, yes: [], no: [] });
const add = (c: Count, id: string, took: boolean) => {
  c.n++;
  if (took) {
    c.k++;
    c.yes.push(id);
  } else c.no.push(id);
};

export interface Stats {
  hands: number;
  /** hands left out: the replay stopped, or the history didn't read */
  left: number;
  by: Record<StatKey, Count>;
  /** RFI by your seat, in seat order */
  rfi: { pos: string; c: Count }[];
  /** your bets after the flop by size, per street */
  sizes: Record<"flop" | "turn" | "river", number[]>;
}

// (the nine-handed table names every seat, in preflop order)
const seatRank = (p: string) => {
  const i = SEATS[9]!.indexOf(p);
  return i < 0 ? 99 : i;
};

export function tallyStats(list: readonly { id: string; s: HandStats | null }[]): Stats {
  const by = Object.fromEntries(STATS.map((x) => [x.key, count()])) as Record<StatKey, Count>;
  const rfi = new Map<string, Count>();
  const sizes = { flop: SIZES.map(() => 0), turn: SIZES.map(() => 0), river: SIZES.map(() => 0) };
  let left = 0;
  for (const { id, s } of list) {
    if (!s) {
      left++;
      continue;
    }
    for (const [k, took] of Object.entries(s.at) as [StatKey, boolean][]) add(by[k], id, took);
    if (s.rfiPos && s.at.rfi !== undefined) {
      if (!rfi.has(s.rfiPos)) rfi.set(s.rfiPos, count());
      add(rfi.get(s.rfiPos)!, id, s.at.rfi);
    }
    for (const b of s.bets) if (b.street !== "preflop") sizes[b.street][sizeBucket(b.pct)]! += 1;
  }
  return {
    hands: list.length - left,
    left,
    by,
    rfi: [...rfi.entries()].sort((a, b) => seatRank(a[0]) - seatRank(b[0]) || a[0].localeCompare(b[0])).map(([pos, c]) => ({ pos, c })),
    sizes,
  };
}

// (a hand's text never changes under its id: its stats are counted once a page)
const cache = new Map<string, HandStats | null>();

/** The kept hands' stats, a chunk at a time so a large database doesn't hold the page; stops on the signal. */
export async function statsOf(hands: readonly HandRecord[], opts: { signal?: AbortSignal; onProgress?: (done: number) => void; chunk?: number } = {}): Promise<Stats | null> {
  const chunk = opts.chunk ?? 200;
  const list: { id: string; s: HandStats | null }[] = [];
  for (let i = 0; i < hands.length; i++) {
    const h = hands[i]!;
    if (!cache.has(h.id)) {
      let s: HandStats | null;
      try {
        s = handStats(importHand(h.text), h.playedFor);
      } catch {
        s = null;
      }
      cache.set(h.id, s);
      if (i % chunk === chunk - 1) {
        opts.onProgress?.(i + 1);
        await new Promise((r) => setTimeout(r, 0));
        if (opts.signal?.aborted) return null;
      }
    }
    list.push({ id: h.id, s: cache.get(h.id)! });
  }
  return tallyStats(list);
}
