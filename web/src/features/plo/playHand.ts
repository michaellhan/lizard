// A PLO hand played on a solve, for Practice: two combos dealt from the solve's ranges (each by its weight, the second
// clear of the first's cards), you one seat and the solve the other. The other seat plays its combo's mix as solved;
// each decision of yours is graded against your combo's mix and each action's EV with the best play after it (drill.ts
// gradeAt, Lizard's one scale). When a street closes with chips behind, a card is dealt from those the solve has a game
// for and the next street's strategies are asked of the job that solved it (RiverClient.river): nothing is solved again,
// nothing is guessed. A hand ends on a fold or at showdown, the board run out if it's short (an all-in).
import type { Grade } from "@/grading/grade";
import { cardName, cardsText, parseIds } from "@/engine/plo/cards";
import { handAt } from "@/engine/plo/combos";
import { bestOmaha } from "@/engine/plo/evaluate";
import { SEAT_NAMES, type ResultNode, type RiverResult, type RiverView, type ViewPath } from "@/engine/plo/river/run";
import { gradeAt } from "./drill";

type Seat = 0 | 1;

/** One street of the hand: its strategies, from the solve or a view of it. */
export interface PlayStreet {
  name: "flop" | "turn" | "river";
  board: string;
  /** the pot as the street starts, and what each has behind */
  pot: number;
  stack: number;
  hands: [Int32Array, Int32Array];
  nodes: ResultNode[];
  /** where this street closes with chips behind, and the cards dealt next that have a game */
  closings: readonly { id: number; line: string }[];
  next: readonly string[];
  /** how this street was reached, to ask for the one after it */
  path: { closing?: number; card?: string };
}

export interface PlayLog {
  street: PlayStreet["name"];
  seat: Seat;
  label: string;
  /** yours, graded; null for the solve's, or yours where it can't be (`why`) */
  grade: Grade | null;
  why?: string;
}

export interface PlayEnd {
  how: "fold" | "showdown";
  /** the seat that won, null for a split */
  winner: Seat | null;
  board: string;
  /** the pot at the end */
  pot: number;
  /** your chips won or lost from the start of the street solved first, bb */
  net: number;
  /** the hands at showdown, in words */
  shown?: [string, string];
}

export interface Play {
  hero: Seat;
  /** each seat's hand, by hand index */
  cards: [number, number];
  street: PlayStreet;
  node: ResultNode | null;
  /** what each has put in since the first street solved began, on the streets closed */
  put: [number, number];
  log: PlayLog[];
  end: PlayEnd | null;
  /** where it stopped, in words, when a street after couldn't be had */
  broken?: string;
}

export interface PlayContext {
  result: RiverResult;
  band: string | undefined;
  ask: (path: ViewPath) => Promise<RiverView | null>;
  rand?: () => number;
}

const firstStreet = (r: RiverResult): PlayStreet => ({
  name: r.street,
  board: r.board,
  pot: r.pot,
  stack: r.stack,
  hands: r.hands,
  nodes: r.nodes,
  closings: r.closings ?? [],
  next: r.street === "flop" ? (r.turnCards ?? []) : r.street === "turn" ? (r.riverCards ?? []) : [],
  path: {},
});

/** A pick by weight among `items`; -1 if none has any. */
function pick(n: number, weight: (i: number) => number, rand: () => number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.max(0, weight(i));
  if (!(total > 0)) return -1;
  let r = rand() * total;
  let last = -1;
  for (let i = 0; i < n; i++) {
    const w = Math.max(0, weight(i));
    if (!(w > 0)) continue;
    last = i;
    if ((r -= w) < 0) return i;
  }
  return last;
}

const overlaps = (a: number, b: number) => {
  const x = handAt(a);
  const y = new Set(handAt(b));
  return x.some((c) => y.has(c));
};

const combo = (s: PlayStreet, seat: Seat, hand: number) => s.hands[seat].indexOf(hand);
const byPath = (s: PlayStreet, path: string) => s.nodes.find((n) => n.path === path) ?? null;
const lineAfter = (n: ResultNode, label: string) => `${n.line ? `${n.line}, ` : ""}${SEAT_NAMES[n.player]} ${label}`;

/** Each seat's chips on the street after the action is taken. */
function betsAfter(n: ResultNode, k: number): [number, number] {
  const a = n.actions[k]!;
  const b: [number, number] = [n.bets[0], n.bets[1]];
  if (a.kind === "call") b[n.player] = Math.max(b[0], b[1]);
  else if ((a.kind === "bet" || a.kind === "raise") && a.amount !== undefined) b[n.player] = a.amount;
  return b;
}

/** Deals a hand and plays the solve's moves until it's yours to act. Null when no hand can be dealt. */
export async function startPlay(ctx: PlayContext, hero?: Seat): Promise<Play | null> {
  const rand = ctx.rand ?? Math.random;
  const r = ctx.result;
  const me: Seat = hero ?? (rand() < 0.5 ? 0 : 1);
  const other: Seat = me === 0 ? 1 : 0;
  const mine = pick(r.hands[me].length, (i) => r.weights[me][i]!, rand);
  if (mine < 0) return null;
  const myHand = r.hands[me][mine]!;
  const theirs = pick(r.hands[other].length, (i) => (overlaps(r.hands[other][i]!, myHand) ? 0 : r.weights[other][i]!), rand);
  if (theirs < 0) return null;
  const cards: [number, number] = [0, 0];
  cards[me] = myHand;
  cards[other] = r.hands[other][theirs]!;
  const street = firstStreet(r);
  const play: Play = { hero: me, cards, street, node: byPath(street, ""), put: [0, 0], log: [], end: null };
  return run(play, ctx);
}

/** Your action at the decision, graded, then the solve's moves until it's yours again or the hand is over. */
export async function act(play: Play, k: number, ctx: PlayContext): Promise<Play> {
  const node = play.node;
  if (!node || play.end || node.player !== play.hero) return play;
  return run(await apply(play, k, ctx), ctx);
}

async function run(play: Play, ctx: PlayContext): Promise<Play> {
  const rand = ctx.rand ?? Math.random;
  let p = play;
  while (!p.end && !p.broken && p.node && p.node.player !== p.hero) {
    const n = p.node;
    const c = combo(p.street, n.player, p.cards[n.player]);
    const size = n.weight.length;
    let k = c < 0 ? -1 : pick(n.actions.length, (a) => n.strategy[a * size + c]!, rand);
    if (k < 0) k = 0;
    p = await apply(p, k, ctx);
  }
  return p;
}

function gradeMine(p: Play, n: ResultNode, k: number, band: string | undefined): { grade: Grade | null; why?: string } {
  const c = combo(p.street, p.hero, p.cards[p.hero]);
  const size = n.weight.length;
  if (c < 0 || !(n.weight[c]! > 0)) return { grade: null, why: "the solve doesn't bring your hand here" };
  for (let a = 0; a < n.actions.length; a++) if (!Number.isFinite(n.bestEv[a * size + c]!)) return { grade: null, why: "your hand has no EV here" };
  return { grade: gradeAt(n, c, k, p.street.pot, band) };
}

async function apply(p: Play, k: number, ctx: PlayContext): Promise<Play> {
  const rand = ctx.rand ?? Math.random;
  const n = p.node!;
  const a = n.actions[k]!;
  const mine = n.player === p.hero ? gradeMine(p, n, k, ctx.band) : { grade: null };
  const log = [...p.log, { street: p.street.name, seat: n.player, label: a.label, ...mine }];
  const bets = betsAfter(n, k);
  const child = byPath(p.street, n.path ? `${n.path}.${a.token}` : a.token);
  if (child) return { ...p, node: child, log };
  if (a.kind === "fold") {
    const winner: Seat = n.player === 0 ? 1 : 0;
    // the folder's chips stay in; the winner's unmatched bet comes back
    const matched = Math.min(bets[0], bets[1]);
    const put: [number, number] = [p.put[0] + (n.player === 0 ? bets[0] : matched), p.put[1] + (n.player === 1 ? bets[1] : matched)];
    const pot = p.street.pot + put[0] + put[1] - p.put[0] - p.put[1];
    return { ...p, node: null, log, put, end: settle(p, put, pot, winner, "fold", p.street.board) };
  }
  const put: [number, number] = [p.put[0] + bets[0], p.put[1] + bets[1]];
  const pot = p.street.pot + bets[0] + bets[1];
  const closing = p.street.closings.find((c) => c.line === lineAfter(n, a.label));
  if (!closing) return { ...p, node: null, log, put, end: showdown(p, put, pot, rand) };
  // the street closes with chips behind: a card the solve has a game for, clear of both hands
  const held = new Set([...handAt(p.cards[0]), ...handAt(p.cards[1])].map(cardName));
  const free = p.street.next.filter((c) => !held.has(c));
  if (!free.length) return { ...p, node: null, log, put, broken: "No card is left for the next street." };
  const card = free[Math.floor(rand() * free.length)]!;
  const from = p.street.path;
  const path: ViewPath = from.closing === undefined ? { closing: closing.id, card } : { closing: from.closing, card: from.card!, turnClosing: closing.id, river: card };
  const view = await ctx.ask(path);
  if (!view) return { ...p, node: null, log, put, broken: "The next street is gone from the worker: solve again." };
  const street: PlayStreet = {
    name: view.street,
    board: `${p.street.board}${card}`,
    pot: view.pot,
    stack: view.stack,
    hands: view.hands,
    nodes: view.nodes,
    closings: view.closings ?? [],
    next: view.riverCards ?? [],
    path: from.closing === undefined ? { closing: closing.id, card } : { closing: from.closing, card: from.card! },
  };
  return { ...p, street, node: byPath(street, ""), log, put };
}

function settle(p: Play, put: [number, number], pot: number, winner: Seat | null, how: PlayEnd["how"], board: string, shown?: [string, string]): PlayEnd {
  // net from the first street's start: the pot then was already in, so the winner takes it and the other's chips since
  const start = pot - put[0] - put[1];
  const me = p.hero;
  const net = winner === null ? start / 2 + (put[me === 0 ? 1 : 0] - put[me]) / 2 : winner === me ? start + put[me === 0 ? 1 : 0] : -put[me];
  return { how, winner, board, pot, net: Math.round(net * 100) / 100, ...(shown ? { shown } : {}) };
}

function showdown(p: Play, put: [number, number], pot: number, rand: () => number): PlayEnd {
  const board = parseIds(p.street.board)!;
  const used = new Set([...board, ...handAt(p.cards[0]), ...handAt(p.cards[1])]);
  const deck = Array.from({ length: 52 }, (_, c) => c).filter((c) => !used.has(c));
  while (board.length < 5) board.push(deck.splice(Math.floor(rand() * deck.length), 1)[0]!);
  const v = [bestOmaha(handAt(p.cards[0]), board), bestOmaha(handAt(p.cards[1]), board)];
  const winner: Seat | null = v[0] === v[1] ? null : v[0]! > v[1]! ? 0 : 1;
  return settle(p, put, pot, winner, "showdown", cardsText(board), [cardsText(handAt(p.cards[0])), cardsText(handAt(p.cards[1]))]);
}

export interface PlayTally {
  hands: number;
  decisions: number;
  ok: number;
  /** EV given up, bb, and the sum of its % of the pot */
  loss: number;
  lossPct: number;
  net: number;
}

export const EMPTY_PLAY_TALLY: PlayTally = { hands: 0, decisions: 0, ok: 0, loss: 0, lossPct: 0, net: 0 };

/** A finished hand added to the tally. */
export function tallyPlay(t: PlayTally, p: Play): PlayTally {
  const graded = p.log.flatMap((l) => (l.grade ? [l.grade] : []));
  return {
    hands: t.hands + 1,
    decisions: t.decisions + graded.length,
    ok: t.ok + graded.filter((g) => g.ok).length,
    loss: t.loss + graded.reduce((s, g) => s + g.loss, 0),
    lossPct: t.lossPct + graded.reduce((s, g) => s + g.lossPct, 0),
    net: t.net + (p.end?.net ?? 0),
  };
}
