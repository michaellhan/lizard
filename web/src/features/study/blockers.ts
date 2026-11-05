// What a hand takes out of the opponent's range: every opponent combo that shares a card with it, at that combo's own
// weight. This node's answer holds the opponent by hand class alone (opponent_grid: a class's average weight, no
// suits, no categories, no reply), so the combos come from the node where the opponent is the one to act: after a bet
// or raise of ours (same reach, plus their mix against it), or, with neither on offer, the node they just acted at
// (their reach there times the action they took). Either is the engine's own answer, asked for once a hand is picked,
// and is checked against this node's combo count before it's used. Pure; BlockersPanel draws it.
import { kindOf } from "@/components/actions";
import type { AdvisorAction, AdvisorActionStat, AdvisorResponse, Breakdown, ComboRow } from "@/solver/protocol";
import type { ResultSource } from "@/solver/types";
import { streetOf, type StudyHand } from "./studyState";
import { isAggressive, whyNotSolved } from "./valueBluff";

export const cardsOf = (combo: string): [string, string] => [combo.slice(0, 2), combo.slice(2, 4)];

export interface OppHand {
  cards: [string, string];
  /** combos of the range: its reach, already 0..1 of one combo */
  w: number;
  made: string | undefined;
  draw: string | undefined;
  /** equity against our range, where the answer has it */
  eq: number | null;
  /** how often it folds to the action, where there's a reply to read */
  fold: number | null;
}

export interface OppRange {
  who: string;
  rows: OppHand[];
  labels: { made: Record<string, string>; draws: Record<string, string> };
  /** the equity over which a hand counts as value (as valueBluff's line) */
  line: number;
}

/** A hand of ours: its cards and how much of the pick it is (one combo: 1; a whole class: each combo's reach). */
export interface Pick {
  cards: [string, string];
  w: number;
}

export interface Blocked {
  id: string;
  label: string;
  /** combos it takes out */
  removed: number;
  /** combos of the category before */
  of: number;
}

export interface Removal {
  combos: number;
  removed: number;
  /** the opponent's hands over the value line */
  value: { removed: number; of: number } | null;
  /** their reply to the action, whole range and with these hands out; null with no reply to read */
  reply: { before: number; after: number; foldBefore: number; foldAfter: number; removedContinue: number; removedFold: number } | null;
  made: Blocked[];
  draws: Blocked[];
}

/** Below this many combos taken out a category's line is left out: the table shows one decimal, so less reads as 0.0. */
const MIN_COMBOS = 0.05;

/** How much of the opponent the picks take out: each opponent combo counts by the share of the picks that hold one of
 * its cards. Exact for one combo; for a class, the average over its combos by their reach. */
export function removal(range: OppRange, picks: readonly Pick[]): Removal {
  const total = picks.reduce((t, p) => t + p.w, 0) || 1;
  const gone = (h: OppHand) => picks.reduce((t, p) => (h.cards.some((c) => p.cards.includes(c)) ? t + p.w : t), 0) / total;
  let combos = 0;
  let removed = 0;
  let valueOf = 0;
  let valueOut = 0;
  let hasEq = false;
  let folds = 0;
  let foldsOut = 0;
  let replied = false;
  const tally = (m: Map<string, { removed: number; of: number }>, id: string | undefined, w: number, out: number) => {
    if (id === undefined) return;
    const e = m.get(id) ?? { removed: 0, of: 0 };
    e.of += w;
    e.removed += out;
    m.set(id, e);
  };
  const made = new Map<string, { removed: number; of: number }>();
  const draws = new Map<string, { removed: number; of: number }>();
  for (const h of range.rows) {
    const out = h.w * gone(h);
    combos += h.w;
    removed += out;
    tally(made, h.made, h.w, out);
    tally(draws, h.draw, h.w, out);
    if (h.eq != null) {
      hasEq = true;
      if (h.eq > range.line) {
        valueOf += h.w;
        valueOut += out;
      }
    }
    if (h.fold != null) {
      replied = true;
      folds += h.w * h.fold;
      foldsOut += out * h.fold;
    }
  }
  const left = combos - removed;
  const list = (m: Map<string, { removed: number; of: number }>, labels: Record<string, string>): Blocked[] =>
    [...m]
      .filter(([id, e]) => id !== "none" && e.removed >= MIN_COMBOS)
      .map(([id, e]) => ({ id, label: labels[id] ?? id, ...e }))
      .sort((a, b) => b.removed - a.removed);
  return {
    combos,
    removed,
    value: hasEq ? { removed: valueOut, of: valueOf } : null,
    reply:
      replied && combos > 0 && left > 0
        ? {
            before: 1 - folds / combos,
            after: 1 - (folds - foldsOut) / left,
            foldBefore: folds / combos,
            foldAfter: (folds - foldsOut) / left,
            removedContinue: removed - foldsOut,
            removedFold: foldsOut,
          }
        : null,
    made: list(made, range.labels.made),
    draws: list(draws, range.labels.draws),
  };
}

/** Where the opponent's combos can be read, for this node. */
export type BlockerPlan =
  | { kind: "none"; why: string }
  /** after one of our bets or raises: their reach and their reply */
  | { kind: "reply"; who: string; actions: { i: number; name: string }[] }
  /** no bet or raise on offer: the node they just acted at */
  | { kind: "last"; who: string; last: AdvisorAction };

export function blockerPlan(res: AdvisorResponse, bd: Breakdown, hand: StudyHand, source: ResultSource): BlockerPlan {
  const none = (why: string): BlockerPlan => ({ kind: "none", why: `No blockers here: ${why}.` });
  const why = whyNotSolved(source);
  if (why) return none(why);
  if (bd.villains.length !== 1) return none(`the answer holds each hand only for the player to act, and just class totals for the others, so a ${1 + bd.villains.length}-way range can't be read combo by combo`);
  if (!res.combos || !Object.keys(res.combos).length) return none("this answer doesn't list the hands of the range");
  const who = bd.villains[0]!.who;
  const actions = bd.actions.flatMap((name, i) => (isAggressive(name) ? [{ i, name }] : []));
  if (actions.length) return { kind: "reply", who, actions };
  const line = hand[streetOf(hand)];
  const last = line[line.length - 1];
  if (last?.pos === who) return { kind: "last", who, last };
  return none(`there's no bet or raise to answer and no action of ${who}'s on this street to read the range from`);
}

/** The action in `next` that the line took, by kind and size. */
export function actionTaken(next: readonly AdvisorActionStat[], last: AdvisorAction): number {
  const kind = kindOf(last.action);
  return next.findIndex((a) => {
    if (kindOf(a.action) !== kind) return false;
    if ((kind === "bet" || kind === "raise") && typeof last.to === "number") return typeof a.amount_bb === "number" && Math.abs(a.amount_bb - last.to) < 0.01;
    return true;
  });
}

/** The opponent's range from the answer `next`, the node where they act. `last`: the action of theirs that brought us
 * here (their reach there times its mix); without it their reach as it stands, with their reply. `combos`: this node's
 * own count of them, which the range has to match. */
export function opponentRange(next: AdvisorResponse, opts: { who: string; combos: number | undefined; source: ResultSource; line: number; last?: AdvisorAction }): OppRange | { why: string } {
  const none = (why: string) => ({ why: `No blockers here: ${why}.` });
  const why = whyNotSolved(opts.source);
  if (why) return none(why);
  if (next.study !== "node" || next.actor !== opts.who) return none(`the next answer isn't ${opts.who}'s to act`);
  const rows = Object.values(next.combos ?? {}).flat() as ComboRow[];
  if (!rows.length) return none(`the next answer doesn't list ${opts.who}'s hands`);
  const take = opts.last ? actionTaken(next.actions ?? [], opts.last) : -1;
  if (opts.last && take < 0) return none(`${opts.who}'s last action isn't one of the actions in that answer`);
  const fold = opts.last ? -1 : (next.grid?.actions ?? []).findIndex((n) => kindOf(n) === "fold");
  const madeIds = next.categories?.made ?? [];
  const drawIds = next.categories?.draws ?? [];
  const out: OppHand[] = [];
  for (const r of rows) {
    const w = opts.last ? r[1] * (r[2][take] ?? 0) : r[1];
    if (w <= 0) continue;
    out.push({ cards: cardsOf(r[0]), w, made: madeIds[r[5]]?.[0], draw: drawIds[r[6]]?.[0], eq: r[4], fold: fold < 0 ? null : (r[2][fold] ?? 0) });
  }
  const total = out.reduce((t, h) => t + h.w, 0);
  // (the answers round reach to three places and leave out a combo under 5e-4, so the counts can differ a little)
  if (opts.combos == null || Math.abs(total - opts.combos) > Math.max(1, opts.combos * 0.01)) {
    // (the engine widens the range behind a rare line, _walk's smoothing, and this node's answer holds that range by class only)
    if (opts.last && opts.combos != null && opts.combos > total)
      return none(`this node reads ${opts.who}'s range as ${opts.combos.toFixed(1)} combos, wider than the ${total.toFixed(1)} that took that action in the solve, as the engine does for a line it rarely plays, and that wider range isn't held combo by combo`);
    return none(`that answer has ${total.toFixed(1)} combos for ${opts.who}, not this node's ${opts.combos?.toFixed(1) ?? "unknown count"}, so it isn't the same range`);
  }
  return { who: opts.who, rows: out, labels: { made: Object.fromEntries(madeIds), draws: Object.fromEntries(drawIds) }, line: opts.line };
}

/** The picks for a class (`combo` empty: every combo in the range, by reach) or one of its combos. */
export function picksOf(rows: readonly ComboRow[], combo: string): Pick[] {
  const held = rows.filter((r) => r[1] > 0 && (!combo || r[0] === combo));
  return combo ? held.slice(0, 1).map((r) => ({ cards: cardsOf(r[0]), w: 1 })) : held.map((r) => ({ cards: cardsOf(r[0]), w: r[1] }));
}
