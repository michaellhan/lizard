// Where sync stands in this page: signed in or not, and the one run at a time. There's nothing to unlock: the session is an
// HttpOnly cookie, so being signed in is what the service says it is.
import * as api from "./api";
import { forgetState, syncOnce, type SyncReport } from "./merge";

/** Says to the first bundle that there's something to resume, without it opening the database or loading any of this. */
export const FLAG = "lizard-sync";

export interface SyncStatus {
  signedIn: boolean;
  bytes: number;
  maxBytes: number;
}

let account: string | null = null;
const listeners = new Set<() => void>();

/** Called when this page signs in to an account; returns the unsubscribe. */
export function onSignedIn(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

const flag = (on: boolean) => {
  try {
    if (on) localStorage.setItem(FLAG, "1");
    else localStorage.removeItem(FLAG);
  } catch {
    // (with no storage sync starts when Settings is opened)
  }
};

function hold(a: string | null) {
  const changed = a !== account;
  account = a;
  flag(a !== null);
  if (a !== null && changed) listeners.forEach((f) => f());
}

export const isSignedIn = () => account !== null;

export async function status(): Promise<SyncStatus> {
  const m = await api.me();
  hold(m.signedIn ? (m.account ?? null) : null);
  return { signedIn: m.signedIn, bytes: m.bytes ?? 0, maxBytes: m.maxBytes ?? 0 };
}

/** Whether this browser is signed in, as the service sees it. */
export async function resume(): Promise<boolean> {
  if (account === null) await status();
  return account !== null;
}

/** Signed out here: what's kept in this browser stands, and what was known of the account goes. */
export async function leave(): Promise<void> {
  await api.signOut();
  await forgetState();
  hold(null);
}

/** The account and the synced copy gone. What's kept in this browser stands. */
export async function deleteEverything(): Promise<void> {
  await api.deleteAccount();
  await forgetState();
  hold(null);
}

let running: Promise<SyncReport | null> | null = null;

const locked = <T>(work: () => Promise<T>): Promise<T> => (typeof navigator !== "undefined" && navigator.locks ? (navigator.locks.request("lizard-sync", work) as Promise<T>) : work());

/** One sync now, or the one under way: null where this page is signed out. Only one tab runs at a time. */
export function syncNow(): Promise<SyncReport | null> {
  running ??= (async () => {
    try {
      const a = account;
      return a === null ? null : await locked(() => syncOnce(a));
    } finally {
      running = null;
    }
  })();
  return running;
}
