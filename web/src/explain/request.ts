// What Explain sends: one decision as numbers and short labels, the shape explain-worker/src/schema.ts checks. Never free
// text, never a key: the server writes the prompt. Labels are cut to the schema's characters, words and lengths here, so
// a label the app makes (a "≈", an en dash) can't get a real decision refused. A decision that can't be put in the shape
// (a board that doesn't fit its street) gives null, and the page offers no Explain for it.
import type { DecisionRecord, HandRecord } from "@/data/db";
import { optionLabel, mixOf } from "@/features/practice/practice";
import type { Reviewed } from "@/features/practice/review";
import { describeLine, fromSearch, streetOf, type StudyHand } from "@/features/study/studyState";
import type { Verdict } from "@/grading/grade";
import type { AdvisorResponse } from "@/solver/protocol";
import type { Provenance, ResultSource } from "@/solver/types";

export type Street = "preflop" | "flop" | "turn" | "river";

export interface ExplainRequest {
  v: 1;
  where: "practice" | "analyze" | "study";
  players: number;
  stackBb: number | null;
  hero: { seat: string | null; cards: string[]; handClass: string | null };
  street: Street;
  board: string[];
  potBb: number | null;
  line: string[];
  mix: { action: string; freq: number; ev: number | null }[];
  took: string | null;
  grade: { verdict: Verdict; evLossBb: number | null } | null;
  provenance: { source: ResultSource; approximate: boolean; evIn: "bb" | "prize" | "chips" };
}

/** The schema's caps (explain-worker/src/schema.ts CAPS). */
export const CAPS = { line: 24, lineItem: 40, lineWords: 6, mix: 10, label: 32, labelWords: 5 } as const;

const STREETS: readonly Street[] = ["preflop", "flop", "turn", "river"];
const BOARD_AT: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };
const VERDICTS: readonly Verdict[] = ["Best", "Correct", "Inaccuracy", "Mistake", "Blunder"];
const SOURCES: readonly ResultSource[] = ["library", "library-turn", "instant", "live", "charts", "preflop-solve", "best-response", "profile-solve", "node-lock", "push-fold", "plo-river", "rules", "equity", "unknown"];

/** Cards in any of the app's spellings ("AhKd", "Ah Kd", ["Ah", "Kd"]). */
export const cardsIn = (s: string | readonly string[]): string[] => (typeof s === "string" ? s : s.join(" ")).match(/[2-9TJQKA][shdc]/g) ?? [];

/** A label as the schema takes it: letters, digits and a few marks, at most `words` words and `len` characters. */
export function clean(s: string, len: number = CAPS.label, words: number = CAPS.labelWords): string {
  let out = s
    .replace(/[^A-Za-z0-9 .,%+\-/()·]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^A-Za-z0-9]+/, "")
    .split(" ")
    .slice(0, words)
    .join(" ");
  while (out.length > len) out = out.includes(" ") ? out.slice(0, out.lastIndexOf(" ")) : out.slice(0, len);
  return out.trim();
}

const lineOf = (items: readonly string[]) => items.map((x) => clean(x, CAPS.lineItem, CAPS.lineWords)).filter(Boolean).slice(-CAPS.line);
const seatOf = (s: string | undefined | null) => {
  const u = (s ?? "").toUpperCase().trim();
  return /^[A-Z][A-Z0-9+]{0,5}$/.test(u) ? u : null;
};
const streetIs = (s: string | undefined): Street | null => (STREETS as readonly string[]).includes(s ?? "") ? (s as Street) : null;

function provenanceOf(p: Pick<Provenance, "source" | "approximate" | "evIn"> | null | undefined): ExplainRequest["provenance"] {
  return { source: p && SOURCES.includes(p.source) ? p.source : "unknown", approximate: !!p?.approximate, evIn: p?.evIn ?? "bb" };
}

function mixFrom(rows: readonly { label: string; freq: number; ev: number | null }[]): ExplainRequest["mix"] | null {
  const mix = rows.slice(0, CAPS.mix).map((r) => ({ action: clean(r.label), freq: Math.min(1, Math.max(0, r.freq)), ev: r.ev !== null && Number.isFinite(r.ev) ? Math.round(r.ev * 1000) / 1000 : null }));
  return mix.length && mix.every((m) => m.action) ? mix : null;
}

/** The board as it stood on the street, or null where it hasn't the street's cards. */
function boardAt(cards: readonly string[], street: Street): string[] | null {
  const n = BOARD_AT[street];
  return cards.length >= n ? cards.slice(0, n) : null;
}

/** One of your graded decisions in a full hand (Practice's verdicts). */
export function fromReviewed(e: Reviewed): ExplainRequest | null {
  const street = streetIs(e.d.street);
  const g = e.d.grade;
  if (!street || !g) return null;
  const board = boardAt(cardsIn(e.board), street);
  const h = fromSearch(e.d.study);
  const mix = mixFrom(e.d.mix.map((a) => ({ label: optionLabel(a.action, a.amount), freq: a.freq, ev: e.d.provenance?.evIn === "chips" ? null : a.ev })));
  if (!board || !mix) return null;
  return {
    v: 1,
    where: "practice",
    players: e.players,
    stackBb: h ? h.stack : null,
    hero: { seat: seatOf(e.seat), cards: cardsIn(e.hole), handClass: null },
    street,
    board,
    potBb: e.d.pot,
    line: lineOf(h ? describeLine(h) : e.line.split(/,\s*/)),
    mix,
    took: clean(e.d.chose) || null,
    grade: { verdict: g.verdict, evLossBb: g.byEv ? Math.max(0, g.loss) : null },
    provenance: provenanceOf(e.d.provenance),
  };
}

/** A node in Study: the hand class picked in the grid, or with none picked the whole range's mix. No decision was taken. */
export function fromStudy(h: StudyHand, res: AdvisorResponse, provenance: Provenance, cls: string | null): ExplainRequest | null {
  const street = streetIs(res.street) ?? streetOf(h);
  const board = boardAt(cardsIn(h.board), street);
  const cell = cls ? res.grid?.cells[cls] : undefined;
  const rows = cell
    ? res.grid!.actions.map((action, i) => {
        const amount = (res.actions ?? []).find((a) => a.action === action)?.amount_bb;
        return { label: optionLabel(action, typeof amount === "number" ? amount : undefined), freq: cell.f[i] ?? 0, ev: cell.ev?.[i] ?? null };
      })
    : mixOf(res).map((a) => ({ label: optionLabel(a.action, a.amount), freq: a.freq, ev: a.ev }));
  const mix = mixFrom(rows);
  if (!board || !mix) return null;
  return {
    v: 1,
    where: "study",
    players: h.players,
    stackBb: h.stack,
    hero: { seat: seatOf(res.actor), cards: [], handClass: cell && cls && /^[2-9TJQKA]{2}[so]?$/.test(cls) ? cls : null },
    street,
    board,
    potBb: typeof res.pot_bb === "number" ? res.pot_bb : null,
    line: lineOf(describeLine(h)),
    mix,
    took: null,
    grade: null,
    provenance: provenanceOf(provenance),
  };
}

/** A graded decision of an imported or played hand (Analyze's lists). */
export function fromDecision(d: DecisionRecord, h: HandRecord | undefined): ExplainRequest | null {
  const street = streetIs(d.street);
  if (!street || !h || !d.mix?.length || !VERDICTS.includes(d.verdict as Verdict)) return null;
  const board = boardAt(cardsIn(h.board), street);
  const mix = mixFrom(d.mix.map(([label, freq, ev]) => ({ label, freq, ev })));
  if (!board || !mix) return null;
  return {
    v: 1,
    where: "analyze",
    players: h.players,
    stackBb: null,
    hero: { seat: seatOf(d.pos), cards: cardsIn(h.hole), handClass: null },
    street,
    board,
    potBb: typeof d.pot === "number" ? d.pot : null,
    line: lineOf(d.situation ? d.situation.split(/\s*·\s*/) : []),
    mix,
    took: clean(d.matched ?? d.action) || null,
    grade: { verdict: d.verdict as Verdict, evLossBb: d.evLossBb != null ? Math.max(0, d.evLossBb) : null },
    provenance: { source: SOURCES.includes(d.source as ResultSource) ? (d.source as ResultSource) : "unknown", approximate: /approximate/i.test(d.label ?? ""), evIn: h.tournament ? "prize" : "bb" },
  };
}
