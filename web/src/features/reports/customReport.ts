// A flop report of your own spot: a heads-up flop spot set up in Study or on the Solve page, with its own setup and
// preflop line, solved on a representative set of flops one at a time in the browser's solver worker, and drawn as
// Reports draws a library spot's (the rows, averages, groups, chart and CSV of reports.ts). The library reports only what
// it stores; this reports a spot it doesn't, at the cost of a solve a flop.
//
// What's solved. The solver's representative set of n flops (flopSets.ts: 9, 25, 49, 95 or 184, picked by how often each
// is dealt, each then standing for 22,100/n flops), solved in an order that spreads any stretch from the start evenly
// over the set (turnReport.ts readingOrder), so a report paused part way is still a fair sample of it. The report and each
// flop's answer are kept in this browser (data/flopReports.ts) after every flop.
//
// What's asked a flop. The root (out of position first), then the nodes the report's views read: in position after a
// check, in position facing out of position's most common first bet, and out of position facing in position's most
// common bet after a check. The root is the solve; the rest are read from the same flop's tree. A flop whose root wasn't
// solved (the betting rules or an equity read answered) is left out and counted, never shown as a solve.
import { kindOf } from "@/components/actions";
import type { FlopReportFlop, FlopReportRecord } from "@/data/db";
import { encodeLine, fromSearch, play, studyRequest, toSearch, type StudyHand } from "@/features/study/studyState";
import type { LibraryReport, ReportFlop } from "@/library/files";
import { abstractionWords, type FlopModel } from "@/solver/abstraction";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import type { Provenance, ResultSource, SolveMode, SolveResult, TransportKind } from "@/solver/types";
import { flopSet, type SetFlop } from "./flopSets";
import { seatsOf } from "@/poker/seats";
import { readingOrder } from "./turnReport";

/** the order a set's flops are solved in: the same for a set every time */
const SEED = 1;

/** A new report of a spot: the set of `size` in the order it's solved, nothing solved yet. */
export function newFlopReport(spot: StudyHand, opts: { id: string; name: string; from: FlopReportRecord["from"]; mode: SolveMode; size: number; now: number }): FlopReportRecord {
  const flops = readingOrder(flopSet(opts.size), SEED).map((x) => x.f);
  return {
    id: opts.id,
    name: opts.name,
    spot: toSearch(customBase(spot)),
    from: opts.from,
    mode: opts.mode,
    size: opts.size,
    flops,
    done: [],
    left: [],
    seats: null,
    pot: 0,
    status: "paused",
    note: "",
    createdAt: opts.now,
    updatedAt: opts.now,
  };
}

/** The set's flops not yet tried, in order, each with its weight. */
export function flopsToGo(r: Pick<FlopReportRecord, "size" | "flops" | "done" | "left">): SetFlop[] {
  const tried = new Set([...r.done.map((d) => d.f), ...r.left.map((l) => l.f)]);
  const byF = new Map(flopSet(r.size).map((x) => [x.f, x]));
  return r.flops.filter((f) => !tried.has(f)).flatMap((f) => byF.get(f) ?? []);
}

/** The spot a report is of, from its record (null where the link no longer reads). */
export const reportSpot = (r: Pick<FlopReportRecord, "spot">): StudyHand | null => fromSearch(r.spot);

/** The seats still in after the preflop line: the table's less those who folded. */
export const seatsIn = (h: StudyHand): string[] => {
  const out = new Set(h.preflop.filter((a) => kindOf(a.action) === "fold").map((a) => a.pos));
  return seatsOf(h.players).filter((p) => !out.has(p));
};

/** Whether a spot can be reported: its preflop line closed with two players to see a flop, and no tournament (its EVs
 * are prize equity, which the report's columns aren't). `unfinished`: the line doesn't reach a flop, so a pot can be
 * picked for it (potLine). */
export type SpotCheck = { ok: true } | { ok: false; why: string; unfinished: boolean };

export async function checkSpot(ask: Ask, h: StudyHand): Promise<SpotCheck> {
  if (h.setup?.tournament) return { ok: false, why: "a tournament spot's EVs are prize equity, which a flop report doesn't show", unfinished: false };
  const res = (await ask(studyRequest(customBase(h)))).data;
  if (res.error) return { ok: false, why: res.error, unfinished: false };
  if (res.study !== "deal" || res.street !== "flop") return { ok: false, why: "its preflop line doesn't reach a flop yet", unfinished: true };
  const left = seatsIn(h);
  if (left.length !== 2) return { ok: false, why: `${left.length} players see the flop, and a flop report is heads-up`, unfinished: true };
  return { ok: true };
}

export type PotKind = "srp" | "3bp";
export const POT_WORDS: Record<PotKind, string> = { srp: "single-raised", "3bp": "3-bet" };

/** Who may open (anyone but the big blind) and who may then call or 3-bet (anyone after the opener). */
export const openers = (players: number) => seatsOf(players).slice(0, -1);
export const callersAfter = (players: number, opener: string) => seatsOf(players).slice(seatsOf(players).indexOf(opener) + 1);

/** The spot's preflop line for a pot: everyone folds to the opener, who raises; the rest fold to the caller, who calls (a
 * single-raised pot) or 3-bets and is called. Each action is the one the spot's own preflop answer offers (the charts', or
 * the preflop solve's), walked node by node as Study plays it. Throws where the answer offers no such action. */
export async function potLine(ask: Ask, h: StudyHand, opener: string, caller: string, kind: PotKind): Promise<StudyHand> {
  let at: StudyHand = { ...customBase(h), preflop: [] };
  for (let i = 0; i < 24; i++) {
    const res = (await ask(studyRequest(at))).data;
    if (res.study === "deal") return at;
    if (res.error) throw new Error(res.error);
    if (res.street !== "preflop" || !res.actor) throw new Error("the preflop line can't be walked here");
    const acts = res.actions ?? [];
    const raises = at.preflop.filter((a) => kindOf(a.action) === "raise").length;
    const actor = String(res.actor);
    const want = actor === opener && raises === 0 ? "raise" : actor === caller && raises === 1 ? (kind === "srp" ? "call" : "raise") : actor === opener && raises === 2 ? "call" : "fold";
    // (of several sizes, the one played most)
    const like = acts.filter((a) => kindOf(a.action) === want);
    const pick = like.length ? like.reduce((x, y) => ((y.freq ?? 0) > (x.freq ?? 0) ? y : x)) : want === "fold" ? acts.find((a) => kindOf(a.action) === "check") : undefined;
    if (!pick) throw new Error(`${actor} has no ${want} in this spot's preflop answer`);
    at = play(at, res, pick);
  }
  throw new Error("the preflop line didn't close");
}

/** One flop answered (stored as it is: db.ts FlopReportFlop). */
export type CustomFlop = FlopReportFlop;

/** What the page asks: a node, answered (useSolver's client.solve, with the mode and a stop). */
export type Ask = (state: AdvisorState) => Promise<SolveResult<AdvisorResponse>>;

/** The spot a report is of: Study's hand at a heads-up flop's first decision, with its board taken off. */
export function customBase(h: StudyHand): StudyHand {
  return { ...h, board: "", flop: [], turn: [], river: [] };
}

/** The answers a report stands on are solves of the flop (live, or the library's stored one), not the rules'. */
const SOLVED: readonly ResultSource[] = ["live", "library", "instant"];

const node = (res: AdvisorResponse) => {
  const acts = res.actions ?? [];
  return { names: acts.map((a) => a.action), freqs: acts.map((a) => a.freq ?? 0) };
};

/** below this, a bet's response isn't read (the library stores none either; Reports says so under a facing view) */
const FACED = 0.05;

/** The most common bet at a node, made at least FACED of the time, as Study would play it; null with none. */
function topBet(res: AdvisorResponse) {
  const bets = (res.actions ?? []).filter((a) => kindOf(a.action) === "bet" && typeof a.amount_bb === "number" && (a.freq ?? 0) >= FACED);
  return bets.length ? bets.reduce((x, y) => ((y.freq ?? 0) > (x.freq ?? 0) ? y : x)) : null;
}

/** Answer one flop: its root, and the nodes the views read. Throws where the root isn't a solve of this flop. */
export async function solveFlop(ask: Ask, base: StudyHand, flop: { f: string; w: number }): Promise<CustomFlop> {
  const at = { ...customBase(base), board: flop.f };
  const root = await ask(studyRequest(at));
  const r = root.data;
  if (r.error) throw new Error(r.error);
  if (!SOLVED.includes(root.provenance.source)) throw new Error(`answered by ${root.provenance.source}, not a solve`);
  if (r.street !== "flop" || r.multiway) throw new Error("not a heads-up flop");
  const nodes: CustomFlop["nodes"] = { "": node(r) };
  const bets: CustomFlop["bets"] = {};
  const kids: [string, StudyHand][] = [];
  const check = (r.actions ?? []).find((a) => kindOf(a.action) === "check");
  if (check) kids.push(["check", play(at, r, check)]);
  const bet = topBet(r);
  if (bet) {
    kids.push([bet.action, play(at, r, bet)]);
    bets[bet.action] = bet.amount_bb as number;
  }
  for (const [key, h] of kids) {
    const res = (await ask(studyRequest(h))).data;
    if (res.error || res.street !== "flop") continue;
    nodes[key] = node(res);
    // (out of position facing in position's most common bet after the check)
    const b = key === "check" ? topBet(res) : null;
    if (b) {
      const faced = (await ask(studyRequest(play(h, res, b)))).data;
      if (!faced.error && faced.street === "flop") {
        nodes[`check|${b.action}`] = node(faced);
        bets[`check|${b.action}`] = b.amount_bb as number;
      }
    }
  }
  const p = root.provenance;
  const ev = typeof r.range_ev_bb === "number" && typeof r.pot_bb === "number" && !base.setup?.rake && !base.setup?.tournament ? ([r.range_ev_bb, r.pot_bb - r.range_ev_bb] as [number, number]) : undefined;
  const eq = typeof r.range_eq === "number" && typeof r.opponent_eq === "number" ? ([r.range_eq, r.opponent_eq] as [number, number]) : undefined;
  return {
    f: flop.f,
    w: flop.w,
    nodes,
    bets,
    ...(ev ? { ev } : {}),
    ...(eq ? { eq } : {}),
    source: p.source,
    approximate: p.approximate,
    ...(p.exploitabilityPct !== undefined ? { exploitabilityPct: p.exploitabilityPct } : {}),
    ...(p.iterations !== undefined ? { iterations: p.iterations } : {}),
    ...(p.seconds !== undefined ? { seconds: p.seconds } : {}),
  };
}

/** The flops answered as a report reports.ts draws: each node's names the union over the flops, in first-seen order. */
export function customReport(base: StudyHand, seats: [string, string], pot: number, flops: readonly CustomFlop[]): LibraryReport {
  const names: Record<string, string[]> = {};
  for (const fl of flops)
    for (const [k, nd] of Object.entries(fl.nodes)) {
      const into = (names[k] ??= []);
      for (const n of nd.names) if (!into.includes(n)) into.push(n);
    }
  const rows: ReportFlop[] = flops.map((fl) => ({
    f: fl.f,
    w: fl.w,
    n: Object.fromEntries(Object.entries(fl.nodes).map(([k, nd]) => [k, names[k]!.map((n) => nd.freqs[nd.names.indexOf(n)] ?? 0)])),
    ...(fl.ev ? { ev: fl.ev } : {}),
    ...(fl.eq ? { eq: fl.eq } : {}),
  }));
  return {
    format: 1,
    id: "mine",
    label: "Your spot",
    line: encodeLine(base.preflop),
    seats,
    pot,
    stack: base.stack,
    nodes: names,
    flops: rows,
    game: { players: base.players, stack: base.stack, ante: base.setup?.ante ?? 0, straddle: !!base.setup?.straddle },
  };
}

/** Study at a node of a flop answered, on your spot: the node's path ("", "check", "bet 33%", "check|bet 75%") played from
 * the flop's root at the sizes it was answered with; null where the flop has no such node. */
export function customStudyHand(base: StudyHand, seats: readonly [string, string], fl: CustomFlop, path: string): StudyHand | null {
  if (!fl.nodes[path]) return null;
  const [oop, ip] = seats;
  const flop: StudyHand["flop"] = [];
  if (path.startsWith("check")) flop.push({ pos: oop, action: "check" });
  if (path && path !== "check") {
    const to = fl.bets[path];
    if (to === undefined) return null;
    flop.push({ pos: path.startsWith("check") ? ip : oop, action: "bet", to });
  }
  return { ...customBase(base), board: fl.f, flop };
}

export function customStudyLink(base: StudyHand, seats: readonly [string, string], fl: CustomFlop, path: string): string | null {
  const h = customStudyHand(base, seats, fl, path);
  return h ? `/study?${toSearch(h)}` : null;
}

const TIER: Record<SolveMode, string> = { quick: "Quick", fast: "Fast", accurate: "Accurate" };
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;
const pct = (x: number) => `${x < 0.1 ? x.toFixed(3) : x.toFixed(2)}%`;

/** What the numbers are: your spot, solved live at a tier over n flops of a representative set, with how far each solve
 * was from equilibrium in its own game and what its flop model gave up against the full game (abstraction.ts). A flop the
 * library stores is read from it (Study's own rule), and the label says how many were. */
export function customProvenance(r: Pick<FlopReportRecord, "done" | "left" | "size" | "mode" | "flops">, transport: TransportKind = "worker"): Provenance {
  const flops = r.done;
  const live = flops.filter((x) => x.source === "live");
  const stored = flops.filter((x) => x.source === "library").length;
  const other = flops.length - live.length - stored;
  const approx = flops.filter((x) => x.approximate).length;
  const togo = r.flops.length - flops.length - r.left.length;
  const ex = live.flatMap((x) => (typeof x.exploitabilityPct === "number" ? [x.exploitabilityPct] : []));
  const its = live.flatMap((x) => (typeof x.iterations === "number" ? [x.iterations] : []));
  const each = r.size >= 1755 ? "each weighted by how often it's dealt" : `each standing for 1/${r.size} of all flops`;
  const how = [
    live.length ? `${live.length} solved live at ${TIER[r.mode]}` : "",
    stored ? `${stored} read from the flop library, which stores ${stored === 1 ? "it" : "them"}` : "",
    other ? `${other} read at once from other solves` : "",
  ].filter(Boolean);
  const view = [
    `flop report of your spot over ${plural(flops.length, "sampled flop")} of the solver's representative ${r.size}, ${each}`,
    how.join(", "),
    ex.length ? `each solve ${pct(Math.min(...ex))} to ${pct(Math.max(...ex))} pot from equilibrium in its own game (mean ${pct(ex.reduce((a, b) => a + b, 0) / ex.length)})` : "",
    its.length ? `${Math.min(...its)}–${Math.max(...its)} iterations a flop` : "",
  ].filter(Boolean);
  const model: FlopModel | null = live.length && transport === "worker" && (r.mode === "fast" || r.mode === "accurate") ? r.mode : stored ? "library" : null;
  const words = abstractionWords(model);
  return {
    source: live.length ? "live" : stored ? "library" : "instant",
    approximate: approx > 0 || togo > 0,
    view: view.join("; "),
    ...(approx || r.left.length || togo
      ? { approximateLabel: [approx ? `${approx} short of the accuracy target` : "", r.left.length ? `${r.left.length} left out, not solved` : "", togo ? `${togo} of the set not solved yet` : ""].filter(Boolean).join(", ") }
      : {}),
    ...(words ? { abstraction: live.length && stored && model !== "library" ? `${words} (the library's flops: ${abstractionWords("library")})` : words } : {}),
    mode: r.mode,
    transport,
    solverVersion: "your spot's flop report",
    partial: false,
    receivedAt: Date.now(),
  };
}
