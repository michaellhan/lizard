// How your decisions moved across sessions (sessions.ts), one kind of game and one basis at a time: a basis's share of
// decisions in the mix by blocks of decisions, and your latest third of them against the two thirds before. Each
// decision counts as it was first answered, so a check at Fast moves nothing; a clear fold (the answer's, and yours)
// is left out of the share, or the hands anyone would fold would hold it near the top. EV lost, bb/100 and a point per
// session are left out on purpose: sessions differ a hundredfold in size, one pot would own the line, and most of a
// session's results are the cards. Which rows are compared is decided by sample size alone: choosing them by value
// would manufacture improvement from chance.
import type { DecisionRecord, HandRecord } from "@/data/db";
import { countVersions, versionSpan, type VersionSpan } from "@/grading/version";
import { basisOf, freqs, FREQS, groupBy, isGraded, isOk, LEAK, leaks, leakTest, PF_ORDER, type FreqRow, type Group, spotOf } from "./report";
import { byPlayed, type Sitting } from "./sessions";
import { wilson } from "./stats";

/** A fold the answer takes this often is a clear fold. */
export const CLEAR_FOLD = 0.97;
/** A block of the line, at least: under this a share is mostly noise. */
export const BLOCK = 100;
/** Fewer blocks than this make no line. */
export const MIN_BLOCKS = 3;
/** The shortest side of the latest-third verdict, and of a compared row. */
export const MIN_SIDE = 100;
export const MIN_ROW = 30;
/** |z| from which a change is called (two-sided 1%: there are many rows). */
export const BAR = 2.58;
/** How far off the answer a side of a crossing has to be: half a leak, as a row's percents round to a point. */
const CROSS = LEAK.freq[0] / 2;
/** A session's share under this many decisions is written as a count. */
export const MIN_SHARE = 30;

export type Change = "Better" | "Worse";
/** A frequency clear on the other side of the answer: where you stand against it, not who moved (`crossZ`). */
export type RowChange = Change | "Now over the answer" | "Now under the answer";

/** The decision as it was first answered: a read a check at Fast replaced, under the read's own basis, with the read's
 * own mix and version. (`approximate` isn't kept with a read, and is the check's here; a library read's basis is in its
 * label. A read checked before its mix or version was kept has none, never the check's: it stays out of the frequencies,
 * says so, and its version is unknown.) */
export function firstAnswer(d: DecisionRecord): DecisionRecord {
  return d.read ? { ...d, ...d.read, mix: d.read.mix, version: d.read.version, approximate: false } : d;
}

/** A fold the answer takes almost always. (By the answer's own frequency for your action: a read keeps it, and not its
 * mix.) An overfold stays, as does a hand played that it folds. */
export const agreedFold = (d: DecisionRecord) => d.action === "fold" && (d.freq ?? 0) >= CLEAR_FOLD;

export interface Answer {
  /** the first answer */
  d: DecisionRecord;
  h: HandRecord;
  /** what it stands on (report.ts BASES) */
  basis: string;
  /** its sitting's index */
  sit: number;
}

/** The decisions graded in these sittings' hands the filters kept, as first answered, in the order played. */
export function answersOf(ds: readonly DecisionRecord[], sits: readonly Sitting[], kept: ReadonlySet<string>): Answer[] {
  const byHand = new Map<string, DecisionRecord[]>();
  for (const d of ds) {
    if (!kept.has(d.handId)) continue;
    const g = byHand.get(d.handId);
    if (g) g.push(d);
    else byHand.set(d.handId, [d]);
  }
  const hands: { h: HandRecord; sit: number }[] = [];
  sits.forEach((s, sit) => {
    for (const h of s.hands) if (byHand.has(h.id)) hands.push({ h, sit });
  });
  hands.sort((a, b) => byPlayed(a.h, b.h));
  const out: Answer[] = [];
  for (const { h, sit } of hands)
    for (const raw of [...byHand.get(h.id)!].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      const d = firstAnswer(raw);
      if (isGraded(d)) out.push({ d, h, basis: basisOf(d), sit });
    }
  return out;
}

const dated = (a: Answer) => a.h.playedAt > 0;
/** The decisions of the share: a basis's alone, dated, clear folds left out. */
export const counted = (all: readonly Answer[], basis: string) => all.filter((a) => a.basis === basis && dated(a) && !agreedFold(a.d));

export interface Block {
  n: number;
  ok: number;
  share: number;
  /** the share's 95% range */
  range: [number, number];
  /** when its first and last hands were played */
  from: number;
  to: number;
}

/** The share by blocks of a twentieth of the decisions or BLOCK, whichever is more, in the order played; the remainder
 * goes in the last. */
export function blocks(list: readonly Answer[]): Block[] {
  const size = Math.max(BLOCK, Math.ceil(list.length / 20));
  const n = Math.floor(list.length / size);
  const out: Block[] = [];
  for (let b = 0; b < n; b++) {
    const part = list.slice(b * size, b === n - 1 ? list.length : (b + 1) * size);
    const ok = part.filter((a) => isOk(a.d)).length;
    out.push({ n: part.length, ok, share: ok / part.length, range: wilson(ok, part.length), from: part[0]!.h.playedAt, to: part.at(-1)!.h.playedAt });
  }
  return out;
}

/** How many more decisions make a line. */
export const moreForLine = (n: number) => Math.max(0, MIN_BLOCKS * BLOCK - n);

/** Where the latest third starts: the sitting whose start is nearest two thirds of the way through the decisions
 * (whole sessions: a sitting isn't cut in two). Null with fewer than two sittings. */
export function latestCut(list: readonly Pick<Answer, "sit">[]): number | null {
  const by = new Map<number, number>();
  for (const a of list) by.set(a.sit, (by.get(a.sit) ?? 0) + 1);
  const sits = [...by.keys()].sort((a, b) => a - b);
  const aim = (list.length * 2) / 3;
  let cut: number | null = null;
  let miss = Infinity;
  let sum = 0;
  for (let i = 1; i < sits.length; i++) {
    sum += by.get(sits[i - 1]!)!;
    if (Math.abs(sum - aim) < miss) {
      miss = Math.abs(sum - aim);
      cut = sits[i]!;
    }
  }
  return cut;
}

/** The versions two sides' decisions were graded on. */
const spanOf = (before: readonly DecisionRecord[], later: readonly DecisionRecord[]): VersionSpan => versionSpan(countVersions(before.map((d) => d.version)), countVersions(later.map((d) => d.version)));

/** How far two shares are apart, in standard errors, the later above the earlier being positive; null with no spread. */
export function shareZ(ok1: number, n1: number, ok2: number, n2: number): number | null {
  const p = (ok1 + ok2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se > 0 ? (ok2 / n2 - ok1 / n1) / se : null;
}

/** How much nearer the answer a frequency came, in standard errors (positive: nearer). The gap is your action less each
 * hand's own answer, and the hands dealt move the answer as your play moves your side, so the spread is that of this
 * difference, over the decisions of both sides. (With one answer on every hand that's your own action's alone: a gap of
 * 2% over 100 hands is a 50% action as noisy as any. Pooled, as a side at 0% or 100% has no spread of its own.) None if
 * you never varied: then only the hands dealt moved the gap. */
export function gapZ(a: FreqRow, b: FreqRow): number | null {
  const se = gapSe(a, b);
  return se != null ? (Math.abs(a.you - a.gto) - Math.abs(b.you - b.gto)) / se : null;
}

function gapSe(a: FreqRow, b: FreqRow): number | null {
  const n = a.n + b.n;
  const y = (a.you * a.n + b.you * b.n) / n;
  if (y <= 0 || y >= 1) return null;
  const mean = (a.n * (a.you - a.gto) + b.n * (b.you - b.gto)) / n;
  const v = (a.n * a.sq + b.n * b.sq) / n - mean * mean;
  const se = Math.sqrt(Math.max(0, v) * (1 / a.n + 1 / b.n));
  return se > 0 ? se : null;
}

/** How far you stand from where you stood against the answer, gone from one side of it to the other, in standard errors
 * of the gap (the gaps cancel in gapZ); null if you haven't, or by under CROSS a side. This can't say who moved: another
 * table size moves an answer, and a player steeper than it crosses it unchanged. So the row says only where you stand,
 * and shows both answers. */
function crossZ(a: FreqRow, b: FreqRow): number | null {
  const [g1, g2] = [a.you - a.gto, b.you - b.gto];
  const se = gapSe(a, b);
  if (se == null || g1 * g2 >= 0 || Math.min(Math.abs(g1), Math.abs(g2)) < CROSS) return null;
  const z = (g2 - g1) / se;
  return Math.abs(z) >= BAR ? z : null;
}

const changeOf = (z: number | null): Change | null => (z == null || Math.abs(z) < BAR ? null : z > 0 ? "Better" : "Worse");

export interface LatestThird {
  /** the sitting it starts at */
  at: number;
  n1: number;
  ok1: number;
  n2: number;
  ok2: number;
  /** null: no clear change. `enough` false: too few to say either way */
  change: Change | null;
  enough: boolean;
  /** what the two sides were graded on */
  versions: VersionSpan;
}

export function latestThird(list: readonly Answer[], at: number): LatestThird {
  const [before, later] = [list.filter((a) => a.sit < at), list.filter((a) => a.sit >= at)];
  const [ok1, ok2] = [before, later].map((s) => s.filter((a) => isOk(a.d)).length) as [number, number];
  const [n1, n2] = [before.length, later.length];
  const enough = Math.min(n1, n2) >= MIN_SIDE;
  return { at, n1, ok1, n2, ok2, change: enough ? changeOf(shareZ(ok1, n1, ok2, n2)) : null, enough, versions: spanOf(before.map((a) => a.d), later.map((a) => a.d)) };
}

type Sides<T> = [T, T];
export type Shift = { key: string; n: Sides<number>; z: number | null; change: RowChange | null; leak: boolean; versions: VersionSpan } & (
  | { kind: "freq"; you: Sides<number>; gto: Sides<number> }
  | { kind: "pf"; share: Sides<number> }
  | { kind: "spot"; share: Sides<number>; avg: Sides<number | null> }
);

/** Every row with MIN_ROW decisions a side, the changes first and the widest first; `tooFew` the rest; `noMix` the reads
 * checked before their mix was kept. Frequencies against the answer, preflop situations and spots after the flop, through
 * the Report's own tallies (folds in), so each side reads as the Report would. */
export function shifts(before: readonly DecisionRecord[], later: readonly DecisionRecord[]): { rows: Shift[]; tooFew: number; noMix: number } {
  const now = new Set(leaks([...later]).map((l) => `${l.kind}:${l.key}`));
  const rows: Shift[] = [];
  let tooFew = 0;
  const rowVersions = (kind: Shift["kind"], key: string) => {
    const of = leakTest({ kind, key });
    const its = (d: DecisionRecord) => isGraded(d) && of(d);
    return spanOf(before.filter(its), later.filter(its));
  };
  const [f1, f2] = [before, later].map((ds) => new Map(freqs(ds).map((r) => [r.label, r])));
  for (const [key] of FREQS) {
    const [a, b] = [f1!.get(key), f2!.get(key)];
    if (!a && !b) continue;
    if (!a || !b || Math.min(a.n, b.n) < MIN_ROW) {
      tooFew++;
      continue;
    }
    const z = gapZ(a, b);
    const cross = changeOf(z) ? null : crossZ(a, b);
    const change = cross == null ? changeOf(z) : cross > 0 ? "Now over the answer" : "Now under the answer";
    rows.push({ kind: "freq", key, n: [a.n, b.n], you: [a.you, b.you], gto: [a.gto, b.gto], z: cross ?? z, change, leak: now.has(`freq:${key}`), versions: rowVersions("freq", key) });
  }
  const compare = (kind: "pf" | "spot", of: (ds: readonly DecisionRecord[]) => Group[]) => {
    const [g1, g2] = [before, later].map((ds) => new Map(of(ds).map((g) => [g.key, g])));
    for (const key of new Set([...g1!.keys(), ...g2!.keys()])) {
      const [a, b] = [g1!.get(key), g2!.get(key)];
      if (!a || !b || Math.min(a.graded, b.graded) < MIN_ROW) {
        tooFew++;
        continue;
      }
      const z = shareZ(a.ok, a.graded, b.ok, b.graded);
      const row = { key, n: [a.graded, b.graded] as Sides<number>, share: [a.ok / a.graded, b.ok / b.graded] as Sides<number>, z, change: changeOf(z), leak: now.has(`${kind}:${key}`), versions: rowVersions(kind, key) };
      rows.push(kind === "pf" ? { ...row, kind } : { ...row, kind, avg: [a.avg, b.avg] });
    }
  };
  compare("pf", (ds) => groupBy(ds.filter((d) => d.street === "preflop"), (d) => d.situation, PF_ORDER));
  compare("spot", (ds) => groupBy(ds, spotOf));
  const noMix = [...before, ...later].filter((d) => d.read && !d.mix).length;
  return { rows: rows.sort((a, b) => Number(!!b.change) - Number(!!a.change) || Math.abs(b.z ?? 0) - Math.abs(a.z ?? 0)), tooFew, noMix };
}

export interface Trend {
  /** the decisions of the share */
  n: number;
  points: Block[];
  latest: LatestThird | null;
  rows: ReturnType<typeof shifts> | null;
}

/** A basis's line, its latest third and the rows compared at the same cut. */
export function trendOf(all: readonly Answer[], basis: string): Trend {
  const list = counted(all, basis);
  const at = latestCut(list);
  const of = (test: (sit: number) => boolean) => all.filter((a) => a.basis === basis && dated(a) && test(a.sit)).map((a) => a.d);
  return {
    n: list.length,
    points: blocks(list),
    latest: at == null ? null : latestThird(list, at),
    rows: at == null ? null : shifts(of((s) => s < at), of((s) => s >= at)),
  };
}

export interface Tally {
  /** decisions graded, on any basis */
  graded: number;
  /** on the basis, clear folds left out: how many, and how many of them in the mix */
  n: number;
  ok: number;
}

/** Each sitting's counts, by index. (Graded goes by the grade as it now stands; the rest by the first answer.) */
export function tallies(ds: readonly DecisionRecord[], sits: readonly Sitting[], kept: ReadonlySet<string>, all: readonly Answer[], basis: string | null): Tally[] {
  const out = sits.map((): Tally => ({ graded: 0, n: 0, ok: 0 }));
  const at = new Map<string, number>();
  sits.forEach((s, k) => {
    for (const h of s.hands) if (kept.has(h.id)) at.set(h.id, k);
  });
  for (const d of ds) {
    const k = at.get(d.handId);
    if (k != null && isGraded(d)) out[k]!.graded++;
  }
  for (const a of all)
    if (a.basis === basis && !agreedFold(a.d)) {
      out[a.sit]!.n++;
      if (isOk(a.d)) out[a.sit]!.ok++;
    }
  return out;
}
