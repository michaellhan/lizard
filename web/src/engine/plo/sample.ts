// A sample of the next street's cards, for a flop or turn too wide to solve on every card (engine/plo/flop/, turn/).
// The cards are picked, not drawn: the candidates in suit order, each suit by rank, every (N / K)th taken, so each suit
// gets its share and the ranks are spread. The sampled game is a smaller game: the next card is one of the K, and what's
// solved and measured is that game, exactly. How far its strategy is from the full game's is measured on spots that fit
// both (docs/ACCURACY.md section 15).
//
// The chance weights. In the full game a matchup that can be dealt sees every card that neither hand holds, each as
// likely: 1 / (N - 8) each. With a sample S of K cards, the matchup of hands i and j sees K - a_i - b_j of them, where a_i
// and b_j count the sampled cards each hand holds, and each should count 1 / (K - a_i - b_j). That weight doesn't split
// into a part for each hand, and the solver's sums run over one hand's opponents at a time, so the weight used is
//
//     w(i, j) = M / ((K - a_i - B) (K - b_j - A)),   A, B the ranges' average a and b, M = K - A - B,
//
// which splits (a scale for each hand), and is exact for every matchup in which either hand holds its range's average
// number of sampled cards: (K - a - B)(K - b - A) = M (K - a - b) + (a - A)(b - B). On the full deck every hand holds 4 of
// the N, so it's exact everywhere and equals 1 / (N - 8). Elsewhere a matchup's weights add to 1 less (a - A)(b - B) /
// ((K - a - B)(K - b - A)) instead of 1: `weightError` measures that over the matchups, weighted as they're dealt.
import { NUM_CARDS } from "./cards";
import { handAt } from "./combos";
import { addReach, blockedReach, SUBSETS } from "./river/blockers";
import type { Side } from "./river/game";

/** a sample this small could leave a matchup no card: K - a - B must stay above 0 with a and B up to 4 */
export const MIN_SAMPLE = 9;

/** `k` of `candidates`, spread by suit and rank (cards are rank * 4 + suit), in card order; all of them when k covers them.
 * `phase` (0 to 1, half by default) shifts where in each stretch the pick falls: another sample as evenly spread, to
 * measure how much the choice of sample moves a solve. */
export function pickCards(candidates: readonly number[], k: number, phase = 0.5): number[] {
  const n = candidates.length;
  if (k >= n) return [...candidates].sort((a, b) => a - b);
  const ordered = [...candidates].sort((a, b) => a % 4 - (b % 4) || b - a);
  const out: number[] = [];
  for (let i = 0; i < k; i++) out.push(ordered[Math.floor(((i + phase) * n) / k)]!);
  return out.sort((a, b) => a - b);
}

/** The cards that can come next on a board: every card off it. */
export const candidatesOf = (board: readonly number[]): number[] => Array.from({ length: NUM_CARDS }, (_, c) => c).filter((c) => !board.includes(c));

export interface WeightError {
  /** the largest |sum of a matchup's weights - 1| over matchups that can be dealt */
  max: number;
  /** that, averaged over the matchups as they're dealt */
  mean: number;
}

export interface CardSample {
  /** the cards in the sample */
  cards: number[];
  /** the cards that could come */
  of: number;
  /** each seat's scale by combo (this street's): a matchup's weight on a sampled card is the product of its hands' */
  scales: [Float64Array, Float64Array];
  error: WeightError;
}

const heldOf = (s: Side, inSample: Uint8Array) =>
  Int32Array.from(s.hands, (h) => {
    let a = 0;
    for (const c of handAt(h)) a += inSample[c]!;
    return a;
  });

const meanOf = (held: Int32Array, w: Float64Array) => {
  let t = 0;
  let total = 0;
  for (let i = 0; i < held.length; i++) {
    t += held[i]! * w[i]!;
    total += w[i]!;
  }
  return total > 0 ? t / total : 0;
};

/** The sample's scales for a street's two sides, and how far its weights are from exact. */
export function sampleOf(sides: readonly [Side, Side], cards: readonly number[], of: number, setCount: number): CardSample {
  const k = cards.length;
  const inSample = new Uint8Array(NUM_CARDS);
  for (const c of cards) inSample[c] = 1;
  const held: [Int32Array, Int32Array] = [heldOf(sides[0], inSample), heldOf(sides[1], inSample)];
  const avg = [meanOf(held[0], sides[0].weights), meanOf(held[1], sides[1].weights)] as const;
  const m = k - avg[0] - avg[1];
  const root = Math.sqrt(m);
  const scales: [Float64Array, Float64Array] = [Float64Array.from(held[0], (a) => root / (k - a - avg[1])), Float64Array.from(held[1], (b) => root / (k - b - avg[0]))];
  return { cards: [...cards], of, scales, error: weightError(sides, held, scales, k, setCount) };
}

/** How far each matchup's weights add from 1: (K - a - b) times its weight, less 1, over the matchups that can be dealt,
 * counted exactly class by class of b (the blocker sums of river/game.ts). */
function weightError(sides: readonly [Side, Side], held: [Int32Array, Int32Array], scales: [Float64Array, Float64Array], k: number, setCount: number): WeightError {
  const [a, b] = sides;
  const sum = new Float64Array(setCount);
  let max = 0;
  let total = 0;
  let off = 0;
  for (let cls = 0; cls <= 4; cls++) {
    sum.fill(0);
    let reach = 0;
    let scale = 0;
    for (let j = 0; j < b.n; j++)
      if (held[1][j] === cls) {
        addReach(sum, b.sets, j * SUBSETS, b.weights[j]!);
        reach += b.weights[j]!;
        scale = scales[1][j]!;
      }
    if (reach === 0) continue;
    for (let i = 0; i < a.n; i++) {
      const met = a.weights[i]! * (reach - blockedReach(sum, a.sets, i * SUBSETS));
      if (met <= 1e-12) continue;
      const dev = Math.abs((k - held[0][i]! - cls) * scales[0][i]! * scale - 1);
      max = Math.max(max, dev);
      off += met * dev;
      total += met;
    }
  }
  return { max, mean: total > 0 ? off / total : 0 };
}
