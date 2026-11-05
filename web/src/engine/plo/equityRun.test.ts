import { afterEach, describe, expect, it, vi } from "vitest";
import { parseIds } from "./cards";
import { EquityClient, CANCEL_GRACE_MS, type WorkerLike } from "./equityClient";
import { EquityError, EquityJob, type EquityResult } from "./equity";
import { runJob, serveEquity, specOf, type EquityInbound, type EquityOutbound, type EquityPort, type EquityRequest } from "./equityRun";

const twoHands: EquityRequest = { players: ["AsAhKsKh", "JdTd9c8c"], board: "" };
const job = (req: EquityRequest) => {
  const s = specOf(req);
  if (typeof s === "string") throw new Error(s);
  return new EquityJob(s);
};

describe("specOf", () => {
  it("reads a request", () => {
    const s = specOf({ ...twoHands, board: "Ah7d2c", dead: "9s", mode: "montecarlo", runs: 5, seed: 2 });
    expect(s).toMatchObject({ board: parseIds("Ah7d2c"), dead: parseIds("9s"), mode: "montecarlo", runs: 5, seed: 2 });
  });
  it("says what's wrong, and whose", () => {
    expect(specOf({ ...twoHands, board: "Ax" })).toMatch(/board/);
    expect(specOf({ ...twoHands, dead: "1" })).toMatch(/dead/);
    expect(specOf({ players: ["AsAhKsKh", "nonsense"], board: "" })).toMatch(/^Player 2:/);
  });
});

describe("runJob", () => {
  it("gives way between slices: nothing runs for longer than a slice, plus one bite of boards", async () => {
    let pauses = 0;
    const seen: number[] = [];
    const j = job({ ...twoHands, mode: "montecarlo", runs: 60_000 });
    const { result, cancelled } = await runJob(j, {
      sliceMs: 1,
      pause: async () => {
        pauses++;
      },
      onProgress: (r) => seen.push(r.runouts),
    });
    expect(cancelled).toBe(false);
    expect(result!.runouts).toBe(60_000);
    expect(result!.complete).toBe(true);
    expect(pauses).toBeGreaterThan(3);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it("stops at the next gap: a Monte Carlo keeps the runs it made, labelled as stopped", async () => {
    let gaps = 0;
    const { result, cancelled } = await runJob(job({ ...twoHands, mode: "montecarlo", runs: 5_000_000 }), { sliceMs: 1, pause: async () => void gaps++, stopped: () => gaps >= 2 });
    expect(cancelled).toBe(true);
    expect(result!.complete).toBe(false);
    expect(result!.runouts).toBeLessThan(5_000_000);
    expect(result!.players[0]!.stderr).toBeGreaterThan(0);
  });

  it("an exact count stopped part way has no result: its numbers are only of the boards so far", async () => {
    let gaps = 0;
    const r = await runJob(job({ ...twoHands, mode: "exact" }), { sliceMs: 0, pause: async () => void gaps++, stopped: () => gaps >= 1 });
    expect(r).toEqual({ cancelled: true, result: null });
  });
});

class FakePort implements EquityPort {
  sent: EquityOutbound[] = [];
  onmessage: EquityPort["onmessage"] = null;
  postMessage(m: EquityOutbound) {
    this.sent.push(m);
  }
  send(m: EquityInbound) {
    this.onmessage!({ data: m });
  }
  async until(type: EquityOutbound["type"]) {
    await vi.waitFor(() => expect(this.sent.some((m) => m.type === type)).toBe(true), { timeout: 15_000 });
    return this.sent.find((m) => m.type === type)!;
  }
}

describe("serveEquity (the worker's end)", () => {
  it("runs, reports and finishes", async () => {
    const port = new FakePort();
    serveEquity(port, { sliceMs: 1 });
    port.send({ type: "run", id: 1, request: { ...twoHands, mode: "montecarlo", runs: 30_000, seed: 3 } });
    const done = await port.until("done");
    expect(done).toMatchObject({ type: "done", id: 1, cancelled: false });
    expect(port.sent.filter((m) => m.type === "progress").length).toBeGreaterThan(0);
    expect((done as { result: EquityResult }).result.runouts).toBe(30_000);
  });

  it("stops when told, and a run that replaces it goes on", async () => {
    const port = new FakePort();
    serveEquity(port, { sliceMs: 1 });
    port.send({ type: "run", id: 1, request: { ...twoHands, mode: "montecarlo", runs: 50_000_000 } });
    await port.until("progress");
    port.send({ type: "cancel", id: 1 });
    const done = await port.until("done");
    expect(done).toMatchObject({ id: 1, cancelled: true });
    port.sent.length = 0;
    port.send({ type: "run", id: 2, request: { ...twoHands, board: "2c7h9d", mode: "exact" } });
    expect(await port.until("done")).toMatchObject({ id: 2, cancelled: false });
  });

  it("answers a bad request with its reason, not a crash", async () => {
    const port = new FakePort();
    serveEquity(port);
    port.send({ type: "run", id: 1, request: { players: ["AsAhKsKh"], board: "" } });
    expect(await port.until("error")).toEqual({ type: "error", id: 1, message: "Equity is for 2 to 9 players." });
    port.sent.length = 0;
    port.send({ type: "run", id: 2, request: { players: ["AsAhKsKh", "xx"], board: "" } });
    expect(await port.until("error")).toMatchObject({ id: 2, message: expect.stringMatching(/^Player 2:/) });
  });
});

class FakeWorker implements WorkerLike {
  onmessage: WorkerLike["onmessage"] = null;
  onerror: WorkerLike["onerror"] = null;
  sent: EquityInbound[] = [];
  terminated = false;
  postMessage(m: EquityInbound) {
    this.sent.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  reply(m: EquityOutbound) {
    this.onmessage!({ data: m });
  }
}

const result = (method: "exact" | "montecarlo", runouts: number) => ({ method, runouts }) as EquityResult;

describe("EquityClient", () => {
  afterEach(() => void vi.useRealTimers());
  const setup = () => {
    const workers: FakeWorker[] = [];
    const client = new EquityClient(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    return { workers, client };
  };

  it("starts no worker until a run, and hands back the worker's answer", async () => {
    const { workers, client } = setup();
    expect(workers).toEqual([]);
    const progress: EquityResult[] = [];
    const p = client.run(twoHands, (r) => progress.push(r));
    const w = workers[0]!;
    const id = (w.sent[0] as { id: number }).id;
    w.reply({ type: "progress", id, result: result("montecarlo", 5) });
    w.reply({ type: "done", id, cancelled: false, result: result("montecarlo", 10) });
    await expect(p).resolves.toMatchObject({ cancelled: false, result: { runouts: 10 } });
    expect(progress.map((r) => r.runouts)).toEqual([5]);
    client.run(twoHands);
    expect(workers).toHaveLength(1); // kept for the next one
  });

  it("cancels by asking, and gets what the worker made", async () => {
    const { workers, client } = setup();
    const p = client.run(twoHands);
    const w = workers[0]!;
    const id = (w.sent[0] as { id: number }).id;
    client.cancel();
    expect(w.sent[1]).toEqual({ type: "cancel", id });
    w.reply({ type: "done", id, cancelled: true, result: result("montecarlo", 7) });
    await expect(p).resolves.toMatchObject({ cancelled: true, result: { runouts: 7 } });
    expect(w.terminated).toBe(false);
  });

  it("ends a worker that doesn't answer a cancel, keeping Monte Carlo's runs so far and dropping an exact count's", async () => {
    vi.useFakeTimers();
    const { workers, client } = setup();
    const p = client.run(twoHands);
    const w = workers[0]!;
    w.reply({ type: "progress", id: (w.sent[0] as { id: number }).id, result: result("montecarlo", 7) });
    client.cancel();
    await vi.advanceTimersByTimeAsync(CANCEL_GRACE_MS);
    await expect(p).resolves.toMatchObject({ cancelled: true, result: { runouts: 7 } });
    expect(w.terminated).toBe(true);

    const q = client.run(twoHands);
    const x = workers[1]!;
    x.reply({ type: "progress", id: (x.sent[0] as { id: number }).id, result: result("exact", 7) });
    client.cancel();
    await vi.advanceTimersByTimeAsync(CANCEL_GRACE_MS);
    await expect(q).resolves.toEqual({ cancelled: true, result: null });
  });

  it("a new run takes over from the last, whose answer no longer counts", async () => {
    const { workers, client } = setup();
    const first = client.run(twoHands);
    const w = workers[0]!;
    const a = (w.sent[0] as { id: number }).id;
    const second = client.run({ ...twoHands, seed: 2 });
    const b = (w.sent.at(-1) as { id: number }).id;
    expect(b).not.toBe(a);
    expect(w.sent.some((m) => m.type === "cancel" && m.id === a)).toBe(true);
    await expect(first).resolves.toMatchObject({ cancelled: true });
    w.reply({ type: "done", id: a, cancelled: true, result: null });
    w.reply({ type: "done", id: b, cancelled: false, result: result("exact", 3) });
    await expect(second).resolves.toMatchObject({ result: { runouts: 3 } });
  });

  it("passes on an error, and a worker's crash", async () => {
    const { workers, client } = setup();
    const p = client.run(twoHands);
    const w = workers[0]!;
    w.reply({ type: "error", id: (w.sent[0] as { id: number }).id, message: "no" });
    await expect(p).rejects.toThrow(EquityError);
    const q = client.run(twoHands);
    w.onerror!(new Error("boom"));
    await expect(q).rejects.toThrow(/worker stopped/);
    expect(w.terminated).toBe(true);
  });

  it("runs in slices on the page where there's no worker, and cancels the same", async () => {
    const client = new EquityClient(() => null);
    const r = await client.run({ ...twoHands, board: "2c7h9d" });
    expect(r.result).toMatchObject({ method: "exact", runouts: 820, complete: true });
    const long = client.run({ ...twoHands, mode: "montecarlo", runs: 50_000_000 });
    await new Promise((res) => setTimeout(res, 40));
    client.cancel();
    const out = await long;
    expect(out.cancelled).toBe(true);
    expect(out.result!.complete).toBe(false);
  });
});
