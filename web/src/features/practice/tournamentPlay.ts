// A tournament session played out (Practice's "Play it out"): each hand starts from where the last one left the chips,
// the button moving on. A player with no chips is out: paid the lowest prize left if the players left are all paid (the
// prizes left then lose their last place), and replaced from the other tables at their average stack while any are
// left, else the table gets shorter. Every LEVEL_HANDS hands the blinds go up by LEVEL_RISE (every stack, and the other
// tables' average, worth that many fewer big blinds; the ante is a share of the big blind, so it rises with it), and
// the other tables lose FIELD_RATE of their players (whose chips stay among them). You out, or alone with every chip,
// and the next hand starts the setup over, with what happened in words.
//
// All of this is Lizard's own simplification of a tournament, said where the session shows it: no table balancing or
// merging (the other tables only ever feed this one), a bust's place from the stacks the hand started with, and the
// other tables' pace a fixed share a level.
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
  const before = leftOf(h.players, { field });

  // who's out: places from the bottom, the smaller starting stack first (lower)
  const out = pos.filter((p) => (chips[p] ?? 0) < 0.005).sort((a, b) => (start[a] ?? 0) - (start[b] ?? 0));
  const place: Record<string, number> = {};
  out.forEach((p, i) => (place[p] = before - i));
  const after = before - out.length;
  const prize = (p: string) => paid[place[p]! - 1];
  const name = (p: string) => (p === h.hero ? "You" : p);
  for (const p of out.filter((q) => q !== h.hero)) {
    const won = prize(p);
    news.push(`${name(p)} is out in ${ordinal(place[p]!)}${won !== undefined ? `, paid ${fmt(won)}` : ""}.`);
  }
  if (out.includes(h.hero)) {
    const won = prize(h.hero);
    news.push(
      `You're out in ${ordinal(place[h.hero]!)}${won !== undefined ? `, paid ${fmt(won)}` : paid.length ? `, out of the money (${paid.length} paid)` : ""}. A new tournament starts from the setup.`,
    );
    return { table: null, news };
  }
  if (after <= 1) {
    news.push(`You won the tournament${paid[0] !== undefined ? `: first place, ${fmt(paid[0])}` : ""}. A new tournament starts from the setup.`);
    return { table: null, news };
  }

  // the button moves on: the seats in turn from the next button's, the busted ones replaced or gone
  const b = buttonIndex(h.players);
  const turn = pos.map((_, k) => pos[(b + 1 + k) % pos.length]!);
  const seated: { from: string; chips: number }[] = [];
  for (const p of turn) {
    if (!out.includes(p)) seated.push({ from: p, chips: chips[p]! });
    else if (field && field.players > 0) {
      seated.push({ from: "", chips: field.avg });
      news.push(`A player from another table takes ${p}'s seat with ${fmt(field.avg)}bb.`);
      field = field.players > 1 ? { players: field.players - 1, avg: field.avg } : undefined;
    }
  }
  if (seated.length < h.players && out.length) news.push(`The table is ${seated.length === 2 ? "heads-up" : `${seated.length}-handed`} now.`);
  const n = seated.length;
  const next = seatsOf(n);
  const nb = buttonIndex(n);
  const stacks: Record<string, number> = {};
  let hero = "";
  seated.forEach((s, k) => {
    const seat = next[(nb + k) % n]!;
    stacks[seat] = s.chips;
    if (s.from === h.hero) hero = seat;
  });

  // the blinds: a new level every LEVEL_HANDS hands
  const played = (t.played ?? 0) + 1;
  let left = after;
  if (played % LEVEL_HANDS === 0) {
    for (const p of next) stacks[p] = r2(stacks[p]! / LEVEL_RISE);
    if (field) {
      const gone = field.players >= 2 ? Math.min(field.players - 1, Math.max(1, Math.round(field.players * FIELD_RATE))) : 0;
      const total = field.players * field.avg;
      field = { players: field.players - gone, avg: r2(total / (field.players - gone) / LEVEL_RISE) };
      left -= gone;
      if (gone) news.push(`${gone} ${gone === 1 ? "player is" : "players are"} out at the other tables.`);
    }
    news.push(`The blinds go up (level ${played / LEVEL_HANDS + 1}): every stack is ${LEVEL_RISE}× fewer big blinds.`);
  }
  const payouts = paid.slice(0, left);
  if (paid.length < before && paid.length >= left) news.push(`The bubble bursts: ${left} left, all paid.`);
  const tournament: HandTournament = {
    model: t.model,
    ...(t.model === "icm" ? { payouts } : {}),
    ...(field ? { field } : {}),
    played,
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
