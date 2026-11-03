// The hand being studied, as the Advisor reads it, plus pure helpers: play an action, deal cards, step back, and
// encode/decode the whole line in the URL (so every node is a shareable deep link).
// Semantics follow the upstream Study panel (solver/gto/static/study.js: fresh, parseLine, play, deal, back).
import type { AdvisorAction, AdvisorActionStat, AdvisorResponse, AdvisorState } from "@/solver/protocol";
import { kindOf } from "@/components/actions";
import { parseCards } from "@/engine/nlhe/cards";
import { setupFromParams, setupRequest, setupToParams, type SpotSetup } from "@/features/solve/setup";

export type Street = "preflop" | "flop" | "turn" | "river";
export const STREETS: readonly Street[] = ["preflop", "flop", "turn", "river"];

export interface StudyHand {
  players: number;
  stack: number;
  board: string;
  preflop: AdvisorAction[];
  flop: AdvisorAction[];
  turn: AdvisorAction[];
  river: AdvisorAction[];
  /** a spot of your own (the Solve page): per-seat stacks, sizes, rake, ante, straddle, ranges */
  setup?: SpotSetup;
  /** preflop's source: the charts (the default, the advice's) or the engine's class-level solve of the game (pfSolve.ts) */
  pf?: "solver";
}

export function freshHand(players = 6, stack = 100): StudyHand {
  return { players, stack, board: "", preflop: [], flop: [], turn: [], river: [] };
}

export function streetOf(h: Pick<StudyHand, "board">): Street {
  const n = (parseCards(h.board) ?? []).length;
  return n >= 5 ? "river" : n === 4 ? "turn" : n === 3 ? "flop" : "preflop";
}

/** The Advisor request for the node: Study mode, at equilibrium, no hero cards; preflop with the Solver source, the
 * preflop solve's node ("preflop_solve", as study.js request). */
export function studyRequest(h: StudyHand): AdvisorState {
  return {
    players: h.players,
    stack: h.stack,
    board: h.board,
    preflop: h.preflop,
    flop: h.flop,
    turn: h.turn,
    river: h.river,
    ...setupRequest(h.setup, h.players),
    study: true,
    ...(h.pf === "solver" && streetOf(h) === "preflop" ? { preflop_solve: true } : {}),
  };
}

/** The hand with preflop's source set: the charts (no `pf`) or the Solver source (kept in the URL as pf=solver). */
export function withPf(h: StudyHand, v: "charts" | "solver"): StudyHand {
  const rest = { ...h };
  delete rest.pf;
  return v === "solver" ? { ...rest, pf: "solver" } : rest;
}

/** The hand after the actor takes one of the node's actions. */
export function play(h: StudyHand, res: AdvisorResponse, a: AdvisorActionStat): StudyHand {
  const kind = kindOf(a.action);
  const street = (res.street ?? streetOf(h)) as Street;
  const amount = typeof a.amount_bb === "number" ? a.amount_bb : undefined;
  const act: AdvisorAction = {
    pos: String(res.actor),
    action: kind,
    ...((kind === "bet" || kind === "raise") && amount !== undefined ? { to: amount } : {}),
  };
  return { ...h, [street]: [...h[street], act] };
}

export function deal(h: StudyHand, cards: string): StudyHand {
  return { ...h, board: h.board + cards };
}

/** One step back: undo the last action, or the last street's cards if no action followed them. */
export function back(h: StudyHand): StudyHand | null {
  const street = streetOf(h);
  if (h[street].length) return { ...h, [street]: h[street].slice(0, -1) };
  if (street === "preflop") return null;
  const keep = street === "flop" ? 0 : street === "turn" ? 6 : 8;
  return { ...h, board: h.board.slice(0, keep) };
}

/** Cards a "deal" answer asks for. */
export function cardsNeeded(street: string | undefined): number {
  return street === "flop" ? 3 : street === "turn" || street === "river" ? 1 : 0;
}

export function randomCards(h: StudyHand, n: number, rnd: () => number = Math.random): string {
  const used = new Set((parseCards(h.board) ?? []) as string[]);
  const deck: string[] = [];
  for (const r of "AKQJT98765432") for (const s of "shdc") if (!used.has(r + s)) deck.push(r + s);
  let out = "";
  for (let i = 0; i < n; i++) out += deck.splice(Math.floor(rnd() * deck.length), 1)[0];
  return out;
}

/** Validate typed cards for the board: n new cards, none already out. */
export function readCards(h: StudyHand, text: string, n: number): { cards: string } | { error: string } {
  const cs = parseCards(text.replace(/10/g, "T"));
  if (!cs || cs.length !== n) return { error: `type ${n === 1 ? "a card" : `${n} cards`}, like ${n === 1 ? "5s" : "Kd7c2h"}` };
  const used = new Set((parseCards(h.board) ?? []) as string[]);
  if (cs.some((c) => used.has(c))) return { error: "that card is already on the board" };
  return { cards: cs.join("") };
}

// ---- line encoding: "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c" (the library index's preflop format), extended with
// x (check), b<to> (bet), a (all-in) for later streets.
const CODE: Record<string, string> = { fold: "f", call: "c", check: "x", "all-in": "a" };
const DECODE: Record<string, string> = { f: "fold", c: "call", x: "check", a: "all-in" };

export function encodeLine(acts: readonly AdvisorAction[]): string {
  return acts
    .map((a) => {
      const k = kindOf(a.action);
      if (k === "raise") return `${a.pos}:r${a.to ?? ""}`;
      if (k === "bet") return `${a.pos}:b${a.to ?? a.amount ?? ""}`;
      return `${a.pos}:${CODE[k] ?? k}`;
    })
    .join(",");
}

export function parseLine(line: string): AdvisorAction[] {
  return String(line || "")
    .split(",")
    .filter(Boolean)
    .map((t) => {
      const [pos = "", a = ""] = t.split(":");
      if (a[0] === "r") return { pos, action: "raise", to: parseFloat(a.slice(1)) };
      if (a[0] === "b") return { pos, action: "bet", to: parseFloat(a.slice(1)) };
      return { pos, action: DECODE[a[0] ?? ""] ?? a };
    });
}

export function toSearch(h: StudyHand): string {
  const q = new URLSearchParams();
  q.set("p", String(h.players));
  q.set("s", String(h.stack));
  if (h.preflop.length) q.set("pre", encodeLine(h.preflop));
  if (h.board) q.set("b", h.board);
  for (const st of ["flop", "turn", "river"] as const) if (h[st].length) q.set(st, encodeLine(h[st]));
  setupToParams(h.setup, q);
  if (h.pf === "solver") q.set("pf", "solver");
  return q.toString();
}

export function fromSearch(search: string): StudyHand | null {
  const q = new URLSearchParams(search);
  if (!q.has("p")) return null;
  const players = Number(q.get("p"));
  const stack = Number(q.get("s") ?? 100);
  if (!Number.isInteger(players) || players < 2 || players > 9 || !(stack > 0)) return null;
  const raw = q.get("b") ?? "";
  const cards = raw ? parseCards(raw) : [];
  if (!cards) return null;
  const board = cards.join(""); // (normalized: "Ks 7d 2c" -> "Ks7d2c", which deal() and back() count in characters)
  const setup = setupFromParams(q);
  return {
    players,
    stack,
    board,
    preflop: parseLine(q.get("pre") ?? ""),
    flop: parseLine(q.get("flop") ?? ""),
    turn: parseLine(q.get("turn") ?? ""),
    river: parseLine(q.get("river") ?? ""),
    ...(setup ? { setup } : {}),
    ...(q.get("pf") === "solver" ? { pf: "solver" as const } : {}),
  };
}

/** Human-readable line, e.g. "BTN raise 2.5 · BB call · Ks7d2c · BB check". */
export function describeLine(h: StudyHand): string[] {
  const out: string[] = [];
  const say = (a: AdvisorAction) => `${a.pos} ${a.action}${a.to !== undefined && a.action !== "call" ? ` ${a.to}` : ""}`;
  out.push(...h.preflop.filter((a) => a.action !== "fold").map(say));
  const b = h.board;
  if (b.length >= 6) out.push(b.slice(0, 6), ...h.flop.map(say));
  if (b.length >= 8) out.push(b.slice(6, 8), ...h.turn.map(say));
  if (b.length >= 10) out.push(b.slice(8, 10), ...h.river.map(say));
  return out;
}
