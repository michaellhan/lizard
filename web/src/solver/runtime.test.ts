// `ensure`, which holds the app's one client, however its calls overlap. An "auto" library's HEAD is held open, so an
// older call can be made to finish after a newer one, as it does on a load where the saved settings come in meanwhile.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SolverClient } from "./client";
import { useRuntime } from "./runtime";

const ensure = (librarySource: string) => useRuntime.getState().ensure({ transport: "worker", localSolverUrl: "http://x", librarySource });
const SAVED = "lizard-library";
const OTHER = "gto-solver-library";

const tick = () => new Promise((r) => setTimeout(r, 0));

let heads: ((r: Response) => void)[] = [];
const dispose = vi.spyOn(SolverClient.prototype, "dispose");
const disposed = () => dispose.mock.instances;

beforeEach(() => {
  heads = [];
  dispose.mockClear();
  vi.stubGlobal("fetch", (_url: string, init?: RequestInit) =>
    init?.method === "HEAD" ? new Promise<Response>((res) => heads.push(res)) : Promise.resolve(new Response("{}", { status: 404 })),
  );
});

afterEach(() => {
  useRuntime.setState({ client: null, key: "", librarySource: null });
  vi.unstubAllGlobals();
});

describe("ensure", () => {
  it("builds one client for the settings, and gives it back", async () => {
    const client = await ensure(SAVED);
    expect(await ensure(SAVED)).toBe(client);
    expect(useRuntime.getState()).toMatchObject({ client, key: `worker|http://x|${SAVED}`, librarySource: SAVED });
    expect(disposed()).toEqual([]);
  });

  it("disposes the client another replaces", async () => {
    const first = await ensure(SAVED);
    const second = await ensure(OTHER);
    expect(second).not.toBe(first);
    expect(useRuntime.getState().client).toBe(second);
    expect(disposed()).toEqual([first]);
  });

  it("builds one client for two calls at once", async () => {
    const [a, b] = [ensure("auto"), ensure("auto")];
    await tick();
    for (const head of heads) head(new Response("", { status: 200 }));
    expect(await a).toBe(await b);
    expect(disposed()).toEqual([]);
  });

  it("lets the last call win: an older one finishing after it builds nothing, and answers with its client", async () => {
    const older = ensure("auto");
    const newest = await ensure(SAVED);
    expect(useRuntime.getState().client).toBe(newest);

    heads[0]!(new Response("", { status: 200 }));
    expect(await older).toBe(newest);
    expect(useRuntime.getState()).toMatchObject({ client: newest, key: `worker|http://x|${SAVED}` });
    expect(await ensure(SAVED)).toBe(newest);
    expect(disposed()).toEqual([]);
  });

  it("lets the last call win where it builds last too", async () => {
    const older = ensure("auto");
    await tick();
    const newest = ensure(OTHER);
    heads[0]!(new Response("", { status: 200 }));
    const client = await newest;
    expect(await older).toBe(client);
    expect(useRuntime.getState().key).toBe(`worker|http://x|${OTHER}`);
  });

  it("holds the client until another replaces it, and going back to it on the way keeps it, alive", async () => {
    const client = await ensure(SAVED);
    const away = ensure("auto");
    await tick();
    expect(disposed()).toEqual([]);

    expect(await ensure(SAVED)).toBe(client);
    heads[0]!(new Response("", { status: 200 }));
    expect(await away).toBe(client);
    expect(useRuntime.getState()).toMatchObject({ client, key: `worker|http://x|${SAVED}` });
    expect(disposed()).toEqual([]);
  });
});
