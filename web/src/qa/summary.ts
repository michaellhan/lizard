// The Practice QA sweep's records and their summary (scripts/qa/run.mjs, docs/QA.md): one record a decision, an opponent's
// move, a finished hand, a reference comparison and a config, as JSON lines; and the summary of them all, as JSON and as
// markdown. Pure, so checks.test.ts can hold it to fixtures.
import type { Verdict } from "@/grading/grade";
import type { PracticeHand } from "@/features/practice/practice";
import type { Sim, Street } from "@/poker/table";
import type { OppFlags, RefCompare, Violation } from "./checks";

/** The table a record was played at. */
export interface TableTag {
  players: number;
  stack: number;
  opponents: "gto" | "live" | "loose";
  /** the drill's pot, or "any" */
  pot: string;
}

interface Base {
  config: string;
  /** the hand's seed (newHand's), and its number in the config */
  seed: number;
  hand: number;
  violations: Violation[];
}

export interface HeroRecord extends Base {
  t: "hero";
  table: TableTag;
  street: Street;
  seat: string;
  /** the line to the decision (Study's line) */
  line: string;
  /** "flop hu srp" (spotOf) */
  spot: string;
  mode: string;
  /** the wall time of the answer (both of a preflop-solve session's requests), and of the preflop solve's alone */
  secs: number;
  pfSecs?: number;
  /** what answered your spot, and what the decision was graded against (the chart's answer or the preflop solve's) */
  source: string;
  graded: string;
  band?: string;
  exploitabilityPct?: number;
  approximate: boolean;
  label?: string;
  chose: string;
  /** null: ungraded (no answer, or the answer was an error) */
  verdict: Verdict | null;
  loss?: number;
  lossPct?: number;
  byEv?: boolean;
  capped?: boolean;
  pfWhy?: string;
  /** every action's verdict at the node, in the answer's order */
  all?: { action: string; freq: number; ev: number | null; verdict: Verdict }[];
}

export interface OppRecord extends Base {
  t: "opp";
  table: TableTag;
  street: Street;
  seat: string;
  line: string;
  secs: number;
  action: string;
  flags?: OppFlags;
}

export interface HandRecord extends Base {
  t: "hand";
  table: TableTag;
  net: number | null;
  folded: boolean;
  /** board cards out at the end, decisions of yours, and deals a drill took to reach its pot */
  shown: number;
  decisions: number;
  tries: number;
}

export interface RefRecord extends Base {
  t: "ref";
  table: TableTag;
  street: Street;
  line: string;
  spot: string;
  mode: "fast" | "accurate";
  secs: number;
  source: string;
  quickSource: string;
  cmp: RefCompare | null;
}

export interface ConfigRecord {
  t: "config";
  config: string;
  hands: number;
  heroDecisions: number;
  oppMoves: number;
  secs: number;
  /** the advisor's peak RSS, MB, and how often it was started again (over the cap, or a crash) */
  rssPeak: number;
  restarts: number;
  /** seconds its advisor waited to be ready (a CPU slot from the machine's wrapper, the imports) */
  waited?: number;
  violations: Violation[];
}

export type QaRecord = HeroRecord | OppRecord | HandRecord | RefRecord | ConfigRecord;

/** A decision's spot by street, players in and pot: "flop hu srp", "turn 3way 3bet", "preflop". */
export function spotOf(h: Pick<PracticeHand, "lines">, sim: Pick<Sim, "current" | "active">): string {
  const st = sim.current ?? "preflop";
  if (st === "preflop") return "preflop";
  const n = sim.active.size;
  const ways = n <= 2 ? "hu" : n === 3 ? "3way" : "4way+";
  const raises = h.lines.preflop.filter((m) => m.action === "raise" || m.action === "bet" || m.action === "all-in").length;
  const pot = raises === 0 ? "limped" : raises === 1 ? "srp" : raises === 2 ? "3bet" : "4bet+";
  return `${st} ${ways} ${pot}`;
}

/** The violations found by one check, with the first few where they were. */
export interface CheckTally {
  check: string;
  severity: "hard" | "soft";
  count: number;
  examples: { config: string; seed: number; hand: number; street?: string; line?: string; source?: string; verdict?: string | null; detail: string }[];
}

export interface Summary {
  configs: number;
  hands: number;
  heroDecisions: number;
  graded: number;
  oppMoves: number;
  refs: number;
  secs: number;
  hard: number;
  soft: number;
  checks: CheckTally[];
  /** by spot, what answered your decisions */
  coverage: { spot: string; n: number; sources: Record<string, number> }[];
  /** the shares the sweep looks for: heads-up 6-max 100bb single-raised flops against the equilibrium answered by the
   * library; 3-way flops served (library or live, not rules or an error) */
  coverageAlerts: { what: string; n: number; share: number | null; want: string; ok: boolean | null }[];
  verdicts: Record<string, Record<string, number>>;
  /** preflop decisions graded by the solve and by the charts */
  preflop: { solve: number; charts: number; other: number; pfWhy: Record<string, number> };
  quickVsRef: { mode: string; n: number; compared: number; agree: number; condemns: number; passes: number }[];
  opponents: { opponents: string; moves: number; freeFolds: number; riverNutFolds: number; nothingPotSpots: number; nothingPotCalls: number }[];
  perf: { mode: string; street: string; n: number; mean: number; p50: number; p90: number; max: number; over15: number }[];
  rss: { config: string; peak: number; restarts: number; secs: number; waited: number; hands: number }[];
}

const EXAMPLES = 5;
const q = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const ys = [...xs].sort((a, b) => a - b);
  // (nearest rank: the p50 of two is the lower)
  return ys[Math.min(ys.length - 1, Math.max(0, Math.ceil(p * ys.length) - 1))]!;
};
const r2 = (x: number) => Math.round(x * 100) / 100;
const bump = (o: Record<string, number>, k: string, by = 1) => {
  o[k] = (o[k] ?? 0) + by;
};
/** pfWhy's reason, its first words, so like reasons count together */
const gist = (s: string) => s.replace(/\d+(\.\d+)?/g, "#").split(/[:,]/)[0]!.slice(0, 70);

export function summarize(records: readonly QaRecord[], secs = 0): Summary {
  const heroes = records.filter((r): r is HeroRecord => r.t === "hero");
  const opps = records.filter((r): r is OppRecord => r.t === "opp");
  const hands = records.filter((r): r is HandRecord => r.t === "hand");
  const refs = records.filter((r): r is RefRecord => r.t === "ref");
  const configs = records.filter((r): r is ConfigRecord => r.t === "config");
  const tallies = new Map<string, CheckTally>();
  for (const r of records)
    for (const x of r.violations) {
      const key = `${x.severity}|${x.check}`;
      const t = tallies.get(key) ?? { check: x.check, severity: x.severity, count: 0, examples: [] };
      t.count += 1;
      if (t.examples.length < EXAMPLES)
        t.examples.push({
          config: r.config,
          seed: "seed" in r ? r.seed : 0,
          hand: "hand" in r ? r.hand : 0,
          ...("street" in r ? { street: r.street } : {}),
          ...("line" in r ? { line: r.line } : {}),
          ...("source" in r ? { source: r.source } : {}),
          ...(r.t === "hero" ? { verdict: r.verdict } : {}),
          detail: x.detail,
        });
      tallies.set(key, t);
    }
  const checks = [...tallies.values()].sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === "hard" ? -1 : 1));
  const cov = new Map<string, { spot: string; n: number; sources: Record<string, number> }>();
  for (const r of heroes) {
    const c = cov.get(r.spot) ?? { spot: r.spot, n: 0, sources: {} };
    c.n += 1;
    bump(c.sources, r.source);
    cov.set(r.spot, c);
  }
  const share = (rs: HeroRecord[], ok: (r: HeroRecord) => boolean) => (rs.length ? rs.filter(ok).length / rs.length : null);
  const huLib = heroes.filter((r) => r.table.players === 6 && r.table.stack === 100 && r.table.opponents === "gto" && r.spot === "flop hu srp");
  const threeWay = heroes.filter((r) => r.spot.startsWith("flop 3way"));
  const libShare = share(huLib, (r) => r.source === "library");
  const served = share(threeWay, (r) => r.source === "library" || r.source === "live");
  const verdicts: Record<string, Record<string, number>> = {};
  for (const r of heroes) {
    const row = (verdicts[r.street] ??= {});
    bump(row, r.verdict ?? "ungraded");
  }
  const pre = heroes.filter((r) => r.street === "preflop");
  const pfWhy: Record<string, number> = {};
  for (const r of pre) if (r.pfWhy) bump(pfWhy, gist(r.pfWhy));
  const modes = [...new Set(refs.map((r) => r.mode))].sort();
  const oppKinds = [...new Set(opps.map((r) => r.table.opponents))].sort();
  const perfKeys = new Map<string, number[]>();
  for (const r of heroes) {
    const k = `${r.mode}|${r.street}`;
    perfKeys.set(k, [...(perfKeys.get(k) ?? []), r.secs]);
  }
  for (const r of refs) {
    const k = `${r.mode} (reference)|${r.street}`;
    perfKeys.set(k, [...(perfKeys.get(k) ?? []), r.secs]);
  }
  const hard = checks.filter((c) => c.severity === "hard").reduce((a, c) => a + c.count, 0);
  const soft = checks.filter((c) => c.severity === "soft").reduce((a, c) => a + c.count, 0);
  return {
    configs: configs.filter((c) => !c.config.startsWith("(")).length,
    hands: hands.length,
    heroDecisions: heroes.length,
    graded: heroes.filter((r) => r.verdict !== null).length,
    oppMoves: opps.length,
    refs: refs.length,
    secs: r2(secs),
    hard,
    soft,
    checks,
    coverage: [...cov.values()].sort((a, b) => b.n - a.n),
    coverageAlerts: [
      { what: "6-max 100bb heads-up SRP flops against GTO opponents answered by the library", n: huLib.length, share: libShare, want: "mostly (50% or more)", ok: libShare === null ? null : libShare >= 0.5 },
      { what: "3-way flops served (library or live solve, not rules or an error)", n: threeWay.length, share: served, want: "80% or more", ok: served === null ? null : served >= 0.8 },
    ],
    verdicts,
    preflop: {
      solve: pre.filter((r) => r.graded === "preflop-solve").length,
      charts: pre.filter((r) => r.graded === "charts").length,
      other: pre.filter((r) => r.graded !== "preflop-solve" && r.graded !== "charts").length,
      pfWhy,
    },
    quickVsRef: modes.map((mode) => {
      const rs = refs.filter((r) => r.mode === mode);
      const cs = rs.map((r) => r.cmp).filter((c): c is RefCompare => !!c);
      return { mode, n: rs.length, compared: cs.length, agree: cs.filter((c) => c.agree).length, condemns: cs.filter((c) => c.condemns).length, passes: cs.filter((c) => c.passes).length };
    }),
    opponents: oppKinds.map((k) => {
      const rs = opps.filter((r) => r.table.opponents === k);
      const np = rs.filter((r) => r.flags?.nothingPot);
      return {
        opponents: k,
        moves: rs.length,
        freeFolds: rs.filter((r) => r.flags?.freeFold).length,
        riverNutFolds: rs.filter((r) => r.flags?.riverNutFold).length,
        nothingPotSpots: np.length,
        nothingPotCalls: np.filter((r) => r.flags!.nothingPot!.called).length,
      };
    }),
    perf: [...perfKeys.entries()]
      .map(([k, xs]) => {
        const [mode, street] = k.split("|") as [string, string];
        return { mode, street, n: xs.length, mean: r2(xs.reduce((a, b) => a + b, 0) / xs.length), p50: r2(q(xs, 0.5)), p90: r2(q(xs, 0.9)), max: r2(Math.max(...xs)), over15: mode === "quick" ? xs.filter((x) => x > 15).length : 0 };
      })
      .sort((a, b) => (a.mode === b.mode ? ["preflop", "flop", "turn", "river"].indexOf(a.street) - ["preflop", "flop", "turn", "river"].indexOf(b.street) : a.mode < b.mode ? -1 : 1)),
    rss: configs.map((c) => ({ config: c.config, peak: c.rssPeak, restarts: c.restarts, secs: r2(c.secs), waited: r2(c.waited ?? 0), hands: c.hands })),
  };
}

const pc = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const rate = (a: number, b: number) => (b ? `${a}/${b} (${((a / b) * 100).toFixed(1)}%)` : "0/0");
const cell = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The summary as markdown (summary.md). */
export function markdown(s: Summary, title = "Practice QA sweep"): string {
  const L: string[] = [];
  L.push(`# ${title}`, "");
  L.push(`${s.configs} configs, ${s.hands} hands, ${s.heroDecisions} of your decisions (${s.graded} graded), ${s.oppMoves} opponent moves, ${s.refs} reference answers, ${Math.round(s.secs)} s.`, "");
  L.push(`**Hard violations: ${s.hard}.** Soft (measured, not failing): ${s.soft}.`, "");
  L.push("## Violations by check", "");
  if (!s.checks.length) L.push("None.", "");
  else {
    L.push("| check | severity | count | first example |", "|---|---|---|---|");
    for (const c of s.checks) {
      const e = c.examples[0];
      L.push(`| ${c.check} | ${c.severity} | ${c.count} | ${e ? cell(`${e.config} seed ${e.seed} hand ${e.hand} ${e.street ?? ""} ${e.line ? `[${e.line}]` : ""} ${e.source ? `(${e.source}${e.verdict ? `, ${e.verdict}` : ""})` : ""}: ${e.detail}`) : ""} |`);
    }
    L.push("");
  }
  L.push("## Coverage: what answered your decisions", "", "| spot | n | sources |", "|---|---|---|");
  for (const c of s.coverage) L.push(`| ${c.spot} | ${c.n} | ${Object.entries(c.sources).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${pc(n / c.n)}`).join(", ")} |`);
  L.push("");
  for (const a of s.coverageAlerts) L.push(`- ${a.what}: ${pc(a.share)} of ${a.n} (want ${a.want})${a.ok === false ? " **below**" : ""}`);
  L.push("", "## Verdicts by street", "", "| street | Best | Correct | Inaccuracy | Mistake | Blunder | ungraded |", "|---|---|---|---|---|---|---|");
  for (const st of ["preflop", "flop", "turn", "river"]) {
    const v = s.verdicts[st];
    if (v) L.push(`| ${st} | ${v.Best ?? 0} | ${v.Correct ?? 0} | ${v.Inaccuracy ?? 0} | ${v.Mistake ?? 0} | ${v.Blunder ?? 0} | ${v.ungraded ?? 0} |`);
  }
  L.push("", `Preflop graded by the preflop solve: ${s.preflop.solve}; by the charts: ${s.preflop.charts}; other: ${s.preflop.other}.`);
  const why = Object.entries(s.preflop.pfWhy).sort((a, b) => b[1] - a[1]);
  if (why.length) L.push("", "Why a preflop-solve session's decision took the chart's grade:", "", ...why.map(([k, n]) => `- ${n} x ${k}`));
  L.push("", "## Quick against a reference (the same action graded on both)", "");
  if (!s.quickVsRef.length) L.push("None asked.");
  else {
    L.push("| reference | asked | compared | verdicts agree | Quick condemns, reference passes | Quick passes, reference condemns |", "|---|---|---|---|---|---|");
    for (const r of s.quickVsRef) L.push(`| ${r.mode} | ${r.n} | ${r.compared} | ${rate(r.agree, r.compared)} | ${rate(r.condemns, r.compared)} | ${rate(r.passes, r.compared)} |`);
  }
  L.push("", "## Opponents", "", "| opponents | moves | folds where checking was free | river folds of the nuts | calls with nothing facing a pot-size bet or more |", "|---|---|---|---|---|");
  for (const o of s.opponents) L.push(`| ${o.opponents} | ${o.moves} | ${o.freeFolds} | ${o.riverNutFolds} | ${rate(o.nothingPotCalls, o.nothingPotSpots)} |`);
  L.push("", "## Time per decision (s, this Mac, native Python)", "", "| mode | street | n | mean | p50 | p90 | max | Quick over 15 s |", "|---|---|---|---|---|---|---|---|");
  for (const p of s.perf) L.push(`| ${p.mode} | ${p.street} | ${p.n} | ${p.mean} | ${p.p50} | ${p.p90} | ${p.max} | ${p.over15} |`);
  L.push("", "## Configs", "", "| config | hands | wall s | of it waiting to start s | advisor peak RSS MB | restarts |", "|---|---|---|---|---|---|");
  for (const r of s.rss) L.push(`| ${r.config} | ${r.hands} | ${Math.round(r.secs)} | ${Math.round(r.waited)} | ${r.peak} | ${r.restarts} |`);
  L.push("");
  return L.join("\n");
}
