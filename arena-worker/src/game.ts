// One heads-up no-limit hold'em hand, dealt and run by the server. The rules are Lizard's own table engine
// (web/src/poker/table.ts: blinds, the smallest raise, an all-in for less that doesn't reopen the betting, the bet nobody
// matched given back, side pots, and settlement to the cent), the same code Practice and Analyze replay hands with; this
// file only deals, keeps the hidden cards, and says when the board comes. Everything here is plain data, so the Durable
// Object can store a hand mid-street and pick it up after it hibernates.
import { handName } from "../../web/src/poker/evaluate";
import { legal, NEED, noLines, recordOf, settle, simulate, withMove, type Lines, type Move, type Sim, type TableSetup } from "../../web/src/poker/table";
import type { ArenaAction } from "../../web/src/features/arena/protocol";

export type Pos = "SB" | "BB";
export type SeatNo = 0 | 1;
export const other = (s: SeatNo): SeatNo => (s === 0 ? 1 : 0);

export interface HandResult {
  /** chips won or lost by seat over the hand, bb */
  net: [number, number];
  /** what each blind collected */
  pays: Record<Pos, number>;
  winners: SeatNo[];
  /** each live hand's name at a showdown */
  names: Partial<Record<Pos, string>>;
  timedOut?: SeatNo;
}

export interface Hand {
  n: number;
  startedAt: number;
  /** the seat on each blind (the small blind is the button) */
  seatOf: Record<Pos, SeatNo>;
  /** both blinds start with this many big blinds */
  stack: number;
  /** hole cards: never sent to the other seat until `reveal` */
  hole: Record<Pos, [string, string]>;
  /** all five board cards, drawn at the deal: only the first `shown` are ever sent */
  board: string[];
  shown: number;
  lines: Lines;
  /** both hands face up: a showdown, or all in with the board to run */
  reveal: boolean;
  /** when the decision now pending started (server clock) */
  turnFrom: number | null;
  result: HandResult | null;
}

export const setupOf = (h: Pick<Hand, "stack">): TableSetup => ({ players: 2, stacks: { SB: h.stack, BB: h.stack } });
export const simOf = (h: Hand): Sim => simulate(setupOf(h), h.lines, h.shown);
export const posOf = (h: Pick<Hand, "seatOf">, s: SeatNo): Pos => (h.seatOf.SB === s ? "SB" : "BB");

/** A new hand from a shuffled deck: the small blind's two cards, the big blind's, then the board's five. */
export function deal(n: number, button: SeatNo, stack: number, deck: readonly string[], now: number): Hand {
  if (deck.length < 9 || new Set(deck).size !== deck.length) throw new Error("deal: a bad deck");
  const h: Hand = {
    n,
    startedAt: now,
    seatOf: { SB: button, BB: other(button) },
    stack,
    hole: { SB: [deck[0]!, deck[1]!], BB: [deck[2]!, deck[3]!] },
    board: deck.slice(4, 9),
    shown: 0,
    lines: noLines(),
    reveal: false,
    turnFrom: null,
    result: null,
  };
  advance(h, now);
  return h;
}

/** Deals the board as streets close, runs it out when nobody's left to bet, and settles the hand when it's over. */
function advance(h: Hand, now: number): void {
  for (;;) {
    const sim = simOf(h);
    if (sim.handOver) {
      finish(h, sim);
      return;
    }
    if (sim.waiting && !sim.toAct) {
      if (sim.runout) h.reveal = true;
      h.shown = NEED[sim.waiting];
      continue;
    }
    h.turnFrom = now;
    return;
  }
}

function finish(h: Hand, sim: Sim): void {
  const live = [...sim.active] as Pos[];
  if (live.length > 1) h.reveal = true;
  const board = h.board.slice(0, h.shown);
  const s = settle(setupOf(h), sim.invested, live, sim.allin, board, (p) => h.hole[p as Pos]);
  const pays: Record<Pos, number> = { SB: s.pays.SB ?? 0, BB: s.pays.BB ?? 0 };
  const netOf = (p: Pos) => Math.round((pays[p] - (sim.invested[p] ?? 0)) * 100) / 100;
  const net: [number, number] = [0, 0];
  net[h.seatOf.SB] = netOf("SB");
  net[h.seatOf.BB] = netOf("BB");
  const names: HandResult["names"] = {};
  if (live.length > 1) for (const p of live) names[p] = handName(s.val[p]!, s.val[p === "SB" ? "BB" : "SB"]);
  h.turnFrom = null;
  h.result = { net, pays, winners: (s.winners as Pos[]).map((p) => h.seatOf[p]), names };
}

/** The seat to act, or null. */
export function toActOf(h: Hand): SeatNo | null {
  if (h.result) return null;
  const p = simOf(h).toAct as Pos | null;
  return p ? h.seatOf[p] : null;
}

export type ActError = "not_your_turn" | "illegal";

/** `seat` makes a move: the move as recorded, or why it's refused. A size is taken as the table engine takes a typed one
 * (to the half big blind, the smallest raise and all-in to the cent). */
export function act(h: Hand, seat: SeatNo, a: { action: ArenaAction; to?: number }, now: number): Move | ActError {
  if (h.result) return "not_your_turn";
  const sim = simOf(h);
  const p = posOf(h, seat);
  if (sim.toAct !== p || !sim.current) return "not_your_turn";
  if ((a.action === "bet" || a.action === "raise") && !(typeof a.to === "number" && Number.isFinite(a.to) && a.to > 0)) return "illegal";
  const m = recordOf(setupOf(h), sim, a.to === undefined ? { action: a.action } : { action: a.action, to: a.to });
  if (typeof m === "string") return "illegal";
  h.lines = withMove(h.lines, sim.current, m);
  advance(h, now);
  return m;
}

/** The seat to act ran out of time: it checks where it may, else folds. */
export function timeOut(h: Hand, now: number): SeatNo | null {
  const seat = toActOf(h);
  if (seat === null) return null;
  const lg = legal(setupOf(h), simOf(h))!;
  act(h, seat, { action: lg.toCall > 1e-9 ? "fold" : "check" }, now);
  if (h.result) h.result.timedOut = seat;
  return seat;
}

/** The hand's outcome in words, with each seat's name. */
export function says(h: Hand, names: readonly [string, string]): string {
  const r = h.result;
  if (!r) return "";
  const fmt = (x: number) => String(Math.round(x * 100) / 100);
  const won = (s: SeatNo) => fmt(r.pays[posOf(h, s)]);
  const late = r.timedOut !== undefined ? `${names[r.timedOut]} ran out of time. ` : "";
  if (r.winners.length === 2) return `${late}Split pot: ${names[0]} and ${names[1]} each take ${won(0)}bb with ${r.names.SB}.`;
  const w = r.winners[0]!;
  const name = r.names[posOf(h, w)];
  return `${late}${names[w]} wins ${won(w)}bb${name ? ` with ${name}` : ""}.`;
}
