// The engine check: a run of hands through a real Room on the page's own solver, with a scripted hero in your seat, to
// show on a real worker that a session holds together. It always plays 6-max 100bb, Any hand, at Quick, whatever Settings
// say, and with `persist: false`, so nothing of the player's is read or written; only its own last report is kept. The
// hero draws from each answer's mix and doesn't fold where it can do anything else, to reach more postflop spots.
//
// It fails on what it can see: a request that failed, other than those the Room stopped itself; a verdict that doesn't say
// what answered it, or says more than that answer is; a move the table couldn't take; chips gone astray; a hand that
// doesn't end; a hand history that doesn't read back; a worker ended on a page where a stop should have been enough.
// Charts and betting rules pass when they say what they are. What it can't see is whether any grade is right, so a pass
// says nothing of that, nor of Accurate, phones or other machines. A seed fixes the deals and no more: budgets are
// wall-clock, so the mixes and the lines differ from run to run, and only `fingerprint` compares across runs.
//
// A failed request is told apart here, at the client the Room is given, as the client is what sees every request go out
// and how it ended, a look-ahead's too. A table it left failed is played on, unless nothing can move it, as one bad answer
// shouldn't hide what the other nineteen hands would show. The waits and solve times are the Room's own, in seconds,
// measured in this browser on this run, for the four timed runs that decide asking ahead.
import { kindOf } from "@/components/actions";
import { kvGet, kvSet } from "@/data/db";
import { hash } from "@/features/analyze/analyze";
import { meterLine, type AheadMeter } from "@/features/practice/ahead";
import { practiceRecord } from "@/features/practice/history";
import { checkOrCall, chipsAfter, optionsOf, phaseOf, simOf, studyOf, type Decision, type PracticeHand } from "@/features/practice/practice";
import { Room, type RoomClient, type RoomSolver, type RoomTable } from "@/features/practice/room";
import type { PracticeSession } from "@/features/practice/session";
import { toSearch } from "@/features/study/studyState";
import { importHand } from "@/hh/replay";
import { seeded, STREETS, type Street } from "@/poker/table";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import { describe, sourceLabel } from "@/solver/provenance";
import type { SolveResult, StopCost, TransportKind } from "@/solver/types";
import { STUCK_MS } from "@/solver/worker-transport";

export const CHECK_KEY = "engine.check.v1";

/** ms with no request going out or coming back before the hands still out are given up on: well past a boot and a slow
 * solve. Every move, yours included, leads to one, and every answer you think over came from one. */
const STALL_MS = 180_000;
/** ms a request stopped by Stop has to settle before the report goes without it. A run that ends by itself gives its last
 * look-ahead the time a worker has to answer a stop as well, or a worker ended over that one would go unseen. */
const SETTLE_MS = 1000;
/** bb a hand's chips may be out by: every figure is in cents */
const CHIPS_EPS = 0.011;

export interface HandsCheckOptions {
  /** the first deal's; each deal's is this plus its number */
  seed: number;
  hands: number;
  tables: number;
  askAhead: boolean;
  /** ms the hero takes over each decision, one decision at a time, as a player does */
  thinkMs: number;
  signal?: AbortSignal;
  onProgress?: (p: HandsCheckProgress) => void;
  /** a test's clock, and its patience (ms) */
  now?: () => number;
  stallMs?: number;
}

export interface HandsCheckProgress {
  /** hands finished, of those asked for */
  hands: number;
  of: number;
  verdicts: number;
  errors: number;
}

/** "Hand 7 of 20 · 18 verdicts · 0 errors": the hand next to finish. */
export const progressLine = (p: HandsCheckProgress) => `Hand ${Math.min(p.hands + 1, p.of)} of ${p.of} · ${p.verdicts} verdicts · ${p.errors} errors`;

export type CheckRule = "request" | "label" | "honesty" | "move" | "chips" | "unended" | "record" | "restart";

export interface CheckFailure {
  rule: CheckRule;
  text: string;
  /** the spot, as Study's search, where it has one */
  study?: string;
}

/** Answers on a street: how long they were expected to take and took, in medians. */
export interface EstimateGap {
  street: Street;
  n: number;
  estS: number;
  s: number;
}

export interface HandsCheckReport {
  v: 1;
  /** when it ended */
  at: number;
  /** finished with nothing failed: a run that was stopped hasn't passed, whatever it saw */
  passed: boolean;
  stopped: boolean;
  seed: number;
  /** the deals as they came, to set runs side by side */
  fingerprint: string;
  /** what was asked for */
  of: number;
  tables: number;
  thinkMs: number;
  askAhead: boolean;
  mode: "quick";
  /** what served it */
  transport: TransportKind | null;
  isolated: boolean;
  stopCost: StopCost | null;
  /** hands finished */
  hands: number;
  verdicts: number;
  requestErrors: number;
  /** graded decisions with no provenance, or one that doesn't say what answered */
  unlabelled: number;
  /** workers ended for not answering a stop */
  restarts: number;
  seconds: number;
  /** verdicts by what answered them, in `sourceLabel`'s words */
  bySource: Record<string, number>;
  failures: CheckFailure[];
  /** seconds from a postflop spot reaching you to its answer being in hand */
  waits: { n: number; medianS: number | null; p90S: number | null };
  /** those that reached the solver, and what became of them; the seconds are whole answers', a stopped one's says nothing.
   * Preflop's charts answer at once and can make up most of a run, so `postflopMedianS` is the one that can show a solver
   * slowing down */
  requests: { reached: number; answered: number; stopped: number; medianS: number | null; postflopMedianS: number | null };
  gap: EstimateGap[];
  /** the meter, where it asked ahead */
  ahead: AheadMeter | null;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const r2 = (x: number) => Math.round(x * 100) / 100;

/** The q-quantile, between neighbours where it falls between two; null of nothing. */
export function quantile(xs: readonly number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const at = (s.length - 1) * q;
  const lo = Math.floor(at);
  return r2(s[lo]! + (s[Math.ceil(at)]! - s[lo]!) * (at - lo));
}

/** The hero's option: drawn from the mix, of what hasn't been `tried`, not folding where there's anything else. -1: nothing
 * to take. */
export function heroPick(res: AdvisorResponse, tried: ReadonlySet<number>, rand: () => number): number {
  const left = optionsOf(res).flatMap((a, i) => (tried.has(i) ? [] : [{ i, action: a.action, freq: a.freq ?? 0 }]));
  const stay = left.filter((a) => kindOf(a.action) !== "fold");
  const from = stay.length ? stay : left;
  const total = from.reduce((n, a) => n + a.freq, 0);
  if (!(total > 0)) return from[Math.floor(rand() * from.length)]?.i ?? -1;
  let x = rand() * total;
  for (const a of from) {
    x -= a.freq;
    if (x < 0) return a.i;
  }
  return from.at(-1)!.i;
}

/** What's wrong with a graded decision's label, if anything. The rule is that it says what answered and claims no more
 * than that is: the charts have no EVs and are approximate, as are betting rules and equity estimates, and nothing else
 * answers before the flop. */
export function labelFault(d: Decision): Pick<CheckFailure, "rule" | "text"> | null {
  if (!d.grade) return null;
  const p = d.provenance;
  if (!p || p.source === "unknown" || !describe(p)) return { rule: "label", text: "nothing says what answered it" };
  const fallback = p.source === "rules" || p.source === "equity";
  if (fallback && !p.approximate) return { rule: "honesty", text: `${sourceLabel(p.source)} isn't marked approximate` };
  if (d.street !== "preflop") return null;
  if (p.source === "charts" && (d.grade.byEv || !p.approximate)) return { rule: "honesty", text: d.grade.byEv ? "the preflop charts have no EVs to grade by" : "the preflop charts aren't marked approximate" };
  return p.source === "charts" || fallback ? null : { rule: "honesty", text: `answered preflop by ${sourceLabel(p.source)}, which isn't the charts` };
}

/** What's wrong with a finished hand's chips, if anything: every seat's have to come to what the table started with, none
 * below nothing, and your result has to be what happened to yours. */
export function chipsFault(h: PracticeHand): string | null {
  const chips = chipsAfter(h);
  const each = Object.values(chips);
  const total = r2(each.reduce((a, b) => a + b, 0));
  const start = h.players * h.stack;
  if (each.some((x) => !(x >= -CHIPS_EPS))) return "a seat ended with less than nothing";
  if (!(Math.abs(total - start) <= CHIPS_EPS)) return `${total}bb at the end of a hand that started with ${start}bb`;
  const mine = r2(chips[h.hero]! - h.stack);
  return Math.abs(mine - h.result!.net) <= CHIPS_EPS ? null : `your result says ${h.result!.net}bb, your chips say ${mine}bb`;
}

/** A request's spot, as Study's search: a request knows what it asked, a look-ahead's included. */
const spotOf = (q: AdvisorState) => toSearch({ players: q.players, stack: q.stack ?? 100, board: q.board ?? "", preflop: q.preflop ?? [], flop: q.flop ?? [], turn: q.turn ?? [], river: q.river ?? [] });

const where = (table: number, h: PracticeHand) => `Table ${table + 1}, hand ${h.n + 1}`;

class HandsRun {
  readonly result: Promise<HandsCheckReport>;
  private done!: (r: HandsCheckReport) => void;
  private readonly o: HandsCheckOptions;
  private readonly getSolver: RoomSolver;
  private readonly room: Room;
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly rand: () => number;
  /** one stand-in a client, as a new one to the Room is a new client */
  private readonly clients = new WeakMap<RoomClient, RoomClient>();
  private readonly failures: CheckFailure[] = [];
  /** every hand dealt that's been seen to its end, or to the end of the run, by its number */
  private readonly deals = new Map<number, PracticeHand>();
  private readonly ids = new Set<string>();
  private readonly bySource: Record<string, number> = {};
  private transport: TransportKind | null = null;
  private unlabelled = 0;
  private reached = 0;
  private errors = 0;
  private stops = 0;
  /** the request out, settled once it has been counted */
  private flight: Promise<unknown> = Promise.resolve();
  private over = false;
  private off: () => void = () => {};
  private tickTimer: ReturnType<typeof setTimeout> | undefined;
  /** the decision being thought over: one at a time, as a player does */
  private thinkTimer: ReturnType<typeof setTimeout> | undefined;
  private stallTimer: ReturnType<typeof setTimeout> | undefined;
  /** the options at the spot in hand that the table has refused */
  private readonly tried = new Set<number>();
  private said = "";

  constructor(getSolver: RoomSolver, o: HandsCheckOptions) {
    this.getSolver = getSolver;
    this.o = o;
    this.now = o.now ?? (() => performance.now());
    this.startedAt = this.now();
    this.rand = seeded((o.seed ^ 0x5bd1e995) >>> 0);
    this.result = new Promise((resolve) => {
      this.done = resolve;
    });
    this.room = new Room({
      pace: 0,
      pause: 0,
      guard: 0,
      now: this.now,
      persist: false,
      seedOf: (n) => o.seed + n,
      maxHands: o.hands,
      mode: "quick",
      tables: o.tables,
      spot: "any",
      seat: "random",
      askAhead: o.askAhead,
      watch: {
        ended: (h, s, table) => this.ended(h, s, table),
        refused: (h, why, table) => this.fail("move", `${where(table, h)}: the table couldn't take an opponent's answer: ${why}`, studyOf(h)),
      },
    });
  }

  begin(): void {
    if (this.o.signal?.aborted) return void this.end(true);
    this.o.signal?.addEventListener("abort", this.abort, { once: true });
    this.off = this.room.subscribe(this.poke);
    this.room.setSolver(this.solver);
    this.room.start();
    this.touch();
  }

  private readonly abort = () => void this.end(true);

  private fail(rule: CheckRule, text: string, study?: string): void {
    this.failures.push({ rule, text, ...(study === undefined ? {} : { study }) });
  }

  // ---- what the Room is given for a solver

  private readonly solver: RoomSolver = async () => {
    try {
      const c = await this.getSolver();
      this.transport = c.transport?.kind ?? null;
      let mine = this.clients.get(c);
      if (!mine) this.clients.set(c, (mine = this.watched(c)));
      return mine;
    } catch (e) {
      this.errors += 1;
      this.fail("request", `No solver: ${message(e)}`);
      throw e;
    }
  };

  private watched(c: RoomClient): RoomClient {
    return {
      ...(c.prefetch ? { prefetch: (s: AdvisorState) => c.prefetch!(s) } : {}),
      ...(c.stopCost ? { stopCost: () => c.stopCost!() } : {}),
      solve: (req) => this.asked(req.state, req.signal, () => c.solve(req)),
      play: (state, play, opts) => this.asked(state, opts?.signal, () => c.play(state, play, opts)),
    };
  }

  /** A request, counted as it goes out and as it ends. Whatever comes of one the Room has stopped is its own doing, an HTTP
   * solve running on to a 500 included. A cancel nobody asked for is a failure: something else ended that request. */
  private asked<T extends SolveResult<{ error?: string; cancelled?: boolean }>>(state: AdvisorState, signal: AbortSignal | undefined, go: () => Promise<T>): Promise<T> {
    this.reached += 1;
    this.touch();
    const lost = (why: string) => {
      if (signal?.aborted) {
        this.stops += 1;
      } else {
        this.errors += 1;
        this.fail("request", `A request failed: ${why}`, spotOf(state));
      }
    };
    const run = (async () => {
      try {
        const r = await go();
        const bad = r.data.cancelled ? "cancelled" : r.data.error;
        if (bad) lost(bad);
        return r;
      } catch (e) {
        lost(message(e));
        throw e;
      } finally {
        this.touch();
      }
    })();
    this.flight = run.catch(() => {});
    return run;
  }

  // ---- what's noted of each hand

  private ended(h: PracticeHand, s: PracticeSession, table: number): void {
    this.noteHand(h, table);
    const chips = chipsFault(h);
    if (chips) this.fail("chips", `${where(table, h)}: ${chips}`, studyOf(h));
    const record = this.recordFault(h, s);
    if (record) this.fail("record", `${where(table, h)}: ${record}`, studyOf(h));
  }

  /** The hand's deal and its verdicts. */
  private noteHand(h: PracticeHand, table: number): void {
    this.deals.set(h.n, h);
    for (const d of h.decisions) {
      if (!d.grade) continue;
      const fault = labelFault(d);
      const label = sourceLabel(fault?.rule === "label" ? "unknown" : d.provenance!.source);
      this.bySource[label] = (this.bySource[label] ?? 0) + 1;
      if (fault?.rule === "label") this.unlabelled += 1;
      if (fault) this.fail(fault.rule, `${where(table, h)}, ${d.street}, ${d.chose}: ${fault.text}`, d.study);
    }
  }

  /** What's wrong with the hand as a record, if anything: it has to read back as Analyze would read it, the table agreeing
   * move by move, under an id of its own. */
  private recordFault(h: PracticeHand, s: PracticeSession): string | null {
    try {
      const rec = practiceRecord(h, s, new Date());
      if (this.ids.has(rec.id)) return `its record repeats the id ${rec.id}`;
      this.ids.add(rec.id);
      const part = importHand(rec.text).stopped;
      return part ? `its history and the table part ways at ${part.pos}'s ${part.street} action` : null;
    } catch (e) {
      return `its history doesn't read back: ${message(e)}`;
    }
  }

  // ---- the hero

  /** Goes round on a timer, not inside the Room's own telling: that's mid-pump, and a timer lets a Stop in. */
  private readonly poke = () => {
    if (!this.over) this.tickTimer ??= setTimeout(this.tick, 0);
  };

  private readonly tick = () => {
    this.tickTimer = undefined;
    if (this.over) return;
    const s = this.room.snapshot();
    const { hands, dealt, score } = s.session;
    const p = { hands, of: this.o.hands, verdicts: score.n, errors: this.errors };
    if (progressLine(p) !== this.said) {
      this.said = progressLine(p);
      this.o.onProgress?.(p);
    }
    if (hands >= this.o.hands && hands >= dealt) return void this.end(false);
    // (a failed table never comes forward by itself, so it's seen to wherever it is)
    const failed = s.tables.findIndex((t) => t.failed !== null);
    if (failed >= 0) return this.playOn(failed, s.tables[failed]!);
    if (s.tables.length === 1 && s.tables[0]!.hand.result) return this.room.nextHand(false, 0);
    const t = s.tables[s.focus];
    if (this.thinkTimer !== undefined || !t?.answer || !t.turnKey) return;
    this.tried.clear();
    const { focus } = s;
    const key = t.turnKey;
    this.thinkTimer = setTimeout(() => this.act(focus, key), this.o.thinkMs);
  };

  /** The failure's been noted as it came, so the hand goes on: your spot by a move of your own, not graded, an opponent's
   * by Play on. Neither says the run is getting anywhere: a request going out or coming back does. */
  private playOn(table: number, t: RoomTable): void {
    const sim = simOf(t.hand);
    if (phaseOf(t.hand, sim).kind === "hero") this.room.ungraded(checkOrCall(t.hand, sim), table);
    else this.room.playOn(table);
  }

  private act(table: number, key: string): void {
    this.thinkTimer = undefined;
    const s = this.room.snapshot();
    const t = s.tables[table];
    // (another table can come forward meanwhile, and a new client takes the answers with it)
    if (s.focus !== table || t?.turnKey !== key || !t.answer) return this.poke();
    const i = heroPick(t.answer.data, this.tried, this.rand);
    if (i < 0) {
      this.fail("unended", `${where(table, t.hand)}: didn't end: the answer leaves no move to make`, studyOf(t.hand));
      return void this.end(false);
    }
    this.room.choose(table, key, i);
    const after = this.room.snapshot().tables[table];
    if (after?.error && after.turnKey === key) {
      this.fail("move", `${where(table, t.hand)}: the table refused the answer's own "${optionsOf(t.answer.data)[i]!.action}": ${after.error}`, studyOf(t.hand));
      this.tried.add(i);
      return this.act(table, key);
    }
  }

  // ---- the end

  private touch(): void {
    clearTimeout(this.stallTimer);
    if (!this.over) this.stallTimer = setTimeout(this.stalled, this.o.stallMs ?? STALL_MS);
  }

  private readonly stalled = () => {
    const secs = Math.round((this.o.stallMs ?? STALL_MS) / 1000);
    this.room.snapshot().tables.forEach((t, i) => {
      if (!t.hand.result) this.fail("unended", `${where(i, t.hand)}: didn't end: nothing happened for ${secs} s`, studyOf(t.hand));
    });
    void this.end(false);
  };

  private async end(stopped: boolean): Promise<void> {
    if (this.over) return;
    this.over = true;
    const seconds = (this.now() - this.startedAt) / 1000;
    clearTimeout(this.tickTimer);
    clearTimeout(this.thinkTimer);
    clearTimeout(this.stallTimer);
    this.off();
    this.o.signal?.removeEventListener("abort", this.abort);
    this.room.stop();
    let wait: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.flight, new Promise((resolve) => (wait = setTimeout(resolve, stopped ? SETTLE_MS : STUCK_MS + SETTLE_MS)))]);
    clearTimeout(wait);
    const report = this.report(stopped, seconds);
    // (not waited for: a read blocked by an older tab would hold the report up for ever)
    void kvSet(CHECK_KEY, report).catch(() => {});
    this.done(report);
  }

  private report(stopped: boolean, seconds: number): HandsCheckReport {
    const s = this.room.snapshot();
    s.tables.forEach((t, i) => {
      if (!t.hand.result) this.noteHand(t.hand, i);
    });
    const isolated = globalThis.crossOriginIsolated === true;
    if (s.restarts > 0 && isolated) this.fail("restart", `The worker was ended ${s.restarts} ${s.restarts === 1 ? "time" : "times"}, on a page where a stop shouldn't need that.`);
    const { waits, solves } = this.room.metrics(Infinity);
    const postflop = solves.filter((x) => x.street !== "preflop").map((x) => x.s);
    const after = waits.filter((w) => w.street !== "preflop").map((w) => w.s);
    return {
      v: 1,
      at: Date.now(),
      passed: !stopped && !this.failures.length,
      stopped,
      seed: this.o.seed,
      fingerprint: fingerprintOf(this.deals),
      of: this.o.hands,
      tables: this.o.tables,
      thinkMs: this.o.thinkMs,
      askAhead: this.o.askAhead,
      mode: "quick",
      transport: this.transport,
      isolated,
      stopCost: s.stopCost,
      hands: s.session.hands,
      verdicts: s.session.score.n,
      requestErrors: this.errors,
      unlabelled: this.unlabelled,
      restarts: s.restarts,
      seconds: r2(seconds),
      bySource: this.bySource,
      failures: this.failures,
      waits: { n: after.length, medianS: quantile(after, 0.5), p90S: quantile(after, 0.9) },
      requests: { reached: this.reached, answered: solves.length, stopped: this.stops, medianS: quantile(solves.map((x) => x.s), 0.5), postflopMedianS: quantile(postflop, 0.5) },
      gap: STREETS.flatMap((street) => {
        const on = solves.filter((x) => x.street === street);
        return on.length ? [{ street, n: on.length, estS: quantile(on.map((x) => x.est), 0.5)!, s: quantile(on.map((x) => x.s), 0.5)! }] : [];
      }),
      ahead: this.o.askAhead ? s.ahead.meter : null,
    };
  }
}

/** What was dealt, whichever table each hand landed on: the same seed gives the same one, however the run went. */
const fingerprintOf = (deals: ReadonlyMap<number, PracticeHand>) =>
  hash(JSON.stringify([...deals.values()].sort((a, b) => a.n - b.n).map((h) => [h.n, h.seed, h.hero, h.hands, h.board, h.pot ?? null])));

/** The run; it always gives a report, and `signal` ends it with one. `getSolver`: the page's own. */
export function runHandsCheck(getSolver: RoomSolver, o: HandsCheckOptions): Promise<HandsCheckReport> {
  const run = new HandsRun(getSolver, o);
  run.begin();
  return run.result;
}

/** The last report kept in this browser, if there is one this build can read. */
export async function lastReport(): Promise<HandsCheckReport | null> {
  const r = await kvGet<HandsCheckReport>(CHECK_KEY).catch(() => undefined);
  return r?.v === 1 ? r : null;
}

/** "1 m 48 s" */
export function timeText(seconds: number): string {
  const s = Math.round(seconds);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} m ${s % 60} s`;
}

/** "20 hands · 63 verdicts · 0 request errors · 0 without a label · 1 m 48 s" */
export const reportLine = (r: HandsCheckReport) =>
  `${r.hands} hands · ${r.verdicts} verdicts · ${r.requestErrors} request errors · ${r.unlabelled} without a label · ${timeText(r.seconds)}`;

/** How it was run: "4 tables · no time to think · asking ahead off · Quick". */
export const setupLine = (r: HandsCheckReport) =>
  [`${r.tables} ${r.tables === 1 ? "table" : "tables"}`, r.thinkMs ? `${r.thinkMs / 1000} s to think a decision` : "no time to think", `asking ahead ${r.askAhead ? "on" : "off"}`, "Quick"].join(" · ");

/** The meter's figures in words, or why there are none. */
export function aheadLine(r: HandsCheckReport): string | null {
  if (!r.ahead) return null;
  if (r.ahead.asked) return meterLine(r.ahead);
  return r.stopCost === "kills" ? "Nothing asked: this browser can't stop a solve, so a wrong guess would hold up the next answer." : "Nothing asked.";
}
