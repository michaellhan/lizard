// The engine's prize model in the page (a port of solver/gto/icm.py: equities, field_stacks, compress_payouts and
// Model's base, after and bubble_factor): Malmuth-Harville over at most 12 players, a bigger field stood in for by
// groups of the other tables' players with the payouts spread over them. An answer's tournament block gives the
// bubble factor of the player to act against each opponent only; this gives it for every pair (ROADMAP Phase 7), from
// the setup, with the same numbers (icm.test.ts pins them to the engine's). Bounties don't enter a bubble factor.
import { seatsOf } from "@/poker/seats";
import type { SpotSetup } from "@/features/solve/setup";

export const MAX_PLAYERS = 12;

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** Equities of players with stacks s (all > 0) for places paying pay (pay.length <= s.length): the chance each set of
 * players took the places so far, a bit mask in increasing order (each set's own subsets come before it). */
function mh(s: readonly number[], pay: readonly number[]): number[] {
  const n = s.length;
  const total = sum(s);
  const eq = new Array<number>(n).fill(0);
  const prob = new Float64Array(1 << n);
  const held = new Float64Array(1 << n);
  const placed = new Uint8Array(1 << n);
  prob[0] = 1;
  for (let mask = 0; mask < 1 << n; mask++) {
    const k = placed[mask]!;
    const p = prob[mask]!;
    if (k >= pay.length || p === 0) continue;
    const left = total - held[mask]!;
    for (let i = 0; i < n; i++) {
      const bit = 1 << i;
      if (mask & bit) continue;
      const q = (p * s[i]!) / left;
      eq[i]! += pay[k]! * q;
      const m = mask | bit;
      prob[m]! += q;
      held[m] = held[mask]! + s[i]!;
      placed[m] = k + 1;
    }
  }
  return eq;
}

/** Each player's prize equity (in the payouts' units) by Malmuth-Harville; a player with no chips gets the payouts
 * below everyone still in, shared equally (icm.py equities). */
export function equities(stacks: readonly number[], payouts: readonly number[]): number[] {
  const n = stacks.length;
  if (n > MAX_PLAYERS) throw new Error(`ICM over ${n} players: at most ${MAX_PLAYERS}`);
  const alive = stacks.flatMap((x, i) => (x > 1e-12 ? [i] : []));
  const out = new Array<number>(n).fill(0);
  const k = alive.length;
  // (a place paying nothing adds nothing: the paid ones are enough)
  const places = payouts.slice(0, k);
  while (places.length && places[places.length - 1]! <= 0) places.pop();
  if (k === 0) return out;
  if (k === 1) out[alive[0]!] = places[0] ?? 0;
  else mh(alive.map((i) => stacks[i]!), places).forEach((e, j) => (out[alive[j]!] = e));
  const dead = stacks.flatMap((x, i) => (x <= 1e-12 ? [i] : []));
  if (dead.length && payouts.length > k) for (const i of dead) out[i] = sum(payouts.slice(k, k + dead.length)) / dead.length;
  return out;
}

/** The other tables' players for the model: `groups` stand-ins, each the average stack of an equal share of them by
 * size (the biggest first), when there are more than that. */
export function fieldStacks(others: readonly number[], groups: number): number[] {
  const o = others.filter((x) => x > 0).sort((a, b) => b - a);
  if (o.length <= groups) return o;
  return Array.from({ length: groups }, (_, g) => {
    const part = o.slice(Math.floor((g * o.length) / groups), Math.floor(((g + 1) * o.length) / groups));
    return sum(part) / part.length;
  });
}

/** Payouts for a model of modelPlayers standing in for players: model place j pays the average of the real places it
 * covers, so the money starts the same share of the way down the field. */
export function compressPayouts(payouts: readonly number[], players: number, modelPlayers: number): number[] {
  const pay = [...payouts].sort((a, b) => b - a);
  while (pay.length < players) pay.push(0);
  const r = players / modelPlayers;
  const out: number[] = [];
  for (let j = 0; j < modelPlayers; j++) {
    const lo = j * r;
    const hi = (j + 1) * r;
    let tot = 0;
    for (let k = Math.floor(lo); k < Math.min(Math.ceil(hi), players); k++) tot += pay[k]! * (Math.min(hi, k + 1) - Math.max(lo, k));
    out.push(tot / r);
  }
  while (out.length && out[out.length - 1]! <= 1e-12) out.pop();
  return out;
}

export interface IcmModel {
  seats: string[];
  /** bb behind at the start of the hand */
  stacks: Record<string, number>;
  /** the other tables' stand-ins */
  field: number[];
  payouts: number[];
  /** the real prizes left (equity shares are of these) */
  realPool: number;
  /** players left, the table's and every other table's */
  players: number;
  /** more players than the model's 12: the field stood in for */
  approx: boolean;
  base: Record<string, number>;
}

export function icmModel(stacks: Record<string, number>, payouts: readonly number[], others: readonly number[] = []): IcmModel {
  const seats = Object.keys(stacks);
  const o = others.filter((x) => x > 0);
  const pay = payouts.filter((x) => x > 0).sort((a, b) => b - a);
  if (!pay.length) throw new Error("payouts: at least one prize");
  const players = seats.length + o.length;
  const field = fieldStacks(o, Math.max(0, MAX_PLAYERS - seats.length));
  const nModel = seats.length + field.length;
  const approx = players > nModel;
  const m: IcmModel = {
    seats,
    stacks: { ...stacks },
    field,
    payouts: approx ? compressPayouts(pay.slice(0, players), players, nModel) : pay.slice(0, nModel),
    realPool: sum(pay.slice(0, players)),
    players,
    approx,
    base: {},
  };
  m.base = equityOf(m, m.stacks);
  return m;
}

function equityOf(m: IcmModel, stacks: Record<string, number>): Record<string, number> {
  const e = equities([...m.seats.map((p) => Math.max(stacks[p] ?? 0, 0)), ...m.field], m.payouts);
  return Object.fromEntries(m.seats.map((p, i) => [p, e[i]!]));
}

/** What hero risks against villain over what hero gains, in prize equity per chip, all in for the shorter stack:
 * Infinity where a chip won gains nothing. */
export function bubbleFactor(m: IcmModel, hero: string, villain: string): number {
  const x = Math.min(m.stacks[hero]!, m.stacks[villain]!);
  if (x <= 0) return 1;
  const end = (winner: string) => equityOf(m, { ...m.stacks, [hero]: m.stacks[hero]! - x + (winner === hero ? 2 * x : 0), [villain]: m.stacks[villain]! - x + (winner === villain ? 2 * x : 0) })[hero]!;
  const win = end(hero) - m.base[hero]!;
  const lose = m.base[hero]! - end(villain);
  return win > 1e-12 ? lose / win : Infinity;
}

/** The table of every pair (row: the seat risking chips; null where a chip won gains nothing), and each seat's share
 * of the prizes left. */
export interface BubbleTable {
  seats: string[];
  share: Record<string, number>;
  bf: Record<string, Record<string, number | null>>;
  players: number;
  /** the players the model holds (the table's and the field's stand-ins) */
  modelled: number;
  approx: boolean;
}

export function bubbleTable(m: IcmModel): BubbleTable {
  const bf = Object.fromEntries(
    m.seats.map((h) => [h, Object.fromEntries(m.seats.filter((v) => v !== h).map((v) => [v, ((b) => (Number.isFinite(b) ? b : null))(bubbleFactor(m, h, v))]))]),
  );
  return {
    seats: m.seats,
    share: Object.fromEntries(m.seats.map((p) => [p, m.base[p]! / m.realPool])),
    bf,
    players: m.players,
    modelled: m.seats.length + m.field.length,
    approx: m.approx,
  };
}

/** The table for a spot's setup as the engine builds its model (advisor.py _tournament): every seat at its stack
 * (the table's unless set), the other tables evenly, the payouts no more than the players left. null without two or
 * more prizes (winner-takes-all: every bubble factor is 1) or a stack or payout that isn't a number yet. */
export function bubbleTableOf(players: number, stack: number, setup: SpotSetup | undefined): BubbleTable | null {
  const t = setup?.tournament;
  const pay = (t?.payouts ?? []).filter((x) => x > 0);
  const f = t?.field && t.field.players > 0 ? t.field : null;
  const others = f ? Array<number>(f.players).fill(f.avg) : [];
  const stacks = Object.fromEntries(seatsOf(players).map((p) => [p, setup?.stacks?.[p] ?? stack]));
  if ([...pay, ...Object.values(stacks), ...others].some((x) => !Number.isFinite(x)) || Object.values(stacks).some((x) => x <= 0)) return null;
  const kept = pay.slice(0, players + others.length);
  if (kept.length <= 1) return null;
  return bubbleTable(icmModel(stacks, kept, others));
}
