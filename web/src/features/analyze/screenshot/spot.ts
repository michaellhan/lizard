// From what was read to a spot: the form's first values (each marked read, to check, or a default that wasn't read),
// and the form's values to Study's hand (studyState.ts, the same link format Analyze's decisions open). A screenshot
// shows the cards, stacks and pot but not the betting, so the line before the street is the form's choice, said as
// such: a single-raised or 3-bet pot between two seats, and checks on the streets before the one opened.
import { parseCards } from "@/engine/nlhe/cards";
import { orderPost, SEATS, seatLabel } from "@/poker/seats";
import { toSearch, type Street, type StudyHand } from "@/features/study/studyState";
import { LIMITS } from "@/features/solve/setup";
import type { AdvisorAction } from "@/solver/protocol";
import { withMyHand } from "../analyze";
import type { Unit } from "./numbers";
import type { Reading } from "./read";

/** read: from the picture and sure; check: from the picture, not sure; guess: not read, a default to change */
export type Mark = "read" | "check" | "guess";
export interface Field<T> {
  value: T;
  mark: Mark;
}

export type Line = "srp" | "3bet" | "none";

export interface Draft {
  players: Field<number>;
  heroPos: Field<string>;
  /** your cards, "AsKd" */
  hero: Field<string>;
  board: Field<string>;
  /** the big blind in the screenshot's money (unused where the room shows big blinds) */
  bb: Field<string>;
  unit: Unit;
  currency: string;
  /** each seat read, in the screenshot's unit */
  seats: { pos: string | null; amount: number; allIn: boolean; hero: boolean; mark: Mark }[];
  /** the pot as read, in the screenshot's unit */
  pot: Field<string>;
  /** the stack Study plays, bb */
  stack: Field<string>;
  line: Field<Line>;
  opener: Field<string>;
  caller: Field<string>;
  /** the open's size, bb */
  open: Field<string>;
  /** the 3-bet's size, bb */
  threeBet: Field<string>;
  street: Field<Street>;
}

const SURE = 0.6;
const markOf = (conf: number): Mark => (conf >= SURE ? "read" : "check");
const r2 = (x: number) => Math.round(x * 100) / 100;

/** The seat in the big blind's place for an open: the big blind, the small blind heads-up. */
export function defaultPair(players: number, hero: string): { opener: string; caller: string } {
  const seats = SEATS[players] ?? SEATS[6]!;
  if (players === 2) return { opener: "SB", caller: "BB" };
  if (hero === "BB") return { opener: "BTN", caller: "BB" };
  if (hero === seats.at(-1)) return { opener: seats[0]!, caller: hero };
  return { opener: hero, caller: "BB" };
}

/** The form's first values from a reading. */
export function draftOf(r: Reading): Draft {
  const seats = r.layout?.seats ?? [];
  const n = seats.length;
  const players: Field<number> = n >= 2 && n <= 9 ? { value: n, mark: markOf(Math.min(...seats.map((s) => s.stack.conf))) } : { value: 6, mark: "guess" };
  const heroSeat = seats.find((s) => s.hero);
  const heroPos: Field<string> = heroSeat?.pos && r.dealer ? { value: heroSeat.pos, mark: markOf(Math.min(r.dealer.conf, r.hero?.conf ?? 0, heroSeat.stack.conf)) } : { value: players.value === 2 ? "SB" : "BTN", mark: "guess" };
  const hero: Field<string> = r.hero ? { value: r.hero.cards.map((c) => c.code).join(""), mark: markOf(r.hero.conf) } : { value: "", mark: "guess" };
  const boardCards = r.groups.board;
  const board: Field<string> = boardCards.length ? { value: boardCards.map((c) => c.code).join(""), mark: r.groups.boardGap ? "check" : markOf(Math.min(...boardCards.map((c) => c.conf))) } : { value: "", mark: r.cards.length ? "read" : "guess" };
  const bb: Field<string> = r.blinds ? { value: String(r.blinds.value.bb), mark: markOf(r.blinds.conf) } : { value: "", mark: "guess" };
  const inBB = (v: number) => (r.unit === "bb" ? v : r.blinds ? v / r.blinds.value.bb : NaN);
  // the stack: yours against the deepest other seat, as they show (after the hand's bets: a guess at the start)
  const mine = heroSeat ? inBB(heroSeat.stack.amount.value) : NaN;
  const others = seats.filter((s) => !s.hero).map((s) => inBB(s.stack.amount.value)).filter(Number.isFinite);
  const eff = Number.isFinite(mine) && others.length ? Math.min(mine, Math.max(...others)) : NaN;
  const stack: Field<string> = eff >= LIMITS.stack[0] && eff <= LIMITS.stack[1] ? { value: String(r2(eff)), mark: "check" } : { value: "100", mark: "guess" };
  const pair = defaultPair(players.value, heroPos.value);
  const streetOfBoard: Street = boardCards.length >= 3 ? "flop" : "preflop";
  return {
    players,
    heroPos,
    hero,
    board,
    bb,
    unit: r.unit,
    currency: r.currency,
    seats: seats.map((s) => ({ pos: s.pos, amount: s.stack.amount.value, allIn: s.stack.allIn, hero: s.hero, mark: markOf(s.stack.conf) })),
    pot: r.pot ? { value: String(r.pot.value.value), mark: markOf(r.pot.conf) } : { value: "", mark: "guess" },
    stack,
    line: { value: boardCards.length ? "srp" : "none", mark: "guess" },
    opener: { value: pair.opener, mark: "guess" },
    caller: { value: pair.caller, mark: "guess" },
    open: { value: "2.5", mark: "guess" },
    threeBet: { value: pair.caller === "SB" || pair.caller === "BB" ? "10" : "7.5", mark: "guess" },
    // (a turn or river board opens on the flop by default, the rest dealt in Study: a choice, not a reading)
    street: { value: streetOfBoard, mark: boardCards.length === 3 ? "read" : "guess" },
  };
}

/** What the form holds, as plain values (each field's value). */
export type Values = { [K in keyof Draft]: Draft[K] extends Field<infer T> ? T : Draft[K] };
export const valuesOf = (d: Draft): Values => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v && typeof v === "object" && "mark" in v && "value" in v ? v.value : v])) as Values;

const NEED: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };

/** The preflop line the form describes, every seat's action in order. */
function preflopLine(v: Pick<Values, "players" | "line" | "opener" | "caller" | "open" | "threeBet">): AdvisorAction[] {
  if (v.line === "none") return [];
  const order = SEATS[v.players]!;
  const out: AdvisorAction[] = [];
  const opener = order.indexOf(v.opener), other = order.indexOf(v.caller);
  order.forEach((p, i) => {
    if (i === opener) out.push({ pos: p, action: "raise", to: Number(v.open) });
    else if (i === other) out.push(v.line === "3bet" ? { pos: p, action: "raise", to: Number(v.threeBet) } : { pos: p, action: "call" });
    else out.push({ pos: p, action: "fold" });
  });
  if (v.line === "3bet") out.push({ pos: v.opener, action: "call" });
  // (the seats before the opener fold before it; the line above is in seat order already, folds included)
  return out;
}

export interface Spot {
  hand: StudyHand;
  /** your two cards, for Study to mark ("AsKd") */
  hole: string;
  study: string;
  solve: string;
}

/** The spot the form's values make, or what's wrong with them in words. */
export function spotOf(v: Values): { spot: Spot | null; problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  const seats = SEATS[v.players];
  if (!seats) return { spot: null, problems: ["a table of 2 to 9 players"], notes };
  const hole = parseCards(v.hero.replace(/10/g, "T"));
  if (!hole || hole.length !== 2) problems.push("your cards: two different cards, like AsKd");
  const board = v.board.trim() ? parseCards(v.board.replace(/10/g, "T")) : [];
  if (!board || ![0, 3, 4, 5].includes(board.length)) problems.push("the board: none, or 3 to 5 different cards");
  if (hole && board && hole.some((c) => board.includes(c))) problems.push("a card can't be both yours and on the board");
  if (!seats.includes(v.heroPos)) problems.push(`your seat: one of ${seats.join(", ")}`);
  const stack = Number(v.stack);
  if (!(stack >= LIMITS.stack[0] && stack <= LIMITS.stack[1])) problems.push(`the stack: ${LIMITS.stack[0]} to ${LIMITS.stack[1]}bb`);
  const street = v.street;
  if (board && board.length < NEED[street]) problems.push(`the ${street} needs ${NEED[street]} board cards`);
  if (v.line === "none" && street !== "preflop") problems.push("with no preflop line, Study opens preflop");
  if (v.line !== "none") {
    const a = seats.indexOf(v.opener), b = seats.indexOf(v.caller);
    const who = v.line === "3bet" ? "the 3-bettor" : "the caller";
    if (a < 0 || b < 0) problems.push(`the opener and ${who}: seats at this table`);
    else if (b <= a) problems.push(`${who} acts after the opener (${seats.join(", ")})`);
    const open = Number(v.open), three = Number(v.threeBet);
    if (!(open > 1 && open <= stack)) problems.push("the open: more than 1bb, and no more than the stack");
    if (v.line === "3bet" && !(three > open && three <= stack)) problems.push("the 3-bet: more than the open, and no more than the stack");
    if (a >= 0 && b >= 0 && ![v.opener, v.caller].includes(v.heroPos) && street !== "preflop") notes.push(`Your seat (${seatLabel(v.heroPos, v.players)}) isn't one of the two in the pot: Study opens the spot, your cards marked.`);
  }
  if (problems.length || !hole || !board) return { spot: null, problems, notes };
  const pre = preflopLine(v);
  const inPot = v.line === "none" ? [] : orderPost(v.players).filter((p) => p === v.opener || p === v.caller);
  const checks = (s: Street) => (NEED[street] > NEED[s] ? inPot.map((pos) => ({ pos, action: "check" })) : []);
  if (street === "turn" || street === "river") notes.push(`The ${street === "turn" ? "flop" : "flop and turn"} checked through, as the line before it (the screenshot doesn't show the betting).`);
  if (board.length > NEED[street]) notes.push(`Study opens on the ${street}: ${board.slice(NEED[street]).join(" ")} ${board.length - NEED[street] === 1 ? "comes" : "come"} later, dealt in Study.`);
  const hand: StudyHand = {
    players: v.players,
    stack: r2(stack),
    board: board.slice(0, NEED[street]).join(""),
    preflop: street === "preflop" ? [] : pre,
    flop: checks("flop"),
    turn: checks("turn"),
    river: [],
  };
  const q = toSearch(hand);
  const h = hole.join("");
  return { spot: { hand, hole: h, study: withMyHand(`/study?${q}`, h), solve: `/solve?${q}` }, problems, notes };
}
