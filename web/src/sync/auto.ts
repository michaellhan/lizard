// When sync runs by itself, once signed in: now, a while after a save, on coming back to the page, on leaving it, and every
// few minutes while it's open. It says nothing unless asked: a failure waits for the next time, and Settings shows the last.
import { onNudgeState } from "@/data/backupNudge";
import { SyncFailed } from "./api";
import { reportWords } from "./merge";
import { isSignedIn, onSignedIn, resume, syncNow } from "./session";

export const TIMES = { afterSave: 20_000, every: 5 * 60_000 } as const;

export interface LastSync {
  at: number;
  ok: boolean;
  words: string;
}

let last: LastSync | null = null;
const listeners = new Set<() => void>();
export const lastSync = () => last;
export function onLastSync(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** A sync, with how it went kept for Settings. */
export async function runSync(now: () => number = Date.now): Promise<void> {
  if (!isSignedIn()) return;
  try {
    const r = await syncNow();
    if (r) last = { at: now(), ok: true, words: reportWords(r) };
  } catch (e) {
    last = { at: now(), ok: false, words: e instanceof SyncFailed ? e.message : "Sync failed. Everything here stays as it is." };
  }
  listeners.forEach((f) => f());
}

let started = false;

/** Starts the timers, once a page. They do nothing while it's signed out. */
export function startAuto(): void {
  if (started) return;
  started = true;
  let soon: ReturnType<typeof setTimeout> | undefined;
  onNudgeState(() => {
    clearTimeout(soon);
    soon = setTimeout(() => void runSync(), TIMES.afterSave);
  });
  onSignedIn(() => void runSync());
  document.addEventListener("visibilitychange", () => void runSync());
  setInterval(() => {
    if (document.visibilityState === "visible") void runSync();
  }, TIMES.every);
  void runSync();
}

/** A browser that's signed in takes up where it was. Anything wrong just leaves it not syncing. */
export async function resumeHere(): Promise<void> {
  try {
    if (await resume()) startAuto();
  } catch {
    // (the service isn't there, or this browser keeps nothing: Settings says which)
  }
}
