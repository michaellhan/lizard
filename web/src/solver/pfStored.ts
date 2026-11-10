// The preflop games the worker answers from a stored solve, as the page needs to know them before it asks: upstream's two
// (6-max 100bb, no rake or 5% capped at 3bb; solver/gto/pf_study.py STORED) and Lizard's grid around them
// (engine/pf_stored.py, built by scripts/pf/build_stored.py into engine/pf/). Every one is the same class-level model and
// solve; pfStored.test.ts holds this list to engine/pf_stored.py and to the files.

export const PF_PLAYERS = [2, 3, 4, 5, 6] as const;
export const PF_DEPTHS = [20, 25, 30, 40, 50, 60, 80, 100, 125, 150, 200] as const;
/** The one rake stored beside no rake. */
export const PF_STORED_RAKE = { pct: 5, cap: 3 };

/** The stored file's key (pf_study.Spec.key), with a 5%-capped-at-3bb rake or none. */
export const pfKey = (players: number, stack: number, raked: boolean) => `${players}max_${stack}bb${raked ? `_r${PF_STORED_RAKE.pct}c${PF_STORED_RAKE.cap}` : ""}`;

/** Every stored game's key. */
export const PF_KEYS: readonly string[] = PF_PLAYERS.flatMap((n) => PF_DEPTHS.flatMap((d) => [pfKey(n, d, false), pfKey(n, d, true)]));

/** The stored depths in words: "20, 25, 30, … or 200bb". */
export const PF_DEPTHS_WORDS = `${PF_DEPTHS.slice(0, -1).join(", ")} or ${PF_DEPTHS.at(-1)}bb`;

/** The stored game nearest a stack, for a refusal to name. */
export const nearestDepth = (stack: number) => PF_DEPTHS.reduce((a, b) => (Math.abs(b - stack) < Math.abs(a - stack) ? b : a));
