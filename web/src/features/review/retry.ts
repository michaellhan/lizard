// A kept mistake asked again: a full hand's spot of the solver, by the request Practice sent, and a drill's of the
// library, read in the page as the drill was. What comes back is the current answer, with its own provenance.
import { LIBRARY_SOURCES } from "@/config";
import type { MistakeAsk, MistakeRecord } from "@/data/db";
import { spotStamp } from "@/library/version";
import { drillProvenance, potAt } from "@/features/practice/drills";
import { isBestResponse, mixOf, optionsOf } from "@/features/practice/practice";
import { resolveLibrarySource } from "@/library/catalog";
import { cardInt, COMBOS, nodeAt, type Entry } from "@/library/entry";
import { LibraryFiles, type LibraryReport } from "@/library/files";
import type { TurnFile } from "@/library/turns";
import type { SolverClient } from "@/solver/client";
import type { SolveMode } from "@/solver/types";
import { useSettings } from "@/state/settings";
import { betAmount, type RetryAnswer } from "./mistakes";

/** As Practice's tables play it: a Fast setting plays Quick's budgets (room.ts). */
export const retryMode = (): SolveMode => (useSettings.getState().mode === "accurate" ? "accurate" : "quick");

export type GetClient = () => Promise<Pick<SolverClient, "solve">>;

/** The spot's answer of the solver, for the request Practice sent. `pot`: the pot kept, where the answer gives none. */
export async function askSolver(ask: Extract<MistakeAsk, { via: "solver" }>, pot: number, getClient: GetClient, mode: SolveMode, signal?: AbortSignal): Promise<RetryAnswer> {
  const client = await getClient();
  const { data, provenance } = await client.solve({ state: ask.state, mode, signal });
  if (!optionsOf(data).length) throw new Error(data.error ?? "the answer has no actions at this spot");
  const mix = mixOf(data);
  // (exploit practice: an answer without the read is an equilibrium's, which this spot was never graded against)
  if (ask.state.locks && !isBestResponse(mix, provenance)) throw new Error("the engine gave no best response to the assumed profile here");
  return { mix, pot: typeof data.pot_bb === "number" ? data.pot_bb : pot, provenance };
}

/** Your combo's stored answer in an entry; null where the entry holds no node or no hand there. */
export function storedAnswer(rep: Pick<LibraryReport, "pot">, e: Entry, ask: Pick<Extract<MistakeAsk, { via: "library" }>, "path" | "combo">, mode: SolveMode, libraryVersion?: string): Omit<RetryAnswer, "version"> | null {
  const nd = nodeAt(e, ask.path);
  if (!nd) return null;
  const j = (e.combos[nd.player] ?? []).findIndex((k) => {
    const c = COMBOS[k];
    return c?.[0] === ask.combo[0] && c?.[1] === ask.combo[1];
  });
  if (j < 0) return null;
  const { pot } = potAt(rep, ask.path);
  const mix = nd.names.map((action, i) => {
    const amount = betAmount(action, pot);
    return { action, freq: nd.strat[i]?.[j] ?? 0, ev: nd.evs[i]?.[j] ?? null, ...(amount !== undefined ? { amount } : {}) };
  });
  return { mix, pot, provenance: drillProvenance(e, mode, undefined, libraryVersion) };
}

/** Your hand's stored mix on a stored turn: `null` where the turn file no longer has it. No file holds a hand's EV at a
 * turn, so it's graded by frequency, as the drill was. */
export function storedTurnAnswer(e: Entry, t: TurnFile, ask: Pick<Extract<MistakeAsk, { via: "library" }>, "path" | "combo" | "turn">, mode: SolveMode, libraryVersion?: string): Omit<RetryAnswer, "version"> | null {
  const turn = ask.turn;
  if (!turn) return null;
  const line = t.lines.find((l) => l.path.join("|") === ask.path.join("|"));
  const node = line?.nodes.find((n) => n.at.join("|") === turn.at.join("|"));
  const cls = node?.classes[t.played.indexOf(cardInt(turn.card))];
  if (!line || !node || !cls) return null;
  const j = cls.combos.findIndex((k) => COMBOS[k]?.[0] === ask.combo[0] && COMBOS[k]?.[1] === ask.combo[1]);
  if (j < 0) return null;
  const mix = node.names.map((action, i) => {
    const amount = betAmount(action, line.pot);
    return { action, freq: cls.strat[i]?.[j] ?? 0, ev: null, ...(amount !== undefined ? { amount } : {}) };
  });
  return { mix, pot: line.pot, provenance: drillProvenance(e, mode, { names: node.names, turn: { card: turn.card, at: turn.at, rangeEvs: null } }, libraryVersion) };
}

/** The library the Settings pick, as the drills read it. */
async function libraryFiles(): Promise<LibraryFiles> {
  const choice = useSettings.getState().librarySource;
  const id = choice === "auto" ? await resolveLibrarySource() : choice;
  return new LibraryFiles((LIBRARY_SOURCES.find((s) => s.id === id) ?? LIBRARY_SOURCES[0]).base);
}

/** The spot's answer as the library stores it now. Throws, in words, where it no longer does. */
export async function askLibrary(ask: Extract<MistakeAsk, { via: "library" }>, mode: SolveMode, files?: LibraryFiles): Promise<RetryAnswer> {
  const f = files ?? (await libraryFiles());
  const index = await f.index();
  const spot = index.spots.find((s) => s.id === ask.spot);
  if (!spot || !(ask.flop in (spot.flops ?? {}))) throw new Error(`this library doesn't hold ${ask.spot} on ${ask.flop} any more`);
  const [{ report }, entry] = await Promise.all([f.spot(spot), f.entry(spot, ask.flop)]);
  const turns = ask.turn
    ? await f.turns(spot, ask.flop).catch(() => {
        throw new Error(`this library doesn't hold ${ask.flop}'s turns in ${ask.spot} any more`);
      })
    : null;
  const stamp = spotStamp(spot, index.tree, ask.flop);
  const a = turns ? storedTurnAnswer(entry, turns, ask, mode, stamp) : storedAnswer(report, entry, ask, mode, stamp);
  if (!a) throw new Error(`the library no longer stores your hand at this node of ${ask.spot}`);
  const version = spot.flops[ask.flop];
  return { ...a, ...(version !== undefined ? { version } : {}) };
}

/** The current answer at a kept mistake's spot. */
export const askAgain = (m: Pick<MistakeRecord, "ask" | "pot">, getClient: GetClient, signal?: AbortSignal): Promise<RetryAnswer> =>
  m.ask.via === "solver" ? askSolver(m.ask, m.pot, getClient, retryMode(), signal) : askLibrary(m.ask, retryMode());
