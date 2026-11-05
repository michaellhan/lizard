import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshChunk } from "./freshChunk";

describe("A chunk a deploy has replaced", () => {
  const reload = vi.fn();
  beforeEach(() => {
    sessionStorage.clear();
    reload.mockReset();
    vi.stubGlobal("location", { reload });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reloads once", async () => {
    let done = false;
    void freshChunk(() => Promise.reject(new Error("gone"))).finally(() => (done = true));
    await new Promise((r) => setTimeout(r));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(done).toBe(false);
  });

  it("lets a second failure through to the error page, with no second reload", async () => {
    sessionStorage.setItem("lizard.chunk-reloaded", "1");
    await expect(freshChunk(() => Promise.reject(new Error("still gone")))).rejects.toThrow("still gone");
    expect(reload).not.toHaveBeenCalled();
  });

  it("forgets the reload once a chunk arrives", async () => {
    sessionStorage.setItem("lizard.chunk-reloaded", "1");
    await expect(freshChunk(() => Promise.resolve("ok"))).resolves.toBe("ok");
    expect(sessionStorage.getItem("lizard.chunk-reloaded")).toBeNull();
  });
});
