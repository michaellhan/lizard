// The report over your graded decisions, ported from the classic analyzer (solver/gto/static/session.js tally,
// groupBy, FREQS / freqs, PF_ORDER, report's mistakes and off-chart lists, LEAK / leaks, COLS / toCSV / toJSON), on
// Lizard's grade scale (grading/grade.ts: "in the mix" is Best or Correct). Preflop decisions are graded against the
// charts by frequency and have no EV lost; flop decisions against the library by EV.
import type { DecisionRecord, HandRecord } from "@/data/db";
import { STREETS } from "./analyze";

const r2 = (x: number) => Math.round(x * 100) / 100;
const OK = new Set(["Best", "Correct"]);
export const VERDICTS = ["Best", "Correct", "Inaccuracy", "Mistake", "Blunder"] as const;

export const isGraded = (d: DecisionRecord) => d.verdict !== "Not graded";
export const isOk = (d: DecisionRecord) => OK.has(d.verdict);
const hasEv = (d: DecisionRecord) => isGraded(d) && d.evLossBb != null;

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
 * FREQS: its turn and river rows wait for those streets to be graded). */
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
];

export interface FreqRow {
  label: string;
  cls: Cls;
  n: number;
  you: number;
  gto: number;
}

export function freqs(ds: readonly DecisionRecord[]): FreqRow[] {
  const rows = ds.filter((d) => isGraded(d) && d.mix);
  const out: FreqRow[] = [];
  for (const [label, cls, f] of FREQS) {
    const rs = rows.filter(f);
    if (!rs.length) continue;
    out.push({ label, cls, n: rs.length, you: rs.filter((d) => clsOf(d.action) === cls).length / rs.length, gto: rs.reduce((t, d) => t + mixByClass(d)[cls], 0) / rs.length });
  }
  return out;
}

/** A leak's thresholds (the classic LEAK): a frequency this far off the answer's over this many decisions; a
 * preflop situation under this share in the mix over this many; a flop spot losing this many bb a decision over
 * this many. */
export const LEAK = { freq: [0.1, 15], pf: [0.8, 15], spot: [0.5, 10] } as const;

export type Leak =
  | { kind: "freq"; key: string; n: number; you: number; gto: number; score: number }
  | { kind: "pf"; key: string; n: number; inMix: number; score: number }
  | { kind: "spot"; key: string; n: number; avg: number; lost: number; score: number };

export function leaks(ds: readonly DecisionRecord[]): Leak[] {
  const out: Leak[] = [];
  for (const f of freqs(ds)) {
    const d = f.you - f.gto;
    if (f.n >= LEAK.freq[1] && Math.abs(d) >= LEAK.freq[0]) out.push({ kind: "freq", key: f.label, n: f.n, you: f.you, gto: f.gto, score: Math.abs(d) * Math.sqrt(f.n) });
  }
  for (const r of groupBy(ds.filter((d) => d.street === "preflop"), (d) => d.situation, PF_ORDER))
    if (r.graded >= LEAK.pf[1] && r.ok / r.graded < LEAK.pf[0]) out.push({ kind: "pf", key: r.key, n: r.graded, inMix: r.ok / r.graded, score: (1 - r.ok / r.graded) * Math.sqrt(r.graded) });
  for (const r of groupBy(ds.filter((d) => d.street !== "preflop"), (d) => d.situation))
    if (r.ev >= LEAK.spot[1] && (r.avg ?? 0) >= LEAK.spot[0]) out.push({ kind: "spot", key: r.key, n: r.ev, avg: r.avg!, lost: r.lost, score: (r.avg! / 2) * Math.sqrt(r.ev) });
  return out.sort((a, b) => b.score - a.score);
}

/** A leak's decisions. */
export function leakTest(l: Pick<Leak, "kind" | "key">): (d: DecisionRecord) => boolean {
  if (l.kind === "freq") {
    const f = FREQS.find((x) => x[0] === l.key);
    return f ? (d) => isGraded(d) && !!d.mix && f[2](d) : () => false;
  }
  return l.kind === "pf" ? (d) => d.street === "preflop" && d.situation === l.key : (d) => d.street !== "preflop" && d.situation === l.key;
}

export interface Report {
  all: Tally;
  hands: number;
  byStreet: Group[];
  byPos: Group[];
  byPf: Group[];
  bySpot: Group[];
  freqs: FreqRow[];
  leaks: Leak[];
  /** graded by EV and losing some: the most first */
  mistakes: DecisionRecord[];
  /** graded by frequency and played under 3% of the time by the charts: the chart's surest action first */
  offChart: DecisionRecord[];
  /** not graded, by why */
  notGraded: { why: string; n: number }[];
}

export function report(ds: readonly DecisionRecord[], top = 20): Report {
  const why = new Map<string, number>();
  for (const d of ds) if (!isGraded(d)) why.set(d.why ?? "", (why.get(d.why ?? "") ?? 0) + 1);
  return {
    all: tally(ds),
    hands: new Set(ds.map((d) => d.handId)).size,
    byStreet: groupBy(ds, (d) => d.street, STREETS),
    byPos: groupBy(ds, (d) => d.pos, ["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"]),
    byPf: groupBy(ds.filter((d) => d.street === "preflop"), (d) => d.situation, PF_ORDER),
    bySpot: groupBy(ds.filter((d) => d.street !== "preflop"), (d) => d.situation),
    freqs: freqs(ds),
    leaks: leaks(ds),
    mistakes: ds.filter((d) => hasEv(d) && (d.evLossBb ?? 0) > 0.005).sort((a, b) => (b.evLossBb ?? 0) - (a.evLossBb ?? 0)).slice(0, top),
    offChart: ds
      .filter((d) => isGraded(d) && d.evLossBb == null && d.verdict === "Mistake")
      .sort((a, b) => (b.bestFreq ?? 0) - (a.bestFreq ?? 0))
      .slice(0, top),
    notGraded: [...why].map(([w, n]) => ({ why: w, n })).sort((a, b) => b.n - a.n),
  };
}

// ---- export (the classic COLS, less what Lizard doesn't keep: triage, timing, files)
export const COLS = [
  "hand", "hand_id", "site", "played", "position", "hole", "street", "board", "situation", "action", "graded_as", "solver_freq",
  "best_action", "best_freq", "ev_lost_bb", "ev_lost_pct", "grade", "graded_by", "source", "pot_bb", "facing_bet", "in_position",
  "note", "not_graded_why", "tournament",
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
    };
  });
}

export function toCSV(ds: readonly DecisionRecord[], hands: ReadonlyMap<string, HandRecord>): string {
  const cell = (v: unknown) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [COLS.join(","), ...rowsOf(ds, hands).map((r) => COLS.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

export function toJSON(ds: readonly DecisionRecord[], hands: ReadonlyMap<string, HandRecord>, now = Date.now()): string {
  const rp = report(ds, 50);
  const strip = (d: DecisionRecord) => ({ hand: hands.get(d.handId)?.number ?? "", hand_id: d.handId, street: d.street, action: d.action, situation: d.situation, grade: d.verdict, ev_lost_bb: d.evLossBb, solver_freq: d.freq, best_action: d.best });
  return JSON.stringify(
    {
      exported: new Date(now).toISOString(),
      graded_against: "preflop: the preflop charts, by frequency (not a solve); flop: the precomputed flop library, by EV",
      summary: { ...rp.all, hands: rp.hands, byStreet: rp.byStreet, byPf: rp.byPf, bySpot: rp.bySpot, freqs: rp.freqs, leaks: rp.leaks, mistakes: rp.mistakes.map(strip), offChart: rp.offChart.map(strip), notGraded: rp.notGraded },
      decisions: rowsOf(ds, hands),
    },
    null,
    1,
  );
}
