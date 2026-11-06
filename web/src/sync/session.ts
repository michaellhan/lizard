// Where sync stands in this page: signed in or not, unlocked or not, and the one run at a time. The keys stay in memory
// unless you choose to stay unlocked on this device, when they go in this browser's database as keys no script can read
// out, only use (crypto.ts makes them unextractable). They open your synced copy for anything running on this site, so
// it's off by default and Lock takes them out.
import { kvGet, kvSet } from "@/data/db";
import * as api from "./api";
import { deriveKeys, makeCheck, MIN_PASSPHRASE, newSalt, passesCheck, type SyncKeys } from "./crypto";
import { forgetState, syncOnce, type SyncReport } from "./merge";

const KEPT = "syncKeys";
/** Says to the first bundle that there's something to resume, without it opening the database or loading any of this. */
export const FLAG = "lizard-sync";

interface Unlocked {
  keys: SyncKeys;
  salt: string;
}

export interface SyncStatus {
  signedIn: boolean;
  /** the account has a passphrase */
  hasPhrase: boolean;
  unlocked: boolean;
  bytes: number;
  maxBytes: number;
}

let open: Unlocked | null = null;
const listeners = new Set<() => void>();

/** Called when this page unlocks or locks; returns the unsubscribe. */
export function onUnlock(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

const flag = (on: boolean) => {
  try {
    if (on) localStorage.setItem(FLAG, "1");
    else localStorage.removeItem(FLAG);
  } catch {
    // (with no storage it just asks again next time)
  }
};

async function hold(u: Unlocked | null, stay: boolean) {
  open = u;
  if (u && stay) await kvSet(KEPT, u);
  if (!u || !stay) await kvSet(KEPT, null);
  flag(!!u && stay);
  listeners.forEach((f) => f());
}

export const isUnlocked = () => open !== null;

export async function status(): Promise<SyncStatus> {
  const m = await api.me();
  if (open && m.salt !== open.salt) await hold(null, false);
  return { signedIn: m.signedIn, hasPhrase: !!m.salt, unlocked: open !== null, bytes: m.bytes ?? 0, maxBytes: m.maxBytes ?? 0 };
}

/** The keys kept on this device, if they're still the account's. */
export async function resume(): Promise<boolean> {
  if (open) return true;
  const kept = await kvGet<Unlocked>(KEPT);
  if (!kept?.keys || !kept.salt) return false;
  const m = await api.me();
  if (!m.signedIn || m.salt !== kept.salt) {
    if (m.signedIn) await hold(null, false);
    return false;
  }
  open = kept;
  listeners.forEach((f) => f());
  return true;
}

/** A first passphrase for the account. */
export async function choosePassphrase(phrase: string, stay: boolean, reset = false): Promise<void> {
  if (phrase.normalize("NFKC").length < MIN_PASSPHRASE) throw new api.SyncFailed(`A passphrase needs at least ${MIN_PASSPHRASE} characters.`, "short");
  const salt = newSalt();
  const keys = await deriveKeys(phrase, salt);
  await api.setKeys(salt, await makeCheck(keys), reset);
  await forgetState();
  await hold({ keys, salt }, stay);
}

/** Opens the synced copy with the passphrase: false where it's the wrong one. */
export async function unlock(phrase: string, stay: boolean): Promise<boolean> {
  const { salt, check } = await api.me();
  if (!salt || !check) return false;
  const keys = await deriveKeys(phrase, salt);
  if (!(await passesCheck(keys, check))) return false;
  await hold({ keys, salt }, stay);
  return true;
}

export const lock = () => hold(null, false);

/** Signed out here: what's kept in this browser stands, and what was known of the account goes. */
export async function leave(): Promise<void> {
  await api.signOut();
  await forgetState();
  await lock();
}

/** The account and the synced copy gone. What's kept in this browser stands. */
export async function deleteEverything(): Promise<void> {
  await api.deleteAccount();
  await forgetState();
  await lock();
}

let running: Promise<SyncReport | null> | null = null;

const locked = <T>(work: () => Promise<T>): Promise<T> => (typeof navigator !== "undefined" && navigator.locks ? (navigator.locks.request("lizard-sync", work) as Promise<T>) : work());

/** One sync now, or the one under way: null where this page is locked. Only one tab runs at a time. */
export function syncNow(): Promise<SyncReport | null> {
  running ??= (async () => {
    try {
      const u = open;
      return u ? await locked(() => syncOnce(u.keys, u.salt)) : null;
    } finally {
      running = null;
    }
  })();
  return running;
}
