// Practice: hands against GTO opponents, each of your decisions graded against the solver's answer for your hand.
// Pure helpers over one hand (the deal, the action so far, your graded decisions); PracticePage drives them with the
// solver. Semantics follow the classic trainer (solver/gto/static/practice.js): every seat's cards and the board are
// dealt up front from one deck; an opponent's move is drawn from the GTO mix for its actual hand (Advisor.play);
// your options are the solver's actions at your spot, graded once you've acted; your fold ends the hand for you.
// Every hand starts from the setup's stack, or, with chips carried (the classic Table mode's ring game), from where the
// last hand left each player. Your seat moves one place each hand (BTN, CO, HJ ... UTG, BB, SB), or is drawn at random,
// or is one seat; a preflop-only hand stops as the preflop closes.
import { kindOf } from "@/components/actions";
import { classOf } from "@/engine/nlhe/cards";
import type { SizeStreet } from "@/features/solve/setup";
import { toSearch, type StudyHand } from "@/features/study/studyState";
import { grade, type Grade } from "@/grading/grade";
import { cmp, handName } from "@/poker/evaluate";
import { seatLabel, seatsOf } from "@/poker/seats";
import {
  deal,
  noLines,
  recordOf,
  seeded,
  settle,
  simulate,
  withMove,
  NEED,
  type Lines,
  type Move,
  type Rake,
  type Settlement,
  type Sim,
  type Street,
  type TableSetup,
} from "@/poker/table";
import type { AdvisorActionStat, AdvisorResponse, AdvisorState, PlayMove, RangeGridData } from "@/solver/protocol";
import type { Provenance } from "@/solver/types";

export interface Decision {
  street: Street;
  /** the solver's action you took (its name, e.g. "bet 33%"), or the move's kind where ungraded */
  chose: string;
  move: Move;
  /** null where the spot had no answer to grade against */
  grade: Grade | null;
  /** the answer's actions at your spot: what the grade is against */
  mix: { action: string; freq: number; ev: number | null; amount?: number }[];
  pot: number;
  provenance: Provenance | null;
  /** the Study line at the decision: the action before it, the board out (Study shows your whole range there) */
  study: string;
}

export interface HandResult {
  /** your chips won less your chips in, bb */
  net: number;
  folded: boolean;
  winners: string[];
  /** the showdown in a line, "BB's pair of queens beats your A-high" */
  says: string;
  pays: Record<string, number>;
  /** the hand stopped as the preflop closed (preflop only): nothing settled, `net` 0 */
  cut?: true;
  /** what the rake took from the pot, bb (none where it took nothing) */
  rake?: number;
}

export interface PracticeHand {
  seed: number;
  /** hands dealt this session before this one (your seat moves one place each) */
  n: number;
  players: number;
  stack: number;
  hero: string;
  hands: Record<string, [string, string]>;
  board: string[];
  /** board cards out */
  shown: number;
  lines: Lines;
  decisions: Decision[];
  result: HandResult | null;
  /** the hand ends as the preflop closes, with you still in it */
  preflopOnly?: true;
  /** each seat's ante, bb, and a 2bb straddle from the first seat (3 or more players) */
  ante?: number;
  straddle?: true;
  /** one kind of pot only: the preflop is played for you, and dealt again until it is that pot (`tries`: the deals so far) */
  pot?: PotDrill;
  tries?: number;
  /** chips carried from hand to hand: each seat's chips as this hand starts, bb, and the seats that rebought to `stack` */
  stacks?: Record<string, number>;
  rebuys?: string[];
  /** your own postflop bet and raise sizes, % of the pot (the Solve page's), for the solver's tree from the flop on */
  sizes?: Sizes;
  /** the rake: % of pots that see a flop, capped in bb */
  rake?: Rake;
  /** after your fold (the classic trainer's runOut): "played", the others play the hand on by their strategies to its
   * end; "shown", nobody left to play, everyone's cards and the board shown. Your result stays as at your fold. */
  run?: "played" | "shown";
}

export type Sizes = Partial<Record<SizeStreet, number[]>>;

/** The drill modes (the classic trainer's, `practice.js:169-196`): only one kind of pot. The preflop is played for you
 * too (from the charts, as the opponents' is), and the hand dealt again until it reaches the flop heads-up, you in it, as
 * that kind of pot; you play from the flop. */
export type PotDrill = "srp" | "3bet" | "bvb";
export const POT_DRILLS: Record<PotDrill, { label: string; one: string; tip: string }> = {
  srp: { label: "Single-raised pots", one: "a single-raised pot", tip: "Heads-up after one preflop raise and a call: the preflop is played for you, you play from the flop" },
  "3bet": { label: "3-bet pots", one: "a 3-bet pot", tip: "Heads-up after a 3-bet and a call: the preflop is played for you, you play from the flop" },
  bvb: { label: "Blind vs blind", one: "a blind-vs-blind pot", tip: "Small blind against big blind, folded to them: the preflop is played for you, you play from the flop" },
};
export const isPotDrill = (x: unknown): x is PotDrill => typeof x === "string" && x in POT_DRILLS;
/** the deals a drill hand may take to reach its pot */
export const DRILL_TRIES = 400;
const BLINDS = ["SB", "BB"];

/** Your seat each hand: moving one place a hand ("moves"), drawn at random from the hand's seed ("random"), or one
 * seat (its name). */
export type SeatChoice = string;
export interface HandOptions {
  seat?: SeatChoice;
  preflopOnly?: boolean;
  pot?: PotDrill | null;
  /** each seat's ante (bb, 0 for none, at most the Solve page's LIMITS.ante), and a straddle (3 or more players) */
  ante?: number;
  straddle?: boolean;
  /** chips carried from hand to hand (a ring game): full hands with your seat moving only (`carries`) */
  carry?: boolean;
  /** your own postflop sizes (null or empty: the engine's) */
  sizes?: Sizes | null;
  /** the rake, % of the pot (0 for none, at most the Solve page's LIMITS.rakePct), and its cap in bb (0 for none) */
  rake?: number;
  rakeCap?: number;
}

/** Whether the options carry chips: full hands (not preflop only or a drill's pot), your seat moving one place a hand,
 * so each player keeps a seat and its chips follow it. */
export const carries = (o: HandOptions) => !!o.carry && (o.seat ?? "moves") === "moves" && !o.preflopOnly && !o.pot;

/** A seat under this share of the starting stack rebuys to it before a hand (the classic table's REBUY). */
export const REBUY = 0.25;

/** Your seat in the session's n-th hand: the button first, then one seat to the right each hand. */
export function heroSeat(n: number, players: number): string {
  const s = seatsOf(players);
  const start = s.indexOf(players === 2 ? "SB" : "BTN");
  return s[(((start - n) % players) + players) % players]!;
}

/** Your seat in the n-th hand under a seat choice (a seat the table doesn't have moves). Blind vs blind, one of the
 * blinds: the one chosen, else moving from the small blind to the big blind (or drawn at random). */
export function seatFor(choice: SeatChoice | undefined, n: number, players: number, seed: number, pot?: PotDrill | null): string {
  const s = seatsOf(players);
  if (pot === "bvb") return choice && BLINDS.includes(choice) ? choice : BLINDS[(choice === "random" ? seed : n) % 2]!;
  if (choice === "random") return s[seed % players]!;
  return choice && s.includes(choice) ? choice : heroSeat(n, players);
}

/** The n-th hand of a session. With chips carried, `table` gives each seat's chips (nextTable); without it, every seat
 * starts at `stack`. */
export function newHand(players: number, stack: number, n: number, seed: number, opts: HandOptions = {}, table?: Table): PracticeHand {
  const d = deal(players, seeded(seed));
  return {
    seed,
    n,
    players,
    stack,
    hero: seatFor(opts.seat, n, players, seed, opts.pot),
    ...d,
    shown: 0,
    lines: noLines(),
    decisions: [],
    result: null,
    ...(opts.pot ? { pot: opts.pot } : opts.preflopOnly ? { preflopOnly: true as const } : {}),
    ...(opts.ante && opts.ante > 0 ? { ante: opts.ante } : {}),
    ...(opts.straddle && players >= 3 ? { straddle: true as const } : {}),
    ...(opts.sizes && Object.keys(opts.sizes).length ? { sizes: opts.sizes } : {}),
    ...(opts.rake && opts.rake > 0 ? { rake: { pct: opts.rake, ...(opts.rakeCap && opts.rakeCap > 0 ? { cap: opts.rakeCap } : {}) } } : {}),
    ...(carries(opts) ? { stacks: table?.stacks ?? Object.fromEntries(seatsOf(players).map((p) => [p, stack])), ...(table?.rebuys.length ? { rebuys: table.rebuys } : {}) } : {}),
  };
}

export interface Table {
  stacks: Record<string, number>;
  rebuys: string[];
}

/** Each seat's chips as the hand ends, bb: its stack, less what it put in, plus what it won. After your fold with
 * others still in, they go as if the rest checked it down on the board dealt (the classic trainer's `finish`: each
 * wins at most what it put in from each player). A hand not over yet: the chips it started with. */
export function chipsAfter(h: PracticeHand, sim: Sim = simOf(h)): Record<string, number> {
  const t = setupOf(h);
  const pos = seatsOf(h.players);
  if (!h.result || h.result.cut) return Object.fromEntries(pos.map((p) => [p, t.stacks[p]!]));
  const inv = Object.fromEntries(pos.map((p) => [p, (sim.invested[p] ?? 0) + (sim.cur?.bets[p] ?? 0)]));
  const live = pos.filter((p) => sim.active.has(p));
  // (a run-out played to the end settles as it went)
  const down = !sim.active.has(h.hero) && live.length > 1 && !sim.handOver;
  const st = settle(t, inv, live, down ? new Set(live) : sim.allin, down ? h.board : boardOf(h), (p) => h.hands[p]!, h.rake);
  return Object.fromEntries(pos.map((p) => [p, Math.round((t.stacks[p]! - inv[p]! + (st.pays[p] ?? 0)) * 100) / 100]));
}

/** The next hand's chips from this one's (chipsAfter): your seat moves one place, so each player's chips move with
 * it (the small blind's are the next button's), and a seat under REBUY of the starting stack is topped up to it. */
export function nextTable(h: PracticeHand, chips: Record<string, number> = chipsAfter(h)): Table {
  const pos = seatsOf(h.players);
  const stacks: Record<string, number> = {};
  const rebuys: string[] = [];
  pos.forEach((p, i) => {
    const to = pos[(i - 1 + pos.length) % pos.length]!;
    const x = chips[p] ?? h.stack;
    if (x < h.stack * REBUY - 1e-9) rebuys.push(to);
    stacks[to] = x < h.stack * REBUY - 1e-9 ? h.stack : x;
  });
  return { stacks: Object.fromEntries(pos.map((p) => [p, stacks[p]!])), rebuys: pos.filter((p) => rebuys.includes(p)) };
}

/** The session's next hand, number `n`: with chips carried, from where this one left them (or, `reset`, every seat
 * back at the starting stack). */
export const following = (h: PracticeHand, seed: number, opts: HandOptions, reset = false, n = h.n + 1): PracticeHand =>
  newHand(h.players, h.stack, n, seed, opts, carries(opts) && !reset ? nextTable(h) : undefined);

/** A drill hand that went another way, dealt again (the same hand number: your seat stays where it moves). */
export const redeal = (h: PracticeHand, seed: number, opts: HandOptions): PracticeHand => ({ ...newHand(h.players, h.stack, h.n, seed, opts), tries: (h.tries ?? 0) + 1 });

/** A drill hand whose preflop has gone another way (to be dealt again), else false (still on course, or on the
 * flop): you folded, an all-in, too many raises, someone not in the blinds in a blind-vs-blind pot, or the flop
 * reached by more than two players or with another number of raises (the classic trainer's `offDrill`). */
export function offDrill(h: PracticeHand, sim: Sim = simOf(h)): boolean {
  if (!h.pot || h.shown >= 3) return false;
  const pre = h.lines.preflop;
  const raises = pre.filter((m) => m.action === "raise" || m.action === "bet").length;
  const want = h.pot === "srp" ? 1 : h.pot === "3bet" ? 2 : null;
  if (!sim.active.has(h.hero) || pre.some((m) => m.action === "all-in") || (want != null && raises > want)) return true;
  if (h.pot === "bvb" && (!BLINDS.includes(h.hero) || pre.some((m) => !BLINDS.includes(m.pos) && m.action !== "fold"))) return true;
  if (sim.handOver) return true;
  return sim.waiting === "flop" && (sim.active.size !== 2 || (want != null && raises !== want));
}

/** Still dealing a drill's pot: its preflop, played for you. */
export const seeking = (h: PracticeHand) => !!h.pot && h.shown < 3 && !h.result;

/** Preflop only, the preflop closed with you and someone else in: the hand stops there. */
const cutAt = (h: PracticeHand, sim: Sim) => !!h.preflopOnly && !!sim.streets.preflop?.closed && !sim.handOver && sim.active.has(h.hero);

export const setupOf = (h: Pick<PracticeHand, "players" | "stack" | "ante" | "straddle" | "stacks">): TableSetup => ({
  players: h.players,
  stacks: Object.fromEntries(seatsOf(h.players).map((p) => [p, h.stacks?.[p] ?? h.stack])),
  ...(h.ante ? { ante: h.ante } : {}),
  ...(h.straddle ? { straddle: true } : {}),
});

/** The hand's ante and straddle, in the engine's keys. */
const gameOf = (h: Pick<PracticeHand, "ante" | "straddle">) => ({ ...(h.ante ? { ante: h.ante } : {}), ...(h.straddle ? { straddle: true } : {}) });

/** The hand's rake: in the engine's keys (a fraction of the pot), and in Study's setup (%). */
const rakeOf = (h: Pick<PracticeHand, "rake">) => (h.rake ? { rake: Math.round(h.rake.pct * 10) / 1000, ...(h.rake.cap ? { rake_cap: h.rake.cap } : {}) } : {});
const rakeSetup = (h: Pick<PracticeHand, "rake">) => (h.rake ? { rake: h.rake.pct, ...(h.rake.cap ? { rakeCap: h.rake.cap } : {}) } : {});

/** The seats whose chips aren't the starting stack (chips carried), bb; none where every seat has it. */
const ownStacks = (h: Pick<PracticeHand, "stack" | "stacks">) => {
  const own = Object.entries(h.stacks ?? {}).filter(([, v]) => Math.abs(v - h.stack) > 1e-9);
  return own.length ? { stacks: Object.fromEntries(own) } : {};
};

export const simOf = (h: PracticeHand): Sim => simulate(setupOf(h), h.lines, h.shown);

const boardOf = (h: PracticeHand) => h.board.slice(0, h.shown);

/** The Study line where the hand stands: each seat's chips as the hand started, with the hand's ante, straddle,
 * sizes and rake. */
export function studyOf(h: PracticeHand): string {
  const conv = (ms: Move[]) => ms.map((m) => ({ pos: m.pos, action: m.action, ...(m.to !== undefined ? { to: m.to } : {}) }));
  const s: StudyHand = {
    players: h.players,
    stack: h.stack,
    board: boardOf(h).join(""),
    preflop: conv(h.lines.preflop),
    flop: conv(h.lines.flop),
    turn: conv(h.lines.turn),
    river: conv(h.lines.river),
    ...(h.ante || h.straddle || h.sizes || h.rake || ownStacks(h).stacks ? { setup: { ...gameOf(h), ...ownStacks(h), ...(h.sizes ? { sizes: h.sizes } : {}), ...rakeSetup(h) } } : {}),
  };
  return toSearch(s);
}

/** The hand from your seat, as the Advisor reads it: your advice's request, and the state an opponent's move is
 * drawn from (Advisor.play reads its seat's view off it). `seat`: from that seat's own view instead (a run-out after
 * your fold, as the classic page asks it). */
export function stateFor(h: PracticeHand, seat: string = h.hero): AdvisorState {
  const conv = (ms: Move[]) => ms.map((m) => ({ pos: m.pos, action: m.action, ...(m.to !== undefined ? { to: m.to } : {}) }));
  return {
    players: h.players,
    hero: seat,
    hole: h.hands[seat]!.join(""),
    board: boardOf(h).join(""),
    stack: h.stack,
    preflop: conv(h.lines.preflop),
    flop: conv(h.lines.flop),
    turn: conv(h.lines.turn),
    river: conv(h.lines.river),
    ...gameOf(h),
    ...ownStacks(h),
    ...rakeOf(h),
    // (your sizes change the postflop solves only: sent from the flop on, as the classic page does, so preflop's
    // answer is the same)
    ...(h.sizes && h.shown >= 3 ? { sizes: h.sizes } : {}),
  };
}

export type Phase =
  | { kind: "deal"; street: Street }
  | { kind: "hero"; street: Street }
  | { kind: "villain"; street: Street; seat: string }
  /** your preflop in a drill, played for you as the opponents' is */
  | { kind: "auto"; street: Street; seat: string }
  | { kind: "over" };

/** What happens next: cards to deal, a decision (yours or an opponent's), or the end of the hand (also your fold). */
export function phaseOf(h: PracticeHand, sim: Sim = simOf(h)): Phase {
  if (h.run === "played" && !sim.handOver) {
    if (sim.waiting) return { kind: "deal", street: sim.waiting };
    if (sim.toAct && sim.current) return { kind: "villain", street: sim.current, seat: sim.toAct };
  }
  if (h.result || sim.handOver || !sim.active.has(h.hero) || cutAt(h, sim)) return { kind: "over" };
  if (sim.waiting) return { kind: "deal", street: sim.waiting };
  if (!sim.toAct || !sim.current) return { kind: "over" };
  if (sim.toAct === h.hero && h.pot && sim.current === "preflop") return { kind: "auto", street: sim.current, seat: h.hero };
  return sim.toAct === h.hero ? { kind: "hero", street: sim.current } : { kind: "villain", street: sim.current, seat: sim.toAct };
}

/** The next street's cards out. */
export function dealNext(h: PracticeHand, street: Street): PracticeHand {
  return { ...h, shown: Math.max(h.shown, NEED[street]) };
}

/** An opponent's move from Advisor.play, as recorded: a size under the minimum lifted to it, a raise that isn't
 * allowed played as a call (`clamp`); a move the table can't take at all (it should not happen) as a check or call. */
export function villainMove(h: PracticeHand, mv: Pick<PlayMove, "action" | "to">, sim: Sim = simOf(h)): Move {
  const t = setupOf(h);
  const m = recordOf(t, sim, { action: mv.action, to: mv.to, clamp: true });
  return typeof m === "string" ? checkOrCall(h, sim) : m;
}

/** The seat to act's check, or its call where there's a bet. */
export function checkOrCall(h: PracticeHand, sim: Sim = simOf(h)): Move {
  const p = sim.toAct!;
  const facing = (sim.cur?.curBet ?? 0) - (sim.cur?.bets[p] ?? 0) > 1e-9;
  return { pos: p, action: facing ? "call" : "check" };
}

/** Your whole range at a decision, as the answer plays it (the classic trainer's "Your range", practice.js:385). */
export interface RangeAt {
  grid: RangeGridData;
  /** your hand's class, "AKs" */
  cls: string;
  /** "Your range · flop · BTN vs BB" */
  label: string;
}

/** Your range at your spot from the answer there: none without a grid, or from the betting rules or an equity
 * estimate (no solve: the classic leaves out its heuristic answers too). */
export function rangeAt(h: PracticeHand, res: AdvisorResponse, provenance: Provenance | null, sim: Sim = simOf(h)): RangeAt | null {
  const src = provenance?.source;
  if (!res.grid || res.error || src === "rules" || src === "equity" || !sim.current) return null;
  const vs = [...sim.active].filter((p) => p !== h.hero).map((p) => seatLabel(p, h.players));
  const against = vs.length ? ` vs ${vs.length <= 2 ? vs.join(", ") : `${vs.length} players`}` : "";
  return { grid: res.grid, cls: classOf(h.hands[h.hero]!.join("")), label: `Your range · ${sim.current} · ${seatLabel(h.hero, h.players)}${against}` };
}

/** Your options: the answer's actions at your spot. */
export function optionsOf(res: AdvisorResponse | null | undefined): AdvisorActionStat[] {
  return res && !res.error && Array.isArray(res.actions) ? res.actions : [];
}

/** The move one of the answer's actions records (sizes to the half big blind, as the table takes them). */
export function moveOfOption(h: PracticeHand, a: AdvisorActionStat, sim: Sim = simOf(h)): Move | string {
  const kind = kindOf(a.action);
  return recordOf(setupOf(h), sim, { action: kind, to: typeof a.amount_bb === "number" ? a.amount_bb : undefined, clamp: true });
}

/** The answer's mix at your spot, per action: frequency, and EV where the answer has EVs for every action. */
export function mixOf(res: AdvisorResponse): Decision["mix"] {
  return optionsOf(res).map((a) => ({
    action: a.action,
    freq: a.freq ?? 0,
    ev: typeof a.ev_bb === "number" ? a.ev_bb : null,
    ...(typeof a.amount_bb === "number" ? { amount: a.amount_bb } : {}),
  }));
}

/** Your decision: the answer's i-th action taken, graded against the answer (by EV where it has EVs for every
 * action, else by frequency: the preflop charts). */
export function decide(
  h: PracticeHand,
  res: AdvisorResponse,
  i: number,
  provenance: Provenance | null,
  sim: Sim = simOf(h),
): { hand: PracticeHand; decision: Decision } | { error: string } {
  const a = optionsOf(res)[i];
  if (!a) return { error: "That action isn't in the answer." };
  const m = moveOfOption(h, a, sim);
  if (typeof m === "string") return { error: m };
  const mix = mixOf(res);
  const pot = typeof res.pot_bb === "number" ? res.pot_bb : sim.pot;
  const evs = mix.every((x) => x.ev !== null) ? mix.map((x) => x.ev!) : null;
  const g = grade({ freqs: mix.map((x) => x.freq), evs, pot }, i);
  const decision: Decision = { street: sim.current!, chose: a.action, move: m, grade: g, mix, pot, provenance, study: studyOf(h) };
  return { hand: { ...withMoveOf(h, sim, m), decisions: [...h.decisions, decision] }, decision };
}

/** A move with no answer to grade against (the solve failed): recorded, not graded. */
export function decideUngraded(h: PracticeHand, a: { action: string; to?: number }, sim: Sim = simOf(h)): PracticeHand | string {
  const m = recordOf(setupOf(h), sim, a);
  if (typeof m === "string") return m;
  const decision: Decision = { street: sim.current!, chose: m.action, move: m, grade: null, mix: [], pot: sim.pot, provenance: null, study: studyOf(h) };
  return { ...withMoveOf(h, sim, m), decisions: [...h.decisions, decision] };
}

function withMoveOf(h: PracticeHand, sim: Sim, m: Move): PracticeHand {
  return { ...h, lines: withMove(h.lines, sim.current!, m) };
}

export function withVillain(h: PracticeHand, m: Move, sim: Sim = simOf(h)): PracticeHand {
  return withMoveOf(h, sim, m);
}

/** The hand's end for you: your fold (what you put in is lost; the others' cards stay hidden), everyone else's
 * fold, or the showdown (the board run out where nobody is left to bet). */
export function finish(h: PracticeHand, sim: Sim = simOf(h)): HandResult {
  const inv = (p: string) => (sim.invested[p] ?? 0) + (sim.cur?.bets[p] ?? 0);
  if (!sim.active.has(h.hero)) return { net: -inv(h.hero), folded: true, winners: [], says: "", pays: {} };
  if (cutAt(h, sim)) return { net: 0, folded: false, winners: [], says: "", pays: {}, cut: true };
  const live = [...sim.active];
  const st = settle(setupOf(h), sim.invested, live, sim.allin, boardOf(h), (p) => h.hands[p]!, h.rake);
  return {
    net: Math.round(((st.pays[h.hero] ?? 0) - inv(h.hero)) * 100) / 100,
    folded: false,
    winners: st.winners,
    says: says(st, h.hero, h.players),
    pays: st.pays,
    ...(st.rake > 0 ? { rake: st.rake } : {}),
  };
}

/** After your fold, what's on offer: the others to play it out ("played") where two or more are still in, else
 * everyone's cards shown; none in a preflop-only hand, or once asked. */
export function runKind(h: PracticeHand, sim: Sim = simOf(h)): PracticeHand["run"] | null {
  if (!h.result?.folded || h.run || h.preflopOnly) return null;
  return sim.active.size > 1 ? "played" : "shown";
}

/** A run-out played to its end: who won what, as it went (null until it ends). */
export function runEnd(h: PracticeHand, sim: Sim = simOf(h)): Pick<Settlement, "pays" | "winners" | "rake"> & { says: string } | null {
  if (h.run !== "played" || !sim.handOver) return null;
  const live = seatsOf(h.players).filter((p) => sim.active.has(p));
  const st = settle(setupOf(h), sim.invested, live, sim.allin, boardOf(h), (p) => h.hands[p]!, h.rake);
  return { pays: st.pays, winners: st.winners, rake: st.rake, says: live.length > 1 ? says(st, h.hero, h.players) : "" };
}

/** The board on the table: as dealt, or all of it once the cards are shown after your fold. */
export const boardShown = (h: PracticeHand) => (h.run === "shown" ? h.board.length : h.shown);

// each move said of another seat, and of you
const SAY: Record<string, [string, string]> = {
  fold: ["folds", "fold"],
  check: ["checks", "check"],
  call: ["calls", "call"],
  bet: ["bets", "bet"],
  raise: ["raises to", "raise to"],
  "all-in": ["goes all-in", "go all-in"],
};

/** A move in words: "CO raises to 2.5", "You call". */
export function sayMove(m: Move, hero: string, players: number): string {
  const you = m.pos === hero;
  const verb = SAY[m.action]?.[you ? 1 : 0] ?? m.action;
  return `${you ? "You" : seatLabel(m.pos, players)} ${verb}${m.to !== undefined ? ` ${Math.round(m.to * 100) / 100}` : ""}`;
}

/** The showdown in a line: "CO's Q-high flush beats your two pair, kings and sevens"; "" without one. */
export function says(st: Settlement, hero: string, players: number): string {
  const who = (p: string) => (p === hero ? "your" : `${seatLabel(p, players)}'s`);
  const w = st.winners;
  const v = st.val;
  if (!w.length || !v[w[0]!]) return "";
  if (w.length > 1) {
    const names = w.map((p) => (p === hero ? "you" : seatLabel(p, players)));
    const list = names.length > 2 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join(" and ");
    return `Split pot: ${list} tie with ${handName(v[w[0]!]!)}`;
  }
  const rest = Object.keys(v).filter((p) => !w.includes(p));
  // (against the best of the losing hands)
  const lo = rest.reduce<string | null>((b, p) => (b && cmp(v[b]!, v[p]!) >= 0 ? b : p), null);
  if (!lo) return "";
  const top = handName(v[w[0]!]!, v[lo]);
  const line = `${who(w[0]!)} ${top} ${/^(three|four) /.test(top) ? "beat" : "beats"} ${who(lo)} ${handName(v[lo]!, v[w[0]!])}`;
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** Your seat's cards shown; an opponent's only at a showdown it reached (not after your fold or its own). */
export function shownCards(h: PracticeHand, p: string, sim: Sim = simOf(h)): [string, string] | null {
  if (p === h.hero) return h.hands[p]!;
  // (after your fold: every hand, once the cards are shown or the run-out has ended)
  if (h.run === "shown" || (h.run === "played" && sim.handOver)) return h.hands[p]!;
  if (!h.result || h.result.folded || h.result.cut) return null;
  return sim.active.has(p) && sim.active.size > 1 ? h.hands[p]! : null;
}
