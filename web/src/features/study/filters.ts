// The hand-category filter: the actor's hands of one made-hand or draw category, with the grid, the range's totals
// and the combos over those hands alone. Ported from upstream study.js (catsOf, filterRes). A combo row is
// [cards, reach, mix, EVs, equity, made, draw]; the last two index into the answer's `categories` (breakdown.py
// MADE / DRAWS). A filter's key is "m:<id>" or "d:<id>", or "q:<lowest %>" for an equity bucket over the same rows.
import { classCombos } from "@/engine/nlhe/cards";
import { comboName } from "@/features/ranges/rangeText";
import type { AdvisorActionStat, AdvisorResponse, ComboRow, GridCell } from "@/solver/protocol";

/** The equity buckets' bounds, as shares: a hand's equity against the opponent's whole range at the node. */
export const EQUITY_BUCKETS = [0, 0.25, 0.5, 0.75, 1] as const;

export interface EquityBucket {
  key: string;
  label: string;
  lo: number;
  hi: number;
  /** combos of the range in it (reach-weighted) */
  combos: number;
}

const inBucket = (e: number | null | undefined, lo: number, hi: number) => e != null && e >= lo && (hi >= 1 ? e <= 1 : e < hi);

/** The buckets the actor's range has hands in (at least a twentieth of a combo); none where the answer holds no
 * equities. A hand with none of its own is in no bucket. */
export function equityBuckets(res: AdvisorResponse | undefined): EquityBucket[] {
  const rows = Object.values(res?.combos ?? {}).flat();
  const out: EquityBucket[] = [];
  for (let i = 0; i + 1 < EQUITY_BUCKETS.length; i++) {
    const [lo, hi] = [EQUITY_BUCKETS[i]!, EQUITY_BUCKETS[i + 1]!];
    const combos = rows.reduce((t, x) => t + (inBucket(x[4], lo, hi) ? x[1] : 0), 0);
    if (combos >= 0.05) out.push({ key: `q:${lo * 100}`, label: `${lo * 100}\u2013${hi * 100}% equity`, lo, hi, combos });
  }
  return out;
}

export interface HandCategory {
  key: string;
  part: "m" | "d";
  /** index into categories.made / categories.draws */
  i: number;
  label: string;
  /** combos of the range in it (reach-weighted) */
  combos: number;
}

/** The categories the actor's range holds (at least a twentieth of a combo), "No draw" left out. */
export function catsOf(res: AdvisorResponse | undefined): HandCategory[] {
  const cats = res?.categories;
  if (!cats) return [];
  const tot = { m: new Map<number, number>(), d: new Map<number, number>() };
  for (const rows of Object.values(res.combos ?? {}))
    for (const x of rows) {
      tot.m.set(x[5], (tot.m.get(x[5]) ?? 0) + x[1]);
      tot.d.set(x[6], (tot.d.get(x[6]) ?? 0) + x[1]);
    }
  const out: HandCategory[] = [];
  for (const [part, list] of [
    ["m", cats.made ?? []],
    ["d", cats.draws ?? []],
  ] as const)
    list.forEach(([id, label], i) => {
      const c = tot[part].get(i) ?? 0;
      if (c >= 0.05 && id !== "none") out.push({ key: `${part}:${id}`, part, i, label, combos: c });
    });
  return out;
}

/** The hand classes mostly in a category: at least half of each one's combos in the range (by reach) are in it. A
 * group goes by whole classes, so this is what the range builder paints for a category (BuildMode). */
export function classesIn(res: AdvisorResponse, key: string): string[] {
  const cat = catsOf(res).find((c) => c.key === key);
  if (!cat) return [];
  const col = cat.part === "m" ? 5 : 6;
  const out: string[] = [];
  for (const [cls, rows] of Object.entries(res.combos ?? {})) {
    let w = 0;
    let inCat = 0;
    for (const x of rows) {
      w += x[1];
      if (x[col] === cat.i) inCat += x[1];
    }
    if (w > 0 && inCat >= w / 2 - 1e-9) out.push(cls);
  }
  return out;
}

/** The combos in a category, each by its class and name (`comboName`): every combo of the range (reach above nothing)
 * whose own row is in it, whatever its class's other combos are. What the range builder paints for a category by combo. */
export function combosIn(res: AdvisorResponse, key: string): { cls: string; combo: string }[] {
  const cat = catsOf(res).find((c) => c.key === key);
  if (!cat) return [];
  const col = cat.part === "m" ? 5 : 6;
  const out: { cls: string; combo: string }[] = [];
  for (const [cls, rows] of Object.entries(res.combos ?? {})) for (const x of rows) if (x[1] > 0 && x[col] === cat.i) out.push({ cls, combo: comboName(x[0]) });
  return out;
}

export interface FilterInfo {
  key: string;
  label: string;
  /** the whole range's combos */
  of: number | undefined;
}

export type FilteredResponse = AdvisorResponse & { filter?: FilterInfo };

/** Under numbers that a filter has narrowed, which read as the whole node's otherwise. */
export const filterWords = (f: Pick<FilterInfo, "label">) => `These numbers are over ${f.label} alone, not the whole range.`;

/** The answer over one category's hands; the answer itself when the key is not one of this node's (draws on the
 * river, or no key). An answer at once has no combo EVs: then no EVs are made up for the filtered view either. */
export function filterRes(res: AdvisorResponse, key: string | null | undefined): FilteredResponse {
  const cat = key ? catsOf(res).find((c) => c.key === key) : undefined;
  const bucket = key ? equityBuckets(res).find((b) => b.key === key) : undefined;
  if ((!cat && !bucket) || !res.grid) return res;
  const keep = cat ? (x: ComboRow) => x[cat.part === "m" ? 5 : 6] === cat.i : (x: ComboRow) => inBucket(x[4], bucket!.lo, bucket!.hi);
  const A = res.grid.actions.length;
  const zero = () => new Array<number>(A).fill(0);
  const all = Object.values(res.combos ?? {});
  const noEv = all.some((rows) => rows.some((x) => !x[3]));
  const cells: Record<string, GridCell> = {};
  const combos: Record<string, ComboRow[]> = {};
  const fw = zero();
  const fe = zero();
  let W = 0;
  let EV = 0;
  let EQ = 0;
  let EQW = 0;
  for (const [cls, rowsAll] of Object.entries(res.combos ?? {})) {
    const rows = rowsAll.filter(keep);
    if (!rows.length) continue;
    combos[cls] = rows;
    const f = zero();
    const ev = zero();
    let w = 0;
    let evm = 0;
    let eq = 0;
    let ew = 0;
    for (const x of rows) {
      w += x[1];
      for (let a = 0; a < A; a++) {
        f[a]! += x[1] * (x[2][a] ?? 0);
        const evs = x[3];
        if (evs) {
          ev[a]! += x[1] * (evs[a] ?? 0);
          evm += x[1] * (x[2][a] ?? 0) * (evs[a] ?? 0);
          fe[a]! += x[1] * (x[2][a] ?? 0) * (evs[a] ?? 0);
        }
      }
      if (x[4] != null) {
        eq += x[1] * x[4];
        ew += x[1];
      }
    }
    f.forEach((v, a) => {
      fw[a]! += v;
    });
    cells[cls] = {
      w: w / classCombos(cls),
      f: f.map((v) => v / w),
      ev: noEv ? null : ev.map((v) => v / w),
      evm: noEv ? null : evm / w,
      eq: ew ? eq / ew : null,
    };
    W += w;
    EV += evm;
    EQ += eq;
    EQW += ew;
  }
  const actions: AdvisorActionStat[] = (res.actions ?? []).map((a, i) => ({
    ...a,
    freq: W ? fw[i]! / W : 0,
    combos: fw[i]!,
    // (none for an action under a twentieth of a combo, as the Advisor's own range EVs)
    ev_bb: !noEv && fw[i]! >= 0.05 ? fe[i]! / fw[i]! : null,
  }));
  return {
    ...res,
    grid: { ...res.grid, cells },
    combos,
    actions,
    range_combos: W,
    range_ev_bb: W && !noEv ? EV / W : null,
    range_eq: EQW ? EQ / EQW : null,
    filter: { key: (cat ?? bucket)!.key, label: (cat ?? bucket)!.label, of: res.range_combos },
  };
}
