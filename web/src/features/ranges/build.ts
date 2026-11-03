// The range builder: the actor's strategy painted hand class by hand class, then scored against the answer's.
// Ported from upstream study.js (passiveOf, blankPaint, brush, scoreBuild, grade); the undo history, the locks and
// the combo-by-combo score are Lizard's. A paint maps each class in the range to a mix (one share per action).
import { classCombos } from "@/engine/nlhe/cards";
import type { ComboRow, RangeGridData } from "@/solver/protocol";

export type Paint = Record<string, number[]>;

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
export function biggestMisses(sc: BuildScore, n = 6): [string, CellScore][] {
  return Object.entries(sc.cells)
    .filter(([, x]) => x.off >= 0.05)
    .sort((a, b) => b[1].off * b[1].combos - a[1].off * a[1].combos)
    .slice(0, n);
}

export interface ComboScore {
  acc: number;
  ev_loss_bb: number | null;
  /** the same for the solver's class mixes painted exactly: how far a class-level paint falls short by itself
   * (not the best a class paint can score: another mix can lose less on some classes) */
  ceiling: { acc: number; ev_loss_bb: number | null };
}

/**
 * The paint graded combo by combo against each combo's own mix (and EVs), where the answer has its combos. A class
 * paint can't tell a flush draw from the same class without one, so even the solver's class mixes painted exactly
 * score under 100% here: that score is given with it, as the reference. Null unless every class in the range has
 * its combo rows.
 */
export function scoreByCombo(res: { grid: RangeGridData; combos?: Record<string, ComboRow[]> }, paint: Paint): ComboScore | null {
  const rows = res.combos;
  if (!rows || !Object.keys(rows).length) return null;
  const g = res.grid;
  const d = passiveOf(g.actions);
  let W = 0;
  const off = [0, 0];
  const loss = [0, 0];
  let evs = true;
  for (const [cls, c] of Object.entries(g.cells)) {
    if (!(c.w > 0)) continue;
    // (a class without its combos: no score, rather than one over part of the range)
    const mine = rows[cls];
    if (!mine?.length) return null;
    const both = [paint[cls] ?? g.actions.map((_, a) => (a === d ? 1 : 0)), c.f];
    for (const [, reach, f, ev] of mine) {
      if (!(reach > 0)) continue;
      W += reach;
      both.forEach((m, k) => {
        off[k]! += reach * 0.5 * m.reduce((s, x, a) => s + Math.abs(x - f[a]!), 0);
        if (ev) {
          const of = (q: readonly number[]) => q.reduce((s, x, a) => s + x * ev[a]!, 0);
          loss[k]! += reach * Math.max(0, of(f) - of(m));
        } else evs = false;
      });
    }
  }
  if (!W) return null;
  return {
    acc: 1 - off[0]! / W,
    ev_loss_bb: evs ? loss[0]! / W : null,
    ceiling: { acc: 1 - off[1]! / W, ev_loss_bb: evs ? loss[1]! / W : null },
  };
}

/** An undo history: each stroke records the paint before it. */
export interface History<T> {
  past: T[];
  now: T;
  future: T[];
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
