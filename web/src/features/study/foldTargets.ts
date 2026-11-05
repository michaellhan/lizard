// The "fold to" selector: pick who acts next, and everyone up to that seat folds, each fold played as a click plays it
// (studyState.play), so the line, Back and the URL hold them one by one. Who acts next and whether a seat may fold come
// from the table engine (poker/table.ts, the port of the Advisor's replay_hand) and ask the solver nothing.
import { kindOf } from "@/components/actions";
import { seatsOf } from "@/poker/seats";
import { legal, noLines, simulate, type Legal, type MoveKind, type TableSetup } from "@/poker/table";
import type { AdvisorResponse } from "@/solver/protocol";
import { play, streetOf, type StudyHand } from "./studyState";

/** A seat the folds reach: who folds to get there, the current actor first, and the node with those folds played. */
export interface FoldTarget {
  seat: string;
  folds: string[];
  hand: StudyHand;
}

/** The hand's table as the Advisor's replay sees it: a seat's own stack or the table's, the ante, the straddle. */
function tableOf(h: StudyHand): TableSetup {
  const { stacks, ante, straddle } = h.setup ?? {};
  return {
    players: h.players,
    stacks: Object.fromEntries(seatsOf(h.players).map((p) => [p, stacks?.[p] ?? h.stack])),
    ...(ante ? { ante } : {}),
    ...(straddle ? { straddle } : {}),
  };
}

/** Who acts next preflop and what they may do; null once the betting has closed or the hand is over. */
function next(h: StudyHand): Legal | null {
  const t = tableOf(h);
  const preflop = h.preflop.map((a) => {
    const to = a.to ?? a.amount;
    return { pos: a.pos, action: kindOf(a.action) as MoveKind, ...(to !== undefined ? { to } : {}) };
  });
  return legal(t, simulate(t, { ...noLines(), preflop }, 0));
}

/** The seats the hand can fold round to from here, nearest first. Preflop only (after the flop a fold is an answer to a
 * bet, not a way round the table). A run stops at a seat with nothing to call, who can check and not fold, and at the
 * fold that would end the hand or close the betting, since no seat acts after it.
 * `res`: the answer at this node, where there is one, must agree: it names this actor and offers it the fold. None yet:
 * the table alone says. */
export function foldTargets(h: StudyHand, res?: AdvisorResponse): FoldTarget[] {
  if (streetOf(h) !== "preflop") return [];
  let now = next(h);
  if (res && !(res.study === "node" && res.street === "preflop" && res.actor === now?.toAct && res.actions?.some((a) => kindOf(a.action) === "fold"))) return [];
  const out: FoldTarget[] = [];
  const folds: string[] = [];
  let at = h;
  while (now && now.toCall > 0) {
    at = play(at, { study: "node", street: "preflop", actor: now.toAct }, { action: "fold" });
    folds.push(now.toAct);
    now = next(at);
    if (now) out.push({ seat: now.toAct, folds: [...folds], hand: at });
  }
  return out;
}

/** The target in words: "UTG, HJ fold, CO to act". */
export const describeTarget = (t: Pick<FoldTarget, "seat" | "folds">): string => `${t.folds.join(", ")} fold${t.folds.length > 1 ? "" : "s"}, ${t.seat} to act`;
