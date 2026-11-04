// The report over your graded decisions, ported from the classic analyzer (solver/gto/static/session.js tally,
// groupBy, FREQS / freqs, PF_ORDER, report's mistakes and off-chart lists, LEAK / leaks, COLS / toCSV / toJSON), on
// Lizard's grade scale (grading/grade.ts: "in the mix" is Best or Correct). Preflop decisions are graded against the
// charts by frequency and have no EV lost; after the flop against what answered, by EV where it has EVs, each decision
// saying what that was: the library, a stored turn, a read at once, a Quick or a Fast solve (byBasis keeps them apart).
import type { DecisionRecord, HandRecord } from "@/data/db";
import { STREETS } from "./analyze";

const r2 = (x: number) => Math.round(x * 100) / 100;
const OK = new Set(["Best", "Correct"]);
export const VERDICTS = ["Best", "Correct", "Inaccuracy", "Mistake", "Blunder"] as const;

export const isGraded = (d: DecisionRecord) => d.verdict !== "Not graded";
export const isOk = (d: DecisionRecord) => OK.has(d.verdict);
const hasEv = (d: DecisionRecord) => isGraded(d) && d.evLossBb != null;
const isLow = (d: DecisionRecord) => isGraded(d) && d.confidence === "low";

export interface Tally {
  /** decisions, graded or not */
  n: number;
  graded: number;
  /** of them Best or Correct */
  ok: number;
  /** graded by EV, the EV they lost (bb) and its average per decision (bb, and % of the pot) */
  ev: number;
  lost: number;
  avg: number | null;
  avgPct: number | null;
  by: Record<(typeof VERDICTS)[number], number>;
}

export function tally(ds: readonly DecisionRecord[]): Tally {
  const graded = ds.filter(isGraded);
  const ev = graded.filter(hasEv);
  const lost = r2(ev.reduce((t, d) => t + (d.evLossBb ?? 0), 0));
  const pct = ev.reduce((t, d) => t + (d.lossPct ?? 0), 0);
  const by = Object.fromEntries(VERDICTS.map((v) => [v, graded.filter((d) => d.verdict === v).length])) as Tally["by"];
  return {
    n: ds.length,
    graded: graded.length,
    ok: graded.filter(isOk).length,
    ev: ev.length,
    lost,
    avg: ev.length ? Math.round((lost / ev.length) * 1000) / 1000 : null,
    avgPct: ev.length ? Math.round((pct / ev.length) * 10) / 10 : null,
    by,
  };
}

export type Group = Tally & { key: string };

/** The decisions grouped by a key: in `order` where given, else the most EV lost first, then the most decisions. */
export function groupBy(ds: readonly DecisionRecord[], key: (d: DecisionRecord) => string | null | undefined, order?: readonly string[]): Group[] {
  const m = new Map<string, DecisionRecord[]>();
  for (const d of ds) {
    const k = key(d);
    if (k == null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(d);
  }
  const out = [...m].map(([k, rs]) => ({ key: k, ...tally(rs) }));
  return order
    ? out.sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99))
    : out.sort((a, b) => b.lost - a.lost || b.n - a.n);
}

export const PF_ORDER = ["RFI", "vs limp", "BB vs limp", "vs open", "vs open + call", "SB vs open", "BB defence", "limp vs raise", "vs 3bet", "cold vs 3bet", "vs 4bet+"];

type Cls = "fold" | "passive" | "aggr";
const clsOf = (action: string): Cls => (/^fold/.test(action) ? "fold" : /^(check|call)/.test(action) ? "passive" : "aggr");
/** the answer's mix for your hand by kind of action */
export function mixByClass(d: DecisionRecord): Record<Cls, number> {
  const m: Record<Cls, number> = { fold: 0, passive: 0, aggr: 0 };
  for (const [a, f] of d.mix ?? []) m[clsOf(a)] += f;
  return m;
}

/** Your frequency of a kind of action against the answer's for the same hands at the same decisions (the classic
 * FREQS). */
export const FREQS: readonly [string, Cls, (d: DecisionRecord) => boolean][] = [
  ["Open (RFI)", "aggr", (d) => d.situation === "RFI"],
  ["BB defence: fold", "fold", (d) => d.situation === "BB defence"],
  ["BB defence: 3bet", "aggr", (d) => d.situation === "BB defence"],
  ["SB vs open: fold", "fold", (d) => d.situation === "SB vs open"],
  ["vs 3bet: fold", "fold", (d) => d.situation === "vs 3bet"],
  ["vs 3bet: 4bet", "aggr", (d) => d.situation === "vs 3bet"],
  ["Flop c-bet", "aggr", (d) => d.street === "flop" && d.role === "PFR" && !d.facing && !d.multi],
  ["Flop vs c-bet: fold", "fold", (d) => d.street === "flop" && d.role === "caller" && !!d.facing && !d.multi],
  ["Flop vs c-bet: raise", "aggr", (d) => d.street === "flop" && d.role === "caller" && !!d.facing && !d.multi],
  ["Turn barrel", "aggr", (d) => d.street === "turn" && d.role === "PFR" && !!d.flopAggr && !d.facing && !d.multi],
  ["Turn vs bet: fold", "fold", (d) => d.street === "turn" && !!d.facing],
  ["River bet", "aggr", (d) => d.street === "river" && !d.facing],
  ["River vs bet: fold", "fold", (d) => d.street === "river" && !!d.facing],
];

const STREET_NAME: Record<string, string> = { flop: "Flop", turn: "Turn", river: "River" };
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
];
export function basisOf(d: DecisionRecord): string {
  if (d.source === "charts") return BASES[0]!;
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
  you: number;
  gto: number;
  /** the mean square of your action (1 or 0) less that hand's own answer: what a comparison's spread is read from */
  sq: number;
}

export function freqs(ds: readonly DecisionRecord[]): FreqRow[] {
  const rows = ds.filter((d) => isGraded(d) && d.mix);
  const out: FreqRow[] = [];
  for (const [label, cls, f] of FREQS) {
    const rs = rows.filter(f);
    if (!rs.length) continue;
    let [you, gto, sq] = [0, 0, 0];
    for (const d of rs) {
      const [y, m] = [Number(clsOf(d.action) === cls), mixByClass(d)[cls]];
      you += y;
      gto += m;
      sq += (y - m) ** 2;
    }
    out.push({ label, cls, n: rs.length, you: you / rs.length, gto: gto / rs.length, sq: sq / rs.length });
  }
  return out;
}

/** A leak's thresholds (the classic LEAK): a frequency this far off the answer's over this many decisions; a
 * preflop situation under this share in the mix over this many; a spot after the flop losing this many bb a decision
 * over this many. */
export const LEAK = { freq: [0.1, 15], pf: [0.8, 15], spot: [0.5, 10] } as const;

/** (`low`: how many of its decisions stand on a low-confidence read, which the leak may not survive a check of) */
export type Leak = { low: number } & (
  | { kind: "freq"; key: string; n: number; you: number; gto: number; score: number }
  | { kind: "pf"; key: string; n: number; inMix: number; score: number }
  | { kind: "spot"; key: string; n: number; avg: number; lost: number; score: number }
);

export function leaks(ds: readonly DecisionRecord[]): Leak[] {
  const out: Leak[] = [];
  for (const f of freqs(ds)) {
    const d = f.you - f.gto;
    if (f.n >= LEAK.freq[1] && Math.abs(d) >= LEAK.freq[0]) out.push({ kind: "freq", key: f.label, n: f.n, you: f.you, gto: f.gto, score: Math.abs(d) * Math.sqrt(f.n), low: 0 });
  }
  for (const r of groupBy(ds.filter((d) => d.street === "preflop"), (d) => d.situation, PF_ORDER))
    if (r.graded >= LEAK.pf[1] && r.ok / r.graded < LEAK.pf[0]) out.push({ kind: "pf", key: r.key, n: r.graded, inMix: r.ok / r.graded, score: (1 - r.ok / r.graded) * Math.sqrt(r.graded), low: 0 });
  for (const r of groupBy(ds, spotOf))
    if (r.ev >= LEAK.spot[1] && (r.avg ?? 0) >= LEAK.spot[0]) out.push({ kind: "spot", key: r.key, n: r.ev, avg: r.avg!, lost: r.lost, score: (r.avg! / 2) * Math.sqrt(r.ev), low: 0 });
  return out.sort((a, b) => b.score - a.score).map((l) => ({ ...l, low: ds.filter((d) => leakTest(l)(d) && isLow(d) && (l.kind !== "spot" || hasEv(d))).length }));
}

/** A leak's decisions. */
export function leakTest(l: Pick<Leak, "kind" | "key">): (d: DecisionRecord) => boolean {
  if (l.kind === "freq") {
    const f = FREQS.find((x) => x[0] === l.key);
    return f ? (d) => isGraded(d) && !!d.mix && f[2](d) : () => false;
  }
  if (l.kind === "pf") return (d) => d.street === "preflop" && d.situation === l.key;
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

export interface Report {
  all: Tally;
  hands: number;
  byStreet: Group[];
  byPos: Group[];
  byPf: Group[];
  bySpot: Group[];
  /** what the grades stand on, the most solid first */
  byBasis: Group[];
  /** of the decisions graded, how many are low-confidence reads, and the EV they lost */
  low: { n: number; lost: number };
  /** the reads checked at Fast */
  agree: ReturnType<typeof agreement>;
  freqs: FreqRow[];
  leaks: Leak[];
  /** graded by EV and losing some: the most first */
  mistakes: DecisionRecord[];
  /** graded by frequency and played under 3% of the time by the charts: the chart's surest action first */
  offChart: DecisionRecord[];
  /** the same against a read with no EVs: its surest action first */
  offRead: DecisionRecord[];
  /** not graded, by why */
  notGraded: { why: string; n: number }[];
}

export function report(ds: readonly DecisionRecord[], top = 20): Report {
  const why = new Map<string, number>();
  for (const d of ds) if (!isGraded(d)) why.set(d.why ?? "", (why.get(d.why ?? "") ?? 0) + 1);
  const unweighed = ds.filter((d) => isGraded(d) && d.evLossBb == null && d.verdict === "Mistake").sort((a, b) => (b.bestFreq ?? 0) - (a.bestFreq ?? 0));
  const low = ds.filter(isLow);
  return {
    all: tally(ds),
    hands: new Set(ds.map((d) => d.handId)).size,
    byStreet: groupBy(ds, (d) => d.street, STREETS),
    byPos: groupBy(ds, (d) => d.pos, ["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"]),
    byPf: groupBy(ds.filter((d) => d.street === "preflop"), (d) => d.situation, PF_ORDER),
    bySpot: groupBy(ds, spotOf),
    byBasis: groupBy(ds.filter(isGraded), basisOf, BASES),
    low: { n: low.length, lost: r2(low.reduce((t, d) => t + (d.evLossBb ?? 0), 0)) },
    agree: agreement(ds),
    freqs: freqs(ds),
    leaks: leaks(ds),
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
  "off_solution",
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
      note: d.note ?? "",
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
    };
  });
}

export function toCSV(ds: readonly DecisionRecord[], hands: ReadonlyMap<string, HandRecord>): string {
  const cell = (v: unknown) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [COLS.join(","), ...rowsOf(ds, hands).map((r) => COLS.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

export function toJSON(ds: readonly DecisionRecord[], hands: ReadonlyMap<string, HandRecord>, now = Date.now()): string {
  const rp = report(ds, 50);
  const strip = (d: DecisionRecord) => ({ hand: hands.get(d.handId)?.number ?? "", hand_id: d.handId, street: d.street, action: d.action, situation: d.situation, grade: d.verdict, ev_lost_bb: d.evLossBb, rough_ev: !!d.roughEv, grade_capped: !!d.capped, solver_freq: d.freq, best_action: d.best, source: d.label, basis: basisOf(d), confidence: d.read ? "checked at Fast" : (d.confidence ?? "") });
  return JSON.stringify(
    {
      exported: new Date(now).toISOString(),
      graded_against: "preflop: the preflop charts, by frequency (not a solve); after the flop: what answered each decision (its source and basis), by EV where it has EVs",
      summary: { ...rp.all, hands: rp.hands, byStreet: rp.byStreet, byPf: rp.byPf, bySpot: rp.bySpot, byBasis: rp.byBasis, low: rp.low, agreementAtFast: rp.agree, freqs: rp.freqs.map(({ label, cls, n, you, gto }) => ({ label, cls, n, you, gto })), leaks: rp.leaks, mistakes: rp.mistakes.map(strip), offChart: rp.offChart.map(strip), offRead: rp.offRead.map(strip), notGraded: rp.notGraded },
      decisions: rowsOf(ds, hands),
    },
    null,
    1,
  );
}
