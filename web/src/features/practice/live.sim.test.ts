// The live regulars and More action (live.ts) over a few thousand seeded hands each, played through Practice's own move
// path (flow.ts moveOf -> liveMove -> recordOf), with a stand-in for the solver's draw and a hero who calls, raises and
// jams. What a person would see as absurd never happens: a move the table refuses, a fold where checking is free, a river
// fold of the nuts, a straight or better folded as nothing; and the price counts: big bets and all-ins are seldom called
// with nothing. The tables keep their shape (how many hands they play).
import { describe, expect, it } from "vitest";
import { classOf } from "@/engine/nlhe/cards";
import { cmp, rank7 } from "@/poker/evaluate";
import { behind, DECK, legal, recordOf, seeded } from "@/poker/table";
import { moveOf } from "./flow";
import { handTier, liveMove, type OppMove } from "./live";
import { dealNext, newHand, phaseOf, setupOf, simOf, withVillain, type PracticeHand } from "./practice";

const HANDS = 2500;

// the solver's draw, roughly: the top of the deck opens and 3-bets, after the flop a mix of check, call and bets
const ORDER = "AA KK QQ AKs JJ AQs KQs AJs KJs TT AKo ATs QJs KTs QTs JTs 99 AQo A9s KQo 88 K9s T9s A8s Q9s J9s AJo A5s 77 A7s KJo A4s A3s A6s QJo 66 K8s T8s A2s 98s J8s ATo Q8s K7s KTo 55 JTo 87s QTo 44 33 22".split(" ");
function standIn(h: PracticeHand, seat: string, r: number): OppMove {
  const sim = simOf(h);
  const cur = sim.cur!;
  const toCall = cur.curBet - cur.bets[seat]!;
  if (sim.current === "preflop") {
    const i = ORDER.indexOf(classOf(h.hands[seat]!.join("")));
    const q = i < 0 ? 1 : i / 169;
    const raiseTo = cur.nRaises === 0 ? 2.5 : cur.curBet * 3;
    const actions = [{ action: "fold", freq: 0 }, { action: toCall > 0 ? "call" : "check", freq: 0 }, { action: `raise ${raiseTo}`, freq: 0, amount_bb: raiseTo }] as OppMove["actions"];
    if (cur.nRaises === 0) return q < 0.25 ? { action: "raise", to: raiseTo, actions } : { action: toCall > 0 ? "fold" : "check", actions };
    return q < 0.04 ? { action: "raise", to: raiseTo, actions } : q < 0.12 ? { action: "call", actions } : { action: toCall > 0 ? "fold" : "check", actions };
  }
  const pot = sim.pot;
  const actions = (
    toCall > 0
      ? [{ action: "fold", freq: 0.4 }, { action: "call", freq: 0.5 }, { action: "raise 3x", freq: 0.1, amount_bb: cur.curBet * 3 }]
      : [{ action: "check", freq: 0.6 }, { action: "bet 33%", freq: 0.25, amount_bb: Math.round(pot * 33) / 100 }, { action: "bet 75%", freq: 0.15, amount_bb: Math.round(pot * 75) / 100 }]
  ) as OppMove["actions"];
  if (toCall > 0) return r < 0.4 ? { action: "fold", actions } : r < 0.9 ? { action: "call", actions } : { action: "raise", to: cur.curBet * 3, actions };
  return r < 0.6 ? { action: "check", actions } : { action: "bet", to: Math.round(pot * 50) / 100, actions };
}

/** no two cards left beat this hand on this board */
function isNuts(hole: readonly string[], board: readonly string[]): boolean {
  const v = rank7([...hole, ...board]);
  const rest = DECK.filter((x) => !hole.includes(x) && !board.includes(x));
  for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) if (cmp(rank7([rest[i]!, rest[j]!, ...board]), v) > 0) return false;
  return true;
}

interface Tally {
  absurd: string[];
  vpip: number;
  seats: number;
  /** facing a pot-size bet or more with nothing (no pair, no draw, no straight): spots and calls */
  potBets: [number, number];
  /** facing a bet past a third of the pot that stakes the stack (all-in, or half or more of it), with nothing */
  stakes: [number, number];
}

function play(kind: "live" | "loose"): Tally {
  const rnd = seeded(kind === "live" ? 4242 : 4343);
  const t: Tally = { absurd: [], vpip: 0, seats: 0, potBets: [0, 0], stakes: [0, 0] };
  const absurd = (what: string) => t.absurd.length < 5 && t.absurd.push(what);
  for (let n = 0; n < HANDS; n++) {
    const players = 2 + (n % 8);
    const stack = [20, 40, 100, 100, 100, 200][n % 6]!;
    let h = newHand(players, stack, n, 1000 + n, { opponents: kind, seat: "moves" });
    const vol = new Set<string>();
    for (let step = 0; step < 300; step++) {
      const sim = simOf(h);
      const ph = phaseOf(h, sim);
      if (ph.kind === "over") break;
      if (ph.kind === "deal") {
        h = dealNext(h, ph.street);
        continue;
      }
      const seat = sim.toAct!;
      const cur = sim.cur!;
      const toCall = cur.curBet - cur.bets[seat]!;
      const rem = behind(setupOf(h), sim, seat);
      if (ph.kind === "hero") {
        const x = rnd();
        const lg = legal(setupOf(h), sim)!;
        const a = x < 0.08 ? { action: "all-in" } : x < 0.3 && lg.canRaise ? { action: "raise", to: Math.max(lg.minTo, sim.pot * (0.5 + rnd() * 1.5)), clamp: true } : { action: toCall > 0 ? "call" : "check" };
        const m = recordOf(setupOf(h), sim, a);
        if (typeof m === "string") throw new Error(m);
        h = withVillain(h, m, sim);
        continue;
      }
      const answer = standIn(h, seat, rnd());
      const rule = liveMove(h, answer, sim) !== answer;
      const { move, fallback } = moveOf(h, answer, sim);
      const tag = `${kind} hand ${n} (seed ${1000 + n}, ${players} players, ${stack}bb) ${sim.current} ${seat} ${h.hands[seat]} on ${h.board.slice(0, h.shown)} facing ${toCall} into ${sim.pot}: ${JSON.stringify(move)}`;
      if (fallback) absurd(`the table refused the move (${fallback}): ${tag}`);
      if (move.pos !== seat) absurd(`a move for another seat: ${tag}`);
      if (sim.current === "preflop" && move.action !== "fold" && move.action !== "check") vol.add(seat);
      if (rule && move.action === "fold" && toCall <= 1e-9) absurd(`a fold where checking is free: ${tag}`);
      const board = h.board.slice(0, h.shown);
      if (rule && board.length >= 3 && toCall > 1e-9) {
        const hole = h.hands[seat]!;
        const { tier, draw } = handTier(hole, board);
        const cat = rank7([...hole, ...board])[0]!;
        if (move.action === "fold" && board.length === 5 && isNuts(hole, board)) absurd(`a river fold of the nuts: ${tag}`);
        if (move.action === "fold" && cat >= 4 && tier === 0) absurd(`a straight or better folded as nothing: ${tag}`);
        if (tier === 0 && !draw && cat < 4) {
          const called = move.action === "call" || (move.action === "all-in" && rem <= toCall + 1e-9) ? 1 : 0;
          const frac = toCall / (sim.pot - toCall);
          if (frac >= 1 - 1e-9) {
            t.potBets[0]++;
            t.potBets[1] += called;
          }
          if (frac > 1 / 3 + 1e-9 && toCall >= rem * 0.5 - 1e-9) {
            t.stakes[0]++;
            t.stakes[1] += called;
          }
        }
      }
      h = withVillain(h, move, sim);
    }
    for (const p of Object.keys(h.hands)) if (p !== h.hero) t.seats++;
    for (const p of vol) if (p !== h.hero) t.vpip++;
  }
  return t;
}

describe("live opponents over many hands", () => {
  it.each([
    ["live", 0.15, 0.3, 0.03],
    ["loose", 0.5, 0.75, 0.06],
  ] as const)("%s: nothing absurd, the price counts, the table keeps its shape", (kind, vpipLo, vpipHi, potCalls) => {
    const t = play(kind);
    expect(t.absurd).toEqual([]);
    // (with nothing, a pot-size bet is called a ninth as often as a small one at most; the stack at stake, 2% at most)
    expect(t.potBets[0]).toBeGreaterThan(200);
    expect(t.potBets[1] / t.potBets[0]).toBeLessThan(potCalls);
    expect(t.stakes[0]).toBeGreaterThan(100);
    expect(t.stakes[1] / t.stakes[0]).toBeLessThan(0.03);
    expect(t.vpip / t.seats).toBeGreaterThan(vpipLo);
    expect(t.vpip / t.seats).toBeLessThan(vpipHi);
  });
});
