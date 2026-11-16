// Live opponents: a session option where the other seats play like a typical live cash game's regulars rather than the
// equilibrium. It's a hand-set rule model, not population data: preflop they limp and call too much, raise only good
// hands and fold to a 3-bet without one; after the flop they call down with any pair or draw, raise only strong hands,
// bet their good hands and seldom bluff. Your decisions are still graded against the equilibrium.
//
// More action ("loose"): looser still, for more hands played and more multiway pots: preflop they limp or call an open
// with about 60% of hands and call 3-bets wider; after the flop they call a bet with any pair or draw nearly always and
// float with nothing a good part of the time, and bet more. You're dealt hands worth playing (`worthPlaying`, practice.ts
// `newHand`). Also hand-set rules, graded against the equilibrium.
//
// The move is the solver's or the chart's draw (what a GTO player would do) changed by the rules. Drawn by the hand's
// seed and its place in the hand, so the same spot always gets the same move (ahead.ts plays the hand on before the
// table does, and the two must agree). Sizes come from the move's own mix where it has one, so a pot stays on the
// solver's tree where it can.
import { kindOf } from "@/components/actions";
import { classOf } from "@/engine/nlhe/cards";
import { rank7 } from "@/poker/evaluate";
import { seeded, type Sim } from "@/poker/table";
import type { AdvisorActionStat, PlayMove } from "@/solver/protocol";
import type { PracticeHand } from "./practice";

/** What moveOf takes: the action, its size, and the mix it was drawn from where the solver gave one. */
export type OppMove = Pick<PlayMove, "action" | "to"> & { actions?: AdvisorActionStat[] };

export const LIVE_NOTE =
  "Hand-set rules for a typical live cash game, not population data: more limps and calls, fewer bluffs, raises mean strength. Your decisions are still graded against the equilibrium.";

export const LOOSE_NOTE =
  "More action: you\u2019re dealt hands worth playing (about the best 36%), and the others limp and call wide (about 60% of hands) and fold less after the flop, so more pots go multiway. Hand-set rules, not population data; your decisions are still graded against the equilibrium. More multiway pots mean more spots answered by a live solve or, with 5+ in, the betting rules.";

const RANKS = "23456789TJQKA";
const val = (c: string) => RANKS.indexOf(c[0]!) + 2;

const PREMIUM = new Set(["AA", "KK", "QQ", "AKs", "AKo"]);
const STRONG = new Set(["JJ", "TT", "AQs", "AQo", "AJs", "KQs"]);

/** The hands a live regular plays: pairs, suited aces, suited broadways and connectors, the better offsuit broadways. */
export function playable(cls: string): boolean {
  if (PREMIUM.has(cls) || STRONG.has(cls)) return true;
  const [a, b] = [val(cls[0]!), val(cls[1]!)];
  if (a === b) return true;
  const suited = cls[2] === "s";
  if (suited && a === 14) return true;
  if (suited && a >= 11 && b >= 9) return true; // K9s+, Q9s+, J9s+
  if (suited && a === 10 && b >= 8) return true; // T9s, T8s
  if (suited && a - b === 1 && b >= 4) return true; // 54s and up
  if (suited && a - b === 2 && b >= 4) return true; // 64s and up
  return !suited && b >= 10; // ATo+, KTo+, QTo+, JTo
}

/** The hands More action deals you: any pair; any suited ace or king, suited queens to Q6, jacks to J7, and suited
 * connectors and one-gappers from 5-4 and 6-4 up; any offsuit ace, and two offsuit cards ten or better or T-9 (482 of
 * 1,326 combos, 36%). */
export function worthPlaying(cls: string): boolean {
  const [a, b] = [val(cls[0]!), val(cls[1]!)];
  if (a === b) return true;
  if (cls[2] === "s") return a >= 13 || (a === 12 && b >= 6) || (a === 11 && b >= 7) || (a - b <= 2 && b >= 4);
  return a === 14 || b >= 10 || (a === 10 && b === 9);
}

/** The hands a loose player limps or calls an open with: any pair, any suited hand, any ace, two cards nine or better,
 * K7o+, Q7o+, and offsuit connectors and one-gappers from 5-4 up (822 of 1,326 combos, 62%). */
export function looseCalls(cls: string): boolean {
  const [a, b] = [val(cls[0]!), val(cls[1]!)];
  if (a === b || cls[2] === "s" || a === 14) return true;
  if (b >= 9 || (a >= 12 && b >= 7)) return true;
  return a - b <= 2 && b >= 4;
}

/** How a live player sees their hand after the flop: 3 two pair or better made with their cards, 2 top pair or an
 * overpair, 1 a weaker pair, 0 nothing; `draw`, a flush draw or an open-ended straight draw with a card to come. */
export function handTier(hole: readonly string[], board: readonly string[]): { tier: 0 | 1 | 2 | 3; draw: boolean } {
  const all = [...hole, ...board];
  const cat = rank7(all)[0]!;
  const boardCat = boardCategory(board);
  const top = Math.max(...board.map(val));
  const [h1, h2] = [val(hole[0]!), val(hole[1]!)];
  const boardVals = new Set(board.map(val));
  let tier: 0 | 1 | 2 | 3 = 0;
  // (a pair of the board's paired with one of yours is a pair, not two pair)
  const pairOnly = cat === 1 || (cat === 2 && boardCat === 1);
  if (cat >= 2 && cat > boardCat && !pairOnly) tier = 3;
  else if (pairOnly && cat > boardCat) {
    if (h1 === h2) tier = h1 > top ? 2 : 1;
    else tier = (boardVals.has(h1) && h1 === top) || (boardVals.has(h2) && h2 === top) ? 2 : boardVals.has(h1) || boardVals.has(h2) ? 1 : 0;
  }
  return { tier, draw: board.length < 5 && (flushDraw(hole, board) || openEnded(hole, board)) };
}

/** The board's own made hand by rank alone (a flop or turn can't hold a straight or flush). */
function boardCategory(board: readonly string[]): number {
  if (board.length >= 5) return rank7(board)[0]!;
  const n = [...new Set(board.map(val))].map((v) => board.filter((c) => val(c) === v).length).sort((a, b) => b - a);
  return n[0] === 4 ? 7 : n[0] === 3 ? 3 : n[0] === 2 ? (n[1] === 2 ? 2 : 1) : 0;
}

function flushDraw(hole: readonly string[], board: readonly string[]): boolean {
  return hole.some((h) => [...hole, ...board].filter((c) => c[1] === h[1]).length === 4);
}

function openEnded(hole: readonly string[], board: readonly string[]): boolean {
  const vs = new Set([...hole, ...board].map(val));
  const mine = new Set(hole.map(val));
  for (let lo = 2; lo + 3 <= 13; lo += 1) {
    const run = [lo, lo + 1, lo + 2, lo + 3];
    if (run.every((v) => vs.has(v)) && run.some((v) => mine.has(v)) && !vs.has(lo === 2 ? 14 : lo - 1) && !vs.has(lo + 4)) return true;
  }
  return false;
}

/** The bet or raise sizes (to, chips) the move's mix offered, smallest first; all-ins left out. */
function sizesOf(mv: OppMove, kind: "bet" | "raise"): number[] {
  return (mv.actions ?? [])
    .filter((a) => kindOf(a.action) === kind && Number(a.amount_bb) > 0)
    .map((a) => Math.round(Number(a.amount_bb) * 100) / 100)
    .sort((a, b) => a - b);
}

const movesSoFar = (h: PracticeHand) => h.lines.preflop.length + h.lines.flop.length + h.lines.turn.length + h.lines.river.length;

/** The seat to act's move as a live regular (or, More action, a loose player) would make it, from the solver's (or
 * chart's) `mv`. Unchanged outside such a session, at your own seat (a drill's preflop played for you), in a drill's pot
 * or an exploit session. */
export function liveMove(h: PracticeHand, mv: OppMove, sim: Sim): OppMove {
  const seat = sim.toAct;
  if ((h.opponents !== "live" && h.opponents !== "loose") || !seat || seat === h.hero || h.pot || h.exploit || !sim.cur) return mv;
  const rnd = seeded(((h.seed ^ 0x6c8e9cf5) >>> 0) + movesSoFar(h) * 7919);
  const r = rnd();
  const pre = sim.current === "preflop";
  const out = h.opponents === "loose" ? (pre ? loosePreflop(h, mv, sim, seat, r) : loosePostflop(h, mv, sim, seat, r)) : pre ? preflop(h, mv, sim, seat, r) : postflop(h, mv, sim, seat, r);
  return out ?? mv;
}

type Pick2 = OppMove | null;

function preflop(h: PracticeHand, mv: OppMove, sim: Sim, seat: string, r: number): Pick2 {
  const cur = sim.cur!;
  const cls = classOf(h.hands[seat]!.join(""));
  const toCall = cur.curBet - (cur.bets[seat] ?? 0);
  const gto = kindOf(mv.action);
  const raiseTo = (fallback: number): OppMove => ({ action: "raise", to: sizesOf(mv, "raise")[0] ?? sizesOf(mv, "bet")[0] ?? fallback });
  const premium = PREMIUM.has(cls);
  const strong = STRONG.has(cls);
  if (cur.nRaises === 0) {
    const limpers = h.lines.preflop.filter((m) => m.action === "call").length;
    const open = raiseTo(cur.curBet * 3 + limpers);
    if (toCall <= 1e-9) return premium || strong ? (r < 0.6 ? open : { action: "check" }) : { action: "check" };
    if (premium) return open;
    if (strong) return r < 0.6 ? open : { action: "call" };
    if (gto === "raise" || gto === "bet" || gto === "all-in") return r < 0.35 ? open : { action: "call" };
    if (playable(cls)) return { action: "call" };
    return mv;
  }
  const stack = h.stack;
  if (cur.nRaises === 1) {
    if (cls === "AA" || cls === "KK") return raiseTo(cur.curBet * 3);
    if (premium) return r < 0.7 ? raiseTo(cur.curBet * 3) : { action: "call" };
    if (strong) return { action: "call" };
    if (playable(cls)) return toCall <= stack * 0.1 ? { action: "call" } : { action: "fold" };
    return gto === "call" ? mv : { action: "fold" };
  }
  if (cls === "AA" || cls === "KK") return sizesOf(mv, "raise").length ? raiseTo(cur.curBet * 2.5) : { action: "all-in" };
  if (["QQ", "JJ", "TT", "AKs", "AKo"].includes(cls)) return { action: "call" };
  const smallPair = cls[0] === cls[1];
  if (smallPair || ["AQs", "AJs", "KQs"].includes(cls)) return r < 0.6 && toCall <= stack * 0.15 ? { action: "call" } : { action: "fold" };
  return { action: "fold" };
}

function postflop(h: PracticeHand, mv: OppMove, sim: Sim, seat: string, r: number): Pick2 {
  const cur = sim.cur!;
  const board = h.board.slice(0, h.shown);
  if (board.length < 3) return null;
  const { tier, draw } = handTier(h.hands[seat]!, board);
  const toCall = cur.curBet - (cur.bets[seat] ?? 0);
  const before = sim.pot - toCall;
  if (toCall > 1e-9) {
    const big = toCall >= before - 1e-9;
    if (tier === 3) return r < 0.35 ? { action: "raise", to: sizesOf(mv, "raise")[0] ?? cur.curBet * 3 } : { action: "call" };
    if (tier === 2) return { action: "call" };
    if (tier === 1 || draw) return r < (big ? 0.6 : 0.85) ? { action: "call" } : { action: "fold" };
    return r < (board.length === 3 ? 0.2 : 0.1) ? { action: "call" } : { action: "fold" };
  }
  const bets = sizesOf(mv, "bet");
  const small = bets[0] ?? Math.round(sim.pot * 0.5 * 100) / 100;
  const large = bets.at(-1) ?? Math.round(sim.pot * 0.75 * 100) / 100;
  if (tier === 3) return r < 0.7 ? { action: "bet", to: large } : { action: "check" };
  if (tier === 2) return r < 0.55 ? { action: "bet", to: small } : { action: "check" };
  if (tier === 1 || draw) return r < 0.25 ? { action: "bet", to: small } : { action: "check" };
  return r < 0.1 ? { action: "bet", to: small } : { action: "check" };
}

function loosePreflop(h: PracticeHand, mv: OppMove, sim: Sim, seat: string, r: number): Pick2 {
  const cur = sim.cur!;
  const cls = classOf(h.hands[seat]!.join(""));
  const toCall = cur.curBet - (cur.bets[seat] ?? 0);
  const gto = kindOf(mv.action);
  const gtoIn = gto === "raise" || gto === "bet" || gto === "all-in";
  const raiseTo = (fallback: number): OppMove => ({ action: "raise", to: sizesOf(mv, "raise")[0] ?? sizesOf(mv, "bet")[0] ?? fallback });
  const premium = PREMIUM.has(cls);
  const strong = STRONG.has(cls);
  const stack = h.stack;
  const call: OppMove = { action: "call" };
  if (cur.nRaises === 0) {
    const limpers = h.lines.preflop.filter((m) => m.action === "call").length;
    const open = raiseTo(cur.curBet * 3 + limpers);
    // (the big blind's option, limped to: it raises its good hands, now and then a playable one)
    if (toCall <= 1e-9) return premium || strong ? (r < 0.7 ? open : { action: "check" }) : worthPlaying(cls) && r < 0.2 ? open : { action: "check" };
    if (premium) return open;
    if (strong || gtoIn) return r < 0.5 ? open : call;
    if (worthPlaying(cls)) return r < 0.15 ? open : call;
    if (looseCalls(cls)) return call;
    return r < 0.25 ? call : mv;
  }
  if (cur.nRaises === 1) {
    if (cls === "AA" || cls === "KK") return raiseTo(cur.curBet * 3);
    if (premium) return r < 0.6 ? raiseTo(cur.curBet * 3) : call;
    if (strong) return r < 0.2 ? raiseTo(cur.curBet * 3) : call;
    if (gtoIn) return r < 0.4 ? mv : call;
    if (worthPlaying(cls)) return toCall <= stack * 0.15 ? call : gto === "call" ? mv : { action: "fold" };
    if (looseCalls(cls)) return toCall <= stack * 0.06 ? call : gto === "call" ? mv : { action: "fold" };
    return gto === "call" ? mv : toCall <= stack * 0.04 && r < 0.3 ? call : { action: "fold" };
  }
  if (cls === "AA" || cls === "KK") return sizesOf(mv, "raise").length ? raiseTo(cur.curBet * 2.5) : { action: "all-in" };
  if (["QQ", "JJ", "TT", "AKs", "AKo", "AQs"].includes(cls)) return call;
  if (worthPlaying(cls)) return toCall <= stack * 0.25 && r < 0.6 ? call : gto === "call" ? mv : { action: "fold" };
  if (looseCalls(cls)) return toCall <= stack * 0.12 && r < 0.3 ? call : { action: "fold" };
  return gto === "call" ? mv : { action: "fold" };
}

function loosePostflop(h: PracticeHand, mv: OppMove, sim: Sim, seat: string, r: number): Pick2 {
  const cur = sim.cur!;
  const board = h.board.slice(0, h.shown);
  if (board.length < 3) return null;
  const { tier, draw } = handTier(h.hands[seat]!, board);
  const toCall = cur.curBet - (cur.bets[seat] ?? 0);
  const before = sim.pot - toCall;
  if (toCall > 1e-9) {
    const big = toCall >= before - 1e-9;
    const raise = (): OppMove => ({ action: "raise", to: sizesOf(mv, "raise")[0] ?? cur.curBet * 3 });
    if (tier === 3) return r < 0.4 ? raise() : { action: "call" };
    if (tier === 2) return r < 0.12 ? raise() : { action: "call" };
    if (tier === 1 || draw) return r < (big ? 0.85 : 0.97) ? { action: "call" } : { action: "fold" };
    // (a float with nothing: more on the flop, less by the river)
    return r < (board.length === 3 ? 0.4 : board.length === 4 ? 0.25 : 0.12) ? { action: "call" } : { action: "fold" };
  }
  const bets = sizesOf(mv, "bet");
  const small = bets[0] ?? Math.round(sim.pot * 0.5 * 100) / 100;
  const large = bets.at(-1) ?? Math.round(sim.pot * 0.75 * 100) / 100;
  if (tier === 3) return r < 0.75 ? { action: "bet", to: large } : { action: "check" };
  if (tier === 2) return r < 0.65 ? { action: "bet", to: small } : { action: "check" };
  if (tier === 1 || draw) return r < 0.4 ? { action: "bet", to: small } : { action: "check" };
  return r < 0.25 ? { action: "bet", to: small } : { action: "check" };
}
