// Node locks kept to hold beside the next one (engine/study_lock.py `also`): Study's node lock holds the node on screen,
// and a lock kept from an answer is sent with every lock asked afterwards on the same street of the same board, until
// it's dropped. The engine lays a kept lock only on the very solve it was made on (its `root` digest) and refuses it in
// words anywhere else, so nothing here decides which node a kept line names. Kept for this tab only, in memory: a
// solve's digest means nothing after the worker's gone.
import { create } from "zustand";
import type { KeptLock, NodeLockBlock } from "@/solver/protocol";

export interface Kept extends KeptLock {
  seat: string;
  /** the lock in words, as its answer said it */
  words: string;
  street: string;
  board: string;
}

interface KeptState {
  kept: Kept[];
  keep: (k: Kept) => void;
  drop: (k: Kept) => void;
  clear: () => void;
}

export const sameLock = (a: Pick<KeptLock, "root" | "line">, b: Pick<KeptLock, "root" | "line">) => a.root === b.root && a.line.join(">") === b.line.join(">");

export const useKeptLocks = create<KeptState>((set) => ({
  kept: [],
  // (a node kept again replaces its earlier mix: the engine refuses two locks at one node)
  keep: (k) => set((s) => ({ kept: [...s.kept.filter((x) => !sameLock(x, k)), k] })),
  drop: (k) => set((s) => ({ kept: s.kept.filter((x) => !sameLock(x, k)) })),
  clear: () => set({ kept: [] }),
}));

/** An answer's own lock, to keep. Null for an answer with no solve digest (a worker from before locks were kept). */
export function keptOf(n: NodeLockBlock, street: string, board: string): Kept | null {
  if (!n.root) return null;
  return {
    root: n.root,
    line: n.line,
    player: n.player,
    mix: Object.fromEntries(n.actions.flatMap((a, i) => (n.mix[i]! > 0 ? [[a, n.mix[i]!]] : []))),
    hands: n.hands,
    seat: n.seat,
    words: n.words,
    street,
    board,
  };
}

/** The kept locks to send from a node: those of its street and board, other than one at this very line of a solve. */
export const keptFor = (kept: readonly Kept[], street: string, board: string): Kept[] => kept.filter((k) => k.street === street && k.board === board);

/** A kept lock as the request carries it. */
export const asKept = ({ root, line, player, mix, hands }: Kept): KeptLock => ({ root, line, player, mix, hands });
