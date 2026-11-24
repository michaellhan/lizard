// Preflop blockers: which hole cards most change the opponents' continuing range at a preflop node, from the stored
// preflop solve (the Solver source). The solve is a class-level model: it plays each hand class as one and holds a
// seat's range as each class's weight (RangeGridData: the share of its combos present, and its mix), with no card
// removal between the seats. So the opponents' combos here are each class's combos at the class's weight, taken as
// equally likely, and what a hand of ours takes out of them is exact card removal for that model, not for a full
// solve's suits; the figure before is the model's own, which counts no card removal at all.
//
// Two ranges can be read, as postflop (blockers.ts). After a raise of ours: each seat still to act after it, in turn
// as the others fold (each seat's node from the solve, asked for once), its reach and how often it folds, and with
// several of them, how often all fold, taking the seats' cards as apart (the model's own way). Or, where an opponent
// raised before us: the range that took that raise (their reach there times its mix). The charts and the push/fold
// model aren't solves and get a reason, never blockers. Pure; PfBlockersPanel draws it.
import { kindOf } from "@/components/actions";
import { classCombos, expandClass } from "@/engine/nlhe/cards";
import type { AdvisorAction, AdvisorActionStat, AdvisorResponse, RangeGridData } from "@/solver/protocol";
import type { ResultSource } from "@/solver/types";
import { actionTaken } from "./blockers";
import { isAggressive } from "./valueBluff";

export const cardsOf = (combo: string): [string, string] => [combo.slice(0, 2), combo.slice(2, 4)];
const pairKey = (a: string, b: string) => (a < b ? a + b : b + a);

/** An opponent's range at their node, as the model holds it, with the per-card sums card removal is read from. */
export interface PfRange {
  who: string;
  /** combos of the range (each class's combos times its weight) */
  combos: number;
  /** of them, the combos that fold to our raise; null for the range that took their raise (there's no reply) */
  folds: number | null;
  /** per class: its combos in the range and those that fold */
  classes: { cls: string; w: number; f: number }[];
  /** combos and folds holding each card, and each two-card combo's own */
  byCard: ReadonlyMap<string, { w: number; f: number }>;
  byPair: ReadonlyMap<string, { w: number; f: number }>;
}

/** What can be read at this node, or why there are no blockers. */
export type PfBlockerPlan =
  | { kind: "none"; why: string }
  | {
      kind: "ok";
      hero: string;
      /** the ranges on offer: the reply to each raise of ours, and the range of the last opponent who raised */
      reads: PfRead[];
    };

export type PfRead = { kind: "reply"; i: number; name: string } | { kind: "last"; who: string; last: AdvisorAction; at: number; name: string };

const NOT_A_SOLVE: Partial<Record<ResultSource, string>> = {
  charts: "this answer is the preflop charts: hand-written frequencies by hand class with no solve behind them, so card removal read off them would pass a chart off as an equilibrium's range. The Solver source (the class-level preflop solve) has blockers",
  "push-fold": "this answer is the push/fold model, an all-in range by hand class and not a solve of the game, so its ranges aren't read for blockers. The Solver source has them where its tree reaches",
  rules: "this answer came from the betting rules, not a solve",
  equity: "this answer is an equity estimate, not a solve",
  unknown: "this answer came from a source it doesn't name",
};

export function pfBlockerPlan(res: AdvisorResponse, source: ResultSource, line: readonly AdvisorAction[]): PfBlockerPlan {
  const none = (why: string): PfBlockerPlan => ({ kind: "none", why: `No preflop blockers here: ${why}.` });
  if (res.study !== "node" || res.street !== "preflop") return none("this isn't a preflop node");
  if (source !== "preflop-solve") return none(NOT_A_SOLVE[source] ?? "only the class-level preflop solve holds the opponents' ranges hand by hand");
  const hero = String(res.actor ?? "");
  const reads: PfRead[] = (res.actions ?? []).flatMap((a, i) => (isAggressive(a.action) ? [{ kind: "reply" as const, i, name: a.action }] : []));
  // the last raise of another seat's, before us on this line
  for (let at = line.length - 1; at >= 0; at--) {
    const a = line[at]!;
    if (a.pos === hero) break;
    const k = kindOf(a.action);
    if (k === "raise" || k === "bet" || k === "all-in") {
      reads.push({ kind: "last", who: a.pos, last: a, at, name: `${a.pos}'s ${k === "all-in" ? "all-in" : `raise${typeof a.to === "number" ? ` to ${a.to}bb` : ""}`}` });
      break;
    }
  }
  if (!reads.length) return none("there's no raise of ours to answer and no opponent's raise before us to read a range from");
  return { kind: "ok", hero, reads };
}

/** An opponent's range from the answer at their node. `take`: the action of theirs whose range it is (their reach times
 * its mix, no reply); without it their reach as it stands, with how often each class folds. */
export function pfRange(next: AdvisorResponse, opts: { who: string; source: ResultSource; take?: AdvisorAction }): PfRange | { why: string } {
  const none = (why: string) => ({ why: `No preflop blockers here: ${why}.` });
  if (opts.source !== "preflop-solve") return none(`${opts.who}'s node didn't come from the preflop solve`);
  if (next.study !== "node" || next.street !== "preflop" || next.actor !== opts.who) return none(`the next answer isn't ${opts.who}'s to act preflop`);
  const grid: RangeGridData | undefined = next.grid;
  if (!grid || !Object.keys(grid.cells).length) return none(`the answer doesn't list ${opts.who}'s hands`);
  const take = opts.take ? actionTaken((next.actions ?? []) as AdvisorActionStat[], opts.take) : -1;
  if (opts.take && take < 0) return none(`${opts.who}'s raise isn't one of the actions in that answer`);
  const fold = opts.take ? -1 : grid.actions.findIndex((n) => kindOf(n) === "fold");
  const byCard = new Map<string, { w: number; f: number }>();
  const byPair = new Map<string, { w: number; f: number }>();
  const classes: PfRange["classes"] = [];
  let [combos, folds] = [0, 0];
  const add = (m: Map<string, { w: number; f: number }>, k: string, w: number, f: number) => {
    const e = m.get(k) ?? { w: 0, f: 0 };
    e.w += w;
    e.f += f;
    m.set(k, e);
  };
  for (const [cls, c] of Object.entries(grid.cells)) {
    const w = c.w * (take >= 0 ? (c.f[take] ?? 0) : 1);
    if (!(w > 0)) continue;
    const f = fold >= 0 ? w * (c.f[fold] ?? 0) : 0;
    classes.push({ cls, w: w * classCombos(cls), f: f * classCombos(cls) });
    for (const combo of expandClass(cls)) {
      const [a, b] = cardsOf(combo);
      add(byCard, a, w, f);
      add(byCard, b, w, f);
      add(byPair, pairKey(a, b), w, f);
      combos += w;
      folds += f;
    }
  }
  if (!(combos > 0)) return none(`${opts.who} has no hands in that range`);
  return { who: opts.who, combos, folds: fold >= 0 ? folds : null, classes, byCard, byPair };
}

/** What one combo of ours takes out of a range: combos and folding combos holding either card, the combo itself once. */
export function takenOut(r: PfRange, combo: string): { w: number; f: number } {
  const [a, b] = cardsOf(combo);
  const x = r.byCard.get(a) ?? { w: 0, f: 0 };
  const y = r.byCard.get(b) ?? { w: 0, f: 0 };
  const both = r.byPair.get(pairKey(a, b)) ?? { w: 0, f: 0 };
  return { w: x.w + y.w - both.w, f: x.f + y.f - both.f };
}

export interface PfSeatEffect {
  who: string;
  combos: number;
  /** combos taken out, on average over our combos */
  removed: number;
  /** their fold to our raise, before and with our cards out; null for a range with no reply */
  foldBefore: number | null;
  foldAfter: number | null;
  /** of the combos taken out, those that would fold */
  removedFold: number | null;
}

export interface PfEffect {
  /** the hand: a class, or one combo */
  name: string;
  seats: PfSeatEffect[];
  /** with a reply: all the seats fold, before and with our cards out (the seats' cards taken as apart) */
  allBefore: number | null;
  allAfter: number | null;
}

/** How often every seat folds to our raise in the solve, the seats' cards taken as apart; null for a range with no reply. */
export const allFold = (ranges: readonly PfRange[]): number | null =>
  ranges.length && ranges.every((r) => r.folds !== null) ? ranges.reduce((p, r) => p * (r.folds! / r.combos), 1) : null;

/** What a hand of ours does to the ranges: a class (each of its combos alike, as the model has them) or one combo. */
export function pfEffect(ranges: readonly PfRange[], name: string): PfEffect {
  const combos = name.length === 4 ? [name] : expandClass(name);
  const seats = ranges.map((r): PfSeatEffect => {
    let [removed, removedFold, foldAfter] = [0, 0, 0];
    for (const c of combos) {
      const out = takenOut(r, c);
      removed += out.w;
      removedFold += out.f;
      if (r.folds !== null) foldAfter += r.combos - out.w > 0 ? (r.folds - out.f) / (r.combos - out.w) : 0;
    }
    const n = combos.length;
    return {
      who: r.who,
      combos: r.combos,
      removed: removed / n,
      foldBefore: r.folds === null ? null : r.folds / r.combos,
      foldAfter: r.folds === null ? null : foldAfter / n,
      removedFold: r.folds === null ? null : removedFold / n,
    };
  });
  const before = allFold(ranges);
  const replies = before !== null;
  let allAfter = 0;
  if (replies)
    for (const c of combos)
      allAfter += ranges.reduce((p, r) => {
        const out = takenOut(r, c);
        return p * (r.combos - out.w > 0 ? (r.folds! - out.f) / (r.combos - out.w) : 0);
      }, 1);
  return {
    name,
    seats,
    allBefore: before,
    allAfter: replies ? allAfter / combos.length : null,
  };
}

export interface PfRank {
  cls: string;
  /** with a reply: how far all-fold moves, in points of 0..1; else the share of the range taken out */
  move: number;
  effect: PfEffect;
}

/** Every class of our range by how much it moves the ranges: with a reply, how often everyone folds; else how much of
 * the raiser's range it takes out. The most first. */
export function pfRanking(ranges: readonly PfRange[], classes: readonly string[]): PfRank[] {
  return classes
    .map((cls) => {
      const e = pfEffect(ranges, cls);
      const move = e.allBefore !== null ? e.allAfter! - e.allBefore : e.seats.reduce((s, x) => s + x.removed / (x.combos || 1), 0) / (e.seats.length || 1);
      return { cls, move, effect: e };
    })
    .sort((a, b) => b.move - a.move || (a.cls < b.cls ? -1 : a.cls > b.cls ? 1 : 0));
}

/** The opponent's classes a hand takes the most combos out of. */
export function blockedClasses(r: PfRange, name: string, top = 6): { cls: string; removed: number; of: number }[] {
  const combos = name.length === 4 ? [name] : expandClass(name);
  return r.classes
    .map((c) => {
      const theirs = expandClass(c.cls);
      const each = c.w / theirs.length;
      let out = 0;
      for (const mine of combos) {
        const [a, b] = cardsOf(mine);
        out += theirs.filter((t) => t.includes(a) || t.includes(b)).length * each;
      }
      return { cls: c.cls, removed: out / combos.length, of: c.w };
    })
    .filter((x) => x.removed >= 0.05)
    .sort((x, y) => y.removed - x.removed || (x.cls < y.cls ? -1 : 1))
    .slice(0, top);
}
