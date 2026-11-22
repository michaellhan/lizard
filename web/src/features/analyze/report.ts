// The report over your graded decisions, ported from the classic analyzer (solver/gto/static/session.js tally,
// groupBy, FREQS / freqs, PF_ORDER, report's mistakes and off-chart lists, LEAK / leaks, COLS / toCSV / toJSON), on
// Lizard's grade scale (grading/grade.ts: "in the mix" is Best or Correct). Preflop decisions are graded against the
// stored preflop solve by EV where it reads the spot, else against the charts by frequency with no EV lost, and the two
// are kept apart here, row by row, never added together; after the flop against what answered, by EV where it has EVs, each
// decision saying what that was: the library, a stored turn, a read at once, a Quick or a Fast solve (byBasis keeps them
// apart).
import type { DecisionRecord, HandRecord } from "@/data/db";
import type { GradeWay } from "@/features/history/history";
import { countVersions, versionNote, versionSpan, versionSummary } from "@/grading/version";
import { STREETS } from "./analyze";
import { handKind, type HandKind } from "./sessions";
import { meanTest, okChance, pairTest, Z_ONE, zBar } from "./leakStats";
import { wilson } from "./stats";

const r2 = (x: number) => Math.round(x * 100) / 100;
const OK = new Set(["Best", "Correct"]);
export const VERDICTS = ["Best", "Correct", "Inaccuracy", "Mistake", "Blunder"] as const;

export const isGraded = (d: DecisionRecord) => d.verdict !== "Not graded";
export const isOk = (d: DecisionRecord) => OK.has(d.verdict);
const hasEv = (d: DecisionRecord) => isGraded(d) && d.evLossBb != null;
/** What a decision's EV lost adds to a total, bb and % of the pot: what its verdict counts (grade.ts scored: past the
 * answer's noise, below Correct; nothing for a Best or a Correct), as Practice's score and History count it. A grade kept
 * before noise was (2026-11-18) has its whole loss as measured. */
export const countedBb = (d: Pick<DecisionRecord, "past" | "evLossBb">): number => d.past ?? d.evLossBb ?? 0;
export const countedPct = (d: Pick<DecisionRecord, "pastPct" | "lossPct">): number => d.pastPct ?? d.lossPct ?? 0;
/** The words that say what those totals count, wherever they're shown. */
export const COUNTED_WORDS = "This counts only what each decision below Correct gave up past its answer's noise; each decision still shows the EV it lost as measured. Grades from before 2026-11-18 count all of it.";
const isLow = (d: DecisionRecord) => isGraded(d) && d.confidence === "low";
/** graded by the stored preflop solve, an equilibrium of a class-level model, and not a chart or a solve of your spot */
export const isPfSolve = (d: Pick<DecisionRecord, "source">) => d.source === "preflop-solve";
/** The mark on a row of decisions graded by the preflop solve: a row beside the charts', as the two are never added. */
export const PF_ROW = " (preflop solve)";
export const pfKey = (d: DecisionRecord) => `${d.situation}${isPfSolve(d) ? PF_ROW : ""}`;

export interface Tally {
  /** decisions, graded or not */
  n: number;
  graded: number;
  /** of them Best or Correct */
  ok: number;
  /** graded by EV by a solve of the spot, the EV they lost (bb: what the verdicts count, countedBb) and its average per
   * decision (bb, and % of the pot) */
  ev: number;
  lost: number;
  avg: number | null;
  avgPct: number | null;
  /** the same of those graded by the preflop solve, in none of the four above: never added to them */
  pfEv: number;
  pfLost: number;
  pfAvg: number | null;
  pfAvgPct: number | null;
  by: Record<(typeof VERDICTS)[number], number>;
}

/** EV lost over `n` decisions: in all, and on average per decision (bb, and % of the pot). */
function lossOf(n: number, bb: number, pct: number) {
  const lost = r2(bb);
  return { lost, avg: n ? Math.round((lost / n) * 1000) / 1000 : null, avgPct: n ? Math.round((pct / n) * 10) / 10 : null };
}

// (one pass: this runs for every row of every report, and for each way of a row)
export function tally(ds: readonly DecisionRecord[]): Tally {
  const by = Object.fromEntries(VERDICTS.map((v) => [v, 0])) as Tally["by"];
  const [spot, pf] = [{ n: 0, bb: 0, pct: 0 }, { n: 0, bb: 0, pct: 0 }];
  let [graded, ok] = [0, 0];
  for (const d of ds) {
    if (!isGraded(d)) continue;
    graded++;
    if (isOk(d)) ok++;
    if (d.verdict in by) by[d.verdict as keyof Tally["by"]]++;
    if (!hasEv(d)) continue;
    const t = isPfSolve(d) ? pf : spot;
    t.n++;
    t.bb += countedBb(d);
    t.pct += countedPct(d);
  }
  const s = lossOf(spot.n, spot.bb, spot.pct);
  const p = lossOf(pf.n, pf.bb, pf.pct);
  return { n: ds.length, graded, ok, ev: spot.n, lost: s.lost, avg: s.avg, avgPct: s.avgPct, pfEv: pf.n, pfLost: p.lost, pfAvg: p.avg, pfAvgPct: p.avgPct, by };
}

/** `ways`: a row's graded decisions a way, where more than one way graded them. Then no share or EV lost stands for the
 * whole row, as History's rows have it (history.ts GradeWay: that module reads this one, so the way is told here). */
export type Group = Tally & { key: string; ways?: Partial<Record<GradeWay, Tally>> };

const wayIn = (d: DecisionRecord): GradeWay => (!hasEv(d) ? "freq" : isPfSolve(d) ? "solve" : "ev");

function waysOf(ds: readonly DecisionRecord[]): Group["ways"] {
  const by = new Map<GradeWay, DecisionRecord[]>();
  for (const d of ds) {
    if (!isGraded(d)) continue;
    const w = wayIn(d);
    if (!by.has(w)) by.set(w, []);
    by.get(w)!.push(d);
  }
  return by.size > 1 ? Object.fromEntries([...by].map(([w, rs]) => [w, tally(rs)])) : undefined;
}

/** The decisions grouped by a key: in `order` where given, else the most EV lost to a solve of the spot first, then to the
 * preflop solve (never the two added), then the most decisions. */
export function groupBy(ds: readonly DecisionRecord[], key: (d: DecisionRecord) => string | null | undefined, order?: readonly string[]): Group[] {
  const m = new Map<string, DecisionRecord[]>();
  for (const d of ds) {
    const k = key(d);
    if (k == null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(d);
  }
  const out = [...m].map(([k, rs]): Group => {
    const ways = waysOf(rs);
    return { key: k, ...tally(rs), ...(ways ? { ways } : {}) };
  });
  return order
    ? out.sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99))
    : out.sort((a, b) => b.lost - a.lost || b.pfLost - a.pfLost || b.n - a.n);
}

export const PF_ORDER = ["RFI", "vs limp", "BB vs limp", "vs open", "vs open + call", "SB vs open", "BB defence", "limp vs raise", "vs 3bet", "cold vs 3bet", "vs 4bet+"];

/** a kind of action: fold, check or call, bet or raise; and "vpip", money put in by choice (a call, bet or raise) */
export type Cls = "fold" | "passive" | "aggr" | "vpip";
const clsOf = (action: string): Exclude<Cls, "vpip"> => (/^fold/.test(action) ? "fold" : /^(check|call)/.test(action) ? "passive" : "aggr");
const isVpip = (action: string) => !/^(fold|check)/.test(action);
/** whether an action is of the kind */
export const took = (action: string, cls: Cls) => (cls === "vpip" ? isVpip(action) : clsOf(action) === cls);
/** the answer's mix for your hand by kind of action */
export function mixByClass(d: DecisionRecord): Record<Exclude<Cls, "vpip">, number> {
  const m: Record<Exclude<Cls, "vpip">, number> = { fold: 0, passive: 0, aggr: 0 };
  for (const [a, f] of d.mix ?? []) m[clsOf(a)] += f;
  return m;
}

/** The preflop situations facing one raise. A blind's reads as its BB defence or SB vs open with or without a caller, so
 * a squeeze is told by the callers kept with the decision (grading.ts earlierAt); one kept without them, its hand gone,
 * by its situation, which can only say it of the other seats. */
const THREE_BET = new Set(["vs open", "vs open + call", "SB vs open", "BB defence"]);

/** the answer's share of a kind of action for your hand */
export const shareOf = (d: DecisionRecord, cls: Cls) => (Array.isArray(d.mix) ? d.mix : []).reduce((s, [a, f]) => s + (took(a, cls) ? f : 0), 0);

/** Your frequency of a kind of action against the answer's for the same hands at the same decisions (the classic
 * FREQS and the plan's list). VPIP and PFR are at your first preflop decision of each hand, where the answer's mix is
 * for the same choice (as played they count any preflop decision: Your stats); the check-raise and the river barrel need
 * what you did earlier in the hand, kept with a decision since 2026-11-09 (grading.ts `earlierAt`; an older grade is
 * given it from its history when Analyze opens, `fillEarlier`). */
export const FREQS: readonly [string, Cls, (d: DecisionRecord) => boolean][] = [
  ["VPIP (your first preflop decision)", "vpip", (d) => d.street === "preflop" && d.firstIn === true],
  ["PFR (your first preflop decision)", "aggr", (d) => d.street === "preflop" && d.firstIn === true],
  ["Open (RFI)", "aggr", (d) => d.situation === "RFI"],
  ["BB defence: fold", "fold", (d) => d.situation === "BB defence"],
  ["BB defence: 3bet", "aggr", (d) => d.situation === "BB defence"],
  ["3-bet (any seat)", "aggr", (d) => THREE_BET.has(d.situation ?? "")],
  ["Squeeze (any seat)", "aggr", (d) => THREE_BET.has(d.situation ?? "") && (d.callers ?? (d.situation === "vs open + call" ? 1 : 0)) > 0],
  ["SB vs open: fold", "fold", (d) => d.situation === "SB vs open"],
  ["vs 3bet: fold", "fold", (d) => d.situation === "vs 3bet"],
  ["vs 3bet: 4bet", "aggr", (d) => d.situation === "vs 3bet"],
  ["vs 4bet or more: fold", "fold", (d) => d.situation === "vs 4bet+"],
  ["Flop c-bet", "aggr", (d) => d.street === "flop" && d.role === "PFR" && !d.facing && !d.multi],
  // (not a raise of a bet you made: that's no c-bet. A grade kept before `ownBet` was can't tell)
  ["Flop vs c-bet: fold", "fold", (d) => d.street === "flop" && d.role === "caller" && !!d.facing && !d.multi && !d.ownBet],
  ["Flop vs c-bet: raise", "aggr", (d) => d.street === "flop" && d.role === "caller" && !!d.facing && !d.multi && !d.ownBet],
  ["Flop out of position vs bet: raise", "aggr", (d) => d.street === "flop" && d.ip === false && !!d.facing && !d.multi],
  ["Flop check-raise", "aggr", (d) => d.street === "flop" && d.ownCheck === true && !!d.facing && !d.multi],
  ["Turn barrel", "aggr", (d) => d.street === "turn" && d.role === "PFR" && !!d.flopAggr && !d.facing && !d.multi],
  ["Turn vs bet: fold", "fold", (d) => d.street === "turn" && !!d.facing],
  ["River barrel", "aggr", (d) => d.street === "river" && d.role === "PFR" && !!d.flopAggr && !!d.turnAggr && !d.facing && !d.multi],
  ["River bet", "aggr", (d) => d.street === "river" && !d.facing],
  ["River vs bet: fold", "fold", (d) => d.street === "river" && !!d.facing],
  ["River vs bet: call (bluff-catching)", "passive", (d) => d.street === "river" && !!d.facing],
];

const STREET_NAME: Record<string, string> = { flop: "Flop", turn: "Turn", river: "River" };
const pastOf = countedBb;

/** Your misses, worst first: a graded decision outside the mix (Inaccuracy, Mistake, Blunder), by verdict, then by the EV
 * lost past the answer's noise (what the verdict is on; the EV lost as measured for a grade kept before noise was). */
export const missesOf = (ds: readonly DecisionRecord[]): DecisionRecord[] =>
  ds
    .filter((d) => isGraded(d) && !isOk(d))
    .sort((x, y) => VERDICTS.indexOf(y.verdict as (typeof VERDICTS)[number]) - VERDICTS.indexOf(x.verdict as (typeof VERDICTS)[number]) || pastOf(y) - pastOf(x));

/** A spot after the flop, with its street ("Turn · SRP · IP · checked to"): a pot's flop, turn and river are different
 * spots. Null preflop. */
export const spotOf = (d: DecisionRecord) => (d.street === "preflop" ? null : `${STREET_NAME[d.street]} · ${d.situation}`);

/** What a grade stands on, the most solid first. */
export const BASES = [
  "Preflop charts (by frequency, not a solve)",
  "Flop library",
  "Flop library, another pot's spot",
  "Fast solve",
  "Fast solve, short of its target",
  "Stored turn",
  "Quick solve, settled",
  "Quick solve, not settled",
  "Read at once",
  "Push/fold model (by frequency, not a solve)",
  "Preflop solve (class-level model, by EV, not a full solve)",
];
export function basisOf(d: DecisionRecord): string {
  if (d.source === "charts") return BASES[0]!;
  if (isPfSolve(d)) return BASES[10]!;
  if (d.source === "push-fold") return BASES[9]!;
  if (d.source === "library") return d.approximate || d.label.includes("another table's spot") ? BASES[2]! : BASES[1]!; // (kept before `approximate`: only its label says so)
  if (d.source === "library-turn") return BASES[5]!;
  if (d.source === "instant") return BASES[8]!;
  if (d.confidence) return d.confidence === "low" ? BASES[7]! : BASES[6]!;
  return d.approximate ? BASES[4]! : BASES[3]!;
}

export interface FreqRow {
  label: string;
  cls: Cls;
  n: number;
  /** of them, the times you took it */
  k: number;
  you: number;
  /** your rate's 95% interval */
  range: [number, number];
  gto: number;
  /** the mean square of your action (1 or 0) less that hand's own answer: what a comparison's spread is read from */
  sq: number;
}

export function freqs(ds: readonly DecisionRecord[]): FreqRow[] {
  const rows = ds.filter((d) => isGraded(d) && d.mix);
  const out: FreqRow[] = [];
  const row = (label: string, cls: Cls, rs: readonly DecisionRecord[]) => {
    if (!rs.length) return;
    let [you, gto, sq] = [0, 0, 0];
    for (const d of rs) {
      const [y, m] = [Number(took(d.action, cls)), shareOf(d, cls)];
      you += y;
      gto += m;
      sq += (y - m) ** 2;
    }
    out.push({ label, cls, n: rs.length, k: you, you: you / rs.length, range: wilson(you, rs.length), gto: gto / rs.length, sq: sq / rs.length });
  };
  for (const [label, cls, f] of FREQS) {
    const rs = rows.filter(f);
    // (the charts' frequencies and the solve's are two answers: each its own row)
    row(label, cls, rs.filter((d) => !isPfSolve(d)));
    row(`${label}${PF_ROW}`, cls, rs.filter(isPfSolve));
  }
  return out;
}

/** Under this many a rate is too wide to read: its 95% interval runs some 30 points. */
export const MIN_READ = 30;
/** Under this many a row isn't even listed as too few to read. */
const MIN_THIN = 10;

/** How a leak was read: by the EV a solve of the spot measured past its noise, by the preflop solve's EV (a class-level
 * model), or by frequency alone (the charts, a read with no EVs, and every row of your frequencies). */
export type LeakWay = "ev" | "solve" | "freq";

/** The kind of action that stands out against the answer at a row: your share of it, the answer's for the same hands,
 * and how far apart beyond chance (z). */
export interface Gap {
  cls: Cls;
  you: number;
  gto: number;
  z: number;
}

/** A row read as a leak, or one that looks off but is too few to say (`thin`). `z`: how far its test stands from playing
 * the answer (leakStats.ts), against `bar`, the report's (zBar of every test it made); `cost`: the EV its decisions gave
 * up past their noise in the direction it's off (bb, as the verdicts count it, countedBb), and `bb100` that per 100 hands
 * of the sample read; null where nothing in it has EVs. `low`: how many of its decisions stand on a low-confidence read,
 * which the leak may not survive a check of; `versions`: where its decisions don't stand on one known version, in words;
 * `range`: your rate's 95% interval, or the EV lost per decision's. */
export type Leak = {
  low: number;
  versions: string | null;
  range: [number, number];
  way: LeakWay;
  z: number;
  bar: number;
  cost: number | null;
  bb100: number | null;
  gap?: Gap;
  score: number;
} & (
  | { kind: "freq"; key: string; n: number; you: number; gto: number }
  /** a preflop situation, or a situation from one seat ("RFI · CO"): by frequency, your share in the mix against what
   * playing the answer's own mix would score (`expect`); by the preflop solve, the EV lost per decision (`avg`) */
  | { kind: "pf"; key: string; n: number; inMix: number; expect?: number; avg?: number; against?: string }
  | { kind: "spot"; key: string; n: number; avg: number; lost: number }
);

/** A preflop frequency's row from one seat ("Open (RFI) · CO"), the preflop solve's beside the charts'. */
export const seatKeyOf = (label: string, seat: string, solve: boolean) => `${label} · ${seat}${solve ? PF_ROW : ""}`;

/** A preflop decision's node: its situation from your seat, a row beside the charts' where the preflop solve graded it. */
export const pfSeatKey = (d: Pick<DecisionRecord, "situation" | "pos" | "source">) => `${d.situation} · ${d.pos}${isPfSolve(d) ? PF_ROW : ""}`;

const CLASSES = ["fold", "passive", "aggr"] as const;
const CLS_ALL: readonly Cls[] = ["vpip", "fold", "passive", "aggr"];
const meanOf = (xs: readonly number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** The gap furthest beyond chance, of a row's. */
const widest = (gs: readonly Gap[]): Gap | undefined => gs.reduce<Gap | undefined>((b, g) => (!b || Math.abs(g.z) > Math.abs(b.z) ? g : b), undefined);

/** A mean's 95% interval from its values' own spread (none under two). */
export function meanRange(xs: readonly number[]): [number, number] | null {
  if (xs.length < 2) return null;
  const t = meanTest(xs);
  return [t.mean - Z_ONE * t.se, t.mean + Z_ONE * t.se];
}

/** Whether a row past its test can be read as a leak: over MIN_READ decisions, and past the report's bar. */
export const leakIsRead = (l: Pick<Leak, "n" | "z" | "bar">): boolean => l.n >= MIN_READ && l.z >= l.bar;

/** How big a leak is, where it costs nothing measured: the widest gap between you and the answer. */
const sizeOf = (l: Leak): number => (l.kind === "freq" ? Math.abs(l.you - l.gto) : l.kind === "pf" && l.expect !== undefined ? l.expect - l.inMix : 0);

/** Leaks that cost EV first, the most per 100 hands first; then those by frequency alone, the widest gap first. */
const leakOrder = (a: Leak, b: Leak) =>
  Number((b.bb100 ?? 0) > 0) - Number((a.bb100 ?? 0) > 0) || b.score - a.score || b.z - a.z || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** Every row tested against the answer at each node: your frequencies (FREQS), the preflop ones from each seat too
 * ("Open (RFI) · CO"); each preflop situation and each situation from each seat, by how often you're in the mix against how
 * often the answer's own mix would be (or by the preflop solve's EV); each spot after the flop by the EV it lost. A row
 * with MIN_READ decisions or more whose test passes the report's bar is a leak; one that would at 95% alone, or past the
 * bar under MIN_READ, looks off but is too few to read (`thin`). No line in big blinds or points: the bar is chance's
 * (leakStats.ts zBar over the `tests` made), and the leaks are ranked by the EV they cost per 100 hands where the answers
 * have EVs, as GTO Wizard's reports rank them. A seat's row with all of its row's decisions is left for that row; a row
 * with a seat that is a leak on fewer decisions is left for the seat, which says more. */
export function readLeaks(ds: readonly DecisionRecord[]): { leaks: Leak[]; thin: Leak[]; bar: number; tests: number } {
  const hands = new Set(ds.map((d) => d.handId)).size;
  const per100 = (bb: number | null) => (bb === null ? null : hands ? (bb / hands) * 100 : 0);
  const graded = ds.filter(isGraded);
  const withMix = graded.filter((d) => Array.isArray(d.mix) && d.mix.length > 0);
  type Row = { l: Leak; tests: number; parent?: string; its: DecisionRecord[] };
  const rows: Row[] = [];
  const blank = { low: 0, versions: null, bar: 0 };
  const costOf = (rs: readonly DecisionRecord[]) => (rs.length ? r2(rs.reduce((t, d) => t + countedBb(d), 0)) : null);
  const bySeat = (rs: readonly DecisionRecord[]) => {
    const m = new Map<string, DecisionRecord[]>();
    for (const d of rs) if (d.pos) (m.get(d.pos) ?? m.set(d.pos, []).get(d.pos)!).push(d);
    return m;
  };
  // (each decision's action and the answer's share by kind, worked out once: every row and seat reads them again)
  const memo = new Map<DecisionRecord, Float64Array>();
  const vec = (d: DecisionRecord): Float64Array => {
    let v = memo.get(d);
    if (!v) {
      const w = new Float64Array(8);
      CLS_ALL.forEach((cls, i) => (w[i] = Number(took(d.action, cls))));
      for (const [a, f] of Array.isArray(d.mix) ? d.mix : []) CLS_ALL.forEach((cls, i) => took(a, cls) && (w[4 + i]! += f));
      memo.set(d, (v = w));
    }
    return v;
  };
  // (your action against the answer's at a row, kind by kind: each kind that either of you takes, with its test)
  const gapsOf = (rs: readonly DecisionRecord[]): Gap[] => {
    const out: Gap[] = [];
    for (const cls of CLASSES) {
      const i = CLS_ALL.indexOf(cls);
      const ys = rs.map((d) => vec(d)[i]!);
      const ms = rs.map((d) => vec(d)[4 + i]!);
      if (ys.every((y, j) => y === ms[j])) continue;
      out.push({ cls, you: meanOf(ys), gto: meanOf(ms), z: pairTest(ys, ms).z });
    }
    return out;
  };

  // your frequencies against the answer's, each answer its own row; the preflop ones from each seat as well
  const freqRow = (key: string, cls: Cls, rs: readonly DecisionRecord[], parent?: string) => {
    if (rs.length < MIN_THIN) return;
    const i = CLS_ALL.indexOf(cls);
    const ys = rs.map((d) => vec(d)[i]!);
    const ms = rs.map((d) => vec(d)[4 + i]!);
    const t = pairTest(ys, ms);
    const [you, gto] = [meanOf(ys), meanOf(ms)];
    // (what it costs: the EV lost where you took it, played over the answer, or where you didn't, played under it)
    const cost = costOf(rs.filter((d) => hasEv(d) && (vec(d)[i] === 1) === you > gto));
    const l: Leak = { ...blank, kind: "freq", key, n: rs.length, you, gto, range: wilson(ys.filter(Boolean).length, rs.length), way: "freq", z: Math.abs(t.z), cost, bb100: per100(cost), gap: { cls, you, gto, z: t.z }, score: 0 };
    rows.push({ l, tests: 1, ...(parent ? { parent } : {}), its: [...rs] });
  };
  for (const [label, cls, test] of FREQS)
    for (const solve of [false, true]) {
      const rs = withMix.filter((d) => test(d) && isPfSolve(d) === solve);
      const key = `${label}${solve ? PF_ROW : ""}`;
      freqRow(key, cls, rs);
      if (rs.length >= MIN_THIN && rs[0]!.street === "preflop") for (const [seat, its] of bySeat(rs)) freqRow(seatKeyOf(label, seat, solve), cls, its, key);
    }

  // preflop, by situation and by situation from each seat
  const nodes = new Map<string, DecisionRecord[]>();
  const add = (k: string, d: DecisionRecord) => (nodes.get(k) ?? nodes.set(k, []).get(k)!).push(d);
  for (const d of graded) {
    if (d.street !== "preflop" || !d.situation) continue;
    add(pfKey(d), d);
    if (d.pos) add(pfSeatKey(d), d);
  }
  for (const [key, rs] of nodes) {
    const solve = key.endsWith(PF_ROW);
    const parent = key.includes(" · ") ? `${key.slice(0, key.indexOf(" · "))}${solve ? PF_ROW : ""}` : undefined;
    if (solve) {
      const evs = rs.filter(hasEv);
      if (evs.length < MIN_THIN) continue;
      const xs = evs.map(countedBb);
      const t = meanTest(xs);
      const cost = costOf(evs);
      const l: Leak = { ...blank, kind: "pf", key, n: evs.length, inMix: rs.filter(isOk).length / rs.length, avg: Math.round(t.mean * 1000) / 1000, range: meanRange(xs) ?? [t.mean, t.mean], way: "solve", z: t.z, cost, bb100: per100(cost), score: 0 };
      rows.push({ l, tests: 1, ...(parent ? { parent } : {}), its: evs });
      continue;
    }
    const its = rs.filter((d) => Array.isArray(d.mix) && d.mix.length > 0);
    if (its.length < MIN_THIN) continue;
    const os = its.map((d) => Number(isOk(d)));
    const ps = its.map((d) => okChance(d.mix!.map(([, f]) => f)));
    // (in the mix less often than the answer's own mix would be: one way only, as more often is no leak. The kind of action
    // furthest off is said with it, and tested in the frequencies' rows)
    const t = pairTest(os, ps);
    const top = widest(gapsOf(its));
    const ok = os.filter(Boolean).length;
    // (what answered by frequency: the charts, or at a short stack the push/fold model)
    const pushFold = its.filter((d) => d.source === "push-fold").length;
    const against = pushFold === its.length ? "the push/fold model" : pushFold ? "the charts and the push/fold model" : "the charts";
    const l: Leak = { ...blank, kind: "pf", key, n: its.length, against, inMix: ok / its.length, expect: meanOf(ps), range: wilson(ok, its.length), way: "freq", z: -t.z, cost: null, bb100: null, ...(top ? { gap: top } : {}), score: 0 };
    rows.push({ l, tests: 1, ...(parent ? { parent } : {}), its });
  }

  // after the flop, each spot by the EV it lost
  const spots = new Map<string, DecisionRecord[]>();
  for (const d of graded) {
    const k = spotOf(d);
    if (k && hasEv(d)) (spots.get(k) ?? spots.set(k, []).get(k)!).push(d);
  }
  for (const [key, evs] of spots) {
    if (evs.length < MIN_THIN) continue;
    const xs = evs.map(countedBb);
    const t = meanTest(xs);
    const lost = r2(xs.reduce((s, x) => s + x, 0));
    const l: Leak = { ...blank, kind: "spot", key, n: evs.length, avg: Math.round(t.mean * 1000) / 1000, lost, range: meanRange(xs) ?? [t.mean, t.mean], way: "ev", z: t.z, cost: lost, bb100: per100(lost), score: 0 };
    rows.push({ l, tests: 1, its: evs });
  }

  const tests = rows.reduce((m, r) => m + (r.l.n >= MIN_READ ? r.tests : 0), 0);
  const bar = zBar(tests);
  for (const r of rows) {
    r.l.bar = bar;
    r.l.score = (r.l.bb100 ?? 0) > 0 ? r.l.bb100! : sizeOf(r.l);
  }
  const isRead = (r: Row) => leakIsRead(r.l);
  const looksOff = (r: Row) => !isRead(r) && (r.l.n < MIN_READ ? r.l.z >= bar : r.l.z >= Z_ONE);
  const id = (kind: string, key: string) => `${kind}|${key}`;
  const byId = new Map(rows.map((r) => [id(r.l.kind, r.l.key), r]));
  const parentOf = (r: Row) => (r.parent ? byId.get(id(r.l.kind, r.parent)) : undefined);
  // (a seat that is all of its row says nothing more than the row; a row with a seat that is a leak on fewer decisions, nothing
  // more than the seat)
  const sameAsParent = (r: Row) => parentOf(r)?.l.n === r.l.n;
  const narrower = rows.filter((r) => r.parent && isRead(r) && !sameAsParent(r));
  const seatSaysMore = (r: Row) => !r.parent && narrower.some((c) => c.l.kind === r.l.kind && c.parent === r.l.key);
  const finish = (r: Row): Leak => ({ ...r.l, low: r.its.filter(isLow).length, versions: versionNote(versionSpan(countVersions(r.its.map((d) => d.version)))) });
  // (rows of one kind on the very same decisions say one thing: VPIP, PFR and the open, where every one was first in. The
  // last in FREQS's order is the most particular, and stands)
  // (only rows of one kind and size can be the same; those are compared decision by decision)
  const same = (a: Row, b: Row) => {
    const s = new Set(a.its);
    return b.its.every((d) => s.has(d));
  };
  const once = (rs: Row[]) => {
    const groups = new Map<string, Row[]>();
    for (const r of rs) (groups.get(`${r.l.kind}|${r.its.length}`) ?? groups.set(`${r.l.kind}|${r.its.length}`, []).get(`${r.l.kind}|${r.its.length}`)!).push(r);
    const drop = new Set<Row>();
    for (const g of groups.values()) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (!drop.has(g[i]!) && same(g[i]!, g[j]!)) drop.add(g[i]!);
    return rs.filter((r) => !drop.has(r));
  };
  const found = once(rows.filter((r) => isRead(r) && !sameAsParent(r) && !seatSaysMore(r))).map(finish).sort(leakOrder);
  const thin = once(rows.filter((r) => looksOff(r) && !sameAsParent(r) && !seatSaysMore(r) && !(parentOf(r) && isRead(parentOf(r)!))))
    .map(finish)
    .sort(leakOrder);
  return { leaks: found, thin, bar, tests };
}

export const leaks = (ds: readonly DecisionRecord[]): Leak[] => readLeaks(ds).leaks;

/** A kind of action in words. */
export const CLS_WORDS: Record<Cls, string> = { fold: "fold", passive: "check or call", aggr: "bet or raise", vpip: "put money in" };
const pct0 = (x: number) => `${Math.round(x * 100)}%`;
const bb2 = (x: number) => `${r2(x)}bb`;
/** What a leak costs per 100 hands, in words, and by whose EV; "" where nothing in it has EVs or it cost nothing. */
export function leakCost(l: Leak): string {
  if (!(l.bb100 && l.bb100 > 0)) return "";
  const per = `${Math.round(l.bb100 * 100) / 100}bb per 100 hands`;
  return l.way === "solve" || l.key.endsWith(PF_ROW) ? `${per} by the preflop solve's EV (a class-level model, kept apart)` : `${per} of solver EV`;
}

/** A leak's reading in words: what's off, against what, over how many, and what it costs. */
export function leakReading(l: Leak): string {
  const n = `${l.n.toLocaleString()} ${l.n === 1 ? "decision" : "decisions"}`;
  const range = l.kind === "spot" || l.way === "solve" ? `95% range ${bb2(l.range[0])} to ${bb2(l.range[1])}` : `95% range ${pct0(l.range[0])} to ${pct0(l.range[1])}`;
  const cost = leakCost(l);
  const tail = (s: string) => `${s}${cost ? `; ${cost}` : ""}`;
  if (l.kind === "freq") return tail(`you ${pct0(l.you)} (${range}), the answer ${pct0(l.gto)} for the same hands, over ${n}`);
  if (l.kind === "spot") return tail(`${bb2(l.avg)} given up per decision past the answer's noise (${range}), over ${n} graded by EV`);
  if (l.way === "solve") return tail(`${bb2(l.avg ?? 0)} given up per decision past the preflop solve's noise (${range}), over ${n}; ${pct0(l.inMix)} in the mix`);
  // (by frequency, preflop is the charts' or the push/fold model's: the preflop solve's rows are read by its EV)
  const who = l.against ?? "the charts";
  const gap = l.gap ? `; you ${CLS_WORDS[l.gap.cls]} ${pct0(l.gap.you)}, the answer ${pct0(l.gap.gto)} for the same hands` : "";
  return tail(`${pct0(l.inMix)} in the mix against ${who}, by frequency, not a solve (${range}), where playing the answer's own mix would be ${pct0(l.expect ?? 1)}${gap}, over ${n}`);
}

/** How the leaks are read, in words, for the page that lists them. */
export const leakBarWords = ({ bar, tests }: { bar: number; tests: number }) =>
  `A leak is a row where your play differs from the answer for the same hands beyond chance: ${tests.toLocaleString()} ${tests === 1 ? "test" : "tests"} here, each held to |z| ≥ ${bar.toFixed(2)}, so someone who plays the answer's own mix exactly would see a false leak in about one report in twenty. There's no fixed line in points or big blinds. Leaks that cost EV come first, the most per 100 hands first; those read by frequency alone (the charts, reads with no EVs) after, the widest gap first.`;

/** Rows renamed, by their old names, which links and saved drills may still carry. */
const RENAMED: Record<string, string> = { "Squeeze (not from the blinds)": "Squeeze (any seat)" };

/** A leak's decisions. */
export function leakTest(l: Pick<Leak, "kind" | "key">): (d: DecisionRecord) => boolean {
  if (l.kind === "freq") {
    const solve = l.key.endsWith(PF_ROW);
    const bare = solve ? l.key.slice(0, -PF_ROW.length) : l.key;
    // (a row from one seat names it after " · ": no row's own name has one)
    const at = bare.lastIndexOf(" · ");
    const [name, seat] = at < 0 ? [bare, undefined] : [bare.slice(0, at), bare.slice(at + 3)];
    const f = FREQS.find((x) => x[0] === (RENAMED[name] ?? name));
    return f ? (d) => isGraded(d) && !!d.mix && f[2](d) && isPfSolve(d) === solve && (seat === undefined || d.pos === seat) : () => false;
  }
  if (l.kind === "pf") {
    // (a situation from one seat, "RFI · CO", or the situation from every seat)
    if (!l.key.includes(" · ")) return (d) => d.street === "preflop" && pfKey(d) === l.key;
    return (d) => d.street === "preflop" && !!d.situation && pfSeatKey(d) === l.key;
  }
  // (a link kept from when only flops were graded names the spot without its street)
  const key = /^(Flop|Turn|River) · /.test(l.key) ? l.key : `Flop · ${l.key}`;
  return (d) => spotOf(d) === key;
}

/** How often a check at Fast graded your action as the read did, by Best or Correct / Inaccuracy / Mistake or worse:
 * the same, worse at Fast, or better (the classic agreement, on Lizard's one scale). */
export function agreement(ds: readonly DecisionRecord[]): { n: number; same: number; worse: number; better: number } {
  const cls = (v: string) => (OK.has(v) ? 0 : v === "Inaccuracy" ? 1 : 2);
  const out = { n: 0, same: 0, worse: 0, better: 0 };
  for (const d of ds) {
    if (!d.read || !isGraded(d) || d.read.verdict === "Not graded") continue;
    const by = cls(d.verdict) - cls(d.read.verdict);
    out.n++;
    out[by === 0 ? "same" : by > 0 ? "worse" : "better"]++;
  }
  return out;
}

/** Solver EV lost, kept apart by kind of game as the results are: never added to them, or turned into a win rate. */
export interface KindLoss {
  kind: HandKind;
  /** decisions graded, of them graded by EV, and the EV those lost (bb) */
  graded: number;
  ev: number;
  lost: number;
  /** those graded by the preflop solve, in neither of the two above */
  pfEv: number;
  pfLost: number;
}

/** The EV your decisions lost, by kind of game; only kinds with something graded. */
export function lostByKind(ds: readonly DecisionRecord[], hands: ReadonlyMap<string, HandRecord>): KindLoss[] {
  // (the preflop solve's EV stands on its own model, so it's kept beside what a solve of the spot says, not added to it)
  const m = new Map<HandKind, KindLoss>();
  for (const d of ds) {
    const h = hands.get(d.handId);
    if (!h || !isGraded(d)) continue;
    const kind = handKind(h);
    const k = m.get(kind) ?? { kind, graded: 0, ev: 0, lost: 0, pfEv: 0, pfLost: 0 };
    k.graded++;
    if (hasEv(d) && isPfSolve(d)) {
      k.pfEv++;
      k.pfLost += countedBb(d);
    } else if (hasEv(d)) {
      k.ev++;
      k.lost += countedBb(d);
    }
    m.set(kind, k);
  }
  return [...m.values()].map((k) => ({ ...k, lost: r2(k.lost), pfLost: r2(k.pfLost) }));
}

export interface Report {
  all: Tally;
  hands: number;
  byStreet: Group[];
  byPos: Group[];
  /** preflop by situation, each against what graded it: the charts' and the preflop solve's apart */
  byPf: Group[];
  byPfSolve: Group[];
  bySpot: Group[];
  /** what the grades stand on, the most solid first */
  byBasis: Group[];
  /** the versions they were graded on, in words (null with none graded) */
  versions: string | null;
  /** of the decisions graded, how many are low-confidence reads, and the EV they lost */
  low: { n: number; lost: number };
  /** of the decisions graded by EV, how many the preflop solve graded, and the EV of its model they lost */
  pfEv: { n: number; lost: number };
  /** graded by EV by anything but the preflop solve: the two are never added */
  spotEv: { n: number; lost: number; avgPct: number | null };
  /** the reads checked at Fast */
  agree: ReturnType<typeof agreement>;
  freqs: FreqRow[];
  leaks: Leak[];
  /** rows that look off but are too few to read: not leaks */
  thin: Leak[];
  /** the bar the leaks passed (|z|), and how many tests it is shared among (readLeaks) */
  leakBar: { bar: number; tests: number };
  /** graded by EV and losing some: the most first */
  mistakes: DecisionRecord[];
  /** graded by frequency and played under 3% of the time by the charts: the chart's surest action first */
  offChart: DecisionRecord[];
  /** the same against a read with no EVs: its surest action first */
  offRead: DecisionRecord[];
  /** not graded, by why */
  notGraded: { why: string; n: number }[];
}

export function report(ds: readonly DecisionRecord[], top = 20, leakFrom: readonly DecisionRecord[] = ds): Report {
  const why = new Map<string, number>();
  for (const d of ds) if (!isGraded(d)) why.set(d.why ?? "", (why.get(d.why ?? "") ?? 0) + 1);
  const unweighed = ds.filter((d) => isGraded(d) && d.evLossBb == null && d.verdict === "Mistake").sort((a, b) => (b.bestFreq ?? 0) - (a.bestFreq ?? 0));
  const low = ds.filter(isLow);
  const pfEv = ds.filter((d) => hasEv(d) && isPfSolve(d));
  const spotEv = tally(ds.filter((d) => hasEv(d) && !isPfSolve(d)));
  const { leaks: found, thin, bar, tests } = readLeaks(leakFrom);
  return {
    all: tally(ds),
    hands: new Set(ds.map((d) => d.handId)).size,
    byStreet: groupBy(ds, (d) => d.street, STREETS),
    byPos: groupBy(ds, (d) => d.pos, ["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"]),
    byPf: groupBy(ds.filter((d) => d.street === "preflop" && !isPfSolve(d)), (d) => d.situation, PF_ORDER),
    byPfSolve: groupBy(ds.filter((d) => d.street === "preflop" && isPfSolve(d)), (d) => d.situation, PF_ORDER),
    bySpot: groupBy(ds, spotOf),
    byBasis: groupBy(ds.filter(isGraded), basisOf, BASES),
    versions: versionSummary(countVersions(ds.filter(isGraded).map((d) => d.version))),
    low: { n: low.length, lost: r2(low.reduce((t, d) => t + countedBb(d), 0)) },
    pfEv: { n: pfEv.length, lost: r2(pfEv.reduce((t, d) => t + countedBb(d), 0)) },
    spotEv: { n: spotEv.ev, lost: spotEv.lost, avgPct: spotEv.avgPct },
    agree: agreement(ds),
    freqs: freqs(ds),
    leaks: found,
    thin,
    leakBar: { bar, tests },
    mistakes: ds.filter((d) => hasEv(d) && countedBb(d) > 0.005).sort((a, b) => countedBb(b) - countedBb(a)).slice(0, top),
    offChart: unweighed.filter((d) => d.source === "charts").slice(0, top),
    offRead: unweighed.filter((d) => d.source !== "charts").slice(0, top),
    notGraded: [...why].map(([w, n]) => ({ why: w, n })).sort((a, b) => b.n - a.n),
  };
}

// ---- export (the classic COLS, less what Lizard doesn't keep: timing, files)
export const COLS = [
  "hand", "hand_id", "site", "played", "position", "hole", "street", "board", "situation", "action", "graded_as", "solver_freq",
  "best_action", "best_freq", "ev_lost_bb", "ev_lost_pct", "grade", "graded_by", "source", "pot_bb", "facing_bet", "in_position",
  "note", "not_graded_why", "tournament", "basis", "confidence", "triage_source", "triage_grade", "triage_ev_lost_bb", "rough_ev", "grade_capped",
  "off_solution", "graded_version",
] as const;
const BOARD_N: Record<string, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };

export function rowsOf(ds: readonly DecisionRecord[], hands: ReadonlyMap<string, HandRecord>): Record<(typeof COLS)[number], unknown>[] {
  return ds.map((d) => {
    const h = hands.get(d.handId);
    return {
      hand: h?.number ?? "",
      hand_id: d.handId,
      site: h?.site ?? "",
      played: h?.played ?? "",
      position: d.pos,
      hole: h?.hole ?? "",
      street: d.street,
      board: h ? h.board.slice(0, 2 * (BOARD_N[d.street] ?? 0)) : "",
      situation: d.situation ?? "",
      action: d.action,
      graded_as: d.matched ?? "",
      solver_freq: d.freq,
      best_action: d.best ?? "",
      best_freq: d.bestFreq,
      ev_lost_bb: d.evLossBb,
      ev_lost_pct: d.lossPct,
      grade: d.verdict,
      graded_by: !isGraded(d) ? "" : d.evLossBb != null ? "EV" : "frequency",
      source: d.label,
      pot_bb: d.pot,
      facing_bet: d.facing,
      in_position: d.ip,
      note: [d.note, d.pfWhy].filter(Boolean).join("; "),
      not_graded_why: d.why ?? "",
      tournament: h?.tournament ?? "",
      basis: isGraded(d) ? basisOf(d) : "",
      confidence: d.read ? "checked at Fast" : (d.confidence ?? ""),
      triage_source: d.read?.triageSource ?? d.triageSource ?? "",
      triage_grade: d.read?.verdict ?? "",
      triage_ev_lost_bb: d.read?.evLossBb,
      rough_ev: d.roughEv ? true : "",
      grade_capped: d.capped ? true : "",
      off_solution: d.off ?? "",
      graded_version: isGraded(d) ? (d.version ?? "unknown") : "",
    };
  });
}

export function toCSV(ds: readonly DecisionRecord[], hands: ReadonlyMap<string, HandRecord>): string {
  const cell = (v: unknown) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [COLS.join(","), ...rowsOf(ds, hands).map((r) => COLS.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

export function toJSON(ds: readonly DecisionRecord[], hands: ReadonlyMap<string, HandRecord>, now = Date.now()): string {
  const rp = report(ds, 50);
  const strip = (d: DecisionRecord) => ({ hand: hands.get(d.handId)?.number ?? "", hand_id: d.handId, street: d.street, action: d.action, situation: d.situation, grade: d.verdict, ev_lost_bb: d.evLossBb, rough_ev: !!d.roughEv, grade_capped: !!d.capped, solver_freq: d.freq, best_action: d.best, source: d.label, basis: basisOf(d), version: d.version ?? "unknown", confidence: d.read ? "checked at Fast" : (d.confidence ?? "") });
  return JSON.stringify(
    {
      exported: new Date(now).toISOString(),
      graded_against: "preflop: the stored preflop solve by EV where it reads the spot (a class-level model, kept apart from the rest), else the preflop charts, by frequency (not a solve); after the flop: what answered each decision (its source and basis), by EV where it has EVs",
      summary: { ...rp.all, hands: rp.hands, byStreet: rp.byStreet, byPf: rp.byPf, bySpot: rp.bySpot, byBasis: rp.byBasis, versions: rp.versions, low: rp.low, agreementAtFast: rp.agree, freqs: rp.freqs.map(({ label, cls, n, k, you, range, gto }) => ({ label, cls, n, k, you, range, gto })), leaks: rp.leaks, tooFewToRead: rp.thin, mistakes: rp.mistakes.map(strip), offChart: rp.offChart.map(strip), offRead: rp.offRead.map(strip), notGraded: rp.notGraded },
      decisions: rowsOf(ds, hands),
    },
    null,
    1,
  );
}
