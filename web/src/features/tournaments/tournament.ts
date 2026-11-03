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

/** "50 30 20", "50/30/20", "50, 30, 20" -> [50, 30, 20] (a word that isn't a number stays, as NaN, for the check) */
export const parsePayouts = (t: string): number[] =>
  t
    .split(/[\s,;/]+/)
    .filter(Boolean)
    .map((x) => Number(x));

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
export function describeTournament(t: TournamentSetup | undefined): string[] {
  const s = tidyTournament(t);
  if (!s) return [];
  const out: string[] = [];
  const flat = s.payouts && s.payouts.length > 1 && s.payouts.every((x) => x === s.payouts![0]);
  if (s.payouts) out.push(s.payouts.length === 1 ? "winner takes all (chips are prizes)" : flat ? `a satellite, ${s.payouts.length} equal seats` : `payouts ${s.payouts.join("/")}`);
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
