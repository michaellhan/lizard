// The turn report: the stored turn's first decisions across many flops of a texture, by what the turn card does to the
// board, read from the library with no solve. A spot can store 1,755 turn files and each needs its entry beside it (a
// turn file holds strategies, not how much of each combo reaches the line), so the page reads a sample and says so: the
// flops of the texture are sorted so that alike ones sit together, and a van der Corput walk over that order draws
// them, each flop equally likely. Any stretch from the start of the walk is spread evenly, so a report stopped part way
// or read further is still a fair sample, and reading every flop gives the whole. The seed turns the walk.
//
// What's averaged. On a flop, on a stored flop line, on a turn class k, the acting range's mix is each stored combo's
// strategy by its reach (lineReach: the range entering the flop, times its own flop actions on the line), as Study's
// stored runouts have it (solver/gto/runouts.py store_parts). Each stands for w, the flop's share of the 22100; times
// line.share, the hand pairs on the line; times sizes[k], the cards the class stands for (as drills.ts and liveDeal.ts
// deal them), and for in position's decision after a check, times how often out of position checks there. The margin
// treats the flops read as a simple random sample of the flops of the texture with stored turns, which measures wider
// than a spread sample really is (docs/ACCURACY.md section 17).
import { cardClass, CLASSES, type CardClass } from "@/features/study/runouts";
import { lineReach, turnCandidates, type TextureFilter } from "@/features/practice/drills";
import { fitsTexture, texture } from "@/features/practice/texture";
import type { LibrarySpotIndex } from "@/library/catalog";
import type { Entry, LibraryRanges } from "@/library/entry";
import type { LibraryFiles, LibraryReport } from "@/library/files";
import type { TurnFile, TurnNode } from "@/library/turns";
import type { Provenance, SolveMode } from "@/solver/types";

/** flops read at a time, and added by each "read more": see docs/ACCURACY.md section 17 for what that buys */
export const TURN_SAMPLE = 40;
/** the flops' two files fetched this many flops at a time: eight requests, as a 3-way report reads */
export const TURN_READ_AT_ONCE = 4;
/** below this many flops behind a row its margin isn't worked out: too few to measure a spread */
export const MIN_FLOPS_FOR_MARGIN = 8;
/** a flop's entry and turn file together, KB: the spot with the largest files' average (docs/ACCURACY.md section 17) */
export const FLOP_KB = 31;

export type TurnWho = "first" | "after";
export const TURN_WHO: readonly TurnWho[] = ["first", "after"];

/** what one flop's line holds for a card class at one decision, summed over the class's turn classes */
export interface ClassSum {
  /** the cards it stands for, times (after a check) how often out of position checks there */
  weight: number;
  /** by action: weight times the range's frequency of it */
  took: Record<string, number>;
  /** weight times the combos of the acting range at the decision */
  combos: number;
}
type NodeSum = Partial<Record<CardClass, ClassSum>>;

export interface FlopLineSum {
  path: string[];
  /** its share of the hand pairs entering the flop */
  share: number;
  first: NodeSum | null;
  after: NodeSum | null;
}

/** what the report keeps of a flop once its files are read: every line and both decisions, so choosing between them
 * reads nothing more */
export interface FlopTurns {
  f: string;
  /** how many of the 22100 flops it stands for */
  w: number;
  lines: FlopLineSum[];
  /** stored turn lines whose reach the entry can't give (a decision on the way isn't stored), left out */
  unread: string[][];
}

const pathKey = (p: readonly string[]) => p.join("|");

/** the mix of a stored turn class by reach, and the combos that reach it; null where none do */
function mixOf(node: TurnNode, k: number, reach: ReadonlyMap<number, number>): { mix: number[]; combos: number } | null {
  const cls = node.classes[k];
  if (!cls) return null;
  const mix = node.names.map(() => 0);
  let combos = 0;
  cls.combos.forEach((ci, j) => {
    const r = reach.get(ci) ?? 0;
    combos += r;
    cls.strat.forEach((row, a) => (mix[a] = mix[a]! + r * row[j]!));
  });
  return combos > 0 ? { mix: mix.map((x) => x / combos), combos } : null;
}

function addTo(sum: NodeSum, cls: CardClass, names: readonly string[], weight: number, m: { mix: number[]; combos: number }) {
  const c = (sum[cls] ??= { weight: 0, took: {}, combos: 0 });
  c.weight += weight;
  c.combos += weight * m.combos;
  names.forEach((n, a) => (c.took[n] = (c.took[n] ?? 0) + weight * m.mix[a]!));
}

/** A flop's two files as what the report keeps of them. A flop line needs both players' reach (in position's decision
 * weighs by how often out of position checks), so one the entry can't give either of is left out and named. */
export function summarize(f: string, w: number, e: Entry, t: TurnFile, ranges: LibraryRanges): FlopTurns {
  const lines: FlopLineSum[] = [];
  const unread: string[][] = [];
  // (a class's cards all do the same to the board: a rank's cards alike, a flush suit's apart. Checked over every file.)
  const classOf = t.head.classes.map(([card]) => cardClass(f, card));
  for (const line of t.lines) {
    const firstNode = line.nodes.find((n) => n.at.length === 0);
    const afterNode = line.nodes.find((n) => n.at.join() === "check");
    const oop = lineReach(e, line.path, 0, ranges);
    const ip = lineReach(e, line.path, 1, ranges);
    if (!oop || !ip) {
      unread.push(line.path);
      continue;
    }
    const first: NodeSum = {};
    const after: NodeSum = {};
    t.played.forEach((_, k) => {
      const cls = classOf[k]!;
      const size = t.sizes[k]!;
      const a = firstNode && mixOf(firstNode, k, oop);
      if (a && firstNode) addTo(first, cls, firstNode.names, size, a);
      const b = afterNode && mixOf(afterNode, k, ip);
      const checks = a && firstNode ? (a.mix[firstNode.names.indexOf("check")] ?? 0) : 0;
      if (b && afterNode && checks > 0) addTo(after, cls, afterNode.names, size * checks, b);
    });
    lines.push({ path: line.path, share: line.share, first: firstNode ? first : null, after: afterNode ? after : null });
  }
  return { f, w, lines, unread };
}

// ---- which flops
const FLOP_ORDER: readonly ((f: string) => string)[] = [(f) => texture(f).suits, (f) => texture(f).pair, (f) => texture(f).hi, (f) => texture(f).conn];

/** the flops of the texture with stored turns, alike ones together; those with no weight aren't counted */
export function eligibleFlops(rep: Pick<LibraryReport, "flops">, stored: readonly string[], filter: TextureFilter): { f: string; w: number }[] {
  const key = (f: string) => [...FLOP_ORDER.map((k) => k(f)), f].join(" ");
  return turnCandidates(rep as LibraryReport, stored, filter)
    .map(({ f, w }) => ({ f, w, k: key(f) }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .map(({ f, w }) => ({ f, w }));
}

/** How much of the texture has stored turns: the flops, and the share of the weight they stand for. */
export function textureCover(rep: Pick<LibraryReport, "flops">, eligible: readonly { w: number }[], filter: TextureFilter): { flops: number; share: number } {
  const all = rep.flops.filter((fl) => fl.w > 0 && fitsTexture(texture(fl.f), filter));
  const w = all.reduce((a, fl) => a + fl.w, 0);
  return { flops: all.length, share: w ? eligible.reduce((a, x) => a + x.w, 0) / w : 0 };
}

/** a number in [0, 1) from the seed (mulberry32's first draw) */
function start(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** i's bits turned around in `bits` bits, as a fraction: 0, 1/2, 1/4, 3/4, 1/8... */
function vanDerCorput(i: number, bits: number): number {
  let out = 0;
  for (let b = 0; b < bits; b++) if (i & (1 << b)) out += 1 / 2 ** (b + 1);
  return out;
}

/** every flop once, in the order to read them: each is equally likely to be read first, and any stretch from the start
 * lies evenly over the list. The seed says where the walk starts, so a seed gives the same order every time. */
export function readingOrder<T>(flops: readonly T[], seed: number): T[] {
  const N = flops.length;
  if (N < 2) return [...flops];
  const bits = Math.ceil(Math.log2(N));
  const u = start(seed);
  const seen = new Set<number>();
  const out: T[] = [];
  // (2^bits points at least 1/N apart at most, so each of the N places is hit)
  for (let i = 0; i < 2 ** bits; i++) {
    const place = Math.floor(((vanDerCorput(i, bits) + u) % 1) * N);
    if (seen.has(place)) continue;
    seen.add(place);
    out.push(flops[place]!);
  }
  return out;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Read flops' two files, TURN_READ_AT_ONCE flops at a time, each told as it comes. A flop that fails is told too and the
 * rest go on; a stop cancels what's in flight and starts nothing more. */
export async function readFlops(
  files: Pick<LibraryFiles, "spot" | "entry" | "turns">,
  sp: LibrarySpotIndex,
  flops: readonly { f: string; w: number }[],
  opts: { signal?: AbortSignal; onFlop: (r: FlopTurns) => void; onFail: (f: string, why: string) => void },
): Promise<void> {
  const { ranges } = await files.spot(sp);
  const { signal } = opts;
  let next = 0;
  const work = async () => {
    while (next < flops.length && !signal?.aborted) {
      const { f, w } = flops[next++]!;
      try {
        const [e, t] = await Promise.all([files.entry(sp, f, signal), files.turns(sp, f, signal)]);
        if (signal?.aborted) return;
        opts.onFlop(summarize(f, w, e, t, ranges));
      } catch (err) {
        if (!signal?.aborted) opts.onFail(f, message(err));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(TURN_READ_AT_ONCE, flops.length) }, work));
}

// ---- the table
/** a flop line the flops read hold, with its weight: how much of the hand pairs entering the flop take it */
export interface LineChoice {
  key: string;
  path: string[];
  /** over the flops read, each by its weight; a flop that doesn't store the line counts as none */
  share: number;
  /** flops read that store it and can read it */
  flops: number;
  /** flops read that store it where the entry can't give the reach */
  unread: number;
}

export function lineChoices(flops: readonly FlopTurns[]): LineChoice[] {
  const by = new Map<string, LineChoice>();
  const all = flops.reduce((a, f) => a + f.w, 0);
  const at = (path: string[]) => {
    const key = pathKey(path);
    let c = by.get(key);
    if (!c) by.set(key, (c = { key, path, share: 0, flops: 0, unread: 0 }));
    return c;
  };
  for (const fl of flops) {
    for (const ln of fl.lines) {
      const c = at(ln.path);
      c.share += (fl.w * ln.share) / (all || 1);
      c.flops++;
    }
    for (const p of fl.unread) at(p).unread++;
  }
  return [...by.values()].filter((c) => c.flops > 0).sort((a, b) => b.share - a.share || a.key.localeCompare(b.key));
}

export interface TurnRow {
  cls: CardClass | "all";
  label: string;
  /** by the report's columns, each averaged by what it stands for */
  mix: number[];
  /** the share of the line's turns (after a check: of those it checks to) this class is */
  turns: number;
  /** flops read with this class on the line */
  flops: number;
  /** the acting range at the decision, in combos, averaged as the mix is */
  combos: number;
  /** half the 95% interval, at most over the actions; 0 where every flop is read; null: too few flops to say */
  margin: number | null;
}

export interface TurnTable {
  /** the action columns */
  cols: string[];
  rows: TurnRow[];
}

/** t(0.975, df), near enough (Cornish-Fisher): 2.228 at 10, 2.023 at 39, 1.984 at 100 */
export const t95 = (df: number) => 1.96 + 2.37 / df + 3.0 / df ** 2;

/** The half-width of a 95% interval on a ratio of sums, by its linearization, for `n` flops read of `N`: x[i], y[i] the
 * denominator's and the numerator's parts on flop i (zero where the flop has none of it). */
export function ratioMargin(x: readonly number[], y: readonly number[], N: number): number {
  const n = x.length;
  if (n < 2 || n >= N) return 0;
  const sx = x.reduce((a, v) => a + v, 0);
  if (sx <= 0) return 0;
  const R = y.reduce((a, v) => a + v, 0) / sx;
  const ss = x.reduce((a, v, i) => a + (y[i]! - R * v) ** 2, 0);
  // (the spread is known from as many flops as carry the weight, the few big ones where they're unequal: Kish's count)
  const carrying = sx ** 2 / x.reduce((a, v) => a + v * v, 0);
  return (t95(Math.max(carrying - 1, 1)) * Math.sqrt(((1 - n / N) * ss) / (n - 1) / n)) / (sx / n);
}

const ORDER = Object.keys(CLASSES) as CardClass[];

/** the table of a line and a decision, over the flops read of the `of` the texture's sample is drawn from */
export function turnTable(flops: readonly FlopTurns[], path: readonly string[], who: TurnWho, of: number): TurnTable {
  const key = pathKey(path);
  const sums = flops.map((fl) => {
    const ln = fl.lines.find((l) => pathKey(l.path) === key);
    return { scale: ln ? fl.w * ln.share : 0, node: (ln && ln[who]) ?? null };
  });
  const cols: string[] = [];
  for (const s of sums) for (const c of Object.values(s.node ?? {})) for (const n of Object.keys(c.took)) if (!cols.includes(n)) cols.push(n);
  // (check first, the rest as the files name them: "check", "bet 75%", "all-in")
  cols.sort((a, b) => Number(b === "check") - Number(a === "check"));

  const weigh = (part: (n: NodeSum) => ClassSum[]) => {
    const on = sums.map((s) => ({ scale: s.scale, cells: s.node ? part(s.node) : [] }));
    const sum = (of: (c: ClassSum) => number) => on.map((s) => s.cells.reduce((a, c) => a + s.scale * of(c), 0));
    return { x: sum((c) => c.weight), combos: sum((c) => c.combos), ys: cols.map((n) => sum((c) => c.took[n] ?? 0)) };
  };
  const total = (xs: readonly number[]) => xs.reduce((a, v) => a + v, 0);
  const line = total(weigh((n) => Object.values(n)).x);

  const row = (cls: CardClass | "all", label: string, part: (n: NodeSum) => ClassSum[]): TurnRow | null => {
    const { x, combos, ys } = weigh(part);
    const tot = total(x);
    if (tot <= 0) return null;
    const behind = x.filter((v) => v > 0).length;
    return {
      cls,
      label,
      mix: ys.map((y) => total(y) / tot),
      turns: tot / line,
      flops: behind,
      combos: total(combos) / tot,
      margin: flops.length >= of ? 0 : behind < MIN_FLOPS_FOR_MARGIN ? null : Math.max(...ys.map((y) => ratioMargin(x, y, of))),
    };
  };

  const all = row("all", "All turns", (n) => Object.values(n));
  return { cols, rows: all ? [all, ...ORDER.flatMap((c) => row(c, CLASSES[c], (n) => (n[c] ? [n[c]] : [])) ?? [])] : [] };
}

/** who decides: in full, and as a button has room for at phone width */
export const whoText = (who: TurnWho, seats: readonly string[]) => (who === "first" ? `${seats[0]} first on the turn` : `${seats[1]} after ${seats[0]} checks the turn`);
export const whoShort = (who: TurnWho, seats: readonly string[]) => (who === "first" ? `${seats[0]} first` : `${seats[1]} vs check`);

export interface SampleState {
  /** flops read */
  read: number;
  /** the flops of the texture with stored turns */
  of: number;
  seed: number;
  /** files that failed: their flops are left out */
  failed: number;
  /** stopped, or still reading */
  partial: boolean;
  stopped: boolean;
}

/** what the numbers are: the library's stored turns, averaged here over the flops read */
export function turnProvenance(spot: string, s: SampleState, mode: SolveMode, version?: string): Provenance {
  return {
    source: "library-turn",
    // (stored turns are always approximate: the flop solve's turn, one bet size, in 5% steps; and this reads a sample)
    approximate: true,
    librarySpot: spot,
    approximateLabel: `turn report over ${s.read} of ${s.of} flops with stored turns, seed ${s.seed}, built in the page from their files`,
    mode,
    transport: "file",
    solverVersion: `library turn report${version ? ` ${version}` : ""}`,
    partial: s.partial,
    ...(s.stopped ? { stopped: true } : {}),
    receivedAt: Date.now(),
  };
}

/** The sample in words: how many, of how many, how picked, and the margin. */
export function sampleText(s: SampleState, topMargin: number | null): string {
  const all = s.read >= s.of;
  const how = all
    ? `Read all ${s.of} flops of this texture with stored turns, so there's no sampling margin.`
    : `Read ${s.read} of ${s.of} flops of this texture with stored turns, drawn evenly over them in an order set by seed ${s.seed}, each flop counted by how many of the 22,100 it stands for.`;
  const margin = all ? "" : topMargin == null ? " Too few flops to put a margin on it yet." : ` Margin on All turns: ±${(topMargin * 100).toFixed(1)} points, 95%.`;
  const bad = s.failed ? ` ${s.failed} ${s.failed === 1 ? "flop" : "flops"} couldn't be read and ${s.failed === 1 ? "is" : "are"} left out.` : "";
  const partial = s.partial ? (s.stopped ? " Stopped early: these are partial results." : " Still reading: these are partial results.") : "";
  return `${how}${margin}${bad}${partial}`;
}
