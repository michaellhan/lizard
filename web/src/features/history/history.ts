// The sessions history (ROADMAP Phase 1, "The history page lists sessions by date with totals by pot type"): every
// session kept in this browser (data/db.ts `sessions`) of each kind, Practice's full hands and drills, Analyze's leak
// drills and Study's range builds, read into rows and lifetime totals; and Practice's finished hands by pot type. A
// Practice session keeps its pot types (`byPot`) and what graded its decisions (`sources`) from 2026-11-03 on: earlier
// sessions have neither, and are counted as such. Records are read defensively: any field may be missing.
import type { SessionRecord } from "@/data/db";
import { potType } from "@/features/analyze/analyze";
import { profileName } from "@/features/practice/exploit";
import { isPotDrill, POT_DRILLS } from "@/features/practice/practice";
import { describeLock, type Lock } from "@/features/study/locks";
import { fromSearch } from "@/features/study/studyState";
import type { Grade } from "@/grading/grade";
import { spotVersion } from "@/grading/version";
import type { Move, Sim } from "@/poker/table";
import { describeTournament } from "@/features/tournaments/tournament";
import { PRIZE_UNIT, sourceLabel } from "@/solver/provenance";
import type { ResultSource } from "@/solver/types";

export type SessionKind = SessionRecord["kind"];

export const KINDS: readonly { id: SessionKind; label: string }[] = [
  { id: "practice", label: "Full hands" },
  { id: "tournament", label: "Tournaments in prize equity" },
  { id: "tournament-chips", label: "Tournaments in chip EV" },
  { id: "exploit", label: "Exploiting an assumed profile" },
  { id: "drill", label: "Drills" },
  { id: "analysis", label: "Leak drills" },
  { id: "build", label: "Range builds" },
];
export const kindLabel = (k: SessionKind) => KINDS.find((x) => x.id === k)?.label ?? k;

/** A Practice session of full hands: a cash game's, or a tournament's, whose EVs and chips go in no other kind's totals. */
const isTournamentKind = (k: SessionKind) => k === "tournament" || k === "tournament-chips";
/** What a kind's EVs are in. */
export const kindUnit = (k: SessionKind) => (k === "tournament" ? PRIZE_UNIT : "bb");

/** One pot type's finished hands in Practice: their decisions graded, of them Best or Correct, the EV lost over those
 * graded by EV (bb and % of the pot), and the net over the hands played out (`played`; none preflop only). */
export interface PotTally {
  hands: number;
  n: number;
  ok: number;
  ne: number;
  loss: number;
  lossPct: number;
  played: number;
  net: number;
}

export const POT_ORDER = ["Unopened", "Limped", "SRP", "3bet pot", "4bet+ pot"];

export const emptyTally = (): PotTally => ({ hands: 0, n: 0, ok: 0, ne: 0, loss: 0, lossPct: 0, played: 0, net: 0 });
const round2 = (x: number) => Math.round(x * 100) / 100;

/** A Practice hand's pot as its preflop went while you were in it, named as Analyze names pot types; "Unopened" where
 * nobody raised or called (it folded to you and you folded, or the blinds were left to you). */
export function handPot(preflop: readonly Move[], sim: Pick<Sim, "streets">): string {
  const raises = sim.streets.preflop?.nRaises ?? 0;
  if (raises) return potType(raises);
  return preflop.some((m) => m.action === "call") ? "Limped" : "Unopened";
}

/** A finished hand added to its pot type's tally: its graded decisions, and its net (null preflop only). */
export function addHandToPot(t: PotTally | undefined, grades: readonly (Pick<Grade, "ok" | "loss" | "lossPct" | "byEv"> | null)[], net: number | null): PotTally {
  const out = { ...(t ?? emptyTally()) };
  out.hands++;
  for (const g of grades) {
    if (!g) continue;
    out.n++;
    if (g.ok) out.ok++;
    if (g.byEv) {
      out.ne++;
      out.loss += g.loss;
      out.lossPct += g.lossPct;
    }
  }
  if (net != null) {
    out.played++;
    out.net = round2(out.net + net);
  }
  return out;
}

/** Decisions graded alike: on a street, against one source, by EV or by frequency. A Practice session keeps these from
 * 2026-11-05 on, so its totals can be split by street and neither basis is averaged into the other (progress.ts). */
export interface GradeCell {
  street: string;
  source: string;
  byEv: boolean;
  n: number;
  ok: number;
  /** EV lost, bb and % of the pot: only ever summed where `byEv` */
  loss: number;
  lossPct: number;
  /** how many stand on each version (grading/version.ts, a spot's without its flop): those not counted here, every one
   * in a cell kept before versions were, are unknown */
  versions?: Record<string, number>;
}

/** A graded decision added to its cell. */
export function addCell(cells: Record<string, GradeCell> | undefined, street: string, source: ResultSource | undefined, g: Pick<Grade, "ok" | "loss" | "lossPct" | "byEv">, version?: string): Record<string, GradeCell> {
  const src = source ?? "unknown";
  const key = `${street}|${src}|${g.byEv ? "ev" : "freq"}`;
  const c = cells?.[key] ?? { street, source: src, byEv: g.byEv, n: 0, ok: 0, loss: 0, lossPct: 0 };
  return { ...cells, [key]: { ...c, n: c.n + 1, ok: c.ok + (g.ok ? 1 : 0), loss: c.loss + (g.byEv ? g.loss : 0), lossPct: c.lossPct + (g.byEv ? g.lossPct : 0), ...(version || c.versions ? { versions: addVersion(c.versions, version) } : {}) } };
}

/** A grade counted under its version; one with none, as it was. */
export function addVersion(kept: Record<string, number> | undefined, version: string | undefined): Record<string, number> {
  if (!version) return kept ?? {};
  const k = spotVersion(version);
  return { ...kept, [k]: (kept?.[k] ?? 0) + 1 };
}

/** A graded decision counted under what answered it. */
export const addSource = (s: Partial<Record<ResultSource, number>>, src: ResultSource | undefined): Partial<Record<ResultSource, number>> => {
  const k = src ?? "unknown";
  return { ...s, [k]: (s[k] ?? 0) + 1 };
};

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const str = (x: unknown) => (typeof x === "string" ? x : "");
const obj = (x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);

/** What answered a source's numbers, in words, the approximate ones said so. */
export const sourceWords = (s: string) => {
  const label = s in SOURCE_SET ? sourceLabel(s as ResultSource) : s;
  return s === "charts" || s === "library-turn" ? `${label} (approximate)` : label;
};
const SOURCE_SET: Record<ResultSource, true> = {
  library: true,
  "library-turn": true,
  instant: true,
  live: true,
  charts: true,
  "preflop-solve": true,
  "push-fold": true,
  "best-response": true,
  rules: true,
  equity: true,
  unknown: true,
};

const VIEW_WORDS: Record<string, string> = { oop: "first to act", ip: "after a check", vsbet: "facing a bet", ipvsbet: "in position facing a bet" };

export interface SessionRow {
  id: string;
  kind: SessionKind;
  at: number;
  /** what was practised */
  what: string;
  /** decisions graded (range builds: 1, the range) */
  n: number;
  /** of them Best or Correct (null for range builds, scored by accuracy) */
  ok: number | null;
  /** EV lost per decision graded by EV, bb and % of the pot (null where none was) */
  lossPer: number | null;
  lossPctPer: number | null;
  /** full hands: hands played, and net over them (null preflop only) */
  hands?: number;
  net?: number | null;
  /** range builds: the range's accuracy by hand class, and its EV lost a combo (bb) */
  acc?: number | null;
  /** a range build scored combo by combo, not by hand class */
  byCombo?: boolean;
  buildLoss?: number | null;
  /** what the grades are against */
  graded: string;
  /** where it opens again */
  to?: { href: string; label: string };
}

/** What graded a Practice session's decisions: the count by source where the session kept it. */
export function sourcesText(sources: Record<string, unknown> | null): string {
  if (!sources) return "Not kept: played before Lizard kept what graded each decision";
  const xs = Object.entries(sources).filter(([, n]) => num(n) > 0);
  if (!xs.length) return "No decision graded";
  return xs
    .sort((a, b) => num(b[1]) - num(a[1]))
    .map(([s, n]) => `${sourceWords(s)} ${num(n)}`)
    .join(", ");
}

/** A kept session as a row of the history. */
export function rowOf(s: SessionRecord): SessionRow {
  const m = s.meta ?? {};
  const base = { id: s.id, kind: s.kind, at: num(s.startedAt), n: num(s.decisions) };
  const per = (ne: number, loss: number, lossPct: number) => ({ lossPer: ne ? loss / ne : null, lossPctPer: ne ? lossPct / ne : null });
  if (isTournamentKind(s.kind)) {
    const t = obj(m.tournament);
    const game = t && s.kind === "tournament" ? describeTournament({ payouts: Array.isArray(t.payouts) ? t.payouts.filter((x): x is number => typeof x === "number") : [], ...(obj(t.field) ? { field: t.field as { players: number; avg: number } } : {}) }) : [];
    const stacks = Object.entries(obj(t?.stacks) ?? {}).map(([p, v]) => `${p} ${num(v)}`).join(", ");
    const what = [`${num(m.players) || "?"} players`, ...(stacks ? [`stacks ${stacks}`] : []), ...game, ...(num(m.ante) ? [`ante ${num(m.ante)}`] : []), ...(m.preflopOnly ? ["stops at the flop"] : []), ...(m.seat && m.seat !== "moves" ? [`seat ${str(m.seat)}`] : [])].join(" · ");
    return { ...base, what, ok: num(m.ok), ...per(num(m.graded), num(s.evLossBb), num(m.lossPct)), hands: num(m.hands), graded: sourcesText(obj(m.sources)) };
  }
  if (s.kind === "exploit") {
    const read = obj(m.exploit);
    const numbers = read && obj(read.lock) ? describeLock(read.lock as Lock) : "";
    const what = [`${profileName(read?.profile)} (assumed${numbers ? `: ${numbers}` : ""})`, `${num(m.players) || "?"} players`, `${num(m.stack) || "?"}bb`, ...(isPotDrill(m.pot) ? [POT_DRILLS[m.pot].label.toLowerCase()] : [])].join(" · ");
    // (no net: the opponents played the equilibrium, not the profile, so the chips say nothing of it)
    return { ...base, what, ok: num(m.ok), ...per(num(m.graded), num(s.evLossBb), num(m.lossPct)), hands: num(m.hands), graded: sourcesText(obj(m.sources)) };
  }
  if (s.kind === "practice") {
    const kind = isPotDrill(m.pot) ? ` · ${POT_DRILLS[m.pot].label.toLowerCase()}` : m.pushFold ? " · push/fold" : m.preflopOnly ? " · preflop only" : "";
    const game = `${num(m.ante) ? ` · ante ${num(m.ante)}` : ""}${m.straddle ? " · straddle" : ""}${m.carry ? " · chips carried" : ""}${m.sizes ? " · your own sizes" : ""}${num(m.rake) ? ` · rake ${num(m.rake)}%` : ""}`;
    const what = `${num(m.players) || "?"} players · ${num(m.stack) || "?"}bb${game}${kind}${m.seat && m.seat !== "moves" ? ` · seat ${str(m.seat)}` : ""}`;
    return {
      ...base,
      what,
      ok: num(m.ok),
      ...per(num(m.graded), num(s.evLossBb), num(m.lossPct)),
      hands: num(m.hands),
      net: m.preflopOnly ? null : num(m.net),
      graded: sourcesText(obj(m.sources)),
    };
  }
  if (s.kind === "drill") {
    const spot = str(m.spot), view = str(m.view);
    return {
      ...base,
      what: `${str(m.label) || spot || "A library spot"}${VIEW_WORDS[view] ? `, ${VIEW_WORDS[view]}` : ""}${m.street === "turn" ? " on the turn" : ""}`,
      ok: num(m.ok),
      ...per(num(m.graded), num(s.evLossBb), num(m.lossPct)),
      graded: m.street === "turn" ? "Stored turn from the flop library (by how often, in 5% steps)" : "Precomputed solution (the flop library)",
      ...(spot ? { to: { href: `/practice?tab=drills&spot=${encodeURIComponent(spot)}${m.street === "turn" ? "&street=turn" : ""}${view ? `&view=${encodeURIComponent(view)}` : ""}`, label: "Drill it again" } } : {}),
    };
  }
  if (s.kind === "analysis") {
    const sc = obj(m.score) ?? {};
    const leak = str(m.leak);
    const done = Array.isArray(m.done) ? m.done.length : 0;
    // (a row sits under the day it was started: a drill resumed since says its own day)
    const last = num(s.endedAt) ? `, ${new Date(num(s.endedAt)).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "";
    return {
      ...base,
      what: `Leak: ${str(m.label) || leak || "?"}${num(m.total) ? ` · ${done} of ${num(m.total)} done when last drilled${last}` : ""}`,
      ok: num(sc.ok),
      ...per(num(sc.ne), num(sc.loss), num(sc.lossPct)),
      graded: "Analyze's answers to your own decisions: the preflop charts by frequency (not a solve) preflop, after the flop what answered each one, said in the drill",
      ...(leak ? { to: { href: `/analyze?drill=${encodeURIComponent(leak)}`, label: "Open the drill" } } : {}),
    };
  }
  const line = str(m.line);
  const src = str(m.source);
  const h = line ? fromSearch(line) : null;
  const table = h ? `${h.players === 2 ? "HU" : `${h.players}-max`} ${h.stack}bb` : "";
  const node = str(m.label) || (str(m.street) === "preflop" || (h && !h.preflop.length) ? "first in" : "");
  return {
    ...base,
    what: [table, node, m.actor ? `${str(m.actor)}'s range` : ""].filter(Boolean).join(" · ") || "A node",
    n: 1,
    ok: null,
    lossPer: null,
    lossPctPer: null,
    acc: typeof m.acc === "number" ? m.acc : null,
    byCombo: m.graded === "combo",
    buildLoss: typeof m.evLossBb === "number" ? m.evLossBb : null,
    graded: src ? `${sourceWords(src)}${m.approximate && src !== "charts" && src !== "library-turn" ? " (approximate)" : ""}` : "Not kept",
    ...(line ? { to: { href: `/study?${line}`, label: "Open the node in Study" } } : {}),
  };
}

export interface KindTotal {
  kind: SessionKind;
  sessions: number;
  n: number;
  ok: number;
  ne: number;
  loss: number;
  lossPct: number;
  /** full hands: hands, and net over the sessions played out */
  hands: number;
  played: number;
  net: number;
  /** range builds: mean accuracy and EV lost a combo, over the builds that have them */
  acc: number | null;
  buildLoss: number | null;
}

/** Lifetime totals of each kind kept (in KINDS' order; kinds with no session left out). */
export function kindTotals(sessions: readonly SessionRecord[]): KindTotal[] {
  const out: KindTotal[] = [];
  for (const { id } of KINDS) {
    const ss = sessions.filter((s) => s.kind === id);
    if (!ss.length) continue;
    const t: KindTotal = { kind: id, sessions: ss.length, n: 0, ok: 0, ne: 0, loss: 0, lossPct: 0, hands: 0, played: 0, net: 0, acc: null, buildLoss: null };
    const accs: number[] = [], losses: number[] = [];
    for (const s of ss) {
      const r = rowOf(s);
      const m = s.meta ?? {};
      if (id === "build") {
        if (r.acc != null) accs.push(r.acc);
        if (r.buildLoss != null) losses.push(r.buildLoss);
        t.n += 1;
        continue;
      }
      t.n += r.n;
      t.ok += r.ok ?? 0;
      const sc = id === "analysis" ? (obj(m.score) ?? {}) : null;
      const ne = sc ? num(sc.ne) : num(m.graded);
      t.ne += ne;
      t.loss += sc ? num(sc.loss) : num(s.evLossBb);
      t.lossPct += sc ? num(sc.lossPct) : num(m.lossPct);
      if (isTournamentKind(id) || id === "exploit") t.hands += r.hands ?? 0;
      if (id === "practice") {
        t.hands += r.hands ?? 0;
        if (r.net != null) {
          t.played += r.hands ?? 0;
          t.net = round2(t.net + r.net);
        }
      }
    }
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    t.acc = mean(accs);
    t.buildLoss = mean(losses);
    out.push(t);
  }
  return out;
}

/** Practice's finished hands by pot type, over the sessions that kept them; and the sessions (and their hands) that
 * didn't, played before pot types were kept. */
export function potTotals(sessions: readonly SessionRecord[]): { rows: (PotTally & { pot: string })[]; without: number; withoutHands: number } {
  const m = new Map<string, PotTally>();
  let without = 0, withoutHands = 0;
  for (const s of sessions) {
    if (s.kind !== "practice") continue;
    const byPot = obj(s.meta?.byPot);
    if (!byPot) {
      if (num(s.meta?.hands)) {
        without++;
        withoutHands += num(s.meta?.hands);
      }
      continue;
    }
    for (const [pot, raw] of Object.entries(byPot)) {
      const x = obj(raw);
      if (!x) continue;
      const t = m.get(pot) ?? emptyTally();
      m.set(pot, {
        hands: t.hands + num(x.hands),
        n: t.n + num(x.n),
        ok: t.ok + num(x.ok),
        ne: t.ne + num(x.ne),
        loss: t.loss + num(x.loss),
        lossPct: t.lossPct + num(x.lossPct),
        played: t.played + num(x.played),
        net: round2(t.net + num(x.net)),
      });
    }
  }
  const rank = (p: string) => (POT_ORDER.includes(p) ? POT_ORDER.indexOf(p) : POT_ORDER.length);
  const rows = [...m].map(([pot, t]) => ({ pot, ...t })).sort((a, b) => rank(a.pot) - rank(b.pot) || a.pot.localeCompare(b.pot));
  return { rows, without, withoutHands };
}

const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

/** Rows grouped by the local day they started, newest day first, each day's newest first. */
export function byDay(rows: readonly SessionRow[]): { key: string; label: string; rows: SessionRow[] }[] {
  const out: { key: string; label: string; rows: SessionRow[] }[] = [];
  for (const r of [...rows].sort((a, b) => b.at - a.at)) {
    const key = dayKey(r.at);
    let g = out.at(-1);
    if (!g || g.key !== key) {
      g = { key, label: new Date(r.at).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" }), rows: [] };
      out.push(g);
    }
    g.rows.push(r);
  }
  return out;
}
