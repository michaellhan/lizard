// The chart against the preflop solve, every hand class at a set of preflop spots (docs/QA.md "Preflop: the chart against
// the solve"): in a preflop-solve session Practice offers the chart's buttons and grades by the solve (pfGrade.ts), so a
// hand the chart plays one way and the solve another is graded down for following the chart. The sweep's `pf.follow`
// finds such hands one deal at a time; this asks all 169 classes at each spot, through the same path as a Practice
// decision (needOf, SolverClient, gradedOn, practiceBasis, checkPreflop), and counts the classes whose chart's most played
// move the solve grades below Correct. Run: node scripts/qa/run.mjs --pf-agree.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as P from "@/features/practice/practice";
import { needOf } from "@/features/practice/flow";
import { gradedOn, type HeldAnswer, type PfAsked } from "@/features/practice/pfGrade";
import { gradeMix } from "@/features/practice/practice";
import { CHART_PARTS } from "@/grading/grade";
import { DECK, type Move } from "@/poker/table";
import { SolverClient } from "@/solver/client";
import * as K from "@/qa/checks";
import { PyAdvisor } from "./py";

export interface PfSpot {
  name: string;
  players: number;
  stack: number;
  hero: string;
  /** the preflop moves before yours, as the charts play them */
  pre: Move[];
}

const f = (pos: string): Move => ({ pos, action: "fold" });
const r = (pos: string, to: number): Move => ({ pos, action: "raise", to });

export const PF_SPOTS: PfSpot[] = [
  { name: "2max-100bb SB first in", players: 2, stack: 100, hero: "SB", pre: [] },
  { name: "2max-100bb BB vs SB 3", players: 2, stack: 100, hero: "BB", pre: [r("SB", 3)] },
  { name: "2max-20bb SB first in", players: 2, stack: 20, hero: "SB", pre: [] },
  { name: "2max-20bb BB vs SB 3", players: 2, stack: 20, hero: "BB", pre: [r("SB", 3)] },
  { name: "3max-100bb BTN first in", players: 3, stack: 100, hero: "BTN", pre: [] },
  { name: "6max-100bb UTG first in", players: 6, stack: 100, hero: "UTG", pre: [] },
  { name: "6max-100bb BTN first in", players: 6, stack: 100, hero: "BTN", pre: [f("UTG"), f("HJ"), f("CO")] },
  { name: "6max-100bb SB first in", players: 6, stack: 100, hero: "SB", pre: [f("UTG"), f("HJ"), f("CO"), f("BTN")] },
  { name: "6max-100bb BB vs BTN 2.5", players: 6, stack: 100, hero: "BB", pre: [f("UTG"), f("HJ"), f("CO"), r("BTN", 2.5), f("SB")] },
  // (where the stored games' sweep of every first-in node and the blinds facing one open found the chart and the solve
  // parting most: docs/ACCURACY.md section 18.11)
  { name: "6max-100bb SB vs UTG 2.5", players: 6, stack: 100, hero: "SB", pre: [r("UTG", 2.5), f("HJ"), f("CO"), f("BTN")] },
  { name: "6max-100bb BB vs SB 3", players: 6, stack: 100, hero: "BB", pre: [f("UTG"), f("HJ"), f("CO"), f("BTN"), r("SB", 3)] },
  { name: "6max-20bb SB vs BTN 2.5", players: 6, stack: 20, hero: "SB", pre: [f("UTG"), f("HJ"), f("CO"), r("BTN", 2.5)] },
  { name: "6max-40bb SB first in", players: 6, stack: 40, hero: "SB", pre: [f("UTG"), f("HJ"), f("CO"), f("BTN")] },
  { name: "6max-200bb SB first in", players: 6, stack: 200, hero: "SB", pre: [f("UTG"), f("HJ"), f("CO"), f("BTN")] },
];

const RANKS = "AKQJT98765432";
/** The 169 classes, each with one combo of it. */
export function classes(): { cls: string; hole: [string, string] }[] {
  const out: { cls: string; hole: [string, string] }[] = [];
  for (let i = 0; i < 13; i++)
    for (let j = 0; j < 13; j++) {
      const a = RANKS[i]!;
      const b = RANKS[j]!;
      if (i === j) out.push({ cls: `${a}${b}`, hole: [`${a}s`, `${b}h`] });
      else if (i < j) out.push({ cls: `${a}${b}s`, hole: [`${a}s`, `${b}s`] });
      else out.push({ cls: `${b}${a}o`, hole: [`${b}s`, `${a}h`] });
    }
  return out;
}

export interface PfAgreeRow {
  spot: string;
  cls: string;
  graded: string;
  pfWhy?: string;
  chartTop?: string;
  chartFreq?: number;
  solveTop?: string;
  solveFreq?: number;
  verdict?: string;
  loss?: number;
  pastPct?: number;
  /** the grade of the chart's move stopped at Inaccuracy, as the chart plays it 10% or more (grade.ts CHART_PARTS) */
  capped?: boolean;
  hard: boolean;
  violations: K.Violation[];
}

export async function pfAgree(o: { spots: PfSpot[]; out: string; log: (s: string) => void }): Promise<PfAgreeRow[]> {
  mkdirSync(o.out, { recursive: true });
  const file = resolve(o.out, "pfagree.jsonl");
  writeFileSync(file, "");
  const adv = new PyAdvisor("advisor", () => 120, {}, o.log);
  const client = new SolverClient(adv, "qa");
  const rows: PfAgreeRow[] = [];
  for (const spot of o.spots) {
    o.log(`\n[pf-agree] ${spot.name}\n`);
    for (const { cls, hole } of classes()) {
      const base = P.newHand(spot.players, spot.stack, 0, 7, { seat: "moves", pot: null, pfSolve: true });
      // (the other seats' cards from what's left, so no card is dealt twice)
      const rest = DECK.filter((c) => !hole.includes(c));
      const hands: PracticeHand["hands"] = {};
      let k = 0;
      for (const p of Object.keys(base.hands)) hands[p] = p === spot.hero ? hole : [rest[k++]!, rest[k++]!];
      const h: PracticeHand = { ...base, hero: spot.hero, hands, lines: { ...base.lines, preflop: spot.pre } };
      const sim = P.simOf(h);
      const need = needOf(h, "quick", sim);
      if (need.kind !== "you" || !need.pf) {
        o.log(`  ${cls}: needOf said ${need.kind}${need.kind === "you" ? " with no preflop-solve request" : ""}\n`);
        continue;
      }
      const res = await client.solve({ state: need.state, mode: "quick" });
      let pf: PfAsked;
      try {
        pf = await client.solve({ state: need.pf, mode: "quick", untimed: true });
      } catch (e) {
        pf = { failed: String(e) };
      }
      const held: HeldAnswer = { ...res, pf };
      const on = gradedOn(h, held, sim);
      const row: PfAgreeRow = { spot: spot.name, cls, graded: on.provenance.source, hard: false, violations: [] };
      const chartActs = (res.data.actions ?? []).filter((a) => typeof a.freq === "number");
      const c = K.topFreq(chartActs.map((a) => a.freq!));
      if (c >= 0) {
        row.chartTop = chartActs[c]!.action;
        row.chartFreq = chartActs[c]!.freq!;
      }
      if (on.pfWhy) row.pfWhy = on.pfWhy;
      if (on.provenance.source === "preflop-solve") {
        const mix = P.gradable(P.mixOf(on.data), on.provenance);
        const pot = typeof on.data.pot_bb === "number" ? on.data.pot_bb : sim.pot;
        const basis = P.practiceBasis(on.data, on.provenance, sim);
        const s = K.topFreq(mix.map((x) => x.freq));
        row.solveTop = mix[s]!.action;
        row.solveFreq = mix[s]!.freq;
        const at = c >= 0 ? K.sameAction(mix, chartActs[c]!.action, chartActs[c]!.amount_bb) : -1;
        if (at >= 0) {
          const g = gradeMix(mix, pot, at, basis);
          row.verdict = g.verdict;
          row.loss = Math.round(g.loss * 1000) / 1000;
          row.pastPct = Math.round((g.pastPct ?? 0) * 10) / 10;
          if (g.capped && g.capWhy?.includes(CHART_PARTS)) row.capped = true;
        }
        row.violations = K.checkPreflop({ chart: res.data, graded: { mix, pot, basis, source: "preflop-solve" }, pf: "data" in pf ? pf.data : null });
        row.hard = row.violations.some((v) => v.severity === "hard" && (v.check === "pf.follow" || v.check === "pf.chart"));
      }
      rows.push(row);
      appendFileSync(file, JSON.stringify(row) + "\n");
    }
    const mine = rows.filter((x) => x.spot === spot.name);
    const solved = mine.filter((x) => x.graded === "preflop-solve");
    const hardOf = (c: string) => solved.filter((x) => x.violations?.some((v) => v.severity === "hard" && v.check === c)).length;
    o.log(`  ${solved.length} of ${mine.length} classes graded by the solve; the chart's most played move below Correct in ${solved.filter((x) => x.verdict && !["Best", "Correct"].includes(x.verdict)).length} (hard pf.follow in ${hardOf("pf.follow")}, hard pf.chart in ${hardOf("pf.chart")})\n`);
  }
  adv.close();
  return rows;
}

type PracticeHand = P.PracticeHand;

/** The tally as markdown. */
export function pfAgreeMarkdown(rows: readonly PfAgreeRow[]): string {
  const L = ["# Preflop: the chart's most played move graded by the solve", "", "| spot | classes | graded by the solve | Best/Correct | Inaccuracy | of them capped (the chart plays it) | Mistake | Blunder | worst (class: chart's move, solve's move, loss) |", "|---|---|---|---|---|---|---|---|---|"];
  for (const spot of [...new Set(rows.map((x) => x.spot))]) {
    const mine = rows.filter((x) => x.spot === spot);
    const s = mine.filter((x) => x.graded === "preflop-solve" && x.verdict);
    const n = (v: string[]) => s.filter((x) => v.includes(x.verdict!)).length;
    const worst = [...s].filter((x) => !["Best", "Correct"].includes(x.verdict!)).sort((a, b) => (b.loss ?? 0) - (a.loss ?? 0)).slice(0, 4);
    const w = worst.map((x) => `${x.cls}: ${x.chartTop} ${((x.chartFreq ?? 0) * 100).toFixed(0)}%, solve ${x.solveTop} ${((x.solveFreq ?? 0) * 100).toFixed(0)}%, ${x.verdict} ${x.loss}bb`).join("; ");
    L.push(`| ${spot} | ${mine.length} | ${s.length} | ${n(["Best", "Correct"])} | ${n(["Inaccuracy"])} | ${s.filter((x) => x.capped).length} | ${n(["Mistake"])} | ${n(["Blunder"])} | ${w} |`);
  }
  return L.join("\n") + "\n";
}
