// The QA sweep's solver backend: advserver.py (the browser worker's Advisor, natively) as a SolverTransport, so the sweep
// asks it through the page's own SolverClient (client.ts: applyMode, the tree cap, bunching, provenanceOf), as the page
// asks its worker. One request at a time, as the worker takes them. The Python process runs under the machine's slot
// wrapper (QA_SLOT), which may hold it until a CPU slot is free (the time is kept in `waited` and logged); it is started
// again where it exits (over its RSS cap, or a crash) or a request runs past its timeout, and its peak RSS is kept.
// It starts with MallocLargeCache=0: macOS's allocator otherwise keeps freed large blocks resident, so a dropped stored
// preflop solve stayed in the RSS and a postflop solve's working set stacked on it (advserver.py's doc).
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import { SolverError, type PlayRequest, type RuntimeStatus, type SolverTransport, type StopCost } from "@/solver/types";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "../..");
export const PYTHON = process.env.QA_PYTHON || "/Users/mhan/Desktop/projects/lizard/.venv/bin/python";
export const LIBRARY = process.env.QA_LIBRARY || "/Users/mhan/Desktop/projects/lizard/library-build/lizard-library";
/** the machine's CPU slot wrapper; empty runs the advisor directly */
export const SLOT = process.env.QA_SLOT ?? "/Users/mhan/Desktop/projects/gtosolver/.work/bin/slot.sh";

interface Reply {
  id?: number;
  /** the process exits after this reply (over its RSS cap) */
  bye?: string;
  json?: string;
  error?: string;
  tb?: string;
  secs?: number;
  rss_mb?: number;
  /** the boards of 3-way solves of earlier streets the solve cache evicted during the request (advserver.py) */
  dropped?: string[];
}

/** What one request took: the advisor's own seconds, its RSS after it, and the boards whose 3-way solves of earlier
 * streets (what a later street of that hand is narrowed through) its solve cache evicted while answering it. */
export interface Took {
  secs: number;
  rss: number;
  dropped: string[];
}

export class PyAdvisor implements SolverTransport {
  readonly kind = "worker" as const;
  /** the peak RSS, MB, of every process this transport started */
  peak = 0;
  restarts = 0;
  /** seconds spent waiting for the process to be ready (a CPU slot, the imports, the library's index) */
  waited = 0;
  /** the last request's advisor seconds and RSS */
  last: Took = { secs: 0, rss: 0, dropped: [] };
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
      if (typeof m.rss_mb === "number") this.peak = Math.max(this.peak, m.rss_mb);
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
    this.last = { secs: reply.secs ?? 0, rss: reply.rss_mb ?? 0, dropped: reply.dropped ?? [] };
    if (reply.error !== undefined) throw new SolverError("solver-error", reply.error + (reply.tb ? `\n${reply.tb}` : ""));
    // (as the page's: JSON.parse of what the worker posted; a NaN fails here as it would there)
    try {
      return JSON.parse(reply.json ?? "") as AdvisorResponse;
    } catch (e) {
      throw new SolverError("solver-error", `the answer isn't JSON the page can read: ${String(e)}: ${String(reply.json).slice(0, 200)}`);
    }
  }

  /** Start a fresh process for what comes next (a clean cache, its own peak RSS). */
  fresh(): void {
    this.close();
    this.peak = 0;
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
