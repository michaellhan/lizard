// Drills: one precomputed spot's decision dealt hand after hand, answered at once from the flop library with no
// solver (classic drills.js). A flop is drawn by weight (each stands for its share of the 22100) among the spot's
// flops that store the node and pass the texture filter. A hand is drawn from the acting player's range there: its
// weight entering the flop, off the board, times its own frequency of the line so far, shown in a random suit
// relabelling. The stored mix and EVs for that hand grade the pick, on the one scale (src/grading/grade.ts).
import { gameSetup } from "@/features/solve/setup";
import { parseLine, toSearch, type StudyHand } from "@/features/study/studyState";
import { grade, type Grade } from "@/grading/grade";
import { bandOf } from "@/solver/provenance";
import type { Provenance, SolveMode } from "@/solver/types";
import { COMBOS, cardStr, flopCards, handWeights, nodeAt, SUITS, type Entry, type LibraryRanges } from "@/library/entry";
import type { LibraryReport } from "@/library/files";

// ---- a flop's texture (classic reports.js): high card, pairing, suits, connectedness. Connected: any straight with
// two hole cards; semi-connected: two ranks within a straight's span; else disconnected. Paired and trips flops count
// their distinct ranks.
const RANKS = "23456789TJQKA";
export interface Texture {
  high: string;
  hi: string;
  pair: "unpaired" | "paired" | "trips";
  suits: "mono" | "twotone" | "rainbow";
  conn: "conn" | "semi" | "dry";
}

export function texture(f: string): Texture {
  const cs = flopCards(f);
  const r = cs.map((c) => RANKS.indexOf(c[0]!)).sort((a, b) => b - a);
  const su = new Set(cs.map((c) => c[1])).size;
  const d = [...new Set(r)];
  const lo = d.map((x) => (x === 12 ? -1 : x)); // (the ace plays low too)
  const span = (xs: number[]) => Math.max(...xs) - Math.min(...xs) <= 4;
  const near = (xs: number[]) => xs.some((a, i) => xs.some((b, j) => j > i && Math.abs(a - b) <= 4));
  const conn = d.length === 3 && (span(d) || span(lo)) ? "conn" : near(d) || near(lo) ? "semi" : "dry";
  const high = RANKS[r[0]!]!;
  return {
    high,
    hi: "AKQJT".includes(high) ? high : "9-",
    pair: d.length === 3 ? "unpaired" : d.length === 2 ? "paired" : "trips",
    suits: su === 1 ? "mono" : su === 2 ? "twotone" : "rainbow",
    conn,
  };
}

export type TextureKey = "hi" | "suits" | "pair" | "conn";
export type TextureFilter = Partial<Record<TextureKey, string>>;
export const TEXTURE_GROUPS: readonly { key: TextureKey; label: string; values: Record<string, string> }[] = [
  { key: "hi", label: "High card", values: { A: "A high", K: "K high", Q: "Q high", J: "J high", T: "T high", "9-": "9 high or lower" } },
  { key: "suits", label: "Suits", values: { rainbow: "Rainbow", twotone: "Two-tone", mono: "Monotone" } },
  { key: "pair", label: "Pairing", values: { unpaired: "Unpaired", paired: "Paired", trips: "Trips" } },
  { key: "conn", label: "Connectedness", values: { conn: "Connected", semi: "Semi-connected", dry: "Disconnected" } },
];

// ---- the drills: a spot's node, as the reports' views (out of position first; in position after a check; out of
// position facing a bet after checking, any stored size, drawn by how often in position bets it; in position facing
// out of position's first bet, the same way: Lizard's, as classic has the first three)
export type DrillView = "oop" | "ip" | "vsbet" | "ipvsbet";
export const DRILL_VIEWS: readonly DrillView[] = ["oop", "ip", "vsbet", "ipvsbet"];
export function viewLabel(view: DrillView, seats: readonly string[]): string {
  if (view === "oop") return `${seats[0]} first to act`;
  if (view === "ip") return `${seats[1]} after ${seats[0]} checks`;
  if (view === "ipvsbet") return `${seats[1]} faces ${seats[0]}'s bet`;
  return `${seats[0]} checks, faces a bet`;
}

export interface Candidate {
  f: string;
  path: string[];
  w: number;
}

/** the (flop, node) pairs a drill draws from, with their weights */
export function candidates(rep: LibraryReport, view: DrillView, filter: TextureFilter = {}): Candidate[] {
  const out: Candidate[] = [];
  for (const fl of rep.flops) {
    const t = texture(fl.f);
    if (!Object.entries(filter).every(([k, v]) => !v || t[k as TextureKey] === v)) continue;
    if (view === "oop" && fl.n[""]) out.push({ f: fl.f, path: [], w: fl.w });
    else if (view === "ip" && fl.n.check) out.push({ f: fl.f, path: ["check"], w: fl.w });
    else if (view === "vsbet" || view === "ipvsbet") {
      // (the bets faced: after a check, "check|bet 33%"; or out of position's first, "bet 33%")
      const at = view === "vsbet" ? "check" : "";
      const ks = Object.keys(fl.n).filter((k) => (view === "vsbet" ? k.startsWith("check|") : k !== "" && k !== "check" && !k.includes("|")));
      const cn = rep.nodes[at] ?? [];
      const fq = ks.map((k) => (fl.n[at] ? (fl.n[at][cn.indexOf(view === "vsbet" ? k.slice(6) : k)] ?? 0) : 0));
      const t = fq.reduce((a, b) => a + b, 0);
      ks.forEach((k, i) => out.push({ f: fl.f, path: k.split("|"), w: fl.w * (t > 0 ? fq[i]! / t : 1 / ks.length) }));
    }
  }
  return out.filter((c) => c.w > 0);
}

/** an index drawn by weight; -1 if none has any */
export function pick(ws: readonly number[], rng: () => number): number {
  const t = ws.reduce((a, b) => a + b, 0);
  let x = rng() * t;
  for (let i = 0; i < ws.length; i++) {
    x -= ws[i]!;
    if (x < 0 && ws[i]! > 0) return i;
  }
  for (let i = ws.length - 1; i >= 0; i--) if (ws[i]! > 0) return i;
  return -1;
}

function shuffle(rng: () => number): number[] {
  const p = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  return p;
}
const relabel = (c: string, perm: readonly number[]) => c[0]! + SUITS[perm[SUITS.indexOf(c[1]!)]!]!;

/** pot at the node and the bet faced (bb): the bet sizes are fractions of the pot ("bet 33%") */
export function potAt(rep: Pick<LibraryReport, "pot">, path: readonly string[]): { pot: number; bet: number } {
  const b = path.find((x) => /^bet /.test(x));
  const bet = b ? Math.round((parseFloat(b.slice(4)) / 100) * rep.pot * 100) / 100 : 0;
  return { pot: Math.round((rep.pot + bet) * 100) / 100, bet };
}

export interface DrillProblem {
  spot: string;
  /** the canonical flop, as stored */
  flop: string;
  path: string[];
  player: 0 | 1;
  hero: string;
  /** the flop and your hand, as shown (one suit relabelling of the stored ones) */
  board: string[];
  hand: string[];
  combo: readonly [number, number];
  names: string[];
  freqs: number[];
  evs: number[];
  pot: number;
  bet: number;
}

/** one problem: a hand dealt at a drawn (flop, node); null if the entry has no hand there */
export function problem(rep: LibraryReport, e: Entry, cand: Candidate, ranges: LibraryRanges, rng: () => number): DrillProblem | null {
  const nd = nodeAt(e, cand.path);
  const w = handWeights(e, cand.path, ranges);
  if (!nd || !w) return null;
  const j = pick(w, rng);
  if (j < 0) return null;
  const perm = shuffle(rng);
  const combo = COMBOS[e.combos[nd.player][j]!]!;
  const [a, b] = combo;
  const { pot, bet } = potAt(rep, cand.path);
  return {
    spot: rep.id,
    flop: cand.f,
    path: cand.path,
    player: nd.player,
    hero: rep.seats[nd.player],
    board: flopCards(cand.f).map((c) => relabel(c, perm)),
    hand: [cardStr(b), cardStr(a)].map((c) => relabel(c, perm)),
    combo,
    names: nd.names,
    freqs: nd.strat.map((r) => r[j]!),
    evs: nd.evs.map((r) => r[j]!),
    pot,
    bet,
  };
}

/** your pick graded against the stored mix and EVs for your hand */
export const gradeDrill = (pr: DrillProblem, a: number): Grade => grade({ freqs: pr.freqs, evs: pr.evs, pot: pr.pot }, a);

const fmt = (x: number) => String(Math.round(x * 100) / 100);

/** "bet 33% (1.82bb)", "call 1.82bb": the stored name with the chips it puts in */
export function drillActionLabel(pr: Pick<DrillProblem, "pot" | "bet">, name: string): string {
  if (/^bet /.test(name)) return `${name} (${fmt((parseFloat(name.slice(4)) / 100) * pr.pot)}bb)`;
  if (name === "call") return `call ${fmt(pr.bet)}bb`;
  return name;
}

/** the action to the node, e.g. "BB checks, BTN bets 33% (1.82bb) · pot 7.32bb" */
export function situation(rep: Pick<LibraryReport, "seats">, pr: Pick<DrillProblem, "path" | "pot" | "bet">): string {
  const [o, p] = rep.seats;
  const b = pr.path.find((x) => /^bet /.test(x));
  const line =
    pr.path.length === 0
      ? `${o} to act first`
      : b && pr.path[0] === b
        ? `${o} bets ${b.slice(4)} (${fmt(pr.bet)}bb)`
        : b
          ? `${o} checks, ${p} bets ${b.slice(4)} (${fmt(pr.bet)}bb)`
          : `${o} checks`;
  return `${line} · pot ${fmt(pr.pot)}bb`;
}

/** the same node in Study: the preflop line, the shown flop and the flop action to the node */
export function studyHandOf(rep: LibraryReport, pr: DrillProblem): StudyHand {
  const [oop, ip] = rep.seats;
  const flop = pr.path.map((x, i) =>
    x === "check" ? { pos: i ? ip : oop, action: "check" } : { pos: i ? ip : oop, action: "bet", to: potAt(rep, [x]).bet },
  );
  return {
    players: rep.game?.players ?? 6,
    stack: rep.game?.stack ?? 100,
    board: pr.board.join(""),
    preflop: parseLine(rep.line),
    flop,
    turn: [],
    river: [],
  };
}
/** the Study URL for the node (a spot's ante or straddle as Study's setup); null for a game Study can't set up (an ante
 * over 1bb) */
export function studyLink(rep: LibraryReport, pr: DrillProblem): string | null {
  const setup = gameSetup(rep.game?.players ?? 6, rep.game?.ante, rep.game?.straddle);
  if (setup === null) return null;
  return `/study?${toSearch({ ...studyHandOf(rep, pr), ...(setup ? { setup } : {}) })}`;
}

/** the answer's provenance: the stored solve, read in the page from the library file */
export function drillProvenance(e: Entry, mode: SolveMode): Provenance {
  return {
    source: "library",
    approximate: false,
    exploitabilityPct: e.head.expl,
    band: bandOf(e.head.expl, false),
    iterations: e.head.iters,
    librarySpot: e.head.spot,
    mode,
    transport: "file",
    solverVersion: `library tree ${e.head.tree}`,
    partial: false,
    receivedAt: Date.now(),
  };
}
