// A tournament spot (ROADMAP Phase 7): the prizes left, the players at other tables and the bounties, on top of the
// Solve page's setup (each seat's stack matters most here). Each is a key the engine already reads in Study
// (solver/gto/advisor.py _tournament, _bounties):
//   payouts   the prizes still to be paid, first place first, in any unit ([50, 30, 20]); two or more: ICM
//   field     the other tables' players, as {players, chips} (an even split; chips in bb here)
//   bounties  KO or PKO: {format, seats: {seat: bounty}, field: the other tables' average}; mystery: {format,
//             envelope} or {format, pool, left}; in the payouts' units
// A tournament has no rake (the engine drops it). One prize and no bounties is winner-takes-all: chips are prizes, so
// the engine answers in chips. In Study's URL: pay=50,30,20 · fld=12:40 (players:average bb) · bty=ko · bty.each=10 ·
// bty.field=8 · bs.BTN=20 (a seat's own) · bty.env=5 · bty.pool=500 · bty.left=40.
import { seatsOf } from "@/poker/seats";

export const BOUNTY_FORMATS = ["ko", "pko", "mystery"] as const;
export type BountyFormat = (typeof BOUNTY_FORMATS)[number];
export const BOUNTY_NAME: Record<BountyFormat, string> = { ko: "KO", pko: "PKO", mystery: "mystery" };

export const T_LIMITS = {
  /** places paid, as the classic page reads them */
  places: 200,
  /** players at other tables */
  field: 10000,
  /** their average stack, bb */
  fieldAvg: [1, 1000],
} as const;

export interface TournamentBounty {
  format: BountyFormat;
  /** KO, PKO: every seat's bounty, the seats with their own, and the other tables' average */
  each?: number;
  seats?: Record<string, number>;
  field?: number;
  /** mystery: the average envelope left, or the money in envelopes and how many are left */
  envelope?: number;
  pool?: number;
  left?: number;
}

export interface TournamentSetup {
  /** the prizes still to be paid, first place first, in any unit */
  payouts?: number[];
  /** the players at other tables and their average stack, bb */
  field?: { players: number; avg: number };
  bounty?: TournamentBounty;
}

/** Generic payout shapes (Lizard's own, in % of what's left), for a start. */
export const PAYOUT_PRESETS: readonly { name: string; payouts: number[] }[] = [
  { name: "Winner takes all", payouts: [100] },
  { name: "Top 3", payouts: [50, 30, 20] },
  { name: "Final table, 9 paid", payouts: [30, 20, 14, 10.5, 8, 6.5, 5, 3.5, 2.5] },
];

/** A satellite's bubble at this table: equal prizes (seats), one fewer than the players (none heads-up, where one seat
 * is winner-takes-all). Flat payouts are checked on the engine in scripts/engine/test_tournament.py. */
export const satellitePayouts = (players: number): number[] | null => (players >= 3 ? Array<number>(players - 1).fill(1) : null);

/** A typical MTT's curve, Lizard's own: the places a field of the players left would pay at 15% (at least 2, at most
 * T_LIMITS.places), place k paying in proportion to k^-0.8, in % rounded to 0.1 (15 places: 1st 23.7%, 15th 2.7%).
 * null where that's fewer than 2 places (under 10 players left). */
export function paidCurve(playersLeft: number, share = 0.15): number[] | null {
  const places = Math.min(T_LIMITS.places, Math.round(playersLeft * share));
  return places >= 2 ? curveOf(places) : null;
}

/** Lizard's curve over this many places: place k in proportion to k^-0.8, in % rounded to 0.1. */
const curveOf = (places: number): number[] => {
  const w = Array.from({ length: places }, (_, k) => (k + 1) ** -0.8);
  const tot = w.reduce((a, b) => a + b, 0);
  return w.map((x) => Math.round((x / tot) * 1000) / 10);
};

/** A stage of an MTT, set up at once on the Tournaments page: this table's seats and chips, the prizes left and the
 * other tables. Generic shapes of Lizard's own, not any site's or any real tournament's. */
export interface StagePreset {
  name: string;
  /** what it sets up, in words (its button's title) */
  about: string;
  players: number;
  /** each seat's chips, bb, in the table's seat order (seatsOf) */
  stacks: number[];
  payouts: number[];
  field?: { players: number; avg: number };
  /** each seat's ante, bb: 0 for none (unset: a 1bb big-blind ante, `stageAnte`) */
  ante?: number;
}

const FINAL_TABLE = PAYOUT_PRESETS[2]!.payouts;

export const STAGE_PRESETS: readonly StagePreset[] = [
  {
    name: "Early",
    about: "1,000 players left and 150 paid, 60bb deep: far from the money, where prize equity is close to chips",
    players: 8,
    stacks: [60, 60, 60, 60, 60, 60, 60, 60],
    payouts: curveOf(150),
    field: { players: 992, avg: 60 },
  },
  {
    name: "Bubble",
    about: "116 players left and 115 paid, stacks from 6 to 48bb: one more bust and everyone left is paid",
    players: 8,
    stacks: [22, 48, 10, 35, 6, 28, 14, 18],
    payouts: curveOf(115),
    field: { players: 108, avg: 25 },
  },
  {
    name: "Final-table bubble",
    about: "10 players left over two tables of 5, 9 paid: one more bust makes the final table",
    players: 5,
    stacks: [20, 40, 8, 28, 14],
    payouts: FINAL_TABLE,
    field: { players: 5, avg: 22 },
  },
  {
    name: "Final table",
    about: "9 players left, all paid, stacks from 6 to 62bb",
    players: 9,
    stacks: [27, 9, 62, 16, 34, 6, 45, 12, 21],
    payouts: FINAL_TABLE,
  },
  {
    name: "Three left",
    about: "The last three of a 9-paid final table, 15, 30 and 55bb",
    players: 3,
    stacks: [30, 55, 15],
    payouts: FINAL_TABLE.slice(0, 3),
  },
  {
    name: "Heads-up",
    about: "The last two of a 9-paid final table, 40 and 60bb",
    players: 2,
    stacks: [40, 60],
    payouts: FINAL_TABLE.slice(0, 2),
  },
];

/** A stage's ante: a big-blind ante of 1bb, as each seat's share (rounded to 0.01bb). */
export const stageAnte = (players: number): number => Math.round(100 / players) / 100;

/** A preset's ante a seat, bb: its own, else a 1bb big-blind ante. */
export const presetAnte = (st: Pick<StagePreset, "ante" | "players">): number => st.ante ?? stageAnte(st.players);

/** The ante in words, for a preset's note. */
export const anteWords = (st: Pick<StagePreset, "ante" | "players">): string => {
  const a = presetAnte(st);
  return !a ? "no ante" : st.ante === undefined ? `a 1bb big-blind ante, as ${a}bb a seat` : `an ante of ${a}bb a seat`;
};

/**
 * Sit & go and spin formats, set up at once as the stages are: a table, each seat's chips, the ante and the prizes.
 * Generic shapes of Lizard's own, not any site's: the usual payouts of each format (a 9-player sit & go pays 3, a 6-player
 * one 2, a double or nothing half the table the same, a spin winner takes all) at round starting stacks. A spin pays one
 * prize, so its chips are its prizes: it's answered in chip EV.
 */
export const FORMAT_PRESETS: readonly StagePreset[] = [
  {
    name: "Sit & go, 9 players",
    about: "The start of a 9-player sit & go paying 50/30/20, everyone 75bb, no ante",
    players: 9,
    stacks: [75, 75, 75, 75, 75, 75, 75, 75, 75],
    payouts: [50, 30, 20],
    ante: 0,
  },
  {
    name: "Sit & go bubble",
    about: "Four left of a 9-player sit & go paying 50/30/20, stacks from 9 to 24bb: one more bust and everyone left is paid",
    players: 4,
    stacks: [24, 16, 9, 18],
    payouts: [50, 30, 20],
  },
  {
    name: "Sit & go, 6 players",
    about: "The start of a 6-player sit & go paying 65/35, everyone 75bb, no ante",
    players: 6,
    stacks: [75, 75, 75, 75, 75, 75],
    payouts: [65, 35],
    ante: 0,
  },
  {
    name: "Double or nothing",
    about: "A 6-player double or nothing, the last 3 paid the same, everyone 50bb, no ante",
    players: 6,
    stacks: [50, 50, 50, 50, 50, 50],
    payouts: [1, 1, 1],
    ante: 0,
  },
  {
    name: "Spin, 3 players",
    about: "A 3-player spin, winner takes all, everyone 25bb, no ante: one prize, so chips are prizes and it's chip EV",
    players: 3,
    stacks: [25, 25, 25],
    payouts: [100],
    ante: 0,
  },
];

/**
 * The final-table set: preflop solves in prize equity stored for the last 3 to 9 players of a 9-paid final table (its last
 * places' prizes), at an average stack of FT_DEPTHS bb, in three shapes of stacks (FT_SHAPES), with a 1bb big-blind ante
 * as each seat's share and no other tables. Lizard's own shapes, as engine/pf_icm_stored.py FINAL_TABLE_SET builds them
 * (pfIcmStored.test.ts holds the two to the manifest).
 */
export const FT_PLAYERS = [3, 4, 5, 6, 7, 8, 9] as const;
export const FT_DEPTHS = [10, 15, 20, 30, 40] as const;
export const FT_SHAPES = ["equal", "leader", "short"] as const;
export type FtShape = (typeof FT_SHAPES)[number];
export const FT_SHAPE_WORDS: Record<FtShape, string> = { equal: "equal stacks", leader: "chip leader on the button", short: "short stack in the big blind" };

/** Down to 0.1bb (floor, as the engine's list: the two agree to the bit). */
const tenth = (x: number) => Math.floor(x * 10 + 1e-9) / 10;

/** Each seat's chips in seat order: equal; the button with twice the average and the rest sharing what's left; the big
 * blind with 0.4 of it and the rest sharing what's left. */
export function finalTableStacks(players: number, avg: number, shape: FtShape): number[] {
  if (shape === "equal") return Array<number>(players).fill(avg);
  const special = shape === "leader" ? 2 * avg : tenth(0.4 * avg);
  const rest = tenth((players * avg - special) / (players - 1));
  const at = shape === "leader" ? players - 3 : players - 1;
  return Array.from({ length: players }, (_, i) => (i === at ? special : rest));
}

export const finalTableName = (players: number, avg: number, shape: FtShape) => `Final table, ${players} left, ${avg}bb average, ${FT_SHAPE_WORDS[shape]}`;

/** One spot of the final-table set, as a preset (it sets up as a stage does). */
export function finalTableSpot(players: number, avg: number, shape: FtShape): StagePreset {
  return {
    name: finalTableName(players, avg, shape),
    about: `${players} left of a 9-paid final table, ${avg}bb on average, ${FT_SHAPE_WORDS[shape]}`,
    players,
    stacks: finalTableStacks(players, avg, shape),
    payouts: FINAL_TABLE.slice(0, players),
  };
}

export const FINAL_TABLE_SET: readonly StagePreset[] = FT_PLAYERS.flatMap((n) => FT_DEPTHS.flatMap((d) => FT_SHAPES.map((sh) => finalTableSpot(n, d, sh))));

/** The set's coverage, in words, for the page. */
export const FT_COVERAGE = `${FINAL_TABLE_SET.length} spots: ${FT_PLAYERS[0]} to ${FT_PLAYERS.at(-1)} players left of a 9-paid final table (${FINAL_TABLE.join("/")}), averages of ${FT_DEPTHS.join(", ")}bb, each with ${FT_SHAPES.map((s) => FT_SHAPE_WORDS[s]).join(", ")}, a 1bb big-blind ante, no other tables`;

/** Money as people write it, made plain: no currency sign or percent sign, no thousands commas ("$1,000" -> "1000"). */
const plainMoney = (t: string) => t.replace(/[$€£¥%]/g, "").replace(/(\d),(?=\d{3}(?!\d))/g, "$1");

/** "50 30 20", "50/30/20", "50, 30, 20", "$10,000 $6,000" -> [50, 30, 20] / [10000, 6000] (a word that isn't a number
 * stays, as NaN, for the check) */
export const parsePayouts = (t: string): number[] =>
  plainMoney(t)
    .split(/[\s,;/]+/)
    .filter(Boolean)
    .map((x) => Number(x));

/** A line's place or places at its start: "1st", "4-6", "7th – 9th", "2nd place", "3:", "3)", "4. " or "1<tab>". */
const PLACE = /^(\d+)\s*(st|nd|rd|th)?(?:\s*(?:-|–|—|to)\s*(\d+)\s*(?:st|nd|rd|th)?)?\s*(place\b)?\s*(:|\)|=|\.(?=\s))?/i;
/** Far more places than a payout table has: a range past this isn't spelled out (the check refuses past 200). */
const MOST_PLACES = 250;

/** A tournament summary a poker room writes (its header names the tournament and its prize pool): its place lines are
 * read for the prizes paid and its other lines skipped. */
const SUMMARY = /tournament\s*#\s*\d+[\s\S]*prize\s*pool|prize\s*pool[\s\S]*tournament\s*#\s*\d+/i;
const SUMMARY_HEAD = /tournament|buy-?in|prize\s*pool|\bplayers?\b|\bentrants?\b|started|finished|you (?:received|won)|\d{4}[/.-]\d{1,2}[/.-]\d{1,2}/i;
/** a summary's place line: "12: name", "12th : name" */
const PLACE_LINE = /^\d+\s*(?:st|nd|rd|th)?\s*:/i;
/** an amount with its currency sign before it ("$1,234.56", "€ 50") */
const MONEY = /[$€£¥]\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/;

/** A payout table pasted from a site or a sheet, one place (or a range of places) a line, as the payouts box's text ("1st
 * $10,000 / 2nd $6,000 / 4-6 $2,000" -> "10000 6000 2000 2000 2000"); a place left out is a gap ("?") the check names.
 * Lines without a number ("Place Prize") and a "Total" line are skipped, and so are a room's tournament summary's header
 * and its unpaid finishers. null for text that isn't a table (one line with
 * no place on it), which the box takes as it is. */
export function pastedPayouts(text: string): string | null {
  const summary = SUMMARY.test(text);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /\d/.test(l) && !/^total\b/i.test(l) && !(summary && SUMMARY_HEAD.test(l) && !PLACE_LINE.test(l)));
  if (!lines.length) return null;
  const byPlace = new Map<number, number>();
  let at = 0;
  let placed = false;
  for (const raw of lines) {
    const line = plainMoney(raw);
    const m = PLACE.exec(line);
    const rest = m ? line.slice(m[0].length) : "";
    // (an amount with its currency sign first: a player's name in a summary can hold digits, and a share in brackets follows)
    const money = m ? MONEY.exec(raw.slice(PLACE.exec(raw)?.[0].length ?? 0)) : null;
    const amount = money ? [money[1]!.replace(/,/g, "")] : /\d+(?:\.\d+)?/.exec(rest);
    const tabbed = /^\d+\s*\t/.test(line);
    const marked = !!m && !!(m[2] || m[3] || m[4] || m[5] || tabbed);
    // (a summary's finisher with no prize: "25: hero (Canada),")
    if (summary && marked && !money) continue;
    if (m && amount && marked) {
      placed = true;
      const from = Number(m[1]);
      const to = Math.min(m[3] ? Number(m[3]) : from, MOST_PLACES);
      for (let k = from; k <= to; k++) if (!byPlace.has(k)) byPlace.set(k, Number(amount[0]));
      at = Math.max(at, to);
    } else {
      for (const n of line.match(/\d+(?:\.\d+)?/g) ?? []) byPlace.set(++at, Number(n));
    }
  }
  if (!placed && lines.length < 2) return null;
  const last = Math.max(...byPlace.keys());
  return Array.from({ length: last }, (_, k) => (byPlace.has(k + 1) ? String(byPlace.get(k + 1)) : "?")).join(" ");
}

/** A CSV row's cells: split on the delimiter outside double quotes, quotes taken off. */
function csvCells(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && c === sep) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** A cell that's a place or a range of places: "1", "1st", "4-6", "7th – 9th". */
const PLACE_CELL = /^(\d+)\s*(?:st|nd|rd|th)?(?:\s*(?:-|–|—|to)\s*(\d+)\s*(?:st|nd|rd|th)?)?$/i;

/**
 * A payout table saved as CSV from a spreadsheet or a site ("Place,Prize" or "Place;Prize;%" rows, a header row, quoted
 * cells such as "$1,000.00", ranges such as 4-6), as the payouts box's text: each row's place and the first number after
 * it (an amount or a percent: either is in proportion, all ICM reads), through pastedPayouts. null where the text isn't
 * one (fewer than two rows starting with a place, or rows of one cell), which the box then reads as pasted text.
 */
export function csvPayouts(text: string): string | null {
  // (the delimiter: a tab where any line has one, as a sheet copies, so "$10,000" stays whole; else a semicolon; else a comma)
  const sep = text.includes("\t") ? "\t" : /;/.test(text) ? ";" : ",";
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => csvCells(l, sep));
  const placed = rows.filter((r) => r.length >= 2 && PLACE_CELL.test(r[0]!) && r.slice(1).some((c) => /\d/.test(c)));
  // (rows of different lengths are an unquoted "1,$1,000": not CSV to read, the pasted-text reader's)
  if (placed.length < 2 || new Set(placed.map((r) => r.length)).size > 1) return null;
  const lines = placed.map((r) => {
    const m = PLACE_CELL.exec(r[0]!)!;
    const prize = r.slice(1).find((c) => /\d/.test(c))!;
    return `${m[1]}${m[2] ? `-${m[2]}` : ""}\t${plainMoney(prize).replace(/[^\d.]/g, "")}`;
  });
  return pastedPayouts(lines.join("\n"));
}

/** A payout table read from a file or a paste, with what's wrong with it and a line saying what it is. */
export function readPayoutTable(text: string): { text: string; payouts: number[]; problems: string[]; note: string } {
  const t = csvPayouts(text) ?? pastedPayouts(text) ?? text.trim();
  const payouts = parsePayouts(t);
  const problems = payoutProblems(payouts);
  const total = payouts.filter((x) => Number.isFinite(x)).reduce((a, b) => a + b, 0);
  const note = payouts.length
    ? `${payouts.length} place${payouts.length === 1 ? "" : "s"} paid, ${Math.round(total * 100) / 100} in all, 1st ${payouts[0]}${payouts.length > 1 ? `, last ${payouts.at(-1)}` : ""}`
    : "no prizes read";
  return { text: t, payouts, problems, note };
}

/** What's wrong with a list of prizes, first place first: a gap or a word, a prize of 0 or less, too many places, or a
 * place paying more than the one above it (no table pays that way, and it's what a column read the wrong way round gives). */
export function payoutProblems(ps: readonly number[]): string[] {
  const out: string[] = [];
  const gaps = ps.flatMap((x, i) => (Number.isFinite(x) ? [] : [i + 1]));
  if (gaps.length) out.push(`no prize read for place ${gaps.slice(0, 5).join(", ")}${gaps.length > 5 ? ", …" : ""}`);
  if (ps.some((x) => Number.isFinite(x) && !(x > 0))) out.push("every prize must be more than 0");
  if (ps.length > T_LIMITS.places) out.push(`at most ${T_LIMITS.places} places paid (this has ${ps.length})`);
  const up = ps.findIndex((x, i) => i > 0 && Number.isFinite(x) && Number.isFinite(ps[i - 1]!) && x > ps[i - 1]! + 1e-9);
  if (up > 0) out.push(`place ${up + 1} pays more than place ${up}: prizes go first place first, largest first`);
  return out;
}

/** Room-style payout structures of Lizard's own (not any site's): the usual shapes of a format, in % of the prize pool.
 * `byEntrants`: an MTT's, whose places paid follow the entrants. The prizes left at a table are its first places, as many
 * as the players left (`prizesLeft`). */
export interface PayoutStructure {
  name: string;
  about: string;
  byEntrants: boolean;
  of: (entrants: number) => number[];
}

/** An MTT's payouts, in % to 0.01: `share` of the entrants paid (2 to T_LIMITS.places places), place k in proportion to
 * k^-steep, the final table's nine paid one by one and the places after it in bands (3, 3, 3, then 9 at a time) that pay
 * their band's average, as rooms pay them. */
export function mttPayouts(entrants: number, share: number, steep: number): number[] {
  const places = Math.max(2, Math.min(T_LIMITS.places, Math.round(entrants * share)));
  const w = Array.from({ length: places }, (_, k) => (k + 1) ** -steep);
  const bands: [number, number][] = [];
  for (let k = 0; k < places; ) {
    const size = k < 9 ? 1 : k < 18 ? 3 : 9;
    bands.push([k, Math.min(places, k + size)]);
    k += size;
  }
  const flat = bands.flatMap(([a, b]) => {
    const avg = w.slice(a, b).reduce((x, y) => x + y, 0) / (b - a);
    return Array<number>(b - a).fill(avg);
  });
  const tot = flat.reduce((x, y) => x + y, 0);
  return flat.map((x) => Math.round((x / tot) * 10000) / 100);
}

export const PAYOUT_STRUCTURES: readonly PayoutStructure[] = [
  { name: "Sit & go, 6 players", about: "2 paid, 65/35", byEntrants: false, of: () => [65, 35] },
  { name: "Sit & go, 9 players", about: "3 paid, 50/30/20", byEntrants: false, of: () => [50, 30, 20] },
  { name: "Sit & go, 18 players", about: "4 paid, 40/30/20/10", byEntrants: false, of: () => [40, 30, 20, 10] },
  { name: "Sit & go, 45 players", about: "7 paid, 32% to first", byEntrants: false, of: () => [32, 21, 15, 11, 9, 7, 5] },
  { name: "Sit & go, 180 players", about: "18 paid, banded after the final table", byEntrants: false, of: () => mttPayouts(180, 0.1, 0.9) },
  { name: "MTT, standard", about: "15% of the entrants paid, banded after the final table", byEntrants: true, of: (e) => mttPayouts(e, 0.15, 0.85) },
  { name: "MTT, top-heavy", about: "10% paid, more to the top places", byEntrants: true, of: (e) => mttPayouts(e, 0.1, 1.0) },
  { name: "MTT, flat", about: "20% paid, more to the min-cashes", byEntrants: true, of: (e) => mttPayouts(e, 0.2, 0.7) },
];

/** The prizes still to pay with this many players left: the structure's first places, as many as the players left (the
 * places below were paid to the players out). */
export const prizesLeft = (structure: readonly number[], playersLeft: number): number[] => structure.slice(0, Math.max(1, playersLeft));

const pos = (x: number | undefined): x is number => x !== undefined && Number.isFinite(x) && x > 0;

/** A KO or PKO seat's bounty (its own, else everyone's). */
export const bountyOf = (b: TournamentBounty, p: string): number => b.seats?.[p] ?? b.each ?? 0;

/** Whether the bounties put anything at stake (else they're left out, as the engine would). */
function atStake(b: TournamentBounty | undefined): boolean {
  if (!b) return false;
  if (b.format === "mystery") return pos(b.envelope) || (pos(b.pool) && pos(b.left));
  return pos(b.each) || Object.values(b.seats ?? {}).some(pos);
}

/** The tournament with nothing unset kept (undefined where nothing is set). */
export function tidyTournament(t: TournamentSetup | undefined): TournamentSetup | undefined {
  if (!t) return undefined;
  const out: TournamentSetup = {};
  if (t.payouts?.length) out.payouts = t.payouts;
  const b = t.bounty;
  if (b && atStake(b)) {
    out.bounty =
      b.format === "mystery"
        ? { format: b.format, ...(pos(b.envelope) ? { envelope: b.envelope } : { pool: b.pool!, left: b.left! }) }
        : {
            format: b.format,
            ...(pos(b.each) ? { each: b.each } : {}),
            ...(b.seats && Object.keys(b.seats).length ? { seats: b.seats } : {}),
            ...(pos(b.field) ? { field: b.field } : {}),
          };
  }
  if (t.field && t.field.players > 0 && (out.payouts || out.bounty)) out.field = t.field;
  return Object.keys(out).length ? out : undefined;
}

/** What's wrong with the tournament at this table, in words (none: it can be asked). */
export function tournamentProblems(players: number, t: TournamentSetup | undefined): string[] {
  if (!t) return [];
  const out: string[] = [];
  const seats = seatsOf(players);
  const ps = t.payouts ?? [];
  if (ps.some((x) => !(x > 0) || !Number.isFinite(x))) out.push("the payouts must be positive numbers, first place first (like 50, 30, 20)");
  if (ps.length > T_LIMITS.places) out.push(`at most ${T_LIMITS.places} places paid`);
  const up = ps.findIndex((x, i) => i > 0 && x > ps[i - 1]! + 1e-9);
  if (up > 0) out.push(`the payouts must go largest first: place ${up + 1} pays more than place ${up}`);
  if (t.field) {
    const { players: n, avg } = t.field;
    if (!(Number.isInteger(n) && n >= 0 && n <= T_LIMITS.field)) out.push(`the players at other tables must be a whole number, 0–${T_LIMITS.field}`);
    else if (n > 0 && !(avg >= T_LIMITS.fieldAvg[0] && avg <= T_LIMITS.fieldAvg[1])) out.push(`their average stack must be ${T_LIMITS.fieldAvg[0]}–${T_LIMITS.fieldAvg[1]}bb`);
  }
  const b = t.bounty;
  if (b) {
    const nonneg = (x: number | undefined) => x === undefined || (Number.isFinite(x) && x >= 0);
    if (!BOUNTY_FORMATS.includes(b.format)) out.push("the bounty format must be KO, PKO or mystery");
    else if (b.format === "mystery") {
      if (![b.envelope, b.pool, b.left].every(nonneg)) out.push("the mystery bounties' amounts must be 0 or more");
      else if (b.left !== undefined && !Number.isInteger(b.left)) out.push("the envelopes left must be a whole number");
      else if (!atStake(b)) out.push("mystery bounties need the average envelope, or the pool and the envelopes left");
    } else {
      if (![b.each, b.field].every(nonneg)) out.push("the bounties must be 0 or more");
      for (const [p, v] of Object.entries(b.seats ?? {})) {
        if (!seats.includes(p)) out.push(`${p} isn't a seat at this table`);
        else if (!nonneg(v)) out.push(`${p}'s bounty must be 0 or more`);
      }
    }
  }
  const tidy = tidyTournament(t);
  if (t.field && t.field.players > 0 && !tidy?.payouts && !tidy?.bounty) out.push("the players at other tables count only with payouts or bounties");
  return out;
}

/** The engine's keys for the tournament (stacks in bb, so the field's chips are bb too). */
export function tournamentRequest(t: TournamentSetup | undefined, players: number): Record<string, unknown> {
  const s = tidyTournament(t);
  if (!s) return {};
  const b = s.bounty;
  return {
    ...(s.payouts ? { payouts: s.payouts } : {}),
    ...(s.field ? { field: { players: s.field.players, chips: Math.round(s.field.players * s.field.avg * 100) / 100 } } : {}),
    ...(b
      ? {
          bounties:
            b.format === "mystery"
              ? { format: b.format, ...(b.envelope ? { envelope: b.envelope } : { pool: b.pool, left: b.left }) }
              : { format: b.format, seats: Object.fromEntries(seatsOf(players).map((p) => [p, bountyOf(b, p)])), ...(b.field ? { field: b.field } : {}) },
        }
      : {}),
  };
}

const list = (xs: number[]) => xs.join(",");

export function tournamentToParams(t: TournamentSetup | undefined, q: URLSearchParams): void {
  const s = tidyTournament(t);
  if (!s) return;
  if (s.payouts) q.set("pay", list(s.payouts));
  if (s.field) q.set("fld", `${s.field.players}:${s.field.avg}`);
  const b = s.bounty;
  if (!b) return;
  q.set("bty", b.format);
  if (b.each) q.set("bty.each", String(b.each));
  if (b.field) q.set("bty.field", String(b.field));
  for (const [p, v] of Object.entries(b.seats ?? {})) q.set(`bs.${p}`, String(v));
  if (b.envelope) q.set("bty.env", String(b.envelope));
  if (b.pool) q.set("bty.pool", String(b.pool));
  if (b.left) q.set("bty.left", String(b.left));
}

export function tournamentFromParams(q: URLSearchParams): TournamentSetup | undefined {
  const t: TournamentSetup = {};
  const pay = q.get("pay");
  if (pay) t.payouts = pay.split(",").filter((x) => x.trim()).map(Number);
  const fld = q.get("fld");
  if (fld) {
    const [n, avg] = fld.split(":");
    t.field = { players: Number(n), avg: Number(avg) };
  }
  const f = q.get("bty");
  if (f) {
    const b: TournamentBounty = { format: (BOUNTY_FORMATS as readonly string[]).includes(f) ? (f as BountyFormat) : ("?" as BountyFormat) };
    const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
    const each = num("bty.each"), field = num("bty.field"), env = num("bty.env"), pool = num("bty.pool"), left = num("bty.left");
    if (each !== undefined) b.each = each;
    if (field !== undefined) b.field = field;
    if (env !== undefined) b.envelope = env;
    if (pool !== undefined) b.pool = pool;
    if (left !== undefined) b.left = left;
    const seats: Record<string, number> = {};
    for (const [k, v] of q) if (k.startsWith("bs.") && k.length > 3) seats[k.slice(3)] = Number(v);
    if (Object.keys(seats).length) b.seats = seats;
    t.bounty = b;
  }
  return Object.keys(t).length ? t : undefined;
}

/** The tournament in a few words each (empty where nothing is set). */
/** Prizes in words: each one up to 12 places, else the first three, how many, and the last ("payouts 11.8/6.8/4.9 … 115
 * places, the last 0.3"). */
const payoutWords = (ps: number[]) =>
  ps.length <= 12 ? `payouts ${ps.join("/")}` : `payouts ${ps.slice(0, 3).join("/")} … ${ps.length} places, the last ${ps.at(-1)}`;

export function describeTournament(t: TournamentSetup | undefined): string[] {
  const s = tidyTournament(t);
  if (!s) return [];
  const out: string[] = [];
  const flat = s.payouts && s.payouts.length > 1 && s.payouts.every((x) => x === s.payouts![0]);
  if (s.payouts) out.push(s.payouts.length === 1 ? "winner takes all (chips are prizes)" : flat ? `a satellite, ${s.payouts.length} equal seats` : payoutWords(s.payouts));
  else out.push("no payouts (chip EV, the prizes taken as the bounties in play)");
  if (s.field) out.push(`${s.field.players} at other tables (average ${s.field.avg}bb)`);
  const b = s.bounty;
  if (b?.format === "mystery") out.push(`mystery bounties, ${b.envelope ? `average envelope ${b.envelope}` : `pool ${b.pool}, ${b.left} left`}`);
  else if (b) {
    const own = Object.entries(b.seats ?? {}).filter(([, v]) => v !== (b.each ?? 0));
    out.push(`${BOUNTY_NAME[b.format]} bounties ${b.each ?? 0}${own.length ? ` (${own.map(([p, v]) => `${p} ${v}`).join(", ")})` : ""}${b.field ? `, other tables ${b.field}` : ""}`);
  }
  return out;
}
