import { describe, expect, it } from "vitest";
import { RiverClient, CANCEL_GRACE_MS, type WorkerLike } from "./client";
import { MAX_MEMORY_BYTES, MAX_WORK, refusal, RiverJob, runJob, serveRiver, specOf, startJob, type RiverInbound, type RiverJobSpec, type RiverOutbound, type RiverPort, type RiverRequest } from "./run";

const request = (over: Partial<RiverRequest> = {}): RiverRequest => ({
  oop: "AAK9,KQJTds",
  ip: "JJT8,T987",
  board: "Qs9s4d2h7c",
  pot: 20,
  stacks: [100, 100],
  sizes: { bets: [50, 100], raises: [100], raiseCap: 2, allIn: true },
  targetPct: 0.05,
  seconds: 60,
  ...over,
});

const specFrom = (r: RiverRequest): RiverJobSpec => {
  const s = specOf(r);
  if (typeof s === "string") throw new Error(s);
  return s;
};

describe("a request", () => {
  it("names what can't be read", () => {
    expect(specOf(request({ board: "Qs7d2c" }))).toMatch(/five cards/);
    expect(specOf(request({ oop: "hello" }))).toMatch(/^OOP:/);
    expect(specOf(request({ ip: "hello" }))).toMatch(/^IP:/);
    expect(specOf(request({ targetPct: 0 }))).toMatch(/target/);
    expect(specOf(request({ seconds: 0 }))).toMatch(/time budget/);
  });

  it("takes every hand there is on a small tree", () => {
    const job = startJob(request({ oop: "random", ip: "random" }));
    expect(job.game.sides[0].n).toBe(178_365);
    expect(refusal(job.game)).toBeNull();
  });

  it("refuses a spot over the limit, saying the limit, and doesn't cut it down", () => {
    const wide = { oop: "random", ip: "random", sizes: { bets: [33, 66, 100], raises: [50, 100], raiseCap: 3, allIn: true } };
    expect(() => startJob(request(wide))).toThrow(/combos in all, over the limit of [\d,]+ for this tree of \d+ ways a hand can end\. Nothing is sampled or grouped to fit/);
  });

  it("states the work limit in the combos this tree can take", () => {
    const job = startJob(request());
    const terminals = job.game.tree.nodes.length - job.game.tree.actionNodes;
    const big = { ...job.game, sides: [{ ...job.game.sides[0], n: MAX_WORK / terminals + 1 }, { ...job.game.sides[1], n: 0 }] as typeof job.game.sides };
    expect(refusal(big)).toContain(Math.floor(MAX_WORK / terminals).toLocaleString("en-US"));
  });

  it("refuses a spot over the memory limit, in megabytes", () => {
    const job = startJob(request());
    const big = { ...job.game, setCount: MAX_MEMORY_BYTES };
    expect(refusal(big)).toMatch(/needs about \d+ MB, over the limit of 512 MB/);
  });

  it("refuses a pot under the blinds", () => {
    expect(() => startJob(request({ pot: 1 }))).toThrow(/at least 2bb/);
  });

  it("uses the shorter stack", () => {
    const job = startJob(request({ stacks: [100, 7] }));
    expect(job.game.tree.stack).toBe(7);
  });
});

describe("a job", () => {
  it("stops at the target, with the exploitability it measured", async () => {
    const { result, cancelled } = await runJob(startJob(request()));
    expect(cancelled).toBe(false);
    expect(result!.stop).toBe("target");
    expect(result!.exploitability.pct).toBeLessThanOrEqual(0.05);
    expect(result!.nodes[0]).toMatchObject({ line: "", player: 0 });
    expect(result!.nodes.find((n) => n.path === "x")!.line).toBe("OOP Check");
    expect(result!.nodes.find((n) => n.path === "x.b1000")!.line).toBe("OOP Check, IP Bet 10");
  });

  it("stops at the iteration limit, and says it fell short", async () => {
    const { result } = await runJob(startJob(request({ targetPct: 0.001, maxIterations: 5 })));
    expect(result).toMatchObject({ stop: "iterations", iterations: 5 });
    expect(result!.exploitability.pct).toBeGreaterThan(0.001);
  });

  it("stops at the time budget, measured then", () => {
    let t = 0;
    const job = new RiverJob(specFrom(request({ targetPct: 0.001, seconds: 3 })), () => (t += 1000));
    while (!job.done) job.step(0);
    expect(job.stop).toBe("time");
    expect(job.result()!.exploitability.pct).toBeGreaterThan(0);
  });

  it("gives a cancel the strategies as they stood, labelled cancelled", async () => {
    let looks = 0;
    const { result, cancelled } = await runJob(startJob(request({ targetPct: 0.001 })), { sliceMs: 0, stopped: () => ++looks > 3 });
    expect(cancelled).toBe(true);
    expect(result).toMatchObject({ stop: "cancelled", iterations: 4 });
  });

  it("reports progress with nothing measured before the first look", () => {
    const job = startJob(request());
    job.step(0);
    expect(job.progress()).toMatchObject({ iterations: 1, exploitabilityPct: null });
  });
});

function pair() {
  const toPage: RiverOutbound[] = [];
  const port: RiverPort = { postMessage: (m) => toPage.push(m), onmessage: null };
  serveRiver(port, { pause: () => Promise.resolve() });
  return { port, toPage, send: (m: RiverInbound) => port.onmessage!({ data: m }) };
}
const until = async (p: () => boolean) => {
  while (!p()) await new Promise((r) => setTimeout(r, 1));
};

describe("the worker's end", () => {
  it("runs a job to its end", async () => {
    const { toPage, send } = pair();
    send({ type: "run", id: 1, request: request() });
    await until(() => toPage.some((m) => m.type === "done"));
    expect(toPage.at(-1)).toMatchObject({ type: "done", id: 1, cancelled: false });
  });

  it("answers a cancel with what it has", async () => {
    const { toPage, send } = pair();
    send({ type: "run", id: 2, request: request({ targetPct: 0.001, seconds: 600 }) });
    send({ type: "cancel", id: 2 });
    await until(() => toPage.some((m) => m.type === "done"));
    expect(toPage.at(-1)).toMatchObject({ type: "done", id: 2, cancelled: true });
  });

  it("sends a refusal as a message", async () => {
    const { toPage, send } = pair();
    send({ type: "run", id: 3, request: request({ oop: "hello" }) });
    await until(() => toPage.length > 0);
    expect(toPage[0]).toMatchObject({ type: "error", id: 3 });
    expect((toPage[0] as { message: string }).message).toMatch(/^OOP:/);
  });
});

class FakeWorker implements WorkerLike {
  sent: RiverInbound[] = [];
  ended = false;
  onmessage: WorkerLike["onmessage"] = null;
  onerror: WorkerLike["onerror"] = null;
  postMessage(m: RiverInbound) {
    this.sent.push(m);
  }
  terminate() {
    this.ended = true;
  }
}

describe("the client", () => {
  it("runs on the page where there's no worker", async () => {
    const { result } = await new RiverClient(() => null).run(request());
    expect(result!.stop).toBe("target");
  });

  it("ends a worker that doesn't answer a cancel, with nothing to show", async () => {
    const w = new FakeWorker();
    const c = new RiverClient(() => w);
    const p = c.run(request());
    c.cancel();
    expect(w.sent.at(-1)).toMatchObject({ type: "cancel" });
    await new Promise((r) => setTimeout(r, 0));
    expect(w.ended).toBe(false);
    expect(CANCEL_GRACE_MS).toBeGreaterThan(1000);
    c.dispose();
    expect(await p).toEqual({ cancelled: true, result: null });
    expect(w.ended).toBe(true);
  });

  it("passes on progress and a failure", async () => {
    const w = new FakeWorker();
    const c = new RiverClient(() => w);
    const seen: number[] = [];
    const p = c.run(request(), (x) => seen.push(x.iterations));
    w.onmessage!({ data: { type: "progress", id: 1, progress: { iterations: 8, seconds: 1, exploitabilityPct: 2 } } });
    w.onmessage!({ data: { type: "error", id: 1, message: "over the limit" } });
    await expect(p).rejects.toThrow("over the limit");
    expect(seen).toEqual([8]);
  });
});
