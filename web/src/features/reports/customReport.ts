// A flop report of your own spot: Study's heads-up flop, with its own setup and preflop line, answered on a sample of
// flops one at a time in this browser, and drawn as Reports draws a library spot's (the rows, averages, groups, chart and
// CSV of reports.ts). The library reports only what it stores; this reports a spot it doesn't, at the cost of a solve a
// flop.
//
// What's sampled. Every flop up to suit isomorphism (the 1,755 classes, each standing for w of the 22100), sorted so that
// alike ones sit together, and walked as the turn report walks its flops (turnReport.ts readingOrder): any stretch from the
// start is spread evenly over the textures, so a report stopped part way, or solved further, is still a fair sample. Each
// class is equally likely and each row weighs w, as in the library's report.
//
// What's asked a flop. The root (out of position first), then the nodes the report's views read: in position after a
// check, in position facing out of position's most common first bet, and out of position facing in position's most
// common bet after a check. The root is the solve; the rest are read from the same flop's tree. A flop whose root wasn't
// solved (the betting rules or an equity read answered) is left out and counted, never shown as a solve.
import { kindOf } from "@/components/actions";
import { texture } from "@/features/practice/texture";
import { encodeLine, play, studyRequest, toSearch, type StudyHand } from "@/features/study/studyState";
import type { LibraryReport, ReportFlop } from "@/library/files";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import type { Provenance, ResultSource, SolveMode, SolveResult } from "@/solver/types";
import { readingOrder } from "./turnReport";

/** flops solved at a time, and added by each "solve more" */
export const CUSTOM_SAMPLE = 12;

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";
const PERMS: readonly string[] = (() => {
  const out: string[] = [];
  const go = (rest: string, acc: string) => (rest ? [...rest].forEach((c, i) => go(rest.slice(0, i) + rest.slice(i + 1), acc + c)) : out.push(acc));
  go(SUITS, "");
  return out;
})();
const card = (i: number) => RANKS[i >> 2]! + SUITS[i & 3]!;
// (a flop as its three cards high to low, ties by suit: one string per flop)
const sortCards = (cs: string[]) => [...cs].sort((a, b) => RANKS.indexOf(b[0]!) - RANKS.indexOf(a[0]!) || (a[1]! < b[1]! ? -1 : a[1]! > b[1]! ? 1 : 0)).join("");

let classes: readonly { f: string; w: number }[] | null = null;

/** Every flop class: the least of its suit relabellings, and how many of the 22100 flops it stands for (worked out once,
 * when first asked: about 0.5M relabellings). */
export function flopClassList(): readonly { f: string; w: number }[] {
  return (classes ??= listClasses());
}

function listClasses(): { f: string; w: number }[] {
  const count = new Map<string, number>();
  for (let a = 0; a < 52; a++)
    for (let b = a + 1; b < 52; b++)
      for (let c = b + 1; c < 52; c++) {
        const cs = [card(a), card(b), card(c)];
        let best = "";
        for (const p of PERMS) {
          const s = sortCards(cs.map((x) => x[0]! + p[SUITS.indexOf(x[1]!)]!));
          if (!best || s < best) best = s;
        }
        count.set(best, (count.get(best) ?? 0) + 1);
      }
  return [...count].map(([f, w]) => ({ f, w }));
}

const ORDER_KEY = (f: string) => {
  const t = texture(f);
  return [t.suits, t.pair, t.hi, t.conn, f].join(" ");
};

/** The flops in the order they're solved: alike ones together, walked evenly from the seed. */
export function sampleOrder(seed: number): { f: string; w: number }[] {
  const sorted = [...flopClassList()].map((x) => ({ ...x, k: ORDER_KEY(x.f) })).sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  return readingOrder(
    sorted.map(({ f, w }) => ({ f, w })),
    seed,
  );
}

/** One flop answered: each node's actions and their frequencies, the players' EVs and equities where the answer has them. */
export interface CustomFlop {
  f: string;
  w: number;
  nodes: Record<string, { names: string[]; freqs: number[] }>;
  ev?: [number, number];
  eq?: [number, number];
  /** the bet each facing node faces, in bb as Study plays it, by the node's path */
  bets: Record<string, number>;
  source: ResultSource;
  approximate: boolean;
  seconds?: number;
}

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
  return { f: flop.f, w: flop.w, nodes, bets, ...(ev ? { ev } : {}), ...(eq ? { eq } : {}), source: p.source, approximate: p.approximate, ...(p.seconds !== undefined ? { seconds: p.seconds } : {}) };
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

/** What the numbers are: your spot, solved here a flop at a time, with how many and how. */
export function customProvenance(flops: readonly CustomFlop[], mode: SolveMode, left: number): Provenance {
  const live = flops.filter((x) => x.source === "live").length;
  const stored = flops.length - live;
  const approx = flops.filter((x) => x.approximate).length;
  const how = [live ? `${live} solved here` : "", stored ? `${stored} read from the library` : ""].filter(Boolean).join(", ");
  return {
    source: live ? "live" : "library",
    approximate: approx > 0,
    approximateLabel: `flop report of your spot over ${flops.length} sampled flop${flops.length === 1 ? "" : "s"} (${how})${approx ? `, ${approx} short of the accuracy target` : ""}${left ? `, ${left} left out` : ""}`,
    mode,
    transport: "worker",
    solverVersion: "your spot's flop report",
    partial: false,
    receivedAt: Date.now(),
  };
}
