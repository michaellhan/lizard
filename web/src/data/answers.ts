// The one answer kept with a saved spot (db.ts SavedAnswer), so reopening the spot shows what was seen at once, marked as
// saved and from which version. What's stored can be old or hand-edited, and a backup can carry anything, so every read
// goes through `readAnswer`: a whole answer this page can draw, or null. Nothing a record says about itself is taken for
// what produced it. The provenance is worked out from the answer, as a fresh one's is, and has to fit the line it answers,
// so neither a provenance edited by hand nor an answer dressed up as a solve can call a preflop chart solved. A forged
// answer on a line a solve can answer can't be told from a real one: anything that came in from a file says so.
import { fromSearch, streetOf, type StudyHand } from "@/features/study/studyState";
import { versionWords } from "@/grading/version";
import { describe, provenanceOf } from "@/solver/provenance";
import type { AdvisorResponse } from "@/solver/protocol";
import type { Provenance, ResultSource, SolveMode, SolveResult } from "@/solver/types";
import { db, type SavedAnswer, type SavedSpot } from "./db";
import { isSource } from "./mistakes";
import { isHole, isTime, isWellFormed } from "./shapes";

// The largest answer kept. Real Study answers measured (the engine's JSON, 2026-11-05): 5-6 KB on a preflop chart, 39-65 KB
// on flops, turns and rivers at the standard sizes, 3-way included, and 108 KB on a river of two full ranges facing a bet,
// at the three sizes the page allows. The combos are nearly all of it, at 264 bytes each there: that river's 387 grown to
// the 1,081 combos of a full river's range is about 300 KB, which this leaves room for.
export const MAX_ANSWER_BYTES = 512 * 1024;
export const kb = (n: number) => `${Math.ceil(n / 1024)} KB`;
const byteLength = (s: string) => new TextEncoder().encode(s).length;

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isStrs = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
const isOptStr = (x: unknown) => x === undefined || isStr(x);
const isOptNum = (x: unknown) => x === undefined || isNum(x);
/** kept as null where it's unknown (JSON writes NaN as null) */
const isNumOrNull = (x: unknown) => x === undefined || x === null || isNum(x);
const isNumsOrNull = (x: unknown) => x === undefined || x === null || (Array.isArray(x) && x.every((v) => v === null || isNum(v)));
const isOptObj = (x: unknown) => x === undefined || x === null || isObj(x);

const isCell = (c: unknown, actions: number) =>
  isObj(c) && isNum(c.w) && Array.isArray(c.f) && c.f.length === actions && c.f.every(isNum) && isNumsOrNull(c.ev) && [c.evm, c.eq, c.eqr].every(isNumOrNull);
const isGrid = (g: unknown) => isObj(g) && isStrs(g.actions) && isObj(g.cells) && Object.values(g.cells).every((c) => isCell(c, (g.actions as string[]).length));
const isAction = (a: unknown) => isObj(a) && isStr(a.action) && isOptNum(a.freq) && isOptNum(a.combos) && [a.ev_bb, a.amount_bb].every(isNumOrNull);
const isComboRow = (r: unknown) => Array.isArray(r) && r.length >= 5 && isHole(r[0]) && isNum(r[1]) && isNumsOrNull(r[2]) && r[2] !== null && isNumsOrNull(r[3]) && isNumOrNull(r[4]);
const isCategory = (c: unknown) => Array.isArray(c) && c.length === 2 && isStrs(c);

/** The fields of a node's answer the page reads, of the types it reads them as: it draws what it's given. */
function isNode(d: Record<string, unknown>): d is AdvisorResponse {
  return (
    d.study === "node" &&
    d.error === undefined &&
    ["preflop", "flop", "turn", "river"].includes(d.street as string) &&
    isStr(d.actor) &&
    [d.opponent, d.position, d.board, d.fallback, d.fallback_reason].every(isOptStr) &&
    [d.pot_bb, d.to_call_bb, d.range_combos, d.opponent_combos, d.seconds].every(isOptNum) &&
    [d.range_ev_bb, d.range_eq, d.opponent_eq].every(isNumOrNull) &&
    [d.solver, d.precomputed, d.tournament].every(isOptObj) &&
    Array.isArray(d.actions) &&
    d.actions.every(isAction) &&
    (d.notes === undefined || isStrs(d.notes)) &&
    (d.grid === undefined || isGrid(d.grid)) &&
    (d.opponent_grid === undefined || isGrid(d.opponent_grid)) &&
    (d.opponents === undefined || (Array.isArray(d.opponents) && d.opponents.every((o) => isObj(o) && isStr(o.seat) && isGrid(o.grid)))) &&
    (d.combos === undefined || (isObj(d.combos) && Object.values(d.combos).every((rows) => Array.isArray(rows) && rows.every(isComboRow)))) &&
    (d.categories === undefined || (isObj(d.categories) && Object.values(d.categories).every((c) => c === undefined || (Array.isArray(c) && c.every(isCategory)))))
  );
}

/** What can claim to be a solve; */
const SOLVES: readonly ResultSource[] = ["library", "library-turn", "instant", "live", "preflop-solve"];
/** and what never can. Anything else (a lock's, an assumed profile's, an unlabelled answer) isn't Study's answer to a line. */
const NOT_SOLVES: readonly ResultSource[] = ["charts", "push-fold", "rules", "equity"];

/** Whether this source can answer this line. Preflop nothing is solved but the preflop solve, on a line that asked for it. */
export function sourceFits(source: ResultSource, hand: StudyHand): boolean {
  if (!SOLVES.includes(source) && !NOT_SOLVES.includes(source)) return false;
  if (streetOf(hand) !== "preflop") return source !== "preflop-solve" && source !== "push-fold";
  return NOT_SOLVES.includes(source) || (source === "preflop-solve" && hand.pf === "solver");
}

/** Whether what's worked out from an answer that isn't a solve claims nothing of one: no distance from equilibrium, and
 * none of the Advisor's blocks that put words of their own beside the source. */
const claimsNothing = (d: AdvisorResponse, p: Provenance) =>
  [p.exploitabilityPct, p.targetPct, p.band, p.iterations, p.mbbPerHand, p.confidence].every((x) => x === undefined) && !d.approximate && !d.locked && !d.sizes_kept && !d.triage;

export interface KeptAnswer {
  record: SavedAnswer;
  /** what Study shows: the answer, under what's worked out from it, marked as saved */
  result: SolveResult;
  /** what's worked out from it, in words */
  label: string;
  bytes: number;
}

const MODES: readonly SolveMode[] = ["quick", "fast", "accurate"];

/** A stored or restored record, whole and honest, else null. Nothing here throws. */
export function readAnswer(x: unknown): KeptAnswer | null {
  try {
    if (!isObj(x)) return null;
    const { id, line, json, provenance: was, savedAt, restored } = x;
    if (!isWellFormed(id) || !id || !isWellFormed(line) || !isStr(json) || !isTime(savedAt) || !(restored === undefined || restored === true) || !isObj(was)) return null;
    const { mode, transport, solverVersion, libraryVersion, receivedAt } = was;
    if (!MODES.includes(mode as SolveMode) || (transport !== "worker" && transport !== "http") || !isStr(solverVersion) || !isOptStr(libraryVersion) || !isTime(receivedAt)) return null;
    // (a string's length is no more than its bytes, so one too long is refused unread)
    if (json.length > MAX_ANSWER_BYTES) return null;
    const bytes = byteLength(json);
    if (bytes > MAX_ANSWER_BYTES) return null;
    const data: unknown = JSON.parse(json);
    const hand = fromSearch(line);
    if (!hand || !isObj(data) || !isNode(data) || data.street !== streetOf(hand)) return null;
    const p = provenanceOf(data, { mode: mode as SolveMode, transport, solverVersion, partial: false, now: receivedAt });
    if (!sourceFits(p.source, hand) || (NOT_SOLVES.includes(p.source) && !claimsNothing(data, p))) return null;
    const stamped = { ...p, ...(libraryVersion ? { libraryVersion: libraryVersion as string } : {}) };
    const record = x as unknown as SavedAnswer;
    return { record, bytes, label: describe(stamped), result: { data, provenance: { ...stamped, view: [p.view, savedWords(record)].filter(Boolean).join(", ") } } };
  } catch {
    return null;
  }
}

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
/** The build an answer ran on, where the page can know it: a local server's isn't the page's, and a development build has none. */
const buildOf = (r: SavedAnswer) => (r.provenance.transport === "worker" && r.provenance.solverVersion && r.provenance.solverVersion !== "dev" ? r.provenance.solverVersion : null);

/** In the provenance line, so wherever the line is said the answer is said to be saved. */
function savedWords(r: SavedAnswer): string {
  const build = buildOf(r);
  return `saved answer of ${dayOf(r.savedAt)}, solver build ${build ?? "unknown"}${r.restored ? ", restored from a backup file" : ""}`;
}

/** The answer to keep with a spot, or why not, in words to follow "not its answer: ". */
export function answerToKeep(id: string, line: string, result: SolveResult, now = Date.now()): { answer: SavedAnswer } | { refused: string } {
  if (result.provenance.partial) return { refused: "the solve hasn't finished" };
  const json = JSON.stringify(result.data);
  const bytes = byteLength(json);
  if (bytes > MAX_ANSWER_BYTES) return { refused: `it's ${kb(bytes)}, over the ${kb(MAX_ANSWER_BYTES)} a saved answer can be` };
  const answer: SavedAnswer = { id, line, json, provenance: result.provenance, savedAt: now };
  return readAnswer(answer) ? { answer } : { refused: "this page couldn't show it again as it stands" };
}

/** The answer saved with a spot, if it can be read and answers this line. */
export async function openAnswer(id: string, line: string): Promise<KeptAnswer | null> {
  try {
    const d = await db();
    const kept = d ? readAnswer(await d.get("savedAnswers", id)) : null;
    return kept?.record.line === line ? kept : null;
  } catch (e) {
    console.error("A saved answer couldn't be read:", e);
    return null;
  }
}

/** Every saved answer by its spot's id, null for one that can't be read. */
export async function listAnswers(): Promise<Map<string, KeptAnswer | null>> {
  const d = await db();
  const all: { id: string }[] = d ? await d.getAll("savedAnswers") : [];
  return new Map(all.map((x) => [x.id, readAnswer(x)]));
}

/** Where an answer stands against the build this page runs: `current` is null where that isn't known. A build is a hash,
 * so "another" can't say which is the later. */
export function versionStand(r: SavedAnswer, current: string | null): "current" | "another" | "unknown" {
  const build = buildOf(r);
  if (!build || !current || current === "dev") return "unknown";
  return build === current ? "current" : "another";
}

/** How a saved answer stands, in a sentence or two. */
export function answerWords(k: KeptAnswer, current: string | null): string {
  const { record: r } = k;
  const build = buildOf(r);
  const stand = versionStand(r, current);
  const library = r.provenance.libraryVersion ? ` Read from ${versionWords(r.provenance.libraryVersion)}.` : "";
  const which =
    stand === "current"
      ? `Solver build ${build}, the one this page runs.`
      : stand === "another"
        ? `From another engine version, not the current one: solver build ${build}, where this page runs ${current}. The engine may answer differently now.`
        : build
          ? `Solver build ${build}; whether this page runs the same one can't be told.`
          : "The solver build it came from isn't known, so it can't be called current.";
  return `Saved answer of ${dayOf(r.savedAt)}, not solved again. ${which}${library}${r.restored ? " It came in from a backup file." : ""}`;
}

/** What a spot says it saw, for the Saved page, from what's stored: said through the provenance's own check of a kept
 * line (provenance.ts keptWords), so the charts are said as the charts, and a claim of a solve on a line none can answer
 * is left out. */
export function seenWords(seen: SavedSpot["seen"], line: string): string | null {
  if (!seen || !isSource(seen.source)) return null;
  const hand = fromSearch(line);
  const solve = SOLVES.includes(seen.source);
  if (solve && (!hand || !sourceFits(seen.source, hand))) return null;
  return describe({ source: seen.source, keptLabel: seen.label, approximate: !solve, mode: "fast", transport: "kept", solverVersion: "", partial: false, receivedAt: 0 });
}
