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
// `start`, `stop`, `start` works, as StrictMode runs it. `start` reads the kept doc first, raced against KEPT_WAIT
// because `kvGet` waits for ever while an older tab blocks an upgrade, and sends nothing until that settles; a New
// session meanwhile wins. The page draws the hand all the while. Nothing is restored from the doc yet.
import { kvGet, putSession } from "@/data/db";
import { addHands } from "@/data/hands";
import { addHandToPot, emptyTally, type PotTally } from "@/features/history/history";
import type { Street } from "@/poker/table";
import type { SolverClient } from "@/solver/client";
import type { AdvisorState, PlayMove } from "@/solver/protocol";
import { SolverError, type SolveMode, type SolverTransport, type SolveResult } from "@/solver/types";
import { useSettings } from "@/state/settings";
import { moveOf, needOf, type Need } from "./flow";
import { practiceRecord } from "./history";
import {
  checkOrCall,
  dealNext,
  decide,
  decideUngraded,
  DRILL_TRIES,
  finish,
  following,
  newHand,
  offDrill,
  phaseOf,
  POT_DRILLS,
  rangeAt,
  redeal,
  runKind,
  seeking,
  simOf,
  stateFor,
  withVillain,
  type Decision,
  type HandOptions,
  type PotDrill,
  type PracticeHand,
  type RangeAt,
  type SeatChoice,
} from "./practice";
import { estimate, plan, queue, refocus, streetKey, type Front, type Job, type Waiter } from "./scheduler";
import { afterDeal, afterDecision, afterHand, atTables, freshSession, keyOf, toRecord, type Kept, type PracticeSession } from "./session";

/** What the Room asks of a client (a test's is a fake). */
export type RoomClient = Pick<SolverClient, "solve" | "play"> & Partial<Pick<SolverClient, "prefetch" | "stopCost">> & { transport?: Pick<SolverTransport, "kind"> };
export type RoomSolver = () => Promise<RoomClient>;

/** What the tables deal above one table: any hand, or one kind of pot. */
export type Spot = PotDrill | "any";

export interface RoomOptions {
  /** ms an opponent's move and a new card take at least at one table, so the hand can be followed (0 in tests) */
  pace?: number;
  /** ms a finished hand stays on its table above one table, before that table deals again */
  pause?: number;
  /** ms your input waits above one table, from when the table in front changed by itself or its answer came in */
  guard?: number;
  now?: () => number;
  /** false: nothing is read or written: no kept doc, no record in History, no hand in Analyze */
  persist?: boolean;
  /** the seed of the n-th deal, a drill's deals again counted (at random, unset) */
  seedOf?: (n: number) => number;
  /** the mode to play at (unset: Settings') */
  mode?: SolveMode;
  /** how many tables it starts with (unset: one) */
  tables?: number;
  /** what's dealt above one table (unset: any hand, at a random seat) */
  spot?: Spot;
  seat?: SeatChoice;
  /** the tables' first hands, a test's spots, in place of `tables` (unset: dealt) */
  hands?: readonly PracticeHand[];
  /** reads the kept doc (a test's waits, or doesn't) */
  readKept?: () => Promise<unknown>;
}

/** A table as a view draws it. */
export interface RoomTable {
  hand: PracticeHand;
  /** the answer at your spot, once it's in hand, whole: its provenance reaches the verdict untouched */
  answer: SolveResult | null;
  /** why this step has no answer, your spot's or the move asked for (phaseOf says which); the table waits on you */
  failed: string | null;
  /** a move the table refused, or a drill's deals used up: said until the next move */
  error: string | null;
  last: Decision | null;
  /** your range at that decision (the answer's grid) */
  lastRange: RangeAt | null;
  /** your spot as a key, for `choose`, while it's your turn */
  turnKey: string | null;
  /** the hands finished at this table */
  stats: PotTally;
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
}

export interface RoomMetrics {
  decisions: number;
  median: number | null;
  /** requests stopped */
  stops: number;
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
}

/** The answers held for each cache (multitable.js:24). */
const CACHE_KEEP = 400;
const MAX_TABLES = 4;
/** the waits and solves held, and the first-wanted times */
const METRICS_KEEP = 2000;
const SEEN_KEEP = 1000;
const KEPT_KEY = "practice.tables.v1";
/** ms the kept doc's read may hold the first request (a hung read starts fresh and leaves the doc alone) */
const KEPT_WAIT = 1000;

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
  private readonly readKept: () => Promise<unknown>;

  private spot: Spot;
  private seat: SeatChoice;

  private session: PracticeSession;
  private readonly tables: Table[];
  /** the tables above the count, at their places: their hands and results, for when there are as many again */
  private spare: (Table | undefined)[] = [];
  private front: Front = FREE;
  /** the next hand at one table starts every stack afresh (see `setTables`) */
  private resetStacks = false;
  private kept: Kept | null = null;
  private snap: RoomSnapshot;
  private readonly listeners = new Set<() => void>();
  /** `start`ed and not `stop`ped */
  private live = false;
  /** the kept doc's read hasn't settled: nothing is asked */
  private holding: boolean;
  private holdTimer: ReturnType<typeof setTimeout> | undefined;
  /** a `start`'s number, so a read from before a `stop` is ignored */
  private run = 0;
  private offSettings: (() => void) | null = null;
  private deals = 0;
  /** the session as last written to History */
  private wrote: PracticeSession | null = null;
  /** the mode last played, to see a flip */
  private played: SolveMode;

  private solver: RoomSolver | null = null;
  private client: RoomClient | null = null;
  private flight: Flight | null = null;
  private readonly adv = new Map<string, SolveResult>();
  private readonly moves = new Map<string, SolveResult<PlayMove>>();
  private readonly failed = new Map<string, string>();
  /** first wanted, by key: a job's `since` */
  private readonly seen = new Map<string, number>();
  /** the keys rejected as cancelled with nobody here stopping them, since the last answer */
  private readonly unasked = new Set<string>();
  private restarts = 0;
  private stops = 0;
  private readonly waits: Wait[] = [];
  private readonly solves: Solved[] = [];
  private guardTimer: ReturnType<typeof setTimeout> | undefined;

  /** Its tab is the one shown. The hand goes on hidden, as it always has, so nothing here reads it yet. */
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
    this.spot = o.spot ?? "any";
    this.seat = o.seat ?? "random";
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
    this.offSettings = useSettings.subscribe(() => this.pump());
    if (this.holding) this.hold();
    else this.pump();
  }

  /** Leaving: the flight is stopped, and stays until it settles, so a `start` can't send beside it. */
  stop(): void {
    if (!this.live) return;
    this.live = false;
    this.run += 1;
    this.offSettings?.();
    this.offSettings = null;
    clearTimeout(this.holdTimer);
    clearTimeout(this.guardTimer);
    for (const t of this.tables) this.clearTimer(t);
    this.stopFlight();
  }

  /** From a layout effect, as settings load after the first render. A new solver lets the flight go at once: an HTTP
   * request outlives its client's `dispose`, and would hold the new client up. Its late answer is dropped. */
  setSolver(solver: RoomSolver): void {
    if (solver === this.solver) return;
    this.solver = solver;
    this.flight?.ac.abort();
    this.flight = null;
    if (this.live) this.pump();
  }

  /** From a layout effect, with the solver. */
  setActive(active: boolean): void {
    this.active = active;
  }

  private hold(): void {
    const run = (this.run += 1);
    const done = () => {
      if (run !== this.run || !this.holding) return;
      this.endHold();
      this.pump();
    };
    this.holdTimer = setTimeout(done, KEPT_WAIT);
    void this.readKept().then(done, done);
  }

  private endHold(): void {
    this.holding = false;
    clearTimeout(this.holdTimer);
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
    }
    // (a key has no seed, so the same cards can come up: what failed last session says nothing of this one)
    this.failed.clear();
    this.unasked.clear();
    this.front = FREE;
    this.resetStacks = false;
    this.endHold();
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
    if (to === 1) this.resetStacks = true;
    this.pump();
  }

  /** What the tables deal above one table, from each table's next hand: a change never redeals. */
  setSpot(spot: Spot): void {
    this.spot = spot;
  }

  setSeat(seat: SeatChoice): void {
    this.seat = seat;
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
    const need = needOf(h, this.mode, sim);
    const answer = need.kind === "you" && (key ?? need.key) === need.key ? this.adv.get(need.key) : undefined;
    if (!answer) return;
    const r = decide(h, answer.data, i, answer.provenance, sim);
    if ("error" in r) {
      t.error = r.error;
    } else {
      t.error = null;
      t.last = r.decision;
      t.lastRange = rangeAt(h, answer.data, answer.provenance, sim);
      this.session = afterDecision(this.session, h, r.decision, this.many ? table + 1 : undefined);
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
    const need = needOf(h, this.mode, sim);
    if (need.kind !== "you" || !this.failed.has(need.key)) return;
    const r = decideUngraded(h, a, sim);
    if (typeof r === "string") {
      t.error = r;
    } else {
      this.failed.delete(need.key);
      t.error = null;
      t.last = r.decisions.at(-1) ?? null;
      t.lastRange = null;
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
    const need = needOf(h, this.mode, sim);
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
      const need = needOf(t.hand, this.mode);
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

  /** The finished hand into Analyze's hands. */
  keep(table = this.front.focus): void {
    const t = this.tables[table];
    if (t) void this.keepHand(t.hand);
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
  pump(): void {
    if (this.live && !this.holding) this.advance();
    this.emit();
  }

  private advance(): void {
    const mode = this.mode;
    if (mode !== this.played) {
      // (a flip asks again: the key has the mode, and a failure at another mode says nothing of this one)
      this.played = mode;
      this.failed.clear();
      for (const t of this.tables) t.since = this.now();
    }
    for (const t of this.tables) this.step(t, mode);
    const needs = this.tables.map((t) => needOf(t.hand, mode));
    this.tables.forEach((t, i) => this.turn(t, i, needs[i]!));
    this.front = refocus(this.front, this.waiters, this.now());
    this.watchGuard();
    const f = this.flight;
    const next = plan(f, this.tables.flatMap((t, i) => this.wants(t, i, needs[i]!, mode)), f && !f.sent ? "cheap" : (this.client?.stopCost?.() ?? "kills"));
    if (f && next.same) f.job = next.same;
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
      const need = needOf(h, mode, sim);
      if (need.kind === "deal") {
        if (this.paced(t, pace)) return;
        this.commit(t, dealNext(h, need.street));
        this.tell(t);
      } else if (need.kind === "opp" && this.moves.has(need.key)) {
        // (a drill's preflop, dealt again until it's the pot, goes by at once)
        if (this.paced(t, seeking(h) ? 0 : pace)) return;
        const mv = this.moves.get(need.key)!;
        this.moves.delete(need.key);
        const { move, fallback } = moveOf(h, mv.data, sim);
        if (fallback) return this.fail(need.key, fallback);
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
    }
  }

  private wants(t: Table, i: number, need: Need, mode: SolveMode): Job[] {
    if (t.spent || (this.many && t.hand.result)) return [];
    if (need.kind !== "you" && need.kind !== "opp") return [];
    const inHand = need.kind === "you" ? this.adv.has(need.key) : this.moves.has(need.key);
    if (inHand || this.failed.has(need.key)) return [];
    const since = this.seen.get(need.key) ?? this.now();
    this.seen.set(need.key, since);
    return [{ need, table: i, est: estimate(need.state, mode, t.solved, this.client?.transport?.kind ?? "worker"), seeking: seeking(t.hand), since }];
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
        t.error = `No ${POT_DRILLS[h.pot!].one.replace(/^an? /, "")} in ${DRILL_TRIES} deals.`;
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
    const fl: Flight = { job, mode, at: this.now(), ac: new AbortController(), stopping: false, sent: false };
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
      this.useClient(client);
      fl.sent = true;
      r = need.play ? await client.play(need.state, need.play, { mode, signal }) : await client.solve({ state: need.state, mode, signal });
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
    for (const t of this.tables) {
      t.solved.clear();
      t.told = "";
      this.tell(t);
    }
    for (const t of this.spare) t?.solved.clear();
  }

  /** An answer into the caches the tables read: a stop that came too late leaves a whole answer, which is kept too.
   * An `{error}` is a failure, never cached, and from a request we'd stopped not even that (see `lost`). */
  private took(fl: Flight, r: SolveResult | SolveResult<PlayMove>): void {
    if (r.data.cancelled) return this.lost(fl, new SolverError("cancelled", "cancelled"));
    if (this.flight !== fl) return;
    this.flight = null;
    this.unasked.clear();
    const { need, table } = fl.job;
    this.seen.delete(need.key);
    if (r.data.error) {
      if (!fl.stopping) this.fail(need.key, r.data.error);
    } else {
      if (need.kind === "opp") {
        this.moves.set(need.key, r as SolveResult<PlayMove>);
        trim(this.moves);
      } else {
        this.adv.set(need.key, r);
        trim(this.adv);
      }
      this.tables[table]?.solved.add(streetKey(need.state, fl.mode));
      this.solves.push({ s: (this.now() - fl.at) / 1000, est: fl.job.est, kind: need.kind, street: need.street });
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
    const { key } = fl.job.need;
    this.seen.delete(key);
    const kind = e instanceof SolverError ? e.kind : null;
    if (kind === "stuck") this.restarts += 1;
    if (!fl.stopping) {
      if (kind !== "cancelled" && kind !== "stuck") {
        this.fail(key, message(e));
      } else {
        // (no stop of ours, a client gone, say: asked again, but a spot that's cancelled twice says so, or it goes round
        // for ever; tables with spots of their own would take turns at it, so it's every key since the last answer)
        if (this.unasked.has(key)) this.fail(key, "Stopped.");
        this.unasked.add(key);
      }
    }
    this.pump();
  }

  private fail(key: string, why: string): void {
    this.failed.set(key, why);
    trim(this.failed);
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

  private get waiters(): Waiter[] {
    return this.tables.map((t) => ({ since: t.waiting, over: !!t.hand.result }));
  }

  private get opts(): Required<HandOptions> {
    return this.optsAt(this.tables.length);
  }

  /** What a hand is dealt by at `n` tables. At one, the session's own setup; above it, Spots and Seat, no chips carried, and
   * a preflop-only session stays on Any hand, as a drill would stop it counting net. */
  private optsAt(n: number): Required<HandOptions> {
    const o = this.session.opts;
    return n === 1 ? o : { ...o, seat: this.seat, pot: this.spot === "any" || o.preflopOnly ? null : this.spot, carry: false };
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
      const need = needOf(t.hand, mode);
      const asked = need.kind === "you" || need.kind === "opp" ? need : null;
      return {
        hand: t.hand,
        answer: asked?.kind === "you" ? (this.adv.get(asked.key) ?? null) : null,
        failed: asked ? (this.failed.get(asked.key) ?? null) : null,
        error: t.error,
        last: t.last,
        lastRange: t.lastRange,
        turnKey: asked?.kind === "you" ? asked.key : null,
        stats: t.stats,
      };
    });
    return { session: this.session, tables, kept: this.kept, restarts: this.restarts, focus: this.front.focus, queue: queue(this.waiters), guarded: this.guardLeft() > 0 };
  }

  /** How the waits went, per decision (multitable.js:838-844). */
  metrics(): RoomMetrics {
    const w = this.waits.map((x) => x.s).sort((a, b) => a - b);
    return { decisions: w.length, median: w.length ? Math.round(w[Math.floor(w.length / 2)]! * 100) / 100 : null, stops: this.stops, waits: this.waits.slice(-200), solves: this.solves.slice(-200) };
  }

  private emit(): void {
    this.record();
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
}
