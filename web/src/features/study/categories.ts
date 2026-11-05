// The made-hand and draw categories of a hand on a flop or turn, in the page: solver/gto/breakdown.py's MADE, DRAWS,
// made_category and draw_category, so a drill filtered by a category means what Study's filter (filters.ts) and the
// engine's answers mean by it. Ids and labels are the engine's and a key is filters.ts's, "m:<id>" or "d:<id>". Cards
// are src/library/entry.ts's numbers: rank * 4 + suit. The river's "Plays the board" needs a hand evaluator and no drill
// reaches a river, so it's only in the list.
export const MADE: readonly (readonly [string, string])[] = [
  ["quads", "Quads or better"],
  ["full_house", "Full house"],
  ["flush", "Flush"],
  ["straight", "Straight"],
  ["set", "Set"],
  ["trips", "Trips"],
  ["two_pair", "Two pair"],
  ["overpair", "Overpair"],
  ["top_tk", "Top pair, top kicker"],
  ["top_gk", "Top pair, good kicker"],
  ["top_wk", "Top pair, weak kicker"],
  ["middle", "Middle pair"],
  ["weak", "Weak pair / underpair"],
  ["ace_high", "Ace high"],
  ["nothing", "No made hand"],
  ["board", "Plays the board"],
];
export const DRAWS: readonly (readonly [string, string])[] = [
  ["combo", "Combo draw"],
  ["fd", "Flush draw"],
  ["oesd", "Open-ended"],
  ["gutshot", "Gutshot"],
  ["backdoor", "Backdoor draw"],
  ["none", "No draw"],
];

// over 14 bits: bit 0 the ace played low, bit r + 1 rank r
const STRAIGHTS = Array.from({ length: 10 }, (_, i) => 0b11111 << i);

function rankBits(ranks: readonly number[]): number {
  let m = 0;
  for (const r of ranks) {
    m |= 1 << (r + 1);
    if (r === 12) m |= 1;
  }
  return m;
}
const hasStraight = (m: number) => STRAIGHTS.some((s) => (m & s) === s);
function topStraight(m: number): number {
  for (let i = STRAIGHTS.length - 1; i >= 0; i--) if ((m & STRAIGHTS[i]!) === STRAIGHTS[i]) return i;
  return -1;
}
function popcount(x: number): number {
  let n = 0;
  for (let v = x; v; v &= v - 1) n++;
  return n;
}
const countOf = (xs: readonly number[], x: number) => xs.reduce((n, y) => n + (y === x ? 1 : 0), 0);

/** 8 straight flush, 7 quads, 6 full house, 5 flush, 4 straight, 3 trips, 2 two pair, 1 pair, 0 high card */
function madeClass(cards: readonly number[]): number {
  const ranks = cards.map((c) => c >> 2);
  const suits = cards.map((c) => c & 3);
  const cnt = [...new Set(ranks)].map((r) => countOf(ranks, r)).sort((a, b) => b - a);
  const fl = [0, 1, 2, 3].find((s) => countOf(suits, s) >= 5);
  if (fl !== undefined && hasStraight(rankBits(cards.filter((c) => (c & 3) === fl).map((c) => c >> 2)))) return 8;
  if (cnt[0]! >= 4) return 7;
  if (cnt[0] === 3 && cnt.length > 1 && cnt[1]! >= 2) return 6;
  if (fl !== undefined) return 5;
  if (hasStraight(rankBits(ranks))) return 4;
  return cnt[0] === 3 ? 3 : cnt[0] === 2 && cnt.length > 1 && cnt[1] === 2 ? 2 : cnt[0] === 2 ? 1 : 0;
}

/** The made-hand category (an id of MADE) of two hole cards on a 3- or 4-card board (breakdown.made_category). */
export function madeCategory(hole: readonly [number, number], board: readonly number[]): string {
  const cls = madeClass([...hole, ...board]);
  const bcls = board.length >= 4 ? madeClass(board) : 0;
  // (the board's own quads are no one's)
  if (cls >= 4 && !(cls === 7 && bcls === 7)) return ({ 8: "quads", 7: "quads", 6: "full_house", 5: "flush", 4: "straight" } as Record<number, string>)[cls]!;
  const br = board.map((c) => c >> 2);
  const distinct = [...new Set(br)].sort((a, b) => b - a);
  const h1 = Math.max(hole[0] >> 2, hole[1] >> 2);
  const h2 = Math.min(hole[0] >> 2, hole[1] >> 2);
  if (h1 === h2) {
    if (br.includes(h1)) return "set";
    return h1 > distinct[0]! ? "overpair" : distinct.length > 1 && h1 > distinct[1]! ? "middle" : "weak";
  }
  const hit = [h1, h2].filter((r) => br.includes(r));
  if (hit.some((r) => countOf(br, r) >= 2)) return "trips";
  if (hit.length === 2) return "two_pair";
  if (hit.length) {
    const i = distinct.indexOf(hit[0]!);
    if (i === 0) {
      const kick = hit[0] === h1 ? h2 : h1;
      let better = 0; // better kickers left
      for (let r = kick + 1; r < 13; r++) if (!distinct.includes(r)) better++;
      return better === 0 ? "top_tk" : better <= 2 ? "top_gk" : "top_wk";
    }
    return i === 1 ? "middle" : "weak";
  }
  return h1 === 12 ? "ace_high" : "nothing";
}

/** The draw (an id of DRAWS) of two hole cards on a flop or turn (breakdown.draw_category). */
export function drawCategory(hole: readonly [number, number], board: readonly number[]): string {
  if (board.length >= 5) return "none";
  const cards = [...hole, ...board];
  const cls = madeClass(cards);
  const holeSuits = [...new Set(hole.map((c) => c & 3))];
  const suited = (n: number) => cls < 5 && holeSuits.some((s) => cards.reduce((k, c) => k + ((c & 3) === s ? 1 : 0), 0) === n);
  const fd = suited(4);
  const m = rankBits(cards.map((c) => c >> 2));
  const bm = rankBits(board.map((c) => c >> 2));
  let outs = 0;
  if (!hasStraight(m)) for (let r = 0; r < 13; r++) if (topStraight(m | rankBits([r])) > topStraight(bm | rankBits([r]))) outs++;
  const sd = outs >= 2 ? "oesd" : outs === 1 ? "gutshot" : null;
  if (fd && sd) return "combo";
  if (fd) return "fd";
  if (sd) return sd;
  if (board.length === 3) {
    const hm = rankBits(hole.map((c) => c >> 2));
    const bdsd = !hasStraight(m) && STRAIGHTS.some((w) => popcount(m & w) >= 3 && (m & w & hm) !== 0 && popcount(bm & w) < 3);
    if (suited(3) || bdsd) return "backdoor";
  }
  return "none";
}
