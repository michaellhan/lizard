// The hand being studied, as the Advisor reads it, plus pure helpers: play an action, deal cards, step back, and
// encode/decode the whole line in the URL (so every node is a shareable deep link).
// Semantics follow the upstream Study panel (solver/gto/static/study.js: fresh, parseLine, play, deal, back).
import type { AdvisorAction, AdvisorActionStat, AdvisorResponse, AdvisorState } from "@/solver/protocol";
import { kindOf } from "@/components/actions";
import { parseCards } from "@/engine/nlhe/cards";
import { setupFromParams, setupRequest, setupToParams, type SpotSetup } from "@/features/solve/setup";
import { encodePfSizes, parsePfSizes, pfSizesRequest, tidyPfSizes, type PfSizes } from "./pfSizes";

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
  /** the preflop solve's raise sizes where they aren't the defaults (pfSizes.ts; the Solver source only) */
  pfSizes?: PfSizes;
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
    ...(h.pf === "solver" && streetOf(h) === "preflop" ? { preflop_solve: true, ...pfSizesRequest(h.pfSizes) } : {}),
  };
}

/** The hand with preflop's source set: the charts (no `pf`, and no solve sizes) or the Solver source (kept in the URL
 * as pf=solver). */
export function withPf(h: StudyHand, v: "charts" | "solver"): StudyHand {
  const rest = { ...h };
  delete rest.pf;
  delete rest.pfSizes;
  return v === "solver" ? { ...rest, pf: "solver", ...(h.pfSizes ? { pfSizes: h.pfSizes } : {}) } : rest;
}

/** The hand with the preflop solve's sizes set (the defaults left out; none: every size the default's). */
export function withPfSizes(h: StudyHand, s: PfSizes | undefined): StudyHand {
  const rest = { ...h };
  delete rest.pfSizes;
  const t = tidyPfSizes(s);
  return t ? { ...rest, pfSizes: t } : rest;
}

/** A new hand (to) with from's preflop source and the solve's sizes. */
export const samePf = (from: StudyHand, to: StudyHand): StudyHand => withPfSizes(withPf(to, from.pf ?? "charts"), from.pf === "solver" ? from.pfSizes : undefined);

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

/** The board without the cards of the street on screen: what a replacement for them can't repeat. */
const boardBefore = (h: StudyHand) => {
  const street = streetOf(h);
  return h.board.slice(0, street === "river" ? 8 : street === "turn" ? 6 : 0);
};

/** The same line on other cards: the street on screen's cards swapped, its actions and everything before kept. */
export const replaceCards = (h: StudyHand, cards: string): StudyHand => ({ ...h, board: boardBefore(h) + cards });

/** readCards and randomCards for that swap: the street's own cards may come back, the rest of the board can't. */
export const readReplacement = (h: StudyHand, text: string, n: number) => readCards({ ...h, board: boardBefore(h) }, text, n);
export const randomReplacement = (h: StudyHand, n: number, rnd?: () => number) => randomCards({ ...h, board: boardBefore(h) }, n, rnd);

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
  if (h.pf === "solver" && h.pfSizes) q.set("pfs", encodePfSizes(h.pfSizes));
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
    ...(q.get("pf") === "solver" ? { pf: "solver" as const, ...((s) => (s ? { pfSizes: s } : {}))(parsePfSizes(q.get("pfs"))) } : {}),
  };
}

const say = (a: AdvisorAction) => `${a.pos} ${a.action}${a.to !== undefined && a.action !== "call" ? ` ${a.to}` : ""}`;

/** Human-readable line, e.g. "BTN raise 2.5 · BB call · Ks7d2c · BB check". */
export function describeLine(h: StudyHand): string[] {
  const out: string[] = [];
  out.push(...h.preflop.filter((a) => a.action !== "fold").map(say));
  const b = h.board;
  if (b.length >= 6) out.push(b.slice(0, 6), ...h.flop.map(say));
  if (b.length >= 8) out.push(b.slice(6, 8), ...h.turn.map(say));
  if (b.length >= 10) out.push(b.slice(8, 10), ...h.river.map(say));
  return out;
}

// ---- moving along a line. `tip` is the furthest node of the line being walked: stepping back keeps it, so Forward and
// the breadcrumb can go on to what came next; a different action makes a new line. The URL holds the node shown only,
// so a shared link and a reload start with nothing ahead.

/** Every node from the start of the hand to h, h last (each one the back() of the next). */
export function lineOf(h: StudyHand): StudyHand[] {
  const out = [h];
  for (let b = back(h); b; b = back(b)) out.unshift(b);
  return out;
}

const sameNode = (a: StudyHand, b: StudyHand) => toSearch(a) === toSearch(b);

export const onLine = (at: StudyHand, tip: StudyHand): boolean => lineOf(tip).some((n) => sameNode(n, at));

/** The next node from `at` along the line to `tip`. */
export function forward(at: StudyHand, tip: StudyHand): StudyHand | null {
  const nodes = lineOf(tip);
  const i = nodes.findIndex((n) => sameNode(n, at));
  return i < 0 ? null : (nodes[i + 1] ?? null);
}

export interface LineStep {
  label: string;
  /** the seats in a run of folds */
  detail?: string;
  /** the node right after this step */
  hand: StudyHand;
  at: "past" | "here" | "ahead";
}

/** The steps of the line to `tip`, for the breadcrumb: an action or the cards of a street each, and a run of preflop
 * folds as one (split where `at` stands in it, so every step of the line stays reachable from Back or Forward). */
export function lineSteps(at: StudyHand, tip: StudyHand): LineStep[] {
  const nodes = lineOf(tip);
  const here = nodes.findIndex((n) => sameNode(n, at));
  const out: (LineStep & { folds?: string[] })[] = [];
  nodes.forEach((node, i) => {
    const prev = nodes[i - 1];
    if (!prev) return;
    const pos: LineStep["at"] = i < here ? "past" : i === here ? "here" : "ahead";
    const cards = node.board.slice(prev.board.length);
    if (cards) {
      out.push({ label: cards, hand: node, at: pos });
      return;
    }
    const street = streetOf(node);
    const act = node[street].at(-1);
    if (!act) return;
    if (street !== "preflop" || kindOf(act.action) !== "fold") {
      out.push({ label: say(act), hand: node, at: pos });
      return;
    }
    const last = out.at(-1);
    const folds = last?.folds && i - 1 !== here ? [...last.folds, act.pos] : [act.pos];
    const step = { label: folds.length > 1 ? `${folds.length} folds` : say(act), hand: node, at: pos, folds, ...(folds.length > 1 ? { detail: `${folds.join(", ")} fold` } : {}) };
    if (folds.length > 1) out[out.length - 1] = step;
    else out.push(step);
  });
  return out.map(({ label, detail, hand, at: where }) => ({ label, hand, at: where, ...(detail ? { detail } : {}) }));
}

export type StudyKey = { kind: "back" | "forward" | "build" } | { kind: "play"; index: number };

/** The key's meaning on the page: left (or Backspace, as classic Study) and right walk the line, 1-9 play that action,
 * b the range builder (as classic). */
export function studyKey(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): StudyKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey || (e.shiftKey && e.key !== "B")) return null; // (alt+left is the browser's own back)
  if (e.key === "ArrowLeft" || e.key === "Backspace") return { kind: "back" };
  if (e.key === "b" || e.key === "B") return { kind: "build" };
  if (e.key === "ArrowRight") return { kind: "forward" };
  return /^[1-9]$/.test(e.key) ? { kind: "play", index: Number(e.key) - 1 } : null;
}

// where a key belongs to what's focused: every key to a field or the grid (which walks itself with the arrows); the
// single keys also to a link, a button or any other control that a key acts on (WCAG 2.1.4)
const TAKES_ALL_KEYS = 'input, select, textarea, [contenteditable], [role="grid"]';
const TAKES_SINGLE_KEYS = 'a[href], button, summary, [role="button"], [role="link"], [role="tab"], [role="radio"], [role="checkbox"], [role="switch"], [role="slider"], [role="spinbutton"], [role="combobox"], [role="menuitem"], [role="separator"]';

/** Whether a key pressed with focus on `el` is the page's, not the control's: the arrows anywhere but a field or the grid,
 * 1-9, b and Backspace only away from any control. (Enter and Space aren't the page's: a focused button keeps them.) */
export function studyKeyFrom(el: Element | null, key: string): boolean {
  if (!el?.closest) return true; // (the window itself)
  if (el.closest(TAKES_ALL_KEYS)) return false;
  return key.startsWith("Arrow") || !el.closest(TAKES_SINGLE_KEYS);
}

/** What a call costs as a share of the pot it makes: to call / (pot + to call), the answer's pot already holding the
 * bet faced. None with nothing to call, or with per-seat stacks where someone left in has more than the player: the
 * engine's pot then holds chips a short call can't win (101.5bb for a 30bb stack facing a 100bb open, so 22% where
 * the price is about 48%), and this can't tell how much. Plain arithmetic in chips, before rake. */
export function potOdds(h: StudyHand, res: Pick<AdvisorResponse, "actor" | "pot_bb" | "to_call_bb">): number | null {
  const call = res.to_call_bb, pot = res.pot_bb;
  if (!call || call <= 0 || pot === undefined) return null;
  const stacks = h.setup?.stacks;
  if (stacks) {
    const out = new Set(STREETS.flatMap((st) => h[st]).filter((a) => kindOf(a.action) === "fold").map((a) => a.pos));
    const mine = stacks[String(res.actor)] ?? h.stack;
    const live = Object.entries(stacks).filter(([pos]) => !out.has(pos)).map(([, v]) => v);
    if (Math.max(h.stack, ...live) > mine) return null;
  }
  return call / (pot + call);
}
