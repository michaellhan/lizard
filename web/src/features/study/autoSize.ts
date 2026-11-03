// Automatic sizing (ROADMAP Phase 6): the engine's optimize_sizes (advisor.py _optimize_sizes) with one hand's advice,
// since Study drops it (STUDY_DROPS). The street is solved once over a wide menu (OPT_SIZES, 25–200% of the pot, with
// the spot's own sizes for the street among them), one street deep with one raise; the sizes either player's first bet
// uses with OPT_KEEP (3%) of their range are kept, the MAX_SIZES (3) most used; and the advice is solved again with
// them. The two solves share one solve's time. Offered where a node lock is (heads-up, after the flop) and the player to
// act can bet: the engine chooses sizes only there.
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import { handRequest, offersLock } from "./locks";

export const OPT_KEEP = 0.03;

export const offersAutoSize = (r: AdvisorResponse): boolean => offersLock(r) && (r.actions ?? []).some((a) => a.action === "check");

export const autoSizeRequest = (study: AdvisorState, hero: string, hole: string): AdvisorState => ({ ...handRequest(study, hero, hole), optimize_sizes: true });

export interface SizeUse {
  /** "33%", or "all-in" */
  size: string;
  /** the share of the range of the player to act betting it, at their first bet this street, in the first solve */
  use: number;
  kept: boolean;
}

/** The first solve's menu ("size_usage": the player to act's mix there, check first) and the sizes kept, the street's
 * own sizes among them ("sizes_custom"); null where the engine kept the street's menu (its note says why). */
export function usageOf(r: AdvisorResponse): { check: number | null; rows: SizeUse[]; kept: string[]; custom: string[] } | null {
  const u = r.size_usage, kept = r.sizes_kept;
  if (!u || typeof u !== "object" || !Array.isArray(kept)) return null;
  const use = u as Record<string, number>, ks = kept as string[];
  return {
    check: typeof use.check === "number" ? use.check : null,
    rows: Object.entries(use)
      .filter(([k]) => k !== "check")
      .map(([size, x]) => ({ size, use: x, kept: ks.includes(size) })),
    kept: ks,
    custom: Array.isArray(r.sizes_custom) ? (r.sizes_custom as string[]) : [],
  };
}

/** The kept sizes as the setup's bet menu (% of the pot), or null where the all-in was kept (no % the setup takes). */
export const keptMenu = (kept: string[]): number[] | null => (kept.length && kept.every((k) => /^\d+%$/.test(k)) ? kept.map((k) => parseFloat(k)) : null);
