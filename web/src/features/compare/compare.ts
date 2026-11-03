// Two Study answers side by side (ROADMAP Phase 8): what differs between the two spots, the actions' frequencies and
// EVs, the range's totals, and per hand class the change in one action's frequency and in the class's EV. Each side
// keeps its own provenance; when the two come from different sources, or either is approximate, the diff says so
// first (a difference can be the source's, not the spot's). An EV difference within the two sides' distance from
// equilibrium combined is marked as noise. Side A is the spot as it was; B the variant (B − A everywhere).
import { describeSetup } from "@/features/solve/setup";
import { describeLine, toSearch, type StudyHand } from "@/features/study/studyState";
import { sourceLabel } from "@/solver/provenance";
import type { AdvisorActionStat, AdvisorResponse, GridCell } from "@/solver/protocol";
import type { Provenance } from "@/solver/types";

/** A link to the Compare page: spot A (as it is) against spot B (the variant). */
export const compareLink = (a: StudyHand, b: StudyHand) => `/compare?${new URLSearchParams({ a: toSearch(a), b: toSearch(b) })}`;

export interface ActionDiff {
  action: string;
  a?: AdvisorActionStat;
  b?: AdvisorActionStat;
  /** B − A, share of the range (an action one side doesn't offer counts as 0 there) */
  dFreq: number;
  /** B − A, bb; null where either side has no EV for it */
  dEv: number | null;
}

/** Every action either side offers (A's order, then B's own), with the change in frequency and EV. */
export function diffActions(a: AdvisorResponse, b: AdvisorResponse): ActionDiff[] {
  const names = [...new Set([...(a.actions ?? []), ...(b.actions ?? [])].map((x) => x.action))];
  return names.map((action) => {
    const x = a.actions?.find((s) => s.action === action);
    const y = b.actions?.find((s) => s.action === action);
    const ev = (s: AdvisorActionStat | undefined) => (typeof s?.ev_bb === "number" ? s.ev_bb : null);
    const ea = ev(x), eb = ev(y);
    return { action, a: x, b: y, dFreq: (y?.freq ?? 0) - (x?.freq ?? 0), dEv: ea !== null && eb !== null ? eb - ea : null };
  });
}

export interface Totals {
  combos: [number | null, number | null];
  ev: [number | null, number | null];
  eq: [number | null, number | null];
}

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** The range's combos, EV and equity on each side (null where a side has none). */
export const totalsOf = (a: AdvisorResponse, b: AdvisorResponse): Totals => ({
  combos: [num(a.range_combos), num(b.range_combos)],
  ev: [num(a.range_ev_bb), num(b.range_ev_bb)],
  eq: [num(a.range_eq), num(b.range_eq)],
});

export interface ClassDiff {
  cls: string;
  /** the class's weight in each range (0: not in it) */
  wa: number;
  wb: number;
  /** the action's frequency within the class on each side; null where the class isn't in that range */
  fa: number | null;
  fb: number | null;
  /** B − A where the class is in both ranges, else null */
  dFreq: number | null;
  /** the class's EV (its mix's) on each side, and B − A */
  eva: number | null;
  evb: number | null;
  dEv: number | null;
}

const freqOf = (res: AdvisorResponse, cell: GridCell | undefined, action: string): number | null => {
  if (!cell || !(cell.w > 0)) return null;
  const i = res.grid?.actions.indexOf(action) ?? -1;
  // (an action this side doesn't offer: the class never takes it)
  return i < 0 ? 0 : (cell.f[i] ?? 0);
};

/** Per hand class, the change in `action`'s frequency and in the class's EV. */
export function diffClasses(a: AdvisorResponse, b: AdvisorResponse, action: string): ClassDiff[] {
  const ca = a.grid?.cells ?? {}, cb = b.grid?.cells ?? {};
  const classes = [...new Set([...Object.keys(ca), ...Object.keys(cb)])];
  return classes.map((cls) => {
    const x = ca[cls], y = cb[cls];
    const fa = freqOf(a, x, action), fb = freqOf(b, y, action);
    const eva = x && x.w > 0 ? num(x.evm) : null, evb = y && y.w > 0 ? num(y.evm) : null;
    return {
      cls,
      wa: x?.w ?? 0,
      wb: y?.w ?? 0,
      fa,
      fb,
      dFreq: fa !== null && fb !== null ? fb - fa : null,
      eva,
      evb,
      dEv: eva !== null && evb !== null ? evb - eva : null,
    };
  });
}

/** The classes whose frequency of the action changed most (in both ranges, by at least `min`), biggest first. */
export function biggest(diffs: ClassDiff[], n = 10, min = 0.005): ClassDiff[] {
  return diffs
    .filter((d) => d.dFreq !== null && Math.abs(d.dFreq) >= min)
    .sort((x, y) => Math.abs(y.dFreq!) - Math.abs(x.dFreq!) || Math.min(y.wa, y.wb) - Math.min(x.wa, x.wb))
    .slice(0, n);
}

/** EV differences smaller than this (bb) are within the two sides' distance from equilibrium combined: noise.
 * Null where either side has no measured distance (charts, rules, an answer read at once). */
export function noiseBb(pa: Provenance, pb: Provenance, potBb: number | undefined): number | null {
  if (pa.exploitabilityPct === undefined || pb.exploitabilityPct === undefined || !potBb) return null;
  return ((pa.exploitabilityPct + pb.exploitabilityPct) / 100) * potBb;
}

/** What to say before any difference: the two sides come from different sources, or either is approximate. */
export function sourceWarning(pa: Provenance, pb: Provenance, bySource = false): string | null {
  if (pa.source !== pb.source && bySource) {
    // (the charts against the preflop solve: the sources are what's compared)
    const approx = ([["A", pa], ["B", pb]] as const).filter(([, p]) => p.approximate).map(([n, p]) => `${n} (${sourceLabel(p.source)})`);
    return `The two sides are two sources of the same spot (A: ${sourceLabel(pa.source)}; B: ${sourceLabel(pb.source)}): the differences are theirs, not the spot's.${
      approx.length ? ` ${approx.join(" and ")} ${approx.length > 1 ? "are" : "is"} approximate: read small differences as noise.` : ""
    }`;
  }
  if (pa.source !== pb.source)
    return `The two sides come from different sources (A: ${sourceLabel(pa.source)}; B: ${sourceLabel(pb.source)}), so a difference can be the source's, not the spot's.`;
  const approx = [pa.approximate && "A", pb.approximate && "B"].filter(Boolean);
  if (approx.length) return `${approx.join(" and ")} ${approx.length > 1 ? "are" : "is"} approximate (${sourceLabel(pa.source)}): read small differences as noise.`;
  return null;
}

/** The two answers aren't the same player at the same street: said, and compared all the same. */
export function nodeWarning(a: AdvisorResponse, b: AdvisorResponse): string | null {
  if (a.actor === b.actor && a.street === b.street) return null;
  return `The two answers are for different spots (A: ${a.actor ?? "?"} on the ${a.street ?? "?"}; B: ${b.actor ?? "?"} on the ${b.street ?? "?"}); their hand classes are compared all the same.`;
}

/** Preflop's source for a preflop spot ("the charts", "the preflop solve"); null after the flop, where it isn't asked. */
export const pfSourceOf = (h: StudyHand): string | null => (h.board ? null : h.pf === "solver" ? "the preflop solve" : "the charts");

/** How spot B differs from spot A, in words ("stack 100bb → 50bb", "B drops: rake 5%"). */
export function whatDiffers(a: StudyHand, b: StudyHand): string[] {
  const out: string[] = [];
  if (a.players !== b.players) out.push(`players ${a.players} → ${b.players}`);
  if (a.stack !== b.stack) out.push(`stack ${a.stack}bb → ${b.stack}bb`);
  const la = describeLine(a).join(" "), lb = describeLine(b).join(" ");
  if (la !== lb) out.push(`line ${la || "(the start)"} → ${lb || "(the start)"}`);
  const pfA = pfSourceOf(a), pfB = pfSourceOf(b);
  if (pfA && pfB && pfA !== pfB) out.push(`preflop source ${pfA} → ${pfB}`);
  const sa = describeSetup(a.setup), sb = describeSetup(b.setup);
  const drops = sa.filter((x) => !sb.includes(x)), adds = sb.filter((x) => !sa.includes(x));
  if (drops.length) out.push(`B drops: ${drops.join(" · ")}`);
  if (adds.length) out.push(`B adds: ${adds.join(" · ")}`);
  return out;
}
