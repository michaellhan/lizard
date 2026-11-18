// The Practice QA sweep's invariants (scripts/qa/run.mjs, docs/QA.md): pure functions over what one Practice decision,
// one opponent's move or one finished hand left, each returning the violations it finds. The sweep plays hands through the
// real web code against the worker's Advisor and calls these on every decision; checks.test.ts holds them to hand-made
// fixtures so CI tests the checker without the solver. Every grade here goes through the page's own path (practice.ts
// gradeMix -> grade.ts gradeAnswer, the basis from practiceBasis), never a copy of it.
import { kindOf } from "@/components/actions";
import { gradeMix, chipsAfter, setupOf, simOf, type Decision, type PracticeHand } from "@/features/practice/practice";
import { practiceHistory } from "@/features/practice/history";
import { handTier } from "@/features/practice/live";
import { untrainedMoves } from "@/features/practice/pfGrade";
import { lossWords, MIX, TOL, whyText, whoOf, type AnswerBasis, type Grade, type Verdict } from "@/grading/grade";
import { importHand } from "@/hh/replay";
import { resultOf } from "@/hh/results";
import { cmp, rank7 } from "@/poker/evaluate";
import { seatsOf } from "@/poker/seats";
import { DECK, minRaiseTo, noLines, simulate, behind, canRaise, toCallOf, withMove, NEED, STREETS, type Lines, type Move, type Sim, type Street, type TableSetup } from "@/poker/table";
import { LEAN_TRUST } from "@/solver/provenance";
import type { AdvisorResponse, OffSolution } from "@/solver/protocol";
import type { Provenance } from "@/solver/types";

export type Severity = "hard" | "soft";
export interface Violation {
  /** the check's id, "table.chips", "grade.mix"... (docs/QA.md lists them) */
  check: string;
  severity: Severity;
  detail: string;
}

const EPS = 1e-9;
const C = (x: number) => Math.round(x * 100);
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const freq1 = (x: number) => Math.round(x * 1000) / 1000;
const sum = (xs: Iterable<number>) => {
  let t = 0;
  for (const x of xs) t += x;
  return t;
};
export const violation = (check: string, detail: string, severity: Severity = "hard"): Violation => ({ check, severity, detail });
const v = violation;
const BAD = (x: Verdict) => x === "Mistake" || x === "Blunder";
const OK = (x: Verdict) => x === "Best" || x === "Correct";

// ---- the table and the records

/** Why a move wasn't legal where it was recorded (poker/table.ts recordOf would never have recorded it), or null. */
export function illegal(t: TableSetup, sim: Sim, street: Street, m: Move): string | null {
  if (sim.current !== street || !sim.cur) return `the table is on ${sim.current ?? "nothing"}${sim.waiting ? ` waiting for the ${sim.waiting}` : ""}, not the ${street}`;
  if (sim.toAct !== m.pos) return `${sim.toAct ?? "nobody"} is to act`;
  const toCall = toCallOf(t, sim, m.pos);
  const rem = behind(t, sim, m.pos);
  const info = sim.cur;
  switch (m.action) {
    case "fold":
      return null;
    case "check":
      return toCall > EPS ? `a check facing ${toCall}bb` : null;
    case "call":
      return toCall > EPS ? null : "a call with nothing to call (the table records a check)";
    case "all-in":
      if (rem <= EPS) return "all-in with no chips behind";
      return rem > toCall + EPS && !canRaise(sim, m.pos) ? "all-in for more than a call where no raise is allowed" : null;
    case "bet":
    case "raise": {
      if (m.to === undefined || !finite(m.to)) return "a bet or raise with no size";
      if (!canRaise(sim, m.pos)) return "a raise where none is allowed";
      const facing = toCall > EPS || info.curBet > EPS;
      if (m.action === "bet" && facing) return `a bet facing ${info.curBet}bb (the table records a raise)`;
      if (m.action === "raise" && !facing) return "a raise with no bet (the table records a bet)";
      const allInTo = (info.bets[m.pos] ?? 0) + rem;
      if (m.to >= allInTo - EPS) return `to ${m.to}, the whole stack (${allInTo}): the table records all-in`;
      if (m.to <= info.curBet + EPS) return `to ${m.to}, no more than the bet (${info.curBet})`;
      if (m.to < minRaiseTo(info) - 0.005) return `to ${m.to}, under the smallest ${m.action} (${minRaiseTo(info)})`;
      return null;
    }
    default:
      return `unknown action ${String(m.action)}`;
  }
}

/** Each seat's chips in, worked out from the lines on their own: the antes and blinds a stack can cover, each move's chips
 * (a call matches the bet or what's behind, a bet or raise goes to its size, an all-in puts in the rest), and a bet nobody
 * matched given back as each street the table closed ends (`closed`). The table's pot is checked against it. */
export function ledger(t: TableSetup, lines: Lines, closed: (s: Street) => boolean): Record<string, number> {
  const POS = seatsOf(t.players);
  const stack = (p: string) => t.stacks[p] ?? 0;
  const inv: Record<string, number> = Object.fromEntries(POS.map((p) => [p, Math.min(t.ante ?? 0, stack(p))]));
  const out = new Set<string>();
  const straddler = t.straddle && t.players >= 3 ? POS[0]! : null;
  for (const s of STREETS) {
    const pre = s === "preflop";
    if (!pre && !lines[s].length && !closed(s)) break;
    const bets: Record<string, number> = Object.fromEntries(POS.map((p) => [p, 0]));
    if (pre) {
      const blinds: [string, number][] = [["SB", 0.5], ["BB", 1], ...(straddler ? ([[straddler, 2]] as [string, number][]) : [])];
      for (const [p, b] of blinds) if (p in bets) bets[p] = Math.min(b, stack(p) - inv[p]!);
    }
    let cur = pre ? (straddler ? 2 : 1) : 0;
    for (const m of lines[s]) {
      const p = m.pos;
      const rem = stack(p) - inv[p]! - bets[p]!;
      if (out.has(p) || rem <= EPS) continue;
      if (m.action === "fold") out.add(p);
      else if (m.action === "call") bets[p] = Math.min(Math.max(cur, ...Object.values(bets)), bets[p]! + rem);
      else if (m.action === "bet" || m.action === "raise") bets[p] = Math.min(m.to ?? 0, bets[p]! + rem);
      else if (m.action === "all-in") bets[p] = bets[p]! + rem;
      cur = Math.max(cur, bets[p]!);
    }
    if (closed(s)) {
      const top = POS.reduce((x, p) => (bets[p]! > bets[x]! ? p : x), POS[0]!);
      const second = Math.max(0, ...POS.filter((p) => p !== top).map((p) => bets[p]!));
      if (bets[top]! > second + EPS) bets[top] = second;
    }
    for (const p of POS) inv[p]! += bets[p]!;
    if (!closed(s)) break;
  }
  return inv;
}

/** Every move on the hand's lines legal where it was recorded (poker/table.ts's rules), the table's chips in each seat's
 * as the lines add them up on their own (ledger), the chips conserved at the end (every seat's chips after the hand, plus
 * the rake, are the chips the table started with; the pot paid out is the pot put in), and the hand history (history.ts)
 * read back by Analyze's importer to the same chips in, the same stacks, the same players left and your same result. */
export function checkHand(h: PracticeHand): Violation[] {
  const out: Violation[] = [];
  const t = setupOf(h);
  let lines = noLines();
  for (const s of STREETS) {
    if (h.lines[s].length && h.shown < NEED[s]) out.push(v("table.legal", `${s} moves recorded with ${h.shown} board cards out`));
    for (const m of h.lines[s]) {
      const why = illegal(t, simulate(t, lines, NEED[s]), s, m);
      if (why) out.push(v("table.legal", `${s} ${m.pos} ${m.action}${m.to !== undefined ? ` ${m.to}` : ""}: ${why}`));
      lines = withMove(lines, s, m);
    }
  }
  const sim = simOf(h);
  const led = ledger(t, h.lines, (s) => !!sim.streets[s]?.closed);
  for (const p of seatsOf(h.players)) {
    const table = C((sim.invested[p] ?? 0) + (sim.cur?.bets[p] ?? 0));
    if (Math.abs(table - C(led[p] ?? 0)) > 1) out.push(v("table.pot", `${p} has ${table / 100}bb in at the table, ${C(led[p] ?? 0) / 100}bb as its moves add up`));
  }
  const ledC = sum(Object.values(led).map(C));
  if (Math.abs(C(sim.pot) - ledC) > 1) out.push(v("table.pot", `the pot is ${sim.pot}bb, the chips in add up to ${ledC / 100}bb`));
  const res = h.result;
  if (res && !res.cut) {
    const start = sum(seatsOf(h.players).map((p) => C(t.stacks[p] ?? 0)));
    const end = sum(Object.values(chipsAfter(h, sim)).map(C));
    const took = start - end;
    const inC = sum(seatsOf(h.players).map((p) => C((sim.invested[p] ?? 0) + (sim.cur?.bets[p] ?? 0))));
    if (!res.folded) {
      if (Math.abs(took - C(res.rake ?? 0)) > 1) out.push(v("table.chips", `${start / 100}bb at the start, ${end / 100}bb after: ${took / 100}bb gone, the rake says ${res.rake ?? 0}bb`));
      const paid = sum(Object.values(res.pays).map(C)) + C(res.rake ?? 0);
      if (Math.abs(paid - inC) > 1) out.push(v("table.chips", `the pot paid out ${paid / 100}bb (rake included) of ${inC / 100}bb put in`));
    } else {
      // (after your fold the others' chips are as if the rest were checked down: chipsAfter, which rakes as the hand would)
      const cap = h.rake ? Math.min(Math.round((inC * h.rake.pct) / 100), h.rake.cap ? C(h.rake.cap) : Infinity) : 0;
      if (took < -1 || took > cap + 1) out.push(v("table.chips", `${start / 100}bb at the start, ${end / 100}bb after your fold: ${took / 100}bb gone, the rake can take ${cap / 100}bb`));
      const yours = C((sim.invested[h.hero] ?? 0) + (sim.cur?.bets[h.hero] ?? 0));
      if (C(res.net) !== -yours) out.push(v("table.chips", `you folded with ${yours / 100}bb in and the result is ${res.net}bb`));
    }
  }
  if (res) out.push(...checkHistory(h, sim));
  return out;
}

/** The hand history read back (records.sim.test.ts's checks, on a hand the sweep played). */
export function checkHistory(h: PracticeHand, sim: Sim = simOf(h)): Violation[] {
  const out: Violation[] = [];
  let text: string;
  let rep: ReturnType<typeof importHand>;
  try {
    text = practiceHistory(h, 1700000000000, new Date(2026, 0, 1));
  } catch (e) {
    return [v("records.replay", `the history can't be written: ${String(e)}`)];
  }
  try {
    rep = importHand(text);
  } catch (e) {
    return [v("records.replay", `the history can't be read back: ${String(e)}`)];
  }
  if (rep.stopped) return [v("records.replay", `the history stops at ${rep.stopped.pos}'s ${rep.stopped.street}: ${rep.warnings.join(" | ")}`)];
  if (rep.warnings.length) out.push(v("records.replay", `read back with warnings: ${rep.warnings.join(" | ")}`));
  const rs = simulate(rep.setup, rep.lines, rep.hand.board.length);
  const t = setupOf(h);
  // (an averaged ante is to 1e-4 and a stack to the cent: 4 cents of slack with antes, records.sim.test.ts)
  const slack = t.ante ? 4 : 0;
  for (const p of seatsOf(h.players)) {
    const a = C((rs.invested[p] ?? 0) + (rs.cur?.bets[p] ?? 0));
    const b = C((sim.invested[p] ?? 0) + (sim.cur?.bets[p] ?? 0));
    if (Math.abs(a - b) > slack) out.push(v("records.replay", `${p}'s chips in: ${b / 100} at the table, ${a / 100} read back`));
    if (Math.abs((rep.setup.stacks[p] ?? 0) - (t.stacks[p] ?? 0)) > 0.005 + slack / 100) out.push(v("records.replay", `${p}'s stack: ${t.stacks[p]} at the table, ${rep.setup.stacks[p]} read back`));
  }
  if ([...rs.active].sort().join() !== [...sim.active].sort().join()) out.push(v("records.replay", `players left: ${[...sim.active].sort().join(",")} at the table, ${[...rs.active].sort().join(",")} read back`));
  const res = h.result;
  if (res && !res.cut) {
    const got = resultOf(rep.hand, text, h.hero).net;
    if (got === null || Math.abs(C(got) - C(res.net)) > slack) out.push(v("records.result", `your result ${res.net}bb at the table, ${got}bb read back from the history`));
  }
  return out;
}

/** What of the biggest commitment no other player still in can match (each seat's stack is all it can put in): it goes
 * back to the bettor, and the engine's pot leaves it out (a 28bb shove into a 14bb stack is a 14bb bet). */
export function uncalledOf(t: TableSetup, sim: Sim): number {
  const live = [...sim.active];
  if (live.length < 2) return 0;
  const inn = (p: string) => (sim.invested[p] ?? 0) + (sim.cur?.bets[p] ?? 0);
  const top = live.reduce((a, b) => (inn(b) > inn(a) ? b : a));
  const most = Math.max(...live.filter((p) => p !== top).map((p) => t.stacks[p] ?? 0));
  return Math.max(0, Math.round((inn(top) - most) * 100) / 100);
}

/** The pot and the price the answer graded on against the table's (the grade's % of the pot is of the answer's pot_bb).
 * The answer's pot may leave out a bet's uncalled excess (uncalledOf); the table's counts it. */
export function checkPot(res: AdvisorResponse, t: TableSetup, sim: Sim, seat: string): Violation[] {
  const out: Violation[] = [];
  const pots = [sim.pot, sim.pot - uncalledOf(t, sim)];
  if (finite(res.pot_bb) && pots.every((p) => Math.abs(res.pot_bb! - p) > 0.011)) out.push(v("table.answer-pot", `the answer's pot is ${res.pot_bb}bb, the table's ${sim.pot}bb`, "soft"));
  const tc = (res as { to_call_bb?: unknown }).to_call_bb;
  const want = toCallOf(t, sim, seat);
  if (finite(tc) && Math.abs(tc - want) > 0.011) out.push(v("table.answer-pot", `the answer's price is ${tc}bb, the table's ${want}bb`, "soft"));
  return out;
}

// ---- provenance honesty

/** What an answer's own fields say its ranges or numbers stand on (advisor.py off_solution, widened, notes; engine/mw_near.py
 * ranges_built and precomputed.borrowed): the betting rules, an unsettled narrowing, a line the solve rarely plays (with
 * the play after it solved again or not), a range widened by the rules, a spot served as built, another table's spot.
 * `leans`: what provenance.ts leansOnRules counts. */
export interface Markers {
  rules: boolean;
  unsettled: boolean;
  rare: boolean;
  rareUnresolved: boolean;
  widened: boolean;
  built: boolean;
  borrowed: boolean;
  leans: boolean;
}

const RULES_NOTE = /^(\w+): ranges narrowed by simple betting rules/;
const MW_RULES_NOTE = /^([\w, ]+): multiway, ranges narrowed by simple betting rules/;
const UNSETTLED_NOTE = /^(\w+): the solve that narrows ranges is ([\d.]+)% of the pot from equilibrium \((\d+) iterations\), so ranges follow it (\d+)%/;
const MW_PARTIAL_NOTE = /^(\w+): 3-way, ranges narrowed through (.+?) \((\d+) iterations, ([\d.]+)% of the pot from equilibrium: followed (\d+)%/;

export function markersOf(r: AdvisorResponse): Markers {
  const off = (Array.isArray(r.off_solution) ? r.off_solution : []).filter((o): o is OffSolution => !!o && typeof o === "object");
  const notes = (Array.isArray(r.notes) ? r.notes : []).filter((n): n is string => typeof n === "string");
  const widened = Array.isArray(r.widened) && r.widened.some((w) => typeof w === "string");
  const trustOf = (n: string) => {
    const u = UNSETTLED_NOTE.exec(n);
    if (u) return Number(u[4]);
    const mw = MW_PARTIAL_NOTE.exec(n);
    return mw && Number(mw[5]) < 100 ? Number(mw[5]) : null;
  };
  const trusts = [...off.filter((o) => o.why === "unsettled").map((o) => (finite(o.trust) ? o.trust : 0)), ...notes.map(trustOf).filter((x): x is number => x !== null)];
  const rules = off.some((o) => o.why === "rules") || notes.some((n) => RULES_NOTE.test(n) || MW_RULES_NOTE.test(n));
  const rareUnresolved = off.some((o) => o.why === "rare" && !o.resolved);
  const bor = r.precomputed?.borrowed;
  const borrowed = !!bor && typeof bor === "object";
  const built = (Array.isArray(r.ranges_built) && r.ranges_built.length > 0) || (borrowed && !!(bor as { built?: unknown }).built);
  return {
    rules,
    unsettled: trusts.length > 0,
    rare: off.some((o) => o.why === "rare"),
    rareUnresolved,
    widened,
    built,
    borrowed,
    leans: rules || rareUnresolved || widened || trusts.some((x) => x < LEAN_TRUST),
  };
}

/** The streets whose ranges an answer narrowed by the betting rules alone, from its notes and off_solution: a heads-up
 * street a quick answer doesn't solve ("ranges narrowed by simple betting rules"), or a 3-way street no solve of it held
 * ("multiway, ranges narrowed by simple betting rules"), in street order. */
export function rulesStreets(r: AdvisorResponse): Street[] {
  const got = new Set<string>();
  for (const o of Array.isArray(r.off_solution) ? r.off_solution : []) if (o && typeof o === "object" && o.why === "rules" && typeof o.street === "string") got.add(o.street);
  for (const n of Array.isArray(r.notes) ? r.notes : []) {
    if (typeof n !== "string") continue;
    const m = RULES_NOTE.exec(n) ?? MW_RULES_NOTE.exec(n);
    if (m) for (const s of m[1]!.split(",")) got.add(s.trim());
  }
  return STREETS.filter((s) => got.has(s));
}

/** The streets a reference narrowed by the rules that Quick's answer of the same state didn't (rulesStreets): where there
 * are any, the reference stood on less of the hand than Quick did (its process had lost or never had the solve of that
 * street), so it answers another question and its verdicts aren't compared. Quick narrowing a street by the rules that the
 * reference solved is the comparison wanted (a quick answer doesn't solve earlier heads-up streets). */
export function outOfContext(quick: readonly string[], ref: readonly string[]): string[] {
  return ref.filter((s) => !quick.includes(s));
}

/** The hands (keys of `boards`, each hand's boards asked) with a board that one of `dropped` (the boards of 3-way solves a
 * process's cache evicted, advserver.py) begins: their earlier streets are gone from that process. */
export function handsOn(dropped: readonly string[], boards: ReadonlyMap<string, readonly string[]>): string[] {
  const out: string[] = [];
  for (const [k, bs] of boards) if (bs.some((b) => dropped.some((d) => d.length >= 6 && b.startsWith(d)))) out.push(k);
  return out;
}

/** Sources whose own label says they're no solve (provenance.ts LABELS): an approximate answer from one needs no more words. */
const SAYS_ITSELF = new Set(["charts", "push-fold", "rules", "equity"]);

/** What was asked: your advice at the spot, or the preflop solve's node (pfGrade.ts). */
export interface Asked {
  asked: "advice" | "pf";
  street: Street;
}

/** The answer's provenance against its own fields: the source what answered (library, live, rules, charts, preflop-solve,
 * push-fold) and none "Unlabelled", an approximate answer saying why, and an answer whose ranges or numbers aren't its own
 * solve's labelled approximate with why, its grade's basis leaning where its ranges lean on the rules, and never a
 * converged band. */
export function checkProvenance(res: AdvisorResponse, p: Provenance, basis: AnswerBasis | null, ask: Asked): Violation[] {
  const out: Violation[] = [];
  const src = p.source;
  const pre = ask.street === "preflop";
  if (src === "unknown") out.push(v("prov.source", `an answer with no source ("Unlabelled"): street ${res.street ?? "?"}, keys ${Object.keys(res).slice(0, 12).join(",")}`));
  if (ask.asked === "pf" && src !== "preflop-solve") out.push(v("prov.source", `the preflop solve was asked and ${src} answered`));
  if (ask.asked === "advice" && pre && !["charts", "push-fold", "rules", "equity", "preflop-solve"].includes(src)) out.push(v("prov.source", `a preflop spot answered by ${src}`));
  if (!pre && ["charts", "push-fold", "preflop-solve"].includes(src)) out.push(v("prov.source", `a ${ask.street} spot answered by ${src}`));
  if (ask.asked === "advice" && typeof res.street === "string" && res.street !== ask.street) out.push(v("prov.source", `a ${ask.street} spot answered for the ${res.street}`));
  if (src === "library" && res.street && res.street !== "flop") out.push(v("prov.source", `a library answer on the ${res.street}`, "soft"));
  if (src === "live" && !(finite(p.iterations) && p.iterations > 0)) out.push(v("prov.source", "a live answer that says no iterations", "soft"));
  const acts = Array.isArray(res.actions) ? res.actions : [];
  if (src === "charts" && acts.length && acts.every((a) => finite(a.ev_bb))) out.push(v("prov.source", "a chart answer with an EV for every action, graded by EV under the chart's label", "soft"));
  // an approximate answer says why: its label, or a source or band that says it
  if (p.approximate && !p.approximateLabel && !SAYS_ITSELF.has(src) && p.band !== "approximate") out.push(v("prov.label", `an approximate ${src} answer with no label saying why`));
  if (SAYS_ITSELF.has(src) && !p.approximate) out.push(v("prov.label", `a ${src} answer not marked approximate`));
  const m = markersOf(res);
  // (the markers that leave the ranges or numbers someone else's; a rare line solved again after it is only a note)
  const off = (["rules", "unsettled", "rareUnresolved", "widened", "built", "borrowed"] as const).filter((k) => m[k]);
  if (off.length && !SAYS_ITSELF.has(src)) {
    if (!p.approximate || !p.approximateLabel) out.push(v("prov.honesty", `ranges or numbers from ${off.join(", ")} but the answer is ${p.approximate ? "approximate with no label" : "not approximate"}`));
    if (m.borrowed && (p.exploitabilityPct !== undefined || p.iterations !== undefined)) out.push(v("prov.band", "another spot's solver numbers shown as this answer's"));
    if ((m.built || m.borrowed) && p.band && p.band !== "approximate") out.push(v("prov.band", `a ${p.band} band on an answer from ${m.built ? "a spot served as built" : "another table's spot"}`));
    if (p.band === "converged") out.push(v("prov.settled", `a converged band (${p.exploitabilityPct}% of the pot) on an answer whose ranges come from ${off.join(", ")}`));
  } else if (m.rare && !SAYS_ITSELF.has(src) && p.band === "converged") out.push(v("prov.settled", "a converged band on an answer with an opponent's rare line (solved again after it)", "soft"));
  if (m.leans && basis && !basis.leans && !SAYS_ITSELF.has(src)) out.push(v("prov.lean", `ranges from ${off.join(", ")} lean on the rules, but the grade's basis doesn't say so (it can condemn a line)`));
  return out;
}

// ---- grade sanity

const RANK: Record<Verdict, number> = { Best: 0, Correct: 0, Inaccuracy: 1, Mistake: 2, Blunder: 3 };
const BAD_WORDS = /NaN|undefined|Infinity|\[object/;

/** Every action of the node graded as Practice grades the one you take (gradeMix with practiceBasis's basis). */
export const gradeAll = (mix: Decision["mix"], pot: number, basis: AnswerBasis): Grade[] => mix.map((_, i) => gradeMix(mix, pot, i, basis));

/** The grades of every action at a node, held to the scale's own promises: an action the hand plays MIX or more is Best or
 * Correct; the top EV (within TOL) is Best; the verdict never improves as the EV given up past the noise grows; a capped
 * grade says why and a clear blunder is a Blunder; no number or word is NaN or undefined; the loss said is the named top
 * EV's less the action's, to the cent; the best named is played or is the action graded. `unit`: the EVs' (evUnit). */
export function checkGrades(mix: Decision["mix"], pot: number, basis: AnswerBasis, unit = "bb"): { grades: Grade[]; violations: Violation[] } {
  const out: Violation[] = [];
  const grades = gradeAll(mix, pot, basis);
  const names = mix.map((x) => x.action);
  const freqs = mix.map((x) => x.freq);
  const evs = mix.length && mix.every((x) => finite(x.ev)) ? mix.map((x) => x.ev!) : null;
  const who = whoOf(basis.source);
  const topEv = evs ? Math.max(...evs) : NaN;
  const d2 = (x: number) => x.toFixed(2);
  let unplayedBest: string | null = null;
  grades.forEach((g, a) => {
    const name = names[a]!;
    const f = finite(freqs[a]) ? freqs[a]! : 0;
    for (const [k, x] of [["loss", g.loss], ["lossPct", g.lossPct]] as const) if (!finite(x)) out.push(v("grade.nan", `${name}: ${k} is ${x}`));
    if (g.noise !== undefined && !finite(g.noise)) out.push(v("grade.nan", `${name}: noise is ${g.noise}`));
    const why = whyText(g, names, freqs, who);
    const lw = lossWords(g, pot, unit) ?? "";
    if (BAD_WORDS.test(why) || BAD_WORDS.test(lw)) out.push(v("grade.nan", `${name}: the words say ${JSON.stringify(BAD_WORDS.test(why) ? why : lw)}`));
    if (freq1(f) >= MIX && !g.ok) out.push(v("grade.mix", `${name}, played ${(f * 100).toFixed(1)}%, graded ${g.verdict}`));
    if (evs && topEv - evs[a]! <= TOL && g.verdict !== "Best") out.push(v("grade.top", `${name} holds the top EV (${evs[a]} of ${topEv}) but is graded ${g.verdict}`));
    if (g.capped && !g.capWhy) out.push(v("grade.cap", `${name}: capped with no reason`));
    if (g.clearWhy && g.verdict !== "Blunder") out.push(v("grade.cap", `${name}: a clear blunder graded ${g.verdict}`));
    if (g.byEv && evs) {
      const top = g.top ?? g.best;
      if (!(Number.isInteger(top) && top >= 0 && top < evs.length)) out.push(v("grade.words", `${name}: no top-EV action (${top})`));
      else {
        const gap = evs[top]! - evs[a]!;
        if (topEv - evs[top]! > TOL + EPS) out.push(v("grade.words", `${name}: the loss is measured against ${names[top]} (${evs[top]}), not the top EV ${topEv}`));
        if (g.loss > 0 && d2(gap) !== d2(g.loss)) out.push(v("grade.words", `${name}: says ${d2(g.loss)} given up, EV(${names[top]}) - EV(${name}) is ${d2(gap)}`));
        const said = /gives up only ([\d.]+)bb against the top EV, (.+?) \(\d/.exec(why);
        if (said && (said[1] !== d2(gap) || said[2] !== names[top])) out.push(v("grade.words", `${name}: the why says ${said[1]}bb against ${said[2]}, EV(${names[top]}) - EV(${name}) is ${d2(gap)}`));
        const given = /EV given up: ≈?([\d.]+)/.exec(lw);
        if (given && given[1] !== d2(g.loss)) out.push(v("grade.words", `${name}: the loss words say ${given[1]}, the grade ${d2(g.loss)}`));
      }
      if (g.best !== a && !(finite(freqs[g.best]) && freqs[g.best]! > 0)) unplayedBest = `${names[g.best]} (graded ${name})`;
    }
  });
  if (unplayedBest) out.push(v("grade.best", `the best named is never played: ${unplayedBest}`));
  if (evs) {
    // (the EV given up past each action's own allowance, for the actions the mix rule leaves to EV: never a better verdict
    // for more of it)
    const pool = grades.map((g, a) => ({ a, g, over: Math.max(0, topEv - evs[a]! - (g.noise ?? 0)) })).filter((x) => freq1(freqs[x.a] ?? 0) < MIX);
    for (const x of pool)
      for (const y of pool)
        if (x.over + 0.005 < y.over && RANK[x.g.verdict] > RANK[y.g.verdict])
          out.push(v("grade.monotone", `${names[x.a]} gives up ${x.over.toFixed(3)}bb past its noise and is graded ${x.g.verdict}, ${names[y.a]} gives up ${y.over.toFixed(3)}bb and is graded ${y.g.verdict}`));
  }
  return { grades, violations: out };
}

/** The grade the decision kept, against the same action graded again here: one path, one grade. */
export function checkDecided(d: Pick<Decision, "grade" | "chose">, again: Grade | undefined): Violation[] {
  if (!d.grade || !again) return [];
  if (d.grade.verdict !== again.verdict || d.grade.loss.toFixed(2) !== again.loss.toFixed(2)) return [v("grade.decided", `${d.chose}: kept ${d.grade.verdict} (${d.grade.loss.toFixed(2)}), graded again ${again.verdict} (${again.loss.toFixed(2)})`)];
  return [];
}

// ---- preflop

/** The most played action's index (the first of ties), or -1 with none. */
export const topFreq = (freqs: readonly number[]): number => freqs.reduce((b, f, i) => (finite(f) && (b < 0 || f > freqs[b]!) ? i : b), -1);

/** The mix's action that is action `name` (`amount`) of another answer: the same name, else the one action of its kind,
 * else the one of its kind at that size. -1 where there's none. */
export function sameAction(mix: Decision["mix"], name: string, amount: number | undefined): number {
  const exact = mix.findIndex((m) => m.action === name);
  if (exact >= 0) return exact;
  const kind = mix.map((m, i) => (kindOf(m.action) === kindOf(name) ? i : -1)).filter((i) => i >= 0);
  if (kind.length === 1) return kind[0]!;
  return amount === undefined ? -1 : (kind.find((i) => mix[i]!.amount !== undefined && Math.abs(mix[i]!.amount! - amount) <= 0.051) ?? -1);
}

/** A preflop decision. Graded by the solve: the move the solve plays most is Best or Correct, and the chart's most played
 * move (a chart-following decision) is not condemned, Mistake or Blunder (hard; graded Inaccuracy it is soft: the solve's
 * model and the charts part by about that much, docs/ACCURACY.md 18.8, and an Inaccuracy is the grade's own word for "a
 * little worse"); any other move the chart plays MIX or more graded below Correct is soft; and no node with a move the
 * solve never learned an EV for (pfGrade.ts untrainedMoves) is graded by EV. Graded by the charts: the chart's most played
 * move is Best. `chart`: the chart's answer; `graded`: what decide graded against; `pf`: the solve's node where it was
 * asked; `ownOptions`: the session's pfOptions (your options are the solve's own, not the chart's). */
export function checkPreflop(a: {
  chart: AdvisorResponse;
  graded: { mix: Decision["mix"]; pot: number; basis: AnswerBasis; source: string };
  pf?: AdvisorResponse | null;
  ownOptions?: boolean;
}): Violation[] {
  const out: Violation[] = [];
  const { mix, pot, basis, source } = a.graded;
  if (!mix.length) return out;
  const gradeOf = (i: number) => gradeMix(mix, pot, i, basis);
  if (source === "preflop-solve") {
    if (a.pf) {
      const un = untrainedMoves(a.pf);
      if (un.length) out.push(v("pf.untrained", `graded by the solve's EVs at a node with untrained moves: ${un.map((u) => u.action).join(", ")}`));
    }
    const s = topFreq(mix.map((x) => x.freq));
    const gs = gradeOf(s);
    if (!gs.ok) out.push(v("pf.follow", `the solve's own most played move, ${mix[s]!.action} (${(mix[s]!.freq * 100).toFixed(1)}%), graded ${gs.verdict}`));
    if (!a.ownOptions) {
      const chartActs = (Array.isArray(a.chart.actions) ? a.chart.actions : []).filter((x) => finite(x.freq));
      const c = topFreq(chartActs.map((x) => x.freq!));
      // (the chart's most played move; where two or more tie for it (a 50/50 chart), whichever the chart lists first was
      // held hard and the other soft, so the verdict hung on the list's order: a tie is hard only where the solve condemns
      // every tied move, as it then condemns whatever the chart's main advice is. Condemns: Mistake or Blunder; an
      // Inaccuracy is soft)
      const condemned = (k: number) => BAD(gradeOf(k).verdict);
      const tied = c < 0 ? [] : chartActs.map((x, k) => (Math.abs(x.freq! - chartActs[c]!.freq!) <= 0.005 ? k : -1)).filter((k) => k >= 0);
      const at = chartActs.map((ca) => sameAction(mix, ca.action, ca.amount_bb));
      const allTiedDown = tied.length > 0 && tied.every((k) => at[k]! < 0 || condemned(at[k]!)) && tied.some((k) => at[k]! >= 0);
      chartActs.forEach((ca, k) => {
        const top = tied.includes(k);
        if (!top && freq1(ca.freq!) < MIX) return;
        if (at[k]! < 0) return;
        const g = gradeOf(at[k]!);
        if (!g.ok) {
          const hard = top && allTiedDown;
          const what = `the chart's ${top ? (tied.length > 1 ? `most played (tied with ${tied.length - 1} other${tied.length > 2 ? "s" : ""})` : "most played") : "mixed"} move, ${ca.action} (${(ca.freq! * 100).toFixed(1)}%), graded ${g.verdict} by the solve (${g.loss.toFixed(2)}bb given up, ${(g.pastPct ?? 0).toFixed(1)}% of the pot past its noise)`;
          out.push(v("pf.follow", what, hard ? "hard" : "soft"));
        }
      });
    }
  } else if (source === "charts") {
    const c = topFreq(mix.map((x) => x.freq));
    const g = gradeOf(c);
    if (g.verdict !== "Best") out.push(v("pf.follow", `the chart's most played move, ${mix[c]!.action}, graded ${g.verdict}`));
  }
  return out;
}

// ---- opponents

/** No two cards left beat this hand on this board. */
export function isNuts(hole: readonly string[], board: readonly string[]): boolean {
  const val = rank7([...hole, ...board]);
  const rest = DECK.filter((x) => !hole.includes(x) && !board.includes(x));
  for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) if (cmp(rank7([rest[i]!, rest[j]!, ...board]), val) > 0) return false;
  return true;
}

/** What an opponent's move says to a person watching (live.sim.test.ts's absurdities, on the sweep's real answers): a fold
 * where checking was free; on the river a fold of the nuts; on the flop or turn a fold of two pair or better made with
 * its own cards (handTier 3) facing a bet of at most three quarters of the pot; facing a pot-size bet or more with nothing
 * (no pair, no draw, no straight or better), whether it called. */
export interface OppFlags {
  freeFold: boolean;
  riverNutFold: boolean;
  /** a flop or turn fold of two pair or better facing at most 75% of the pot (absent in records made before it) */
  strongFold?: boolean;
  /** null where it wasn't facing a pot-size bet or more with nothing */
  nothingPot: { called: boolean } | null;
}

export function oppFlags(h: PracticeHand, sim: Sim, seat: string, m: Move): OppFlags {
  const t = setupOf(h);
  const toCall = sim.cur ? toCallOf(t, sim, seat) : 0;
  const board = h.board.slice(0, h.shown);
  const hole = h.hands[seat]!;
  const flags: OppFlags = { freeFold: m.action === "fold" && toCall <= EPS, riverNutFold: false, strongFold: false, nothingPot: null };
  if (board.length >= 3 && toCall > EPS) {
    if (m.action === "fold" && board.length === 5 && isNuts(hole, board)) flags.riverNutFold = true;
    const { tier, draw } = handTier(hole, board);
    const cat = rank7([...hole, ...board])[0]!;
    const rem = behind(t, sim, seat);
    const frac = Math.min(toCall, rem) / Math.max(EPS, sim.pot - toCall);
    if (m.action === "fold" && board.length < 5 && tier === 3 && frac <= 0.75 + EPS) flags.strongFold = true;
    if (tier === 0 && !draw && cat < 4 && frac >= 1 - EPS) flags.nothingPot = { called: m.action === "call" || (m.action === "all-in" && rem <= toCall + EPS) };
  }
  return flags;
}

// ---- Quick against a reference

/** One action graded on Practice's answer and on a reference answer (Fast or Accurate) of the same state: `condemns`,
 * Practice says Mistake or Blunder where the reference says Best or Correct; `passes`, Practice says Best or Correct where
 * the reference says Mistake or Blunder. */
export interface RefCompare {
  action: string;
  quick: Verdict;
  ref: Verdict;
  agree: boolean;
  condemns: boolean;
  passes: boolean;
  quickFreq: number;
  refFreq: number;
  quickEv: number | null;
  refEv: number | null;
}


/** The same action (sameAction) in the reference's mix, graded there as Practice grades. Null where the reference has no
 * such action. */
export function compareRef(action: string, quick: { mix: Decision["mix"]; grade: Grade }, ref: { mix: Decision["mix"]; pot: number; basis: AnswerBasis }): RefCompare | null {
  const q = quick.mix.find((x) => x.action === action);
  const j = sameAction(ref.mix, action, q?.amount);
  if (j < 0) return null;
  const rg = gradeMix(ref.mix, ref.pot, j, ref.basis);
  return {
    action,
    quick: quick.grade.verdict,
    ref: rg.verdict,
    agree: quick.grade.verdict === rg.verdict,
    condemns: BAD(quick.grade.verdict) && OK(rg.verdict),
    passes: OK(quick.grade.verdict) && BAD(rg.verdict),
    quickFreq: q?.freq ?? 0,
    refFreq: ref.mix[j]!.freq,
    quickEv: q?.ev ?? null,
    refEv: ref.mix[j]!.ev,
  };
}

/** One action of the node on both answers (compareAll). */
export interface RefAction {
  action: string;
  quick: Verdict;
  /** null where the reference has no such action */
  ref: Verdict | null;
  quickFreq: number;
  refFreq: number | null;
  quickEv: number | null;
  refEv: number | null;
}

/** Every action at Practice's node graded on both answers, not only the one taken: the move you made is mostly drawn
 * from Quick's own mix, which Quick grades Best or Correct by its frequency alone, so comparing that move only says
 * little about the grades a user choosing anything else would see. `grades`: Quick's grade of each action of its mix. */
export function compareAll(quick: { mix: Decision["mix"]; grades: readonly Grade[] }, ref: { mix: Decision["mix"]; pot: number; basis: AnswerBasis }): RefAction[] {
  return quick.mix.map((q, i) => {
    const j = sameAction(ref.mix, q.action, q.amount);
    const rg = j >= 0 ? gradeMix(ref.mix, ref.pot, j, ref.basis) : null;
    return {
      action: q.action,
      quick: quick.grades[i]!.verdict,
      ref: rg ? rg.verdict : null,
      quickFreq: freq1(q.freq),
      refFreq: j >= 0 ? freq1(ref.mix[j]!.freq) : null,
      quickEv: q.ev === null ? null : Math.round(q.ev * 1000) / 1000,
      refEv: j >= 0 && ref.mix[j]!.ev !== null ? Math.round(ref.mix[j]!.ev! * 1000) / 1000 : null,
    };
  });
}
