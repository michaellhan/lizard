// A preflop drill's spot: a decision on a library spot's preflop line (every seat's, the folds before the pot's raise
// too), asked of the stored preflop solve (solver/gto/pf_study.py through the worker, `study` and `preflop_solve`), and a
// hand dealt from the range that reaches it. The solve is an equilibrium of a simplified class-level game, never a full
// solve: every answer carries pfGrade.ts's PF_MODEL label, and a grade under it allows the model's measured EV noise
// (grade.ts pfNoisePct) as Practice's does, through the same entry point (gradeAnswer). Only the
// games the worker stores are asked (pfStored.ts); a node the solve's tree doesn't hold at the line's own sizes is refused
// by pfNodeRead and not dealt again.
import { kindOf } from "@/components/actions";
import { parseLine } from "@/features/study/studyState";
import type { LibrarySpotIndex } from "@/library/catalog";
import type { LibraryReport } from "@/library/files";
import type { AdvisorAction, AdvisorResponse, AdvisorState } from "@/solver/protocol";
import { pfPlainStored } from "@/solver/pfStored";
import { pick, preflopWords, type Story } from "./drills";
import { optionLabel, type Decision } from "./practice";

/** Whether the worker stores the preflop solve of the spot's game: its table size and depth, no ante, no straddle (the
 * grid at 2 to 6 players, the full-ring games built at 7 to 9). */
export function pfDrillable(spot: Pick<LibrarySpotIndex, "game">): boolean {
  const g = spot.game ?? { players: 6, stack: 100, ante: 0, straddle: false };
  return pfPlainStored(g.players, g.stack) && !g.ante && !g.straddle;
}

export interface PfSpotAt {
  /** the action's place on the line: the decision is the k-th action's, with the k before it played */
  k: number;
  hero: string;
  before: AdvisorAction[];
  /** the line before it as the report writes it, "UTG:f,HJ:f" */
  line: string;
}

/** Every decision on the line: each action's seat, before it acts. */
export function pfDecisions(line: string): PfSpotAt[] {
  const acts = parseLine(line);
  const raw = line.split(",").filter(Boolean);
  return acts.map((a, k) => ({ k, hero: a.pos, before: acts.slice(0, k), line: raw.slice(0, k).join(",") }));
}

/** The request of the stored solve's node: whoever acts there, with their whole range (the engine drops a seat's cards). */
export function pfDrillState(rep: Pick<LibraryReport, "game">, at: Pick<PfSpotAt, "hero" | "before">): AdvisorState {
  return { players: rep.game?.players ?? 6, hero: at.hero, board: "", stack: rep.game?.stack ?? 100, preflop: at.before, flop: [], turn: [], river: [], study: true, preflop_solve: true };
}

const RANKS = "AKQJT98765432";
const SUITS = "shdc";

/** A class's combos: 6 of a pair, 4 suited, 12 offsuit. */
export function classCombos(cls: string): [string, string][] {
  const [a, b] = [cls[0]!, cls[1]!];
  const out: [string, string][] = [];
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      if (a === b ? j <= i : cls[2] === "s" ? i !== j : i === j) continue;
      out.push([a + SUITS[i]!, b + SUITS[j]!]);
    }
  return out;
}

/** a class the solve always folds here is dealt this often as its combos say, so a drill isn't mostly folds */
export const SURE_FOLD_SHARE = 0.2;

/** A hand from the range at the node: a class drawn by its combos in the range (fewer of the ones it always folds), then
 * one of its combos. Null where the node holds no class with EVs. */
export function pfDeal(node: Pick<AdvisorResponse, "grid" | "actions">, rng: () => number): { cls: string; hole: [string, string] } | null {
  const cells = node.grid?.cells ?? {};
  const fold = (node.actions ?? []).findIndex((a) => kindOf(a.action) === "fold");
  const classes = Object.keys(cells).filter((c) => RANKS.includes(c[0]!) && RANKS.includes(c[1]!));
  const ws = classes.map((c) => {
    const cell = cells[c]!;
    if (!(cell.w > 0) || !cell.ev || cell.ev.some((x) => typeof x !== "number")) return 0;
    const sure = fold >= 0 && (cell.f[fold] ?? 0) >= 0.995;
    return cell.w * classCombos(c).length * (sure ? SURE_FOLD_SHARE : 1);
  });
  const i = pick(ws, rng);
  if (i < 0) return null;
  const cls = classes[i]!;
  const combos = classCombos(cls);
  return { cls, hole: combos[Math.floor(rng() * combos.length)]! };
}

/** An action in words: a raise by what it's to, a call by what it costs. */
export function pfActionLabel(toCall: number, row: Pick<Decision["mix"][number], "action" | "amount">): string {
  const k = kindOf(row.action);
  const n = (x: number) => String(Math.round(x * 100) / 100);
  if (k === "call") return `call ${n(toCall)}bb`;
  if (k === "raise" && typeof row.amount === "number") return `raise to ${n(row.amount)}bb`;
  return optionLabel(row.action, row.amount);
}

/** The hand so far: preflop only, the line before you and what you face (drills.ts `story`); a price to call only where
 * calling is one of the options (an open's isn't: the solve opens or folds). */
export function pfStory(at: Pick<PfSpotAt, "hero" | "line" | "k">, node: Pick<AdvisorResponse, "pot_bb" | "to_call_bb" | "actions"> & { stack_bb?: unknown }): Story {
  const words = preflopWords(at.line) || (at.k > 0 ? `Folds to ${at.hero}` : "");
  const calls = (node.actions ?? []).some((a) => kindOf(a.action) === "call");
  return {
    steps: [],
    now: { street: "Preflop", pot: node.pot_bb ?? 1.5, line: words, hero: at.hero, toCall: calls ? (node.to_call_bb ?? 0) : 0, behind: typeof node.stack_bb === "number" ? node.stack_bb : null },
  };
}
