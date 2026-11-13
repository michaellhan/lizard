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
import { tournamentRequest, type TournamentSetup } from "@/features/tournaments/tournament";
import { toSearch, type StudyHand } from "@/features/study/studyState";
import { grade, type Grade } from "@/grading/grade";
import { lineToken } from "@/library/flops";
import { cmp, handName } from "@/poker/evaluate";
import { seatLabel, seatsOf } from "@/poker/seats";
import { moveOn, restarted } from "./tournamentPlay";
import {
  deal,
  DECK,
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
import { assumedWords, bestResponse, type Exploit, type ReadTally } from "./exploit";
import { drawFit, HAND_DRAWS, handLabel, isHandKey } from "./handFilter";
import { flopsLike, type TextureFilter } from "./texture";
import { nearestDepth, PF_DEPTHS, PF_DEPTHS_WORDS, PF_PLAYERS, PF_STORED_RAKE } from "@/solver/pfStored";
import { pfIcmStage, PF_ICM_WORDS } from "./pfIcmStored";

export interface Decision {
  street: Street;
  /** the solver's action you took (its name, e.g. "bet 33%"), or the move's kind where ungraded */
  chose: string;
  move: Move;
  /** null where the spot had no answer to grade against (`offProfile`, in exploit practice), or you'd seen it first (`revealed`) */
  grade: Grade | null;
  /** made after Reveal: the answer is kept with it, and it never had a grade, so nothing can count it as one */
  revealed?: true;
  /** in exploit practice, the engine gave no best response here (exploit.ts): never graded against anything else */
  offProfile?: true;
  /** the answer's actions at your spot: what the grade is against */
  mix: { action: string; freq: number; ev: number | null; amount?: number; rough?: true }[];
  pot: number;
  provenance: Provenance | null;
  /** the Study line at the decision: the action before it, the board out (Study shows your whole range there) */
  study: string;
  /** in a session graded by the preflop solve, why this decision took the chart's grade instead, in words (pfGrade.ts) */
  pfWhy?: string;
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
  pot?: HandPot;
  tries?: number;
  /** a pot drill's hand filter (handFilter.ts) this hand was dealt under, and `noFit`, where no deal could meet it: this
   * hand's cards are any, and it stops there */
  dealtTo?: string;
  noFit?: true;
  /** Instant flops: the lines this hand's flop is held on with you in them, as the index's tokens (flops.ts). None: the
   * index hasn't been read yet, so nothing is played */
  cands?: string[][];
  /** chips carried from hand to hand: each seat's chips as this hand starts, bb, and the seats that rebought to `stack` */
  stacks?: Record<string, number>;
  rebuys?: string[];
  /** your own postflop bet and raise sizes, % of the pot (the Solve page's), for the solver's tree from the flop on */
  sizes?: Sizes;
  /** the rake: % of pots that see a flop, capped in bb */
  rake?: Rake;
  /** the push/fold mode (`PUSH_FOLD_MAX`): an all-in runs out, and a hand with betting still to come stops at the flop */
  pushFold?: true;
  /** a tournament session's game: what its answers are in, and its prizes; each seat's chips are in `stacks` */
  tournament?: HandTournament;
  /** an exploit session's read: your answers are the best response to it (exploit.ts) */
  exploit?: Exploit;
  /** with `exploit`: how the opponent's moves after the flop were drawn, by the read or the equilibrium (`tallyRead`) */
  read?: ReadTally;
  /** your preflop decisions are graded by the stored preflop solve where it can answer them (pfGrade.ts) */
  pfSolve?: true;
  /** with `pfSolve`: at a spot the solve grades, your raise is at the solve's own size in place of the chart's (pfGrade.ts) */
  pfSizes?: true;
  /** with `pfSolve`, a session set to a stored tournament preset (pfIcmStored.ts): the preflop is played on the solve's tree.
   * At a spot it reads, your options are its own, and the opponents' preflop moves are drawn from it (stateFor's `pf_play`,
   * engine/pf_icm_study.play), as their charts' sizes and options aren't the tree's. */
  pfOptions?: true;
  /** after your fold (the classic trainer's runOut): "played", the others play the hand on by their strategies to its
   * end; "shown", nobody left to play, everyone's cards and the board shown. Your result stays as at your fold. */
  run?: "played" | "shown";
  /** Reveal, at the spot you're on: the answer's been seen, so your move here isn't graded. It goes as you move, so it
   * stays with the spot through a change of mode or of tables, and into the kept doc. */
  revealed?: true;
}

export type Sizes = Partial<Record<SizeStreet, number[]>>;

/** The stack the engine's push/fold band ends at (advisor.py PUSH_FOLD_STACK): at this or less a raise is an all-in,
 * and at 12.5bb it's the chart's raise again. */
export const PUSH_FOLD_MAX = 12;

/** a Practice table's stack, bb */
export const MIN_STACK = 10;
export const MAX_STACK = 250;

/** A tournament session's game. "icm": every answer is asked in prize equity, with `payouts` and `field`. "chips": chip
 * EV, which is no prizes at all, so the engine's answer is the one it gives these stacks in a cash game. */
export interface HandTournament {
  model: "icm" | "chips";
  /** the prizes still to be paid, first place first (two or more; "icm" only) */
  payouts?: number[];
  /** the players at other tables and their average stack, bb */
  field?: NonNullable<TournamentSetup["field"]>;
  /** KO or PKO bounties ("icm" only), in the prizes' units: each seat's, and the other tables' average. Played out, a
   * bounty follows its player round the table, and a PKO's grows by half of each one its player collects. */
  bounty?: PracticeBounty;
  /** played out: the players a table seats (the first hand's), which the tables are balanced to */
  seats?: number;
  /** played out (`playsOn`): hands played in this tournament before this one */
  played?: number;
  /** played out: the bounty money you've collected in this tournament, in the prizes' units */
  won?: number;
  /** played out: what happened between the last hand and this one, in words (tournamentPlay.ts) */
  news?: string[];
}
export interface PracticeBounty {
  format: "ko" | "pko" | "mystery";
  /** KO, PKO: each seat's bounty (mystery: none) */
  seats: Record<string, number>;
  /** KO, PKO: the other tables' average bounty, which a player from another table brings (mystery: 0) */
  field: number;
  /** mystery: the envelopes not yet drawn, in the prizes' units: each knockout, here or at the other tables, draws one */
  envelopes?: number[];
}

/** The bounty's name in words. */
export const bountyName = (b: Pick<PracticeBounty, "format">) => ({ ko: "KO", pko: "PKO", mystery: "mystery" })[b.format];

/** A tournament session's setup: its game and each seat's chips, bb, which every hand starts from. Unless it's played
 * out (`playsOn`), the tournament doesn't move on: nobody's knocked out, and no chips go from hand to hand. */
export interface TournamentOptions extends HandTournament {
  stacks: Record<string, number>;
}

/** The game in words. */
export const gameLabel = (t: HandTournament) =>
  t.model === "icm" ? `tournament in prize equity, prizes ${(t.payouts ?? []).join("/")}${t.bounty ? `, ${bountyName(t.bounty)} bounties` : ""}` : "tournament in chip EV";

/** What marks a chip EV session's answers, as the engine's own carry nothing of a tournament. */
export const CHIP_MODEL = "chip EV: these stacks with no prizes";

/** The drill modes (the classic trainer's, `practice.js:169-196`): only one kind of pot. The preflop is played for you
 * too (from the charts, as the opponents' is), and the hand dealt again until it reaches the flop heads-up, you in it, as
 * that kind of pot; you play from the flop. */
export type PotDrill = "srp" | "3bet" | "4bet" | "bvb";
export const POT_DRILLS: Record<PotDrill, { label: string; one: string; tip: string }> = {
  srp: { label: "Single-raised pots", one: "a single-raised pot", tip: "Heads-up from the flop; preflop played for you" },
  "3bet": { label: "3-bet pots", one: "a 3-bet pot", tip: "Heads-up from the flop; preflop played for you" },
  // (no library spot holds one: its decisions are live solves on the charts' ranges)
  "4bet": { label: "4-bet pots", one: "a 4-bet pot", tip: "Live solves only; rare to deal" },
  bvb: { label: "Blind vs blind", one: "a blind-vs-blind pot", tip: "SB vs BB from the flop; preflop played for you" },
};
/** The drills' board filter's flops, as a hand's cards: none where it's not a drill's pot or the filter is empty. */
const flopsFor = (o: DealOptions): readonly string[] | null => (isPotDrill(o.pot) && o.board && Object.values(o.board).some(Boolean) ? flopsLike(o.board) : null);
export const isPotDrill = (x: unknown): x is PotDrill => typeof x === "string" && Object.hasOwn(POT_DRILLS, x);
/** A hand's pot: a drill, or Instant flops, a heads-up flop the library holds. That one needs the tables' index, so it's
 * no drill: it isn't in POT_DRILLS, and the Play select stays as it was. */
export type HandPot = PotDrill | "lib";
export const INSTANT_FLOPS = { label: "Instant flops", one: "an instant flop", tip: "A library flop; preflop played for you" };
export const isHandPot = (x: unknown): x is HandPot => x === "lib" || isPotDrill(x);
/** A hand's pot in words. */
export const potLabel = (p: HandPot) => (p === "lib" ? INSTANT_FLOPS : POT_DRILLS[p]).one;
/** the deals a drill hand may take to reach its pot */
export const DRILL_TRIES = 400;
/** A heads-up 4-bet pot with you in it comes about once in 350 to 1,000 deals, by seat, on the charts. */
export const drillTries = (pot: HandPot | null | undefined) => (pot === "4bet" ? 3000 : DRILL_TRIES);
/** Deals for each that reaches the pot with such a hand, at the hardest seat, where `drillTries` can run out more than one
 * time in fifty. Measured 2026-11-05: 400,000 deals a seat on the 6-max 100bb charts, each hand class's rate over the
 * classes a filter's deals hold. Another game's rates aren't known. Other pots, and other hands, need far fewer. */
const HARD_HANDS: Partial<Record<PotDrill, Record<string, number>>> = {
  "3bet": { "m:straight": 117, "m:trips": 183, "m:two_pair": 185, "m:top_wk": 388, "m:weak": 116, "m:nothing": 340, "d:oesd": 178, "d:gutshot": 116, "d:backdoor": 105 },
  "4bet": { "m:straight": 1086, "m:trips": 1081, "m:two_pair": 1136, "m:top_wk": 4542, "m:weak": 2674, "m:nothing": 8147, "d:oesd": 3824, "d:gutshot": 797 },
};
/** How many deals reach this pot with this hand at the hardest seat, where that's few enough to matter; else null. */
export const hardHand = (pot: PotDrill, key: string): number | null => HARD_HANDS[pot]?.[key] ?? null;
/** Whether a pot drill deals to this hand filter: a key offered, that the pot's deals find three times in four at any
 * seat. Past that a search mostly ends in "No such pot", after the longest wait there is, so it isn't offered. */
export function handWorks(pot: unknown, key: unknown): key is string {
  if (!isPotDrill(pot) || !isHandKey(key)) return false;
  const deals = hardHand(pot, key);
  return deals === null || Math.exp(-drillTries(pot) / deals) <= 0.25;
}
/** A drill hand gone another way has another deal left. */
export const dealsLeft = (h: Pick<PracticeHand, "pot" | "tries" | "noFit">) => !h.noFit && (h.tries ?? 0) + 1 < drillTries(h.pot);
/** Why a drill's deals stopped, in words. */
export function dealsOut(h: Pick<PracticeHand, "pot" | "dealtTo" | "noFit">): string {
  const hand = h.dealtTo ? handLabel(h.dealtTo) : "";
  if (h.noFit) return `No ${hand} came up in ${HAND_DRAWS.toLocaleString("en-US")} draws of a flop and your cards: pick other hands or widen the flop.`;
  const pot = potLabel(h.pot!).replace(/^an? /, "");
  const deals = drillTries(h.pot).toLocaleString("en-US");
  if (hand) return `No ${pot} with ${hand} in ${deals} deals: try another seat or other hands.`;
  return `No ${pot} in ${drillTries(h.pot)} deals${h.pot === "lib" ? " at this seat: try another seat or spot" : ""}.`;
}
const BLINDS = ["SB", "BB"];

/** Your seat each hand: moving one place a hand ("moves"), drawn at random from the hand's seed ("random"), or one
 * seat (its name). */
export type SeatChoice = string;
export interface HandOptions {
  seat?: SeatChoice;
  preflopOnly?: boolean;
  pot?: HandPot | null;
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

/** A session's kind of game, which most sessions don't set. */
export interface GameOptions {
  /** the push/fold mode: the setup's stack is PUSH_FOLD_MAX or less */
  pushFold?: boolean;
  /** a tournament: each seat's chips and what the answers are in */
  tournament?: TournamentOptions;
  /** exploit practice, in a pot drill: your decisions are graded against the best response to this read (exploit.ts) */
  exploit?: Exploit;
  /** grade your preflop decisions by the stored preflop solve (`pfBlocked` says where it can) */
  pfSolve?: boolean;
  /** with `pfSolve`: offer the solve's own raise sizes where it grades the spot, in place of the chart's */
  pfSizes?: boolean;
}

/** What a hand can be dealt by beyond the HandOptions: in a pot-type mode, a flop of this texture (null: any flop), and
 * a hand filter's key (handFilter.ts; null: any hand), read on your cards and the flop dealt. */
export interface DealOptions extends HandOptions, GameOptions {
  board?: TextureFilter | null;
  hand?: string | null;
}
/** A session's setup, as it's kept. One kept before the board filter or the hand filter has none. */
export type SessionOptions = Required<HandOptions> & GameOptions & Pick<DealOptions, "board" | "hand">;

/** A session that's only ever any hand above one table: a pot played for you would stop it being what was set up. */
export const anyHandOnly = (o: Pick<HandOptions, "preflopOnly"> & GameOptions) => !!o.preflopOnly || !!o.pushFold || !!o.tournament;

/** Whether the options carry chips: full hands (not preflop only or a drill's pot), your seat moving one place a hand,
 * so each player keeps a seat and its chips follow it. */
export const carries = (o: HandOptions & GameOptions) => !!o.carry && (o.seat ?? "moves") === "moves" && !o.preflopOnly && !o.pot && !o.pushFold && !o.tournament;

/** Whether a tournament session is played out (tournamentPlay.ts): its `carry` set, full hands, your seat moving with
 * the button. */
export const playsOn = (o: HandOptions & GameOptions) => !!o.tournament && !!o.carry && (o.seat ?? "moves") === "moves" && !o.preflopOnly;

export { PF_STORED_RAKE } from "@/solver/pfStored";

/** Why a session can't be graded by the preflop solve, in words; null where it can. It can only where the worker already
 * holds a stored solve of this very game (pf_study.STORED and Lizard's grid, `@/solver/pfStored`; a tournament's, the
 * presets stored in prize equity, `./pfIcmStored`), as Practice never starts one. */
export function pfBlocked(players: number, stack: number, o: Pick<HandOptions, "pot" | "ante" | "straddle" | "carry" | "seat" | "preflopOnly" | "sizes" | "rake" | "rakeCap"> & GameOptions): string | null {
  const stored = "The preflop solve is stored for";
  const solveFirst = "This game would need a solve first, and Practice doesn't start one: Study can.";
  if (o.pot) return "One kind of pot plays your preflop for you, so there's no preflop decision to grade.";
  if (o.tournament?.model === "icm") {
    // (a stored tournament preset, engine/pf_icm_stored.py: solved in prize equity, as Practice sends the preset)
    if (playsOn(o as HandOptions & GameOptions)) return "Played out, the stacks and prizes move on from the preset's, and the preflop solve is stored for the preset as it starts.";
    if (!pfIcmStage(players, stack, o.ante, o.tournament)) return `A tournament's preflop solve is stored for these presets only, as they set the table, with no bounties: ${PF_ICM_WORDS}. ${solveFirst}`;
    if (o.sizes && Object.keys(o.sizes).length) return "The preflop solve prices its flops by the engine's bet sizes, not your own.";
    return null;
  }
  // (a chip EV tournament is sent as a cash game: stored where every seat has the table's stack and the grid has it)
  if (o.tournament && Object.values(o.tournament.stacks).some((v) => Math.abs(v - stack) > 1e-9)) return `${stored} equal stacks only in chip EV. ${solveFirst}`;
  if (!(PF_PLAYERS as readonly number[]).includes(players)) return `${stored} 2 to ${PF_PLAYERS.at(-1)} players only. ${solveFirst}`;
  if (!(PF_DEPTHS as readonly number[]).includes(stack)) return `${stored} stacks of ${PF_DEPTHS_WORDS} only; the nearest is ${nearestDepth(stack)}bb. ${solveFirst}`;
  if (o.ante || o.straddle) return `${stored} no ante and no straddle only. ${solveFirst}`;
  if (o.rake && !(o.rake === PF_STORED_RAKE.pct && o.rakeCap === PF_STORED_RAKE.cap)) return `${stored} no rake, or ${PF_STORED_RAKE.pct}% capped at ${PF_STORED_RAKE.cap}bb. ${solveFirst}`;
  if (carries(o)) return `Carried chips leave stacks other than the solve's ${stack}bb each.`;
  if (o.sizes && Object.keys(o.sizes).length) return "The preflop solve prices its flops by the engine's bet sizes, not your own.";
  return null;
}

/** A session's options with the preflop solve as preflop's grade where the game is stored, unless it was chosen off
 * (`pfSolve: false`): the default wherever Practice starts a session the setup didn't say. */
export const pfByDefault = <O extends SessionOptions>(players: number, stack: number, o: O): O =>
  o.pfSolve === undefined && !pfBlocked(players, stack, o) ? { ...o, pfSolve: true } : o;

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
export function seatFor(choice: SeatChoice | undefined, n: number, players: number, seed: number, pot?: HandPot | null): string {
  const s = seatsOf(players);
  if (pot === "bvb") return choice && BLINDS.includes(choice) ? choice : BLINDS[(choice === "random" ? seed : n) % 2]!;
  if (choice === "random") return s[seed % players]!;
  return choice && s.includes(choice) ? choice : heroSeat(n, players);
}

/** Every seat's cards and the board with the flop drawn evenly from `flops`, the rest shuffled from what's left: a
 * pot-type mode's board filter, read before the preflop's played, as a mode deals until it reaches its pot and a rare
 * flop would use up its deals. */
function dealOnFlop(players: number, rnd: () => number, flops: readonly string[]): ReturnType<typeof deal> {
  const f = flops[Math.floor(rnd() * flops.length)]!;
  return dealAround(players, rnd, [f.slice(0, 2), f.slice(2, 4), f.slice(4, 6)]);
}

/** The deal with this flop and, if any, your two cards in it: the rest shuffled from what's left. */
function dealAround(players: number, rnd: () => number, flop: readonly string[], you?: { seat: string; hole: [string, string] }): ReturnType<typeof deal> {
  const deck = DECK.filter((c) => !flop.includes(c) && !you?.hole.includes(c));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  const hands: Record<string, [string, string]> = {};
  for (const p of seatsOf(players)) hands[p] = p === you?.seat ? you.hole : [deck.pop()!, deck.pop()!];
  return { hands, board: [...flop, deck[0]!, deck[1]!] };
}

/** The n-th hand of a session. With chips carried, `table` gives each seat's chips (nextTable); without it, every seat
 * starts at `stack`. */
export function newHand(players: number, stack: number, n: number, seed: number, opts: DealOptions = {}, table?: Table): PracticeHand {
  const flops = flopsFor(opts);
  const hero = table?.hero ?? seatFor(opts.seat, n, players, seed, opts.pot);
  const rnd = seeded(seed);
  // (the filter's search, ahead of the preflop, as a mode deals until it reaches its pot and each of those deals would use up
  // its turn on a hand that couldn't count)
  const dealtTo = isPotDrill(opts.pot) && opts.hand ? opts.hand : null;
  const fit = dealtTo ? drawFit(dealtTo, rnd, flops?.length ? flops : null) : null;
  const d = fit ? dealAround(players, rnd, fit.flop, { seat: hero, hole: fit.hole }) : flops?.length ? dealOnFlop(players, rnd, flops) : deal(players, rnd);
  return {
    seed,
    n,
    players,
    stack,
    hero,
    ...d,
    shown: 0,
    lines: noLines(),
    decisions: [],
    result: null,
    ...(opts.pot ? { pot: opts.pot } : opts.preflopOnly ? { preflopOnly: true as const } : {}),
    ...(dealtTo ? { dealtTo, ...(fit ? {} : { noFit: true as const }) } : {}),
    ...(opts.ante && opts.ante > 0 ? { ante: opts.ante } : {}),
    ...(opts.straddle && players >= 3 ? { straddle: true as const } : {}),
    ...(opts.sizes && Object.keys(opts.sizes).length ? { sizes: opts.sizes } : {}),
    ...(opts.rake && opts.rake > 0 ? { rake: { pct: opts.rake, ...(opts.rakeCap && opts.rakeCap > 0 ? { cap: opts.rakeCap } : {}) } } : {}),
    ...(carries(opts) ? { stacks: table?.stacks ?? Object.fromEntries(seatsOf(players).map((p) => [p, stack])), ...(table?.rebuys.length ? { rebuys: table.rebuys } : {}) } : {}),
    ...(opts.pushFold ? { pushFold: true as const } : {}),
    ...(opts.tournament ? (table?.tournament ? { tournament: table.tournament, stacks: table.stacks } : tournamentHand(opts.tournament)) : {}),
    ...(opts.exploit ? { exploit: opts.exploit } : {}),
    ...(opts.pfSolve && !pfBlocked(players, stack, opts)
      ? { pfSolve: true as const, ...(opts.pfSizes ? { pfSizes: true as const } : {}), ...(opts.tournament?.model === "icm" ? { pfOptions: true as const } : {}) }
      : {}),
  };
}

const tournamentHand = ({ stacks, ...game }: TournamentOptions) => ({ tournament: game, stacks });

export interface Table {
  stacks: Record<string, number>;
  rebuys: string[];
  /** a tournament played out: your seat, and the game as it stands */
  hero?: string;
  tournament?: HandTournament;
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
export function following(h: PracticeHand, seed: number, opts: DealOptions, reset = false, n = h.n + 1): PracticeHand {
  if (playsOn(opts) && opts.tournament) {
    // (a tournament played out: from where this hand left it, or over and started again; `reset` starts it again)
    const setup = opts.tournament;
    // (a mystery envelope's draw from its own stream of the next hand's seed)
    const m = h.tournament && !reset ? moveOn({ ...h, tournament: h.tournament }, chipsAfter(h), seeded(seed * 31 + 7)) : { table: null, news: [] };
    if (m.table) return newHand(m.table.players, h.stack, n, seed, opts, { stacks: m.table.stacks, rebuys: [], hero: m.table.hero, tournament: m.table.tournament });
    const players = Object.keys(setup.stacks).length;
    return newHand(players, h.stack, n, seed, opts, { stacks: setup.stacks, rebuys: [], tournament: restarted(setup, m.news) });
  }
  return newHand(h.players, h.stack, n, seed, opts, carries(opts) && !reset ? nextTable(h) : undefined);
}

/** A drill hand that went another way, dealt again (the same hand number: your seat stays where it moves). */
export const redeal = (h: PracticeHand, seed: number, opts: DealOptions): PracticeHand => ({ ...newHand(h.players, h.stack, h.n, seed, opts), tries: (h.tries ?? 0) + 1 });

/** A drill hand whose preflop has gone another way (to be dealt again), else false (still on course, or on the
 * flop): you folded, an all-in, too many raises, someone not in the blinds in a blind-vs-blind pot, or the flop
 * reached by more than two players or with another number of raises (the classic trainer's `offDrill`). Instant flops:
 * no line held for this flop still fits, you folded, or the flop came on a line that's only the start of one. */
export function offDrill(h: PracticeHand, sim: Sim = simOf(h)): boolean {
  if (h.noFit) return true;
  if (!h.pot || h.shown >= 3) return false;
  const pre = h.lines.preflop;
  if (h.pot === "lib") {
    if (!h.cands) return false;
    const toks = pre.map(lineToken);
    const on = h.cands.filter((c) => toks.every((x, i) => c[i] === x));
    if (!on.length || sim.handOver || !sim.active.has(h.hero)) return true;
    return sim.waiting === "flop" && !on.some((c) => c.length === toks.length);
  }
  const raises = pre.filter((m) => m.action === "raise" || m.action === "bet").length;
  const want = h.pot === "srp" ? 1 : h.pot === "3bet" ? 2 : h.pot === "4bet" ? 3 : null;
  if (!sim.active.has(h.hero) || pre.some((m) => m.action === "all-in") || (want != null && raises > want)) return true;
  if (h.pot === "bvb" && (!BLINDS.includes(h.hero) || pre.some((m) => !BLINDS.includes(m.pos) && m.action !== "fold"))) return true;
  if (sim.handOver) return true;
  return sim.waiting === "flop" && (sim.active.size !== 2 || (want != null && raises !== want));
}

/** Still dealing a drill's pot: its preflop, played for you. */
export const seeking = (h: PracticeHand) => !!h.pot && h.shown < 3 && !h.result;

/** Instant flops with the index still to come: nothing can be played yet. */
export const needsIndex = (h: PracticeHand) => seeking(h) && h.pot === "lib" && !h.cands;

/** Its preflop can be drawn from the charts' mix at each node: played for you, in the one game a chart's request says
 * (six players, 100bb each and nothing else: `chartKey` and `chartState` carry no ante, straddle, rake or sizes). */
export const charting = (h: PracticeHand) => seeking(h) && h.players === 6 && h.stack === 100 && !h.ante && !h.straddle && !h.rake && !h.sizes && !h.stacks;

/** Two or more can still bet: the push/fold mode has nothing to say after the flop, where an all-in just runs out. */
const stillBetting = (sim: Sim) => [...sim.active].filter((p) => !sim.allin.has(p)).length > 1;

/** Preflop only, the preflop closed with you and someone else in: the hand stops there. So does a push/fold hand that isn't
 * all-in by then, which the engine's opponents don't get to: it takes a move played without a grade. */
const cutAt = (h: PracticeHand, sim: Sim) => (!!h.preflopOnly || (!!h.pushFold && stillBetting(sim))) && !!sim.streets.preflop?.closed && !sim.handOver && sim.active.has(h.hero);

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
export const rakeSetup = (h: Pick<PracticeHand, "rake">) => (h.rake ? { rake: h.rake.pct, ...(h.rake.cap ? { rakeCap: h.rake.cap } : {}) } : {});

/** The hand's prizes, in the engine's keys and in Study's setup. A chip EV session has none to send. */
const prizesOf = (h: Pick<PracticeHand, "tournament">): TournamentSetup | undefined => {
  const t = h.tournament;
  if (t?.model !== "icm") return undefined;
  const b = t.bounty;
  // (mystery: the money in the envelopes left and how many, which the engine values a knockout by; none left, no bounty)
  const env = b?.envelopes ?? [];
  const bounty = !b
    ? undefined
    : b.format === "mystery"
      ? env.length
        ? { format: b.format, pool: Math.round(env.reduce((x, y) => x + y, 0) * 100) / 100, left: env.length }
        : undefined
      : { format: b.format, seats: b.seats, field: b.field };
  return { payouts: t.payouts, field: t.field, ...(bounty ? { bounty } : {}) };
};

/** The seats whose chips aren't the starting stack (chips carried, a tournament's), bb; none where every seat has it. */
const ownStacks = (h: Pick<PracticeHand, "stack" | "stacks">) => {
  const own = Object.entries(h.stacks ?? {}).filter(([, v]) => Math.abs(v - h.stack) > 1e-9);
  return own.length ? { stacks: Object.fromEntries(own) } : {};
};

export const simOf = (h: PracticeHand): Sim => simulate(setupOf(h), h.lines, h.shown);

const boardOf = (h: PracticeHand) => h.board.slice(0, h.shown);

/** The Study line where the hand stands: each seat's chips as the hand started, with the hand's ante, straddle,
 * sizes and rake. `solved`: at the preflop solve rather than the charts, as a decision graded by it was. */
export function studyOf(h: PracticeHand, solved = false): string {
  const conv = (ms: Move[]) => ms.map((m) => ({ pos: m.pos, action: m.action, ...(m.to !== undefined ? { to: m.to } : {}) }));
  const s: StudyHand = {
    players: h.players,
    stack: h.stack,
    board: boardOf(h).join(""),
    preflop: conv(h.lines.preflop),
    flop: conv(h.lines.flop),
    turn: conv(h.lines.turn),
    river: conv(h.lines.river),
    ...(solved ? { pf: "solver" as const } : {}),
    ...(h.ante || h.straddle || h.sizes || h.rake || ownStacks(h).stacks || prizesOf(h) ? { setup: { ...gameOf(h), ...ownStacks(h), ...(h.sizes ? { sizes: h.sizes } : {}), ...rakeSetup(h), ...(prizesOf(h) ? { tournament: prizesOf(h) } : {}) } } : {}),
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
    ...tournamentRequest(prizesOf(h), h.players),
    // (your sizes change the postflop solves only: sent from the flop on, as the classic page does, so preflop's
    // answer is the same)
    ...(h.sizes && h.shown >= 3 ? { sizes: h.sizes } : {}),
    // (a stored tournament preset's preflop: the opponents' moves from the solve, engine/pf_icm_study.play)
    ...(h.pfOptions && h.shown < 3 ? { pf_play: true } : {}),
  };
}

/** Your advice's request. In exploit practice, heads up after the flop, it carries the read on your opponent, and so does
 * their move's (flow.ts `needOf`), which engine/exploit_play.py draws from the read (exploit.ts). */
export function adviceState(h: PracticeHand, sim: Sim = simOf(h)): AdvisorState {
  const state = stateFor(h);
  if (!h.exploit || h.shown < 3) return state;
  const others = [...sim.active].filter((p) => p !== h.hero);
  return others.length === 1 ? { ...state, locks: { [others[0]!]: { ...h.exploit.lock } } } : state;
}

/** The request of the preflop solve at your spot. The engine drops your seat and cards (Advisor.study): a retry reads them. */
export const pfState = (h: PracticeHand): AdvisorState => ({ ...stateFor(h), study: true, preflop_solve: true });

/** The request that answers a decision again: what it was graded on. */
export const askOf = (h: PracticeHand, d: Pick<Decision, "provenance">): AdvisorState => (d.provenance?.source === "preflop-solve" ? pfState(h) : adviceState(h));

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

/** There's a bet for `seat` to call. */
export const facingBet = (sim: Sim, seat: string) => (sim.cur?.curBet ?? 0) - (sim.cur?.bets[seat] ?? 0) > 1e-9;

/** The seat to act's check, or its call where there's a bet. */
export function checkOrCall(h: PracticeHand, sim: Sim = simOf(h)): Move {
  const p = sim.toAct!;
  return { pos: p, action: facingBet(sim, p) ? "call" : "check" };
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
  const read = h.exploit && provenance?.lock ? " · its best response to the assumed profile" : "";
  return { grid: res.grid, cls: classOf(h.hands[h.hero]!.join("")), label: `Your range · ${sim.current} · ${seatLabel(h.hero, h.players)}${against}${read}` };
}

/** Your options: the answer's actions at your spot. */
export function optionsOf(res: AdvisorResponse | null | undefined): AdvisorActionStat[] {
  return res && !res.error && Array.isArray(res.actions) ? res.actions : [];
}

/** The move one of the answer's actions records (sizes to the half big blind, as the table takes them). `exact`: a raise
 * at the preflop solve's own size, which is its to the cent: its 4-bets are to 17.25bb and 27.6bb, and rounded they'd be a
 * raise it holds no EV for, and a line off its tree. */
export function moveOfOption(h: PracticeHand, a: AdvisorActionStat, sim: Sim = simOf(h), exact = false): Move | string {
  const kind = kindOf(a.action);
  const to = typeof a.amount_bb === "number" ? a.amount_bb : undefined;
  const m = recordOf(setupOf(h), sim, { action: kind, to, clamp: true });
  return exact && typeof m !== "string" && m.action === "raise" && to !== undefined ? { ...m, to } : m;
}

/** The answer's mix at your spot, per action: frequency, and EV where the answer has EVs for every action. */
export function mixOf(res: AdvisorResponse): Decision["mix"] {
  return optionsOf(res).map((a) => ({
    action: a.action,
    freq: a.freq ?? 0,
    ev: typeof a.ev_bb === "number" ? a.ev_bb : null,
    ...(typeof a.amount_bb === "number" ? { amount: a.amount_bb } : {}),
    // (advisor.py: a move the range almost never takes has a rough EV)
    ...(a.rough_ev ? { rough: true as const } : {}),
  }));
}

/** The mix as it's graded: a fallback's EVs in a prize-equity session are chips, which can't go beside the session's prize
 * equity, so it's by frequency. */
export const gradable = (mix: Decision["mix"], p: Pick<Provenance, "evIn"> | null | undefined): Decision["mix"] => (p?.evIn === "chips" ? mix.map((a) => ({ ...a, ev: null })) : mix);

/** The answer's provenance as the hand's game has it: a chip EV session's says so, as the engine's can't. */
export function modelled(h: Pick<PracticeHand, "tournament" | "exploit">, p: Provenance | null): Provenance | null {
  if (p && h.exploit) return p.lock ? bestResponse(p, assumedWords(h.exploit)) : p;
  return p && h.tournament?.model === "chips" ? { ...p, tournament: CHIP_MODEL } : p;
}

/** Whether an exploit session can grade against this answer: the engine says it's locked, with an EV for every action.
 * Anything else (it can drop a lock and say so) isn't what the session is graded against, so it goes ungraded. */
export const isBestResponse = (mix: Decision["mix"], p: Pick<Provenance, "lock"> | null | undefined): boolean => !!p?.lock && mix.length > 0 && mix.every((a) => a.ev !== null);

/** The mix's i-th action graded: by EV where it has EVs for every action, else by frequency (the preflop charts). */
export function gradeMix(mix: Decision["mix"], pot: number, i: number): Grade {
  const evs = mix.every((x) => x.ev !== null) ? mix.map((x) => x.ev!) : null;
  return grade({ freqs: mix.map((x) => x.freq), evs, pot }, i);
}

/** Your decision: the answer's i-th action taken, graded against the answer (by EV where it has EVs for every
 * action, else by frequency: the preflop charts). `pfWhy`: why a session graded by the preflop solve took this answer
 * from the charts. */
export function decide(
  h: PracticeHand,
  res: AdvisorResponse,
  i: number,
  provenance: Provenance | null,
  sim: Sim = simOf(h),
  pfWhy?: string,
): { hand: PracticeHand; decision: Decision } | { error: string } {
  const a = optionsOf(res)[i];
  if (!a) return { error: "That action isn't in the answer." };
  const m = moveOfOption(h, a, sim, (!!h.pfSizes || !!h.pfOptions) && provenance?.source === "preflop-solve");
  if (typeof m === "string") return { error: m };
  const mix = gradable(mixOf(res), provenance);
  const pot = typeof res.pot_bb === "number" ? res.pot_bb : sim.pot;
  const offProfile = !!h.exploit && !isBestResponse(mix, provenance);
  const decision: Decision = {
    street: sim.current!,
    chose: a.action,
    move: m,
    grade: h.revealed || offProfile ? null : gradeMix(mix, pot, i),
    mix,
    pot,
    provenance: modelled(h, provenance),
    study: studyOf(h, provenance?.source === "preflop-solve"),
    ...(h.revealed ? { revealed: true as const } : {}),
    ...(offProfile ? { offProfile: true as const } : {}),
    ...(pfWhy ? { pfWhy } : {}),
  };
  return { hand: withDecision(h, sim, m, decision), decision };
}

/** A move with no answer to grade against (the solve failed): recorded, not graded. */
export function decideUngraded(h: PracticeHand, a: { action: string; to?: number }, sim: Sim = simOf(h)): PracticeHand | string {
  const m = recordOf(setupOf(h), sim, a);
  if (typeof m === "string") return m;
  const decision: Decision = { street: sim.current!, chose: m.action, move: m, grade: null, mix: [], pot: sim.pot, provenance: null, study: studyOf(h), ...(h.revealed ? { revealed: true as const } : {}) };
  return withDecision(h, sim, m, decision);
}

/** The hand after your decision: its move on the line, the decision kept, and a Reveal gone with the spot it was for. */
function withDecision(h: PracticeHand, sim: Sim, m: Move, d: Decision): PracticeHand {
  const next: PracticeHand = { ...withMoveOf(h, sim, m), decisions: [...h.decisions, d] };
  delete next.revealed;
  return next;
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

/** "bet 33%" (to 1.8bb), "raise 2.5": the solver's name, with the size it plays where the name doesn't say it. */
export function optionLabel(name: string, amount: number | undefined): string {
  const k = kindOf(name);
  const size = typeof amount === "number" ? String(Math.round(amount * 100) / 100) : null;
  if (!(k === "bet" || k === "raise") || size === null) return name;
  // (a name that says the size already, "raise to 7" or "raise 2.5", gets its unit; one that doesn't, "bet 33%", the size)
  const said = new RegExp(`(^|[^\\d.])${size.replace(".", "\\.")}(?![\\d.%])(?!\\s*bb)`);
  return said.test(name) ? name.replace(said, `$1${size}bb`) : name.includes(`${size}bb`) ? name : `${name} (${size}bb)`;
}
