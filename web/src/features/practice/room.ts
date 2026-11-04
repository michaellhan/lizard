// A Room runs Practice's tables, one to four: it deals, asks the solver what each hand needs next, takes the answers and
// keeps the one session, so a view only draws its snapshot and calls its actions. It alone owns the clock, the timers
// and the promises. Answers go into caches by key (flow.ts builds a key with its request) and a table pulls from them, so
// a late answer can't land on a hand that has moved on: at worst it waits in a cache for a spot nobody reaches. The
// solver answers one request at a time, so one is in flight, whatever scheduler.ts says goes next: `flight` is set before
// the first await, or two pumps would launch twice, and held until the request settles, a stopped one too (about 0.1 s
// on an isolated worker), as the next would queue behind it anyway. A stop the worker never answers ends the worker
// (worker-transport.ts): `restarts` counts those, and a job still wanted is simply asked again. A failure is held by key
// as well, so it only ever shows on the spot it was for, in the session it came from.
//
// Above one table each hand is dealt by the tables' Spots and Seat with no chips carried, nothing waits on `pace` and a
// finished hand deals again by itself after `pause`. The table that needs you comes to the front, and a press meant for
// the last spot can't land on the next: input waits `guard` ms from when the front changed by itself or its answer came
// in, and a dock's button carries its spot's key. Fewer tables set the others aside with their hands and results.
//
// Instant flops is what's dealt above one table unless you choose otherwise: each hand is played for you from the flop
// library's index (flops.ts) until it reaches a heads-up flop the library holds, so a table deals nothing until the index
// has settled, and where it can't be read, or holds no spot of this game, the tables play Any hand and say why. Hands
// being dealt to a pot, a drill's too, draw their seats' moves from one chart a node (`charts`) in the game the charts are:
// a chart that can't be drawn from is held as null and its seats are asked one by one, and a chart nobody got an answer to
// holds nothing, so it's asked again. At one table nothing is drawn, as there every move is asked in order.
//
// `start`, `stop`, `start` works, as StrictMode runs it. `start` reads the kept doc first, raced against KEPT_WAIT
// because `kvGet` waits for ever while an older tab blocks an upgrade, and sends nothing until that settles: a New
// session meanwhile wins, and a read that times out starts fresh and leaves the doc alone. The page draws the hand all the
// while. Two tables or more in the doc come back (keep.ts) once Settings have loaded, as the mode and each deal read
// them, or at KEPT_WAIT. Answers aren't kept, so that's where a restored session's requests begin: each table asks what it
// needs from where its hand stands, as any table does, your spot again, an opponent's move drawn afresh, a next hand after
// `pause`. The doc is written at once after a decision, a hand's end or a change of tables and otherwise at most twice a
// second, and `stop` flushes, as a write the browser refused is tried again at the next save. At one table nothing is
// kept: a reload starts fresh, and only going down to one table or a New session clears the doc.
//
// Asking ahead, where it's on, you can see the page and a wrong guess can be stopped: while a table waits for you, what
// your likeliest moves will need is asked (ahead.ts). Each is the request the table would send, into the same caches, so
// there's nothing to hand over: a table finds the answer, or finds the flight as a job of its own and it stays in the air
// (`plan`), and only `Flight.ahead` remembers what it went out as, for the meter. What a look-ahead failed on goes in
// `aheadBad`, which only a walk reads, so no table shows it. A real job always goes by its group, ahead of a look-ahead's
// unless it's a long solve at the table in front, and what's looked ahead for and gone dead is stopped like any flight.
import { kvGet, kvSet, putSession } from "@/data/db";
import { addHands } from "@/data/hands";
import { addHandToPot, addSource, emptyTally, type PotTally } from "@/features/history/history";
import { candsFor, flopIndex, gamesHeld, gameWords, heldSpots, instantSpots, isChart, libFlop, type FlopSpot } from "@/library/flops";
import { seatsOf } from "@/poker/seats";
import type { Sim, Street } from "@/poker/table";
import type { SolverClient } from "@/solver/client";
import type { AdvisorState, PlayMove } from "@/solver/protocol";
import { useRuntime } from "@/solver/runtime";
import { SolverError, type SolveMode, type SolverTransport, type SolveResult, type StopCost } from "@/solver/types";
import { useSettings } from "@/state/settings";
import { aheadJobs, ASK_AHEAD, habit, NO_METER, noteBad, readHabits, saveHabits, type AheadMeter, type Habits, type Waiting } from "./ahead";
import { chartDraw, moveOf, needOf, type Need } from "./flow";
import { practiceRecord } from "./history";
import { KEPT_KEY, keptTables, MAX_TABLES, sameKept, type KeptTable, type KeptTables, type LastHand } from "./keep";
import {
  checkOrCall,
  dealNext,
  decide,
  decideUngraded,
  DRILL_TRIES,
  facingBet,
  finish,
  following,
  isPotDrill,
  needsIndex,
  newHand,
  offDrill,
  phaseOf,
  potLabel,
  rangeAt,
  redeal,
  runKind,
  seeking,
  simOf,
  stateFor,
  withVillain,
  type Decision,
  type HandOptions,
  type HandPot,
  type PracticeHand,
  type RangeAt,
  type SeatChoice,
} from "./practice";
import { estimate, plan, queue, refocus, streetKey, type Asked, type Front, type Job, type Waiter } from "./scheduler";
import { afterDeal, afterDecision, afterHand, atTables, freshSession, keyOf, toRecord, type Kept, type PracticeSession } from "./session";

/** What the Room asks of a client (a test's is a fake). */
export type RoomClient = Pick<SolverClient, "solve" | "play"> & Partial<Pick<SolverClient, "prefetch" | "stopCost">> & { transport?: Pick<SolverTransport, "kind"> };
export type RoomSolver = () => Promise<RoomClient>;

/** What the tables deal above one table: any hand, or one kind of pot. */
export type Spot = HandPot | "any";

/** Settings' Spots as it's played. `lib`: Instant flops can be dealt here, which it is where nothing's been chosen. Any hand
 * where it can't, where the choice is one this build doesn't know, and in a preflop-only session, as a pot played for you
 * would stop it counting net. */
export function spotOf(saved: unknown, preflopOnly: boolean, lib: boolean): Spot {
  if (preflopOnly) return "any";
  if (isPotDrill(saved)) return saved;
  return (saved === null || saved === "lib") && lib ? "lib" : "any";
}

/** The seats a spot can deal you. */
export const seatsFor = (players: number, spot: Spot): readonly string[] => (spot === "bvb" ? ["SB", "BB"] : seatsOf(players));

/** Settings' Seat as it's played: Random where this game or spot doesn't have it. */
export const seatOf = (saved: string, players: number, spot: Spot): SeatChoice => (seatsFor(players, spot).includes(saved) ? saved : "random");

/** Why Instant flops can't be dealt: a preflop-only session, an index that didn't load, or a game it holds no spot of. */
export type FlopsOff = "preflop" | "failed" | "game";

/** Instant flops as the tables stand. */
export interface RoomFlops {
  off: FlopsOff | null;
  /** the games the library holds, in words, once it's been read */
  holds: readonly string[];
  /** this session's game, in words */
  game: string;
}

/** Why Instant flops isn't on offer, in words, as a phone has no tooltip. `spot`: what's being played. */
export function flopsNote(f: RoomFlops, spot: Spot): string | null {
  if (f.off === "preflop") return "Instant flops plays no preflop, so a preflop-only session stays on Any hand. Nor can a pot drill: each plays your preflop for you.";
  if (f.off === "failed") return `The flop library didn't load, so ${spot === "any" ? "this is Any hand" : "Instant flops is off"}.`;
  if (f.off === "game") return `Instant flops needs a game the flop library holds (${f.holds.join(", ")}). This is ${f.game}${spot === "any" ? ", so you're playing Any hand" : ""}.`;
  return null;
}

export interface RoomOptions {
  /** ms an opponent's move and a new card take at least at one table, so the hand can be followed (0 in tests) */
  pace?: number;
  /** ms a finished hand stays on its table above one table, before that table deals again */
  pause?: number;
  /** ms your input waits above one table, from when the table in front changed by itself or its answer came in */
  guard?: number;
  now?: () => number;
  /** false: nothing is read or written: no kept doc, no record in History, no hand in Analyze, no habits */
  persist?: boolean;
  /** the seed of the n-th deal, a drill's deals again counted (at random, unset) */
  seedOf?: (n: number) => number;
  /** the mode to play at (unset: Settings') */
  mode?: SolveMode;
  /** how many tables it starts with, whatever is kept (unset: one, or those the kept doc brings back) */
  tables?: number;
  /** what's dealt above one table (unset: Settings', read at each deal, so it applies from each table's next hand) */
  spot?: Spot;
  seat?: SeatChoice;
  /** whether it asks ahead (unset: Settings', read at each pump, and until you've said, the measured default) */
  askAhead?: boolean;
  /** the tables' first hands, a test's spots, in place of `tables`, whatever is kept (unset: dealt) */
  hands?: readonly PracticeHand[];
  /** reads the kept doc (a test's waits, or doesn't) */
  readKept?: () => Promise<unknown>;
  /** reads the flop library's index, once the solver has resolved the library (a test's is its fixture) */
  readIndex?: () => Promise<unknown>;
}

/** A table as a view draws it. */
export interface RoomTable {
  hand: PracticeHand;
  /** the answer at your spot, once it's in hand, whole: its provenance reaches the verdict untouched */
  answer: SolveResult | null;
  /** why this step has no answer, your spot's or the move asked for (phaseOf says which); the table waits on you */
  failed: string | null;
  /** a move the table refused, a drill's deals used up, or a hand the doc couldn't bring back: said until the next move */
  error: string | null;
  last: Decision | null;
  /** your range at that decision (the answer's grid) */
  lastRange: RangeAt | null;
  /** your spot as a key, for `choose`, while it's your turn */
  turnKey: string | null;
  /** a drill's deals are used up: nothing happens here until Try again */
  spent: boolean;
  /** the hands finished at this table */
  stats: PotTally;
  /** what graded the decisions in `stats`, so the table's figures carry their source as the session's do */
  sources: PracticeSession["sources"];
  /** the last of them, once the next is dealt too */
  lastHand: LastHand | null;
}

export interface RoomSnapshot {
  session: PracticeSession;
  tables: readonly RoomTable[];
  kept: Kept | null;
  /** workers ended since this Room was made, for a stop they never answered */
  restarts: number;
  /** the table in front (not always one waiting for you: you can pick any) */
  focus: number;
  /** the tables waiting for you, in the order they started waiting */
  queue: readonly number[];
  /** the table in front is waiting, and its input isn't taken yet */
  guarded: boolean;
  /** the last hand to finish at a table in play, for K, whole: its table has usually dealt the next by then */
  ended: { table: number; hand: PracticeHand } | null;
  /** what a stop costs on the client in use, which says so before its worker has started (null: none yet) */
  stopCost: StopCost | null;
  flops: RoomFlops;
  ahead: { on: boolean; meter: AheadMeter };
}

/** A wait: the seconds from your turn to its buttons. `table`: from 1. */
export interface Wait {
  s: number;
  street: Street;
  table: number;
}

/** A request answered: the seconds it took, and what it was expected to. */
export interface Solved {
  s: number;
  est: number;
  kind: "you" | "opp";
  street: Street;
  /** it went out as a look-ahead, and nobody took it up on the way */
  ahead?: true;
}

export interface RoomMetrics {
  decisions: number;
  median: number | null;
  /** requests stopped */
  stops: number;
  /** moves drawn from a chart, and the charts held (multitable.js:841) */
  charted: number;
  charts: number;
  /** the last ones */
  waits: readonly Wait[];
  solves: readonly Solved[];
}

interface Table {
  hand: PracticeHand;
  /** when the hand got here: an opponent's move or a card waits for `pace` from then, a next hand for `pause` */
  since: number;
  timer: ReturnType<typeof setTimeout> | null;
  error: string | null;
  /** a drill's deals are used up: nothing is asked, and Try again deals afresh */
  spent: boolean;
  last: Decision | null;
  lastRange: RangeAt | null;
  stats: PotTally;
  sources: PracticeSession["sources"];
  lastHand: LastHand | null;
  /** the last hand finished here as it ended (in memory: `lastHand` is what the doc keeps of it) */
  finished: PracticeHand | null;
  /** your spot's key, and since when it's been your turn there */
  turnKey: string | null;
  turnAt: number;
  /** since when the answer has been in hand, your turn with buttons: the queue's order, which S rewrites */
  waiting: number | null;
  /** when that answer came, which nothing rewrites: the guard's */
  readyAt: number;
  /** the streets answered this hand: their next requests are nearly instant */
  solved: Set<string>;
  /** the flop last told the client */
  told: string;
}

interface Flight {
  job: Job;
  mode: SolveMode;
  /** when it went out */
  at: number;
  ac: AbortController;
  stopping: boolean;
  /** with the client: until then a stop costs nothing, on any backend */
  sent: boolean;
  /** it went out as a look-ahead and its time isn't on the meter yet: true until it settles, or a table takes it up */
  ahead: boolean;
}

/** The answers held for each cache (multitable.js:24). */
const CACHE_KEEP = 400;
/** the waits and solves held, and the first-wanted times */
const METRICS_KEEP = 2000;
const SEEN_KEEP = 1000;
/** ms the kept doc's read may hold the first request (a hung read starts fresh and leaves the doc alone), and a session
 * read back may wait for Settings */
const KEPT_WAIT = 1000;
/** ms between saves of the doc, but for those that go at once */
const SAVE_EVERY = 500;
const LOST_HAND = "This table's hand couldn't be brought back, so it was dealt again. Its results are kept.";

const FREE: Front = { focus: 0, focusAt: -Infinity, pin: false, next: false };
const randomSeed = () => Math.floor(Math.random() * 2 ** 31);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const trim = (m: Map<string, unknown>) => {
  for (const k of m.keys()) {
    if (m.size <= CACHE_KEEP) return;
    m.delete(k);
  }
};

export class Room {
  private readonly pace: number;
  private readonly pause: number;
  private readonly guard: number;
  private readonly now: () => number;
  private readonly persist: boolean;
  private readonly seedOf: (n: number) => number;
  private readonly fixedMode: SolveMode | undefined;
  private readonly fixedSpot: Spot | undefined;
  private readonly fixedSeat: SeatChoice | undefined;
  private readonly fixedAhead: boolean | undefined;
  private readonly readKept: () => Promise<unknown>;
  private readonly readIndex: () => Promise<unknown>;
  /** the options say what's on the tables, so the doc brings nothing back */
  private readonly fixed: boolean;

  private session: PracticeSession;
  private readonly tables: Table[];
  /** the tables above the count, at their places: their hands and results, for when there are as many again */
  private spare: (Table | undefined)[] = [];
  private front: Front = FREE;
  /** the next hand at one table starts every stack afresh (see `setTables`) */
  private resetStacks = false;
  /** the table a hand last finished at */
  private endedAt: Table | null = null;
  private kept: Kept | null = null;
  private snap: RoomSnapshot;
  private readonly listeners = new Set<() => void>();
  /** `start`ed and not `stop`ped */
  private live = false;
  /** the kept doc's read hasn't settled: nothing is asked */
  private holding: boolean;
  private holdTimer: ReturnType<typeof setTimeout> | undefined;
  /** what's left of the hold once Settings have loaded, where a session has been read back */
  private onLoaded: (() => void) | null = null;
  /** a `start`'s number, so a read from before a `stop` is ignored */
  private run = 0;
  private offSettings: (() => void) | null = null;
  private deals = 0;
  /** the session as last written to History */
  private wrote: PracticeSession | null = null;
  /** the mode last played, to see a flip */
  private played: SolveMode;
  /** what the doc holds as far as this Room knows: null, nothing; undefined, it can't say: no read has said, or a write was refused */
  private saved: KeptTables | null | undefined;
  private savedAt = -Infinity;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  /** the next save goes at once */
  private saveNow = false;
  /** the doc's session is over, for a move to one table or a New session, so one table's save clears it */
  private clearDoc = false;

  private solver: RoomSolver | null = null;
  private client: RoomClient | null = null;
  private flight: Flight | null = null;
  private readonly adv = new Map<string, SolveResult>();
  private readonly moves = new Map<string, SolveResult<PlayMove>>();
  private readonly failed = new Map<string, string>();
  /** by `chartKey`: null, a node's chart that can't be drawn from */
  private readonly charts = new Map<string, SolveResult | null>();
  private charted = 0;
  /** what Instant flops deals from: unread, on its way, or settled, read or not */
  private lib: FlopSpot[] | null = null;
  private libState: "idle" | "loading" | "ok" | "failed" = "idle";
  /** the read's number, so one from before a new solver is ignored */
  private libRun = 0;
  /** first wanted, by key: a job's `since` */
  private readonly seen = new Map<string, number>();
  /** the keys rejected as cancelled with nobody here stopping them, since the last answer */
  private readonly unasked = new Set<string>();
  /** what look-aheads failed on: for `walk` alone, so no table ever shows it */
  private readonly aheadBad = new Set<string>();
  /** the answers a look-ahead put in the caches that nothing has used, by key: the seconds each took */
  private readonly aheadHeld = new Map<string, number>();
  private habits: Habits;
  private meter: AheadMeter = NO_METER;
  private restarts = 0;
  private stops = 0;
  private readonly waits: Wait[] = [];
  private readonly solves: Solved[] = [];
  private guardTimer: ReturnType<typeof setTimeout> | undefined;

  /** Its tab is the one shown. The hand goes on hidden, as it always has: only asking ahead reads it. */
  active = true;

  constructor(o: RoomOptions = {}) {
    this.pace = o.pace ?? 450;
    this.pause = o.pause ?? 1600;
    this.guard = o.guard ?? 350;
    this.now = o.now ?? (() => performance.now());
    this.persist = o.persist ?? true;
    this.seedOf = o.seedOf ?? randomSeed;
    this.fixedMode = o.mode;
    this.readKept = o.readKept ?? (() => kvGet<unknown>(KEPT_KEY));
    this.readIndex =
      o.readIndex ??
      (async () => {
        await this.solver!();
        return flopIndex(useRuntime.getState().librarySource);
      });
    this.fixed = o.tables !== undefined || o.hands !== undefined;
    this.fixedSpot = o.spot;
    this.fixedSeat = o.seat;
    this.fixedAhead = o.askAhead;
    this.habits = this.persist ? readHabits() : {};
    this.holding = this.persist;
    this.played = this.mode;
    const hands = o.hands ?? [newHand(6, 100, 0, this.seed())];
    this.session = atTables({ ...freshSession(6, 100), dealt: hands.length }, hands.length);
    this.tables = hands.map((h) => this.table(h));
    this.snap = this.build();
    if (o.tables && !o.hands) this.setTables(o.tables);
  }

  private table(hand: PracticeHand): Table {
    return {
      hand,
      since: this.now(),
      timer: null,
      error: null,
      spent: false,
      last: null,
      lastRange: null,
      stats: emptyTally(),
      sources: {},
      lastHand: null,
      finished: null,
      turnKey: null,
      turnAt: 0,
      waiting: null,
      readyAt: -Infinity,
      solved: new Set(),
      told: "",
    };
  }

  // ---- for useSyncExternalStore

  readonly subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  readonly snapshot = () => this.snap;

  // ---- its life

  start(): void {
    if (this.live) return;
    this.live = true;
    this.offSettings = useSettings.subscribe((s) => {
      if (s.loaded) this.onLoaded?.();
      this.pump();
    });
    document.addEventListener("visibilitychange", this.pump);
    if (this.holding) this.hold();
    else this.pump();
  }

  /** Leaving: the flight is stopped, and stays until it settles, so a `start` can't send beside it. A save still waiting
   * goes now, or one that was refused, as nothing would come back for it. */
  stop(): void {
    if (!this.live) return;
    this.save(true);
    this.live = false;
    this.run += 1;
    this.offSettings?.();
    this.offSettings = null;
    document.removeEventListener("visibilitychange", this.pump);
    clearTimeout(this.holdTimer);
    clearTimeout(this.guardTimer);
    for (const t of this.tables) this.clearTimer(t);
    this.stopFlight();
  }

  /** From a layout effect, as settings load after the first render. A new solver lets the flight go at once: an HTTP
   * request outlives its client's `dispose`, and would hold the new client up. Its late answer is dropped. It can read
   * another library too, so the index is read again, as it is after a read that failed. */
  setSolver(solver: RoomSolver): void {
    if (solver === this.solver) return;
    this.solver = solver;
    if (this.flight) this.spend(this.flight);
    this.flight?.ac.abort();
    this.flight = null;
    this.lib = null;
    this.libState = "idle";
    this.libRun += 1;
    if (this.live) this.pump();
  }

  /** From a layout effect, with the solver. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.pump();
  }

  /** Nothing is asked until the doc has been read and what it holds brought back, all within KEPT_WAIT: a read that
   * hasn't answered by then is ignored when it does, and a session read back goes on without Settings. */
  private hold(): void {
    const run = (this.run += 1);
    let doc: KeptTables | null = null;
    const go = () => {
      if (run !== this.run || !this.holding) return;
      this.endHold();
      // (nothing done during the read is a reason to touch a doc nobody had seen)
      this.clearDoc = false;
      if (doc) this.restore(doc);
      this.pump();
    };
    const read = (x: unknown) => {
      if (run !== this.run || !this.holding) return;
      if (x === undefined || x === null) this.saved = null;
      doc = this.fixed ? null : keptTables(x);
      if (!doc || useSettings.getState().loaded) go();
      else this.onLoaded = go;
    };
    this.holdTimer = setTimeout(go, KEPT_WAIT);
    void this.readKept().then(read, go);
  }

  private endHold(): void {
    this.holding = false;
    clearTimeout(this.holdTimer);
  }

  /** The kept session in place of what was dealt, each table as it stood and those set aside at their places. History's
   * record already says all this: its row isn't touched until you move, so `endedAt` stays at your last. */
  private restore(k: KeptTables): void {
    this.session = this.wrote = k.session;
    // (what's in the browser is this: a reload that changes nothing writes nothing, so another tab's is left alone)
    this.saved = k;
    const back = k.tables.map((kept, i) => (kept || i < k.n ? this.brought(kept, k.n) : undefined));
    this.tables.splice(0, this.tables.length, ...(back.slice(0, k.n) as Table[]));
    this.spare = back.map((t, i) => (i < k.n ? undefined : t));
    this.front = { ...FREE, focus: k.focus };
  }

  /** A table from the doc. A hand that's lost is dealt again as any new hand, its results kept, and the table says so. */
  private brought(kept: KeptTable | null, n: number): Table {
    const s = this.session;
    const t = this.table(kept?.hand ?? newHand(s.players, s.stack, s.dealt, this.seed(), this.optsAt(n)));
    if (!kept?.hand) {
      this.session = afterDeal(s);
      t.error = LOST_HAND;
    }
    if (kept) {
      t.stats = kept.stats;
      t.sources = kept.sources ?? t.sources;
      t.last = kept.last;
      t.lastHand = kept.lastHand;
    }
    return t;
  }

  // ---- actions

  /** Every table starts again; what was set aside goes with the session it belonged to. */
  startSession(players: number, stack: number, opts: Required<HandOptions>): void {
    this.session = atTables(freshSession(players, stack, opts), this.tables.length);
    this.spare = [];
    for (const t of this.tables) {
      this.dealt(t, newHand(players, stack, this.session.dealt, this.seed(), this.opts));
      this.session = afterDeal(this.session);
      t.error = null;
      t.spent = false;
      t.last = null;
      t.lastRange = null;
      t.stats = emptyTally();
      t.sources = {};
      t.lastHand = null;
      t.finished = null;
    }
    // (a key has no seed, so the same cards can come up: what failed last session says nothing of this one)
    this.failed.clear();
    this.charts.clear();
    this.unasked.clear();
    this.aheadBad.clear();
    this.front = FREE;
    this.resetStacks = false;
    this.endedAt = null;
    this.endHold();
    this.saveNow = this.clearDoc = true;
    this.pump();
  }

  /** How many tables, 1 to 4. Up: your hand stays as Table 1, and the others take up what was set aside or deal. Down: the
   * tables above are set aside as they are, and a request only they needed goes the way of any dead flight. Back at one
   * table with chips carried, the next hand starts every stack afresh: `n` has jumped, and `nextTable` moves chips one
   * seat, so they'd land on another seat. */
  setTables(n: number): void {
    const to = Math.max(1, Math.min(MAX_TABLES, Math.floor(n) || 1));
    const from = this.tables.length;
    if (to === from) return;
    this.session = atTables(this.session, to);
    this.tables.splice(to).forEach((t, i) => {
      this.clearTimer(t);
      t.turnKey = null;
      t.waiting = null;
      t.told = "";
      this.spare[to + i] = t;
    });
    for (let i = from; i < to; i += 1) {
      const back = this.spare[i];
      this.spare[i] = undefined;
      if (back) back.since = this.now();
      this.tables.push(back ?? this.table(newHand(this.session.players, this.session.stack, this.session.dealt, this.seed(), this.optsAt(to))));
      if (back) this.tell(back);
      else this.session = afterDeal(this.session);
    }
    if (this.front.focus >= to) this.front = FREE;
    if (to === 1) this.resetStacks = this.clearDoc = true;
    this.saveNow = true;
    this.pump();
  }

  /** The table's next hand: with chips carried, from where this one left them (or, `reset`, every seat back at the
   * starting stack). Above one table it comes by itself, or by `dealFinished`. */
  nextHand(reset = false, table = this.front.focus): void {
    const t = this.tables[table];
    if (!t?.hand.result) return;
    this.deal(t, reset || this.resetStacks);
    this.resetStacks = false;
    this.pump();
  }

  /** Every finished table's next hand now, not after `pause`. */
  dealFinished(): void {
    if (!this.many) return;
    for (const t of this.tables) if (t.hand.result) this.deal(t);
    this.pump();
  }

  /** Your i-th option at your spot, graded against the answer in hand: at the table in front, or at `table` with the
   * `key` of the spot the option was drawn for, as a dock's button sends them. A press whose table isn't in front or whose
   * spot has gone is ignored, as is any inside the guard. */
  choose(i: number): void;
  choose(table: number, key: string, i: number): void;
  choose(first: number, key?: string, i = first): void {
    const table = key === undefined ? this.front.focus : first;
    const t = this.tables[table];
    if (!t || table !== this.front.focus || this.guardLeft() > 0) return;
    const h = t.hand;
    const sim = simOf(h);
    const need = this.needAt(h, this.mode, sim);
    const answer = need.kind === "you" && (key ?? need.key) === need.key ? this.adv.get(need.key) : undefined;
    if (!answer) return;
    const r = decide(h, answer.data, i, answer.provenance, sim);
    if ("error" in r) {
      t.error = r.error;
    } else {
      t.error = null;
      t.last = r.decision;
      t.lastRange = rangeAt(h, answer.data, answer.provenance, sim);
      this.noteHabit(facingBet(sim, h.hero), r.decision.move.action);
      this.session = afterDecision(this.session, h, r.decision, this.many ? table + 1 : undefined);
      this.saveNow = true;
      this.commit(t, r.hand);
      this.acted();
    }
    this.pump();
  }

  /** A move of your own where your spot has no answer: not graded. Only there: this records for whoever is to act, so
   * it can't be let near an opponent's seat. */
  ungraded(a: { action: string; to?: number }, table = this.front.focus): void {
    const t = this.tables[table];
    if (!t) return;
    const h = t.hand;
    const sim = simOf(h);
    const need = this.needAt(h, this.mode, sim);
    if (need.kind !== "you" || !this.failed.has(need.key)) return;
    const r = decideUngraded(h, a, sim);
    if (typeof r === "string") {
      t.error = r;
    } else {
      this.failed.delete(need.key);
      t.error = null;
      t.last = r.decisions.at(-1) ?? null;
      t.lastRange = null;
      this.saveNow = true;
      this.commit(t, r);
      this.acted();
    }
    this.pump();
  }

  /** An opponent's failed move played as a check or call, so the hand goes on. Not a solve, and not your decision. */
  playOn(table = this.front.focus): void {
    const t = this.tables[table];
    if (!t) return;
    const h = t.hand;
    const sim = simOf(h);
    const need = this.needAt(h, this.mode, sim);
    if (need.kind !== "opp" || !this.failed.has(need.key)) return;
    this.failed.delete(need.key);
    this.commit(t, withVillain(h, checkOrCall(h, sim), sim));
    this.acted();
    this.pump();
  }

  /** Try again, or Ask again: what failed asked once more, or a drill dealt afresh. */
  retry(table = this.front.focus): void {
    const t = this.tables[table];
    if (!t) return;
    t.error = null;
    if (t.spent) {
      t.spent = false;
      this.dealt(t, redeal({ ...t.hand, tries: 0 }, this.seed(), this.opts));
    } else {
      const need = this.needAt(t.hand, this.mode);
      if (need.kind === "you" || need.kind === "opp") this.failed.delete(need.key);
      t.since = this.now();
    }
    this.pump();
  }

  /** After your fold: the others play the hand out, or everyone's cards are shown. At one table: above it the next hand
   * comes by itself. */
  runOut(): void {
    if (this.many) return;
    const t = this.tables[0]!;
    const run = runKind(t.hand);
    if (!run) return;
    this.put(t, { ...t.hand, run });
    this.pump();
  }

  /** A table picked by a click or a tab: in front until you act there or pick another, also one not waiting for you. */
  pick(table: number): void {
    if (!this.tables[table] || table === this.front.focus) return;
    this.front = { focus: table, focusAt: -Infinity, pin: true, next: false };
    this.pump();
  }

  /** S: the next table waiting, the one in front to the back of the queue. Its `readyAt` stays: nothing here sets a guard. */
  skip(): void {
    const f = this.tables[this.front.focus];
    const q = queue(this.waiters).filter((i) => i !== this.front.focus);
    if (!f || !q.length) return;
    if (f.waiting !== null) f.waiting = Math.max(this.now(), ...q.map((i) => this.tables[i]!.waiting!)) + 1e-3;
    this.front = { focus: q[0]!, focusAt: -Infinity, pin: false, next: false };
    this.pump();
  }

  /** A finished hand into Analyze's hands: the table's last, with the next on the table by now above one table; and with
   * no table said, above it, the last to finish anywhere, which is the one you've just seen go. */
  keep(table = this.many ? this.ended?.table : this.front.focus): void {
    const t = table === undefined ? undefined : this.tables[table];
    const h = t?.hand.result ? t.hand : t?.finished;
    if (h) void this.keepHand(h);
  }

  private async keepHand(h: PracticeHand): Promise<void> {
    if (!this.persist) return;
    const s = this.session;
    const key = keyOf(s, h);
    this.setKept({ key, st: "saving" });
    try {
      const rec = practiceRecord(h, s, new Date());
      const res = await addHands([rec]);
      this.setKept(res ? { key, st: "kept", id: rec.id, had: res.existing > 0 } : { key, st: "error", message: "this browser keeps nothing here (a private window?)" });
    } catch (e) {
      this.setKept({ key, st: "error", message: message(e) });
    }
  }

  private setKept(k: Kept): void {
    this.kept = k;
    this.emit();
  }

  // ---- the loop

  /** Every table taken as far as it can go, the solver given its next request, and the views told. */
  readonly pump = (): void => {
    if (this.live && !this.holding) this.advance();
    this.emit();
  };

  private advance(): void {
    const mode = this.mode;
    if (mode !== this.played) {
      // (a flip asks again: the key has the mode, and a failure at another mode says nothing of this one)
      this.played = mode;
      this.failed.clear();
      for (const t of this.tables) t.since = this.now();
    }
    if (this.libState === "idle" && this.solver && (this.many || mode === "accurate" || this.tables.some((t) => needsIndex(t.hand)))) this.readLib();
    for (const t of this.tables) this.step(t, mode);
    const needs = this.tables.map((t) => this.needAt(t.hand, mode));
    this.tables.forEach((t, i) => this.turn(t, i, needs[i]!));
    this.front = refocus(this.front, this.waiters, this.now());
    this.watchGuard();
    const f = this.flight;
    const real = this.tables.flatMap((t, i) => this.wants(t, i, needs[i]!, mode));
    const next = plan(f, [...real, ...this.aheads(real, mode)], f && !f.sent ? "cheap" : this.stopCost);
    if (f && next.same) {
      // (a look-ahead your move made real goes on as the real one: what it's done already is waiting you didn't do)
      if (!next.same.ahead) this.spend(f, true);
      f.job = next.same;
    }
    if (next.stop) this.stopFlight();
    if (next.launch && this.solver) this.launch(next.launch, mode);
    if (this.seen.size > SEEN_KEEP) this.seen.clear();
  }

  /** The table as far as it can go by itself: cards out and moves taken, each in its own time (above one table nothing
   * waits to be followed), and the next hand once this one has had its moment. */
  private step(t: Table, mode: SolveMode): void {
    this.clearTimer(t);
    const pace = this.many ? 0 : this.pace;
    while (!t.spent) {
      const h = t.hand;
      if (this.many && h.result) {
        if (this.paced(t, this.pause)) return;
        this.deal(t);
        continue;
      }
      const sim = simOf(h);
      const need = this.needAt(h, mode, sim);
      if (need.kind === "index") {
        if (this.libState === "idle" || this.libState === "loading") return;
        // (every deal comes through here, a redeal too; nothing's been played, so where the library can't deal it, it's any hand)
        this.put(t, this.flopsOff ? { ...h, pot: undefined } : { ...h, cands: candsFor(this.held, h.hero, h.board) });
      } else if (offDrill(h, sim)) {
        // (a flop held on no line with you in it, off before a move)
        this.commit(t, h);
      } else if (need.kind === "deal") {
        if (this.paced(t, pace)) return;
        this.commit(t, dealNext(h, need.street));
        this.tell(t);
      } else if (need.kind === "opp") {
        const asked = this.moves.get(need.key)?.data;
        const mv = asked ?? chartDraw(h, need.play!.seat, this.many ? this.charts : undefined);
        if (!mv) return;
        // (a drill's preflop, dealt again until it's the pot, goes by at once)
        if (this.paced(t, seeking(h) ? 0 : pace)) return;
        this.moves.delete(need.key);
        const { move, fallback } = moveOf(h, mv, sim);
        if (fallback) return this.fail(need.key, fallback);
        this.usedAhead(need.key);
        if (!asked) this.charted += 1;
        this.commit(t, withVillain(h, move, sim));
      } else return;
    }
  }

  /** Whether `ms` from the hand's last change have still to run; if so the pump comes back as they end. */
  private paced(t: Table, ms: number): boolean {
    const left = t.since + ms - this.now();
    if (left <= 0) return false;
    t.timer = setTimeout(() => {
      t.timer = null;
      this.pump();
    }, Math.ceil(left));
    return true;
  }

  private clearTimer(t: Table): void {
    if (t.timer !== null) clearTimeout(t.timer);
    t.timer = null;
  }

  /** Whether the table is waiting for you, your turn with its answer in hand, and since when (multitable.js:229-236). */
  private turn(t: Table, i: number, need: Need): void {
    const key = need.kind === "you" ? need.key : null;
    if (t.turnKey !== key) {
      t.turnKey = key;
      t.turnAt = this.now();
      t.waiting = null;
    }
    if (need.kind !== "you" || !this.adv.has(need.key)) {
      t.waiting = null;
    } else if (t.waiting === null) {
      t.waiting = t.readyAt = this.now();
      this.waits.push({ s: (t.waiting - t.turnAt) / 1000, street: need.street, table: i + 1 });
      if (this.waits.length > METRICS_KEEP) this.waits.shift();
      this.usedAhead(need.key);
    }
  }

  private wants(t: Table, i: number, need: Need, mode: SolveMode): Job[] {
    if (t.spent || (this.many && t.hand.result)) return [];
    if (need.kind !== "you" && need.kind !== "opp" && need.kind !== "chart") return [];
    const inHand = need.kind === "you" ? this.adv.has(need.key) : this.moves.has(need.key);
    if (inHand || this.failed.has(need.key)) return [];
    return [{ need, table: i, est: this.estimate(t, need, mode), seeking: seeking(t.hand), since: this.firstWanted(need.key) }];
  }

  private estimate(t: Table, need: Asked, mode: SolveMode): number {
    const held = need.state.board?.length === 6 && libFlop(this.held, need.state);
    return estimate(need.state, mode, t.solved, this.client?.transport?.kind ?? "worker", held);
  }

  private firstWanted(key: string): number {
    const since = this.seen.get(key) ?? this.now();
    this.seen.set(key, since);
    return since;
  }

  /** What's asked ahead for the tables waiting for you: nothing unless it's on, the page is on screen with this tab shown
   * (it's CPU for a move nobody is about to make), and a wrong guess can be stopped, as it would otherwise block your real
   * request. `real`: what the tables want, which it never doubles. */
  private aheads(real: readonly Job[], mode: SolveMode): Job[] {
    if (!this.askAhead || !this.active || document.visibilityState !== "visible" || this.stopCost !== "cheap") return [];
    const waiting = this.tables.flatMap((t, table): Waiting[] => {
      const answer = this.adv.get(t.turnKey ?? "");
      return answer ? [{ table, hand: t.hand, answer }] : [];
    });
    return aheadJobs(waiting, {
      mode,
      focus: this.front.focus,
      habits: this.habits,
      real: new Set(real.map((j) => j.need.key)),
      adv: this.adv,
      moves: this.moves,
      bad: this.aheadBad,
      est: (table, need) => this.estimate(this.tables[table]!, need, mode),
      since: (key) => this.firstWanted(key),
    });
  }

  /** What you did, for your likeliest lines next time. */
  private noteHabit(facing: boolean, action: string): void {
    if (!this.persist) return;
    this.habits = habit(this.habits, facing, action);
    saveHabits(this.habits);
  }

  /** A table has just taken what a look-ahead asked for: the wait it would have had. */
  private usedAhead(key: string): void {
    const s = this.aheadHeld.get(key);
    if (s === undefined) return;
    this.aheadHeld.delete(key);
    this.meter = { ...this.meter, used: this.meter.used + 1, savedS: this.meter.savedS + s };
  }

  /** A look-ahead's time onto the meter, once: as it settles, or as a table takes it up (`used`), when the rest of it is a
   * wait like any other. One that never reached the client cost nothing. */
  private spend(fl: Flight, used = false): void {
    if (!fl.ahead) return;
    fl.ahead = false;
    if (!fl.sent) return;
    const s = (this.now() - fl.at) / 1000;
    const m = this.meter;
    this.meter = { ...m, spentS: m.spentS + s, used: m.used + (used ? 1 : 0), savedS: m.savedS + (used ? s : 0) };
  }

  /** You've moved at the table: the first in the queue comes forward, and a pin is over (`refocus`). */
  private acted(): void {
    this.front = { ...this.front, next: true };
  }

  /** The ms left of the guard at the table in front: a press within it was meant for what was there before. A click or S
   * sets none, as you've looked; but an answer that's only now come in can still catch a press. */
  private guardLeft(): number {
    const t = this.tables[this.front.focus];
    if (!this.many || !t || t.waiting === null) return 0;
    return Math.max(this.front.focusAt, t.readyAt) + this.guard - this.now();
  }

  /** The views are told as it ends, or a guard's dimmed buttons would wait for the next event. */
  private watchGuard(): void {
    clearTimeout(this.guardTimer);
    const left = this.guardLeft();
    if (left > 0) this.guardTimer = setTimeout(() => this.pump(), Math.ceil(left));
  }

  /** The hand after a move or a card: settled, and counted, where that ended it (and kept, where you keep them all). */
  private commit(t: Table, h: PracticeHand): void {
    // a drill's preflop gone another way: dealt again, not counted (up to DRILL_TRIES deals)
    if (offDrill(h)) {
      if ((h.tries ?? 0) + 1 < DRILL_TRIES) {
        this.dealt(t, redeal(h, this.seed(), this.opts));
      } else {
        t.error = `No ${potLabel(h.pot!).replace(/^an? /, "")} in ${DRILL_TRIES} deals${h.pot === "lib" ? " at this seat: try another seat or spot" : ""}.`;
        t.spent = true;
      }
      return;
    }
    if (h.result || phaseOf(h).kind !== "over") {
      this.put(t, h);
      return;
    }
    const result = finish(h);
    this.put(t, { ...h, result });
    this.session = afterHand(this.session, h, result);
    t.stats = addHandToPot(t.stats, h.decisions.map((d) => d.grade), this.session.opts.preflopOnly ? null : result.net);
    // (as the hand ends, with its tally, so these are the decisions `stats` counts)
    t.sources = h.decisions.reduce((s, d) => (d.grade ? addSource(s, d.provenance?.source) : s), t.sources);
    t.lastHand = { n: h.n, seat: h.hero, result };
    t.finished = t.hand;
    this.endedAt = t;
    this.saveNow = true;
    if (useSettings.getState().keepHands) void this.keepHand(t.hand);
  }

  private put(t: Table, h: PracticeHand): void {
    t.hand = h;
    t.since = this.now();
  }

  /** A new hand on the table: what was known of the last goes with it. */
  private dealt(t: Table, h: PracticeHand): void {
    this.put(t, h);
    t.solved.clear();
  }

  /** The hand's next step, as `needOf` says it: only above one table is a move played for you drawn from a chart. */
  private needAt(h: PracticeHand, mode: SolveMode, sim?: Sim): Need {
    return needOf(h, mode, sim, this.many ? this.charts : undefined);
  }

  /** The index, into `lib`. Its size only says whether Instant flops can be dealt: a read that fails holds nothing. */
  private readLib(): void {
    const run = (this.libRun += 1);
    this.libState = "loading";
    const settle = (index: unknown) => {
      if (run !== this.libRun) return;
      // (past `.then`'s rejection handler: a throw here would leave the tables on "loading" for good)
      try {
        this.lib = instantSpots(index);
      } catch {
        this.lib = [];
      }
      this.libState = this.lib.length ? "ok" : "failed";
      this.pump();
    };
    void this.readIndex().then(settle, () => settle(null));
  }

  private deal(t: Table, reset = false): void {
    this.dealt(t, following(t.hand, this.seed(), this.opts, reset, this.session.dealt));
    this.session = afterDeal(this.session);
    t.error = null;
  }

  /** Once a hand's flop is out the client is told, once for each table's flop: the worker fetches the library's files its
   * answers read ahead, so an answer the library holds needs no request of its own (index.html:1136-1145). A client sees
   * that it reaches each worker it starts (worker-transport.ts), so a new client is the only one to tell again, but it
   * keeps only the flop last told: above one table a new worker fetches that one ahead and the others as they're asked,
   * which costs a little time and nothing else. */
  private tell(t: Table): void {
    const h = t.hand;
    if (h.shown < 3) return;
    const flop: AdvisorState = { ...stateFor(h), board: h.board.slice(0, 3).join(""), flop: [], turn: [], river: [] };
    const k = JSON.stringify(flop);
    if (k === t.told) return;
    t.told = k;
    this.client?.prefetch?.(flop);
  }

  // ---- the one flight

  private launch(job: Job, mode: SolveMode): void {
    const fl: Flight = { job, mode, at: this.now(), ac: new AbortController(), stopping: false, sent: false, ahead: !!job.ahead };
    this.flight = fl;
    void this.ask(fl);
  }

  private async ask(fl: Flight): Promise<void> {
    const { need } = fl.job;
    const { mode } = fl;
    const { signal } = fl.ac;
    let r: SolveResult | SolveResult<PlayMove>;
    try {
      const client = await this.solver!();
      if (this.flight !== fl) return;
      // (stopped before anything was sent)
      if (signal.aborted) throw new SolverError("cancelled", "cancelled");
      const fresh = client !== this.client;
      this.useClient(client);
      // (walked from the last client's answers, which have just gone, and this one may not take back a wrong guess)
      if (fl.ahead && fresh) throw new SolverError("cancelled", "cancelled");
      fl.sent = true;
      if (fl.ahead) {
        this.meter = { ...this.meter, asked: this.meter.asked + 1 };
        this.emit();
      }
      r = need.kind !== "chart" && need.play ? await client.play(need.state, need.play, { mode, signal }) : await client.solve({ state: need.state, mode, signal });
    } catch (e) {
      this.lost(fl, e);
      return;
    }
    this.took(fl, r);
  }

  /** A new client starts from nothing: what the last one's answers were keyed to has gone with it. */
  private useClient(client: RoomClient): void {
    if (client === this.client) return;
    this.client = client;
    this.adv.clear();
    this.moves.clear();
    this.failed.clear();
    this.charts.clear();
    this.aheadBad.clear();
    this.aheadHeld.clear();
    for (const t of this.tables) {
      t.solved.clear();
      t.told = "";
      this.tell(t);
    }
    for (const t of this.spare) t?.solved.clear();
    this.emit();
  }

  /** An answer into the caches the tables read: a stop that came too late leaves a whole answer, which is kept too.
   * An `{error}` is a failure, never cached, and from a request we'd stopped not even that (see `lost`). */
  private took(fl: Flight, r: SolveResult | SolveResult<PlayMove>): void {
    if (r.data.cancelled) return this.lost(fl, new SolverError("cancelled", "cancelled"));
    if (this.flight !== fl) return;
    this.flight = null;
    this.unasked.clear();
    const { need, table } = fl.job;
    const s = (this.now() - fl.at) / 1000;
    const asked = fl.ahead;
    this.spend(fl);
    this.seen.delete(need.key);
    if (need.kind === "chart") {
      // (held as null only if it was drawn for and isn't one: a rule fallback is no chart, and an error from a request
      // we'd stopped says nothing)
      if (!r.data.error || !fl.stopping) this.chart(need.ck, isChart(r.data) && r.provenance.source === "charts" ? (r as SolveResult) : null);
    } else if (r.data.error) {
      if (!fl.stopping) this.miss(fl.job, r.data.error);
    } else {
      if (need.kind === "opp") {
        this.moves.set(need.key, r as SolveResult<PlayMove>);
        trim(this.moves);
      } else {
        this.adv.set(need.key, r);
        trim(this.adv);
      }
      if (asked) {
        this.aheadHeld.set(need.key, s);
        trim(this.aheadHeld);
      } else this.aheadHeld.delete(need.key);
      this.tables[table]?.solved.add(streetKey(need.state, fl.mode));
      this.solves.push({ s, est: fl.job.est, kind: need.kind, street: need.street, ...(asked ? { ahead: true as const } : {}) });
      if (this.solves.length > METRICS_KEEP) this.solves.shift();
    }
    this.pump();
  }

  /** A request rejected: a failure, by key, so it marks only a table still at that spot. A cancel stores nothing, nor
   * does a worker ended for not answering a stop, which is counted: what's still needed is asked again of a new one.
   * Nor does anything else from a request we'd stopped, as an HTTP solve runs on past its stop and can end in a 500:
   * nobody was waiting on that one, and a spot wanted again is asked again. */
  private lost(fl: Flight, e: unknown): void {
    if (this.flight !== fl) return;
    this.flight = null;
    this.spend(fl);
    const { key } = fl.job.need;
    this.seen.delete(key);
    const kind = e instanceof SolverError ? e.kind : null;
    const give = (why: string) => this.miss(fl.job, why);
    if (kind === "stuck") this.restarts += 1;
    if (!fl.stopping) {
      if (kind !== "cancelled" && kind !== "stuck") {
        give(message(e));
      } else {
        // (no stop of ours, a client gone, say: asked again, but a spot that's cancelled twice says so, or it goes round
        // for ever; tables with spots of their own would take turns at it, so it's every key since the last answer)
        if (this.unasked.has(key)) give("Stopped.");
        this.unasked.add(key);
      }
    }
    this.pump();
  }

  /** What a request that failed leaves. A look-ahead's is for `walk` alone: it marks no table and nobody was waiting on it.
   * A chart's marks no table either, as its seats are asked one by one. Any other marks its key. */
  private miss(job: Job, why: string): void {
    const { need } = job;
    if (job.ahead) noteBad(this.aheadBad, need.key);
    else if (need.kind === "chart") this.chart(need.ck, null);
    else this.fail(need.key, why);
  }

  private fail(key: string, why: string): void {
    this.failed.set(key, why);
    trim(this.failed);
  }

  private chart(ck: string, answer: SolveResult | null): void {
    this.charts.set(ck, answer);
    trim(this.charts);
  }

  private stopFlight(): void {
    const f = this.flight;
    if (!f || f.stopping) return;
    f.stopping = true;
    f.ac.abort();
    this.stops += 1;
  }

  // ---- what a view sees

  private get many(): boolean {
    return this.tables.length > 1;
  }

  /** What a stop costs on the client in use; until there is one it can't be said to be cheap. */
  private get stopCost(): StopCost {
    return this.client?.stopCost?.() ?? "kills";
  }

  private get askAhead(): boolean {
    return this.fixedAhead ?? useSettings.getState().askAhead ?? ASK_AHEAD;
  }

  private get ended(): RoomSnapshot["ended"] {
    const table = this.endedAt ? this.tables.indexOf(this.endedAt) : -1;
    const hand = this.tables[table]?.finished;
    return hand ? { table, hand } : null;
  }

  private get waiters(): Waiter[] {
    return this.tables.map((t) => ({ since: t.waiting, over: !!t.hand.result }));
  }

  private get opts(): Required<HandOptions> {
    return this.optsAt(this.tables.length);
  }

  /** The spots of this session's game. */
  private get held(): FlopSpot[] {
    const { players, stack, opts } = this.session;
    return heldSpots(this.lib ?? [], { players, stack, ante: opts.ante, straddle: opts.straddle, rake: opts.rake, sizes: opts.sizes });
  }

  /** Why Instant flops can't be dealt now. Before the index settles it can, so the hands dealt wait for it. */
  private get flopsOff(): FlopsOff | null {
    if (this.session.opts.preflopOnly) return "preflop";
    if (this.libState === "failed") return "failed";
    return this.lib && !this.held.length ? "game" : null;
  }

  private get flops(): RoomFlops {
    const { players, stack, opts } = this.session;
    const own = [opts.rake > 0 ? "a rake" : "", opts.sizes && Object.keys(opts.sizes).length ? "your own sizes" : ""].filter(Boolean);
    const game = gameWords({ players, stack, ante: opts.ante, straddle: opts.straddle });
    return { off: this.flopsOff, holds: gamesHeld(this.lib ?? []), game: own.length ? `${game} with ${own.join(" and ")}` : game };
  }

  /** What a hand is dealt by at `n` tables. At one, the session's own setup; above it, Spots and Seat and no chips carried.
   * Settings are read here, at the deal, not fed in by the page: a session read back deals a lost hand the moment they load,
   * before anything has rendered with them. */
  private optsAt(n: number): Required<HandOptions> {
    const o = this.session.opts;
    if (n === 1) return o;
    const set = useSettings.getState();
    const spot = spotOf(this.fixedSpot ?? set.practiceSpot, o.preflopOnly, this.flopsOff === null);
    return { ...o, seat: this.fixedSeat ?? seatOf(set.practiceSeat, this.session.players, spot), pot: spot === "any" ? null : spot, carry: false };
  }

  /** As the classic trainer, a Fast setting plays Quick's budgets after the flop (index.html budgetsFor). */
  private get mode(): SolveMode {
    return this.fixedMode ?? (useSettings.getState().mode === "accurate" ? "accurate" : "quick");
  }

  private seed(): number {
    return this.seedOf(this.deals++);
  }

  private build(): RoomSnapshot {
    const mode = this.mode;
    const tables = this.tables.map((t): RoomTable => {
      const need = this.needAt(t.hand, mode);
      const asked = need.kind === "you" || need.kind === "opp" ? need : null;
      return {
        hand: t.hand,
        answer: asked?.kind === "you" ? (this.adv.get(asked.key) ?? null) : null,
        failed: asked ? (this.failed.get(asked.key) ?? null) : null,
        error: t.error,
        last: t.last,
        lastRange: t.lastRange,
        turnKey: asked?.kind === "you" ? asked.key : null,
        spent: t.spent,
        stats: t.stats,
        sources: t.sources,
        lastHand: t.lastHand,
      };
    });
    return {
      session: this.session,
      tables,
      kept: this.kept,
      restarts: this.restarts,
      focus: this.front.focus,
      queue: queue(this.waiters),
      guarded: this.guardLeft() > 0,
      ended: this.ended,
      stopCost: this.client ? this.stopCost : null,
      flops: this.flops,
      ahead: { on: this.askAhead, meter: this.meter },
    };
  }

  /** How the waits went, per decision (multitable.js:838-844). */
  metrics(): RoomMetrics {
    const w = this.waits.map((x) => x.s).sort((a, b) => a - b);
    return {
      decisions: w.length,
      median: w.length ? Math.round(w[Math.floor(w.length / 2)]! * 100) / 100 : null,
      stops: this.stops,
      charted: this.charted,
      charts: this.charts.size,
      waits: this.waits.slice(-200),
      solves: this.solves.slice(-200),
    };
  }

  private emit(): void {
    this.record();
    this.save();
    this.snap = this.build();
    for (const fn of this.listeners) fn();
  }

  /** The session for History, as a decision is graded or a hand ends (a deal moves `dealt` alone, which no record
   * holds: nothing to write, and `endedAt` stays at your last move). */
  private record(): void {
    const s = this.session;
    const w = this.wrote;
    if (!this.persist || (w && w.id === s.id && w.hands === s.hands && w.score === s.score)) return;
    this.wrote = s;
    if (s.hands || s.score.n) void putSession(toRecord(s, s.tables)).catch(() => {});
  }

  /** The doc as things stand: above one table only. */
  private doc(): KeptTables {
    const place = (t: Table | undefined): KeptTable | null => (t ? { hand: t.hand, stats: t.stats, sources: t.sources, last: t.last, lastHand: t.lastHand } : null);
    return {
      v: 1,
      n: this.tables.length as KeptTables["n"],
      focus: this.front.focus,
      session: this.session,
      tables: Array.from({ length: MAX_TABLES }, (_, i) => place(this.tables[i] ?? this.spare[i])),
    };
  }

  /** The doc into this browser where it's changed: at once after a decision, a hand's end, a change of tables or a New
   * session, otherwise at most twice a second, as a drill's deals flash by (multitable.js:63-72, though a save waiting
   * here isn't put off by the next change, so a stream of them can't starve it). At one table nothing is kept, and only
   * `clearDoc` clears what's there: nothing else is a reason to touch a doc this Room couldn't read. A write the browser
   * refuses leaves `saved` unsaid, unless a later one has claimed it, so the next save tries again. Two tabs: the last to
   * write wins. */
  private save(force = this.saveNow): void {
    if (!this.persist || !this.live || this.holding) return;
    const doc = this.many ? this.doc() : null;
    const changed = doc ? !sameKept(doc, this.saved) : this.clearDoc && this.saved !== null;
    const left = this.savedAt + SAVE_EVERY - this.now();
    if (changed && !force && left > 0) {
      this.saveTimer ??= setTimeout(() => this.save(true), Math.ceil(left));
      return;
    }
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.saveNow = false;
    if (!changed) return;
    this.saved = doc;
    this.savedAt = this.now();
    void kvSet(KEPT_KEY, doc).catch(() => {
      if (this.saved === doc) this.saved = undefined;
    });
  }
}
