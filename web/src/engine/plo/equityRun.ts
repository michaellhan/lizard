// Running an equity job without holding up the page: slices of work with a turn of the event loop between them, so a
// cancel gets read, whether that's in the worker (equity.worker.ts, the normal way) or on the page where a browser has
// no worker for it. The request is text: parsing a range sweeps the hands, so that's done on this side too.
import { parseIds } from "./cards";
import { EquityError, EquityJob, type EquityMode, type EquityResult, type EquitySpec } from "./equity";
import { parseRange, type PloRange } from "./ranges";

export interface EquityRequest {
  /** each seat's hand or range, as parseRange reads them */
  players: string[];
  board: string;
  dead?: string;
  mode?: EquityMode;
  runs?: number;
  seed?: number;
}

export type EquityInbound = { type: "run"; id: number; request: EquityRequest } | { type: "cancel"; id: number };
export type EquityOutbound =
  | { type: "progress"; id: number; result: EquityResult }
  | { type: "done"; id: number; cancelled: boolean; result: EquityResult | null }
  | { type: "error"; id: number; message: string };

/** The spec of a request, or what's wrong with it. */
export function specOf(req: EquityRequest): EquitySpec | string {
  const board = parseIds(req.board);
  if (!board) return "The board isn't cards: Ah7d2c, for one.";
  const dead = parseIds(req.dead ?? "");
  if (!dead) return "The dead cards aren't cards: Ah7d2c, for one.";
  const players: PloRange[] = [];
  for (const [i, text] of req.players.entries()) {
    const r = parseRange(text);
    if (typeof r === "string") return `Player ${i + 1}: ${r}`;
    players.push(r);
  }
  return { players, board, dead, mode: req.mode, runs: req.runs, seed: req.seed };
}

export interface RunOptions {
  /** ms of work a slice runs for */
  sliceMs?: number;
  /** read between slices */
  stopped?: () => boolean;
  /** after each slice */
  onProgress?: (r: EquityResult) => void;
  /** lets other work in between slices */
  pause?: () => Promise<void>;
  now?: () => number;
}

const BOARDS_PER_CHECK = 2048;

/** Runs a job to its end, or till `stopped`; the result is null only if it was stopped in an exact count, whose numbers
 * mean nothing until every board is in. */
export async function runJob(job: EquityJob, opts: RunOptions = {}): Promise<{ cancelled: boolean; result: EquityResult | null }> {
  const { sliceMs = 30, stopped = () => false, onProgress, pause = () => new Promise((r) => setTimeout(r, 0)), now = () => performance.now() } = opts;
  for (;;) {
    const start = now();
    while (!job.step(BOARDS_PER_CHECK) && now() - start < sliceMs);
    if (job.done) return { cancelled: false, result: job.result() };
    onProgress?.(job.result());
    await pause();
    if (stopped()) return { cancelled: true, result: job.method === "exact" ? null : job.result() };
  }
}

export interface EquityPort {
  postMessage(m: EquityOutbound): void;
  onmessage: ((e: { data: EquityInbound }) => void) | null;
}

/** The worker's end: one job at a time, a new one replacing the last. */
export function serveEquity(port: EquityPort, options: RunOptions = {}): void {
  let current = 0;
  port.onmessage = ({ data }) => {
    if (data.type === "cancel") {
      if (data.id === current) current = 0;
      return;
    }
    const id = (current = data.id);
    void run(id, data.request);
  };
  async function run(id: number, request: EquityRequest) {
    try {
      const spec = specOf(request);
      if (typeof spec === "string") throw new EquityError(spec);
      const { cancelled, result } = await runJob(new EquityJob(spec), {
        ...options,
        stopped: () => current !== id,
        onProgress: (r) => port.postMessage({ type: "progress", id, result: r }),
      });
      port.postMessage({ type: "done", id, cancelled, result });
    } catch (e) {
      port.postMessage({ type: "error", id, message: e instanceof EquityError ? e.message : `Equity failed: ${String(e)}` });
    }
  }
}
