// Your stats as played, counted from the hand histories kept (no solver, nothing graded): the usual frequencies
// (VPIP, PFR, RFI, 3-bet, fold to 3-bet, c-bet, fold to c-bet, check-raise, barrels, river calls, went to showdown), each
// over its own opportunities, the hands where you had the chance, with a 95% interval so a small sample reads as one,
// and your bet and raise sizes. Each move is read on the table engine (poker/table.ts) as it stood, so an all-in counts
// as a raise only where it raises. The same pass keeps what a decision record doesn't: the size each move faced or chose
// and the effective stack (MoveFact, breakdown.ts), so nothing here is read twice.
import type { HandRecord } from "@/data/db";
import { importHand, finalSim, type ReplayedHand } from "@/hh/replay";
import { resultOf } from "@/hh/results";
import { simulate, type Lines, type Move, type Street } from "@/poker/table";
import { SEATS } from "@/poker/seats";
import { STREETS } from "./analyze";

const EPS = 1e-9;

export type StatKey = "vpip" | "pfr" | "rfi" | "threebet" | "squeeze" | "fold3bet" | "fourbet" | "cbet" | "foldcbet" | "xr" | "turnbarrel" | "riverbarrel" | "rivercall" | "rivercallwon" | "wtsd";

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
  { key: "rivercall", label: "River call (bluff-catching)", chance: "when you faced the first bet on the river", took: "you called" },
  { key: "rivercallwon", label: "River call won", chance: "when you called that bet and the history says what you won", took: "you came out ahead in the hand" },
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

/** Raises, in multiples of the bet raised (the big blind's for an open). */
export const RAISE_SIZES: readonly { label: string; max: number }[] = [
  { label: "under 2.5×", max: 2.5 },
  { label: "2.5–3×", max: 3 },
  { label: "3–4×", max: 4 },
  { label: "4–6×", max: 6 },
  { label: "over 6×", max: Infinity },
];
export const raiseBucket = (x: number) => RAISE_SIZES.findIndex((s) => x < s.max);

/** One of your moves, with what the history says of its size. (`i` is its index on the street, as a decision's id has
 * it.) */
export interface MoveFact {
  street: Street;
  i: number;
  /** what it faced: preflop the raise to, in bb; after the flop the bet's share of the pot it went into, in %. None
   * with no bet or raise to answer (the blinds aren't one) */
  faced?: number;
  /** your bet after the flop, in % of the pot before it */
  betPct?: number;
  /** your raise on any street, in multiples of the bet it raised */
  raiseX?: number;
}

export interface HandStats {
  /** for each stat you had the chance at in the hand: whether you took it */
  at: Partial<Record<StatKey, boolean>>;
  /** your seat where it was folded to you */
  rfiPos?: string;
  /** your seat in the hand */
  pos?: string;
  /** your bets after the flop (not raises): street and % of the pot */
  bets: { street: Street; pct: number }[];
  /** your raises: street and multiple of the bet raised */
  raises: { street: Street; x: number }[];
  /** each of your moves */
  moves: MoveFact[];
  /** the effective stack at the start of the hand, bb: yours against the deepest opponent who stayed in */
  eff: number;
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
  /** its index on the street, the bet standing, and the street's last bet or raise as it was made */
  i: number;
  curBet: number;
  last: { to: number; own: number; pot: number } | null;
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
    let last: Step["last"] = null;
    r.lines[street].forEach((m, j) => {
      const sim = simulate(r.setup, upTo(r.lines, street, j), n);
      const info = sim.cur;
      const curBet = info?.curBet ?? 0;
      const facing = !!info && curBet - (info.bets[m.pos] ?? 0) > EPS;
      const cap = (r.setup.stacks[m.pos] ?? 0) - (sim.invested[m.pos] ?? 0);
      const to = m.action === "all-in" ? cap : (m.to ?? 0);
      const agg = m.action === "bet" || m.action === "raise" || (m.action === "all-in" && cap > curBet + EPS);
      out.push({ street, m, facing, agg, aggBefore: [...aggBefore], limps, callers, pot: sim.pot, to, i: j, curBet, last });
      if (agg) {
        aggBefore.push(m.pos);
        callers = 0;
        last = { to, own: info?.bets[m.pos] ?? 0, pot: sim.pot };
      } else if (m.action === "call" || m.action === "all-in") {
        if (aggBefore.length) callers++;
        else limps++;
      }
    });
  }
  return out;
}

/** A move of yours, sized. */
function factOf(x: Step): MoveFact {
  const pre = x.street === "preflop";
  const faced = !x.facing || !x.last ? undefined : pre ? x.curBet : ((x.last.to - x.last.own) / x.last.pot) * 100;
  return {
    street: x.street,
    i: x.i,
    ...(faced !== undefined ? { faced } : {}),
    ...(x.agg && !pre && !x.facing && x.pot > EPS ? { betPct: (x.to / x.pot) * 100 } : {}),
    ...(x.agg && x.curBet > EPS ? { raiseX: x.to / x.curBet } : {}),
  };
}

/** One hand's stats (null where the replay stopped short of the history: it's left out). `playedFor`: the record's, where
 * Practice played your preflop, so none of it counts; from the flop it's yours, on the line as it stood (c-betting a raise
 * drawn for you is a c-bet). `text`: the history, for what it says you won (without it, no "River call won"). */
export function handStats(r: ReplayedHand, playedFor?: HandRecord["playedFor"], text?: string): HandStats | null {
  if (r.stopped) return null;
  const hero = r.hand.hero;
  const all = steps(r);
  const mine = (s: Street) => all.filter((x) => x.street === s && x.m.pos === hero);
  const at: HandStats["at"] = {};
  const out: HandStats = { at, pos: hero, bets: [], raises: [], moves: all.filter((x) => x.m.pos === hero).map(factOf), eff: r.hand.effective };
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
  // the river's first bet, by another, answered: the history can't say whether your hand only beat bluffs, so every call
  // counts, and the money says how they went
  const facedRiver = mine("river").find((x) => x.facing && x.aggBefore.length === 1 && x.aggBefore[0] !== hero);
  if (facedRiver) {
    at.rivercall = !facedRiver.agg && facedRiver.m.action !== "fold";
    const net = at.rivercall && text !== undefined ? resultOf(r.hand, text).net : null;
    if (net != null) at.rivercallwon = net > EPS;
  }
  if (!foldedPre && r.hand.board.length >= 3) {
    const folded = all.some((x) => x.m.pos === hero && x.m.action === "fold");
    at.wtsd = !folded && finalSim(r).active.size >= 2;
  }
  const counted = playedFor === "preflop" ? (x: Step) => x.street !== "preflop" : () => true;
  for (const x of all) {
    if (x.m.pos !== hero || !x.agg || !counted(x)) continue;
    if (x.street !== "preflop" && !x.facing && x.pot > EPS) out.bets.push({ street: x.street, pct: (x.to / x.pot) * 100 });
    else if (x.curBet > EPS) out.raises.push({ street: x.street, x: x.to / x.curBet });
  }
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
  /** every stat by your seat, in seat order, with the hands counted there */
  seats: { pos: string; hands: number; by: Record<StatKey, Count> }[];
  /** your bets after the flop by size, per street */
  sizes: Record<"flop" | "turn" | "river", number[]>;
  /** your raises by size, per street */
  raises: Record<Street, number[]>;
}

// (the nine-handed table names every seat, in preflop order)
const seatRank = (p: string) => {
  const i = SEATS[9]!.indexOf(p);
  return i < 0 ? 99 : i;
};

export function tallyStats(list: readonly { id: string; s: HandStats | null }[]): Stats {
  const by = Object.fromEntries(STATS.map((x) => [x.key, count()])) as Record<StatKey, Count>;
  const rfi = new Map<string, Count>();
  const seats = new Map<string, { pos: string; hands: number; by: Record<StatKey, Count> }>();
  const sizes = { flop: SIZES.map(() => 0), turn: SIZES.map(() => 0), river: SIZES.map(() => 0) };
  const raises = Object.fromEntries(STREETS.map((s) => [s, RAISE_SIZES.map(() => 0)])) as Stats["raises"];
  let left = 0;
  for (const { id, s } of list) {
    if (!s) {
      left++;
      continue;
    }
    for (const [k, took] of Object.entries(s.at) as [StatKey, boolean][]) add(by[k], id, took);
    if (s.pos) {
      if (!seats.has(s.pos)) seats.set(s.pos, { pos: s.pos, hands: 0, by: Object.fromEntries(STATS.map((x) => [x.key, count()])) as Record<StatKey, Count> });
      const seat = seats.get(s.pos)!;
      seat.hands++;
      for (const [k, took] of Object.entries(s.at) as [StatKey, boolean][]) add(seat.by[k], id, took);
    }
    if (s.rfiPos && s.at.rfi !== undefined) {
      if (!rfi.has(s.rfiPos)) rfi.set(s.rfiPos, count());
      add(rfi.get(s.rfiPos)!, id, s.at.rfi);
    }
    for (const b of s.bets) if (b.street !== "preflop") sizes[b.street][sizeBucket(b.pct)]! += 1;
    for (const b of s.raises) raises[b.street][raiseBucket(b.x)]! += 1;
  }
  return {
    hands: list.length - left,
    left,
    by,
    rfi: [...rfi.entries()].sort((a, b) => seatRank(a[0]) - seatRank(b[0]) || a[0].localeCompare(b[0])).map(([pos, c]) => ({ pos, c })),
    seats: [...seats.values()].sort((a, b) => seatRank(a.pos) - seatRank(b.pos) || a.pos.localeCompare(b.pos)),
    sizes,
    raises,
  };
}

// (a hand's text never changes under its id: its stats are counted once a page)
const cache = new Map<string, HandStats | null>();

/** The kept hands' stats, hand by hand, a chunk at a time so a large database doesn't hold the page; each is worked out
 * once. Null on the signal. */
export async function readStats(hands: readonly HandRecord[], opts: { signal?: AbortSignal; onProgress?: (done: number) => void; chunk?: number } = {}): Promise<{ id: string; s: HandStats | null }[] | null> {
  const chunk = opts.chunk ?? 200;
  const list: { id: string; s: HandStats | null }[] = [];
  for (let i = 0; i < hands.length; i++) {
    const h = hands[i]!;
    if (!cache.has(h.id)) {
      let s: HandStats | null;
      try {
        s = handStats(importHand(h.text), h.playedFor, h.text);
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
  return list;
}

/** The kept hands' stats told up. */
export async function statsOf(hands: readonly HandRecord[], opts: Parameters<typeof readStats>[1] = {}): Promise<Stats | null> {
  const list = await readStats(hands, opts);
  return list && tallyStats(list);
}
