import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpTransport } from "./http-transport";

// a fetch that records each call and answers with `body`
function fake(body: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("HttpTransport", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says stop again until the request settles, as the server clears a stop as an /advise comes in, and not after", async () => {
    vi.useFakeTimers();
    const urls: string[] = [];
    let settle = (_: Response) => {};
    const fetchImpl = ((url: string) => {
      urls.push(url);
      return url.endsWith("/cancel") ? Promise.resolve(new Response("{}")) : new Promise<Response>((r) => (settle = r));
    }) as unknown as typeof fetch;
    const ac = new AbortController();
    const out = new HttpTransport({ url: "http://127.0.0.1:8765", fetchImpl }).request({ players: 2 }, { progressive: false, signal: ac.signal });
    const stops = () => urls.filter((u) => u.endsWith("/cancel")).length;
    expect(stops()).toBe(0);

    ac.abort();
    expect(stops()).toBe(1);
    await vi.advanceTimersByTimeAsync(249);
    expect(stops()).toBe(1);
    await vi.advanceTimersByTimeAsync(251);
    expect(stops()).toBe(3);

    settle(new Response(JSON.stringify({ cancelled: true })));
    await expect(out).rejects.toMatchObject({ kind: "cancelled" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(stops()).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("POSTs a state to /advise", async () => {
    const f = fake({ street: "flop", actions: [] });
    const t = new HttpTransport({ url: "http://127.0.0.1:8765/", fetchImpl: f.fetchImpl });
    await expect(t.request({ players: 2 }, { progressive: false })).resolves.toMatchObject({ street: "flop" });
    expect(f.calls[0]!.url).toBe("http://127.0.0.1:8765/advise");
    expect(JSON.parse(String(f.calls[0]!.init!.body))).toEqual({ players: 2 });
  });

  it("POSTs an opponent's move to /play as the server reads it: {state, seat, hole, seed}", async () => {
    const f = fake({ pos: "BB", action: "call", name: "call", freq: 1 });
    const t = new HttpTransport({ url: "http://127.0.0.1:8765", fetchImpl: f.fetchImpl });
    const r = await t.request({ players: 2, hero: "SB" }, { progressive: false, play: { seat: "BB", hole: "QcQd", seed: 3 } });
    expect(r).toMatchObject({ action: "call" });
    expect(f.calls[0]!.url).toBe("http://127.0.0.1:8765/play");
    expect(JSON.parse(String(f.calls[0]!.init!.body))).toEqual({ state: { players: 2, hero: "SB" }, seat: "BB", hole: "QcQd", seed: 3 });
  });

  it("rejects a move with an error, and hands on an advice's, as the worker does", async () => {
    const f = fake({ error: "bad hand" });
    const t = new HttpTransport({ url: "http://127.0.0.1:8765", fetchImpl: f.fetchImpl });
    await expect(t.request({ players: 2 }, { progressive: false, play: { seat: "BB", hole: "xx" } })).rejects.toMatchObject({
      kind: "solver-error",
      message: "bad hand",
    });
    // (a queue of decisions keeps going past a spot the solver can't answer)
    await expect(t.request({ players: 2 }, { progressive: false })).resolves.toMatchObject({ error: "bad hand" });
  });
});
