// One sync: what's new on the server comes in, then what's new here goes out. The server only keeps what it's given, so all
// the deciding is done here, by the rule of a restore (data/backup.ts): of two copies the later stays, and a deletion stands
// against any copy not changed after it. A sync differs from a restore in one thing, which backup.ts sets out: a deletion
// that arrives here takes the record here too, as it comes from this account, where a file can come from anyone.
//
// A deletion is a record like any other: to the server it's one more record replacing the copy it had.
//
// Saved answers and grades aren't synced (docs/SYNC_DESIGN.md). They go with what they belong to all the same, so a spot or
// hand deleted on another device takes them here, as deleting it here would.
import { recordValid } from "@/data/backup";
import { db, kvGet, kvSet, LAST_CHANGED, tombstonesOf, trimTombstones, type KeptStore, type LizardDB, type TombstoneStore } from "@/data/db";
import type { IDBPDatabase } from "idb";
import { pull, push, type Outgoing, type RemoteRecord } from "./api";

/** What's synced, and the number the server knows each by: position + 1, so never reorder this. */
export const SYNCED = ["savedSpots", "sessions", "hands", "mistakes"] as const satisfies readonly KeptStore[];
export type SyncedStore = (typeof SYNCED)[number];

const numberOf = (s: SyncedStore) => SYNCED.indexOf(s) + 1;

/** The service's limits (worker/src/records.ts), a little inside them: a request also carries its JSON. */
export const SEND = { records: 100, bytes: 3_500_000, record: 700_000 } as const;

const STATE = "syncState";

/** What this browser has seen of the account. It's kept with the data, so a browser that lost its data starts over. */
export interface SyncState {
  /** the account's row: another one means what's known here is of something else, and is worth nothing */
  account: string;
  /** the last sequence number read */
  seq: number;
  /** `store|id` to the time of the copy the server has, sent or read: what differs is what's to send */
  sent: Map<string, number>;
}

export interface SyncReport {
  /** records read, what changed here by them, and what wasn't a record */
  read: number;
  changed: number;
  unread: number;
  /** records sent */
  sent: number;
  /** records too large for the service, left here */
  tooLarge: number;
  /** still to send, where the run stopped short */
  left: number;
}

const keyOf = (s: SyncedStore, id: string) => `${s}|${id}`;

/** A record as synced, or that it was deleted and when. */
type Synced = { id: string; updated: number; data: Record<string, unknown> } | { id: string; updated: number; deleted: true };

const changedAt = (s: SyncedStore, d: unknown) => (LAST_CHANGED[s] as (x: unknown) => number)(d);

export async function readState(account: string): Promise<SyncState> {
  const kept = await kvGet<SyncState>(STATE);
  return kept?.account === account && kept.sent instanceof Map && Number.isSafeInteger(kept.seq) ? kept : { account, seq: 0, sent: new Map() };
}

/** Forgets what's known of the account: signing out, or deleting it. What's kept here stands. */
export const forgetState = () => kvSet(STATE, null);

const writeState = (s: SyncState) => kvSet(STATE, s);

const storeOf = (n: number): SyncedStore | undefined => SYNCED[n - 1];

/** What the server files a record under, for one length and one alphabet whatever the id holds. It hides nothing: the id's in the record. */
export async function fileId(store: number, id: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${store}|${id}`));
  return [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** What a synced record says, or null where it isn't one: nothing in it is trusted further than its shape. */
export function readRecord(s: SyncedStore, x: unknown): Synced | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id || !Number.isFinite(o.updated)) return null;
  if (o.deleted === true) return { id: o.id, updated: o.updated as number, deleted: true };
  if (typeof o.data !== "object" || o.data === null) return null;
  const data = o.data as Record<string, unknown>;
  if (data.id !== o.id || !recordValid(s, data)) return null;
  // (its time is the record's own, as that's what it'll be weighed by from here on)
  return { id: o.id, updated: changedAt(s, data), data };
}

type Tx = ReturnType<typeof beginMerge>;

function beginMerge(d: IDBPDatabase<LizardDB>) {
  return d.transaction([...SYNCED, "decisions", "savedAnswers", "tombstones"], "readwrite");
}

/** What goes with a record deleted elsewhere: a tombstone apiece, later than what it deleted, as `deleting` writes them. */
async function takeWith(tx: Tx, graves: TombstoneStore, s: SyncedStore, id: string, at: number) {
  if (s === "savedSpots") {
    const answers = tx.objectStore("savedAnswers");
    const was = await answers.get(id);
    await graves.put({ store: "savedAnswers", id, at: was ? Math.max(at, was.savedAt + 1) : at });
    await answers.delete(id);
  }
  if (s === "hands") {
    const grades = tx.objectStore("decisions");
    for (const k of await grades.index("byHand").getAllKeys(id)) {
      const was = await grades.get(k);
      await graves.put({ store: "decisions", id: k, at: was ? Math.max(at, was.gradedAt + 1) : at });
      await grades.delete(k);
    }
  }
}

/** A page of synced records, weighed against what's here, in one transaction. Nothing here happens unless all of it does. */
async function merge(d: IDBPDatabase<LizardDB>, page: { s: SyncedStore; r: Synced }[], sent: Map<string, number>): Promise<number> {
  const tx = beginMerge(d);
  const graves = tx.objectStore("tombstones") as unknown as TombstoneStore;
  let changed = 0;
  const touched = new Set<KeptStore>();
  for (const { s, r } of page) {
    const kept = tx.objectStore(s) as unknown as { get: (id: string) => Promise<unknown>; put: (v: unknown) => Promise<unknown>; delete: (id: string) => Promise<void> };
    const here = await kept.get(r.id);
    const held = here === undefined ? undefined : changedAt(s, here);
    const grave = await graves.get([s, r.id]);
    if ("deleted" in r) {
      // (a copy changed since is later than the delete: it stands, and goes out as anything new here does)
      if (held !== undefined && held > r.updated) continue;
      sent.set(keyOf(s, r.id), r.updated);
      if (!grave || r.updated > grave.at) await graves.put({ store: s, id: r.id, at: r.updated });
      touched.add(s);
      if (here !== undefined) {
        await kept.delete(r.id);
        await takeWith(tx, graves, s, r.id, r.updated);
        if (s === "savedSpots") touched.add("savedAnswers");
        if (s === "hands") touched.add("decisions");
        changed++;
      }
      continue;
    }
    if (held !== undefined && held >= r.updated) {
      if (held === r.updated) sent.set(keyOf(s, r.id), r.updated);
      continue;
    }
    // (deleted here after this copy: the deletion goes out in its place)
    if (grave && grave.at > r.updated) continue;
    await kept.put(r.data);
    sent.set(keyOf(s, r.id), r.updated);
    changed++;
  }
  for (const s of touched) await trimTombstones(graves, s);
  await tx.done;
  return changed;
}

/** Reads what's new on the server, page by page, each kept as it's merged, so a stop loses no more than the page. */
async function pullAll(d: IDBPDatabase<LizardDB>, state: SyncState, out: SyncReport) {
  for (;;) {
    const { records, more } = await pull(state.seq);
    const page = await Promise.all(records.map(readOne));
    const good = page.filter((x) => x !== null);
    out.read += records.length;
    out.unread += records.length - good.length;
    out.changed += await merge(d, good, state.sent);
    if (records.length) state.seq = Math.max(state.seq, ...records.map((x) => x.seq));
    await writeState(state);
    if (!more || !records.length) return;
  }
}

/** A body's JSON: null where it isn't, as nothing says the server was given something a device wrote. */
function parsed(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function readOne(x: RemoteRecord): Promise<{ s: SyncedStore; r: Synced } | null> {
  const s = storeOf(x.store);
  if (!s) return null;
  const r = readRecord(s, parsed(x.body));
  // (filed under another record's id: it would replace the wrong copy on the server the next time it's sent)
  return r && (await fileId(x.store, r.id)) === x.id ? { s, r } : null;
}

/** What differs from the server's copy: of a record and its deletion, the later. */
async function toSend(d: IDBPDatabase<LizardDB>, sent: Map<string, number>): Promise<{ s: SyncedStore; id: string; updated: number; data?: unknown }[]> {
  const out: { s: SyncedStore; id: string; updated: number; data?: unknown }[] = [];
  for (const s of SYNCED) {
    const here = new Map<string, number>();
    for (const data of (await d.getAll(s)) as { id: string }[]) {
      const updated = changedAt(s, data);
      here.set(data.id, updated);
      if (sent.get(keyOf(s, data.id)) !== updated) out.push({ s, id: data.id, updated, data });
    }
    for (const t of await d.getAllFromIndex("tombstones", "byAge", tombstonesOf(s))) {
      const held = here.get(t.id);
      if ((held === undefined || t.at > held) && sent.get(keyOf(s, t.id)) !== t.at) out.push({ s, id: t.id, updated: t.at });
    }
  }
  return out;
}

/** A body's size as sent: it goes as a string inside the request's JSON, which adds to it, as a hand's text is full of quotes. */
const sentLength = (body: string) => new TextEncoder().encode(JSON.stringify(body)).length;

/** Sends what's new here. A failure stops it, with what went out already marked. */
async function pushAll(d: IDBPDatabase<LizardDB>, state: SyncState, out: SyncReport) {
  const queue = await toSend(d, state.sent);
  out.left = queue.length;
  let batch: Outgoing[] = [];
  let names: [string, number][] = [];
  let size = 0;
  const flush = async () => {
    if (!batch.length) return;
    const { seq } = await push(batch);
    for (const [k, at] of names) state.sent.set(k, at);
    // (each record is one number: if these are the only numbers since the pull, there's nothing of its own to read back)
    if (seq === state.seq + batch.length) state.seq = seq;
    out.sent += batch.length;
    out.left -= batch.length;
    await writeState(state);
    batch = [];
    names = [];
    size = 0;
  };
  for (const { s, id, updated, data } of queue) {
    const body = JSON.stringify(data === undefined ? { id, updated, deleted: true } : { id, updated, data });
    const length = sentLength(body);
    if (length > SEND.record) {
      out.tooLarge++;
      out.left--;
      continue;
    }
    if (batch.length >= SEND.records || size + length > SEND.bytes) await flush();
    const n = numberOf(s);
    batch.push({ store: n, id: await fileId(n, id), body });
    names.push([keyOf(s, id), updated]);
    size += length;
  }
  await flush();
}

/** One sync. Rejects with SyncFailed where it's stopped, with what was done kept; run again, it picks up from there. */
export async function syncOnce(account: string): Promise<SyncReport> {
  const d = await db();
  const out: SyncReport = { read: 0, changed: 0, unread: 0, sent: 0, tooLarge: 0, left: 0 };
  if (!d) return out;
  const state = await readState(account);
  await pullAll(d, state, out);
  await pushAll(d, state, out);
  return out;
}

/** Sync's report in words. */
export function reportWords(r: SyncReport): string {
  const parts = [`${r.changed} changed here`, `${r.sent} sent`];
  if (r.unread) parts.push(`${r.unread} couldn't be read and were left alone`);
  if (r.tooLarge) parts.push(`${r.tooLarge} too large to sync, kept here only`);
  if (r.left) parts.push(`${r.left} still to send`);
  return parts.join(", ");
}
