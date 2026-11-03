// The backup reminder. Everything Lizard keeps is in this browser only, and a browser may clear a site's data (a phone
// short of space, Safari after weeks away), so each save is counted: a spot, a range or a drill saved or changed,
// hands kept in Analyze, a note on a hand. A backup downloaded starts the count again. Past NUDGE.first saves the page
// says so (app/BackupNudge.tsx); "Not now" waits NUDGE.again more. The count is this browser's own (kv, not in the
// backup); a restore isn't counted.
import { db } from "./db";

const KEY = "backupNudge";
export const NUDGE = { first: 10, again: 25 } as const;

export interface NudgeState {
  /** saves since the last backup (or ever) */
  saves: number;
  /** when the last backup was downloaded here */
  lastBackupAt?: number;
  /** the count when "Not now" was chosen */
  snoozedAt?: number;
}

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
/** Called when the count changes; returns the unsubscribe. */
export function onNudgeState(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

const fresh = (x: unknown): NudgeState => {
  const o = typeof x === "object" && x !== null ? (x as Record<string, unknown>) : {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return { saves: num(o.saves) ?? 0, ...(num(o.lastBackupAt) !== undefined ? { lastBackupAt: num(o.lastBackupAt) } : {}), ...(num(o.snoozedAt) !== undefined ? { snoozedAt: num(o.snoozedAt) } : {}) };
};

/** The count as kept (nothing saved yet where this browser keeps nothing). */
export async function nudgeState(): Promise<NudgeState> {
  const d = await db();
  return fresh(d ? await d.get("kv", KEY) : undefined);
}

// (read and written in one transaction: two saves at once both count)
async function change(f: (s: NudgeState) => NudgeState): Promise<void> {
  const d = await db();
  if (!d) return;
  const tx = d.transaction("kv", "readwrite");
  await tx.store.put(f(fresh(await tx.store.get(KEY))), KEY);
  await tx.done;
  emit();
}

/** `n` more saves. */
export async function noteSaved(n = 1): Promise<void> {
  if (n > 0) await change((s) => ({ ...s, saves: s.saves + n }));
}

/** A backup was downloaded: the count starts again. */
export const noteBackedUp = (at = Date.now()) => change(() => ({ saves: 0, lastBackupAt: at }));

/** "Not now": said again after NUDGE.again more saves. */
export const snoozeNudge = () => change((s) => ({ ...s, snoozedAt: s.saves }));

/** Whether to say it now. */
export const nudgeDue = (s: NudgeState): boolean => s.saves >= (s.snoozedAt !== undefined ? s.snoozedAt + NUDGE.again : NUDGE.first);
