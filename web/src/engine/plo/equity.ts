// PLO4 equity: each player's share of the pot over the boards still to come, nothing about how a hand should be played.
//
// Two methods, both step by step so a caller can run them in slices (equityRun.ts), resumable at any board:
//  - exact: every remaining board, for every matchup of the ranges (for two fixed hands one matchup), weighted by the
//    product of the hands' weights. A tie shares the pot equally. Counted in 2520ths of a pot, which keeps a fixed
//    matchup's tally in whole numbers, for 1 to 9 way ties;
//  - Monte Carlo: seeded, each run a matchup drawn from the ranges and a random completion of the board. A matchup
//    with a card in common is thrown out whole and drawn again, which is what weighting the matchups that can happen by
//    their weights means, and matches exact. The standard error is of the mean of the run's share.
//
// The speed comes from a table per hand: the hand's best with every three of the 52 cards, 22,100 values from 132,600
// five-card ones. A board's value for a hand is then the best of ten reads, a hundredth of the sixty hands it takes
// to work out. It costs a few milliseconds and 88 KB, so a hand gets one only when the hands in play are few enough.
import { seeded } from "@/poker/table";
import { choose, NUM_CARDS } from "./cards";
import { handAt } from "./combos";
import { bestOmaha, eval5 } from "./evaluate";
import { rangeSize, withoutBlocked, type PloRange } from "./ranges";

/** a pot, in units that divide by every number of winners up to 9 */
export const POT_UNITS = 2520;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 9;

/** how many hands may have a table (88 KB each: 45 MB) */
export const MAX_TABLES = 512;
/** matchups times boards that "auto" counts in full (some seconds); more is a Monte Carlo */
export const AUTO_EXACT_LIMIT = 5e7;
/** the same asked for outright */
export const EXACT_LIMIT = 1e9;
export const DEFAULT_RUNS = 200_000;
/** draws in a row that may all hold a card in common before the ranges are called out of reach of each other */
const MAX_REJECTS = 100_000;

export type EquityMode = "auto" | "exact" | "montecarlo";

export interface EquitySpec {
  players: PloRange[];
  board: number[];
  dead?: number[];
  mode?: EquityMode;
  /** Monte Carlo runs to make */
  runs?: number;
  seed?: number;
  /** false: work out each hand from its sixty, as with too many hands for tables (tests hold the two ways together) */
  tables?: boolean;
}

export interface PlayerEquity {
  /** share of the pot, 0..1 */
  equity: number;
  /** of `equity`: one standard error, 0 for an exact count */
  stderr: number;
  /** wins the pot alone, 0..1 */
  win: number;
  /** shares it, 0..1 */
  tie: number;
}

export interface EquityResult {
  method: "exact" | "montecarlo";
  /** every board was counted, or every run asked for was made */
  complete: boolean;
  /** boards counted, over all matchups (exact), or runs made (Monte Carlo) */
  runouts: number;
  /** of `planned` */
  planned: number;
  /** matchups counted (exact) */
  matchups: number;
  /** Monte Carlo draws thrown out for a card in common */
  rejected: number;
  seed: number | null;
  players: PlayerEquity[];
  /** the raw tally: boards won alone, boards tied and pot units, each by player, weighted for ranges */
  counts: { wins: number[]; ties: number[]; units: number[]; weight: number };
}

// tripleIndex: colexicographic, for a < b < c
const C2 = Int32Array.from({ length: NUM_CARDS }, (_, n) => choose(n, 2));
const C3 = Int32Array.from({ length: NUM_CARDS }, (_, n) => choose(n, 3));
const NUM_TRIPLES = choose(NUM_CARDS, 3);

/** A hand's best with every three cards. Triples holding one of its own cards are nonsense, and never read. */
function strengthTable(hole: ArrayLike<number>): Int32Array {
  const t = new Int32Array(NUM_TRIPLES);
  for (let i = 0; i < 3; i++)
    for (let j = i + 1; j < 4; j++) {
      const x = hole[i]!;
      const y = hole[j]!;
      let k = 0;
      for (let c = 2; c < NUM_CARDS; c++)
        for (let b = 1; b < c; b++)
          for (let a = 0; a < b; a++) {
            const v = eval5(x, y, a, b, c);
            if (v > t[k]!) t[k] = v;
            k++;
          }
    }
  return t;
}

/** Ten triple indices of a sorted board. */
function triplesOf(b: Int32Array, out: Int32Array): void {
  const p = b[0]!;
  const q = b[1]!;
  const r = b[2]!;
  const s = b[3]!;
  const u = b[4]!;
  const s2 = C2[s]!;
  const r2 = C2[r]!;
  const q2 = C2[q]!;
  const r3 = C3[r]!;
  const s3 = C3[s]!;
  const u3 = C3[u]!;
  out[0] = r3 + q2 + p;
  out[1] = s3 + q2 + p;
  out[2] = s3 + r2 + p;
  out[3] = s3 + r2 + q;
  out[4] = u3 + q2 + p;
  out[5] = u3 + r2 + p;
  out[6] = u3 + r2 + q;
  out[7] = u3 + s2 + p;
  out[8] = u3 + s2 + q;
  out[9] = u3 + s2 + r;
}

function sort5(b: Int32Array): void {
  for (let i = 1; i < 5; i++) {
    const x = b[i]!;
    let j = i - 1;
    while (j >= 0 && b[j]! > x) {
      b[j + 1] = b[j]!;
      j--;
    }
    b[j + 1] = x;
  }
}

/** One seat's hands as cards, with what's needed to draw from them by weight. */
class Seat {
  readonly n: number;
  readonly cards: Uint8Array;
  readonly weights: Float32Array;
  readonly cumulative: Float64Array;
  constructor(r: PloRange) {
    this.n = rangeSize(r);
    this.weights = r.weights;
    this.cards = new Uint8Array(this.n * 4);
    this.cumulative = new Float64Array(this.n);
    let t = 0;
    for (let k = 0; k < this.n; k++) {
      this.cards.set(handAt(r.hands[k]!), k * 4);
      t += r.weights[k]!;
      this.cumulative[k] = t;
    }
  }
  /** a hand, by weight: the first whose running total passes u * total */
  pick(u: number): number {
    if (this.n === 1) return 0;
    const x = u * this.cumulative[this.n - 1]!;
    let lo = 0;
    let hi = this.n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cumulative[mid]! > x) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }
}

export class EquityError extends Error {}

/** One calculation, from which `step` takes bites; `result` reads off where it stands. */
export class EquityJob {
  readonly method: "exact" | "montecarlo";
  readonly planned: number;
  readonly seed: number | null;
  done = false;
  private readonly seats: Seat[];
  private readonly board: number[];
  private readonly used = new Uint8Array(NUM_CARDS);
  private readonly n: number;
  private readonly wins: Float64Array;
  private readonly ties: Float64Array;
  private readonly units: Float64Array;
  private readonly squares: Float64Array;
  private weight = 0;
  private runouts = 0;
  private matchups = 0;
  private rejected = 0;
  private readonly useTables: boolean;
  /** each seat's tables, by its hand, as they're needed */
  private readonly tables: (Int32Array | undefined)[][];
  private readonly row: (Int32Array | null)[];
  private readonly picks: Int32Array;
  private readonly full = new Int32Array(5);
  private readonly triples = new Int32Array(10);
  private readonly values: Int32Array;
  private readonly fullView: number[] = [0, 0, 0, 0, 0];
  private readonly rnd: () => number;
  // where an exact count stands
  private live = new Int32Array(0);
  private combo = new Int32Array(0);
  private inMatchup = false;
  private moreMatchups = true;
  private matchupWeight = 1;

  constructor(spec: EquitySpec) {
    const { players, board } = spec;
    const dead = spec.dead ?? [];
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) throw new EquityError(`Equity is for ${MIN_PLAYERS} to ${MAX_PLAYERS} players.`);
    if (![0, 3, 4, 5].includes(board.length)) throw new EquityError("A board is 0, 3, 4 or 5 cards.");
    const out = [...board, ...dead];
    if (new Set(out).size !== out.length) throw new EquityError("The same card is out twice.");
    // a seat of one hand is as good as dead cards to every other seat
    const fixed = players.filter((r) => rangeSize(r) === 1).flatMap((r) => [...handAt(r.hands[0]!)]);
    if (new Set(fixed).size !== fixed.length) throw new EquityError("Two hands hold the same card.");
    this.seats = players.map((r, i) => {
      const others = players.flatMap((o, j) => (j !== i && rangeSize(o) === 1 ? [...handAt(o.hands[0]!)] : []));
      const left = withoutBlocked(r, [...out, ...others]);
      if (!rangeSize(left)) throw new EquityError(`Player ${i + 1} has no hand left with these cards out.`);
      return new Seat(left);
    });
    this.board = board;
    for (const c of out) this.used[c] = 1;
    const n = (this.n = players.length);
    this.wins = new Float64Array(n);
    this.ties = new Float64Array(n);
    this.units = new Float64Array(n);
    this.squares = new Float64Array(n);
    this.tables = this.seats.map((s) => new Array<Int32Array | undefined>(s.n));
    this.row = new Array<Int32Array | null>(n).fill(null);
    this.picks = new Int32Array(n);
    this.values = new Int32Array(n);

    const matchups = this.seats.reduce((m, s) => m * s.n, 1);
    const boards = choose(NUM_CARDS - out.length - 4 * n, 5 - board.length);
    const distinct = this.seats.reduce((m, s) => m + s.n, 0);
    const cost = matchups * boards;
    const fits = distinct <= MAX_TABLES;
    const mode = spec.mode ?? "auto";
    if (mode === "exact" && (!fits || cost > EXACT_LIMIT))
      throw new EquityError(`Too much to count in full: ${matchups.toLocaleString("en-US")} matchups over ${boards.toLocaleString("en-US")} boards. Use Monte Carlo.`);
    this.method = mode === "exact" || (mode === "auto" && fits && cost <= AUTO_EXACT_LIMIT) ? "exact" : "montecarlo";
    this.useTables = fits && spec.tables !== false;
    if (this.method === "exact") {
      this.planned = cost; // (at most: matchups with a card in common aren't played)
      this.seed = null;
      this.rnd = () => 0;
      this.picks[n - 1] = -1;
    } else {
      this.planned = spec.runs ?? DEFAULT_RUNS;
      if (!(this.planned > 0)) throw new EquityError("Monte Carlo needs at least one run.");
      this.seed = spec.seed ?? 1;
      this.rnd = seeded(this.seed);
    }
  }

  /** Up to `budget` boards more. True when the job is finished. */
  step(budget: number): boolean {
    if (this.done) return true;
    if (this.method === "exact") this.stepExact(budget);
    else this.stepMonteCarlo(budget);
    return this.done;
  }

  /** The seat's table for hand k; true if it had to be built. */
  private loadTable(seat: number, k: number): boolean {
    let t = this.tables[seat]![k];
    const built = !t;
    if (!t) {
      const c = k * 4;
      t = this.tables[seat]![k] = strengthTable(this.seats[seat]!.cards.subarray(c, c + 4));
    }
    this.row[seat] = t;
    return built;
  }

  /** Tally the board in `full` (any order) for the hands in `picks`. */
  private scoreBoard(weight: number): void {
    const { full, n, values, row } = this;
    if (this.useTables) {
      sort5(full);
      const t = this.triples;
      triplesOf(full, t);
      for (let i = 0; i < n; i++) {
        const r = row[i]!;
        let best = 0;
        for (let k = 0; k < 10; k++) {
          const v = r[t[k]!]!;
          if (v > best) best = v;
        }
        values[i] = best;
      }
    } else {
      const view = this.fullView;
      for (let k = 0; k < 5; k++) view[k] = full[k]!;
      for (let i = 0; i < n; i++) {
        const c = this.picks[i]! * 4;
        const cards = this.seats[i]!.cards;
        values[i] = bestOmaha(cards.subarray(c, c + 4), view);
      }
    }
    let top = -1;
    let winners = 0;
    for (let i = 0; i < n; i++) {
      const v = values[i]!;
      if (v > top) {
        top = v;
        winners = 1;
      } else if (v === top) winners++;
    }
    const share = POT_UNITS / winners;
    for (let i = 0; i < n; i++)
      if (values[i] === top) {
        this.units[i]! += share * weight;
        if (winners === 1) this.wins[i]! += weight;
        else this.ties[i]! += weight;
        this.squares[i]! += (weight * share * share) / (POT_UNITS * POT_UNITS);
      }
    this.weight += weight;
    this.runouts++;
  }

  /** On to the next matchup with no card in common; false when there are none. */
  private nextMatchup(): boolean {
    const { n, picks, seats } = this;
    for (;;) {
      let i = n - 1;
      while (i >= 0 && picks[i]! + 1 >= seats[i]!.n) picks[i--] = 0;
      if (i < 0) return false;
      picks[i]!++;
      const hit = new Uint8Array(this.used);
      let clash = false;
      let weight = 1;
      for (let p = 0; p < n && !clash; p++) {
        const s = seats[p]!;
        const k = picks[p]!;
        weight *= s.weights[k]!;
        for (let c = 0; c < 4; c++) {
          const card = s.cards[k * 4 + c]!;
          if (hit[card]) clash = true;
          hit[card] = 1;
        }
      }
      if (clash) continue;
      const live: number[] = [];
      for (let c = 0; c < NUM_CARDS; c++) if (!hit[c]) live.push(c);
      this.live = Int32Array.from(live);
      this.matchupWeight = weight;
      const k = 5 - this.board.length;
      this.combo = Int32Array.from({ length: k }, (_, x) => x);
      return true;
    }
  }

  private stepExact(budget: number): void {
    const k = 5 - this.board.length;
    const nb = this.board.length;
    let left = budget;
    while (left > 0) {
      if (!this.inMatchup) {
        if (!this.moreMatchups || !this.nextMatchup()) {
          this.moreMatchups = false;
          this.done = true;
          if (this.weight === 0) throw new EquityError("Every matchup of these ranges has a card in common.");
          return;
        }
        this.inMatchup = true;
        this.matchups++;
        if (this.useTables) for (let i = 0; i < this.n; i++) if (this.loadTable(i, this.picks[i]!)) left -= 2000; // (a table's cost, in boards)
      }
      const { combo, live, full } = this;
      const m = live.length;
      const weight = this.matchupWeight;
      while (left > 0) {
        for (let x = 0; x < k; x++) full[nb + x] = live[combo[x]!]!;
        for (let x = 0; x < nb; x++) full[x] = this.board[x]!;
        this.scoreBoard(weight);
        left--;
        let i = k - 1;
        while (i >= 0 && combo[i] === m - k + i) i--;
        if (i < 0) {
          this.inMatchup = false;
          break;
        }
        combo[i]!++;
        for (let j = i + 1; j < k; j++) combo[j] = combo[j - 1]! + 1;
      }
    }
  }

  private stepMonteCarlo(budget: number): void {
    const { n, seats, used, picks, full, rnd, board } = this;
    const nb = board.length;
    const runs = Math.min(budget, this.planned - this.runouts);
    for (let run = 0; run < runs; run++) {
      // the hands
      let misses = 0;
      for (;;) {
        let placed = 0;
        let clash = false;
        for (; placed < n && !clash; placed++) {
          const s = seats[placed]!;
          const k = s.pick(rnd());
          picks[placed] = k;
          for (let c = 0; c < 4; c++) if (used[s.cards[k * 4 + c]!]) clash = true;
          // (each hand's cards are different, so marking after the check is enough; a clash leaves this hand unmarked)
          if (!clash) for (let c = 0; c < 4; c++) used[s.cards[k * 4 + c]!] = 1;
        }
        if (!clash) break;
        placed -= 2; // the last one placed in full
        for (; placed >= 0; placed--) {
          const s = seats[placed]!;
          const k = picks[placed]!;
          for (let c = 0; c < 4; c++) used[s.cards[k * 4 + c]!] = 0;
        }
        this.rejected++;
        if (++misses >= MAX_REJECTS) {
          this.done = true;
          throw new EquityError("These ranges hardly ever fit together without a card in common.");
        }
      }
      // the board
      for (let x = 0; x < nb; x++) full[x] = board[x]!;
      for (let x = nb; x < 5; x++) {
        let c: number;
        do c = Math.floor(rnd() * NUM_CARDS);
        while (used[c]);
        used[c] = 1;
        full[x] = c;
      }
      if (this.useTables) for (let i = 0; i < n; i++) this.loadTable(i, picks[i]!);
      // (unmark first: a sorted `full` loses which cards were drawn)
      for (let x = nb; x < 5; x++) used[full[x]!] = 0;
      for (let i = 0; i < n; i++) {
        const s = seats[i]!;
        const k = picks[i]!;
        for (let c = 0; c < 4; c++) used[s.cards[k * 4 + c]!] = 0;
      }
      this.scoreBoard(1);
    }
    if (this.runouts >= this.planned) this.done = true;
  }

  result(): EquityResult {
    const w = this.weight;
    const pot = w * POT_UNITS;
    const players: PlayerEquity[] = [];
    for (let i = 0; i < this.n; i++) {
      const equity = pot ? this.units[i]! / pot : 0;
      let stderr = 0;
      if (this.method === "montecarlo" && this.runouts > 1) {
        const variance = Math.max(0, this.squares[i]! / w - equity * equity);
        stderr = Math.sqrt(variance / (w - 1));
      }
      players.push({ equity, stderr, win: w ? this.wins[i]! / w : 0, tie: w ? this.ties[i]! / w : 0 });
    }
    return {
      method: this.method,
      complete: this.done,
      runouts: this.runouts,
      planned: this.method === "exact" && this.done ? this.runouts : this.planned,
      matchups: this.matchups,
      rejected: this.rejected,
      seed: this.seed,
      players,
      counts: { wins: [...this.wins], ties: [...this.ties], units: [...this.units], weight: w },
    };
  }
}

/** What produced a result, as it's shown beside the numbers. */
export function describeEquity(r: EquityResult): string {
  const n = r.runouts.toLocaleString("en-US");
  if (r.method === "exact") {
    const of = r.matchups > 1 ? ` across ${r.matchups.toLocaleString("en-US")} matchups, weighted` : "";
    return r.complete ? `Exact: every board counted, ${n} boards${of}.` : `Exact count unfinished, ${n} boards so far: not a result yet.`;
  }
  const short = r.complete ? "" : `, stopped at ${n} of ${r.planned.toLocaleString("en-US")}`;
  return `Monte Carlo: ${n} random runouts${short}, seed ${r.seed}; ± is one standard error.`;
}
