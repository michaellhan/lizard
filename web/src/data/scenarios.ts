// Saved scenarios: a Practice setup kept under a name in this browser (db.ts `savedScenarios`), listed on the Saved page
// and started from there. What's stored can be old or hand-edited, and a backup can carry anything, so every read goes
// through `readScenario`: the setup is rebuilt as the New session form would have built it (SetupForm.tsx), a field an
// older record never had takes its default, and one that makes no sense makes the record damaged. A damaged record is
// counted and left out, and nothing here throws.
import { describeSetup, LIMITS, setupProblems, SIZE_STREETS, type SizeStreet } from "@/features/solve/setup";
import { assumedWords, exploitOf, exploitNumbers, isProfile } from "@/features/practice/exploit";
import { carries, gameLabel, isPotDrill, MAX_STACK, MIN_STACK, POT_DRILLS, PUSH_FOLD_MAX, type SessionOptions, type Sizes, type TournamentOptions } from "@/features/practice/practice";
import { flopsLike, isTextureFilter, TEXTURE_GROUPS, type TextureFilter } from "@/features/practice/texture";
import { draftOf, readDraft } from "@/features/practice/TournamentFields";
import { MAX_PLAYERS, MIN_PLAYERS, seatLabel, seatsOf } from "@/poker/seats";
import { noteSaved } from "./backupNudge";
import { db, type SavedScenario } from "./db";
import { isOptTags, isTime, isWellFormed } from "./shapes";

export type ScenarioSetup = Pick<SavedScenario, "players" | "stack" | "opts">;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isBool = (x: unknown): x is boolean => typeof x === "boolean";
/** The number stored, its default where an older record has none, or null where it isn't a number. */
const numOr = (x: unknown, dflt: number) => (x === undefined || x === null ? dflt : isNum(x) ? x : null);
const boolOr = (x: unknown) => (x === undefined || x === null ? false : isBool(x) ? x : null);

function readTournament(t: unknown, players: number, stack: number): TournamentOptions | null {
  if (!isObj(t) || (t.model !== "icm" && t.model !== "chips") || !isObj(t.stacks) || !Object.values(t.stacks).every(isNum)) return null;
  if (t.model === "icm" && !(Array.isArray(t.payouts) && t.payouts.every(isNum))) return null;
  if (t.field !== undefined && !(isObj(t.field) && isNum(t.field.players) && isNum(t.field.avg))) return null;
  return readDraft(draftOf(t as unknown as TournamentOptions, stack), players, stack, MAX_STACK).value;
}

/** Your sizes, or undefined where they aren't any the form takes. */
function readSizes(x: unknown, players: number): Sizes | null | undefined {
  if (x === undefined || x === null) return null;
  if (!isObj(x)) return undefined;
  const parts = Object.entries(x).filter(([, v]) => !Array.isArray(v) || v.length > 0);
  if (!parts.every(([k, v]) => SIZE_STREETS.includes(k as SizeStreet) && Array.isArray(v) && v.every(isNum))) return undefined;
  const sizes = Object.fromEntries(parts) as Sizes;
  if (setupProblems(players, { sizes }).length) return undefined;
  return parts.length ? sizes : null;
}

/** The board filter, or undefined where it isn't one or no flop fits it. */
function readBoard(x: unknown): TextureFilter | null | undefined {
  if (x === undefined || x === null) return null;
  if (!isTextureFilter(x)) return undefined;
  if (!Object.values(x).some(Boolean)) return null;
  return flopsLike(x).length ? x : undefined;
}

function readOpts(o: unknown, players: number, stack: number): SessionOptions | null {
  if (!isObj(o)) return null;
  const seat = o.seat ?? "moves";
  if (typeof seat !== "string" || !(seat === "moves" || seat === "random" || seatsOf(players).includes(seat))) return null;
  const pot = o.pot ?? null;
  if (pot !== null && !isPotDrill(pot)) return null;
  const preflop = boolOr(o.preflopOnly), pushFold = boolOr(o.pushFold), straddle = boolOr(o.straddle), carry = boolOr(o.carry);
  const ante = numOr(o.ante, 0), rake = numOr(o.rake, 0), rakeCap = numOr(o.rakeCap, 0);
  if (preflop === null || pushFold === null || straddle === null || carry === null || ante === null || rake === null || rakeCap === null) return null;
  if (!(ante >= 0 && ante <= LIMITS.ante) || !(rake >= 0 && rake <= LIMITS.rakePct) || !(rakeCap >= 0)) return null;
  const tournament = o.tournament === undefined || o.tournament === null ? null : readTournament(o.tournament, players, stack);
  if (o.tournament !== undefined && o.tournament !== null && !tournament) return null;
  // (the Play select is one choice)
  if ([pot !== null, pushFold, !!tournament, preflop && !tournament].filter(Boolean).length > 1) return null;
  if (pushFold && stack > PUSH_FOLD_MAX) return null;
  const noFlop = preflop || pushFold || !!tournament;
  const sizes = readSizes(o.sizes, players);
  const board = readBoard(o.board);
  if (sizes === undefined || board === undefined) return null;
  // (a stored read's numbers aren't kept: a scenario is a setup, and it starts with the profile as it stands. Numbers that
  // don't belong to the profile named can't then be graded against under its name)
  const read = o.exploit === undefined || o.exploit === null ? null : isObj(o.exploit) && isProfile(o.exploit.profile) ? exploitOf(o.exploit.profile) : false;
  if (read === false || (read && !pot)) return null;
  const game = { pushFold, tournament: tournament ?? undefined, preflopOnly: preflop, pot, seat };
  return {
    seat,
    preflopOnly: preflop,
    pot,
    ante,
    straddle: straddle && players >= 3 && !tournament,
    carry: carries({ ...game, carry }),
    sizes: noFlop ? null : sizes,
    rake: tournament ? 0 : rake,
    rakeCap: rake && !tournament ? rakeCap : 0,
    board: pot ? board : null,
    ...(pushFold ? { pushFold: true } : {}),
    ...(tournament ? { tournament } : {}),
    ...(read ? { exploit: read } : {}),
  };
}

/** A setup as it's stored, whole and playable, else null. */
export function readSetup(x: unknown): ScenarioSetup | null {
  if (!isObj(x)) return null;
  const { players, stack } = x;
  if (!isNum(players) || !Number.isInteger(players) || players < MIN_PLAYERS || players > MAX_PLAYERS) return null;
  if (!isNum(stack) || stack < MIN_STACK || stack > MAX_STACK) return null;
  const opts = readOpts(x.opts, players, stack);
  return opts ? { players, stack, opts } : null;
}

/** A scenario as it's stored, else null: see the top of the file. */
export function readScenario(x: unknown): SavedScenario | null {
  try {
    if (!isObj(x)) return null;
    const { id, name, note, tags, createdAt, updatedAt } = x;
    if (!isWellFormed(id) || !id || !isWellFormed(name) || !name.trim() || !(note === undefined || isWellFormed(note)) || !isOptTags(tags) || !isTime(createdAt) || !isTime(updatedAt)) return null;
    const setup = readSetup(x);
    return setup && { id, name, ...setup, note: note ?? "", ...(tags ? { tags: tags as string[] } : {}), createdAt, updatedAt };
  } catch {
    return null;
  }
}

/** Whether it was stored: false where the browser's database can't be used. */
export async function putScenario(s: SavedScenario): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  await d.put("savedScenarios", s);
  await noteSaved();
  return true;
}

/** Every scenario that can be read, the latest changed first, and how many can't. */
export async function listScenarios(): Promise<{ list: SavedScenario[]; damaged: number }> {
  const d = await db();
  const all: unknown[] = d ? await d.getAll("savedScenarios") : [];
  const list = all.flatMap((x) => readScenario(x) ?? []);
  return { list: list.sort((a, b) => b.updatedAt - a.updatedAt), damaged: all.length - list.length };
}

/** A scenario by its id: undefined where there's none, or it can't be read. */
export async function getScenario(id: string): Promise<SavedScenario | undefined> {
  const d = await db();
  return (d && readScenario(await d.get("savedScenarios", id))) ?? undefined;
}

export async function deleteScenario(id: string): Promise<void> {
  const d = await db();
  if (d) await d.delete("savedScenarios", id);
}

const boardWords = (b: TextureFilter) => TEXTURE_GROUPS.flatMap((g) => (b[g.key] ? [g.values[b[g.key]!]!.toLowerCase()] : []));

/** The setup in words: what you typed, with an exploit profile's numbers said to be assumed. */
export function scenarioWords({ players, stack, opts: o }: ScenarioSetup): string {
  return [
    `${players === 2 ? "HU" : `${players}-max`} ${stack}bb`,
    o.seat === "moves" ? "" : o.seat === "random" ? "random seat" : `seat ${seatLabel(o.seat, players)}`,
    o.pot ? POT_DRILLS[o.pot as keyof typeof POT_DRILLS].label.toLowerCase() : o.pushFold ? "push/fold" : o.tournament ? gameLabel(o.tournament) : o.preflopOnly ? "preflop only" : "full hands",
    o.tournament && o.preflopOnly ? "stops at the flop" : "",
    ...(o.board ? boardWords(o.board) : []),
    o.exploit ? `exploiting ${assumedWords(o.exploit)}: ${exploitNumbers(o.exploit)}` : "",
    o.ante ? `ante ${o.ante}bb` : "",
    o.straddle ? "straddle" : "",
    o.rake ? `rake ${o.rake}%${o.rakeCap ? ` (cap ${o.rakeCap}bb)` : ""}` : "",
    o.carry ? "chips carried" : "",
    ...describeSetup(o.sizes ? { sizes: o.sizes } : undefined),
  ]
    .filter(Boolean)
    .join(" · ");
}
