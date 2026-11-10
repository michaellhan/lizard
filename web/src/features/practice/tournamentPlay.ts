// A tournament session played out (Practice's "Play it out"): each hand starts from where the last one left the chips,
// the button moving on. A player with no chips is out: paid the lowest prize left if the players left are all paid (the
// prizes left then lose their last place), and the tables are balanced (below). Every LEVEL_HANDS hands the blinds go
// up by LEVEL_RISE (every stack, and the other tables' average, worth that many fewer big blinds; the ante is a share
// of the big blind, so it rises with it), and the other tables lose FIELD_RATE of their players (whose chips stay
// among them). You out, or alone with every chip,
// and the next hand starts the setup over, with what happened in words.
//
// The tables are balanced after every hand (`balancedSize`): the fewest tables that seat everyone left, each within one
// player of the others. This table takes players from the others at their average stack when it's short, a busted seat
// first, and when it's long the player due the big blind next moves to another table with their chips (never you: your
// moving would only change who you face). With one table's worth left, they all sit at this one: the final table.
//
// All of this is Lizard's own simplification of a tournament, said where the session shows it: the other tables are a
// count and an average stack, not tables of their own, a bust's place comes from the stacks the hand started with, and
// the other tables' pace is a fixed share a level. A bounty goes to whoever won the most chips in the hand that
// knocked its player out (a side pot's winner may not be the one who covered them), and a player from another table
// brings the other tables' average bounty as the setup set it, which doesn't grow as a PKO's would.
import { seatsOf } from "@/poker/seats";
import type { HandTournament, PracticeHand, TournamentOptions } from "./practice";

/** hands a blind level lasts */
export const LEVEL_HANDS = 10;
/** the blinds' rise each level: stacks in big blinds are divided by this */
export const LEVEL_RISE = 1.25;
/** the share of the other tables' players out each level (at least one while two or more are left) */
export const FIELD_RATE = 0.1;

/** The next hand's table in a tournament played out, or null: the tournament is over for you (out, or won), and
 * `news` says how. */
export interface MoveOn {
  table: { players: number; hero: string; stacks: Record<string, number>; tournament: HandTournament } | null;
  news: string[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const fmt = (x: number) => String(r2(x));

export function ordinal(k: number): string {
  const s = k % 100 >= 11 && k % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[k % 10] ?? "th";
  return `${k}${s}`;
}

/** The seat that has the button among `n` seats (heads-up the small blind). */
const buttonIndex = (n: number) => (n >= 3 ? n - 3 : 0);

/** The players left in all, at this table and the others. */
export const leftOf = (players: number, t: Pick<HandTournament, "field">) => players + (t.field?.players ?? 0);

/**
 * How many players this table seats with `here` at it and `elsewhere` at the other tables, each seating up to `seats`:
 * the fewest tables that hold everyone, each within one player of the others (as a tournament director balances them),
 * this one changing as little as it can. One table left holds everyone: the final table.
 */
export function balancedSize(here: number, elsewhere: number, seats: number): number {
  const all = here + elsewhere;
  const tables = Math.ceil(all / seats);
  return Math.min(Math.ceil(all / tables), Math.max(Math.floor(all / tables), here));
}

/** The hands a level lasts and the level a hand is in (0 first). */
export const levelOf = (t: Pick<HandTournament, "played">) => Math.floor((t.played ?? 0) / LEVEL_HANDS);

/** Where a tournament goes after hand `h`, its chips as it ended `chips` (chipsAfter). */
export function moveOn(h: Pick<PracticeHand, "players" | "hero" | "stacks"> & { tournament: HandTournament }, chips: Record<string, number>): MoveOn {
  const t = h.tournament;
  const pos = seatsOf(h.players);
  const start = h.stacks ?? {};
  const news: string[] = [];
  const paid = t.model === "icm" ? [...(t.payouts ?? [])] : [];
  let field = t.field && t.field.players > 0 ? { ...t.field } : undefined;
  // (a table seats what the first hand dealt: it starts full)
  const seats = t.seats ?? h.players;
  const before = leftOf(h.players, { field });

  // who's out: places from the bottom, the smaller starting stack first (lower)
  const out = pos.filter((p) => (chips[p] ?? 0) < 0.005).sort((a, b) => (start[a] ?? 0) - (start[b] ?? 0));
  const place: Record<string, number> = {};
  out.forEach((p, i) => (place[p] = before - i));
  const after = before - out.length;
  const prize = (p: string) => paid[place[p]! - 1];
  const name = (p: string) => (p === h.hero ? "You" : p);

  // bounties: a player out pays theirs to whoever won the most chips in the hand (KO: all of it in money; PKO: half,
  // and half onto the taker's own bounty)
  const bty = t.bounty ? { ...t.bounty, seats: { ...t.bounty.seats } } : undefined;
  let won = t.won ?? 0;
  const live = pos.filter((p) => !out.includes(p));
  const taker = live.reduce<string | undefined>((best, q) => ((chips[q] ?? 0) - (start[q] ?? 0) > (best ? (chips[best] ?? 0) - (start[best] ?? 0) : 0.005) ? q : best), undefined);
  const collect = (p: string) => {
    const v = bty?.seats[p] ?? 0;
    if (!bty || !taker || !(v > 0)) return;
    const money = bty.format === "pko" ? v / 2 : v;
    if (bty.format === "pko") bty.seats[taker] = r2((bty.seats[taker] ?? 0) + v / 2);
    if (taker === h.hero) won += money;
    const whose = p === h.hero ? "your" : `${p}'s`;
    news.push(
      `${name(taker)} ${taker === h.hero ? "take" : "takes"} ${whose} bounty, ${fmt(v)}${bty.format === "pko" ? `: ${fmt(money)} paid, ${fmt(v / 2)} onto ${taker === h.hero ? "yours" : "theirs"}` : ""}.`,
    );
  };
  const collected = () => (bty ? ` You collected ${fmt(won)} in bounties.` : "");

  for (const p of out.filter((q) => q !== h.hero)) {
    const paidOut = prize(p);
    news.push(`${name(p)} is out in ${ordinal(place[p]!)}${paidOut !== undefined ? `, paid ${fmt(paidOut)}` : ""}.`);
    collect(p);
  }
  if (out.includes(h.hero)) {
    const paidOut = prize(h.hero);
    collect(h.hero);
    news.push(
      `You're out in ${ordinal(place[h.hero]!)}${paidOut !== undefined ? `, paid ${fmt(paidOut)}` : paid.length ? `, out of the money (${paid.length} paid)` : ""}.${collected()} A new tournament starts from the setup.`,
    );
    return { table: null, news };
  }
  if (after <= 1) {
    // (the winner's own bounty is theirs too)
    const own = bty?.seats[h.hero] ?? 0;
    won += own;
    news.push(
      `You won the tournament${paid[0] !== undefined ? `: first place, ${fmt(paid[0])}` : ""}${own > 0 ? `, and your own bounty, ${fmt(own)}` : ""}.${collected()} A new tournament starts from the setup.`,
    );
    return { table: null, news };
  }

  // the button moves on: the seats in turn from the next button's, the busted ones' seats empty for now
  const b = buttonIndex(h.players);
  const turn = pos.map((_, k) => pos[(b + 1 + k) % pos.length]!);
  type Seat = { from: string; chips: number; bounty: number } | { empty: string };
  let seated: Seat[] = turn.map((p) => (out.includes(p) ? { empty: p } : { from: p, chips: chips[p]!, bounty: bty?.seats[p] ?? 0 }));

  // the blinds: a new level every LEVEL_HANDS hands, and the other tables lose players
  const played = (t.played ?? 0) + 1;
  let left = after;
  let rise = "";
  if (played % LEVEL_HANDS === 0) {
    seated = seated.map((s) => ("from" in s ? { ...s, chips: r2(s.chips / LEVEL_RISE) } : s));
    if (field) {
      const gone = field.players >= 2 ? Math.min(field.players - 1, Math.max(1, Math.round(field.players * FIELD_RATE))) : 0;
      const total = field.players * field.avg;
      field = { players: field.players - gone, avg: r2(total / (field.players - gone) / LEVEL_RISE) };
      left -= gone;
      if (gone) news.push(`${gone} ${gone === 1 ? "player is" : "players are"} out at the other tables.`);
    }
    rise = `The blinds go up (level ${played / LEVEL_HANDS + 1}): every stack is ${LEVEL_RISE}× fewer big blinds.`;
  }

  // the tables balanced: this one seats what its share of the players left is
  const here = seated.filter((s) => "from" in s).length;
  const want = balancedSize(here, field?.players ?? 0, seats);
  const merging = field && field.players > 0 && want === here + field.players;
  let joining = Math.max(0, want - here);
  seated = seated.flatMap((s) => {
    if ("from" in s) return [s];
    if (!joining || !field) return [];
    joining--;
    news.push(`A player from another table takes ${s.empty}'s seat with ${fmt(field.avg)}bb.`);
    const s2 = { from: "", chips: field.avg, bounty: bty?.field ?? 0 };
    field = field.players > 1 ? { players: field.players - 1, avg: field.avg } : undefined;
    return [s2];
  });
  while (joining > 0 && field) {
    joining--;
    news.push(`A player from another table joins with ${fmt(field.avg)}bb.`);
    seated.push({ from: "", chips: field.avg, bounty: bty?.field ?? 0 });
    field = field.players > 1 ? { players: field.players - 1, avg: field.avg } : undefined;
  }
  const sat = seated as { from: string; chips: number; bounty: number }[];
  while (sat.length > want) {
    // (the player due the big blind next moves, never you: your moving would only change who you face)
    let k = sat.length >= 3 ? 2 : 1;
    if (sat[k]!.from === h.hero) k = (k + 1) % sat.length;
    const [mover] = sat.splice(k, 1);
    const f: { players: number; avg: number } = field ?? { players: 0, avg: 0 };
    field = { players: f.players + 1, avg: r2((f.players * f.avg + mover!.chips) / (f.players + 1)) };
    news.push(`${mover!.from} moves to another table with ${fmt(mover!.chips)}bb, to balance the tables.`);
  }
  if (merging) news.push(`The last tables merge: a final table of ${sat.length}.`);
  else if (sat.length !== h.players) news.push(`The table is ${sat.length === 2 ? "heads-up" : `${sat.length}-handed`} now.`);
  if (rise) news.push(rise);

  const n = sat.length;
  const next = seatsOf(n);
  const nb = buttonIndex(n);
  const stacks: Record<string, number> = {};
  const bounties: Record<string, number> = {};
  let hero = "";
  sat.forEach((s, k) => {
    const seat = next[(nb + k) % n]!;
    stacks[seat] = s.chips;
    bounties[seat] = s.bounty;
    if (s.from === h.hero) hero = seat;
  });

  const payouts = paid.slice(0, left);
  if (paid.length < before && paid.length >= left) news.push(`The bubble bursts: ${left} left, all paid.`);
  const tournament: HandTournament = {
    model: t.model,
    ...(field || t.seats ? { seats } : {}),
    ...(t.model === "icm" ? { payouts } : {}),
    ...(field ? { field } : {}),
    ...(bty ? { bounty: { format: bty.format, seats: bounties, field: bty.field } } : {}),
    played,
    ...(won ? { won: r2(won) } : {}),
    ...(news.length ? { news } : {}),
  };
  return { table: { players: n, hero, stacks, tournament }, news };
}

/** A tournament's first hand after `news` (a restart): the setup's game, with what happened. */
export const restarted = (setup: TournamentOptions, news: string[]): HandTournament => {
  const game: HandTournament & Partial<TournamentOptions> = { ...setup };
  delete game.stacks;
  return { ...game, played: 0, ...(news.length ? { news } : {}) };
};
