// A parsed hand replayed through Lizard's table engine (poker/table.ts), ported from the classic importer's
// importHand (solver/gto/static/hh.js): every seat with its own stack, the actions one by one as if entered at the
// table, so a short all-in, its side pot and a bet nobody could call in full play out as at the table. Where the
// two disagree the hand stops there, with a warning.
import { noLines, simulate, withMove, type Lines, type Move, type Sim, type TableSetup } from "@/poker/table";
import { parseHandHistory, type HhStreet, type ParsedHand } from "./parse";

export interface ReplayedHand {
  hand: ParsedHand;
  /** the table as played: each seat's stack (an all-in's set to what the history shows it put in), ante, straddle */
  setup: TableSetup;
  lines: Lines;
  /** where the history and the table part ways, if they do */
  stopped: { street: HhStreet; pos: string } | null;
  warnings: string[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const EPS = 1e-9;

export function replay(h: ParsedHand): ReplayedHand {
  const warnings = [...h.warnings];
  const stacks = { ...h.stacks };
  const setup: TableSetup = { players: h.players, stacks, ante: h.ante, ...(h.straddle ? { straddle: true } : {}), ...(h.game === "plo4" ? { limit: "pot" as const } : {}) };
  let lines = noLines();
  let stopped: ReplayedHand["stopped"] = null;
  for (const a of h.actions) {
    const sim = simulate(setup, lines, h.board.length);
    if (!sim.cur || sim.current !== a.street || sim.toAct !== a.pos) {
      warnings.push(`The table and the history part ways at ${a.pos}'s ${a.street} action: the hand stops there.`);
      stopped = { street: a.street, pos: a.pos };
      break;
    }
    const info = sim.cur;
    const toCall = info.curBet - info.bets[a.pos]!;
    // an all-in is the stack: one the table has a little off the site's (rounding, a blind it leaves out) is set to it
    if (a.allIn && a.to !== undefined && a.to > 0) stacks[a.pos] = r2(sim.invested[a.pos]! + a.to);
    const cap = stacks[a.pos]! - sim.invested[a.pos]!;
    const passive: Move = { pos: a.pos, action: toCall > EPS ? "call" : "check" };
    const to = a.to ?? 0;
    const m: Move =
      a.act === "fold" ? { pos: a.pos, action: "fold" }
      : a.act === "check" || a.act === "call" ? passive
      : to >= cap - 0.005 ? { pos: a.pos, action: "all-in" }
      : to <= info.curBet + EPS ? passive
      : { pos: a.pos, action: info.curBet > 0 ? "raise" : "bet", to };
    lines = withMove(lines, a.street, m);
  }
  return { hand: h, setup, lines, stopped, warnings };
}

/** One hand history replayed (parseHandHistory's errors pass through). */
export function importHand(text: string): ReplayedHand {
  return replay(parseHandHistory(text));
}

/** The hand's state at its end, every card the history shows out. */
export const finalSim = (r: ReplayedHand): Sim => simulate(r.setup, r.lines, r.hand.board.length);
