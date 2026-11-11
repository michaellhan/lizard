// The backup reminder. Everything Lizard keeps is in this browser only, and a browser may clear a site's data (a phone
// short of space, Safari after weeks away), so each save is counted: a spot, a range or a drill saved or changed,
// hands kept in Analyze, a note on a hand. A backup downloaded starts the count again. The reminder (app/BackupNudge.tsx)
// is rare on purpose: only past NUDGE.saves saves and NUDGE.days days since the count started (or the last backup), and
// "Later" puts it off NUDGE.snoozeDays days. The count is this browser's own (kv, not in the backup); a restore isn't
// counted.
import { db } from "./db";

const KEY = "backupNudge";
export const NUDGE = { saves: 50, days: 14, snoozeDays: 30 } as const;
const DAY = 86_400_000;

export interface NudgeState {
  /** saves since the last backup (or ever) */
  saves: number;
  /** when the last backup was downloaded here */
  lastBackupAt?: number;
  /** when the count started here (the first save after a backup, or ever) */
  since?: number;
  /** "Later" was chosen: not said again before this time */
  snoozedUntil?: number;
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
  const out: NudgeState = { saves: num(o.saves) ?? 0 };
  for (const k of ["lastBackupAt", "since", "snoozedUntil"] as const) if (num(o[k]) !== undefined) out[k] = num(o[k]);
  return out;
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

/** `n` more saves. (A count kept before `since` was, starts its days now.) */
export async function noteSaved(n = 1, at = Date.now()): Promise<void> {
  if (n > 0) await change((s) => ({ ...s, saves: s.saves + n, since: s.since ?? at }));
}

/** A backup was downloaded: the count starts again. */
export const noteBackedUp = (at = Date.now()) => change(() => ({ saves: 0, lastBackupAt: at }));

/** "Later": not said again for NUDGE.snoozeDays days. */
export const snoozeNudge = (at = Date.now()) => change((s) => ({ ...s, snoozedUntil: at + NUDGE.snoozeDays * DAY }));

/** Whether to say it now: enough saves, kept long enough, and not put off. */
export const nudgeDue = (s: NudgeState, now = Date.now()): boolean =>
  s.saves >= NUDGE.saves && s.since !== undefined && now - s.since >= NUDGE.days * DAY && (s.snoozedUntil === undefined || now >= s.snoozedUntil);
