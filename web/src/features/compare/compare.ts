// Two Study answers side by side (ROADMAP Phase 8): what differs between the two spots, the actions' frequencies and
// EVs, the range's totals, and per hand class the change in one action's frequency and in the class's EV. Each side
// keeps its own provenance; when the two come from different sources, or either is approximate, the diff says so
// first (a difference can be the source's, not the spot's). An EV difference within the two sides' distance from
// equilibrium combined is marked as noise. Side A is the spot as it was; B the variant (B − A everywhere). Two spots
// that differ only in their bet or raise sizes are two size menus: their bets don't share names, so they're compared
// as any bet or raise, and by what the menu is worth to the player to act (the range's EV).
import { kindOf } from "@/components/actions";
import { describeSetup, tidySetup } from "@/features/solve/setup";
import { describePfSizes } from "@/features/study/pfSizes";
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

/** Every bet and raise, all-in too, whatever its size (two size menus' bets don't share names). */
export const ANY_RAISE = "any bet or raise";
export const isRaise = (action: string) => ["bet", "raise", "all-in"].includes(kindOf(action));

const freqOf = (res: AdvisorResponse, cell: GridCell | undefined, action: string): number | null => {
  if (!cell || !(cell.w > 0)) return null;
  if (action === ANY_RAISE) return (res.grid?.actions ?? []).reduce((t, a, i) => t + (isRaise(a) ? (cell.f[i] ?? 0) : 0), 0);
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
  // (the solve's sizes, where both sides are the solve: the charts play their own)
  const szA = describePfSizes(a.pfSizes) || "the default sizes", szB = describePfSizes(b.pfSizes) || "the default sizes";
  if (pfA === "the preflop solve" && pfB === pfA && szA !== szB) out.push(`the solve's sizes ${szA} → ${szB}`);
  const sa = describeSetup(a.setup), sb = describeSetup(b.setup);
  const drops = sa.filter((x) => !sb.includes(x)), adds = sb.filter((x) => !sa.includes(x));
  if (drops.length) out.push(`B drops: ${drops.join(" · ")}`);
  if (adds.length) out.push(`B adds: ${adds.join(" · ")}`);
  return out;
}

const sizesOf = (h: StudyHand) => JSON.stringify(tidySetup(h.setup)?.sizes ?? {});
const withoutSizes = (h: StudyHand) => toSearch({ ...h, setup: { ...h.setup, sizes: undefined } });

/** The two spots differ in their size menus and nothing else. */
export const sizesOnly = (a: StudyHand, b: StudyHand): boolean => sizesOf(a) !== sizesOf(b) && withoutSizes(a) === withoutSizes(b);

export interface MenuSide {
  /** the bets and raises offered at this decision, as the answer names them */
  sizes: string[];
  /** share of the range betting or raising, any size */
  raise: number;
  /** the range's EV here, bb (null: none) */
  ev: number | null;
}

export interface Menus {
  a: MenuSide;
  b: MenuSide;
  /** B − A: the range's EV (bb, and a share of the pot), and the share betting or raising */
  dEv: number | null;
  dPot: number | null;
  dRaise: number;
  /** both answers' distance from equilibrium combined, bb (null: not measured on both sides), and whether the EV
   * change is within it */
  band: number | null;
  noise: boolean | null;
}

const sideOf = (r: AdvisorResponse): MenuSide => {
  const acts = r.actions ?? [];
  return { sizes: acts.filter((x) => isRaise(x.action)).map((x) => x.action), raise: acts.reduce((t, x) => t + (isRaise(x.action) ? (x.freq ?? 0) : 0), 0), ev: num(r.range_ev_bb) };
};

/** Two size menus at one decision: what each offers, how much of the range bets or raises with it, and what it's worth. */
export function menusOf(a: AdvisorResponse, b: AdvisorResponse, pa: Provenance, pb: Provenance): Menus {
  const A = sideOf(a), B = sideOf(b);
  const dEv = A.ev !== null && B.ev !== null ? B.ev - A.ev : null;
  const pot = num(a.pot_bb);
  const band = noiseBb(pa, pb, a.pot_bb);
  return { a: A, b: B, dEv, dPot: dEv !== null && pot ? dEv / pot : null, dRaise: B.raise - A.raise, band, noise: dEv === null || band === null ? null : Math.abs(dEv) < band };
}

const bbOf = (x: number) => `${x.toFixed(Math.abs(x) < 0.01 ? 3 : 2)}bb`;

/** Which menu is worth more to the player to act, in words: within the two answers' distance from equilibrium combined
 * neither; under twice it, close to a tie; unmeasured, said. Then how much more or less of the range bets. */
export function menuWords(m: Menus, actor: string, pot: number | undefined): string {
  const raise = `B bets or raises ${Math.abs(m.dRaise * 100).toFixed(1)} points ${m.dRaise >= 0 ? "more" : "less"} of the range.`;
  if (m.dEv === null) return `No EV on both sides, so neither menu can be said to be worth more. ${raise}`;
  const d = m.dEv;
  if (m.noise) return `B − A: ${d >= 0 ? "+" : "−"}${bbOf(Math.abs(d))}, within the two answers' distance from equilibrium combined (${bbOf(m.band!)}): neither menu is measurably worth more to ${actor} here. ${raise}`;
  const worth = `${d >= 0 ? "B's" : "A's"} menu is worth ${bbOf(Math.abs(d))} more to ${actor} here${m.dPot !== null && pot ? ` (${(Math.abs(m.dPot) * 100).toFixed(1)}% of the ${pot.toFixed(1)}bb pot)` : ""}`;
  if (m.band === null) return `${worth}, though no distance from equilibrium is measured on both sides to tell that from noise. ${raise}`;
  if (Math.abs(d) < 2 * m.band) return `${worth}, under twice the two answers' distance from equilibrium combined (${bbOf(m.band)}): close to a tie. ${raise}`;
  return `${worth}, beyond the two answers' distance from equilibrium combined (${bbOf(m.band)}). ${raise}`;
}
