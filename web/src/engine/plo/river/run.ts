// A river solve without holding up the page: iterations in slices, a turn of the event loop between them, so a cancel gets
// read, in river.worker.ts (the normal way) or on the page where a browser has no worker. The request is text, as an
// equity job's: parsing a range sweeps the hands, so that's done on this side too.
//
// A solve stops at the first of: the exploitability target, the time budget, the iteration limit, a cancel. Whichever it
// is, the numbers handed back are the average strategy at that point with its exploitability measured then.
//
// The limits are refusals, not quiet cuts: nothing here samples or buckets a range to fit. Both are set from what
// measure.test.ts measured (docs/FEATURE_MATRIX.md row PLO4). MAX_WORK holds an iteration to about a second on the machine
// measured, so a cancel is read soon: a spot's work is its combos times its terminal nodes, as that's what an iteration
// costs, at 32 to 43 ns a unit. Every hand there is on a river, 178,365 a side, fits under it on a small tree, and 126,005
// a side on the largest tree took 896 ms an iteration and 408 MB of the 512. Memory is the stores' bound: the process around
// them measured 744 MB resident on that spot, in Node.
import { cardsText, parseIds } from "../cards";
import { parseRange, type PloRange } from "../ranges";
import { compileTurn, type TurnGame, type TurnSpec } from "../turn/game";
import { TurnSolver, turnMemoryBytes, turnWork } from "../turn/solver";
import { compileGame, RiverError, type RiverGame, type RiverSpec } from "./game";
import { memoryBytes, RiverSolver, type Exploitability, type NodeReport } from "./solver";
import type { RiverAction, RiverNode, RiverSizes } from "./tree";

export const MAX_WORK = 25e6;
/** a turn's limit in the same units: a unit there cost 85 to 100 ns (the rivers are many small games, each mapped to the
 * turn's combos), so 11.9 million units (AAxx,KKxx,QQxx against JT98,JT97,T987 on Js9s4d2h, a size a street) took 1.0 to
 * 1.2 s an iteration and 165 MB in Node; AAxx against JT98 there reached 0.29% of the pot in 50 iterations, 15 s */
export const MAX_TURN_WORK = 12e6;
export const MAX_MEMORY_BYTES = 512e6;
export const DEFAULT_TARGET_PCT = 0.1;
export const MIN_TARGET_PCT = 0.001;
export const DEFAULT_SECONDS = 30;
export const MAX_SECONDS = 600;
export const DEFAULT_MAX_ITERATIONS = 100_000;
/** the first look at exploitability, and how far apart looks are: each costs about an iteration */
const FIRST_CHECK = 8;
const CHECK_GROWTH = 1.3;

export const SEAT_NAMES = ["OOP", "IP"] as const;

export interface RiverRequest {
  /** each seat's range, as parseRange reads them: out of position, then in position */
  oop: string;
  ip: string;
  /** five cards for a river; four for a turn, every river card after it solved too (engine/plo/turn/) */
  board: string;
  pot: number;
  stacks: [number, number];
  /** the first street's sizes: the river's, or the turn's */
  sizes: RiverSizes;
  /** a turn's river sizes */
  riverSizes?: RiverSizes;
  /** exploitability to stop at, % of the pot */
  targetPct?: number;
  /** seconds to stop at */
  seconds?: number;
  maxIterations?: number;
}

export interface RiverJobSpec {
  spec: RiverSpec | (TurnSpec & { turn: true });
  targetPct: number;
  seconds: number;
  maxIterations: number;
}

/** The spec of a request, or what's wrong with it. */
export function specOf(req: RiverRequest): RiverJobSpec | string {
  const board = parseIds(req.board);
  if (!board || (board.length !== 5 && board.length !== 4)) return "The board is five cards for a river, four for a turn: Qs7d2c9h3s, for one.";
  const turn = board.length === 4;
  if (turn && !req.riverSizes) return "A turn needs the river's sizes too.";
  const ranges: PloRange[] = [];
  for (const [i, text] of [req.oop, req.ip].entries()) {
    const r = parseRange(text, board);
    if (typeof r === "string") return `${SEAT_NAMES[i]}: ${r}`;
    ranges.push(r);
  }
  const targetPct = req.targetPct ?? DEFAULT_TARGET_PCT;
  if (!(targetPct >= MIN_TARGET_PCT)) return `The target is at least ${MIN_TARGET_PCT}% of the pot.`;
  const seconds = req.seconds ?? DEFAULT_SECONDS;
  if (!(seconds > 0 && seconds <= MAX_SECONDS)) return `The time budget is over 0 seconds, up to ${MAX_SECONDS}.`;
  const both: [PloRange, PloRange] = [ranges[0]!, ranges[1]!];
  return {
    spec: turn
      ? { turn: true, board, ranges: both, pot: req.pot, stacks: req.stacks, turnSizes: req.sizes, riverSizes: req.riverSizes! }
      : { board, ranges: both, pot: req.pot, stacks: req.stacks, sizes: req.sizes },
    targetPct,
    seconds,
    maxIterations: req.maxIterations ?? DEFAULT_MAX_ITERATIONS,
  };
}

export type StopReason = "target" | "time" | "iterations" | "cancelled";

export interface RiverProgress {
  iterations: number;
  seconds: number;
  /** at the last look, null before the first */
  exploitabilityPct: number | null;
}

export interface ResultNode extends NodeReport {
  /** the line in words: "" at the root */
  line: string;
  actions: RiverAction[];
}

export interface RiverResult {
  /** what was solved: a river, or a turn with every river after it */
  street: "river" | "turn";
  stop: StopReason;
  iterations: number;
  seconds: number;
  targetPct: number;
  exploitability: Exploitability;
  /** the bound the solve was held to, bytes */
  memoryBytes: number;
  pot: number;
  /** the shorter stack, the one that plays */
  stack: number;
  board: string;
  /** the first street's sizes */
  sizes: RiverSizes;
  /** a turn's: the river's sizes, and the river cards with a game (a card on which no matchup can be dealt has none) */
  riverSizes?: RiverSizes;
  rivers?: number;
  /** a turn's: where its betting closes, each a line to look at the river after (`RiverJob.riverView`), and the river
   * cards with a game */
  closings?: { id: number; line: string; pot: number; stack: number }[];
  riverCards?: string[];
  /** hand index of each seat's combos (a river's weakest first) */
  hands: [Int32Array, Int32Array];
  /** each combo's weight at the start */
  weights: [Float32Array, Float32Array];
  /** combos dropped for sharing a card with every hand on the other side */
  unmatched: [number, number];
  nodes: ResultNode[];
}

type Game = RiverGame | TurnGame;
const isTurn = (g: Game): g is TurnGame => "rivers" in g;

/** A river after a turn's line, at the turn solve's average strategies, entered with that line's reach. */
export interface RiverView {
  closing: number;
  card: string;
  /** the river's pot and chips behind */
  pot: number;
  stack: number;
  /** the river game's combos, weakest first, and their weights in the ranges */
  hands: [Int32Array, Int32Array];
  weights: [Float32Array, Float32Array];
  nodes: ResultNode[];
}

/** A report's nodes with each line in words. */
function inWords(reports: NodeReport[], tree: { nodes: RiverNode[] }, words = new Map<number, string>([[0, ""]])): ResultNode[] {
  return reports.map((report) => {
    const node = tree.nodes[report.id]!;
    if (node.kind !== "action") throw new Error("a report of a terminal node");
    const line = words.get(report.id) ?? "";
    node.actions.forEach((a, k) => words.set(node.children[k]!, `${line ? `${line}, ` : ""}${SEAT_NAMES[node.player]} ${a.label}`));
    return { ...report, line, actions: node.actions };
  });
}

/** Why a game is over the limits, in numbers, or null. */
export function refusal(game: Game): string | null {
  const combos = game.sides[0].n + game.sides[1].n;
  const fit = "Nothing is sampled or grouped to fit: narrow a range or take out a size.";
  if (isTurn(game)) {
    const work = turnWork(game);
    if (work > MAX_TURN_WORK)
      return `This turn and its ${game.rivers.length} rivers come to ${Math.round(work).toLocaleString("en-US")} units of work an iteration (combos times the ways a hand can end, river by river), over the limit of ${MAX_TURN_WORK.toLocaleString("en-US")}. ${fit}`;
  } else {
    const terminals = game.tree.nodes.length - game.tree.actionNodes;
    const most = Math.floor(MAX_WORK / terminals);
    if (combos * terminals > MAX_WORK)
      return `${combos.toLocaleString("en-US")} combos in all, over the limit of ${most.toLocaleString("en-US")} for this tree of ${terminals} ways a hand can end. ${fit}`;
  }
  const bytes = isTurn(game) ? turnMemoryBytes(game) : memoryBytes(game);
  if (bytes > MAX_MEMORY_BYTES) return `This spot needs about ${Math.ceil(bytes / 1e6)} MB, over the limit of ${MAX_MEMORY_BYTES / 1e6} MB. ${fit}`;
  return null;
}

export class RiverJob {
  readonly game: Game;
  readonly solver: RiverSolver | TurnSolver;
  stop: StopReason | null = null;
  private last: Exploitability | null = null;
  private lastAt = -1;
  private nextCheck = FIRST_CHECK;
  private readonly start: number;
  private readonly now: () => number;
  readonly bytes: number;

  constructor(
    private readonly job: RiverJobSpec,
    now: () => number = () => performance.now(),
  ) {
    this.now = now;
    this.start = now();
    const spec = job.spec;
    const game: Game = "turn" in spec ? compileTurn(spec) : compileGame(spec);
    this.game = game;
    const limit = refusal(game);
    if (limit) throw new RiverError(limit);
    this.bytes = isTurn(game) ? turnMemoryBytes(game) : memoryBytes(game);
    this.solver = isTurn(game) ? new TurnSolver(game) : new RiverSolver(game);
  }

  get done(): boolean {
    return this.stop !== null;
  }

  private elapsed(): number {
    return (this.now() - this.start) / 1000;
  }

  private look(): Exploitability {
    if (this.lastAt !== this.solver.iterations) {
      this.last = this.solver.measure();
      this.lastAt = this.solver.iterations;
    }
    return this.last!;
  }

  /** Iterations for about `sliceMs`, at least one. */
  step(sliceMs: number): void {
    const begin = this.now();
    while (!this.stop) {
      this.solver.iterate();
      if (this.solver.iterations >= this.nextCheck) {
        this.nextCheck = Math.max(this.solver.iterations + 1, Math.ceil(this.solver.iterations * CHECK_GROWTH));
        if (this.look().pct <= this.job.targetPct) this.stop = "target";
      }
      if (this.stop) return;
      if (this.solver.iterations >= this.job.maxIterations) this.stop = "iterations";
      else if (this.elapsed() >= this.job.seconds) this.stop = "time";
      if (this.now() - begin >= sliceMs) return;
    }
  }

  cancel(): void {
    this.stop ??= "cancelled";
  }

  /** A turn's river after closing `closing` on card `card` (as "Ah"), or null: not a turn, an all-in closing, a card with no
   * game, or nothing solved yet. */
  riverView(closing: number, card: string): RiverView | null {
    if (!(this.solver instanceof TurnSolver) || !this.solver.iterations || !isTurn(this.game)) return null;
    const id = parseIds(card, 1)?.[0];
    if (id === undefined) return null;
    const got = this.solver.riverReport(closing, id);
    const c = this.game.closings.get(closing);
    if (!got || !c) return null;
    const { sides } = got.game;
    return {
      closing,
      card: cardsText([id]),
      pot: c.pot,
      stack: c.stack,
      hands: [sides[0].hands, sides[1].hands],
      weights: [Float32Array.from(sides[0].weights), Float32Array.from(sides[1].weights)],
      nodes: inWords(got.nodes, got.game.tree),
    };
  }

  progress(): RiverProgress {
    return { iterations: this.solver.iterations, seconds: this.elapsed(), exploitabilityPct: this.lastAt < 0 ? null : this.last!.pct };
  }

  /** The strategies as they stand, measured now; null before the first iteration. A stop short of the target says so. */
  result(): RiverResult | null {
    if (!this.solver.iterations) return null;
    const exploitability = this.look();
    if (exploitability.pct <= this.job.targetPct && this.stop !== "cancelled") this.stop = "target";
    const { game } = this;
    const { tree, sides } = game;
    const words = new Map<number, string>();
    words.set(0, "");
    const nodes = inWords(this.solver.report(), tree, words);
    const turn = isTurn(game);
    return {
      street: turn ? "turn" : "river",
      ...(turn
        ? {
            riverSizes: game.riverSizes,
            rivers: game.rivers.length,
            closings: [...game.closings.values()].filter((c) => c.tree).map((c) => ({ id: c.id, line: words.get(c.id) ?? "", pot: c.pot, stack: c.stack })),
            riverCards: game.rivers.map((r) => cardsText([r.card])),
          }
        : {}),
      stop: this.stop ?? "cancelled",
      iterations: this.solver.iterations,
      seconds: this.elapsed(),
      targetPct: this.job.targetPct,
      exploitability,
      memoryBytes: this.bytes,
      pot: tree.pot,
      stack: tree.stack,
      board: cardsText(this.job.spec.board),
      sizes: tree.sizes,
      hands: [sides[0].hands, sides[1].hands],
      weights: [Float32Array.from(sides[0].weights), Float32Array.from(sides[1].weights)],
      unmatched: game.unmatched,
      nodes,
    };
  }
}

export interface RunOptions {
  /** ms of work a slice runs for */
  sliceMs?: number;
  /** read between slices */
  stopped?: () => boolean;
  /** after a slice, at most every PROGRESS_MS */
  onProgress?: (p: RiverProgress) => void;
  /** lets other work in between slices */
  pause?: () => Promise<void>;
  now?: () => number;
}

const PROGRESS_MS = 200;

/** Runs a job to its end, or till `stopped`. */
export async function runJob(job: RiverJob, opts: RunOptions = {}): Promise<{ cancelled: boolean; result: RiverResult | null }> {
  const { sliceMs = 40, stopped = () => false, onProgress, pause = () => new Promise((r) => setTimeout(r, 0)), now = () => performance.now() } = opts;
  let told = -Infinity;
  while (!job.done) {
    job.step(sliceMs);
    if (job.done) break;
    if (now() - told >= PROGRESS_MS) {
      told = now();
      onProgress?.(job.progress());
    }
    await pause();
    if (stopped()) job.cancel();
  }
  const cancelled = job.stop === "cancelled";
  return { cancelled, result: job.result() };
}

export type RiverInbound =
  | { type: "run"; id: number; request: RiverRequest }
  | { type: "cancel"; id: number }
  /** a finished turn's river (`ask` numbers the answer) */
  | { type: "river"; id: number; ask: number; closing: number; card: string };
export type RiverOutbound =
  | { type: "progress"; id: number; progress: RiverProgress }
  | { type: "river"; id: number; ask: number; view: RiverView | null }
  | { type: "done"; id: number; cancelled: boolean; result: RiverResult | null }
  | { type: "error"; id: number; message: string };

/** What a failure says to a person: a refusal as it stands, the browser running out of room plainly. */
export function failureText(e: unknown): string {
  if (e instanceof RiverError) return e.message;
  if (e instanceof RangeError) return "The browser couldn't find the memory for this spot. Nothing is sampled to fit: narrow a range or take out a size.";
  return `The river solve failed: ${String(e)}`;
}

export function startJob(request: RiverRequest): RiverJob {
  const spec = specOf(request);
  if (typeof spec === "string") throw new RiverError(spec);
  return new RiverJob(spec);
}

/** A result's arrays, to move to the page and not copy: a copy would hold two of each while it crosses. */
function buffersOf(r: RiverResult | null): ArrayBuffer[] {
  if (!r) return [];
  const arrays = [...r.hands, ...r.weights, ...r.nodes.flatMap((n) => [n.strategy, n.weight, n.ev, n.actionEv])];
  return arrays.map((a) => a.buffer as ArrayBuffer);
}

export interface RiverPort {
  postMessage(m: RiverOutbound, transfer?: Transferable[]): void;
  onmessage: ((e: { data: RiverInbound }) => void) | null;
}

/** A view's arrays, to move and not copy. */
const viewBuffers = (v: RiverView | null): ArrayBuffer[] =>
  v ? [...v.hands, ...v.weights, ...v.nodes.flatMap((n) => [n.strategy, n.weight, n.ev, n.actionEv])].map((a) => a.buffer as ArrayBuffer) : [];

/** The worker's end: one job at a time, a new one replacing the last. A finished turn's job is kept, to look at its rivers. */
export function serveRiver(port: RiverPort, options: RunOptions = {}): void {
  let current = 0;
  let kept: { id: number; job: RiverJob } | null = null;
  port.onmessage = ({ data }) => {
    if (data.type === "river") {
      const view = kept && kept.id === data.id ? kept.job.riverView(data.closing, data.card) : null;
      port.postMessage({ type: "river", id: data.id, ask: data.ask, view }, viewBuffers(view));
      return;
    }
    if (data.type === "cancel") {
      if (data.id === current) current = 0;
      return;
    }
    const id = (current = data.id);
    kept = null;
    void run(id, data.request);
  };
  async function run(id: number, request: RiverRequest) {
    try {
      const job = startJob(request);
      const { cancelled, result } = await runJob(job, {
        ...options,
        stopped: () => current !== id,
        onProgress: (progress) => port.postMessage({ type: "progress", id, progress }),
      });
      if (result?.street === "turn") kept = { id, job };
      port.postMessage({ type: "done", id, cancelled, result }, buffersOf(result));
    } catch (e) {
      port.postMessage({ type: "error", id, message: failureText(e) });
    }
  }
}
