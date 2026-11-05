// Local persistence: one IndexedDB database, versioned, with explicit forward migrations. Everything stays in
// the user's browser (no accounts). Each migration runs once, in order, inside the upgrade transaction; a test
// (db.test.ts) opens every historical version and checks the upgrade path.
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from "idb";
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

export interface SavedRange {
  id: string;
  name: string;
  /** the range in the common solver text format (features/ranges/rangeText.ts) */
  text: string;
  combos: number;
  note: string;
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
  createdAt: number;
  updatedAt: number;
}

export interface SessionRecord {
  id: string;
  kind: "practice" | "drill" | "analysis" | "build";
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
  /** the answer graded against: its source and its provenance line */
  source: string;
  label: string;
  /** what graded it, at which version (grading/version.ts). A field of the record, with no index, so no migration: a
   * grade kept before versions were has none, and reads as unknown */
  version?: string;
  /** that answer is labelled approximate, and how settled a live solve was (provenance.ts) */
  approximate?: boolean;
  band?: ConvergenceBand;
  /** your move is one the range almost never takes, so its EV and the EV lost are rough */
  /** a rough or cut-short solve graded this: the verdict stops at an Inaccuracy, whatever the EV it measured */
  capped?: boolean;
  roughEv?: boolean;
  /** the ranges behind the answer aren't all the solve's: how */
  off?: string;
  /** on the turn: you bet or raised the flop */
  flopAggr?: boolean;
  /** a Quick triage read: how far to trust it and what the Advisor read it from (Advisor.triage) */
  confidence?: Confidence;
  triageSource?: string;
  /** the triage read a deeper answer at Fast replaced */
  read?: Pick<DecisionRecord, "verdict" | "source" | "label" | "version" | "confidence" | "triageSource" | "evLossBb" | "freq" | "mix">;
  /** why the answer at Fast couldn't grade this read, which stands */
  notChecked?: string;
  gradedAt: number;
}

/** How a kept mistake's spot is asked again: what Practice asked the engine, or the library entry a drill read
 * (`version`: the entry's, as the library's index gave it). */
export type MistakeAsk =
  | { via: "solver"; state: AdvisorState }
  | { via: "library"; spot: string; flop: string; path: string[]; combo: [number, number]; version?: string; turn?: { card: string; at: string[] } };

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
  /** Practice's full hands, or its drills */
  from: "hand" | "drill";
  sessionId: string;
  street: string;
  /** when it was first missed, when it last was, and when this record last changed */
  at: number;
  lastAt: number;
  updatedAt: number;
  /** how many times it has been missed in play */
  times: number;
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
  mix: { action: string; freq: number; ev: number | null; amount?: number }[];
  pot: number;
  grade: { a: number; best: number; verdict: Verdict; ok: false; mixed: boolean; loss: number; lossPct: number; byEv: boolean };
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
  sessions: { key: string; value: SessionRecord; indexes: { byStarted: number; byKind: string } };
  savedRanges: { key: string; value: SavedRange; indexes: { byUpdated: number } };
  hands: { key: string; value: HandRecord; indexes: { byPlayed: number; bySite: string; byImport: string; byHero: string; byPotType: string } };
  decisions: { key: string; value: DecisionRecord; indexes: { byHand: string; byVerdict: string; byStreet: string; byPos: string } };
  savedDrills: { key: string; value: SavedDrill; indexes: { byUpdated: number } };
  mistakes: { key: string; value: MistakeRecord; indexes: { byDue: number; byLast: number; byStreet: string } };
}

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
 * newer Lizard in another tab upgraded the database, so this tab stepped aside and keeps nothing until reloaded. */
export type DbState = "ok" | "waiting" | "replaced";
let state: DbState = "ok";
const listeners = new Set<() => void>();
const setState = (s: DbState) => {
  if (s === state) return;
  state = s;
  for (const f of listeners) f();
};
export const dbState = (): DbState => state;
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
  if (typeof indexedDB === "undefined" || state === "replaced") return null;
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
  // (an open queued behind another tab's pending upgrade hears nothing at all: after a few seconds say so too)
  const slow = setTimeout(() => setState("waiting"), DB_WAIT_NOTICE_MS);
  try {
    const d = await dbP;
    if (state === "waiting") setState("ok");
    return d;
  } catch {
    dbP = null;
    return null;
  } finally {
    clearTimeout(slow);
  }
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const d = await db();
  return d ? ((await d.get("kv", key)) as T | undefined) : undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const d = await db();
  if (d) await d.put("kv", value, key);
}

/** Store a session (Practice, drills, analysis), replacing the one with its id. */
export async function putSession(s: SessionRecord): Promise<void> {
  const d = await db();
  if (d) await d.put("sessions", s);
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
