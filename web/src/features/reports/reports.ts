// Flop reports (classic reports.js): a precomputed spot's flop strategy across all its stored flops, read from the
// library's <spot>/report.json with no solver (a 3-way spot's built in the page from its entries, library/mwReport.ts). Per flop and averaged by texture group, each flop weighted by how many
// of the 22100 flops it stands for; filtered by texture and sorted by any column. Lizard adds what classic lacks: each
// player's EQR (EV over equity times the pot), each flop's range advantage from the stored equities, and a CSV of the
// rows shown. There's no nut advantage: report.json holds each side's equity over its whole range, and no file holds a
// hand's equity, so a nut share can't be read from the library: it would take a field stored for each flop.
import { pct } from "@/components/actions";
import { describe as describeProvenance } from "@/solver/provenance";
import type { Provenance, SolveMode } from "@/solver/types";
import { flopCards } from "@/library/entry";
import type { LibraryReport, ReportFlop } from "@/library/files";
import { potAt, texture, TEXTURE_GROUPS, type Texture, type TextureFilter, type TextureKey } from "@/features/practice/drills";
import { gameSetup } from "@/features/solve/setup";
import { parseLine, toSearch, type StudyHand } from "@/features/study/studyState";

/** every flop there is (the weights of a spot's stored flops are a share of these) */
export const ALL_FLOPS = 22100;
/** flops up to suit isomorphism, the most a spot can store */
export const FLOP_CLASSES = 1755;

// ---- the views: who acts at which stored node. vsbet: out of position facing in position's most common bet after
// checking (fold / call / raise, whatever the size). ipvsbet: in position facing out of position's most common first
// bet (a lead, or the c-bet where out of position raised preflop): Lizard's, as classic has the first three. The library
// stores the response to a bet only where it's made at least 5% of the time, so the two facing views leave flops out.
// A 3-way spot stores three: first to act ("oop"), the second after a check ("ip"), the third after two ("third").
export type ReportView = "oop" | "ip" | "vsbet" | "ipvsbet" | "third";
export const REPORT_VIEWS: readonly ReportView[] = ["oop", "ip", "vsbet", "ipvsbet", "third"];
/** the decisions a spot's reports have: heads-up or 3-way */
export const viewsFor = (seats: readonly string[]): ReportView[] => (seats.length > 2 ? ["oop", "ip", "third"] : ["oop", "ip", "vsbet", "ipvsbet"]);
export type FacingView = "vsbet" | "ipvsbet";
export const isFacing = (v: ReportView): v is FacingView => v === "vsbet" || v === "ipvsbet";
export function viewLabel(view: ReportView, seats: readonly string[]): string {
  if (view === "oop") return `${seats[0]} first`;
  if (view === "ip") return `${seats[1]} vs check`;
  if (view === "ipvsbet") return `${seats[1]} vs bet`;
  if (view === "third") return `${seats[2]} vs two checks`;
  return `${seats[0]} vs bet`;
}

// a node facing a bet: after a check ("check|bet 33%"), or out of position's first ("bet 33%")
const facingKey = (k: string, view: FacingView) => (view === "vsbet" ? k.startsWith("check|bet") : k !== "" && k !== "check" && !k.includes("|"));
// the node a view that faces no bet reads
const plainKey = { oop: "", ip: "check", third: "check|check" } as const;

/** the views a report stores on at least one flop */
export function viewsOf(rep: LibraryReport): ReportView[] {
  return viewsFor(rep.seats).filter((v) => rep.flops.some((fl) => nodeOf(rep, fl, v)));
}

// (in the vsbet view, raises of every size are one column)
const short = (n: string) => n.replace(/^raise.*/, "raise");

interface ViewNode {
  key: string;
  names: string[];
  freqs: number[];
  /** the facing views: the bet faced, and how often it's made (null where the node before isn't stored) */
  bet?: string;
  made?: number | null;
}

/** the view's node on a flop, or null where the flop doesn't store it */
export function nodeOf(rep: LibraryReport, fl: ReportFlop, view: ReportView): ViewNode | null {
  if (!isFacing(view)) {
    const k = plainKey[view];
    return fl.n[k] ? { key: k, names: rep.nodes[k] ?? [], freqs: fl.n[k] } : null;
  }
  // (in position's response to a check isn't stored where out of position hardly checks; its bets may be)
  const at = view === "vsbet" ? "check" : "";
  const ck = fl.n[at];
  const cn = rep.nodes[at] ?? [];
  let best: { k: string; nm: string; f: number | null } | null = null;
  for (const k of Object.keys(fl.n)
    .filter((k) => facingKey(k, view))
    .sort()) {
    const nm = view === "vsbet" ? k.slice(6) : k;
    const f = ck ? (ck[cn.indexOf(nm)] ?? 0) : null;
    if (!best || (f ?? 0) > (best.f ?? 0)) best = { k, nm, f };
  }
  return best && { key: best.k, names: (rep.nodes[best.k] ?? []).map(short), freqs: fl.n[best.k]!, bet: best.nm, made: best.f };
}

/** the view's columns: action names in order (the facing views: fold, call, raise) */
export function columns(rep: LibraryReport, view: ReportView): string[] {
  if (!isFacing(view)) return rep.nodes[plainKey[view]] ?? [];
  const out: string[] = [];
  for (const k in rep.nodes) if (facingKey(k, view)) for (const n of rep.nodes[k]!.map(short)) if (!out.includes(n)) out.push(n);
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
  /** the facing views: the bet faced, and how often it's made */
  bet: string | null;
  made: number | null;
}

/** a facing row's bet in words: "vs 75%, made 12%" (the bet's share of the pot, how often it's made) */
export function facingText(r: Pick<ReportRow, "bet" | "made">): string {
  if (!r.bet) return "";
  return `vs ${r.bet.replace("bet ", "")}${r.made != null ? `, made ${pct(r.made, 0)}` : ""}`;
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
      made: nd?.made ?? null,
    };
  });
}

export const matches = (r: Pick<ReportRow, "t">, flt: TextureFilter) => Object.entries(flt).every(([k, v]) => !v || r.t[k as TextureKey] === v);
export const filterRows = (rs: readonly ReportRow[], flt: TextureFilter) => rs.filter((r) => matches(r, flt));

/** EV realized over equity's share of the pot; null where equity is zero or unknown */
export function eqr(ev: number, eq: number, pot: number): number | null {
  return Number.isFinite(ev) && Number.isFinite(eq) && eq > 0 && pot > 0 ? ev / (eq * pot) : null;
}

/** The range advantage: in position's lead in range equity, in points of equity (out of position's is below zero),
 * the same read as Study's (who has the higher equity), from the report's own equities. NaN with none. */
export const rangeLead = (eq: readonly [number, number]): number => (eq[1] - eq[0]) * 100;

/** Who leads and by how much: "BTN +8.4", "Even" where it rounds to nothing, null with no equities. */
export function rangeLeadParts(eq: readonly [number, number], seats: readonly string[]): { seat: string; points: number } | null {
  const lead = rangeLead(eq);
  if (Number.isNaN(lead)) return null;
  const points = Math.round(Math.abs(lead) * 10) / 10;
  return { seat: points === 0 ? "" : (seats[lead > 0 ? 1 : 0] ?? ""), points };
}
export function rangeLeadText(eq: readonly [number, number], seats: readonly string[]): string {
  const l = rangeLeadParts(eq, seats);
  return !l ? "–" : l.seat ? `${l.seat} +${l.points.toFixed(1)}` : "Even";
}

// sort keys: "flop" (ranks high to low), "w", "adv" (in position's range lead), "ev0", "ev1", "eq0", "eq1", "eqr0", "eqr1",
// "a<i>" (the i-th column)
export type SortKey = string;
function sortKey(r: ReportRow, key: SortKey, pot: number): number {
  if (key === "flop") return r.ranks[0]! * 169 + r.ranks[1]! * 13 + r.ranks[2]!;
  if (key === "w") return r.w;
  if (key === "adv") {
    const lead = rangeLead(r.eq);
    return Number.isNaN(lead) ? -Infinity : lead;
  }
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
  /** the weight of those flops */
  wf: number;
  ev: [number, number];
  eq: [number, number];
}

/** weighted averages over rows */
export function average(rs: readonly ReportRow[]): Average {
  const out: Average = { n: rs.length, w: 0, freqs: null, wf: 0, ev: [0, 0], eq: [0, 0] };
  for (const r of rs) {
    out.w += r.w;
    for (const i of [0, 1] as const) {
      out.ev[i] += r.w * r.ev[i];
      out.eq[i] += r.w * r.eq[i];
    }
    if (r.freqs) {
      const f = (out.freqs ??= r.freqs.map(() => 0));
      r.freqs.forEach((x, i) => (f[i] = f[i]! + r.w * x));
      out.wf += r.w;
    }
  }
  for (const i of [0, 1] as const) {
    out.ev[i] /= out.w || 1;
    out.eq[i] /= out.w || 1;
  }
  if (out.freqs) out.freqs = out.freqs.map((x) => x / out.wf);
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

/** whether a report has EVs and equities (a 3-way one has strategies only) */
export const hasEv = (rep: Pick<LibraryReport, "flops">) => rep.flops.some((f) => f.ev != null);

/** how much of the game a spot's report covers */
export function coverage(rep: Pick<LibraryReport, "flops">): { flops: number; share: number } {
  return { flops: rep.flops.length, share: rep.flops.reduce((a, f) => a + f.w, 0) / ALL_FLOPS };
}

// ---- Study at a row's node: the spot's preflop line, the stored flop, the flop action to the view's decision
export function studyHandAt(rep: LibraryReport, f: string, view: ReportView): StudyHand | null {
  const fl = rep.flops.find((x) => x.f === f);
  if (!fl) return null;
  const [oop, ip] = rep.seats;
  const flop: StudyHand["flop"] = view === "oop" || view === "ipvsbet" ? [] : [{ pos: oop, action: "check" }];
  if (view === "third") flop.push({ pos: ip, action: "check" });
  if (isFacing(view)) {
    const nd = nodeOf(rep, fl, view);
    if (!nd?.bet) return null;
    flop.push({ pos: view === "vsbet" ? ip : oop, action: "bet", to: potAt(rep, [nd.bet]).bet });
  }
  const players = rep.game?.players ?? 6;
  const setup = gameSetup(players, rep.game?.ante, rep.game?.straddle);
  if (setup === null) return null;
  return { players, stack: rep.game?.stack ?? 100, board: f, preflop: parseLine(rep.line), flop, turn: [], river: [], ...(setup ? { setup } : {}) };
}
/** the Study URL for a row (a spot's ante or straddle as Study's setup); null for a game Study can't set up (an ante
 * over 1bb) or a node the flop doesn't store */
export function studyLink(rep: LibraryReport, f: string, view: ReportView): string | null {
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
    approximateLabel: rep.seats.length > 2 ? `3-way flop report over its ${c.flops} stored flops, built in the page from their entries` : `flop report over its ${c.flops} stored flops`,
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
  const ev = hasEv(rep);
  const head = [
    "flop",
    "weight",
    "share of flops",
    "high card",
    "suits",
    "pairing",
    "connectedness",
    ...(isFacing(view) ? ["bet faced", "bet frequency"] : []),
    ...cols,
    ...(ev ? [`${o} EV (bb)`, `${ip} EV (bb)`, `${o} equity`, `${ip} equity`, `${o} EQR`, `${ip} EQR`, "range advantage seat", "range advantage (equity points)"] : []),
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
      ...(isFacing(view) ? [r.bet ?? "", num(r.made, 3)] : []),
      ...cols.map((_, i) => num(r.freqs?.[i], 3)),
      ...(ev ? [num(r.ev[0], 2), num(r.ev[1], 2), num(r.eq[0], 3), num(r.eq[1], 3), num(eqr(r.ev[0], r.eq[0], rep.pot), 3), num(eqr(r.ev[1], r.eq[1], rep.pot), 3), rangeLeadParts(r.eq, rep.seats)?.seat ?? "", num(rangeLeadParts(r.eq, rep.seats)?.points, 1)] : []),
      src,
    ]
      .map(cell)
      .join(","),
  );
  return [head.map(cell).join(","), ...lines].join("\n") + "\n";
}
