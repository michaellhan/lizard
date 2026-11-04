// A Room runs Practice's tables: it deals, asks the solver what each hand needs next, takes the answers and keeps the
// session, so a view only draws its snapshot and calls its actions. It alone owns the clock, the timers and the
// promises. Answers go into caches by key (flow.ts builds a key with its request) and a table pulls from them, so a
// late answer can't land on a hand that has moved on: at worst it waits in a cache for a spot nobody reaches. The
// solver answers one request at a time, so one is in flight: `flight` is set before the first await, or two pumps would
// launch twice, and held until the request settles, a stopped one too (about 0.1 s on an isolated worker), as the
// next would queue behind it anyway. A failure is held by key as well, so it only ever shows on the spot it was for.
//
// `start`, `stop`, `start` works, as StrictMode runs it. `start` reads the kept doc first, raced against KEPT_WAIT
// because `kvGet` waits for ever while an older tab blocks an upgrade, and sends nothing until that settles; a New
// session meanwhile wins. The page draws the hand all the while. Nothing is restored from the doc yet.
import { kvGet, putSession } from "@/data/db";
import { addHands } from "@/data/hands";
import type { SolverClient } from "@/solver/client";
import type { AdvisorState, PlayMove } from "@/solver/protocol";
import { SolverError, type SolveMode, type SolveResult } from "@/solver/types";
import { useSettings } from "@/state/settings";
import { moveOf, needOf } from "./flow";
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
  type PracticeHand,
  type RangeAt,
} from "./practice";
import { plan, type Job } from "./scheduler";
import { afterDeal, afterDecision, afterHand, freshSession, keyOf, toRecord, type Kept, type PracticeSession } from "./session";

/** What the Room asks of a client (a test's is a fake). */
export type RoomClient = Pick<SolverClient, "solve" | "play"> & Partial<Pick<SolverClient, "prefetch">>;
export type RoomSolver = () => Promise<RoomClient>;

export interface RoomOptions {
  /** ms an opponent's move and a new card take at least, so the hand can be followed (0 in tests) */
  pace?: number;
  now?: () => number;
  /** false: nothing is read or written: no kept doc, no record in History, no hand in Analyze */
  persist?: boolean;
  /** the seed of the n-th deal, a drill's deals again counted (at random, unset) */
  seedOf?: (n: number) => number;
  /** the mode to play at (unset: Settings') */
  mode?: SolveMode;
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
}

export interface RoomSnapshot {
  session: PracticeSession;
  tables: readonly RoomTable[];
  kept: Kept | null;
}

interface Table {
  hand: PracticeHand;
  /** when the hand got here: an opponent's move or a card waits for `pace` from then */
  since: number;
  timer: ReturnType<typeof setTimeout> | null;
  error: string | null;
  /** a drill's deals are used up: nothing is asked, and Try again deals afresh */
  spent: boolean;
  last: Decision | null;
  lastRange: RangeAt | null;
}

interface Flight {
  job: Job;
  ac: AbortController;
  stopping: boolean;
}

/** The answers held for each cache (multitable.js:24). */
const CACHE_KEEP = 400;
const KEPT_KEY = "practice.tables.v1";
/** ms the kept doc's read may hold the first request (a hung read starts fresh and leaves the doc alone) */
const KEPT_WAIT = 1000;

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
  private readonly now: () => number;
  private readonly persist: boolean;
  private readonly seedOf: (n: number) => number;
  private readonly fixedMode: SolveMode | undefined;
  private readonly readKept: () => Promise<unknown>;

  private session: PracticeSession;
  private readonly tables: Table[];
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
  /** the key last rejected as cancelled with nobody here stopping it */
  private unasked = "";
  private prefetched = "";

  /** Its tab is the one shown. The hand goes on hidden, as it always has, so nothing here reads it yet. */
  active = true;

  constructor(o: RoomOptions = {}) {
    this.pace = o.pace ?? 450;
    this.now = o.now ?? (() => performance.now());
    this.persist = o.persist ?? true;
    this.seedOf = o.seedOf ?? randomSeed;
    this.fixedMode = o.mode;
    this.readKept = o.readKept ?? (() => kvGet<unknown>(KEPT_KEY));
    this.holding = this.persist;
    this.played = this.mode;
    this.session = afterDeal(freshSession(6, 100));
    this.tables = [{ hand: newHand(6, 100, 0, this.seed()), since: this.now(), timer: null, error: null, spent: false, last: null, lastRange: null }];
    this.snap = this.build();
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

  startSession(players: number, stack: number, opts: Required<HandOptions>): void {
    const s = freshSession(players, stack, opts);
    const t = this.front;
    this.session = afterDeal(s);
    this.put(t, newHand(players, stack, s.dealt, this.seed(), opts));
    t.error = null;
    t.spent = false;
    t.last = null;
    t.lastRange = null;
    this.endHold();
    this.pump();
  }

  /** The next hand: with chips carried, from where this one left them (or, `reset`, every seat back at the starting stack). */
  nextHand(reset = false): void {
    const t = this.front;
    if (!t.hand.result) return;
    this.put(t, following(t.hand, this.seed(), this.session.opts, reset, this.session.dealt));
    this.session = afterDeal(this.session);
    t.error = null;
    this.pump();
  }

  /** Your i-th option at your spot, graded against the answer in hand. */
  choose(i: number): void {
    const t = this.front;
    const h = t.hand;
    const sim = simOf(h);
    const need = needOf(h, this.mode, sim);
    const answer = need.kind === "you" ? this.adv.get(need.key) : undefined;
    if (!answer) return;
    const r = decide(h, answer.data, i, answer.provenance, sim);
    if ("error" in r) {
      t.error = r.error;
    } else {
      t.error = null;
      t.last = r.decision;
      t.lastRange = rangeAt(h, answer.data, answer.provenance, sim);
      this.session = afterDecision(this.session, h, r.decision);
      this.commit(t, r.hand);
    }
    this.pump();
  }

  /** A move of your own where your spot has no answer: not graded. Only there: this records for whoever is to act, so
   * it can't be let near an opponent's seat. */
  ungraded(a: { action: string; to?: number }): void {
    const t = this.front;
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
    }
    this.pump();
  }

  /** An opponent's failed move played as a check or call, so the hand goes on. Not a solve, and not your decision. */
  playOn(): void {
    const t = this.front;
    const h = t.hand;
    const sim = simOf(h);
    const need = needOf(h, this.mode, sim);
    if (need.kind !== "opp" || !this.failed.has(need.key)) return;
    this.failed.delete(need.key);
    this.commit(t, withVillain(h, checkOrCall(h, sim), sim));
    this.pump();
  }

  /** Try again, or Ask again: what failed asked once more, or a drill dealt afresh. */
  retry(): void {
    const t = this.front;
    t.error = null;
    if (t.spent) {
      t.spent = false;
      this.put(t, redeal({ ...t.hand, tries: 0 }, this.seed(), this.session.opts));
    } else {
      const need = needOf(t.hand, this.mode);
      if (need.kind === "you" || need.kind === "opp") this.failed.delete(need.key);
      t.since = this.now();
    }
    this.pump();
  }

  /** After your fold: the others play the hand out, or everyone's cards are shown. */
  runOut(): void {
    const t = this.front;
    const run = runKind(t.hand);
    if (!run) return;
    this.put(t, { ...t.hand, run });
    this.pump();
  }

  /** The finished hand into Analyze's hands. */
  keep(): void {
    void this.keepHand(this.front.hand);
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
    const f = this.flight;
    const next = plan(f && { key: f.job.need.key, stopping: f.stopping }, this.tables.flatMap((t, i) => this.wants(t, i, mode)));
    if (next.stop) this.stopFlight();
    if (next.launch && this.solver) this.launch(next.launch, mode);
  }

  /** The table as far as it can go by itself: cards out and moves taken, each in its own time. */
  private step(t: Table, mode: SolveMode): void {
    this.clearTimer(t);
    while (!t.spent) {
      const h = t.hand;
      const sim = simOf(h);
      const need = needOf(h, mode, sim);
      if (need.kind === "deal") {
        if (this.paced(t, this.pace)) return;
        this.commit(t, dealNext(h, need.street));
        this.prefetch(t.hand);
      } else if (need.kind === "opp" && this.moves.has(need.key)) {
        // (a drill's preflop, dealt again until it's the pot, goes by at once)
        if (this.paced(t, seeking(h) ? 0 : this.pace)) return;
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

  private wants(t: Table, i: number, mode: SolveMode): Job[] {
    if (t.spent) return [];
    const need = needOf(t.hand, mode);
    if (need.kind !== "you" && need.kind !== "opp") return [];
    const inHand = need.kind === "you" ? this.adv.has(need.key) : this.moves.has(need.key);
    return inHand || this.failed.has(need.key) ? [] : [{ need, table: i }];
  }

  /** The hand after a move or a card: settled, and counted, where that ended it (and kept, where you keep them all). */
  private commit(t: Table, h: PracticeHand): void {
    // a drill's preflop gone another way: dealt again, not counted (up to DRILL_TRIES deals)
    if (offDrill(h)) {
      if ((h.tries ?? 0) + 1 < DRILL_TRIES) {
        this.put(t, redeal(h, this.seed(), this.session.opts));
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
    if (useSettings.getState().keepHands) void this.keepHand(t.hand);
  }

  private put(t: Table, h: PracticeHand): void {
    t.hand = h;
    t.since = this.now();
  }

  /** Once a hand's flop is out the client is told, once a flop: the worker fetches the library's files its answers read
   * ahead, so an answer the library holds needs no request of its own (index.html:1136-1145). */
  private prefetch(h: PracticeHand): void {
    if (h.shown < 3) return;
    const flop: AdvisorState = { ...stateFor(h), board: h.board.slice(0, 3).join(""), flop: [], turn: [], river: [] };
    const k = JSON.stringify(flop);
    if (k === this.prefetched) return;
    this.prefetched = k;
    this.client?.prefetch?.(flop);
  }

  // ---- the one flight

  private launch(job: Job, mode: SolveMode): void {
    const fl: Flight = { job, ac: new AbortController(), stopping: false };
    this.flight = fl;
    void this.ask(fl, mode);
  }

  private async ask(fl: Flight, mode: SolveMode): Promise<void> {
    const { need } = fl.job;
    const { signal } = fl.ac;
    let r: SolveResult | SolveResult<PlayMove>;
    try {
      const client = await this.solver!();
      if (this.flight !== fl) return;
      // (stopped before anything was sent)
      if (signal.aborted) throw new SolverError("cancelled", "cancelled");
      this.useClient(client);
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
    this.prefetched = "";
  }

  /** An answer into the caches the tables read: a stop that came too late leaves a whole answer, which is kept too.
   * An `{error}` is a failure, never cached. */
  private took(fl: Flight, r: SolveResult | SolveResult<PlayMove>): void {
    if (r.data.cancelled) return this.lost(fl, new SolverError("cancelled", "cancelled"));
    if (this.flight !== fl) return;
    this.flight = null;
    this.unasked = "";
    const { need } = fl.job;
    if (r.data.error) {
      this.fail(need.key, r.data.error);
    } else if (need.kind === "opp") {
      this.moves.set(need.key, r as SolveResult<PlayMove>);
      trim(this.moves);
    } else {
      this.adv.set(need.key, r);
      trim(this.adv);
    }
    this.pump();
  }

  /** A request rejected: a failure, by key, so it marks only a table still at that spot. A cancel stores nothing, and
   * what's still needed is asked again. */
  private lost(fl: Flight, e: unknown): void {
    if (this.flight !== fl) return;
    this.flight = null;
    const { key } = fl.job.need;
    if (!(e instanceof SolverError && e.kind === "cancelled")) {
      this.fail(key, message(e));
    } else if (!fl.stopping) {
      // (no stop of ours, a client gone, say: asked again, but a spot that's cancelled twice says so, or it goes round for ever)
      if (this.unasked === key) this.fail(key, "Stopped.");
      this.unasked = key;
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
  }

  // ---- what a view sees

  private get front(): Table {
    return this.tables[0]!;
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
      };
    });
    return { session: this.session, tables, kept: this.kept };
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
    if (s.hands || s.score.n) void putSession(toRecord(s)).catch(() => {});
  }
}
