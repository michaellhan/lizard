// Flop reports (classic reports.js): a precomputed spot's flop strategy across all its stored flops, read from the
// library's <spot>/report.json with no solver. Per flop and averaged by texture group, each flop weighted by how many
// of the 22100 flops it stands for; filtered by texture and sorted by any column. Lizard adds what classic lacks: each
// player's EQR (EV over equity times the pot), and a CSV of the rows shown.
import { describe as describeProvenance } from "@/solver/provenance";
import type { Provenance, SolveMode } from "@/solver/types";
import { flopCards } from "@/library/entry";
import type { LibraryReport, ReportFlop } from "@/library/files";
import { potAt, texture, TEXTURE_GROUPS, type Texture, type TextureFilter, type TextureKey } from "@/features/practice/drills";
import { parseLine, toSearch, type StudyHand } from "@/features/study/studyState";

/** every flop there is (the weights of a spot's stored flops are a share of these) */
export const ALL_FLOPS = 22100;
/** flops up to suit isomorphism, the most a spot can store */
export const FLOP_CLASSES = 1755;

// ---- the views: who acts at which stored node. vsbet: out of position facing in position's most common bet after
// checking (fold / call / raise, whatever the size).
export type ReportView = "oop" | "ip" | "vsbet";
export const REPORT_VIEWS: readonly ReportView[] = ["oop", "ip", "vsbet"];
export function viewLabel(view: ReportView, seats: readonly string[]): string {
  if (view === "oop") return `${seats[0]} first`;
  if (view === "ip") return `${seats[1]} vs check`;
  return `${seats[0]} vs bet`;
}

// (in the vsbet view, raises of every size are one column)
const short = (n: string) => n.replace(/^raise.*/, "raise");

interface ViewNode {
  key: string;
  names: string[];
  freqs: number[];
  /** vsbet: the bet faced */
  bet?: string;
}

/** the view's node on a flop, or null where the flop doesn't store it */
export function nodeOf(rep: LibraryReport, fl: ReportFlop, view: ReportView): ViewNode | null {
  if (view === "oop") return fl.n[""] ? { key: "", names: rep.nodes[""] ?? [], freqs: fl.n[""] } : null;
  if (view === "ip") return fl.n.check ? { key: "check", names: rep.nodes.check ?? [], freqs: fl.n.check } : null;
  // (in position's response to a check isn't stored where out of position hardly checks; its bets may be)
  const ck = fl.n.check;
  const cn = rep.nodes.check ?? [];
  let best: { k: string; nm: string; f: number } | null = null;
  for (const k of Object.keys(fl.n)
    .filter((k) => k.startsWith("check|"))
    .sort()) {
    const nm = k.slice(6);
    const f = ck ? (ck[cn.indexOf(nm)] ?? 0) : 0;
    if (!best || f > best.f) best = { k, nm, f };
  }
  return best && { key: best.k, names: (rep.nodes[best.k] ?? []).map(short), freqs: fl.n[best.k]!, bet: best.nm };
}

/** the view's columns: action names in order (vsbet: fold, call, raise) */
export function columns(rep: LibraryReport, view: ReportView): string[] {
  if (view !== "vsbet") return (view === "oop" ? rep.nodes[""] : rep.nodes.check) ?? [];
  const out: string[] = [];
  for (const k in rep.nodes) if (k.startsWith("check|")) for (const n of rep.nodes[k]!.map(short)) if (!out.includes(n)) out.push(n);
  return out;
}

export interface ReportRow {
  f: string;
  w: number;
  t: Texture;
  /** ranks high to low, for sorting by flop */
  ranks: number[];
  /** each player's EV in bb at the start of the flop, [out of position, in position] */
  ev: [number, number];
  eq: [number, number];
  /** by column; null where the flop doesn't store the view's node */
  freqs: number[] | null;
  /** vsbet: the bet faced */
  bet: string | null;
}

const RANKS = "23456789TJQKA";
// (NaN where a report has none: shown as "–", never as 0)
const evOf = (fl: ReportFlop, k: "ev" | "eq"): [number, number] => [fl[k]?.[0] ?? NaN, fl[k]?.[1] ?? NaN];

/** one row per stored flop */
export function rows(rep: LibraryReport, view: ReportView): ReportRow[] {
  const cols = columns(rep, view);
  return rep.flops.map((fl) => {
    const nd = nodeOf(rep, fl, view);
    const freqs = nd
      ? cols.map((c) => {
          const i = nd.names.indexOf(c);
          return i < 0 ? 0 : (nd.freqs[i] ?? 0);
        })
      : null;
    return {
      f: fl.f,
      w: fl.w,
      t: texture(fl.f),
      ranks: flopCards(fl.f)
        .map((c) => RANKS.indexOf(c[0]!))
        .sort((a, b) => b - a),
      ev: evOf(fl, "ev"),
      eq: evOf(fl, "eq"),
      freqs,
      bet: nd?.bet ?? null,
    };
  });
}

export const matches = (r: Pick<ReportRow, "t">, flt: TextureFilter) => Object.entries(flt).every(([k, v]) => !v || r.t[k as TextureKey] === v);
export const filterRows = (rs: readonly ReportRow[], flt: TextureFilter) => rs.filter((r) => matches(r, flt));

/** EV realized over equity's share of the pot; null where equity is zero or unknown */
export function eqr(ev: number, eq: number, pot: number): number | null {
  return Number.isFinite(ev) && Number.isFinite(eq) && eq > 0 && pot > 0 ? ev / (eq * pot) : null;
}

// sort keys: "flop" (ranks high to low), "w", "ev0", "ev1", "eq0", "eq1", "eqr0", "eqr1", "a<i>" (the i-th column)
export type SortKey = string;
function sortKey(r: ReportRow, key: SortKey, pot: number): number {
  if (key === "flop") return r.ranks[0]! * 169 + r.ranks[1]! * 13 + r.ranks[2]!;
  if (key === "w") return r.w;
  const m = /^(ev|eq|eqr|a)(\d+)$/.exec(key);
  if (!m) return 0;
  const i = Number(m[2]);
  const x = m[1] === "a" ? r.freqs?.[i] : m[1] === "eqr" ? eqr(r.ev[i]!, r.eq[i]!, pot) : r[m[1] as "ev" | "eq"][i];
  return x == null || Number.isNaN(x) ? -Infinity : x;
}
export function sortRows(rs: readonly ReportRow[], key: SortKey, desc: boolean, pot = 0): ReportRow[] {
  const s = desc ? -1 : 1;
  return [...rs].sort((a, b) => (sortKey(a, key, pot) - sortKey(b, key, pot)) * s || sortKey(b, "flop", pot) - sortKey(a, "flop", pot));
}

export interface Average {
  n: number;
  w: number;
  /** over the flops that store the view's node; null where none does */
  freqs: number[] | null;
  ev: [number, number];
  eq: [number, number];
}

/** weighted averages over rows */
export function average(rs: readonly ReportRow[]): Average {
  const out: Average = { n: rs.length, w: 0, freqs: null, ev: [0, 0], eq: [0, 0] };
  let wf = 0;
  for (const r of rs) {
    out.w += r.w;
    for (const i of [0, 1] as const) {
      out.ev[i] += r.w * r.ev[i];
      out.eq[i] += r.w * r.eq[i];
    }
    if (r.freqs) {
      const f = (out.freqs ??= r.freqs.map(() => 0));
      r.freqs.forEach((x, i) => (f[i] = f[i]! + r.w * x));
      wf += r.w;
    }
  }
  for (const i of [0, 1] as const) {
    out.ev[i] /= out.w || 1;
    out.eq[i] /= out.w || 1;
  }
  if (out.freqs) out.freqs = out.freqs.map((x) => x / wf);
  return out;
}

export interface Group extends Average {
  g: string;
  label: string;
}
export function groups(rs: readonly ReportRow[], by: TextureKey): Group[] {
  const def = TEXTURE_GROUPS.find((x) => x.key === by)!;
  return Object.entries(def.values)
    .map(([g, label]) => ({ g, label, ...average(rs.filter((r) => r.t[by] === g)) }))
    .filter((x) => x.n);
}

/** how much of the game a spot's report covers */
export function coverage(rep: Pick<LibraryReport, "flops">): { flops: number; share: number } {
  return { flops: rep.flops.length, share: rep.flops.reduce((a, f) => a + f.w, 0) / ALL_FLOPS };
}

// ---- Study at a row's node: the spot's preflop line, the stored flop, the flop action to the view's decision
export function studyHandAt(rep: LibraryReport, f: string, view: ReportView): StudyHand | null {
  const fl = rep.flops.find((x) => x.f === f);
  if (!fl) return null;
  const [oop, ip] = rep.seats;
  const flop: StudyHand["flop"] = view === "oop" ? [] : [{ pos: oop, action: "check" }];
  if (view === "vsbet") {
    const nd = nodeOf(rep, fl, "vsbet");
    if (!nd?.bet) return null;
    flop.push({ pos: ip, action: "bet", to: potAt(rep, [nd.bet]).bet });
  }
  return { players: rep.game?.players ?? 6, stack: rep.game?.stack ?? 100, board: f, preflop: parseLine(rep.line), flop, turn: [], river: [] };
}
/** the Study URL for a row; null for a game Study can't set up (antes, a straddle) or a node the flop doesn't store */
export function studyLink(rep: LibraryReport, f: string, view: ReportView): string | null {
  if (rep.game?.ante || rep.game?.straddle) return null;
  const h = studyHandAt(rep, f, view);
  return h ? `/study?${toSearch(h)}` : null;
}

/** what the numbers are: the library's stored solves, summed up by the report built with them, read in the page */
export function reportProvenance(rep: LibraryReport, mode: SolveMode, version?: string): Provenance {
  const c = coverage(rep);
  return {
    source: "library",
    approximate: false,
    librarySpot: rep.id,
    approximateLabel: `flop report over its ${c.flops} stored flops`,
    mode,
    transport: "file",
    solverVersion: `library report${version ? ` ${version}` : ""}`,
    partial: false,
    receivedAt: Date.now(),
  };
}

// ---- CSV of the rows shown: the stored precision (frequencies and equities to 3 places, EVs to 2), no more
const cell = (x: string) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
const num = (x: number | null | undefined, d: number) => (x == null || Number.isNaN(x) ? "" : x.toFixed(d));
export function toCsv(rep: LibraryReport, view: ReportView, rs: readonly ReportRow[], p: Provenance): string {
  const cols = columns(rep, view);
  const [o, ip] = rep.seats;
  const head = [
    "flop",
    "weight",
    "share of flops",
    "high card",
    "suits",
    "pairing",
    "connectedness",
    ...(view === "vsbet" ? ["bet faced"] : []),
    ...cols,
    `${o} EV (bb)`,
    `${ip} EV (bb)`,
    `${o} equity`,
    `${ip} equity`,
    `${o} EQR`,
    `${ip} EQR`,
    "source",
  ];
  const src = describeProvenance(p);
  const lines = rs.map((r) =>
    [
      r.f,
      String(r.w),
      num(r.w / ALL_FLOPS, 5),
      r.t.hi,
      r.t.suits,
      r.t.pair,
      r.t.conn,
      ...(view === "vsbet" ? [r.bet ?? ""] : []),
      ...cols.map((_, i) => num(r.freqs?.[i], 3)),
      num(r.ev[0], 2),
      num(r.ev[1], 2),
      num(r.eq[0], 3),
      num(r.eq[1], 3),
      num(eqr(r.ev[0], r.eq[0], rep.pot), 3),
      num(eqr(r.ev[1], r.eq[1], rep.pot), 3),
      src,
    ]
      .map(cell)
      .join(","),
  );
  return [head.map(cell).join(","), ...lines].join("\n") + "\n";
}
