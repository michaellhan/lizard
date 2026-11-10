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
import { wilson } from "./stats";

const r2 = (x: number) => Math.round(x * 100) / 100;
const OK = new Set(["Best", "Correct"]);
export const VERDICTS = ["Best", "Correct", "Inaccuracy", "Mistake", "Blunder"] as const;

export const isGraded = (d: DecisionRecord) => d.verdict !== "Not graded";
export const isOk = (d: DecisionRecord) => OK.has(d.verdict);
const hasEv = (d: DecisionRecord) => isGraded(d) && d.evLossBb != null;
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
  /** graded by EV by a solve of the spot, the EV they lost (bb) and its average per decision (bb, and % of the pot) */
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
    t.bb += d.evLossBb ?? 0;
    t.pct += d.lossPct ?? 0;
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
type Cls = "fold" | "passive" | "aggr" | "vpip";
const clsOf = (action: string): Exclude<Cls, "vpip"> => (/^fold/.test(action) ? "fold" : /^(check|call)/.test(action) ? "passive" : "aggr");
const isVpip = (action: string) => !/^(fold|check)/.test(action);
/** whether an action is of the kind */
const took = (action: string, cls: Cls) => (cls === "vpip" ? isVpip(action) : clsOf(action) === cls);
/** the answer's mix for your hand by kind of action */
export function mixByClass(d: DecisionRecord): Record<Exclude<Cls, "vpip">, number> {
  const m: Record<Exclude<Cls, "vpip">, number> = { fold: 0, passive: 0, aggr: 0 };
  for (const [a, f] of d.mix ?? []) m[clsOf(a)] += f;
  return m;
}

/** The preflop situations facing one raise. A decision stores no more of them than this: a blind's squeeze reads as
 * its BB defence or SB vs open, so the squeeze row is the other seats'. */
const THREE_BET = new Set(["vs open", "vs open + call", "SB vs open", "BB defence"]);

/** the answer's share of a kind of action for your hand */
const shareOf = (d: DecisionRecord, cls: Cls) => (Array.isArray(d.mix) ? d.mix : []).reduce((s, [a, f]) => s + (took(a, cls) ? f : 0), 0);

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
  ["Squeeze (not from the blinds)", "aggr", (d) => d.situation === "vs open + call"],
  ["SB vs open: fold", "fold", (d) => d.situation === "SB vs open"],
  ["vs 3bet: fold", "fold", (d) => d.situation === "vs 3bet"],
  ["vs 3bet: 4bet", "aggr", (d) => d.situation === "vs 3bet"],
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
/** A spot after the flop, with its street ("Turn · SRP · IP · checked to"): a pot's flop, turn and river are different
 * spots. Null preflop. */
/** Your misses, worst first: a graded decision outside the mix (Inaccuracy, Mistake, Blunder), by verdict, then by EV lost. */
export const missesOf = (ds: readonly DecisionRecord[]): DecisionRecord[] =>
  ds
    .filter((d) => isGraded(d) && !isOk(d))
    .sort((x, y) => VERDICTS.indexOf(y.verdict as (typeof VERDICTS)[number]) - VERDICTS.indexOf(x.verdict as (typeof VERDICTS)[number]) || (y.evLossBb ?? 0) - (x.evLossBb ?? 0));

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

/** A leak's thresholds: a frequency this far off the answer's, a preflop situation under this share in the mix, a spot
 * after the flop losing this many bb a decision, each over MIN_READ decisions (the classic LEAK's sizes, over twice its
 * sample) and with its 95% interval clear of the line (leakIsRead). */
export const LEAK = { freq: [0.1, MIN_READ], pf: [0.8, MIN_READ], spot: [0.5, MIN_READ] } as const;

/** What a leak is, said beside them. */
export const LEAK_RULE = `A leak is a frequency ${Math.round(LEAK.freq[0] * 100)} points off the answer's, a preflop situation under ${Math.round(LEAK.pf[0] * 100)}% in the mix, or a spot after the flop losing ${LEAK.spot[0]}bb per decision. Each needs at least ${MIN_READ} decisions and a 95% interval clear of that line; anything short of that is too few to read, and isn't marked.`;

/** (`low`: how many of its decisions stand on a low-confidence read, which the leak may not survive a check of;
 * `versions`: where its decisions don't stand on one known version, in words; `range`: your rate's 95% interval, a
 * spot's EV lost per decision) */
export type Leak = { low: number; versions: string | null; range: [number, number] } & (
  | { kind: "freq"; key: string; n: number; you: number; gto: number; score: number }
  | { kind: "pf"; key: string; n: number; inMix: number; score: number }
  | { kind: "spot"; key: string; n: number; avg: number; lost: number; score: number }
);

/** A mean's 95% interval from its values' own spread (none under two). */
export function meanRange(xs: readonly number[]): [number, number] | null {
  const n = xs.length;
  if (n < 2) return null;
  let [sum, sq] = [0, 0];
  for (const x of xs) {
    sum += x;
    sq += x * x;
  }
  const mean = sum / n;
  const half = 1.96 * Math.sqrt(Math.max(0, (sq - n * mean * mean) / (n - 1)) / n);
  return [mean - half, mean + half];
}

/** Whether a row past a leak's line can be read: over MIN_READ decisions, and its whole interval past the line: yours
 * 10 points from the answer's frequency, under 80% in the mix, over 0.5bb lost per decision. */
export const leakIsRead = (l: Leak): boolean =>
  l.n >= MIN_READ && (l.kind === "freq" ? l.gto + LEAK.freq[0] < l.range[0] || l.gto - LEAK.freq[0] > l.range[1] : l.kind === "pf" ? l.range[1] < LEAK.pf[0] : l.range[0] > LEAK.spot[0]);

/** Every row past a leak's line: `leaks` can be read (leakIsRead), `thin` look off but are too few to say. */
export function readLeaks(ds: readonly DecisionRecord[]): { leaks: Leak[]; thin: Leak[] } {
  const none = { low: 0, versions: null };
  const out: Leak[] = [];
  for (const f of freqs(ds)) {
    const d = f.you - f.gto;
    if (f.n >= MIN_THIN && Math.abs(d) >= LEAK.freq[0]) out.push({ kind: "freq", key: f.label, n: f.n, you: f.you, gto: f.gto, range: f.range, score: Math.abs(d) * Math.sqrt(f.n), ...none });
  }
  for (const r of groupBy(ds.filter((d) => d.street === "preflop"), pfKey, PF_ORDER))
    if (r.graded >= MIN_THIN && r.ok / r.graded < LEAK.pf[0]) out.push({ kind: "pf", key: r.key, n: r.graded, inMix: r.ok / r.graded, range: wilson(r.ok, r.graded), score: (1 - r.ok / r.graded) * Math.sqrt(r.graded), ...none });
  for (const r of groupBy(ds, spotOf))
    if (r.ev >= MIN_THIN && (r.avg ?? 0) >= LEAK.spot[0]) {
      const range = meanRange(ds.filter((d) => spotOf(d) === r.key && hasEv(d)).map((d) => d.evLossBb ?? 0))!;
      out.push({ kind: "spot", key: r.key, n: r.ev, avg: r.avg!, lost: r.lost, range, score: (r.avg! / 2) * Math.sqrt(r.ev), ...none });
    }
  const full = out.sort((a, b) => b.score - a.score).map((l) => {
    const its = ds.filter((d) => leakTest(l)(d) && isGraded(d) && (l.kind !== "spot" || hasEv(d)));
    return { ...l, low: its.filter(isLow).length, versions: versionNote(versionSpan(countVersions(its.map((d) => d.version)))) };
  });
  return { leaks: full.filter(leakIsRead), thin: full.filter((l) => !leakIsRead(l)) };
}

export const leaks = (ds: readonly DecisionRecord[]): Leak[] => readLeaks(ds).leaks;

/** A leak's decisions. */
export function leakTest(l: Pick<Leak, "kind" | "key">): (d: DecisionRecord) => boolean {
  if (l.kind === "freq") {
    const solve = l.key.endsWith(PF_ROW);
    const f = FREQS.find((x) => x[0] === (solve ? l.key.slice(0, -PF_ROW.length) : l.key));
    return f ? (d) => isGraded(d) && !!d.mix && f[2](d) && isPfSolve(d) === solve : () => false;
  }
  if (l.kind === "pf") return (d) => d.street === "preflop" && pfKey(d) === l.key;
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
      k.pfLost += d.evLossBb ?? 0;
    } else if (hasEv(d)) {
      k.ev++;
      k.lost += d.evLossBb ?? 0;
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
  /** rows past a leak's line that are too few to read: not leaks */
  thin: Leak[];
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
  const { leaks: found, thin } = readLeaks(leakFrom);
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
    low: { n: low.length, lost: r2(low.reduce((t, d) => t + (d.evLossBb ?? 0), 0)) },
    pfEv: { n: pfEv.length, lost: r2(pfEv.reduce((t, d) => t + (d.evLossBb ?? 0), 0)) },
    spotEv: { n: spotEv.ev, lost: spotEv.lost, avgPct: spotEv.avgPct },
    agree: agreement(ds),
    freqs: freqs(ds),
    leaks: found,
    thin,
    mistakes: ds.filter((d) => hasEv(d) && (d.evLossBb ?? 0) > 0.005).sort((a, b) => (b.evLossBb ?? 0) - (a.evLossBb ?? 0)).slice(0, top),
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
