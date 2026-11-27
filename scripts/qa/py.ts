// The QA sweep's solver backend: advserver.py (the browser worker's Advisor, natively) as a SolverTransport, so the sweep
// asks it through the page's own SolverClient (client.ts: applyMode, the tree cap, bunching, provenanceOf), as the page
// asks its worker. One request at a time, as the worker takes them. The Python process runs under the machine's slot
// wrapper (QA_SLOT), which may hold it until a CPU slot is free (the time is kept in `waited` and logged); it is started
// again where it exits (over its RSS cap, or a crash) or a request runs past its timeout, and before a preflop request
// where its RSS is past PF_CAP_MB. Its peak RSS is kept, and its peak physical footprint (what it holds: the RSS also
// counts pages it freed that the system hasn't taken back, advserver.py memory()). It starts with MallocLargeCache=0:
// macOS's allocator otherwise keeps freed large blocks held, so a dropped stored preflop solve stayed in the process's
// memory and a postflop solve's working set stacked on it (advserver.py's doc).
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import { SolverError, type PlayRequest, type RuntimeStatus, type SolverTransport, type StopCost } from "@/solver/types";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "../..");
export const PYTHON = process.env.QA_PYTHON || "/Users/mhan/projects/lizard/.venv/bin/python";
export const LIBRARY = process.env.QA_LIBRARY || "/Users/mhan/projects/lizard/library-build/lizard-library";
/** the machine's CPU slot wrapper; empty runs the advisor directly */
export const SLOT = process.env.QA_SLOT ?? "/Users/mhan/projects/gtosolver/.work/bin/slot.sh";
/** Before a preflop request, a process whose RSS is past this, MB, is started afresh: a preflop request can read a stored
 * preflop solve, the most one request added to the RSS in the default matrix (up to 494 MB at its peak), and a hand's
 * preflop has no earlier street for a fresh process to lose (the reference's warm-up asks the hand from its start again
 * after a restart). Past the RSS cap after any reply (advserver.py CAP, 700) the process restarts anyway. */
export const PF_CAP_MB = Number(process.env.QA_PF_CAP_MB || 500);

interface Reply {
  id?: number;
  /** the process exits after this reply (its RSS over its cap) */
  bye?: string;
  json?: string;
  error?: string;
  tb?: string;
  secs?: number;
  /** the process's RSS at its most and now, MB */
  rss_mb?: number;
  cur_mb?: number;
  /** its physical footprint at its most, MB (macOS; its RSS elsewhere) */
  mem_mb?: number;
  /** the boards of 3-way solves of earlier streets the solve cache evicted during the request (advserver.py) */
  dropped?: string[];
}

/** What one request took: the advisor's own seconds, its process's peak RSS, its RSS now (`now`) and its peak footprint
 * (`mem`) after it, and the boards whose 3-way solves of earlier streets (what a later street of that hand is narrowed
 * through) its solve cache evicted while answering it. */
export interface Took {
  secs: number;
  rss: number;
  now: number;
  mem: number;
  dropped: string[];
}

export class PyAdvisor implements SolverTransport {
  readonly kind = "worker" as const;
  /** the peak RSS, MB, of every process this transport started (what the ~1 GB rule reads) */
  peak = 0;
  /** and their peak physical footprint, MB */
  memPeak = 0;
  /** each process's own peak RSS and footprint, MB, in the order they started (since `fresh`) */
  procs: { rss: number; mem: number }[] = [];
  restarts = 0;
  /** seconds spent waiting for the process to be ready (a CPU slot, the imports, the library's index) */
  waited = 0;
  /** the last request's advisor seconds and memory */
  last: Took = { secs: 0, rss: 0, now: 0, mem: 0, dropped: [] };
  private p: ChildProcess | null = null;
  /** whether a process is up (false before the first request, and after one said goodbye or was killed: the next starts afresh) */
  get alive(): boolean {
    return this.p !== null;
  }
  private ready: Promise<void> | null = null;
  private waiting: ((r: Reply) => void) | null = null;
  private n = 0;
  private started = 0;

  constructor(
    readonly name: string,
    private readonly timeoutSecs: (state: AdvisorState) => number,
    private readonly env: Record<string, string> = {},
    private readonly log: (s: string) => void = (s) => process.stderr.write(s),
  ) {}

  private start(): Promise<void> {
    const cmd = [PYTHON, "-B", resolve(HERE, "advserver.py")];
    const env = { ...process.env, QA_LIBRARY: LIBRARY, MallocLargeCache: "0", ...this.env };
    // (its own process group, so a timeout stops the wrapper and the Python under it together)
    const p = SLOT ? spawn(SLOT, cmd, { cwd: ROOT, env, detached: true }) : spawn(cmd[0]!, cmd.slice(1), { cwd: ROOT, env, detached: true });
    this.p = p;
    this.started += 1;
    const own = { rss: 0, mem: 0 };
    this.procs.push(own);
    if (this.started > 1) this.restarts += 1;
    p.stderr!.on("data", (d: Buffer) => {
      const s = String(d);
      // (the engine's own progress chatter stays out of the log; a traceback doesn't)
      if (/Traceback|Error|error/.test(s)) this.log(`[${this.name}] ${s}`);
    });
    let ok!: () => void;
    let fail!: (e: Error) => void;
    const ready = new Promise<void>((res, rej) => {
      ok = res;
      fail = rej;
    });
    p.on("exit", (code, sig) => {
      fail(new Error(`${this.name} exited ${code ?? sig} before it was ready`));
      // (a process closed earlier, as a config's ends, can exit while the next one answers: only this one's request fails)
      if (this.p !== p) return;
      this.p = null;
      this.ready = null;
      const w = this.waiting;
      this.waiting = null;
      w?.({ error: `the advisor exited (${code ?? sig})` });
    });
    createInterface({ input: p.stdout! }).on("line", (line) => {
      if (this.p !== p) return;
      let m: Reply & { ready?: boolean; warn?: string };
      try {
        m = JSON.parse(line);
      } catch {
        this.log(`[${this.name} out] ${line.slice(0, 300)}\n`);
        return;
      }
      if (typeof m.rss_mb === "number") (this.peak = Math.max(this.peak, m.rss_mb)), (own.rss = Math.max(own.rss, m.rss_mb));
      if (typeof m.mem_mb === "number") (this.memPeak = Math.max(this.memPeak, m.mem_mb)), (own.mem = Math.max(own.mem, m.mem_mb));
      if (m.ready) return ok();
      if (m.warn) return this.log(`[${this.name}] ${m.warn}\n`);
      if (m.id !== this.n) return this.log(`[${this.name}] a reply to request ${m.id} came while ${this.n} waits: dropped\n`);
      if (m.bye) {
        // (it exits after this reply: the next request starts a fresh process)
        this.log(`[${this.name}] ${m.bye}\n`);
        this.p = null;
        this.ready = null;
        setTimeout(() => {
          if (p.exitCode === null && p.signalCode === null && p.pid) {
            try {
              process.kill(-p.pid, "SIGKILL");
            } catch {
              /* gone */
            }
          }
        }, 5000).unref();
      }
      const w = this.waiting;
      this.waiting = null;
      w?.(m);
    });
    return ready;
  }

  private kill(): void {
    const p = this.p;
    this.p = null;
    this.ready = null;
    if (!p?.pid) return;
    try {
      process.kill(-p.pid, "SIGKILL");
    } catch {
      p.kill("SIGKILL");
    }
  }

  async request(state: AdvisorState, opts: { progressive: boolean; signal?: AbortSignal; play?: PlayRequest }): Promise<AdvisorResponse> {
    if (this.p && !state.board && this.last.now > PF_CAP_MB) {
      this.log(`[${this.name}] rss ${this.last.now} MB before a preflop request, past ${PF_CAP_MB}: a fresh process\n`);
      this.close();
    }
    if (!this.p || !this.ready) this.ready = this.start();
    const t0 = Date.now();
    // (the slot wrapper holds a new process until a CPU slot is free: said once a while, so a quiet run isn't a hung one)
    const nag = setInterval(() => this.log(`[${this.name}] waiting for a CPU slot (${Math.round((Date.now() - t0) / 1000)} s)\n`), 30000);
    try {
      await this.ready;
    } catch (e) {
      throw new SolverError("solver-error", String(e));
    } finally {
      clearInterval(nag);
      this.waited += (Date.now() - t0) / 1000;
    }
    const id = ++this.n;
    const limit = this.timeoutSecs(state);
    const reply = await new Promise<Reply>((res) => {
      const timer = setTimeout(() => {
        this.waiting = null;
        this.kill();
        res({ error: `timeout: no answer in ${limit} s` });
      }, limit * 1000);
      this.waiting = (r) => {
        clearTimeout(timer);
        res(r);
      };
      this.p!.stdin!.write(JSON.stringify({ id, state, ...(opts.play ? { play: opts.play } : {}) }) + "\n");
    });
    this.last = { secs: reply.secs ?? 0, rss: reply.rss_mb ?? 0, now: reply.cur_mb ?? 0, mem: reply.mem_mb ?? 0, dropped: reply.dropped ?? [] };
    if (reply.error !== undefined) throw new SolverError("solver-error", reply.error + (reply.tb ? `\n${reply.tb}` : ""));
    // (as the page's: JSON.parse of what the worker posted; a NaN fails here as it would there)
    try {
      return JSON.parse(reply.json ?? "") as AdvisorResponse;
    } catch (e) {
      throw new SolverError("solver-error", `the answer isn't JSON the page can read: ${String(e)}: ${String(reply.json).slice(0, 200)}`);
    }
  }

  /** Start a fresh process for what comes next (a clean cache, its own peak memory). */
  fresh(): void {
    this.close();
    this.peak = 0;
    this.memPeak = 0;
    this.procs = [];
    this.restarts = 0;
    this.started = 0;
    this.waited = 0;
  }

  stopCost(): StopCost {
    return "kills";
  }
  onStatus(): () => void {
    return () => {};
  }
  status(): RuntimeStatus {
    return { phase: "ready", transport: "worker", crossOriginIsolated: true };
  }
  close(): void {
    const p = this.p;
    if (p) {
      p.stdin?.end();
      setTimeout(() => {
        if (p.exitCode === null && p.signalCode === null && p.pid) {
          try {
            process.kill(-p.pid, "SIGKILL");
          } catch {
            /* gone */
          }
        }
      }, 3000).unref();
    }
    this.p = null;
    this.ready = null;
  }
  dispose(): void {
    this.close();
  }
}
