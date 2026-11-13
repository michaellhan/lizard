// A PLO hand you played, as the spots the PLO page can solve: each street after the flop that two players saw with chips
// behind, its board, pot and stacks as the hand had them. Read by the hand-history parser in its Omaha mode (hh/parse.ts)
// and replayed on the table engine at pot limit (hh/replay.ts), so the pot is the table's count of what went in. A history
// shows one hand, not a range: the ranges stay the reader's to type, and the page says so.
import { HandHistoryError, parseHandHistory } from "@/hh/parse";
import { replay } from "@/hh/replay";
import { NEED, simulate, type Lines, type Street } from "@/poker/table";

export interface HistorySpot {
  street: "flop" | "turn" | "river";
  /** the board to this street, as the page types it */
  board: string;
  /** the pot as the street starts, bb */
  pot: number;
  /** what each has behind as the street starts, bb: OOP, then IP */
  stacks: [number, number];
  /** the two seats' positions: OOP, then IP */
  seats: [string, string];
  /** which of the two you were, or null when you'd folded */
  hero: 0 | 1 | null;
}

export interface HistoryRead {
  /** your position and hand */
  heroPos: string;
  hole: string;
  spots: HistorySpot[];
  /** why a street seen isn't offered: more than two players, or an all-in */
  skipped: string[];
  warnings: string[];
  /** every street's actions as played, by position */
  lines: Lines;
  /** the streets you acted on */
  acted: Street[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const POSTFLOP = ["flop", "turn", "river"] as const;

/** The hand's lines before street `s`: every earlier street's as played, none from `s` on. */
function before(lines: Lines, s: Street): Lines {
  const at = (x: Street) => (NEED[x] < NEED[s] ? lines[x] : []);
  return { preflop: at("preflop"), flop: at("flop"), turn: at("turn"), river: at("river") };
}

/** A pasted PLO hand history as its solvable spots, or what's wrong with it in words. */
export function spotsFromHistory(text: string): HistoryRead | string {
  let r;
  try {
    r = replay(parseHandHistory(text, { omaha: true }));
  } catch (e) {
    if (e instanceof HandHistoryError) return e.message;
    throw e;
  }
  const { hand, setup, lines, stopped } = r;
  const spots: HistorySpot[] = [];
  const skipped: string[] = [];
  for (const street of POSTFLOP) {
    if (hand.board.length < NEED[street]) break;
    if (stopped && NEED[stopped.street] < NEED[street]) break;
    const sim = simulate(setup, before(lines, street), NEED[street]);
    if (sim.runout && sim.active.size > 1) {
      skipped.push(`The ${street} came with a player all-in: nothing is left to decide.`);
      break;
    }
    if (sim.handOver || sim.current !== street || !sim.toAct) break;
    const active = [...sim.active];
    if (active.length !== 2) {
      skipped.push(`${active.length} players saw the ${street}: the PLO solver plays heads-up.`);
      continue;
    }
    const oop = sim.toAct;
    const ip = active.find((p) => p !== oop)!;
    const behind = (p: string) => r2((setup.stacks[p] ?? 0) - (sim.invested[p] ?? 0));
    spots.push({
      street,
      board: hand.board.slice(0, NEED[street]).join(""),
      pot: r2(sim.pot),
      stacks: [behind(oop), behind(ip)],
      seats: [oop, ip],
      hero: hand.hero === oop ? 0 : hand.hero === ip ? 1 : null,
    });
  }
  const acted = (["preflop", ...POSTFLOP] as Street[]).filter((st) => lines[st].some((m) => m.pos === hand.hero));
  return { heroPos: hand.hero, hole: hand.hole.join(""), spots, skipped, warnings: r.warnings, lines, acted };
}
