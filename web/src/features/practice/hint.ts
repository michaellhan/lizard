// A Hint: what the spot is and what a call costs, from what's on the table. Neither function is given the answer, so a
// hint can't give the mix away: a hand's comes from the hand and its chips, a drill's from the node's pot and bet.
import { pct } from "@/components/actions";
import { seatLabel, seatsOf } from "@/poker/seats";
import { behind, legal, type Sim } from "@/poker/table";
import type { DrillProblem } from "./drills";
import type { LiveProblem } from "./liveDeal";
import { setupOf, type PracticeHand } from "./practice";

/** said beside a hint, as these numbers aren't the answer's */
export const HINT_SOURCE = "From the chips on the table, not the answer.";
export const DRILL_HINT_SOURCE = "From the pot and bet, not the answer.";

export const LIVE_HINT_SOURCE = "From the pot and bet, not the answer.";

const fmt = (x: number) => String(Math.round(x * 100) / 100);
const POTS = ["limped", "single-raised", "3-bet", "4-bet"];
const FACING = ["", "a raise", "a 3-bet", "a 4-bet"];

/** What a call costs against what it can win, as the share of the final pot it pays. */
const price = (call: number, win: number, rake: boolean) =>
  `A call is ${fmt(call)}bb to win ${fmt(win)}bb: pot odds of ${pct(call / (win + call))}, the equity it needs if no more chips go in${rake ? ", before the rake" : ""}.`;

/** The spot in words, at your turn in a hand. */
function spotWords(h: Pick<PracticeHand, "hero" | "players" | "straddle">, sim: Sim, toCall: number): string {
  const raises = sim.streets.preflop?.nRaises ?? 0;
  const seat = seatLabel(h.hero, h.players);
  if (sim.current === "preflop") {
    const forced = new Set(["SB", "BB", ...(h.straddle && h.players >= 3 ? [seatsOf(h.players)[0]!] : [])]);
    const limped = Object.entries(sim.cur?.bets ?? {}).some(([p, b]) => !forced.has(p) && b > 0);
    const facing = raises ? `facing ${FACING[raises] ?? `a ${raises + 1}-bet`}` : limped ? "behind a limp" : toCall > 1e-9 ? "no one has come in yet" : "with the option to raise";
    return `Preflop in ${seat}, ${facing}.`;
  }
  const others = [...sim.active].filter((p) => p !== h.hero);
  const street = sim.current!.charAt(0).toUpperCase() + sim.current!.slice(1);
  const pot = POTS[raises] ?? `${raises + 1}-bet`;
  if (others.length !== 1) return `${street} of a ${pot} pot in ${seat}, against ${others.length} players.`;
  const order = (sim.cur?.order ?? []).filter((p) => sim.active.has(p));
  return `${street} of a ${pot} pot, heads-up against ${seatLabel(others[0]!, h.players)}, ${order.at(-1) === h.hero ? "in position" : "out of position"}.`;
}

/** Your turn in a hand: the spot, then the price of a call, or the pot and your chips with nothing to call. What you can
 * win stops at what you can match: a short call doesn't reach the part of a bet it can't cover. */
export function handHint(h: Pick<PracticeHand, "hero" | "players" | "stack" | "ante" | "straddle" | "stacks" | "rake">, sim: Sim): string {
  const t = setupOf(h);
  const toCall = legal(t, sim)?.toCall ?? 0;
  const spot = spotWords(h, sim, toCall);
  if (toCall <= 1e-9) return `${spot} Nothing to call: the pot is ${fmt(sim.pot)}bb and you have ${fmt(behind(t, sim, h.hero))}bb behind.`;
  const inAt = (p: string) => (sim.invested[p] ?? 0) + (sim.cur?.bets[p] ?? 0);
  const mine = inAt(h.hero);
  const win = seatsOf(h.players).reduce((x, p) => x + (p === h.hero ? mine : Math.min(inAt(p), mine + toCall)), 0);
  return `${spot} ${price(toCall, win, !!h.rake)}`;
}

/** A drill's spot: where you sit in the stored heads-up pot, and the price of the bet you face, if you face one. */
export function drillHint(pr: Pick<DrillProblem, "player" | "hero" | "pot" | "bet" | "turn">): string {
  return headsUp(pr.turn ? "Turn" : "Flop", pr);
}

/** A live drill's spot, the same way. */
export const liveHint = (pr: Pick<LiveProblem, "street" | "player" | "hero" | "pot" | "bet">): string => headsUp(pr.street === "river" ? "River" : "Turn", pr);

function headsUp(street: string, pr: Pick<DrillProblem, "player" | "hero" | "pot" | "bet">): string {
  const spot = `${street}, heads-up, ${pr.hero} ${pr.player === 1 ? "in position" : "out of position"}.`;
  return pr.bet > 0 ? `${spot} ${price(pr.bet, pr.pot, false)}` : `${spot} Nothing to call: the pot is ${fmt(pr.pot)}bb.`;
}
