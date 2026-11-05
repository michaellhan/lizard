// The hand-category filter: the actor's hands of one made-hand or draw category, with the grid, the range's totals
// and the combos over those hands alone. Ported from upstream study.js (catsOf, filterRes). A combo row is
// [cards, reach, mix, EVs, equity, made, draw]; the last two index into the answer's `categories` (breakdown.py
// MADE / DRAWS). A filter's key is "m:<id>" or "d:<id>".
import { classCombos } from "@/engine/nlhe/cards";
import type { AdvisorActionStat, AdvisorResponse, ComboRow, GridCell } from "@/solver/protocol";

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

export interface FilterInfo {
  key: string;
  label: string;
  /** the whole range's combos */
  of: number | undefined;
}

export type FilteredResponse = AdvisorResponse & { filter?: FilterInfo };

/** The answer over one category's hands; the answer itself when the key is not one of this node's (draws on the
 * river, or no key). An answer at once has no combo EVs: then no EVs are made up for the filtered view either. */
export function filterRes(res: AdvisorResponse, key: string | null | undefined): FilteredResponse {
  const cat = key ? catsOf(res).find((c) => c.key === key) : undefined;
  if (!cat || !res.grid) return res;
  const col = cat.part === "m" ? 5 : 6;
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
    const rows = rowsAll.filter((x) => x[col] === cat.i);
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
    filter: { key: cat.key, label: cat.label, of: res.range_combos },
  };
}
