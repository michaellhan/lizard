// The table engine: a hand of no-limit hold'em replayed from its action lists (one per street, in the Advisor's
// own format), so the same record drives the table, the solver request and the hand's history. Ported from the
// classic page (solver/gto/static/index.html simulate, recordOf, sidePots; practice.js settle), without the
// straddle. Chips are in big blinds; settlement counts in cents, so every chip put in is paid out (the odd cent of a
// split pot to the first winner after the button, the rake taken in proportion from every pot).
import { cmp, rank7, type HandValue } from "./evaluate";
import { orderPost, seatsOf } from "./seats";

export type Street = "preflop" | "flop" | "turn" | "river";
export const STREETS: readonly Street[] = ["preflop", "flop", "turn", "river"];
/** board cards out by each street */
export const NEED: Readonly<Record<Street, number>> = { preflop: 0, flop: 3, turn: 4, river: 5 };

export type MoveKind = "fold" | "check" | "call" | "bet" | "raise" | "all-in";

/** One action as recorded: a bet's or raise's `to` is the seat's total for the street, bb. */
export interface Move {
  pos: string;
  action: MoveKind;
  to?: number;
}

export type Lines = Record<Street, Move[]>;

export const noLines = (): Lines => ({ preflop: [], flop: [], turn: [], river: [] });

export interface TableSetup {
  players: number;
  /** each seat's chips at the start of the hand, bb */
  stacks: Readonly<Record<string, number>>;
  /** each seat's ante, bb */
  ante?: number;
}

export interface StreetInfo {
  bets: Record<string, number>;
  curBet: number;
  nRaises: number;
  closed: boolean;
  toAct: string | null;
  /** chips in at the end of this street's actions so far */
  pot: number;
  order: readonly string[];
  /** the smallest raise's size (over curBet) */
  minRaise: number;
  /** seats that may not raise: they acted since the last full raise (an all-in for less doesn't reopen it) */
  locked: Set<string>;
  /** a bet nobody matched, given back when the street closed */
  returned?: Record<string, number>;
}

export interface Sim {
  streets: Partial<Record<Street, StreetInfo>>;
  /** the street in progress, or the last one played */
  current: Street | null;
  toAct: string | null;
  /** the street whose cards are to come next */
  waiting: Street | null;
  handOver: boolean;
  /** one player or none left with chips: the board runs out */
  runout: boolean;
  /** chips in from closed streets (and antes) */
  invested: Record<string, number>;
  active: Set<string>;
  allin: Set<string>;
  /** the street in progress, while open */
  cur: StreetInfo | null;
  /** everything in, this street's bets included */
  pot: number;
}

const EPS = 1e-9;
const sum = (xs: Iterable<number>) => {
  let t = 0;
  for (const x of xs) t += x;
  return t;
};

/** The hand's state after the actions recorded, with `boardCount` cards out. */
export function simulate(t: TableSetup, lines: Lines, boardCount: number): Sim {
  const POS = seatsOf(t.players);
  const STACK = (p: string) => t.stacks[p] ?? 0;
  const active = new Set(POS);
  const allin = new Set<string>();
  const inv: Record<string, number> = Object.fromEntries(POS.map((p) => [p, Math.min(t.ante ?? 0, STACK(p))]));
  const out: Sim = {
    streets: {},
    current: null,
    toAct: null,
    waiting: null,
    handOver: false,
    runout: false,
    invested: inv,
    active,
    allin,
    cur: null,
    pot: 0,
  };
  for (const street of STREETS) {
    if (boardCount < NEED[street]) {
      out.waiting = street;
      break;
    }
    const pre = street === "preflop";
    const order = pre ? POS : orderPost(t.players);
    const bets: Record<string, number> = Object.fromEntries(POS.map((p) => [p, 0]));
    if (pre) {
      bets.SB = 0.5;
      bets.BB = 1;
      for (const p of POS) bets[p] = Math.min(bets[p]!, STACK(p) - inv[p]!);
      // (a seat whose ante or blind took all its chips is all-in, with no decision)
      for (const p of POS) if (bets[p]! + inv[p]! >= STACK(p) - EPS) allin.add(p);
    }
    let curBet = pre ? 1 : 0;
    let nRaises = 0;
    let acted = new Set<string>();
    let lastActor: string | null = null;
    let minRaise = pre ? curBet : 1;
    let locked = new Set<string>();
    let returned: Record<string, number> | undefined;
    const potBefore = sum(Object.values(inv));
    for (const a of lines[street]) {
      const p = a.pos;
      if (!active.has(p) || allin.has(p)) continue;
      const remaining = STACK(p) - inv[p]! - bets[p]!;
      if (a.action === "fold") active.delete(p);
      else if (a.action === "check" || a.action === "call") {
        bets[p] = Math.min(curBet, bets[p]! + remaining);
        if (bets[p]! + inv[p]! >= STACK(p) - EPS) allin.add(p);
        acted.add(p);
        locked.add(p);
      } else {
        const to = a.action === "all-in" ? bets[p]! + remaining : Math.min(a.to ?? 0, bets[p]! + remaining);
        bets[p] = to;
        if (to > curBet + EPS) {
          if (to - curBet >= minRaise - EPS) {
            minRaise = to - curBet;
            locked = new Set([p]);
          } else locked.add(p);
          curBet = to;
          nRaises++;
          acted = new Set([p]);
        } else {
          acted.add(p);
          locked.add(p);
        }
        if (bets[p]! + inv[p]! >= STACK(p) - EPS) allin.add(p);
      }
      lastActor = p;
    }
    let actors = [...active].filter((p) => !allin.has(p));
    // (one player left with chips who has matched the bet has nobody to bet against)
    const closed =
      active.size <= 1 ||
      actors.every((p) => acted.has(p)) ||
      (actors.length <= 1 && actors.every((p) => bets[p]! >= curBet - EPS));
    if (closed) {
      // the bet nobody matched goes back (also when everyone else folded: it isn't part of the pot won)
      const top = POS.reduce((m, p) => (bets[p]! > bets[m]! ? p : m), POS[0]!);
      const second = Math.max(0, ...POS.filter((p) => p !== top).map((p) => bets[p]!));
      if (bets[top]! > second + EPS) {
        returned = { [top]: bets[top]! - second };
        bets[top] = second;
        curBet = second;
        if (inv[top]! + second < STACK(top) - EPS) allin.delete(top);
        actors = [...active].filter((p) => !allin.has(p));
      }
    }
    let toAct: string | null = null;
    if (!closed) {
      const N = order.length;
      const start = lastActor ? (order.indexOf(lastActor) + 1) % N : 0;
      for (let k = 0; k < N; k++) {
        const p = order[(start + k) % N]!;
        if (active.has(p) && !allin.has(p) && !acted.has(p)) {
          toAct = p;
          break;
        }
      }
    }
    const pot = potBefore + sum(Object.values(bets));
    out.streets[street] = { bets, curBet, nRaises, closed, toAct, pot, order, minRaise, locked, ...(returned ? { returned } : {}) };
    if (!closed) {
      out.current = street;
      out.toAct = toAct;
      break;
    }
    for (const p of POS) inv[p]! += bets[p]!;
    if (active.size <= 1) {
      out.handOver = true;
      out.current = street;
      break;
    }
    if (actors.length <= 1) out.runout = true;
    if (street === "river") {
      out.handOver = true;
      out.current = street;
    }
  }
  const cs = out.current ? out.streets[out.current] : undefined;
  out.cur = cs && !cs.closed ? cs : null;
  out.pot = sum(Object.values(inv)) + (out.cur ? sum(Object.values(out.cur.bets)) : 0);
  return out;
}

/** Chips p has behind (not yet in), bb. */
export function behind(t: TableSetup, sim: Sim, p: string): number {
  return (t.stacks[p] ?? 0) - (sim.invested[p] ?? 0) - (sim.cur?.bets[p] ?? 0);
}

/** Whether p (to act) may bet or raise: not shut out by an all-in for less than a full raise, and someone else
 * still has chips to face it. */
export function canRaise(sim: Sim, p: string): boolean {
  return !!sim.cur && !sim.cur.locked.has(p) && [...sim.active].some((q) => q !== p && !sim.allin.has(q));
}

export const minRaiseTo = (info: StreetInfo) => info.curBet + info.minRaise;

export interface Legal {
  toAct: string;
  /** chips to call (0: may check) */
  toCall: number;
  canRaise: boolean;
  /** the smallest bet or raise, as the street total (capped at all-in) */
  minTo: number;
  /** all-in, as the street total */
  allInTo: number;
}

/** What the seat to act may do, or null when nobody is to act. */
export function legal(t: TableSetup, sim: Sim): Legal | null {
  const p = sim.toAct;
  const info = sim.cur;
  if (!p || !info) return null;
  const rem = behind(t, sim, p);
  const allInTo = info.bets[p]! + rem;
  return {
    toAct: p,
    toCall: Math.min(info.curBet - info.bets[p]!, rem),
    canRaise: canRaise(sim, p),
    minTo: Math.min(minRaiseTo(info), allInTo),
    allInTo,
  };
}

const fmt = (x: number) => String(Math.round(x * 100) / 100);

/** The record of an action by whoever is to act, or why it can't be taken. A size is rounded to half a big
 * blind; `clamp` (an opponent's move) lifts a size under the minimum to it, and a raise that isn't allowed to a
 * call, rather than refuse them. */
export function recordOf(
  t: TableSetup,
  sim: Sim,
  a: { action: string; to?: number; clamp?: boolean },
): Move | string {
  if (!sim.cur || !sim.toAct) return sim.waiting ? "Deal the next card first." : "The hand is over.";
  const p = sim.toAct;
  const info = sim.cur;
  const toCall = info.curBet - info.bets[p]!;
  const remaining = behind(t, sim, p);
  const facing = toCall > EPS;
  const raiseOk = canRaise(sim, p);
  const allInTo = info.bets[p]! + remaining;
  const pass: Move = facing ? { pos: p, action: "call" } : { pos: p, action: "check" };
  if (a.action === "fold") return { pos: p, action: "fold" };
  if (a.action === "check") return facing ? `${p} can't check, there's ${fmt(toCall)}bb to call.` : { pos: p, action: "check" };
  if (a.action === "call") return pass;
  if (a.action === "all-in") return raiseOk || remaining <= toCall + EPS ? { pos: p, action: "all-in" } : pass;
  let to = Math.round((a.to ?? 0) * 2) / 2;
  if (!(to > 0)) return "Enter an amount.";
  if (to <= info.curBet + EPS && to < allInTo - EPS) return `${fmt(to)}bb isn't a raise, the bet is ${fmt(info.curBet)}bb.`;
  if (!raiseOk) {
    if (!a.clamp)
      return info.locked.has(p)
        ? `${p} can't raise: the all-in for less than a full raise doesn't reopen the betting.`
        : `${p} can't raise: nobody left has chips to call it.`;
    return pass;
  }
  if (to < minRaiseTo(info) - EPS && to < allInTo - EPS) {
    if (!a.clamp) return `The smallest ${facing || info.curBet > 0 ? "raise is to" : "bet is"} ${fmt(Math.min(minRaiseTo(info), allInTo))}bb.`;
    to = minRaiseTo(info);
  }
  if (to >= allInTo - EPS) return { pos: p, action: "all-in" };
  return { pos: p, action: facing || info.curBet > 0 ? "raise" : "bet", to };
}

/** The lines with one more action on the street in progress. */
export function withMove(lines: Lines, street: Street, m: Move): Lines {
  return { ...lines, [street]: [...lines[street], m] };
}

// ---- pots and settlement

export interface SidePot {
  amount: number;
  eligible: string[];
}

/** Main pot and side pots from each seat's chips in and the players still in: each all-in player's stake caps what
 * it can win from everyone. Main pot first; one entry without side pots. */
export function sidePots(tot: Readonly<Record<string, number>>, live: readonly string[], allin: ReadonlySet<string>): SidePot[] {
  const seats = Object.keys(tot);
  const top = Math.max(...live.map((p) => tot[p] ?? 0));
  const caps = [...new Set(live.filter((p) => allin.has(p) && (tot[p] ?? 0) < top - EPS).map((p) => tot[p]!))].sort((a, b) => a - b);
  const pots: SidePot[] = [];
  let prev = 0;
  for (const lev of [...caps, Infinity]) {
    const amount = sum(seats.map((p) => Math.min(tot[p]!, lev) - Math.min(tot[p]!, prev)));
    const eligible = live.filter((p) => (lev === Infinity ? !(allin.has(p) && tot[p]! <= prev + EPS) : tot[p]! >= lev - EPS));
    if (amount > EPS) pots.push({ amount, eligible });
    prev = lev;
  }
  return pots;
}

export interface Rake {
  /** percent of the pot */
  pct: number;
  /** the most taken from one hand, bb */
  cap?: number;
}

export interface Settlement {
  /** chips won by seat, bb */
  pays: Record<string, number>;
  pots: (SidePot & { winners: string[] })[];
  /** the best hand(s) among the players still in */
  winners: string[];
  /** each live player's hand at showdown */
  val: Record<string, HandValue>;
  rake: number;
}

const cents = (x: number) => Math.round(x * 100);

/** The pot to the best hands. `inv`: chips in by seat (every street closed); `live`: the players still in; the rake
 * only where `raked` (the hand saw a flop: no flop, no drop). */
export function settle(
  t: TableSetup,
  inv: Readonly<Record<string, number>>,
  live: readonly string[],
  allin: ReadonlySet<string>,
  board: readonly string[],
  cardsOf: (p: string) => readonly string[],
  rake?: Rake,
  raked: boolean = board.length >= 3,
): Settlement {
  const POS = seatsOf(t.players);
  const post = orderPost(t.players);
  const invC: Record<string, number> = Object.fromEntries(POS.map((p) => [p, cents(inv[p] ?? 0)]));
  const totalC = sum(Object.values(invC));
  const most = Object.values(invC).sort((a, b) => b - a);
  const uncalled = (most[0] ?? 0) - (most[1] ?? 0);
  const rakeC = raked && rake && rake.pct > 0 ? Math.min(Math.round(((totalC - uncalled) * rake.pct) / 100), rake.cap ? cents(rake.cap) : Infinity) : 0;
  const netC = totalC - rakeC;
  const payC: Record<string, number> = {};
  const toBb = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).map(([p, c]) => [p, c / 100]));
  if (live.length < 2) {
    if (live[0]) payC[live[0]] = netC;
    return { pays: toBb(payC), pots: [], winners: [...live], val: {}, rake: rakeC / 100 };
  }
  const val: Record<string, HandValue> = Object.fromEntries(live.map((p) => [p, rank7([...cardsOf(p), ...board])]));
  const top = (ps: readonly string[]) => {
    const b = ps.reduce((m, p) => (cmp(val[p]!, val[m]!) > 0 ? p : m));
    return ps.filter((p) => cmp(val[p]!, val[b]!) === 0).sort((x, y) => post.indexOf(x) - post.indexOf(y));
  };
  const side = sidePots(invC, live, allin);
  // each pot short its share of the rake; the cents rounding leaves go to the main pot
  const net = side.map((x) => Math.floor((x.amount * netC) / totalC));
  net[0]! += netC - sum(net);
  const pots = side.map((x, i) => {
    const w = top(x.eligible);
    const share = Math.floor(net[i]! / w.length);
    let odd = net[i]! - share * w.length;
    for (const p of w) {
      payC[p] = (payC[p] ?? 0) + share + (odd > 0 ? 1 : 0);
      odd--;
    }
    return { amount: net[i]! / 100, eligible: x.eligible, winners: w };
  });
  return { pays: toBb(payC), pots, winners: top(live), val, rake: rakeC / 100 };
}

// ---- dealing

export const DECK: readonly string[] = [..."AKQJT98765432"].flatMap((r) => [..."shdc"].map((s) => r + s));

/** A seeded generator in [0, 1) (mulberry32), so a hand can be dealt again from its seed. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Deal {
  /** each seat's two cards */
  hands: Record<string, [string, string]>;
  /** the five board cards, dealt as the streets come */
  board: string[];
}

/** Every seat's cards and the board, from one shuffled deck. */
export function deal(players: number, rnd: () => number = Math.random): Deal {
  const deck = [...DECK];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  const hands: Record<string, [string, string]> = {};
  for (const p of seatsOf(players)) hands[p] = [deck.pop()!, deck.pop()!];
  return { hands, board: deck.slice(0, 5) };
}
