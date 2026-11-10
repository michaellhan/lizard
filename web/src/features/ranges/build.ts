// The range builder: the actor's strategy painted hand class by hand class, then scored against the answer's.
// Ported from upstream study.js (passiveOf, blankPaint, brush, scoreBuild, grade); the undo history, the locks, single
// combos and the combo-by-combo score are Lizard's. A paint maps each class in the range to a mix (one share per
// action); a RangePaint adds the combos painted apart from their class, and what's locked: locks are part of the paint,
// so each is an undo step like any stroke. No score reads them.
import { classCombos, classOf, expandClass, parseCards, RANKS } from "@/engine/nlhe/cards";
import type { ComboRow, RangeGridData } from "@/solver/protocol";
import { comboName } from "./rangeText";

export type Paint = Record<string, number[]>;

/** The combos with a mix of their own: by class, then by combo's name (`comboName`). The rest play their class's. */
export type ComboPaint = Record<string, Record<string, number[]>>;

export interface RangePaint {
  classes: Paint;
  combos: ComboPaint;
  /** hands locked whole: no brush reaches any of their combos */
  locked?: readonly string[];
  /** combos painted apart and locked, by class. Independent of `locked`: a lock on the hand holds these with the rest
   * of it, and leaves them locked when it goes (`lockClasses`). */
  comboLocks?: Readonly<Record<string, readonly string[]>>;
}

export const rangePaint = (classes: Paint): RangePaint => ({ classes, combos: {} });

/** the brush's share of a hand: all of it, three quarters, half, a quarter */
export const AMOUNTS = [1, 0.75, 0.5, 0.25] as const;

/** What an unpainted hand plays: fold, else check or call (else the first action). */
export function passiveOf(names: readonly string[]): number {
  const i = names.indexOf("fold");
  return i >= 0 ? i : Math.max(0, names.findIndex((n) => n === "check" || n === "call"));
}

/** Every class in the range playing the passive action. */
export function blankPaint(grid: RangeGridData): Paint {
  const d = passiveOf(grid.actions);
  const f: Paint = {};
  for (const [cls, c] of Object.entries(grid.cells)) if (c.w > 0) f[cls] = grid.actions.map((_, a) => (a === d ? 1 : 0));
  return f;
}

/** The solver's own class mixes as a paint (what "Show the solution" fills in). */
export function solutionPaint(grid: RangeGridData): Paint {
  const f: Paint = {};
  for (const [cls, c] of Object.entries(grid.cells)) if (c.w > 0) f[cls] = [...c.f];
  return f;
}

/**
 * A brush plays action `a` at share `t` of a hand, the rest of its mix keeping its proportions. Where the rest is
 * all on `a`, it goes to the passive action `d`, or is spread evenly when the brush is the passive action.
 */
export function brush(mix: readonly number[], a: number, t: number, d: number): number[] {
  const out = mix.map((x, i) => (i === a ? 0 : x));
  const rest = out.reduce((s, x) => s + x, 0);
  if (rest > 1e-9) for (let i = 0; i < out.length; i++) out[i] = out[i]! * ((1 - t) / rest);
  else if (t < 1 && a !== d) out[d] = 1 - t;
  else if (t < 1) for (let i = 0; i < out.length; i++) if (i !== a) out[i] = (1 - t) / (out.length - 1);
  out[a] = t;
  return out;
}

const R = (r: string | undefined) => RANKS.indexOf(r as (typeof RANKS)[number]);
const BROADWAY = (r: string | undefined) => R(r) >= 0 && R(r) <= R("T");

/** Hand shapes the builder paints at once, at any node (preflop too): Lizard's, as classic has no painting aids. */
export const SHAPES: readonly { key: string; label: string; has: (cls: string) => boolean }[] = [
  { key: "pairs", label: "Pairs", has: (c) => c.length === 2 },
  { key: "suited", label: "Suited hands", has: (c) => c[2] === "s" },
  { key: "offsuit", label: "Offsuit hands", has: (c) => c[2] === "o" },
  { key: "broadway", label: "Broadways (both cards T+, no pairs)", has: (c) => c.length === 3 && BROADWAY(c[0]) && BROADWAY(c[1]) },
  { key: "ax", label: "Ace-x (no AA)", has: (c) => c[0] === "A" && c.length === 3 },
  { key: "sc", label: "Suited connectors (AKs to 32s)", has: (c) => c[2] === "s" && R(c[1]) - R(c[0]) === 1 },
];

/** `brush` over some classes, skipping locked ones and classes out of the range. */
export function paintClasses(
  paint: Paint,
  classes: Iterable<string>,
  a: number,
  t: number,
  d: number,
  locked: ReadonlySet<string> = new Set(),
): Paint {
  let out: Paint | null = null;
  for (const cls of classes) {
    const m = paint[cls];
    if (!m || locked.has(cls)) continue;
    out ??= { ...paint };
    out[cls] = brush(m, a, t, d);
  }
  return out ?? paint;
}

/** The brush over each class at its own share (range text's weights: "AKs:0.5" plays the action with half of AKs),
 * skipping locked classes and classes out of the range. */
export function paintWeights(
  paint: Paint,
  weights: Readonly<Record<string, number>>,
  a: number,
  d: number,
  locked: ReadonlySet<string> = new Set(),
): Paint {
  let out: Paint | null = null;
  for (const [cls, t] of Object.entries(weights)) {
    const m = paint[cls];
    if (!m || !(t > 0) || locked.has(cls)) continue;
    out ??= { ...paint };
    out[cls] = brush(m, a, Math.min(1, t), d);
  }
  return out ?? paint;
}

/** Each class's share on action `a`: the hands that play it, as range text's weights. */
export function actionShares(paint: Paint, a: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [cls, m] of Object.entries(paint)) if ((m[a] ?? 0) >= 0.0005) out[cls] = m[a]!;
  return out;
}

const NOTHING: ReadonlySet<string> = new Set();
const sameMix = (x: readonly number[], y: readonly number[]) => x.every((v, a) => Math.abs(v - (y[a] ?? 0)) < 1e-9);

/** `own` with one combo's mix: gone when it's only its class's, as a class left with no combos of its own is. */
function withCombo(own: ComboPaint, cls: string, combo: string, mix: readonly number[] | null, base: readonly number[]): ComboPaint {
  const mine = { ...own[cls] };
  if (mix && !sameMix(mix, base)) mine[combo] = [...mix];
  else delete mine[combo];
  const out = { ...own };
  if (Object.keys(mine).length) out[cls] = mine;
  else delete out[cls];
  return out;
}

export const isComboLocked = (p: RangePaint, cls: string, combo: string) => p.comboLocks?.[cls]?.includes(combo) ?? false;

/** Hands locked or unlocked. The same paint when nothing changes, so no undo step. */
export function lockClasses(p: RangePaint, classes: Iterable<string>, to: boolean): RangePaint {
  const next = new Set(p.locked);
  const had = next.size;
  for (const cls of classes) {
    if (to) next.add(cls);
    else next.delete(cls);
  }
  return next.size === had ? p : { ...p, locked: [...next] };
}

/** A combo locked or unlocked, leaving what's painted as it is. Only a combo painted apart can be locked: one on its
 * class's mix has no mix of its own to hold, and giving it one would turn a class score into a combo score. The same
 * paint when nothing changes, so no undo step. */
export function lockCombo(p: RangePaint, cls: string, combo: string, to: boolean): RangePaint {
  if (isComboLocked(p, cls, combo) === to || (to && !p.combos[cls]?.[combo])) return p;
  const mine = p.comboLocks?.[cls] ?? [];
  const next = to ? [...mine, combo] : mine.filter((c) => c !== combo);
  const comboLocks = { ...p.comboLocks };
  if (next.length) comboLocks[cls] = next;
  else delete comboLocks[cls];
  return { ...p, comboLocks };
}

/** A class-wide brush's reach into a paint: each class's combos of their own take it too, keeping their differences
 * in the rest of the mix, but for locked ones (`classes`: the classes after the brush; `weights`: its share of each
 * class it touched). */
function carry(p: RangePaint, classes: Paint, weights: Readonly<Record<string, number>>, a: number, d: number, locked: ReadonlySet<string>): RangePaint {
  if (classes === p.classes) return p;
  let combos = p.combos;
  for (const [cls, own] of Object.entries(p.combos)) {
    const t = weights[cls];
    if (!(t! > 0) || locked.has(cls) || !classes[cls]) continue;
    for (const [combo, mix] of Object.entries(own)) if (!isComboLocked(p, cls, combo)) combos = withCombo(combos, cls, combo, brush(mix, a, Math.min(1, t!), d), classes[cls]);
  }
  return { ...p, classes, combos };
}

/** `paintClasses` over a RangePaint. */
export function paintRange(p: RangePaint, classes: Iterable<string>, a: number, t: number, d: number, locked: ReadonlySet<string> = NOTHING): RangePaint {
  const list = [...classes];
  return carry(p, paintClasses(p.classes, list, a, t, d, locked), Object.fromEntries(list.map((c) => [c, t])), a, d, locked);
}

/** `paintWeights` over a RangePaint. */
export function paintRangeWeights(p: RangePaint, weights: Readonly<Record<string, number>>, a: number, d: number, locked: ReadonlySet<string> = NOTHING): RangePaint {
  return carry(p, paintWeights(p.classes, weights, a, d, locked), weights, a, d, locked);
}

/** One combo's action `a` set to share `t`, the rest of its mix keeping its proportions (`brush`). The same paint
 * when nothing changes, so no undo step. */
export function setCombo(p: RangePaint, cls: string, combo: string, a: number, t: number, d: number, locked: ReadonlySet<string> = NOTHING): RangePaint {
  const base = p.classes[cls];
  if (!base || locked.has(cls) || isComboLocked(p, cls, combo)) return p;
  const mix = p.combos[cls]?.[combo] ?? base;
  const next = brush(mix, a, t, d);
  return sameMix(next, mix) ? p : { ...p, combos: withCombo(p.combos, cls, combo, next, base) };
}

/** `setCombo` over some combos, as one paint (one undo step): a group painted combo by combo. */
export function paintCombos(p: RangePaint, list: readonly { cls: string; combo: string }[], a: number, t: number, d: number, locked: ReadonlySet<string> = NOTHING): RangePaint {
  return list.reduce((q, { cls, combo }) => setCombo(q, cls, combo, a, t, d, locked), p);
}

/** One combo back on its class's mix (a locked one stays). */
export function clearCombo(p: RangePaint, cls: string, combo: string): RangePaint {
  const base = p.classes[cls];
  return base && p.combos[cls]?.[combo] && !isComboLocked(p, cls, combo) ? { ...p, combos: withCombo(p.combos, cls, combo, null, base) } : p;
}

const hasCombos = (p: RangePaint) => Object.keys(p.combos).length > 0;

/** What the answer tells of combos: their rows, and the board (read off the wire: AdvisorResponse leaves it open). */
export interface ComboAnswer {
  grid: RangeGridData;
  combos?: Record<string, ComboRow[]>;
  board?: unknown;
  pot_bb?: number;
}

const deadCards = (res: ComboAnswer): readonly string[] => (typeof res.board === "string" ? (parseCards(res.board) ?? []) : []);
const onBoard = (combo: string, dead: readonly string[]) => dead.includes(combo.slice(0, 2)) || dead.includes(combo.slice(2, 4));

/** A class's combos in the range: reach above nothing, and clear of the board. All the combo sums run over these. */
function liveRows(res: ComboAnswer, cls: string, dead: readonly string[]): ComboRow[] {
  return (res.combos?.[cls] ?? []).filter((r) => r[1] > 0 && !onBoard(r[0], dead));
}

/** The classes a brush can't change: locked whole, or with every live combo locked (there a brush would change only the
 * class's mix, which nothing plays, for an undo step with nothing to see). What the paint functions' `locked` takes. */
export function heldClasses(p: RangePaint, res: ComboAnswer): ReadonlySet<string> {
  const held = new Set(p.locked);
  const dead = deadCards(res);
  for (const cls of Object.keys(p.comboLocks ?? {})) {
    const live = liveRows(res, cls, dead);
    if (live.length && live.every((r) => isComboLocked(p, cls, comboName(r[0])))) held.add(cls);
  }
  return held;
}

export interface ComboSlot {
  combo: string;
  /** in the range, on the board (or sharing a card with it), or legal and not in the range */
  state: "live" | "blocked" | "out";
  /** the row of a live combo */
  row?: ComboRow;
}

/** Every combo of a class, what it is at this node. Without a board in the answer, a blocked combo reads as out:
 * neither can be painted or counts. */
export function comboSlots(res: ComboAnswer, cls: string): ComboSlot[] {
  const dead = deadCards(res);
  const live = new Map(liveRows(res, cls, dead).map((r) => [comboName(r[0]), r]));
  return expandClass(cls).map((combo) => {
    const row = live.get(combo);
    return row ? { combo, state: "live", row } : { combo, state: onBoard(combo, dead) ? "blocked" : "out" };
  });
}

/**
 * The paint as class mixes: a class with combos of its own at its live combos' reach-weighted mix, blocked combos and
 * combos out of the range not counted. What the grid and the class-level score read; a mean, so it can't stand in
 * for the combos (`scoreByCombo` does).
 */
export function classMixes(p: RangePaint, res: ComboAnswer): Paint {
  const dead = deadCards(res);
  let out: Paint | null = null;
  for (const [cls, own] of Object.entries(p.combos)) {
    const base = p.classes[cls];
    if (!base) continue;
    const sum = base.map(() => 0);
    let W = 0;
    for (const [cards, reach] of liveRows(res, cls, dead)) {
      const m = own[comboName(cards)] ?? base;
      W += reach;
      sum.forEach((_, a) => {
        sum[a]! += reach * (m[a] ?? 0);
      });
    }
    if (!W) continue;
    out ??= { ...p.classes };
    out[cls] = sum.map((x) => x / W);
  }
  return out ?? p.classes;
}

/** Each hand's share on action `a` as range text's weights. A class whose live combos differ is given at the least of
 * them, with the combos above it on their own: a combo beside its class takes the larger weight, so a class weight
 * above a combo's would raise it. */
export function actionHands(p: RangePaint, a: number, res: ComboAnswer): { weights: Record<string, number>; combos: Record<string, number> } {
  const weights = actionShares(p.classes, a);
  const combos: Record<string, number> = {};
  const dead = deadCards(res);
  for (const [cls, own] of Object.entries(p.combos)) {
    const base = p.classes[cls];
    if (!base) continue;
    const shares = liveRows(res, cls, dead).map((r): [string, number] => {
      const c = comboName(r[0]);
      return [c, (own[c] ?? base)[a] ?? 0];
    });
    if (!shares.length) continue;
    const floor = Math.min(...shares.map(([, s]) => s));
    delete weights[cls];
    if (floor >= 0.0005) weights[cls] = floor;
    for (const [c, s] of shares) if (s >= 0.0005 && s - floor >= 0.0005) combos[c] = s;
  }
  return { weights, combos };
}

export interface TextPainted {
  paint: RangePaint;
  /** classes and combos painted */
  hands: number;
  combos: number;
  /** named but out of the range, blocked by the board, or held by a lock */
  out: number;
  blocked: number;
  held: number;
}

/** Range text's hands at their weights, where the answer has combos: a class's whole and a single combo's alone (at
 * the larger of its weight and its class's, as the parsers read it). */
export function paintParsed(p: RangePaint, parsed: { classWeights: Record<string, number>; comboWeights: Record<string, number> }, a: number, d: number, locked: ReadonlySet<string>, res: ComboAnswer): TextPainted {
  const r: TextPainted = { paint: paintRangeWeights(p, parsed.classWeights, a, d, locked), hands: 0, combos: 0, out: 0, blocked: 0, held: 0 };
  for (const [cls, t] of Object.entries(parsed.classWeights)) {
    if (!(t > 0)) continue;
    if (!p.classes[cls]) r.out++;
    else if (locked.has(cls)) r.held++;
    else r.hands++;
  }
  for (const [combo, w] of Object.entries(parsed.comboWeights)) {
    if (!(w > 0)) continue;
    const cls = classOf(combo);
    const state = comboSlots(res, cls).find((s) => s.combo === combo)?.state;
    if (state === "blocked") r.blocked++;
    else if (state !== "live" || !p.classes[cls]) r.out++;
    else if (locked.has(cls) || isComboLocked(p, cls, combo)) r.held++;
    else {
      r.paint = setCombo(r.paint, cls, combo, a, Math.max(w, parsed.classWeights[cls] ?? 0), d, locked);
      r.combos++;
    }
  }
  return r;
}

export interface CellScore {
  /** share of the class played differently, 0..1 (half the L1 distance of the mixes) */
  off: number;
  /** EV given up in bb a combo (null where the answer has no EVs) */
  loss: number | null;
  /** combos of the class in the range */
  combos: number;
}

export interface BuildScore {
  /** one minus the share of the range played differently, combo-weighted */
  acc: number;
  ev_loss_bb: number | null;
  ev_loss_pct: number | null;
  /** each action's share of the range, painted and the solver's */
  mine: number[];
  gto: number[];
  combos: number;
  cells: Record<string, CellScore>;
}

/**
 * A paint against the solver's mix, every class by its combos in the range: accuracy, the EV given up (bb a combo,
 * where the answer has EVs: not preflop), each action's share both ways, and per class its difference and loss.
 */
export function scoreBuild(res: { grid: RangeGridData; pot_bb?: number }, paint: Paint): BuildScore {
  const g = res.grid;
  const n = g.actions.length;
  const d = passiveOf(g.actions);
  const mine = new Array<number>(n).fill(0);
  const gto = new Array<number>(n).fill(0);
  const cells: Record<string, CellScore> = {};
  let W = 0;
  let off = 0;
  let loss = 0;
  let evs = true;
  for (const [cls, c] of Object.entries(g.cells)) {
    if (!(c.w > 0)) continue;
    const m = paint[cls] ?? g.actions.map((_, a) => (a === d ? 1 : 0));
    const wc = c.w * classCombos(cls);
    const diff = 0.5 * m.reduce((s, x, a) => s + Math.abs(x - c.f[a]!), 0);
    let l: number | null = null;
    if (c.ev) {
      const ev = c.ev;
      const of = (f: readonly number[]) => f.reduce((s, x, a) => s + x * ev[a]!, 0);
      l = Math.max(0, of(c.f) - of(m));
      loss += wc * l;
    } else evs = false;
    cells[cls] = { off: diff, loss: l, combos: wc };
    W += wc;
    off += wc * diff;
    m.forEach((x, a) => {
      mine[a]! += wc * x;
      gto[a]! += wc * c.f[a]!;
    });
  }
  const per = (x: number) => (W ? x / W : 0);
  return {
    acc: W ? 1 - off / W : 1,
    ev_loss_bb: evs && W ? loss / W : null,
    ev_loss_pct: evs && W && res.pot_bb ? (100 * loss) / W / res.pot_bb : null,
    mine: mine.map(per),
    gto: gto.map(per),
    combos: W,
    cells,
  };
}

/** The upstream grade labels. */
export function grade(acc: number): "Excellent" | "Good" | "Fair" | "Off" {
  return acc >= 0.9 ? "Excellent" : acc >= 0.8 ? "Good" : acc >= 0.65 ? "Fair" : "Off";
}

/** The classes that differ by at least 5%, most combos played differently first (as upstream: six). */
export function biggestMisses(sc: Pick<BuildScore, "cells">, n = 6): [string, CellScore][] {
  return Object.entries(sc.cells)
    .filter(([, x]) => x.off >= 0.05)
    .sort((a, b) => b[1].off * b[1].combos - a[1].off * a[1].combos)
    .slice(0, n);
}

/** Combo by combo: over the live combos' reach, `cells` each class's own. */
export interface ComboScore extends BuildScore {
  /** the same for the solver's class mixes painted exactly: how far a class-level paint falls short by itself
   * (not the best a class paint can score: another mix can lose less on some classes) */
  ceiling: { acc: number; ev_loss_bb: number | null };
}

/**
 * The paint graded combo by combo against each combo's own mix (and EVs), where the answer has its combos: `own`'s
 * mix where a combo has one, else its class's. A class paint can't tell a flush draw from the same class without one,
 * so even the solver's class mixes painted exactly score under 100% here: that score is given with it, as the
 * reference. The denominator is the reach of the live combos: a combo blocked by the board or out of the range isn't
 * in it. Null unless every class in the range has its combo rows.
 */
export function scoreByCombo(res: ComboAnswer, paint: Paint, own: ComboPaint = {}): ComboScore | null {
  const rows = res.combos;
  if (!rows || !Object.keys(rows).length) return null;
  const g = res.grid;
  const n = g.actions.length;
  const d = passiveOf(g.actions);
  const dead = deadCards(res);
  const mine = new Array<number>(n).fill(0);
  const gto = new Array<number>(n).fill(0);
  const cells: Record<string, CellScore> = {};
  let W = 0;
  const off = [0, 0];
  const loss = [0, 0];
  let evs = true;
  for (const [cls, c] of Object.entries(g.cells)) {
    if (!(c.w > 0)) continue;
    // (a class without its combos: no score, rather than one over part of the range)
    if (!rows[cls]?.length) return null;
    const base = paint[cls] ?? g.actions.map((_, a) => (a === d ? 1 : 0));
    const mixes = own[cls];
    let cw = 0;
    let coff = 0;
    let closs = 0;
    let cev = true;
    for (const [cards, reach, f, ev] of liveRows(res, cls, dead)) {
      const m = mixes?.[comboName(cards)] ?? base;
      const of = ev ? (q: readonly number[]) => q.reduce((s, x, a) => s + x * ev[a]!, 0) : null;
      const diff = (q: readonly number[]) => 0.5 * q.reduce((s, x, a) => s + Math.abs(x - f[a]!), 0);
      const gone = (q: readonly number[]) => (of ? Math.max(0, of(f) - of(q)) : 0);
      W += reach;
      cw += reach;
      coff += reach * diff(m);
      closs += reach * gone(m);
      off[0]! += reach * diff(m);
      off[1]! += reach * diff(c.f);
      loss[0]! += reach * gone(m);
      loss[1]! += reach * gone(c.f);
      if (!of) cev = evs = false;
      m.forEach((x, a) => {
        mine[a]! += reach * x;
        gto[a]! += reach * f[a]!;
      });
    }
    if (cw) cells[cls] = { off: coff / cw, loss: cev ? closs / cw : null, combos: cw };
  }
  if (!W) return null;
  const given = evs ? loss[0]! / W : null;
  return {
    acc: 1 - off[0]! / W,
    ev_loss_bb: given,
    ev_loss_pct: given != null && res.pot_bb ? (100 * given) / res.pot_bb : null,
    mine: mine.map((x) => x / W),
    gto: gto.map((x) => x / W),
    combos: W,
    cells,
    ceiling: { acc: 1 - off[1]! / W, ev_loss_bb: evs ? loss[1]! / W : null },
  };
}

export interface RangeScores {
  cls: BuildScore;
  combo: ComboScore | null;
  /** the score to lead with: combo by combo once any combo is painted on its own (a class mean can hide combos played
   * the wrong way round), else the class score */
  head: BuildScore;
  byCombo: boolean;
}

/** A range paint's scores. */
export function scoreRange(res: ComboAnswer, p: RangePaint): RangeScores {
  const cls = scoreBuild(res, classMixes(p, res));
  const combo = scoreByCombo(res, p.classes, p.combos);
  const byCombo = combo != null && hasCombos(p);
  return { cls, combo, head: byCombo ? combo : cls, byCombo };
}

/** An undo history: each stroke records the paint before it. */
export interface History<T> {
  past: T[];
  now: T;
  future: T[];
}

/** A saved history whose locks stood beside it, from before they were part of the paint: every step keeps them, as an
 * undo left them alone then. */
export function withSavedLocks(h: History<RangePaint>, locked: readonly string[] | undefined): History<RangePaint> {
  if (!locked?.length) return h;
  const keep = (p: RangePaint): RangePaint => (p.locked ? p : { ...p, locked });
  return { past: h.past.map(keep), now: keep(h.now), future: h.future.map(keep) };
}

const DEPTH = 200;

export const historyOf = <T,>(now: T): History<T> => ({ past: [], now, future: [] });
/** a new step (a stroke's start, a fill, a reset): undoable on its own */
export const record = <T,>(h: History<T>, next: T): History<T> =>
  next === h.now ? h : { past: [...h.past, h.now].slice(-DEPTH), now: next, future: [] };
/** a change within the current step (the rest of a drag) */
export const amend = <T,>(h: History<T>, next: T): History<T> => (next === h.now ? h : { ...h, now: next });
export const undo = <T,>(h: History<T>): History<T> =>
  h.past.length ? { past: h.past.slice(0, -1), now: h.past[h.past.length - 1]!, future: [h.now, ...h.future] } : h;
export const redo = <T,>(h: History<T>): History<T> =>
  h.future.length ? { past: [...h.past, h.now], now: h.future[0]!, future: h.future.slice(1) } : h;
