// What a page may send: one decision as numbers and short labels, never free text. Every field is checked against this
// shape and its caps, and anything else (an unknown key, a newline, a long string, a 12th action) is refused, so the
// proxy can't be used as a general chatbot: the server writes the prompt from these fields (prompt.ts).
import { Refused } from "./http";

/** The body's byte cap. A real decision is well under 2 KB (the largest from the app's builders is about 1.3 KB). */
export const MAX_BODY = 4096;

export const STREETS = ["preflop", "flop", "turn", "river"] as const;
export const WHERE = ["practice", "analyze", "study"] as const;
export const VERDICTS = ["Best", "Correct", "Inaccuracy", "Mistake", "Blunder"] as const;
/** web/src/solver/types.ts ResultSource */
export const SOURCES = [
  "library",
  "library-turn",
  "instant",
  "live",
  "charts",
  "preflop-solve",
  "best-response",
  "profile-solve",
  "node-lock",
  "push-fold",
  "plo-river",
  "rules",
  "equity",
  "unknown",
] as const;
export const EV_IN = ["bb", "prize", "chips"] as const;

export type Street = (typeof STREETS)[number];
export type Source = (typeof SOURCES)[number];

export interface ExplainRequest {
  v: 1;
  where: (typeof WHERE)[number];
  players: number;
  /** the starting stack, bb */
  stackBb: number | null;
  hero: { seat: string | null; cards: string[]; handClass: string | null };
  street: Street;
  board: string[];
  potBb: number | null;
  /** the action so far, one short item each ("UTG raise 2.5", "Ks7d2c", "folded to you") */
  line: string[];
  mix: { action: string; freq: number; ev: number | null }[];
  /** what was taken, on a graded decision */
  took: string | null;
  grade: { verdict: (typeof VERDICTS)[number]; evLossBb: number | null } | null;
  provenance: { source: Source; approximate: boolean; evIn: (typeof EV_IN)[number] };
}

export const CAPS = { line: 24, lineItem: 40, lineWords: 6, mix: 10, label: 32, labelWords: 5 } as const;

const CARD = /^[2-9TJQKA][shdc]$/;
const SEAT = /^[A-Z][A-Z0-9+]{0,5}$/;
const HAND_CLASS = /^[2-9TJQKA]{2}[so]?$/;
/** letters, digits and a few marks: no newline, quote, colon, bracket or angle bracket */
const LABEL = /^[A-Za-z0-9][A-Za-z0-9 .,%+\-/()·]*$/;
const LINE_ITEM = LABEL;

const bad = (field: string) => new Refused(400, "bad_request", { field });

function obj(v: unknown, field: string, keys: readonly string[]): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw bad(field);
  for (const k of Object.keys(v)) if (!keys.includes(k)) throw bad(field ? `${field}.${k}` : k);
  return v as Record<string, unknown>;
}

function oneOf<T extends string>(v: unknown, list: readonly T[], field: string): T {
  if (typeof v !== "string" || !(list as readonly string[]).includes(v)) throw bad(field);
  return v as T;
}

function num(v: unknown, field: string, lo: number, hi: number, nullable = false): number | null {
  if (v === null && nullable) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) throw bad(field);
  return v;
}

function int(v: unknown, field: string, lo: number, hi: number): number {
  const n = num(v, field, lo, hi)!;
  if (!Number.isInteger(n)) throw bad(field);
  return n;
}

function words(v: unknown, field: string, re: RegExp, maxLen: number, maxWords: number): string {
  if (typeof v !== "string" || v.length > maxLen || !re.test(v) || v.trim() !== v || v.split(/\s+/).length > maxWords) throw bad(field);
  return v;
}

const label = (v: unknown, field: string) => words(v, field, LABEL, CAPS.label, CAPS.labelWords);

function cards(v: unknown, field: string, sizes: readonly number[]): string[] {
  if (!Array.isArray(v) || !sizes.includes(v.length)) throw bad(field);
  const out = v.map((c, i) => {
    if (typeof c !== "string" || !CARD.test(c)) throw bad(`${field}[${i}]`);
    return c;
  });
  if (new Set(out).size !== out.length) throw bad(field);
  return out;
}

/** The request, checked: its own copy holding only what the shape allows, or a Refused naming the first bad field. */
export function parseRequest(body: unknown): ExplainRequest {
  const b = obj(body, "", ["v", "where", "players", "stackBb", "hero", "street", "board", "potBb", "line", "mix", "took", "grade", "provenance"]);
  if (b.v !== 1) throw bad("v");
  const hero = obj(b.hero, "hero", ["seat", "cards", "handClass"]);
  const seat = hero.seat === null || hero.seat === undefined ? null : words(hero.seat, "hero.seat", SEAT, 6, 1);
  const heroCards = hero.cards === undefined ? [] : cards(hero.cards, "hero.cards", [0, 2, 4]);
  const handClass = hero.handClass === null || hero.handClass === undefined ? null : words(hero.handClass, "hero.handClass", HAND_CLASS, 3, 1);
  const street = oneOf(b.street, STREETS, "street");
  const board = cards(b.board, "board", [[0, 3, 4, 5][STREETS.indexOf(street)]!]);
  if (new Set([...heroCards, ...board]).size !== heroCards.length + board.length) throw bad("board");
  if (!Array.isArray(b.line) || b.line.length > CAPS.line) throw bad("line");
  const line = b.line.map((x, i) => words(x, `line[${i}]`, LINE_ITEM, CAPS.lineItem, CAPS.lineWords));
  if (!Array.isArray(b.mix) || b.mix.length < 1 || b.mix.length > CAPS.mix) throw bad("mix");
  const mix = b.mix.map((m, i) => {
    const o = obj(m, `mix[${i}]`, ["action", "freq", "ev"]);
    return { action: label(o.action, `mix[${i}].action`), freq: num(o.freq, `mix[${i}].freq`, 0, 1)!, ev: num(o.ev ?? null, `mix[${i}].ev`, -100_000, 100_000, true) };
  });
  const total = mix.reduce((s, m) => s + m.freq, 0);
  if (total > 1.02) throw bad("mix");
  let grade: ExplainRequest["grade"] = null;
  if (b.grade !== null && b.grade !== undefined) {
    const g = obj(b.grade, "grade", ["verdict", "evLossBb"]);
    grade = { verdict: oneOf(g.verdict, VERDICTS, "grade.verdict"), evLossBb: num(g.evLossBb ?? null, "grade.evLossBb", 0, 100_000, true) };
  }
  const p = obj(b.provenance, "provenance", ["source", "approximate", "evIn"]);
  if (typeof p.approximate !== "boolean") throw bad("provenance.approximate");
  return {
    v: 1,
    where: oneOf(b.where, WHERE, "where"),
    players: int(b.players, "players", 2, 10),
    stackBb: num(b.stackBb ?? null, "stackBb", 0.1, 100_000, true),
    hero: { seat, cards: heroCards, handClass },
    street,
    board,
    potBb: num(b.potBb ?? null, "potBb", 0, 100_000, true),
    line,
    mix,
    took: b.took === null || b.took === undefined ? null : label(b.took, "took"),
    grade,
    provenance: { source: oneOf(p.source, SOURCES, "provenance.source"), approximate: p.approximate, evIn: oneOf(p.evIn, EV_IN, "provenance.evIn") },
  };
}
