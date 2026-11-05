// Drills: one precomputed spot's decision dealt hand after hand, answered at once from the flop library with no
// solver (classic drills.js). A flop is drawn by weight (each stands for its share of the 22100) among the spot's
// flops that store the node and pass the texture filter. A hand is drawn from the acting player's range there: its
// weight entering the flop, off the board, times its own frequency of the line so far, shown in a random suit
// relabelling. The stored mix and EVs for that hand grade the pick, on the one scale (src/grading/grade.ts).
//
// A turn drill reads the flop's stored turn file (src/library/turns.ts): a flop line by how many hand pairs take it, a
// class's played card by how many cards the class stands for, a hand as above and through the flop line. Only the
// played card is dealt: it's the one the flop solve played, and another card of its class is read off it by the engine,
// flush draws and all. The file holds a mix for each hand but an EV only for the class, so a turn is graded by that mix
// (grade.ts's frequency branch, which says so and counts no EV lost), under the stored turn's provenance, not the
// flop solve's distance from equilibrium, which doesn't describe it. No file stores a river or a turn facing a bet.
import { gameSetup } from "@/features/solve/setup";
import { parseLine, toSearch, type StudyHand } from "@/features/study/studyState";
import { grade, type Grade } from "@/grading/grade";
import { bandOf } from "@/solver/provenance";
import type { Provenance, SolveMode } from "@/solver/types";
import { COMBOS, cardInt, cardStr, flopCards, handWeights, nodeAt, SUITS, type Entry, type LibraryRanges } from "@/library/entry";
import type { LibraryReport } from "@/library/files";
import type { TurnFile, TurnLine, TurnNode } from "@/library/turns";
import { flopHandTest, handTest } from "./handFilter";
import { fitsTexture, texture, type TextureFilter } from "./texture";

export { TEXTURE_GROUPS, texture, type Texture, type TextureFilter, type TextureKey } from "./texture";

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

/** The streets a drill can deal. A river isn't stored in any file. */
export type DrillStreet = "flop" | "turn";
/** the two turn decisions a turn file stores */
export const TURN_VIEWS: readonly DrillView[] = ["oop", "ip"];
export const turnViewLabel = (view: DrillView, seats: readonly string[]): string => (view === "ip" ? `${seats[1]} after ${seats[0]} checks the turn` : `${seats[0]} first to act on the turn`);
/** the seat that acts at a view's node: 0 out of position, 1 in position */
export const heroOf = (view: DrillView): 0 | 1 => (view === "ip" || view === "ipvsbet" ? 1 : 0);

export interface Candidate {
  f: string;
  path: string[];
  w: number;
}

/** the (flop, node) pairs a drill draws from, with their weights */
export function candidates(rep: LibraryReport, view: DrillView, filter: TextureFilter = {}): Candidate[] {
  const out: Candidate[] = [];
  for (const fl of rep.flops) {
    if (!fitsTexture(texture(fl.f), filter)) continue;
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

/** the flops a turn drill draws from: those storing a turn file (`stored`), by the texture filter */
export function turnCandidates(rep: LibraryReport, stored: readonly string[], filter: TextureFilter = {}): Candidate[] {
  const has = new Set(stored);
  return rep.flops.filter((fl) => has.has(fl.f) && fl.w > 0 && fitsTexture(texture(fl.f), filter)).map((fl) => ({ f: fl.f, path: [], w: fl.w }));
}

/** The draws whose flop can hold a hand of the filter: one combo of the player's range entering the flop is in it, off
 * the board. The hand may still not reach the node. */
export function holding(cands: readonly Candidate[], ranges: LibraryRanges, player: 0 | 1, hand: string): Candidate[] {
  const combos = COMBOS.filter((_, i) => ranges.w[player][i]! > 0);
  const memo = new Map<string, boolean>();
  const holds = (f: string) => {
    const test = flopHandTest(hand, f);
    const board = new Set(flopCards(f).map(cardInt));
    return combos.some(([a, b]) => !board.has(a) && !board.has(b) && test(a, b));
  };
  return cands.filter((c) => {
    if (!memo.has(c.f)) memo.set(c.f, holds(c.f));
    return memo.get(c.f);
  });
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
  /** the board and your hand, as shown (one suit relabelling of the stored ones): `perm[s]` is the suit shown for the
   * stored suit s. The flop's three cards, and on a turn drill the turn. */
  board: string[];
  hand: string[];
  /** your hand as stored, on the canonical flop */
  combo: readonly [number, number];
  perm: readonly number[];
  names: string[];
  freqs: number[];
  /** your hand's own EVs in bb; null on a turn, where none is stored: graded by `freqs` alone */
  evs: number[] | null;
  pot: number;
  bet: number;
  /** a turn drill's: the stored turn card, the turn actions to the node, and each action's EV over the range's hands
   * that take it (a format-2 file's, the class's: shown, never graded on) */
  turn?: { card: string; at: string[]; rangeEvs: (number | null)[] | null };
}

/** one problem: a hand dealt at a drawn (flop, node), of the filter `hand` if there's one; null if the entry has no
 * such hand there */
export function problem(rep: LibraryReport, e: Entry, cand: Candidate, ranges: LibraryRanges, rng: () => number, hand: string | null = null): DrillProblem | null {
  const nd = nodeAt(e, cand.path);
  const all = handWeights(e, cand.path, ranges);
  if (!nd || !all) return null;
  const test = hand ? flopHandTest(hand, cand.f) : null;
  const w = test ? all.map((x, j) => (x > 0 && test(...COMBOS[e.combos[nd.player][j]!]!) ? x : 0)) : all;
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
    perm,
    names: nd.names,
    freqs: nd.strat.map((r) => r[j]!),
    evs: nd.evs.map((r) => r[j]!),
    pot,
    bet,
  };
}

/** Each combo's reach entering the turn for the player: its weight entering the flop, times its own frequency of each
 * of its actions on the flop line. Null where the entry doesn't store one of those decisions, as a line through a raise
 * may not: such a line isn't dealt, as its hands couldn't be weighed. */
export function lineReach(e: Entry, path: readonly string[], player: 0 | 1, ranges: LibraryRanges): Map<number, number> | null {
  const reach = e.combos[player].map((ci) => ranges.w[player][ci]! / 10000);
  for (let i = player; i < path.length; i += 2) {
    const nd = nodeAt(e, path.slice(0, i));
    const a = nd ? nd.names.indexOf(path[i]!) : -1;
    if (!nd || nd.player !== player || a < 0) return null;
    reach.forEach((x, j) => (reach[j] = x * nd.strat[a]![j]!));
  }
  return new Map(e.combos[player].map((ci, j) => [ci, reach[j]!]));
}

interface TurnSpot {
  line: TurnLine;
  node: TurnNode;
  /** the class */
  k: number;
  /** its draw's weight: the hand pairs on the line, the cards the class stands for */
  w: number;
}

/** every (flop line, turn card) a file stores for a view's decision */
function turnSpots(t: TurnFile, view: DrillView): TurnSpot[] {
  const at = view === "ip" ? "check" : "";
  return t.lines.flatMap((line) => {
    const node = line.nodes.find((n) => n.at.join("|") === at && n.player === heroOf(view));
    return node ? t.played.map((_, k) => ({ line, node, k, w: line.share * t.sizes[k]! })) : [];
  });
}

/** a stored class's combos with their weights: reach, on the line, off the flop (the file leaves out the turn card) */
function turnHands(s: TurnSpot, reach: Map<number, number>): number[] {
  return s.node.classes[s.k]!.combos.map((ci) => reach.get(ci) ?? 0);
}

/** One problem on a stored turn: the entry and its turn file (read together), a stored line and played card drawn, then
 * a hand of the filter `hand` if there's one. Null if neither holds such a hand at the view's decision. */
export function turnProblem(rep: LibraryReport, e: Entry, t: TurnFile, view: DrillView, ranges: LibraryRanges, rng: () => number, hand: string | null = null): DrillProblem | null {
  const flop = flopCards(t.head.board).map(cardInt);
  const spots = turnSpots(t, view);
  const ws = spots.map((s) => s.w);
  const reaches = new Map<TurnLine, Map<number, number> | null>();
  for (;;) {
    const i = pick(ws, rng);
    if (i < 0) return null;
    const s = spots[i]!;
    if (!reaches.has(s.line)) reaches.set(s.line, lineReach(e, s.line.path, s.node.player, ranges));
    const reach = reaches.get(s.line);
    const card = t.played[s.k]!;
    const cls = s.node.classes[s.k]!;
    const all = reach ? turnHands(s, reach) : [];
    const test = hand ? handTest(hand, [...flop, card]) : null;
    const w = test ? all.map((x, j) => (x > 0 && test(...COMBOS[cls.combos[j]!]!) ? x : 0)) : all;
    const j = pick(w, rng);
    if (j < 0) {
      ws[i] = 0;
      continue;
    }
    const perm = shuffle(rng);
    const combo = COMBOS[cls.combos[j]!]!;
    const [a, b] = combo;
    return {
      spot: rep.id,
      flop: t.head.board,
      path: s.line.path,
      player: s.node.player,
      hero: rep.seats[s.node.player],
      board: [...flop, card].map((c) => relabel(cardStr(c), perm)),
      hand: [cardStr(b), cardStr(a)].map((c) => relabel(c, perm)),
      combo,
      perm,
      names: s.node.names,
      freqs: cls.strat.map((r) => r[j]!),
      evs: null,
      pot: s.line.pot,
      bet: 0,
      turn: { card: cardStr(card), at: s.node.at, rangeEvs: s.node.evs?.[s.k] ?? null },
    };
  }
}

/** What a filter leaves on the files read: the deals (a hand at a stored spot) with any weight, and those in the filter. */
export interface DealCount {
  deals: number;
  match: number;
}

const tally = (c: DealCount, w: readonly number[], combo: (j: number) => readonly [number, number], test: (a: number, b: number) => boolean) => {
  w.forEach((x, j) => {
    if (x <= 0) return;
    c.deals++;
    const [a, b] = combo(j);
    if (test(a, b)) c.match++;
  });
};

/** the count on one flop's stored nodes (its draws' paths) */
export function flopDeals(e: Entry, paths: readonly (readonly string[])[], ranges: LibraryRanges, hand: string): DealCount {
  const c = { deals: 0, match: 0 };
  const test = flopHandTest(hand, e.head.board);
  for (const path of paths) {
    const nd = nodeAt(e, path);
    const w = handWeights(e, path, ranges);
    if (nd && w) tally(c, w, (j) => COMBOS[e.combos[nd.player][j]!]!, test);
  }
  return c;
}

/** the count on every line and played card of one flop's turn file */
export function turnDeals(e: Entry, t: TurnFile, view: DrillView, ranges: LibraryRanges, hand: string): DealCount {
  const c = { deals: 0, match: 0 };
  const flop = flopCards(t.head.board).map(cardInt);
  for (const s of turnSpots(t, view)) {
    const reach = lineReach(e, s.line.path, s.node.player, ranges);
    if (!reach) continue;
    const cls = s.node.classes[s.k]!;
    tally(c, turnHands(s, reach), (j) => COMBOS[cls.combos[j]!]!, handTest(hand, [...flop, t.played[s.k]!]));
  }
  return c;
}

/** up to `n` of the draws' flops, evenly through them: a count's sample, the same each time, drawing nothing from a
 * deal's randomness */
export function sampleFlops(cands: readonly Candidate[], n: number): string[] {
  const flops = [...new Set(cands.map((c) => c.f))];
  if (flops.length <= n) return flops;
  return Array.from({ length: n }, (_, i) => flops[Math.floor((i * flops.length) / n)]!);
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

/** a flop line in words: "BB checks, BTN bets 75%, BB calls" */
function flopWords(rep: Pick<LibraryReport, "seats">, path: readonly string[]): string {
  const [o, p] = rep.seats;
  if (path.join("|") === "check|check") return `${o} and ${p} check`;
  return path
    .map((x, i) => {
      const who = rep.seats[i % 2];
      return x === "check" ? `${who} checks` : x === "call" ? `${who} calls` : /^bet /.test(x) ? `${who} bets ${x.slice(4)}` : /^raise /.test(x) ? `${who} raises ${x.slice(6)}` : `${who}: ${x}`;
    })
    .join(", ");
}

/** the action to the node, e.g. "BB checks, BTN bets 33% (1.82bb) · pot 7.32bb"; on a turn, the flop's line and the
 * turn's: "On the flop BB and BTN check. BB to act first on the turn · pot 5.5bb" */
export function situation(rep: Pick<LibraryReport, "seats">, pr: Pick<DrillProblem, "path" | "pot" | "bet" | "turn">): string {
  const [o, p] = rep.seats;
  if (pr.turn) return `On the flop ${flopWords(rep, pr.path)}. ${pr.turn.at.length ? `${o} checks the turn` : `${o} to act first on the turn`} · pot ${fmt(pr.pot)}bb`;
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

/** the same node in Study: the preflop line, the shown board and the action to the node */
export function studyHandOf(rep: LibraryReport, pr: DrillProblem): StudyHand {
  const [oop, ip] = rep.seats;
  const flop = pr.path.map((x, i) => {
    const pos = i % 2 ? ip : oop;
    if (x === "check" || x === "call") return { pos, action: x };
    return /^raise to /.test(x) ? { pos, action: "raise", to: parseFloat(x.slice(9)) } : { pos, action: "bet", to: potAt(rep, [x]).bet };
  });
  return {
    players: rep.game?.players ?? 6,
    stack: rep.game?.stack ?? 100,
    board: pr.board.join(""),
    preflop: parseLine(rep.line),
    flop,
    turn: (pr.turn?.at ?? []).map((action) => ({ pos: oop, action })),
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

/** The answer's provenance: the stored solve, read in the page from the library file. A turn's is the stored turn's:
 * approximate, with none of the flop solve's numbers, as Study's badge for the same file (provenance.ts). */
export function drillProvenance(e: Entry, mode: SolveMode, pr?: Pick<DrillProblem, "turn" | "names">, libraryVersion?: string): Provenance {
  const stamped = libraryVersion ? { libraryVersion } : {};
  if (pr?.turn) {
    const bets = pr.names.filter((n) => /^bet /.test(n));
    return {
      source: "library-turn",
      approximate: true,
      approximateLabel: `the precomputed flop solve's view of this turn, in 5% steps (${bets.length === 1 ? `one bet size, ${bets[0]!.slice(4)}` : "its turn sizes"})`,
      librarySpot: e.head.spot,
      ...stamped,
      mode,
      transport: "file",
      solverVersion: `library tree ${e.head.tree}`,
      partial: false,
      receivedAt: Date.now(),
    };
  }
  return {
    source: "library",
    approximate: false,
    exploitabilityPct: e.head.expl,
    band: bandOf(e.head.expl, false),
    iterations: e.head.iters,
    librarySpot: e.head.spot,
    ...stamped,
    mode,
    transport: "file",
    solverVersion: `library tree ${e.head.tree}`,
    partial: false,
    receivedAt: Date.now(),
  };
}
