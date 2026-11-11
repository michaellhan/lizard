// Turn and river reports (classic runouts.js): at a closed flop or turn, Advisor.study's "runouts" answer as a table
// of every next card: the street's first decision on it (or in position's after a check), each player's EV and
// equity there, per card and averaged by what the card does to the board, by rank or by suit; sortable and filterable
// like the flop reports. A 3-way pot's report has strategies only, no EVs or equities. The report is read off a solve
// of the street that closed (a live one, or a library flop's stored turns), never the dealt street's own solve.
import type { AdvisorAction } from "@/solver/protocol";
import type { SolveMode, TransportKind } from "@/solver/types";
import { MODE_BUDGETS } from "@/solver/client";
import type { StudyHand } from "./studyState";

const RANKS = "23456789TJQKA";
const SUITS = "shdc";
const rv = (c: string) => RANKS.indexOf(c[0]!);
const cardsOf = (b: string) => b.match(/../g) ?? [];
const ok = (x: number | null | undefined): x is number => x != null && Number.isFinite(x);

/** one part of the report: a decision on each card class (a rank's cards alike, a flush suit's apart) */
export interface RunoutPart {
  actor: string;
  actions: string[];
  /** the mix over every card */
  avg: number[];
  /** per class: a card of it, its cards, the mix, the acting range there (w), and (stored turns with EVs) each
   * action's EV for the hands that take it */
  cards: { card: string; cards: string[]; f: number[]; w?: number; ev?: (number | null)[] | null }[];
}
/** a flop line a library flop's stored turns hold, and how often the flop solve takes it */
export interface FlopLine {
  flop: AdvisorAction[];
  share: number;
  path?: string[];
}
export interface RunoutReport {
  study: "runouts";
  street: "turn" | "river";
  first: RunoutPart;
  after_check: RunoutPart | null;
  seats: string[];
  pot_bb?: number;
  /** per card off the board: its chance given both ranges, the range equities, each player's EV (null: none) */
  cards?: { card: string; p: number | null; eq: number[] | null; ev: number[] | null }[];
  /** "solve": a live solve of the street that closed; "store": the flop library's stored turns */
  source: "solve" | "store";
  solver?: { iterations?: number; exploitability_pct?: number; by?: string };
  multiway?: boolean;
  lines?: FlopLine[];
  line?: number;
  tournament?: unknown;
}
/** nothing in hand to read the report off ("runouts": "held"): the street must be solved, or a stored line picked */
export interface RunoutSkipped {
  study: "runouts";
  street: string;
  skipped: string;
  lines?: FlopLine[];
}

// What a card does to the board, the first of these that holds: completes a flush (a third card of its suit on the
// board, or more), completes a straight (a straight's five ranks hold it and two board ranks or more, the ace low
// too), pairs the board, an overcard (above every board card), an undercard (below the top card, above the
// lowest) or a brick (below every board card).
export type CardClass = "over" | "under" | "brick" | "pair" | "straight" | "flush";
export const CLASSES: Record<CardClass, string> = {
  over: "Overcards",
  under: "Undercards",
  brick: "Bricks",
  pair: "Pairs the board",
  straight: "Completes a straight",
  flush: "Completes a flush",
};
export const SHORT: Record<CardClass, string> = { over: "overcard", under: "undercard", brick: "brick", pair: "pairs", straight: "straight", flush: "flush" };
export function cardClass(board: string, card: string): CardClass {
  const bs = cardsOf(board);
  if (bs.filter((c) => c[1] === card[1]).length >= 2) return "flush";
  const r = rv(card);
  const ranks = [...new Set(bs.map(rv))];
  if (ranks.includes(r)) return "pair";
  const at = (x: number) => (x === 12 ? [12, -1] : [x]);
  for (let s = -1; s <= 8; s++) {
    const inW = (x: number) => at(x).some((y) => y >= s && y <= s + 4);
    if (inW(r) && ranks.filter(inW).length >= 2) return "straight";
  }
  return r > Math.max(...ranks) ? "over" : r < Math.min(...ranks) ? "brick" : "under";
}

export type RunoutGroup = "cls" | "rank" | "suit";
export const GROUPS: Record<RunoutGroup, string> = { cls: "What it does", rank: "Rank", suit: "Suit" };
const LABELS: Record<RunoutGroup, Record<string, string>> = {
  cls: CLASSES,
  rank: Object.fromEntries([...RANKS].reverse().map((r) => [r, r === "T" ? "Tens" : `${r}s`])),
  suit: { s: "♠ Spades", h: "♥ Hearts", d: "♦ Diamonds", c: "♣ Clubs" },
};
const ORDER: Record<RunoutGroup, string[]> = { cls: Object.keys(CLASSES), rank: [...RANKS].reverse(), suit: [...SUITS] };

/** whose decision: "first" (the street's first) or "after" (in position after a check, where there is one) */
export type RunoutWho = "first" | "after";
export const partOf = (ro: RunoutReport, who: RunoutWho): RunoutPart => (who === "after" && ro.after_check ? ro.after_check : ro.first);

export interface RunoutRow {
  card: string;
  cls: CardClass;
  rank: string;
  suit: string;
  /** the part's mix on the card; null where none */
  f: number[] | null;
  /** its player's range there */
  w: number;
  /** each action's EV for the hands that take it (stored turns with EVs); else null */
  fe: (number | null)[] | null;
  /** the card's chance */
  p: number | null;
  eq: number[] | null;
  /** [out of position, in position]; null: none */
  ev: number[] | null;
}

/** one row per card off the board */
export function rows(ro: RunoutReport, who: RunoutWho, board: string): RunoutRow[] {
  const part = partOf(ro, who);
  const by = new Map<string, RunoutPart["cards"][number]>();
  for (const c of part.cards) for (const x of c.cards) by.set(x, c);
  const cards = ro.cards ?? [...by.keys()].map((card) => ({ card, p: null, eq: null, ev: null }));
  return cards.map((x) => {
    const c = by.get(x.card);
    return {
      card: x.card,
      cls: cardClass(board, x.card),
      rank: x.card[0]!,
      suit: x.card[1]!,
      f: c ? c.f : null,
      w: c ? (c.w ?? 1) : 0,
      fe: c?.ev ? c.ev : null,
      p: x.p,
      eq: x.eq,
      ev: x.ev,
    };
  });
}

export type RunoutFilter = Partial<Record<RunoutGroup, string>>;
export const filterRows = (rs: readonly RunoutRow[], flt: RunoutFilter) =>
  rs.filter((r) => Object.entries(flt).every(([k, v]) => !v || r[k as RunoutGroup] === v));

// sort keys: "card" (rank, then suit), "a<i>" (the i-th action's frequency), "ev0", "ev1", "eq0", "eq1"
function sortKey(r: RunoutRow, key: string): number {
  if (key === "card") return rv(r.card) * 4 + (3 - SUITS.indexOf(r.suit));
  const m = /^(ev|eq|a)(\d+)$/.exec(key);
  if (!m) return 0;
  const src = m[1] === "a" ? r.f : r[m[1] as "ev" | "eq"];
  const x = src?.[Number(m[2])];
  return ok(x) ? x : -Infinity;
}
export function sortRows(rs: readonly RunoutRow[], key: string, desc: boolean): RunoutRow[] {
  const s = desc ? -1 : 1;
  return [...rs].sort((a, b) => (sortKey(a, key) - sortKey(b, key)) * s || sortKey(b, "card") - sortKey(a, "card"));
}

export interface RunoutAverage {
  n: number;
  /** the cards' chance together */
  p: number;
  /** by the acting range on each card */
  f: number[] | null;
  /** by the cards' chances */
  ev: number[] | null;
  eq: number[] | null;
}
export function average(rs: readonly RunoutRow[]): RunoutAverage {
  const out: RunoutAverage = { n: rs.length, p: 0, f: null, ev: null, eq: null };
  let wf = 0;
  let pe = 0;
  let pq = 0;
  for (const r of rs) {
    const p = ok(r.p) ? r.p : 1 / rs.length;
    out.p += p;
    if (r.f && r.w > 0) {
      const f = (out.f ??= r.f.map(() => 0));
      r.f.forEach((x, i) => (f[i] = f[i]! + r.w * x));
      wf += r.w;
    }
    if (r.ev) {
      const ev = (out.ev ??= [0, 0]);
      r.ev.forEach((x, i) => (ev[i] = ev[i]! + p * x));
      pe += p;
    }
    if (r.eq) {
      const eq = (out.eq ??= [0, 0]);
      r.eq.forEach((x, i) => (eq[i] = eq[i]! + p * x));
      pq += p;
    }
  }
  if (out.f) out.f = out.f.map((x) => x / wf);
  if (out.ev) out.ev = out.ev.map((x) => x / pe);
  if (out.eq) out.eq = out.eq.map((x) => x / pq);
  return out;
}
export function groups(rs: readonly RunoutRow[], by: RunoutGroup): (RunoutAverage & { g: string; label: string })[] {
  return ORDER[by].map((g) => ({ g, label: LABELS[by][g]!, ...average(rs.filter((r) => r[by] === g)) })).filter((x) => x.n);
}

/** a stored line's flop actions: "check, bet 7.13, call" */
export const lineLabel = (ln: Pick<FlopLine, "flop">) => ln.flop.map((a) => `${a.action}${a.to != null ? ` ${a.to}` : ""}`).join(", ");

// ---- when to offer the report, and how long its solve takes
/** how many saw the flop: the seats that acted preflop less those that folded */
export function sawFlop(h: Pick<StudyHand, "preflop">): number {
  const seats = (f: (a: AdvisorAction) => boolean) => new Set(h.preflop.filter(f).map((a) => a.pos)).size;
  return seats(() => true) - seats((a) => a.action === "fold");
}
/** how many are still in */
export const inPot = (h: Pick<StudyHand, "preflop" | "flop" | "turn" | "river">) =>
  sawFlop(h) - new Set([...h.flop, ...h.turn, ...h.river].filter((a) => a.action === "fold").map((a) => a.pos)).size;
/** the report is offered heads-up, and 3-way where three saw the flop (the 3-way solve's); not 4+ way */
export const offersReport = (h: StudyHand) => inPot(h) < 3 || sawFlop(h) === 3;

/** The seconds a report's solve takes in the browser, as classic measured it (its scripts/bench_browser.mjs ro-*
 * spots, the slowest rounded up), [1 thread, 8 threads], between as t1 - p + p / n (p the part threads split); the
 * local server: the speed's budget for the street (a river's: the turn's, and the flop's if it isn't in hand). */
const RO_SECONDS = { fast: { turn: [2.5, 1.5], river: [7.5, 3] }, accurate: { turn: [4, 1.5], river: [31, 7.5] } } as const;
export function estimate(street: string, mode: SolveMode, transport: TransportKind = "worker", threads = 1): number {
  const speed = mode === "accurate" ? "accurate" : "fast";
  if (transport === "http") {
    const b = MODE_BUDGETS.http[speed];
    return street === "river" ? b[0] + b[1] : b[0];
  }
  const [t1, t8] = RO_SECONDS[speed][street === "river" ? "river" : "turn"];
  const par = ((t1 - t8) * 8) / 7;
  return Math.round((t1 - par + par / Math.max(1, Math.min(8, threads))) * 10) / 10;
}
/** a 3-way report's solve: up to the speed's budget (a flop's at least 15 s); null heads-up */
export function mwSeconds(h: StudyHand, mode: SolveMode, transport: TransportKind = "worker"): number | null {
  if (h.board.length < 6 || inPot(h) < 3) return null;
  const b = MODE_BUDGETS[transport][mode === "accurate" ? "accurate" : "fast"][0];
  return h.board.length === 6 ? Math.max(b, 15) : transport === "http" && mode !== "accurate" ? Math.max(b, 5) : b;
}

// ---- what the numbers are, under the table
export function noteText(ro: RunoutReport): string {
  const s = ro.solver ?? {};
  const river = ro.street === "river";
  const pot = ro.pot_bb != null ? ` (${ro.pot_bb.toFixed(2)}bb pot)` : "";
  const its = `${s.iterations} iterations, ${s.exploitability_pct}% of the pot from equilibrium`;
  if (ro.source === "store") {
    const evs = (ro.cards ?? []).some((c) => c.ev);
    return `Flop library's stored turns (${its}), mixes in 5% steps; ${evs ? `EV in bb${pot}` : "no EVs"}.`;
  }
  if (ro.multiway) {
    const n = ro.seats.length;
    return `Live ${n}-way solve of the ${river ? "turn" : "flop"} (${its}), the ${ro.street}${pot} by hand buckets; ${ro.after_check ? "strategies only" : "first decision only"}, no EVs or equities.`;
  }
  return `Live solve of the ${river ? "turn" : "flop"} (${its}${s.by === "hand buckets" ? `, the ${ro.street} by hand buckets` : ""}). EV in bb${pot}.`;
}
