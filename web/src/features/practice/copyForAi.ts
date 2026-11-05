// Copy for AI: a decision as plain text for you to paste into a chatbot. Lizard sends nothing and holds no key: the text
// goes on your clipboard and no further. It says what answered, in the words of provenance.ts, and that what a chatbot
// makes of the numbers is its own reasoning and may be wrong.
import { bb, pct } from "@/components/actions";
import { describeSetup } from "@/features/solve/setup";
import { describeLine, fromSearch, streetOf, type StudyHand } from "@/features/study/studyState";
import { costWords, drillMix } from "@/features/review/mistakes";
import type { Grade } from "@/grading/grade";
import type { LibraryReport } from "@/library/files";
import { seatLabel, seatsOf } from "@/poker/seats";
import type { AdvisorResponse } from "@/solver/protocol";
import { describe as describeProvenance, evUnit } from "@/solver/provenance";
import type { Provenance, ResultSource } from "@/solver/types";
import { drillActionLabel, situation, studyHandOf, studyLink, type DrillProblem } from "./drills";
import { mixOf, optionLabel, type Decision } from "./practice";
import type { Reviewed } from "./review";

const fmt = (x: number) => String(Math.round(x * 100) / 100);
const cardsOf = (s: string) => s.match(/../g) ?? [];

/** What isn't a solve, said outright: the label alone could be read past. */
const NOT_SOLVED: Partial<Record<ResultSource, string>> = {
  charts: "The preflop charts are approximate tables. They are not a solved answer, and they have no EVs.",
  "push-fold": "The push/fold model is an equilibrium of a game with only all-in or fold, worked out by hand class, or a call priced against its range. It is not a solve of the full game, and it has no EVs.",
  "best-response": "This is the best response to an assumed opponent profile. It is not an equilibrium or a solved answer, and its EVs hold only if the opponent plays those assumed numbers, which are not population data.",
  rules: "These betting rules are a fallback. They are not a solved answer.",
  equity: "This equity estimate is a fallback. It is not a solved answer.",
};

export interface AiSpot {
  game: string;
  seats: string;
  stacks: string;
  /** your seat and cards */
  you: string;
  board: string;
  line: string;
  /** the street and pot */
  at: string;
  /** what you took and how it was graded, on a graded decision */
  took?: string;
  mix: Decision["mix"];
  labelOf: (a: Decision["mix"][number]) => string;
  provenance: Provenance | null;
}

/** The game's rows from a Study line: the setup's own stacks go on the Stacks row, as every seat's. */
function gameRows(h: StudyHand): Pick<AiSpot, "game" | "seats" | "stacks" | "board" | "line"> {
  const own = h.setup?.stacks;
  const seats = seatsOf(h.players);
  return {
    game: [`No-limit hold'em, ${h.players === 2 ? "heads-up" : `${h.players}-max`}`, `blinds 0.5 and 1, starting stack ${fmt(h.stack)}bb`, ...describeSetup(h.setup ? { ...h.setup, stacks: undefined } : undefined)].join(", "),
    seats: seats.map((p) => seatLabel(p, h.players)).join(", "),
    stacks: own ? seats.map((p) => `${seatLabel(p, h.players)} ${fmt(own[p] ?? h.stack)}bb`).join(", ") : `${fmt(h.stack)}bb each`,
    board: h.board ? cardsOf(h.board).join(" ") : "none yet (preflop)",
    line: describeLine(h).join(", ") || "no action yet",
  };
}

/** The text. Every number in it is the table's or the source's, and the last lines say which. */
export function aiText(s: AiSpot): string {
  const source = s.provenance?.source;
  const hasEv = s.mix.some((a) => a.ev !== null);
  return [
    "A poker decision from Lizard, a study app.",
    `Game: ${s.game}`,
    `Seats, first to act preflop first: ${s.seats}`,
    `Stacks as the hand started: ${s.stacks}`,
    `You: ${s.you}`,
    `Board: ${s.board}`,
    `Line so far, preflop folds left out: ${s.line}`,
    `Decision: ${s.at}`,
    ...(s.took ? [s.took] : []),
    "The answer's mix for this hand:",
    ...s.mix.map((a) => `- ${s.labelOf(a)}: ${pct(a.freq)}${a.ev !== null ? `, EV ${bb(a.ev)}${evUnit(s.provenance)}` : ""}`),
    ...(hasEv ? [] : ["This answer has no EVs for this hand."]),
    `Source of these numbers: ${s.provenance ? describeProvenance(s.provenance) : "not kept"}.`,
    ...(source && NOT_SOLVED[source] ? [NOT_SOLVED[source]] : []),
    "These numbers come from that source. A chatbot might reason about them wrongly, so check what it says against them.",
  ].join("\n");
}

/** One of your graded decisions in a full hand. */
export function reviewedText(e: Reviewed): string {
  const h = fromSearch(e.d.study);
  const g = e.d.grade;
  const rows = h
    ? gameRows(h)
    : { game: `No-limit hold'em, ${e.players} players`, seats: seatsOf(e.players).map((p) => seatLabel(p, e.players)).join(", "), stacks: "not kept", board: e.board.join(" ") || "none yet (preflop)", line: e.line };
  return aiText({
    ...rows,
    you: `${seatLabel(e.seat, e.players)}, holding ${e.hole.join(" ")}`,
    at: `${e.d.street}, pot ${fmt(e.d.pot)}bb`,
    ...(g ? { took: `You took: ${e.d.chose}. Lizard's grade: ${g.verdict}, ${costWords(g, e.d.mix, e.d.provenance?.source, evUnit(e.d.provenance))}.` } : {}),
    mix: e.d.mix,
    labelOf: (a) => optionLabel(a.action, a.amount),
    provenance: e.d.provenance,
  });
}

/** A graded drill. Its hand and board are as shown, one suit relabelling of the stored flop's. */
export function drillText(rep: LibraryReport, pr: DrillProblem, g: Grade, provenance: Provenance): string {
  const link = studyLink(rep, pr);
  const mix = drillMix(pr);
  return aiText({
    ...gameRows((link && fromSearch(link.replace(/^\/study\?/, ""))) || studyHandOf(rep, pr)),
    you: `${pr.hero}, holding ${pr.hand.join(" ")}`,
    at: `${pr.turn ? "turn" : "flop"}, ${situation(rep, pr)}`,
    took: `You took: ${drillActionLabel(pr, pr.names[g.a]!)}. Lizard's grade: ${g.verdict}, ${costWords(g, mix, provenance.source)}.`,
    mix,
    labelOf: (a) => drillActionLabel(pr, a.action),
    provenance,
  });
}

/** A node in Study: the hand class picked in the grid, or with none picked the whole range's mix. No decision was taken. */
export function studyText(h: StudyHand, res: AdvisorResponse, provenance: Provenance, cls: string | null): string {
  const cell = cls ? res.grid?.cells[cls] : undefined;
  const mix = cell
    ? res.grid!.actions.map((action, i) => {
        const amount = (res.actions ?? []).find((a) => a.action === action)?.amount_bb;
        return { action, freq: cell.f[i] ?? 0, ev: cell.ev?.[i] ?? null, ...(typeof amount === "number" ? { amount } : {}) };
      })
    : mixOf(res);
  return aiText({
    ...gameRows(h),
    you: `${res.actor ?? "the player to act"}, ${cell ? `holding the hand class ${cls}` : "no hand picked, so this is the whole range's mix"}`,
    at: `${res.street ?? streetOf(h)}${typeof res.pot_bb === "number" ? `, pot ${fmt(res.pot_bb)}bb` : ""}`,
    mix,
    labelOf: (a) => optionLabel(a.action, a.amount),
    provenance,
  });
}

/** The text onto the clipboard. Rejects, in words, where it can't: a page not served over https has no clipboard to reach,
 * and a browser can refuse it. */
export async function toClipboard(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error("this browser gives the page no clipboard here (it needs https or localhost)");
  await navigator.clipboard.writeText(text);
}

/** Why it failed, in words. */
export function clipboardWhy(e: unknown): string {
  if (e instanceof DOMException && e.name === "NotAllowedError") return "the browser refused it (the page may need to be in front, or to be allowed the clipboard)";
  return e instanceof Error ? e.message : String(e);
}
