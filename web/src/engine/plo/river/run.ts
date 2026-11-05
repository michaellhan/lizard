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
import { compileGame, RiverError, type RiverGame, type RiverSpec } from "./game";
import { memoryBytes, RiverSolver, type Exploitability, type NodeReport } from "./solver";
import type { RiverAction, RiverSizes } from "./tree";

export const MAX_WORK = 25e6;
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
  board: string;
  pot: number;
  stacks: [number, number];
  sizes: RiverSizes;
  /** exploitability to stop at, % of the pot */
  targetPct?: number;
  /** seconds to stop at */
  seconds?: number;
  maxIterations?: number;
}

export interface RiverJobSpec {
  spec: RiverSpec;
  targetPct: number;
  seconds: number;
  maxIterations: number;
}

/** The spec of a request, or what's wrong with it. */
export function specOf(req: RiverRequest): RiverJobSpec | string {
  const board = parseIds(req.board, 5);
  if (!board) return "The board isn't five cards: Qs7d2c9h3s, for one.";
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
  return {
    spec: { board, ranges: [ranges[0]!, ranges[1]!], pot: req.pot, stacks: req.stacks, sizes: req.sizes },
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
  sizes: RiverSizes;
  /** hand index of each seat's combos, weakest first */
  hands: [Int32Array, Int32Array];
  /** each combo's weight at the start */
  weights: [Float32Array, Float32Array];
  /** combos dropped for sharing a card with every hand on the other side */
  unmatched: [number, number];
  nodes: ResultNode[];
}

/** Why a game is over the limits, in numbers, or null. */
export function refusal(game: RiverGame): string | null {
  const combos = game.sides[0].n + game.sides[1].n;
  const terminals = game.tree.nodes.length - game.tree.actionNodes;
  const fit = "Nothing is sampled or grouped to fit: narrow a range or take out a size.";
  const most = Math.floor(MAX_WORK / terminals);
  if (combos * terminals > MAX_WORK)
    return `${combos.toLocaleString("en-US")} combos in all, over the limit of ${most.toLocaleString("en-US")} for this tree of ${terminals} ways a hand can end. ${fit}`;
  const bytes = memoryBytes(game);
  if (bytes > MAX_MEMORY_BYTES) return `This spot needs about ${Math.ceil(bytes / 1e6)} MB, over the limit of ${MAX_MEMORY_BYTES / 1e6} MB. ${fit}`;
  return null;
}

export class RiverJob {
  readonly game: RiverGame;
  readonly solver: RiverSolver;
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
    this.game = compileGame(job.spec);
    const limit = refusal(this.game);
    if (limit) throw new RiverError(limit);
    this.bytes = memoryBytes(this.game);
    this.solver = new RiverSolver(this.game);
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
    const nodes: ResultNode[] = this.solver.report().map((report) => {
      const node = tree.nodes[report.id]!;
      if (node.kind !== "action") throw new Error("a report of a terminal node");
      const line = words.get(report.id) ?? "";
      node.actions.forEach((a, k) => words.set(node.children[k]!, `${line ? `${line}, ` : ""}${SEAT_NAMES[node.player]} ${a.label}`));
      return { ...report, line, actions: node.actions };
    });
    return {
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

export type RiverInbound = { type: "run"; id: number; request: RiverRequest } | { type: "cancel"; id: number };
export type RiverOutbound =
  | { type: "progress"; id: number; progress: RiverProgress }
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

/** The worker's end: one job at a time, a new one replacing the last. */
export function serveRiver(port: RiverPort, options: RunOptions = {}): void {
  let current = 0;
  port.onmessage = ({ data }) => {
    if (data.type === "cancel") {
      if (data.id === current) current = 0;
      return;
    }
    const id = (current = data.id);
    void run(id, data.request);
  };
  async function run(id: number, request: RiverRequest) {
    try {
      const { cancelled, result } = await runJob(startJob(request), {
        ...options,
        stopped: () => current !== id,
        onProgress: (progress) => port.postMessage({ type: "progress", id, progress }),
      });
      port.postMessage({ type: "done", id, cancelled, result }, buffersOf(result));
    } catch (e) {
      port.postMessage({ type: "error", id, message: failureText(e) });
    }
  }
}
