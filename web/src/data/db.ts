// Local persistence: one IndexedDB database, versioned, with explicit forward migrations. Everything stays in
// the user's browser (no accounts). Each migration runs once, in order, inside the upgrade transaction; a test
// (db.test.ts) opens every historical version and checks the upgrade path.
import { deleteDB, openDB, type DBSchema, type IDBPDatabase, type IDBPObjectStore, type IDBPTransaction, type StoreNames } from "idb";
import type { SessionOptions } from "@/features/practice/practice";
import type { SpotSetup } from "@/features/solve/setup";
import type { TournamentSetup } from "@/features/tournaments/tournament";
import type { Verdict } from "@/grading/grade";
import type { AdvisorState } from "@/solver/protocol";
import type { Confidence, ConvergenceBand, Provenance } from "@/solver/types";

export const DB_NAME = "lizard";

export interface SavedSpot {
  id: string;
  title: string;
  /** the Study line, as Study's URL search (studyState.ts toSearch): what opens the spot */
  line: string;
  /** the Advisor state the spot reproduces (studyRequest of the line) */
  state: Record<string, unknown>;
  tags: string[];
  note: string;
  /** the answer seen when the spot was saved: its source and its provenance line */
  seen?: { source: string; label: string };
  createdAt: number;
  updatedAt: number;
}

/** The one answer kept with a saved spot, under the spot's id. A store of its own: an answer runs to tens of KB, and Study
 * reads the list of spots at every node. Read through `readAnswer` (answers.ts), which says what it may be called. */
export interface SavedAnswer {
  /** the spot's id */
  id: string;
  /** the Study line it answers */
  line: string;
  /** the engine's answer, as JSON */
  json: string;
  /** as it was given. Only its mode, backend, versions and time are believed: what produced the answer is worked out
   * from the answer again, so nothing written here can name a source the answer doesn't have */
  provenance: Provenance;
  savedAt: number;
  /** it came in from a file: set by the restore, whatever the file says */
  restored?: true;
}

export interface SavedRange {
  id: string;
  name: string;
  /** the range in the common solver text format (features/ranges/rangeText.ts) */
  text: string;
  combos: number;
  note: string;
  /** a field of the record, with no index, so no migration: one kept before tags were has none (as the other kinds') */
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

/** A Practice setup kept under a name, to start again from the Saved page. Read through `readScenario` (scenarios.ts). */
export interface SavedScenario {
  id: string;
  name: string;
  players: number;
  stack: number;
  /** the New session form's setup: seat, what's played, ante, rake, straddle, sizes, board filter and the game's options */
  opts: SessionOptions;
  note: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

/** Analyze's filters kept under a name: no numbers, as opening one counts what's kept by then (data/reports.ts). */
export interface SavedReport {
  id: string;
  name: string;
  /** the filters set, by their URL names */
  filters: Record<string, string>;
  note: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

/** A drill kept under a name: where it opens (a drill is its page's URL), and what it drills. */
export interface SavedDrill {
  id: string;
  name: string;
  /** "library": a flop decision dealt from the precomputed library (Practice's drills); "leak": your own graded
   * decisions behind a leak (Analyze's "Drill this leak", over the hands its filters keep) */
  kind: "library" | "leak";
  /** the page and its search, as the drill was set when saved ("/practice?tab=drills&spot=…") */
  to: string;
  /** what it drills, as the page put it when saved */
  about: string;
  note: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SessionRecord {
  id: string;
  /** "tournament": prize equity, "tournament-chips": chip EV, "exploit": best responses to an assumed profile. Kinds of
   * their own: their EVs go in no total of another's. */
  kind: "practice" | "drill" | "analysis" | "build" | "tournament" | "tournament-chips" | "exploit";
  startedAt: number;
  endedAt?: number;
  decisions: number;
  evLossBb: number;
  meta: Record<string, unknown>;
}

/** One hand imported into Analyze: its summary for the hands table, and the history itself (re-read when opened). */
export interface HandRecord {
  /** site, hand number and hole cards: a hand imported twice is kept once */
  id: string;
  site: string;
  /** the site's hand number ("" where the history has none) */
  number: string;
  /** when it was played, as the history writes it ("2024-05-01 20:00", the site's own clock), "" where it doesn't */
  played: string;
  /** that time read as UTC, for sorting (0 where unknown) */
  playedAt: number;
  /** your seat */
  hero: string;
  players: number;
  hole: string;
  board: string;
  /** the big blind in the history's money ("$1", "300 chips") */
  bb: string;
  potType: string;
  /** the pot won, bb */
  pot: number;
  /** how the hand ended for you ("folded flop", "showdown", …) */
  end: string;
  /** your decisions in it */
  decisions: number;
  /** the street Practice played for you (a pot drill, Instant flops): your moves there were drawn from the charts, so
   * they're in the history but not in your stats or grades */
  playedFor?: "preflop";
  /** your decisions Practice's Reveal showed you the answer to first, each "street|index in that street's line": they're
   * in the history, and in no grade */
  revealed?: string[];
  /** a Practice hand's rake and own sizes, as its Study line has them: a history doesn't carry them. An imported hand has
   * none, so its line is never taken for a raked game's. A tournament's prizes left in prize equity (`tournament`), as its
   * answers were asked, so Analyze asks them so too. */
  setup?: Pick<SpotSetup, "sizes" | "rake" | "rakeCap"> & { pfSizes?: true; pfOptions?: true; tournament?: TournamentSetup };
  tournament?: string;
  text: string;
  /** your tags and note on the hand, and when you last changed them (none until you do) */
  tags?: string[];
  note?: string;
  updatedAt?: number;
  importId: string;
  importName: string;
  importedAt: number;
}

/** One of your graded decisions in an imported hand. */
export interface DecisionRecord {
  /** the hand's id, the street and the action's index there */
  id: string;
  handId: string;
  street: string;
  pos: string;
  /** the action's index on its street */
  i?: number;
  /** what you did ("raise to 2.5") */
  action: string;
  /** Best, Correct, Inaccuracy, Mistake or Blunder (grading/grade.ts), or "Not graded" (`why`) */
  verdict: string;
  /** EV lost, bb, and in % of the pot (null where graded by frequency) */
  evLossBb: number | null;
  lossPct?: number | null;
  /** graded by EV (the library) or by frequency only (the charts) */
  byEv?: boolean;
  /** preflop "RFI", "vs 3bet"...; after the flop "SRP · IP · checked to"... */
  situation?: string;
  potType?: string;
  /** facing a bet (preflop: anything to call, the big blind included) */
  facing?: boolean;
  /** after the flop: in position, three or more players in, and your role (the last preflop raiser, its caller) */
  ip?: boolean;
  multi?: boolean;
  role?: "PFR" | "caller" | "limped";
  /** the pot at the decision, bb */
  pot?: number;
  /** the answer's action your move was graded as, and how often your hand takes it */
  matched?: string;
  freq?: number;
  /** the answer's most frequent action and its frequency */
  best?: string;
  bestFreq?: number;
  /** the answer's actions for your hand: [action, frequency, EV bb or null] */
  mix?: [string, number, number | null][];
  /** your move graded as another ("your all-in, graded as the chart's raise") */
  note?: string;
  /** why it isn't graded */
  why?: string;
  /** a preflop decision of a stored game the charts graded: why the preflop solve didn't (features/practice/pfGrade.ts) */
  pfWhy?: string;
  /** the answer graded against: its source and its provenance line */
  source: string;
  label: string;
  /** what graded it, at which version (grading/version.ts). A field of the record, with no index, so no migration: a
   * grade kept before versions were has none, and reads as unknown */
  version?: string;
  /** that answer is labelled approximate, and how settled a live solve was (provenance.ts) */
  approximate?: boolean;
  band?: ConvergenceBand;
  /** a rough or cut-short solve graded this: the verdict stops at an Inaccuracy, whatever the EV it measured */
  capped?: boolean;
  /** your move is one the range almost never takes, so its EV and the EV lost are rough */
  roughEv?: boolean;
  /** the mix's actions whose EV the answer marks rough, so a drill's other picks can say so. A field of the record, with no
   * index, so no migration: an older grade has none, and only `roughEv` says it of the move you made */
  roughEvs?: string[];
  /** the ranges behind the answer aren't all the solve's: how */
  off?: string;
  /** on the turn and river: you bet or raised the flop (on the river since 2026-11-09) */
  flopAggr?: boolean;
  /** on the river: you bet or raised the turn (since 2026-11-09; an older grade has none) */
  turnAggr?: boolean;
  /** preflop: this was your first decision of the hand (since 2026-11-09; an older grade has none) */
  firstIn?: boolean;
  /** preflop: how many called the one raise before you, 0 where there were more raises or none (since 2026-11-10) */
  callers?: number;
  /** on the flop: your first move on it, before this one, was a check (since 2026-11-09; an older grade has none) */
  ownCheck?: boolean;
  /** on the flop: you'd already bet or raised on it, so what you face is a raise of yours */
  ownBet?: boolean;
  /** a Quick triage read: how far to trust it and what the Advisor read it from (Advisor.triage) */
  confidence?: Confidence;
  triageSource?: string;
  /** the triage read a deeper answer at Fast replaced */
  read?: Pick<DecisionRecord, "verdict" | "source" | "label" | "version" | "confidence" | "triageSource" | "evLossBb" | "freq" | "mix">;
  /** why the answer at Fast couldn't grade this read, which stands */
  notChecked?: string;
  gradedAt: number;
}

/** How a kept mistake's spot is asked again: what Practice asked the engine, the library entry a drill read (`version`:
 * the entry's, as the library's index gave it), or, for a decision graded in Analyze, nothing: the record's own mix is
 * the answer (`hand`, `decision`: where it came from, which can be gone since; the record needs neither to be retried). */
export type MistakeAsk =
  /** live: a live drill's, asked again on the drill's terms (review/retry.ts) */
  | { via: "solver"; state: AdvisorState; live?: true }
  | { via: "library"; spot: string; flop: string; path: string[]; combo: [number, number]; version?: string; turn?: { card: string; at: string[] } }
  | { via: "kept"; hand: string; decision: string };

/** One retry of a kept mistake, as graded then. */
export interface MistakeTry {
  at: number;
  chose: string;
  verdict: Verdict;
  ok: boolean;
  byEv: boolean;
  /** EV given up against the best action, bb and % of the pot (0 where graded by frequency) */
  loss: number;
  lossPct: number;
  /** the answer graded against: its source and its provenance line, and its version (grading/version.ts) */
  source: string;
  label: string;
  version?: string;
  /** that answer is the kind the mistake was graded on (features/review/mistakes.ts answerChange) */
  like: boolean;
  /** it moved the schedule (one before its day doesn't) */
  moved: boolean;
}

/** A graded decision that wasn't Best or Correct, one record a spot, with what's needed to ask it again and when to
 * (features/review/schedule.ts). The grade and the answer are the latest miss's in play. */
export interface MistakeRecord {
  /** the spot: the same spot missed again is this record */
  id: string;
  /** Practice's full hands or its drills; a graded decision added from Analyze, or a pick missed in a leak drill. A field
   * of the record, with no index, so no migration; an older page reads these as damaged and leaves them alone. */
  from: "hand" | "drill" | "analyze" | "leak";
  /** from a tournament session: what its EVs are in. Review keeps these apart. */
  tournament?: "icm" | "chips";
  /** from an exploit session: the profile its answers best-respond to. Review keeps these apart. */
  exploit?: string;
  sessionId: string;
  street: string;
  /** when it was first missed, when it last was, and when this record last changed */
  at: number;
  lastAt: number;
  updatedAt: number;
  /** how many times it has been missed in play */
  times: number;
  /** the graded decisions it holds, each with how many of `times` came from it (the rest are Practice's own), whatever
   * `ask` is now; none on a record kept before this was, read by `heldDecisions` (data/mistakes.ts) */
  decisions?: Record<string, number>;
  seat: string;
  players: number;
  /** the game in words ("6-max 100bb · ante 1"; a drill's library spot) */
  game: string;
  hole: [string, string];
  board: string[];
  /** the street's action before you, in words */
  line: string;
  /** the Study line (studyState.ts toSearch); null for a game Study can't set up */
  study: string | null;
  ask: MistakeAsk;
  chose: string;
  mix: { action: string; freq: number; ev: number | null; amount?: number; rough?: true }[];
  pot: number;
  grade: { a: number; best: number; verdict: Verdict; ok: false; mixed: boolean; loss: number; lossPct: number; byEv: boolean; capped?: boolean };
  /** what graded it; null where none was kept */
  provenance: Provenance | null;
  /** how far along the schedule, and the day it's next due (null: finished) */
  step: number;
  due: number | null;
  tries: MistakeTry[];
}

export interface LizardDB extends DBSchema {
  /** key/value settings (mirrors the persisted settings store) */
  kv: { key: string; value: unknown };
  savedSpots: { key: string; value: SavedSpot; indexes: { byUpdated: number } };
  savedAnswers: { key: string; value: SavedAnswer };
  sessions: { key: string; value: SessionRecord; indexes: { byStarted: number; byKind: string } };
  savedRanges: { key: string; value: SavedRange; indexes: { byUpdated: number } };
  hands: { key: string; value: HandRecord; indexes: { byPlayed: number; bySite: string; byImport: string; byHero: string; byPotType: string } };
  decisions: { key: string; value: DecisionRecord; indexes: { byHand: string; byVerdict: string; byStreet: string; byPos: string } };
  savedDrills: { key: string; value: SavedDrill; indexes: { byUpdated: number } };
  savedScenarios: { key: string; value: SavedScenario; indexes: { byUpdated: number } };
  savedReports: { key: string; value: SavedReport; indexes: { byUpdated: number } };
  mistakes: { key: string; value: MistakeRecord; indexes: { byDue: number; byLast: number; byStreet: string } };
  tombstones: { key: [string, string]; value: Tombstone; indexes: { byAge: [string, number] } };
}

/** A record you deleted: which, and when. Without one a restore can't tell a deletion from a record never seen. Written
 * with the delete, in its transaction (`deleting`); kept under the store and the id, so deleting one twice is one. */
export interface Tombstone {
  store: KeptStore;
  id: string;
  /** when it was deleted: always later than the record's last change (`deleting`) */
  at: number;
  /** the browser that deleted it, where it came in from a file; none where it was this one */
  dev?: string;
}

/** When a record of each kind last changed: what a backup calls `updated`, and what its deletion is measured against. */
export const LAST_CHANGED = {
  savedSpots: (d: SavedSpot) => d.updatedAt,
  savedAnswers: (d: SavedAnswer) => d.savedAt,
  savedRanges: (d: SavedRange) => d.updatedAt,
  savedDrills: (d: SavedDrill) => d.updatedAt,
  savedScenarios: (d: SavedScenario) => d.updatedAt,
  savedReports: (d: SavedReport) => d.updatedAt,
  sessions: (d: SessionRecord) => d.endedAt ?? d.startedAt,
  hands: (d: HandRecord) => d.updatedAt ?? d.importedAt,
  decisions: (d: DecisionRecord) => d.gradedAt,
  mistakes: (d: MistakeRecord) => d.updatedAt,
};
/** The stores a backup carries, and so a deletion is remembered for. Settings (`kv`) aren't among them. */
export type KeptStore = keyof typeof LAST_CHANGED;

type UpgradeTx = IDBPTransaction<LizardDB, StoreNames<LizardDB>[], "versionchange">;

/** migrations[v] upgrades a database at version v-1 to version v. Never edit a shipped migration; add one. */
export const MIGRATIONS: Record<number, (db: IDBPDatabase<LizardDB>, tx: UpgradeTx) => void> = {
  1: (db) => {
    db.createObjectStore("kv");
    const spots = db.createObjectStore("savedSpots", { keyPath: "id" });
    spots.createIndex("byUpdated", "updatedAt");
  },
  2: (db) => {
    const s = db.createObjectStore("sessions", { keyPath: "id" });
    s.createIndex("byStarted", "startedAt");
    s.createIndex("byKind", "kind");
  },
  3: (db) => {
    const r = db.createObjectStore("savedRanges", { keyPath: "id" });
    r.createIndex("byUpdated", "updatedAt");
  },
  4: (db) => {
    const h = db.createObjectStore("hands", { keyPath: "id" });
    h.createIndex("byPlayed", "playedAt");
    h.createIndex("bySite", "site");
    h.createIndex("byImport", "importId");
    h.createIndex("byHero", "hero");
    h.createIndex("byPotType", "potType");
    const d = db.createObjectStore("decisions", { keyPath: "id" });
    d.createIndex("byHand", "handId");
    d.createIndex("byVerdict", "verdict");
    d.createIndex("byStreet", "street");
    d.createIndex("byPos", "pos");
  },
  5: (db) => {
    const s = db.createObjectStore("savedDrills", { keyPath: "id" });
    s.createIndex("byUpdated", "updatedAt");
  },
  6: (db) => {
    const m = db.createObjectStore("mistakes", { keyPath: "id" });
    m.createIndex("byDue", "due");
    m.createIndex("byLast", "lastAt");
    m.createIndex("byStreet", "street");
  },
  7: (db) => {
    db.createObjectStore("savedScenarios", { keyPath: "id" }).createIndex("byUpdated", "updatedAt");
  },
  8: (db) => {
    db.createObjectStore("savedReports", { keyPath: "id" }).createIndex("byUpdated", "updatedAt");
  },
  9: (db) => {
    db.createObjectStore("savedAnswers", { keyPath: "id" });
  },
  // (adds a store and touches no record, so what was deleted before this has no tombstone: nothing could say it was)
  10: (db) => {
    db.createObjectStore("tombstones", { keyPath: ["store", "id"] }).createIndex("byAge", ["store", "at"]);
  },
};

export const DB_VERSION = Math.max(...Object.keys(MIGRATIONS).map(Number));

/** What an open hears from other tabs: `blocked`, an older tab holds the database open so this upgrade waits;
 * `blocking`, a newer tab wants to upgrade and this connection is in its way. */
export interface OpenHooks {
  blocked?: () => void;
  blocking?: () => void;
  terminated?: () => void;
}

export function openLizardDB(version: number = DB_VERSION, name: string = DB_NAME, hooks: OpenHooks = {}): Promise<IDBPDatabase<LizardDB>> {
  return openDB<LizardDB>(name, version, {
    upgrade(db, oldVersion, newVersion, tx) {
      const target = newVersion ?? version;
      for (let v = oldVersion + 1; v <= target; v++) {
        const m = MIGRATIONS[v];
        if (!m) throw new Error(`no migration to database version ${v}`);
        m(db, tx);
      }
    },
    blocked: hooks.blocked,
    blocking: hooks.blocking,
    terminated: hooks.terminated,
  });
}

/** The shared connection's state, for the notice in the page (app/DbNotice.tsx): "waiting", an older Lizard tab
 * keeps the database at its version so this one's upgrade waits (until that tab closes or reloads), or the open has
 * taken longer than DB_WAIT_NOTICE_MS (queued behind another tab's waiting upgrade); "replaced", a
 * newer Lizard in another tab upgraded the database, so this tab stepped aside and keeps nothing until reloaded;
 * "failed", the browser wouldn't open it (no IndexedDB, as in some private modes, or an open that errored), so nothing
 * is kept until one succeeds. */
export type DbState = "ok" | "waiting" | "replaced" | "failed";
let state: DbState = "ok";
const listeners = new Set<() => void>();
const setState = (s: DbState) => {
  if (s === state) return;
  state = s;
  for (const f of listeners) f();
};
export const dbState = (): DbState => state;

/** Why the database wouldn't open, for the recovery panel: "unavailable", this browser isn't letting the page store
 * anything (no IndexedDB, some private modes, site data blocked); "newer", it was written by a later Lizard than this
 * page; "upgrade", bringing it up to this version failed, which leaves it as it was; "full", the disk or the site's
 * quota; "damaged", anything else the browser refused with. */
export type DbFailure = "unavailable" | "newer" | "upgrade" | "full" | "damaged";
let failure: { kind: DbFailure; detail: string } | null = null;
export const dbFailure = () => failure;

function failureOf(e: unknown): DbFailure {
  const name = e instanceof Error || e instanceof DOMException ? e.name : "";
  if (name === "VersionError") return "newer";
  if (name === "QuotaExceededError") return "full";
  if (name === "SecurityError" || name === "InvalidStateError" || name === "NotAllowedError") return "unavailable";
  // (a migration that throws aborts its transaction, and the open reports that)
  if (name === "AbortError" || (e instanceof Error && e.message.startsWith("no migration"))) return "upgrade";
  return "damaged";
}
export function onDbState(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

let dbP: Promise<IDBPDatabase<LizardDB>> | null = null;
/** how long an open may take before the page says another tab is holding the database */
export const DB_WAIT_NOTICE_MS = 3000;

/** The app's shared connection (null where IndexedDB is unavailable, e.g. some private modes, or once a newer tab
 * has taken the database over). */
export async function db(): Promise<IDBPDatabase<LizardDB> | null> {
  if (state === "replaced") return null;
  if (typeof indexedDB === "undefined") {
    failure = { kind: "unavailable", detail: "no IndexedDB in this browser" };
    setState("failed");
    return null;
  }
  // (an open queued behind another tab's pending upgrade hears nothing at all: after a few seconds say so too)
  const slow = setTimeout(() => setState("waiting"), DB_WAIT_NOTICE_MS);
  try {
    dbP ??= openLizardDB(DB_VERSION, DB_NAME, {
      blocked: () => setState("waiting"),
      // (closed at once so the newer tab's upgrade isn't held up, as this version's own would be by an older tab)
      blocking: () => {
        const p = dbP;
        dbP = null;
        setState("replaced");
        void p?.then((d) => d.close());
      },
      terminated: () => {
        dbP = null;
      },
    });
    const d = await dbP;
    if (state === "waiting" || state === "failed") setState("ok");
    return d;
  } catch (e) {
    dbP = null;
    console.error("The browser's database wouldn't open:", e);
    failure = { kind: failureOf(e), detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
    if (dbState() !== "replaced") setState("failed");
    return null;
  } finally {
    clearTimeout(slow);
  }
}

/** Delete the database and open a new, empty one: whether that opened. `blocked`: another tab holds the old one, and this
 * waits for it to let go. It can't be undone, so the only caller is the recovery panel, behind its confirm. */
export async function deleteLizardDB(blocked?: () => void): Promise<boolean> {
  const open = dbP;
  dbP = null;
  await open?.then((d) => d.close()).catch(() => {});
  await deleteDB(DB_NAME, { blocked });
  return (await db()) !== null;
}

/** The most deletions remembered of each kind, the oldest forgotten first, and a kind's own, so deleting a large import
 * can't forget a saved spot. The largest import a page reads (256 MB) is about 100,000 hands, so one import fits, and a
 * kind at the bound is about 20 MB of backup, far less than what it stood for. A hand's grades can run past it, and a
 * restore leaves out the grades of a deleted hand by the hand's tombstone (backup.ts). */
export const MAX_TOMBSTONES = 100_000;

/** Every tombstone of a store, oldest first by the `byAge` index. */
export const tombstonesOf = (store: KeptStore) => IDBKeyRange.bound([store, -Infinity], [store, Infinity]);

/** The readwrite tombstone store, of whichever transaction holds it. */
export type TombstoneStore = IDBPObjectStore<LizardDB, ArrayLike<StoreNames<LizardDB>>, "tombstones", "readwrite">;

/** Forgets a store's oldest tombstones down to `max`. A record older than one forgotten can come back from a backup. */
export async function trimTombstones(graves: TombstoneStore, store: KeptStore, max = MAX_TOMBSTONES): Promise<void> {
  const age = graves.index("byAge");
  let over = (await age.count(tombstonesOf(store))) - max;
  if (over <= 0) return;
  for (let c = await age.openCursor(tombstonesOf(store)); c && over > 0; c = await c.continue(), over--) await c.delete();
}

/** A delete, with a tombstone for each record in the same transaction: both happen or neither does, and every user delete
 * goes through here. `work` calls `gone` for each record, which needn't be here: a spot with no answer, deleted, still
 * can't have one come back from a backup. The time is the record's last change or later, whatever this browser's clock
 * says, as a record can come in from a device whose clock runs ahead: a delete is after what it deleted. */
export async function deleting<S extends KeptStore, T>(
  d: IDBPDatabase<LizardDB>,
  stores: readonly S[],
  work: (gone: (store: S, id: string) => Promise<void>, tx: IDBPTransaction<LizardDB, (S | "tombstones")[], "readwrite">) => Promise<T>,
  now: () => number = Date.now,
  max = MAX_TOMBSTONES,
): Promise<T> {
  const tx = d.transaction([...stores, "tombstones"], "readwrite");
  // (its failure is what's awaited below: this only keeps it from being reported as unhandled too)
  tx.done.catch(() => undefined);
  const graves = tx.objectStore("tombstones") as unknown as TombstoneStore;
  const stamped = new Map<KeptStore, number>();
  const gone = async (store: S, id: string) => {
    const kept = tx.objectStore(store) as unknown as { get: (id: string) => Promise<unknown>; delete: (id: string) => Promise<void> };
    const was = await kept.get(id);
    const n = stamped.get(store) ?? 0;
    stamped.set(store, n + 1);
    // (a bulk delete past the bound would write what's about to be forgotten)
    if (n < max) {
      const changed = was === undefined ? NaN : (LAST_CHANGED[store] as (x: unknown) => unknown)(was);
      await graves.put({ store, id, at: typeof changed === "number" && Number.isFinite(changed) ? Math.max(now(), changed + 1) : now() });
    }
    await kept.delete(id);
  };
  try {
    const out = await work(gone, tx);
    for (const s of stamped.keys()) await trimTombstones(graves, s, max);
    await tx.done;
    return out;
  } catch (e) {
    try {
      tx.abort();
    } catch {
      // (it's already over)
    }
    throw e;
  }
}

/** One record deleted, as `deleting`: false where this browser keeps nothing. */
export async function deleteRecord(store: KeptStore, id: string): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  await deleting(d, [store], (gone) => gone(store, id));
  return true;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const d = await db();
  return d ? ((await d.get("kv", key)) as T | undefined) : undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const d = await db();
  if (d) await d.put("kv", value, key);
}

/** Store a session (Practice, drills, analysis), replacing the one with its id: whether it was stored. */
export async function putSession(s: SessionRecord): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  await d.put("sessions", s);
  return true;
}

/** One session by its id. */
export async function getSession(id: string): Promise<SessionRecord | undefined> {
  const d = await db();
  return d ? d.get("sessions", id) : undefined;
}

/** The latest sessions of a kind, newest first. */
export async function recentSessions(kind: SessionRecord["kind"], limit = 10): Promise<SessionRecord[]> {
  const d = await db();
  if (!d) return [];
  const all = await d.getAllFromIndex("sessions", "byKind", kind);
  return all.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
}

/** Every session kept, of every kind, newest first (the History page). */
export async function allSessions(): Promise<SessionRecord[]> {
  const d = await db();
  if (!d) return [];
  return (await d.getAllFromIndex("sessions", "byStarted")).reverse();
}
