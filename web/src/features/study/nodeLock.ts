// Study's true node lock (engine/study_lock.py), as distinct from the read in locks.ts: the node on screen held at a mix
// and the rest of the street and below re-solved. Here is what the panel works out without the solver: whether this
// node can be locked, the mix and scope as typed, and the result in words.
import { ALL_CLASSES, expandClass } from "@/engine/nlhe/cards";
import { bandOf } from "@/solver/provenance";
import type { AdvisorResponse, NodeLockBlock, NodeLockChange, NodeLockRequest } from "@/solver/protocol";
import type { Provenance, SolveMode } from "@/solver/types";

/** Whom a lock holds: every hand in the range, some hand classes, or one combo. Either way each hand held plays the mix
 * itself: it isn't the range's average. */
export type LockScope = { kind: "range" } | { kind: "classes"; text: string } | { kind: "combo"; combo: string | null };

/** Why this Study answer's node can't be locked, in words for before any solve; null where it can. */
export function nodeLockRefusal(res: AdvisorResponse, tournament: boolean): string | null {
  if (res.street === "preflop") return "Node locking is postflop: preflop is the charts or a separate solve, not this tree.";
  if (res.multiway) return `Node locking is heads-up: this pot has ${typeof res.players === "number" && res.players > 2 ? `${res.players} players` : "more than two players"} in it.`;
  if (tournament) return "Node locking is for cash games: a tournament's payoffs aren't zero-sum, and a lock hasn't been checked on them.";
  if (res.fallback) return "No solve answers this node (the betting rules do), so there's no tree to lock.";
  if (!res.actor || !res.actions?.length) return "Nobody acts here: there's no decision to lock.";
  return null;
}

/** The node's actions, as the engine names them. */
export const nodeActions = (res: AdvisorResponse): string[] => (res.actions ?? []).map((a) => a.action);

/** The range's own frequencies, in percent to one place, to start from. */
export function startingMix(res: AdvisorResponse): Record<string, string> {
  const rows = (res.actions ?? []).map((a) => ({ action: a.action, tenths: Math.round((a.freq ?? 0) * 1000) }));
  const top = rows.reduce((m, r, i) => (r.tenths > rows[m]!.tenths ? i : m), 0);
  if (rows.length) rows[top]!.tenths += 1000 - rows.reduce((t, r) => t + r.tenths, 0);
  return Object.fromEntries(rows.map((r) => [r.action, (r.tenths / 10).toString()]));
}

/** The mix as typed, in percent, a blank being 0: as frequencies summing to 1, or what's wrong with it. */
export function mixOf(typed: Record<string, string>, actions: readonly string[]): { mix: Record<string, number> | null; problems: string[] } {
  const problems: string[] = [];
  const nums = actions.map((a) => {
    const t = (typed[a] ?? "").trim();
    const n = t === "" ? 0 : Number(t);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      problems.push(`${a} must be 0 to 100`);
      return 0;
    }
    return n;
  });
  const total = nums.reduce((t, n) => t + n, 0);
  if (!problems.length && Math.abs(total - 100) > 0.05) problems.push(`The mix adds up to ${Number(total.toFixed(1))}%: it has to be 100%`);
  if (problems.length) return { mix: null, problems };
  return { mix: Object.fromEntries(actions.map((a, i) => [a, nums[i]! / total])), problems };
}

const inRange = (res: AdvisorResponse, cls: string) => (res.grid?.cells[cls]?.w ?? 0) > 0;
const isClass = (c: string) => ALL_CLASSES.includes(c) || (/^[AKQJT2-9]{2}$/.test(c) && c[0] !== c[1] && ALL_CLASSES.includes(`${c}s`));

/** The engine's `hands` for a scope, or what's wrong with it. A hand outside the range would change nothing, so it's
 * stopped here, before a solve. */
export function handsOf(scope: LockScope, res: AdvisorResponse): { hands: NodeLockRequest["hands"] | null; problems: string[] } {
  if (scope.kind === "range") return { hands: "all", problems: [] };
  const seat = res.actor ?? "This seat";
  if (scope.kind === "combo") {
    if (!scope.combo) return { hands: null, problems: [`${seat} has no hand to pick: select a class in the grid`] };
    return { hands: { combos: [scope.combo] }, problems: [] };
  }
  const classes = scope.text.split(/[\s,]+/).filter(Boolean);
  if (!classes.length) return { hands: null, problems: ["Name a hand class, like AKs or QQ"] };
  const problems: string[] = [];
  for (const c of classes) {
    if (!isClass(c)) problems.push(`${c} isn't a hand class`);
    else if (![c, `${c}s`, `${c}o`].some((x) => inRange(res, x))) problems.push(`${c} isn't in ${seat}'s range here`);
  }
  return problems.length ? { hands: null, problems } : { hands: { classes }, problems };
}

/** How many combos a hand-scoped lock names, for the sentence under the form: the board's cards aren't anyone's. */
export function combosNamed(scope: LockScope, board = ""): number | null {
  if (scope.kind === "combo") return scope.combo ? 1 : null;
  if (scope.kind === "range") return null;
  const classes = scope.text.split(/[\s,]+/).filter((c) => ALL_CLASSES.includes(c));
  const blocked = (combo: string) => [combo.slice(0, 2), combo.slice(2)].some((card) => board.includes(card));
  return new Set(classes.flatMap((c) => expandClass(c)).filter((c) => !blocked(c))).size || null;
}

/** What a scope means on this street's tree, said before a solve: every hand has its own strategy at the node on screen
 * in both modes, so nothing refuses a hand here; what differs is what's below it. */
export function scopeNote(street: AdvisorResponse["street"], scope: LockScope): string | null {
  if (scope.kind === "range") return null;
  if (street === "turn") return "Rivers by card class: marked approximate.";
  if (street === "flop") return "Hands share buckets from the turn on.";
  return null;
}

/** What a lock asks of the device, where that's more than a Study answer does: the locked solve runs beside the unlocked
 * one, which stays in memory to be compared. An estimate: docs/ACCURACY.md section 16 has what's been measured. */
export const memoryNote = (street: AdvisorResponse["street"], mode: SolveMode): string | null =>
  street === "flop" && mode === "accurate"
    ? "Accurate on a flop needs about 1.2 GB; a phone may not cope. Fast uses less."
    : null;

/** Each seat's value in both solves, the player acting first. */
export function valueRows(n: NodeLockBlock): { seat: string; unlocked: number; locked: number; change: number }[] {
  return [n.player, 1 - n.player].map((p) => ({
    seat: n.seats[p]!,
    unlocked: n.unlocked.value[p]!,
    locked: n.locked.value[p]!,
    change: n.locked.value[p]! - n.unlocked.value[p]!,
  }));
}

/** A decision's mix in both solves, per action. */
export function actionRows(c: NodeLockChange): { action: string; unlocked: number | null; locked: number | null; change: number | null }[] {
  return c.actions.map((action, i) => {
    const unlocked = c.unlocked?.[i] ?? null;
    const locked = c.locked?.[i] ?? null;
    return { action, unlocked, locked, change: unlocked !== null && locked !== null ? locked - unlocked : null };
  });
}

/** `lock_cost` in words, for the player who's held: what it is, and what it isn't. */
export function costWords(n: NodeLockBlock): string {
  const me = n.seats[n.player], them = n.seats[1 - n.player];
  const cost = n.locked.lock_cost[n.player];
  const first = cost < 0.005 ? `Dropping the lock wins ${me} nothing against ${them} as ${them} now plays.` : `Dropping the lock would win ${me} ${cost.toFixed(2)} bb more against ${them} as ${them} now plays.`;
  const open = n.untrained ? ` An action is left unplayed, so ${them} never trained an answer to it: this can overstate the cost.` : "";
  return `${first}${open}`;
}

/** The exploitability, on the engine's definition, beside the unlocked solve's on the same one. */
export const exploitWords = (n: NodeLockBlock): string =>
  `${Math.max(n.locked.exploitability_pct, 0).toFixed(3)}% of the pot in the restricted game (unlocked: ${Math.max(n.unlocked.exploitability_pct, 0).toFixed(3)}%).`;

/** The unlocked column's own provenance: the live solve the lock was set against, in this tree. */
export function unlockedProvenance(locked: Provenance, n: NodeLockBlock): Provenance {
  const off = Math.max(n.unlocked.exploitability_pct, 0);
  const p: Provenance = { ...locked, source: "live", approximate: false, exploitabilityPct: off, band: bandOf(off), iterations: n.unlocked.iterations };
  delete p.lock;
  delete p.view;
  delete p.approximateLabel;
  delete p.targetPct;
  return p;
}

