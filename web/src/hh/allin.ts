// A hand's all-in, for Analyze's all-in EV line: two players left, the betting closed (one of them all-in) with board
// cards still to come, and both their hands in the history (a showdown, or a site that shows every hand). Its EV is
// your equity there times the pot collected, less your stake: what the hand was worth before the cards to come. The
// equity is exact from the flop on (990 run-outs at most); preflop it's 20,000 boards drawn the same way each time
// for the same two hands (within about half a percent of the exact equity, 95% of the time). Anything else (three or
// more in, a hand not shown) has no all-in EV.
import { cmp, rank7 } from "@/poker/evaluate";
import { norm, type HhStreet, type ParsedHand } from "./parse";
import { collected, paidOf } from "./results";

export interface AllIn {
  street: Exclude<HhStreet, "river">;
  /** the other player, and the hand they showed */
  vs: string;
  cards: [string, string];
  /** the board as the betting closed */
  board: string[];
  equity: number;
  exact: boolean;
  /** your share of the pot at that equity less your stake, bb */
  ev: number;
}

/** Preflop all-ins: the boards drawn. */
export const SAMPLES = 20000;
const KNOWN: Record<AllIn["street"], number> = { preflop: 0, flop: 3, turn: 4 };
const DECK = [..."23456789TJQKA"].flatMap((r) => [..."shdc"].map((s) => r + s));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cardsIn = (s: string) => [...s.matchAll(/(10|[2-9TJQKA])([shdc])/gi)].map((m) => (m[1] === "10" ? "T" : m[1]!.toUpperCase()) + m[2]!.toLowerCase());

/** Each seat's hole cards where the history shows them: "Dealt to N [..]", "N: shows [..]", "Seat 1: N showed [..]". */
export function shownOf(h: ParsedHand, text: string): Record<string, [string, string]> {
  const out: Record<string, [string, string]> = {};
  const seats = [...h.seats].sort((a, b) => b.name.length - a.name.length);
  const res = seats.map((s) => ({
    pos: s.pos,
    re: [
      new RegExp(String.raw`^Dealt to ${esc(s.name)}\s*\[([^\]]*)\]`),
      new RegExp(String.raw`^${esc(s.name)}:? shows \[([^\]]*)\]`),
      new RegExp(String.raw`^Seat \d+: ${esc(s.name)}\b[^[]*showed \[([^\]]*)\]`),
    ],
  }));
  for (const l of norm(text, []).lines) {
    for (const { pos, re } of res) {
      const m = re.map((r) => l.match(r)).find(Boolean);
      if (!m) continue;
      const cs = cardsIn(m[1]!);
      if (cs.length === 2 && !out[pos]) out[pos] = [cs[0]!, cs[1]!];
      break;
    }
  }
  return out;
}

// (a small seeded generator, so a preflop all-in's equity is the same every time it's read)
function rng(seed: string) {
  let a = 2166136261;
  for (let i = 0; i < seed.length; i++) a = Math.imul(a ^ seed.charCodeAt(i), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Your equity against one hand on a board of 0, 3 or 4 cards (a tie counts half): exact with two cards or fewer to
 * come, else over `samples` boards drawn from a seed of the cards. */
export function equityVs(mine: readonly string[], theirs: readonly string[], board: readonly string[], samples = SAMPLES): { equity: number; exact: boolean } {
  const used = new Set([...mine, ...theirs, ...board]);
  const deck = DECK.filter((c) => !used.has(c));
  const need = 5 - board.length;
  let won = 0;
  let n = 0;
  const play = (rest: string[]) => {
    const b = [...board, ...rest];
    const d = cmp(rank7([...mine, ...b]), rank7([...theirs, ...b]));
    won += d > 0 ? 1 : d === 0 ? 0.5 : 0;
    n++;
  };
  if (need <= 2) {
    if (need === 0) play([]);
    else if (need === 1) for (const c of deck) play([c]);
    else for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) play([deck[i]!, deck[j]!]);
    return { equity: won / n, exact: true };
  }
  const r = rng([[...mine].sort().join(""), [...theirs].sort().join(""), board.join("")].join("|"));
  const d = [...deck];
  for (let k = 0; k < samples; k++) {
    // (the first `need` cards of a partial shuffle)
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(r() * (d.length - i));
      [d[i], d[j]] = [d[j]!, d[i]!];
    }
    play(d.slice(0, need));
  }
  return { equity: won / n, exact: false };
}

/** The hand's all-in, null where it has none (or it can't be told). */
export function allInOf(h: ParsedHand, text: string, pos: string = h.hero): AllIn | null {
  const folded = new Set(h.actions.filter((a) => a.act === "fold").map((a) => a.pos));
  const left = h.seats.map((s) => s.pos).filter((p) => !folded.has(p));
  if (left.length !== 2 || !left.includes(pos) || !h.actions.some((a) => a.allIn && left.includes(a.pos))) return null;
  const street = h.actions.at(-1)?.street;
  if (!street || street === "river") return null;
  const known = h.board.slice(0, KNOWN[street]);
  if (known.length < KNOWN[street]) return null;
  const vs = left.find((p) => p !== pos)!;
  const shown = shownOf(h, text);
  const mine = pos === h.hero ? (h.hole as [string, string]) : shown[pos];
  const theirs = shown[vs];
  if (!mine || !theirs || new Set([...mine, ...theirs, ...known]).size !== 4 + known.length) return null;
  const pot = h.seats.reduce((a, s) => a + (collected(text, s.name) ?? 0), 0) / h.bb;
  if (!(pot > 0)) return null;
  const { equity, exact } = equityVs(mine, theirs, known);
  return { street, vs, cards: theirs, board: known, equity, exact, ev: Math.round((equity * pot - (paidOf(h, text)[pos] ?? 0)) * 1e4) / 1e4 };
}
