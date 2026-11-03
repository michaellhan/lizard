import { describe, expect, it } from "vitest";
import type { WorkerInbound, WorkerOutbound } from "./protocol";
import { WorkerTransport } from "./worker-transport";

/** Stands in for the Pyodide worker: records what the page posts, and lets the test send replies. */
class FakeWorker {
  posted: WorkerInbound[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<WorkerOutbound>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  constructor(readonly url: string) {}
  postMessage(m: WorkerInbound) {
    this.posted.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  reply(m: WorkerOutbound) {
    this.onmessage?.({ data: m } as MessageEvent<WorkerOutbound>);
  }
}

function setup(isolated: boolean) {
  const workers: FakeWorker[] = [];
  const t = new WorkerTransport({
    assetBase: "/lizard/solver/",
    version: "03dec6cd01",
    libraryBase: "/lizard-library/",
    crossOriginIsolated: isolated,
    createWorker: (url) => {
      const w = new FakeWorker(url);
      workers.push(w);
      return w as unknown as Worker;
    },
  });
  return { t, workers };
}

const lastRequest = (w: FakeWorker) => w.posted.filter((m) => "state" in m).at(-1) as { id: number; early?: boolean };

describe("WorkerTransport", () => {
  it("loads the upstream worker with the bundle version and library base", () => {
    const { t } = setup(false);
    expect(t.workerUrl()).toBe("/lizard/solver/worker.js?v=03dec6cd01&lib=%2Flizard-library%2F");
  });

  it("reports boot progress, delivers partials, and resolves with the result", async () => {
    const { t, workers } = setup(false);
    const phases: string[] = [];
    t.onStatus((s) => phases.push(s.phase));
    const partials: unknown[] = [];
    const p = t.request({ players: 2 }, { progressive: true, onPartial: (r) => partials.push(r) });
    const w = workers[0]!;
    const { id, early } = lastRequest(w);
    expect(early).toBe(true);
    w.reply({ status: "Loading numpy…" });
    w.reply({ status: "Solving…", setup: { total: 4.2, core: true, threads: 4 } });
    expect(t.status()).toMatchObject({ phase: "busy", setup: { threads: 4 } });
    w.reply({ id, partial: { street: "turn" } });
    w.reply({ id: id + 99, result: { street: "river" } }); // someone else's: ignored
    w.reply({ id, result: { street: "turn", solver: { iterations: 5 } } });
    await expect(p).resolves.toMatchObject({ solver: { iterations: 5 } });
    expect(partials).toHaveLength(1);
    expect(t.status().phase).toBe("ready");
    expect(phases).toEqual(expect.arrayContaining(["idle", "booting", "busy", "ready"]));
  });

  it("without shared memory, cancelling ends the worker and the next request starts a new one", async () => {
    const { t, workers } = setup(false);
    const ac = new AbortController();
    const p = t.request({ players: 2 }, { progressive: false, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ kind: "cancelled" });
    expect(workers[0]!.terminated).toBe(true);
    void t.request({ players: 2 }, { progressive: false });
    expect(workers).toHaveLength(2);
  });

  it("cross-origin isolated, cancelling flags the running id and keeps the worker", async () => {
    const { t, workers } = setup(true);
    const ac = new AbortController();
    const p = t.request({ players: 2 }, { progressive: false, signal: ac.signal });
    const w = workers[0]!;
    const stop = w.posted.find((m) => "stop" in m) as { stop: SharedArrayBuffer } | undefined;
    expect(stop).toBeDefined();
    const { id } = lastRequest(w);
    ac.abort();
    expect(new Int32Array(stop!.stop)[1]).toBe(id);
    expect(w.posted).toContainEqual({ cancel: id });
    expect(w.terminated).toBe(false);
    w.reply({ id, result: { cancelled: true } });
    await expect(p).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("a boot error fails the request and the status; the next request retries with a fresh worker", async () => {
    const { t, workers } = setup(false);
    const p = t.request({ players: 2 }, { progressive: false });
    const w = workers[0]!;
    w.reply({ status: "Loading the Python runtime…" });
    w.reply({ id: lastRequest(w).id, error: "pyodide failed to load" });
    await expect(p).rejects.toMatchObject({ kind: "solver-error" });
    expect(t.status()).toMatchObject({ phase: "failed", error: "pyodide failed to load" });
    void t.request({ players: 2 }, { progressive: false });
    expect(w.terminated).toBe(true);
    expect(workers).toHaveLength(2);
  });

  it("refuses a second concurrent request (the client queues instead)", async () => {
    const { t } = setup(false);
    void t.request({ players: 2 }, { progressive: false });
    await expect(t.request({ players: 2 }, { progressive: false })).rejects.toMatchObject({ kind: "bad-request" });
  });
});
